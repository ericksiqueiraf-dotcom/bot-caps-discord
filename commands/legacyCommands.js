const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const utils = require('../utils/lobbyUtils');
const db = require('../services/dataService');
const balance = require('../services/balanceService');

const config = require('../config.json');
const QUEUE_MODES = db.QUEUE_MODES;

// Helper to access globals defined in index.js to keep the legacy functions working without huge rewrites:
const getClient = () => global.discordClient;
const getRiotService = () => global.riotService;

// Attach all utility functions to the module scope (cheap trick to avoid editing every line block)
Object.assign(global, utils);
Object.assign(global, db);
Object.assign(global, balance);

// Re-map internal usages of client/riotService within the chunk
async function handleEnterCommand(message, args) {
  const selectedMode = args[0]?.toLowerCase() === QUEUE_MODES.ARAM ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const selectedFormat = getFormatFromArgs(selectedMode, args);
  const nickname = getNicknameArgs(selectedMode, args, selectedFormat).join(' ').trim();

  if (!nickname) {
    await replyToMessage(message, 'Use `!entrar Nome#TAG` ou `!entrar aram 1x1 Nome#TAG`.');
    return;
  }

  if (!isMemberInQueueVoiceChannel(message.member, selectedMode)) {
    const expectedChannelName =
      selectedMode === QUEUE_MODES.ARAM ? 'Lista de espera - ARAM' : 'Lista de espera - CLASSIC';
    await replyToMessage(message, `Voce precisa estar no canal de voz \`${expectedChannelName}\` para entrar nessa fila.`);
    return;
  }

  try {
    await sendToMessageChannel(message, `Consultando o elo de **${nickname}** na Riot API...`);

    const rankProfile = await global.riotService.getPlayerRankProfile(nickname);
    const result = await withQueueOperationLock(`${message.guild.id}:${selectedMode}:${selectedFormat}`, async () => {
      const queueData = loadQueue();
      const playerStats = loadPlayerStats();
      const alreadyInQueue = findLobbyByPlayer(queueData, message.author.id);

      if (alreadyInQueue) {
        return { alreadyInQueue };
      }

      const storedStats = getStoredPlayerStats(playerStats, {
        discordId: message.author.id,
        nickname: rankProfile.nickname,
        puuid: rankProfile.puuid
      });
      const storedModeStats = getModeStats(storedStats, selectedMode, selectedFormat);
      const hybridMmr = calculateHybridMmr(
        rankProfile.mmr,
        storedModeStats.customWins,
        storedModeStats.customLosses,
        storedModeStats.internalRating
      );
      const duplicateNickname = Object.values(queueData.lobbies || {}).some((lobby) =>
        lobby.players.some((player) => player.nickname.toLowerCase() === rankProfile.nickname.toLowerCase())
      );

      if (duplicateNickname) {
        return { duplicateNickname: true };
      }

      let lobby = getOpenLobby(queueData, selectedMode, selectedFormat) || findReusableWaitingLobby(message.guild, queueData, selectedMode, selectedFormat);

      if (!lobby) {
        const letter = getNextLobbyLetter(queueData, selectedMode, selectedFormat);
        const createdLobby = await createLobbyChannels(message.guild, selectedMode, selectedFormat, letter);

        lobby = {
          id: `${selectedMode}-${selectedFormat}-${letter.toLowerCase()}`,
          mode: selectedMode,
          format: selectedFormat,
          letter,
          waitingChannelId: createdLobby.waitingChannelId,
          parentId: createdLobby.parentId,
          requiredPlayers: getRequiredPlayersByModeAndFormat(selectedMode, selectedFormat),
          players: [],
          status: 'waiting'
        };
      }

      lobby.players.push({
        discordId: message.author.id,
        discordUsername: message.author.username,
        nickname: rankProfile.nickname,
        tier: rankProfile.tier,
        rank: rankProfile.rank,
        leaguePoints: rankProfile.leaguePoints,
        wins: rankProfile.wins,
        losses: rankProfile.losses,
        isFallbackUnranked: Boolean(rankProfile.isFallbackUnranked),
        baseMmr: rankProfile.mmr,
        customWins: storedModeStats.customWins,
        customLosses: storedModeStats.customLosses,
        mmr: hybridMmr,
        puuid: rankProfile.puuid,
        summonerId: rankProfile.summonerId,
        mode: selectedMode,
        format: selectedFormat,
        joinedAt: new Date().toISOString()
      });
      queueData.lobbies[lobby.id] = lobby;

      upsertPlayerStats(playerStats, {
        discordId: message.author.id,
        nickname: rankProfile.nickname,
        puuid: rankProfile.puuid,
        baseMmr: rankProfile.mmr,
        modes: {
          ...normalizePlayerModes(storedStats),
          [getStatsBucketKey(selectedMode, selectedFormat)]: {
            ...getModeStats(storedStats, selectedMode, selectedFormat),
            baseMmr: rankProfile.mmr,
            internalRating:
              Number(getModeStats(storedStats, selectedMode, selectedFormat).internalRating || 0) || calculateSeedRating(rankProfile.mmr)
          }
        }
      });

      saveQueue(queueData);
      savePlayerStats(playerStats);

      return { lobby, storedModeStats, hybridMmr };
    });

    if (result.alreadyInQueue) {
      await replyToMessage(message, `Voce ja esta na sala ${result.alreadyInQueue.letter}.`);
      return;
    }

    if (result.duplicateNickname) {
      await replyToMessage(message, 'Ja existe um jogador com esse nick em uma sala de espera.');
      return;
    }

    const { lobby, storedModeStats, hybridMmr } = result;
    const waitingChannel = await message.guild.channels.fetch(lobby.waitingChannelId).catch(() => null);

    if (waitingChannel && waitingChannel.type === ChannelType.GuildVoice) {
      await message.member.voice.setChannel(waitingChannel);
    }

    const successEmbed = new EmbedBuilder()
      .setColor(THEME.SUCCESS)
      .setTitle('📥 Jogador Adicionado')
      .setDescription(`<@${message.author.id}> entrou com sucesso na fila.`)
      .addFields(
        { name: 'Lobby', value: `\`${lobby.letter}\``, inline: true },
        { name: 'Posição', value: `**#${lobby.players.length}**`, inline: true },
        { name: 'Capacidade', value: `\`${lobby.players.length}/${lobby.requiredPlayers}\``, inline: true },
        { name: 'Nick', value: `\`${rankProfile.nickname}\``, inline: true },
        { name: 'Elo', value: `\`${formatRank(rankProfile)}\``, inline: true },
        { name: 'Rank Interno', value: `**${getRankName(hybridMmr)}** (${hybridMmr} pts)`, inline: true }
      )
      .setFooter({
        text: `${FOOTER_PREFIX} • ${rankProfile.isFallbackUnranked ? 'Usando base Gold IV' : 'Perfil validado'}`
      })
      .setTimestamp();

    await sendToMessageChannel(message, { embeds: [successEmbed] });

    if (lobby.players.length === lobby.requiredPlayers) {
      await sendToMessageChannel(
        message,
        `Sala **${lobby.letter}** pronta para iniciar: **${formatQueueMode(selectedMode)} ${selectedFormat}**. Use \`!start\` dentro da sala de espera.`
      );
    }
  } catch (error) {
    await replyToMessage(message, `Nao foi possivel adicionar voce na fila: ${error.message}`);
  }
}

async function handleListCommand(message, args = []) {
  const queueData = loadQueue();
  const currentVoiceChannelId = message.member?.voice?.channelId || null;
  const lobbies = Object.values(queueData?.lobbies || {});
  const lobby = findLobbyBySelector(queueData, args) || (currentVoiceChannelId ? findLobbyByChannelId(queueData, currentVoiceChannelId) : null);

  await sendToMessageChannel(message, { embeds: [buildQueueEmbed(lobby, lobbies)] });
}

async function handlePingCommand(message) {
  const latency = global.discordClient.ws.ping >= 0 ? `${Math.round(global.discordClient.ws.ping)} ms` : 'indisponivel';
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Pong')
    .setDescription('O bot esta online e respondendo normalmente.')
    .addFields(
      { name: 'Latencia da API', value: latency, inline: true },
      { name: 'Versao', value: BOT_VERSION, inline: true }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleLeaderboardCommand(message, args = []) {
  const statsData = loadPlayerStats();
  const normalizedArgs = args.map((arg) => String(arg).toLowerCase());
  const normalizedContent = message.content.toLowerCase();
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) || normalizedContent.includes(' aram') ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const format = mode === QUEUE_MODES.ARAM && (normalizedArgs.includes('1x1') || normalizedContent.includes('1x1')) ? '1x1' : null;
  const embed = buildLeaderboardEmbed(statsData, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopTenCommand(message, args = []) {
  const statsData = loadPlayerStats();
  const seasonMeta = loadSeasonMeta();
  const normalizedArgs = args.map((arg) => String(arg).toLowerCase());
  const normalizedContent = message.content.toLowerCase();
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) || normalizedContent.includes(' aram') ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const format = mode === QUEUE_MODES.ARAM && (normalizedArgs.includes('1x1') || normalizedContent.includes('1x1')) ? '1x1' : null;

  await sendToMessageChannel(message, { embeds: [buildTopTenEmbed(statsData, seasonMeta, mode, format)] });
}

async function handleSeasonHistoryCommand(message, args) {
  const history = loadSeasonHistory();
  const requestedSeason = Number(args[0]);

  if (!requestedSeason) {
    const latestSeasons = [...history.seasons]
      .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
      .slice(0, 10)
      .map((season) => `**${getArchivedSeasonLabel(season)}** | Inicio: \`${season.startedAt}\` | Fim: \`${season.endedAt}\``)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x8e44ad)
      .setTitle('Historico de Periodos')
      .setDescription(latestSeasons || 'Nenhuma temporada arquivada ainda.')
      .setFooter({ text: 'Use !temporada <numero> para ver o resumo de uma temporada ou fase de testes.' })
      .setTimestamp();

    await sendToMessageChannel(message, { embeds: [embed] });
    return;
  }

  await sendToMessageChannel(message, { embeds: [buildSeasonHistoryEmbed(history, requestedSeason)] });
}

async function handlePlayerCardCommand(message, targetUser = null) {
  const selectedUser = targetUser || message.mentions.users.first() || message.author;

  if (!selectedUser) {
    await replyToMessage(message, 'Use `!ficha @usuario` para ver a ficha de um jogador.');
    return;
  }

  const statsData = loadPlayerStats();
  const playerStats = Object.values(statsData.players || {}).find((player) => player.discordId === selectedUser.id);

  if (!playerStats) {
    await replyToMessage(message, 'Nao encontrei estatisticas registradas para esse jogador.');
    return;
  }

  await sendToMessageChannel(message, { embeds: [buildPlayerCardEmbed(playerStats, selectedUser)] });
}

async function handleHelpCommand(message) {
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('Comandos do Bot')
    .setDescription('Lista atualizada de comandos para filas, partidas, rankings e temporadas. Os principais comandos tambem funcionam em barra, como `/entrar`, `/lista` e `/start`.')
    .addFields(
      { name: '!ping', value: 'Verifica se o bot esta online.', inline: false },
      { name: '!ajuda', value: 'Mostra esta lista de comandos.', inline: false },
      { name: '!entrar <nick>', value: 'Entra na fila CLASSIC. Ex.: `!entrar Nome#TAG`.', inline: false },
      { name: '!entrar aram <nick>', value: 'Entra na fila ARAM. Ex.: `!entrar aram 1x1 Nome#TAG`, `!entrar aram 3x3 Nome#TAG`.', inline: false },
      { name: '!sair', value: 'Remove voce da fila.', inline: false },
      { name: '!remover @usuario', value: 'Remove um membro da fila.', inline: false },
      { name: '!lista', value: 'Mostra a fila atual. Ex.: `!lista classic a` ou `!lista aram 3x3 a`.', inline: false },
      { name: '!placar', value: 'Mostra o ranking geral do CLASSIC.', inline: false },
      { name: '!placar aram', value: 'Mostra o ranking geral do ARAM em equipe.', inline: false },
      { name: '!placar aram 1x1', value: 'Mostra o ranking interno das partidas ARAM 1x1.', inline: false },
      { name: '!top10', value: 'Mostra o top 10 atual do CLASSIC.', inline: false },
      { name: '!top10 aram', value: 'Mostra o top 10 atual do ARAM em equipe.', inline: false },
      { name: '!perfil (ou !p)', value: 'Mostra o seu perfil completo com Rank e Win Streak.', inline: false },
      { name: '!ficha @usuario', value: 'Mostra o perfil de outro jogador do servidor.', inline: false },
      { name: '!top10 aram 1x1', value: 'Mostra o top 10 atual da temporada em ARAM 1x1.', inline: false },
      { name: '!temporadas', value: 'Lista fases de testes e temporadas arquivadas.', inline: false },
      { name: '!temporada <numero>', value: 'Mostra o resumo de uma temporada/fase arquivada.', inline: false },
      { name: '!desfazerresettemporada', value: 'Restaura o ultimo periodo arquivado que tenha dados validos.', inline: false },
      { name: '!restaurarperiodo <numero>', value: 'Restaura um periodo arquivado especifico pelo numero.', inline: false },
      { name: '!iniciartemporada', value: 'Encerra os testes e inicia a Temporada #1 oficial.', inline: false },
      { name: '!limparsalas', value: 'Remove salas automáticas órfãs e limpa o estado interno do bot.', inline: false },
      { name: '!start', value: 'Monta os times e move os jogadores. Ex.: `!start classic a` ou `!start aram 3x3 a`.', inline: false },
      { name: '!cancelarstart', value: 'Cancela a partida ativa. Ex.: `!cancelarstart classic a` ou `!cancelarstart aram 3x3 a`.', inline: false },
      { name: '!vitoria <1|2>', value: 'Registra o time vencedor. Ex.: `!vitoria classic a 1` ou `!vitoria aram 3x3 a 2`.', inline: false },
      { name: '!resetgeral', value: 'Arquiva a temporada atual e reseta os rankings internos.', inline: false },
      { name: '!reset', value: 'Limpa toda a fila.', inline: false }
    )
    .setFooter({ text: 'ARAM pontua por peso: 1x1 > 4x4 > 3x3 > 2x2. ARAM 5x5 nao pontua ranking. Rankings diarios saem as 08:00.' })
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleLeaveCommand(message) {
  const queueData = loadQueue();
  const lobby = findLobbyByPlayer(queueData, message.author.id);

  if (!lobby) {
    await replyToMessage(message, 'Voce nao esta na fila.');
    return;
  }

  const playerIndex = lobby.players.findIndex((player) => player.discordId === message.author.id);
  const [removedPlayer] = lobby.players.splice(playerIndex, 1);

  if (message.member.voice?.channelId === lobby.waitingChannelId) {
    const baseQueueChannelId = getBaseQueueChannelIdByMode(lobby.mode);
    await movePlayersToVoiceChannel(message.guild, [removedPlayer], baseQueueChannelId);
  }

  if (lobby.players.length === 0) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
    delete queueData.lobbies[lobby.id];
  } else {
    queueData.lobbies[lobby.id] = lobby;
  }

  saveQueue(queueData);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Jogador removido da sala')
    .setDescription(`<@${message.author.id}> saiu da sala de espera com sucesso.`)
    .addFields(
      { name: 'Lobby', value: lobby.letter, inline: true },
      { name: 'Nick', value: removedPlayer.nickname, inline: true },
      { name: 'Restantes na sala', value: `${lobby.players.length}/${lobby.requiredPlayers}`, inline: true }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleRemoveCommand(message, targetUserOverride = null) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para remover membros da fila.');
    return;
  }

  const targetUser = targetUserOverride || message.mentions.users.first();

  if (!targetUser) {
    await replyToMessage(message, 'Use `!remover @usuario` para remover alguem da fila.');
    return;
  }

  const queueData = loadQueue();
  const lobby = findLobbyByPlayer(queueData, targetUser.id);

  if (!lobby) {
    await replyToMessage(message, 'Esse usuario nao esta na fila.');
    return;
  }

  const playerIndex = lobby.players.findIndex((player) => player.discordId === targetUser.id);
  const [removedPlayer] = lobby.players.splice(playerIndex, 1);

  const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);

  if (targetMember?.voice?.channelId === lobby.waitingChannelId) {
    const baseQueueChannelId = getBaseQueueChannelIdByMode(lobby.mode);
    await movePlayersToVoiceChannel(message.guild, [removedPlayer], baseQueueChannelId);
  }

  if (lobby.players.length === 0) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
    delete queueData.lobbies[lobby.id];
  } else {
    queueData.lobbies[lobby.id] = lobby;
  }

  saveQueue(queueData);

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('Membro removido da sala')
    .setDescription(`${targetUser} foi removido da sala de espera.`)
    .addFields(
      { name: 'Lobby', value: lobby.letter, inline: true },
      { name: 'Nick', value: removedPlayer.nickname, inline: true },
      { name: 'Restantes na sala', value: `${lobby.players.length}/${lobby.requiredPlayers}`, inline: true }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleResetCommand(message) {
  const queueData = loadQueue();
  const currentMatchData = loadCurrentMatch();

  for (const lobby of Object.values(queueData.lobbies || {})) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
  }

  for (const entry of Object.values(currentMatchData.matches || {})) {
    const match = entry.match;

    if (!match) {
      continue;
    }

    const baseQueueChannelId = getBaseQueueChannelIdByMode(match.mode || QUEUE_MODES.CLASSIC);
    await movePlayersToVoiceChannel(message.guild, [...(match.teamOne || []), ...(match.teamTwo || [])], baseQueueChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.waitingChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.teamOneChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.teamTwoChannelId);
  }

  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Filas resetadas')
    .setDescription('Todas as salas de espera e partidas ativas foram limpas com sucesso.')
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleCleanupRoomsCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para limpar as salas automaticas.');
    return;
  }

  const dynamicChannels = message.guild.channels.cache.filter((channel) => isManagedDynamicChannel(channel));
  let removedCount = 0;

  for (const channel of dynamicChannels.values()) {
    const removed = await deleteVoiceChannelIfExists(message.guild, channel.id);

    if (removed) {
      removedCount += 1;
    }
  }

  const queueData = loadQueue();
  const currentMatchData = loadCurrentMatch();

  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('Limpeza de salas concluida')
    .setDescription('As salas automáticas órfãs foram limpas e o estado interno do bot foi resetado.')
    .addFields(
      { name: 'Canais removidos', value: `${removedCount}`, inline: true },
      { name: 'Lobbies limpos', value: `${Object.keys(queueData.lobbies || {}).length}`, inline: true },
      { name: 'Partidas ativas limpas', value: `${Object.keys(currentMatchData.matches || {}).length}`, inline: true }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleSeasonResetCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para resetar a temporada.');
    return;
  }

  const statsData = loadPlayerStats();
  const seasonMeta = loadSeasonMeta();
  const queueData = loadQueue();
  const currentMatchData = loadCurrentMatch();

  for (const lobby of Object.values(queueData.lobbies || {})) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
  }

  for (const entry of Object.values(currentMatchData.matches || {})) {
    const match = entry.match;

    if (!match) {
      continue;
    }

    const baseQueueChannelId = getBaseQueueChannelIdByMode(match.mode || QUEUE_MODES.CLASSIC);
    await movePlayersToVoiceChannel(message.guild, [...(match.teamOne || []), ...(match.teamTwo || [])], baseQueueChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.waitingChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.teamOneChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.teamTwoChannelId);
  }

  archiveCurrentSeason(statsData, seasonMeta);
  savePlayerStats(resetStatsForNewSeason(statsData));
  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });
  const nextSeasonMeta =
    seasonMeta.phase === 'official'
      ? {
          currentSeason: seasonMeta.currentSeason + 1,
          startedAt: new Date().toISOString(),
          phase: 'official',
          officialSeasonStarted: true,
          testingCycle: Number(seasonMeta.testingCycle || 1)
        }
      : {
          currentSeason: seasonMeta.currentSeason + 1,
          startedAt: new Date().toISOString(),
          phase: 'testing',
          officialSeasonStarted: false,
          testingCycle: Number(seasonMeta.testingCycle || seasonMeta.currentSeason || 1) + 1
        };
  saveSeasonMeta(nextSeasonMeta);

  const embed = new EmbedBuilder()
    .setColor(0xc0392b)
    .setTitle(seasonMeta.phase === 'official' ? 'Temporada resetada' : 'Fase de testes resetada')
    .setDescription(
      seasonMeta.phase === 'official'
        ? `A **Temporada #${seasonMeta.currentSeason}** foi arquivada e a **Temporada #${nextSeasonMeta.currentSeason}** foi iniciada.`
        : `A **${getSeasonDisplayLabel(seasonMeta)}** foi arquivada e a **${getSeasonDisplayLabel(nextSeasonMeta)}** foi iniciada.`
    )
    .addFields(
      {
        name: 'Historico',
        value:
          seasonMeta.phase === 'official'
            ? `Use \`!temporada ${seasonMeta.currentSeason}\` para ver o resumo arquivado.`
            : `Use \`!temporadas\` para ver a fase de testes arquivada.`
      },
      { name: 'Top 10 atual', value: 'Ja pode acompanhar novamente com `!top10` e `!top10 aram`.' }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleOfficialSeasonStartCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para iniciar a temporada oficial.');
    return;
  }

  const seasonMeta = loadSeasonMeta();

  if (seasonMeta.phase === 'official') {
    await replyToMessage(message, `A temporada oficial ja esta em andamento: **Temporada #${seasonMeta.currentSeason}**.`);
    return;
  }

  const statsData = loadPlayerStats();
  const queueData = loadQueue();
  const currentMatchData = loadCurrentMatch();

  for (const lobby of Object.values(queueData.lobbies || {})) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
  }

  for (const entry of Object.values(currentMatchData.matches || {})) {
    const match = entry.match;

    if (!match) {
      continue;
    }

    const baseQueueChannelId = getBaseQueueChannelIdByMode(match.mode || QUEUE_MODES.CLASSIC);
    await movePlayersToVoiceChannel(message.guild, [...(match.teamOne || []), ...(match.teamTwo || [])], baseQueueChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.waitingChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.teamOneChannelId);
    await deleteVoiceChannelIfExists(message.guild, match.teamTwoChannelId);
  }

  archiveCurrentSeason(statsData, seasonMeta);
  savePlayerStats(resetStatsForNewSeason(statsData));
  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });

  const nextSeasonMeta = {
    currentSeason: 1,
    startedAt: new Date().toISOString(),
    phase: 'official',
    officialSeasonStarted: true,
    testingCycle: Number(seasonMeta.testingCycle || seasonMeta.currentSeason || 1)
  };
  saveSeasonMeta(nextSeasonMeta);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Temporada oficial iniciada')
    .setDescription(
      `A **${getSeasonDisplayLabel(seasonMeta)}** foi arquivada e a **Temporada #1** oficial foi iniciada com ranking limpo.`
    )
    .addFields(
      { name: 'Historico', value: 'Use `!temporadas` para consultar as fases de testes arquivadas.' },
      { name: 'Ranking atual', value: 'Agora o `!top10` e `!top10 aram` contam para a temporada oficial.' }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleUndoSeasonResetCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para desfazer o reset da temporada.');
    return;
  }

  const history = loadSeasonHistory();
  const currentStats = loadPlayerStats();
  const queueData = loadQueue();
  const currentMatchData = loadCurrentMatch();
  const restoreIndex = [...history.seasons].map((season, index) => ({ season, index })).reverse().find(({ season }) => hasArchivedSeasonData(season));

  if (!restoreIndex) {
    await replyToMessage(message, 'Nao encontrei nenhum periodo arquivado com dados para restaurar.');
    return;
  }

  const { season: archivedSeason, index } = restoreIndex;

  for (const lobby of Object.values(queueData.lobbies || {})) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
  }

  for (const entry of Object.values(currentMatchData.matches || {})) {
    const match = entry.match;

    if (!match) {
      continue;
    }

    const baseQueueChannelId = getBaseQueueChannelIdByMode(match.mode || QUEUE_MODES.CLASSIC);
    await movePlayersToVoiceChannel(message.guild, [...(match.teamOne || []), ...(match.teamTwo || [])], baseQueueChannelId);
    await deleteManagedChannelsForLobby(message.guild, match.mode || QUEUE_MODES.CLASSIC, match.format || '5x5', match.letter, [
      match.waitingChannelId,
      match.teamOneChannelId,
      match.teamTwoChannelId
    ]);
  }

  const restoredStats = buildRestoredStatsFromArchive(archivedSeason, currentStats);
  const restoredMeta = archivedSeason.seasonMetaSnapshot
    ? deepClone(archivedSeason.seasonMetaSnapshot)
    : inferSeasonMetaFromArchive(archivedSeason);

  history.seasons = history.seasons.slice(0, index);

  saveSeasonHistory(history);
  savePlayerStats(restoredStats);
  saveSeasonMeta(restoredMeta);
  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Reset desfeito')
    .setDescription(`O periodo **${getArchivedSeasonLabel(archivedSeason)}** foi restaurado como periodo atual.`)
    .addFields(
      { name: 'Periodo atual', value: getSeasonDisplayLabel(restoredMeta), inline: true },
      {
        name: 'Observacao',
        value: archivedSeason.playersSnapshot
          ? 'Snapshot completo restaurado com todas as estatisticas do periodo.'
          : 'Restauracao parcial feita com base no historico arquivado disponivel.'
      }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleRestoreArchivedPeriodCommand(message, args = []) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para restaurar um periodo arquivado.');
    return;
  }

  const requestedNumber = Number(args[0]);

  if (!requestedNumber) {
    await replyToMessage(message, 'Use `!restaurarperiodo <numero>` para restaurar um periodo arquivado.');
    return;
  }

  const history = loadSeasonHistory();
  const currentStats = loadPlayerStats();
  const queueData = loadQueue();
  const currentMatchData = loadCurrentMatch();
  const matchedIndex = history.seasons.findIndex(
    (season) => season.seasonNumber === requestedNumber || season.testingCycle === requestedNumber
  );

  if (matchedIndex < 0) {
    await replyToMessage(message, `Nao encontrei um periodo arquivado com o numero **${requestedNumber}**.`);
    return;
  }

  const archivedSeason = history.seasons[matchedIndex];

  if (!hasArchivedSeasonData(archivedSeason)) {
    await replyToMessage(message, 'Esse periodo foi arquivado sem snapshot util de estatisticas para restauracao.');
    return;
  }

  for (const lobby of Object.values(queueData.lobbies || {})) {
    await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
  }

  for (const entry of Object.values(currentMatchData.matches || {})) {
    const match = entry.match;

    if (!match) {
      continue;
    }

    const baseQueueChannelId = getBaseQueueChannelIdByMode(match.mode || QUEUE_MODES.CLASSIC);
    await movePlayersToVoiceChannel(message.guild, [...(match.teamOne || []), ...(match.teamTwo || [])], baseQueueChannelId);
    await deleteManagedChannelsForLobby(message.guild, match.mode || QUEUE_MODES.CLASSIC, match.format || '5x5', match.letter, [
      match.waitingChannelId,
      match.teamOneChannelId,
      match.teamTwoChannelId
    ]);
  }

  const restoredStats = buildRestoredStatsFromArchive(archivedSeason, currentStats);
  const restoredMeta = archivedSeason.seasonMetaSnapshot
    ? deepClone(archivedSeason.seasonMetaSnapshot)
    : inferSeasonMetaFromArchive(archivedSeason);

  history.seasons = history.seasons.filter((_, index) => index !== matchedIndex);

  saveSeasonHistory(history);
  savePlayerStats(restoredStats);
  saveSeasonMeta(restoredMeta);
  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Periodo restaurado')
    .setDescription(`O periodo **${getArchivedSeasonLabel(archivedSeason)}** foi restaurado como periodo atual.`)
    .addFields(
      { name: 'Periodo atual', value: getSeasonDisplayLabel(restoredMeta), inline: true },
      {
        name: 'Restauracao',
        value: archivedSeason.playersSnapshot
          ? 'Snapshot completo restaurado.'
          : 'Restauracao parcial feita a partir do historico arquivado.'
      }
    )
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleCancelStartCommand(message, args = []) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para cancelar uma partida iniciada.');
    return;
  }

  const currentMatchData = loadCurrentMatch();
  const currentVoiceChannelId = message.member.voice?.channelId;
  const matchEntry = findActiveMatchBySelector(currentMatchData, args) || getActiveMatchEntry(currentMatchData, currentVoiceChannelId);

  if (!matchEntry) {
    await replyToMessage(message, 'Nao existe uma partida ativa para cancelar.');
    return;
  }

  const [matchId, currentMatchEntry] = matchEntry;
  const match = currentMatchEntry.match;
  let restoredLobby = buildLobbyFromMatch(match);

  if (!restoredLobby.waitingChannelId || !(await message.guild.channels.fetch(restoredLobby.waitingChannelId).catch(() => null))) {
    const createdLobby = await createLobbyChannels(message.guild, restoredLobby.mode, restoredLobby.format, restoredLobby.letter);
    restoredLobby.waitingChannelId = createdLobby.waitingChannelId;
    restoredLobby.parentId = createdLobby.parentId;
  }

  await movePlayersToVoiceChannel(message.guild, restoredLobby.players, restoredLobby.waitingChannelId);
  await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
    match.teamOneChannelId,
    match.teamTwoChannelId
  ]);

  const queueData = loadQueue();
  queueData.lobbies[restoredLobby.id] = restoredLobby;
  delete currentMatchData.matches[matchId];

  saveQueue(queueData);
  saveCurrentMatch(currentMatchData);

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('Partida cancelada')
    .setDescription('A partida iniciada pelo `!start` foi cancelada e os jogadores voltaram para a sala de espera.')
    .addFields(
      { name: 'Lobby', value: restoredLobby.letter, inline: true },
      { name: 'Modo', value: `${formatQueueMode(restoredLobby.mode)} ${restoredLobby.format}`, inline: true },
      { name: 'Jogadores restaurados', value: `${restoredLobby.players.length}`, inline: true }
    )
    .setFooter({ text: 'Agora voce pode reorganizar a fila e usar !start novamente.' })
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleStartCommand(message, args = []) {
  const currentVoiceChannelId = message.member.voice?.channelId;
  const initialQueueData = loadQueue();
  const selectedLobby =
    findLobbyBySelector(initialQueueData, args) || (currentVoiceChannelId ? findLobbyByChannelId(initialQueueData, currentVoiceChannelId) : null);

  if (!selectedLobby || selectedLobby.status !== 'waiting') {
    await replyToMessage(message, 'Entre em uma sala de espera valida para iniciar essa partida.');
    return;
  }

  try {
    const result = await withQueueOperationLock(`${message.guild.id}:start:${selectedLobby.id}`, async () => {
      const queueData = loadQueue();
      const currentMatchData = loadCurrentMatch();
      const lobby = queueData.lobbies[selectedLobby.id];

      if (!lobby || lobby.status !== 'waiting') {
        return { error: 'A sala selecionada nao esta mais disponivel para iniciar.' };
      }

      if (currentMatchData.matches?.[lobby.id]?.active) {
        return { error: `A sala **${lobby.letter}** ja possui uma partida ativa.` };
      }

      if (lobby.players.length !== lobby.requiredPlayers) {
        return {
          error: `A sala **${lobby.letter}** de \`${formatQueueMode(lobby.mode)} ${lobby.format}\` precisa ter ${lobby.requiredPlayers} jogadores. Atual: ${lobby.players.length}.`
        };
      }

      const teams = createBalancedTeams(lobby.players);
      const teamChannels = await createTeamChannelsForLobby(message.guild, lobby);

      teams.mode = lobby.mode;
      teams.format = lobby.format;
      await movePlayersToTeamChannels(message.guild, teams, teamChannels);

      currentMatchData.matches[lobby.id] = {
        active: true,
        match: {
          id: lobby.id,
          mode: lobby.mode,
          format: lobby.format,
          letter: lobby.letter,
          requiredPlayers: lobby.requiredPlayers,
          parentId: lobby.parentId || null,
          waitingChannelId: lobby.waitingChannelId,
          teamOneChannelId: teamChannels.teamOneChannelId,
          teamTwoChannelId: teamChannels.teamTwoChannelId,
          teamSize: teams.teamOne.length,
          createdAt: new Date().toISOString(),
          teamOne: teams.teamOne,
          teamTwo: teams.teamTwo,
          teamOneMmr: teams.teamOneMmr,
          teamTwoMmr: teams.teamTwoMmr,
          difference: teams.difference
        }
      };

      delete queueData.lobbies[lobby.id];
      saveCurrentMatch(currentMatchData);
      saveQueue(queueData);

      return { teams };
    });

    if (result.error) {
      await replyToMessage(message, result.error);
      return;
    }

    await sendToMessageChannel(message, { embeds: [buildTeamsEmbed(result.teams)] });
  } catch (error) {
    await replyToMessage(message, `Nao foi possivel iniciar a partida: ${error.message}`);
  }
}

async function handleVictoryCommand(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await replyToMessage(message, 'Voce nao tem permissao para registrar resultado de partida.');
    return;
  }

  const winningTeam = args[args.length - 1];

  if (!['1', '2'].includes(winningTeam)) {
    await replyToMessage(message, 'Use `!vitoria 1` ou `!vitoria 2` para registrar o vencedor.');
    return;
  }

  const currentMatchData = loadCurrentMatch();
  const currentVoiceChannelId = message.member.voice?.channelId;
  const selectorArgs = args.slice(0, -1);
  const matchEntry = findActiveMatchBySelector(currentMatchData, selectorArgs) || getActiveMatchEntry(currentMatchData, currentVoiceChannelId);

  if (!matchEntry) {
    await replyToMessage(message, 'Nao existe uma partida ativa para registrar resultado.');
    return;
  }

  const [matchId, currentMatchEntry] = matchEntry;
  const match = currentMatchEntry.match;
  const winningPlayers = winningTeam === '1' ? match.teamOne : match.teamTwo;
  const losingPlayers = winningTeam === '1' ? match.teamTwo : match.teamOne;
  const statsData = loadPlayerStats();
  const matchMode = match.mode || QUEUE_MODES.CLASSIC;
  const matchFormat = match.format || null;
  const statsBucketKey = getStatsBucketKey(matchMode, matchFormat);
  const statsBucketLabel = getStatsBucketLabel(matchMode, matchFormat);
  const teamSize = Number(match.teamSize || winningPlayers.length || 0);
  const aramWeight = matchMode === QUEUE_MODES.ARAM ? getAramWeightByTeamSize(teamSize) : 1;
  const shouldAffectRanking = matchMode !== QUEUE_MODES.ARAM || aramWeight > 0;
  const seasonMeta = loadSeasonMeta();
  const winnerAverageRating =
    winningPlayers.reduce((total, player) => total + getModeStats(getStoredPlayerStats(statsData, player), matchMode, matchFormat).internalRating, 0) /
    winningPlayers.length;
  const loserAverageRating =
    losingPlayers.reduce((total, player) => total + getModeStats(getStoredPlayerStats(statsData, player), matchMode, matchFormat).internalRating, 0) /
    losingPlayers.length;
  const winnerSnapshots = [];
  const loserSnapshots = [];

  for (const player of winningPlayers) {
    const stored = getStoredPlayerStats(statsData, player);
    const modeStats = getModeStats(stored, matchMode, matchFormat);
    const totalGames = Number(modeStats.customWins || 0) + Number(modeStats.customLosses || 0);
    const currentStreak = Number(modeStats.winStreak || 0) + 1;

    const beforeRank = calculateHybridMmr(
      modeStats.baseMmr ?? player.baseMmr ?? player.mmr,
      modeStats.customWins,
      modeStats.customLosses,
      modeStats.internalRating
    );
    const ratingDelta = shouldAffectRanking
      ? Math.round(calculateEloDelta(modeStats.internalRating, loserAverageRating, 1, totalGames) * aramWeight)
      : 0;

    upsertPlayerStats(statsData, player, {
      modes: {
        ...normalizePlayerModes(stored),
        [statsBucketKey]: {
          ...modeStats,
          customWins: shouldAffectRanking ? Number(modeStats.customWins || 0) + 1 : Number(modeStats.customWins || 0),
          internalRating: Math.max(0, Number(modeStats.internalRating || 0) + ratingDelta),
          winStreak: currentStreak
        }
      }
    });

    const updated = getStoredPlayerStats(statsData, player);
    const updatedModeStats = getModeStats(updated, matchMode, matchFormat);
    const afterRank = calculateHybridMmr(
      updatedModeStats.baseMmr ?? player.baseMmr ?? player.mmr,
      updatedModeStats.customWins,
      updatedModeStats.customLosses,
      updatedModeStats.internalRating
    );

    winnerSnapshots.push({
      discordId: player.discordId,
      nickname: player.nickname,
      beforeRank,
      afterRank,
      ratingDelta,
      winStreak: currentStreak,
      beforeRecord: formatCustomRecord(modeStats),
      afterRecord: formatCustomRecord(updatedModeStats)
    });
  }

  for (const player of losingPlayers) {
    const stored = getStoredPlayerStats(statsData, player);
    const modeStats = getModeStats(stored, matchMode, matchFormat);
    const totalGames = Number(modeStats.customWins || 0) + Number(modeStats.customLosses || 0);

    const beforeRank = calculateHybridMmr(
      modeStats.baseMmr ?? player.baseMmr ?? player.mmr,
      modeStats.customWins,
      modeStats.customLosses,
      modeStats.internalRating
    );
    const ratingDelta = shouldAffectRanking
      ? Math.round(calculateEloDelta(modeStats.internalRating, winnerAverageRating, 0, totalGames) * aramWeight)
      : 0;

    upsertPlayerStats(statsData, player, {
      modes: {
        ...normalizePlayerModes(stored),
        [statsBucketKey]: {
          ...modeStats,
          customLosses: shouldAffectRanking ? Number(modeStats.customLosses || 0) + 1 : Number(modeStats.customLosses || 0),
          internalRating: Math.max(0, Number(modeStats.internalRating || 0) + ratingDelta),
          winStreak: 0
        }
      }
    });

    const updated = getStoredPlayerStats(statsData, player);
    const updatedModeStats = getModeStats(updated, matchMode, matchFormat);
    const afterRank = calculateHybridMmr(
      updatedModeStats.baseMmr ?? player.baseMmr ?? player.mmr,
      updatedModeStats.customWins,
      updatedModeStats.customLosses,
      updatedModeStats.internalRating
    );

    loserSnapshots.push({
      discordId: player.discordId,
      nickname: player.nickname,
      beforeRank,
      afterRank,
      ratingDelta,
      beforeRecord: formatCustomRecord(modeStats),
      afterRecord: formatCustomRecord(updatedModeStats)
    });
  }

  savePlayerStats(statsData);
  delete currentMatchData.matches[matchId];
  saveCurrentMatch(currentMatchData);

  // MVP selection (Highest Win Streak among winners)
  const mvp = winnerSnapshots.reduce((prev, current) => (prev.winStreak > current.winStreak ? prev : current), winnerSnapshots[0]);

  const winnersText = winnerSnapshots
    .map((p) => `- <@${p.discordId}>: **${p.afterRank} pts** (\`+${p.ratingDelta}\`) ${p.winStreak > 1 ? `🔥 ${p.winStreak} winstreak` : ''}`)
    .join('\n');

  const losersText = loserSnapshots
    .map((p) => `- <@${p.discordId}>: **${p.afterRank} pts** (\`${p.ratingDelta}\`)`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(THEME.SUCCESS)
    .setTitle('⚔️ Resultado da Partida')
    .setDescription(`🏆 **Equipe ${winningTeam} venceu!**\nLobby: \`${match.letter}\` | Modo: \`${statsBucketLabel}\``)
    .addFields(
      { name: '🔥 MVP (Maior Streak)', value: `<@${mvp.discordId}> com **${mvp.winStreak} vitórias seguidas!**` },
      { name: '📈 Ganhos de elo', value: winnersText || 'Ninguém' },
      { name: '💀 Perdas de elo', value: losersText || 'Ninguém' }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Resultado Final` })
    .setTimestamp();

  const allPlayers = [...winningPlayers, ...losingPlayers];
  const baseQueueChannelId = getBaseQueueChannelIdByMode(matchMode);
  await movePlayersToVoiceChannel(message.guild, allPlayers, baseQueueChannelId);
  await deleteManagedChannelsForLobby(message.guild, matchMode, matchFormat, match.letter, [
    match.waitingChannelId,
    match.teamOneChannelId,
    match.teamTwoChannelId
  ]);

  await sendToMessageChannel(message, { embeds: [embed] });

  await postMatchHistoryLog(message.guild, {
    winningTeam,
    modeLabel: statsBucketLabel,
    formatLabel: match.format || getAramFormatLabel(teamSize),
    letter: match.letter,
    startedAt: match.createdAt || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    initialDifference: match.difference ?? 0,
    periodLabel: getSeasonDisplayLabel(seasonMeta),
    winners: winnerSnapshots,
    losers: loserSnapshots
  });
}
module.exports = {
  handleEnterCommand,
  handleListCommand,
  handlePingCommand,
  handleLeaderboardCommand,
  handleTopTenCommand,
  handleSeasonHistoryCommand,
  handlePlayerCardCommand,
  handleHelpCommand,
  handleLeaveCommand,
  handleRemoveCommand,
  handleResetCommand,
  handleCleanupRoomsCommand,
  handleSeasonResetCommand,
  handleOfficialSeasonStartCommand,
  handleUndoSeasonResetCommand,
  handleRestoreArchivedPeriodCommand,
  handleCancelStartCommand,
  handleStartCommand,
  handleVictoryCommand
};
