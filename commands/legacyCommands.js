const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

const { 
  replyToMessage, sendToMessageChannel, getFormatFromArgs, 
  getNicknameArgs, isMemberInQueueVoiceChannel, getQueueChannel, 
  findLobbyByPlayer, getStoredPlayerStats, getModeStats, 
  getOpenLobby, findReusableWaitingLobby, formatRank, 
  formatQueueMode, updateQueueDashboard, movePlayersToVoiceChannel, 
  deleteVoiceChannelIfExists, numberToLobbyLetter, getNextLobbyLetter, 
  deleteManagedChannelsForLobby, isManagedDynamicChannel, 
  syncMemberRankRole, buildQueueEmbed, buildTeamsEmbed, 
  getStatsBucketKey, getAramFormatLabel, getAramWeightByTeamSize, 
  getRequiredPlayersLabel, isValidQueueSize, getRequiredPlayersByModeAndFormat, 
  getBaseQueueChannelIdByMode, findLobbyByChannelId, getActiveMatchEntry, 
  findActiveMatchBySelector, getSaoPauloDateParts, getSeasonDisplayLabel, 
  formatDateTimeForHistory, getArchivedSeasonLabel, splitEmbedFieldChunks,
  THEME, FOOTER_PREFIX, createLobbyChannels, createTeamChannelsForLobby, 
  findLobbyBySelector, buildLeaderboardEmbed, buildTopTenEmbed, 
  getRankedPlayersByMode, archiveCurrentSeason, resetStatsForNewSeason, 
  buildLobbyFromMatch, upsertPlayerStats, normalizePlayerModes, 
  movePlayersToTeamChannels, sendMatchStartAnnouncement, syncMvpRole, clearMvpRoles,
  postMvpAnnouncement, postMatchHistoryLog, buildPlayerCardEmbed, 
  buildSeasonHistoryEmbed, formatCustomRecord
} = require('../utils/lobbyUtils');

const { 
  QUEUE_MODES, loadQueue, saveQueue, loadPlayerStats, 
  savePlayerStats, loadCurrentMatch, saveCurrentMatch, 
  loadSeasonMeta, saveSeasonMeta, loadSeasonHistory, 
  saveSeasonHistory, loadSystemMeta, saveSystemMeta, 
  withQueueOperationLock 
} = require('../services/dataService');

const { 
  calculateSeedRating, calculateHybridMmr, calculateEloDelta, 
  createBalancedTeams 
} = require('../services/balanceService');

const getRiotService = () => global.riotService;

// Armazena timeouts de auto-start pendentes: { [lobbyId]: timeoutId }
const pendingAutoStarts = new Map();
const VOTE_THRESHOLD = 3; // Fase de testes: 3 votos decidem

async function triggerAutoStart(guild, lobbyId) {
  try {
    const queueData = await loadQueue();
    const lobby = queueData.lobbies[lobbyId];
    if (!lobby || lobby.players.length < lobby.requiredPlayers) return;

    // Busca o canal de texto para postar o anúncio
    const statusChannelId = require('../config.json').textChannels?.matchOngoingChannelId;
    const statusChannel = statusChannelId ? await guild.channels.fetch(statusChannelId).catch(() => null) : null;

    if (statusChannel?.isTextBased()) {
      const mentions = lobby.players.map(p => `<@${p.discordId}>`).join(' ');
      await statusChannel.send(
        `${mentions}\n⚡ Fila **${lobby.letter} (${lobby.mode.toUpperCase()})** completa! Iniciando em **5 segundos**...\n` +
        `_(Staff: use \`!cancelarstart ${lobby.mode} ${lobby.letter}\` para cancelar)_`
      ).catch(() => null);
    }

    const timeoutId = setTimeout(async () => {
      pendingAutoStarts.delete(lobbyId);
      const freshQueue = await loadQueue();
      const freshLobby = freshQueue.lobbies[lobbyId];
      if (!freshLobby || freshLobby.players.length < freshLobby.requiredPlayers) return;

      // Simula contexto mínimo para handleStartCommand
      const fakeContext = {
        guild,
        member: { voice: { channel: null }, permissions: { has: () => true } },
        channel: statusChannel,
        author: { id: 'autostart', tag: 'AutoStart' },
        deletable: false,
        delete: async () => {},
        _lobbyIdOverride: lobbyId
      };
      await handleStartCommandInternal(guild, freshLobby, statusChannel);
    }, 5000);

    pendingAutoStarts.set(lobbyId, timeoutId);
  } catch (err) {
    console.error('[AUTO-START] Erro:', err);
  }
}

async function handleStartCommandInternal(guild, lobby, replyChannel) {
  try {
    const result = await withQueueOperationLock(`${guild.id}:start:${lobby.id}`, async () => {
      const q = await loadQueue();
      const m = await loadCurrentMatch();
      if (!q.lobbies[lobby.id]) return null;
      const teams = createBalancedTeams(lobby.players);
      const chs = await createTeamChannelsForLobby(guild, lobby);
      teams.mode = lobby.mode;
      teams.format = lobby.format;
      await movePlayersToTeamChannels(guild, teams, chs);
      m.matches[lobby.id] = {
        active: true,
        votes: {},
        match: {
          ...lobby,
          teamOne: teams.teamOne,
          teamTwo: teams.teamTwo,
          teamOneChannelId: chs.teamOneChannelId,
          teamTwoChannelId: chs.teamTwoChannelId,
          teamSize: teams.teamOne.length,
          createdAt: new Date().toISOString()
        }
      };
      delete q.lobbies[lobby.id];
      await saveQueue(q);
      await saveCurrentMatch(m);
      return { teams, chs, lobby };
    });
    if (!result) return;
    await sendMatchStartAnnouncement(guild, result.teams);
    await updateQueueDashboard(guild);
    if (replyChannel?.isTextBased()) {
      await replyChannel.send({ embeds: [buildTeamsEmbed(result.teams)] }).catch(() => null);
    }
  } catch (err) {
    console.error('[AUTO-START INTERNAL] Erro:', err);
  }
}

async function handleEnterCommand(message, args) {
  try {
    const selectedMode = args[0]?.toLowerCase() === QUEUE_MODES.ARAM ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
    const selectedFormat = getFormatFromArgs(selectedMode, args);
    const providedNick = getNicknameArgs(selectedMode, args, selectedFormat).join(' ').trim();

    if (!isMemberInQueueVoiceChannel(message.member, selectedMode)) {
      const expectedChannelName = selectedMode === QUEUE_MODES.ARAM ? 'Lobby ARAM' : 'Lobby Classic';
      await replyToMessage(message, `Voce precisa estar no canal de voz \`${expectedChannelName}\` para entrar nessa fila.`).catch(() => null);
      return;
    }

    // --- Resolução do nick: banco ou argumento ---
    const playerStats = await loadPlayerStats();
    const allEntries = Object.values(playerStats.players || {}).filter(p => p.discordId === message.author.id);
    const storedEntry = allEntries.sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0))[0] || null;
    const registeredNick = storedEntry?.registeredNickname || null;

    let rankProfile;
    let usedApiCall = false;

    if (providedNick) {
      // Nick explícito → chama API e atualiza cadastro
      rankProfile = await global.riotService.getPlayerRankProfile(providedNick);
      usedApiCall = true;
    } else if (registeredNick) {
      // Sem nick, mas tem cadastro → usa dados salvos (sem API)
      const storedModeStats = getModeStats(storedEntry, selectedMode, selectedFormat);
      rankProfile = {
        puuid: storedEntry.puuid,
        summonerId: storedEntry.summonerId || null,
        nickname: registeredNick,
        tier: storedEntry.tier || 'GOLD',
        rank: storedEntry.rank || 'IV',
        leaguePoints: storedEntry.leaguePoints || 0,
        mmr: storedEntry.baseMmr || storedModeStats.baseMmr || 1200,
        isFallbackUnranked: Boolean(storedEntry.isFallbackUnranked)
      };
    } else {
      // Sem nick e sem cadastro → orienta o usuário
      await replyToMessage(message,
        '❌ Voce ainda nao tem cadastro!\n' +
        'Use `!cadastrar SeuNick#TAG` uma vez para vincular sua conta — depois e so dar `!entrar` 😊'
      );
      return;
    }

    const result = await withQueueOperationLock(`${message.guild.id}:${selectedMode}:${selectedFormat}`, async () => {
      const queueData = await loadQueue();
      const freshStats = await loadPlayerStats();
      const alreadyInQueue = findLobbyByPlayer(queueData, message.author.id);

      if (alreadyInQueue) return { alreadyInQueue };

      const storedStats = getStoredPlayerStats(freshStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid });
      const storedModeStats = getModeStats(storedStats, selectedMode, selectedFormat);
      const hybridMmr = calculateHybridMmr(rankProfile.mmr, storedModeStats.customWins, storedModeStats.customLosses, storedModeStats.internalRating);

      const duplicateNickname = Object.values(queueData.lobbies || {}).some(l => l.players.some(p => p.nickname.toLowerCase() === rankProfile.nickname.toLowerCase()));
      if (duplicateNickname) return { duplicateNickname: true };

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
        isFallbackUnranked: Boolean(rankProfile.isFallbackUnranked),
        baseMmr: rankProfile.mmr,
        customWins: storedModeStats.customWins || 0,
        customLosses: storedModeStats.customLosses || 0,
        mmr: hybridMmr,
        puuid: rankProfile.puuid,
        summonerId: rankProfile.summonerId,
        mode: selectedMode,
        format: selectedFormat,
        joinedAt: new Date().toISOString()
      });
      queueData.lobbies[lobby.id] = lobby;

      // Atualiza stats E cadastro se veio com nick explícito
      const updatedFields = {
        modes: {
          ...normalizePlayerModes(storedStats),
          [getStatsBucketKey(selectedMode, selectedFormat)]: {
            ...getModeStats(storedStats, selectedMode, selectedFormat),
            baseMmr: rankProfile.mmr,
            internalRating: Number(getModeStats(storedStats, selectedMode, selectedFormat).internalRating || 0) || calculateSeedRating(rankProfile.mmr)
          }
        }
      };
      if (usedApiCall) {
        updatedFields.registeredNickname = rankProfile.nickname;
        updatedFields.registeredAt = new Date().toISOString();
        updatedFields.tier = rankProfile.tier;
        updatedFields.rank = rankProfile.rank;
        updatedFields.leaguePoints = rankProfile.leaguePoints;
        updatedFields.baseMmr = rankProfile.mmr;
        updatedFields.puuid = rankProfile.puuid;
        updatedFields.summonerId = rankProfile.summonerId;
        updatedFields.isFallbackUnranked = Boolean(rankProfile.isFallbackUnranked);
      }
      upsertPlayerStats(freshStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid }, updatedFields);

      await saveQueue(queueData);
      await savePlayerStats(freshStats);
      return { lobby };
    });

    if (result.alreadyInQueue) return await replyToMessage(message, `Voce ja esta na sala ${result.alreadyInQueue.letter}.`);
    if (result.duplicateNickname) return await replyToMessage(message, 'Ja existe um jogador com esse nick na fila.');

    const { lobby } = result;
    const waitingChannel = await message.guild.channels.fetch(lobby.waitingChannelId).catch(() => null);
    if (waitingChannel && message.member.voice.channel) {
      await message.member.voice.setChannel(waitingChannel).catch(() => null);
    }

    await updateQueueDashboard(message.guild);

    // --- Auto-start se a fila ficou completa ---
    if (lobby.players.length >= lobby.requiredPlayers && !pendingAutoStarts.has(lobby.id)) {
      await triggerAutoStart(message.guild, lobby.id);
    }
  } catch (error) {
    console.error('[ERRO] !entrar:', error);
    await replyToMessage(message, `Erro ao entrar na fila: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRegisterCommand(message, args) {
  try {
    const nickname = args.join(' ').trim();
    if (!nickname) {
      await replyToMessage(message, '❌ Use `!cadastrar SeuNick#TAG` para vincular sua conta Riot.');
      return;
    }
    await replyToMessage(message, '⏳ Validando sua conta na Riot...');
    const rankProfile = await global.riotService.getPlayerRankProfile(nickname);
    const playerStats = await loadPlayerStats();

    // Busca entrada anterior do mesmo discordId para migrar o histórico de partidas
    const previousEntries = Object.values(playerStats.players || {}).filter(p => p.discordId === message.author.id);
    const previousEntry = previousEntries.sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0))[0] || null;

    const storedStats = getStoredPlayerStats(playerStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid });
    upsertPlayerStats(playerStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid }, {
      registeredNickname: rankProfile.nickname,
      registeredAt: new Date().toISOString(),
      tier: rankProfile.tier,
      rank: rankProfile.rank,
      leaguePoints: rankProfile.leaguePoints,
      baseMmr: rankProfile.mmr,
      puuid: rankProfile.puuid,
      summonerId: rankProfile.summonerId,
      isFallbackUnranked: Boolean(rankProfile.isFallbackUnranked),
      modes: {
        ...normalizePlayerModes(previousEntry || storedStats),
        classic: { ...getModeStats(previousEntry || storedStats, QUEUE_MODES.CLASSIC), baseMmr: rankProfile.mmr }
      }
    });
    await savePlayerStats(playerStats);
    const rankStr = rankProfile.isFallbackUnranked ? 'Unranked (base Gold IV)' : `${rankProfile.tier} ${rankProfile.rank} — ${rankProfile.leaguePoints} PDL`;
    await replyToMessage(message,
      `✅ Conta vinculada com sucesso!\n` +
      `🎮 **${rankProfile.nickname}** · ${rankStr}\n` +
      `Agora e so usar \`!entrar\` para entrar na fila rapidinho! 🚀`
    );
  } catch (error) {
    console.error('[ERRO] !cadastrar:', error);
    await replyToMessage(message, `❌ Erro ao cadastrar: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleNickUpdateCommand(message, args) {
  try {
    const nickname = args.join(' ').trim();
    if (!nickname) {
      await replyToMessage(message, '❌ Use `!nick SeuNovoNick#TAG` para atualizar seu cadastro.');
      return;
    }
    await replyToMessage(message, '⏳ Verificando novo nick na Riot...');
    if (global.riotService.invalidateCache) {
      const playerStats = await loadPlayerStats();
      const storedEntry = Object.values(playerStats.players || {}).find(p => p.discordId === message.author.id);
      if (storedEntry?.puuid) global.riotService.invalidateCache(storedEntry.puuid);
    }
    const rankProfile = await global.riotService.getPlayerRankProfile(nickname);
    const playerStats = await loadPlayerStats();
    const storedStats = getStoredPlayerStats(playerStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid });
    upsertPlayerStats(playerStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid }, {
      registeredNickname: rankProfile.nickname,
      registeredAt: new Date().toISOString(),
      tier: rankProfile.tier,
      rank: rankProfile.rank,
      leaguePoints: rankProfile.leaguePoints,
      baseMmr: rankProfile.mmr,
      puuid: rankProfile.puuid,
      summonerId: rankProfile.summonerId,
      isFallbackUnranked: Boolean(rankProfile.isFallbackUnranked),
    });
    await savePlayerStats(playerStats);
    const rankStr = rankProfile.isFallbackUnranked ? 'Unranked (base Gold IV)' : `${rankProfile.tier} ${rankProfile.rank} — ${rankProfile.leaguePoints} PDL`;
    await replyToMessage(message,
      `✅ Nick atualizado!\n` +
      `🎮 **${rankProfile.nickname}** · ${rankStr}`
    );
  } catch (error) {
    console.error('[ERRO] !nick:', error);
    await replyToMessage(message, `❌ Erro ao atualizar nick: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleVoteCommand(message, args) {
  try {
    const teamVote = args[args.length - 1];
    if (!['1', '2'].includes(teamVote)) {
      await replyToMessage(message, '❌ Use `!votar 1` ou `!votar 2` para votar no time vencedor.');
      return;
    }

    const currentMatchData = await loadCurrentMatch();
    // Encontra a partida onde o jogador está
    const matchEntry = Object.entries(currentMatchData.matches || {}).find(([, entry]) => {
      if (!entry.active || !entry.match) return false;
      const { teamOne = [], teamTwo = [] } = entry.match;
      return [...teamOne, ...teamTwo].some(p => p.discordId === message.author.id);
    });

    if (!matchEntry) {
      await replyToMessage(message, '❌ Voce nao esta em nenhuma partida ativa.');
      return;
    }

    const [matchId, entry] = matchEntry;
    if (!entry.votes) entry.votes = {};

    if (entry.votes[message.author.id]) {
      await replyToMessage(message, `⚠️ Voce ja votou no **Time ${entry.votes[message.author.id]}** nesta partida.`);
      return;
    }

    entry.votes[message.author.id] = teamVote;

    // Conta votos por time
    const votesT1 = Object.values(entry.votes).filter(v => v === '1').length;
    const votesT2 = Object.values(entry.votes).filter(v => v === '2').length;
    const winnerTeam = votesT1 >= VOTE_THRESHOLD ? '1' : votesT2 >= VOTE_THRESHOLD ? '2' : null;

    await saveCurrentMatch(currentMatchData);

    if (winnerTeam) {
      await replyToMessage(message, `🗳️ **${VOTE_THRESHOLD} votos atingidos!** Registrando vitoria do **Time ${winnerTeam}** automaticamente...`);
      // Reutiliza o handler de vitória passando os args corretos
      await handleVictoryCommand(message, [winnerTeam]);
    } else {
      const total = votesT1 + votesT2;
      const bar1 = '🟦'.repeat(votesT1) + '⬜'.repeat(VOTE_THRESHOLD - votesT1);
      const bar2 = '🟥'.repeat(votesT2) + '⬜'.repeat(VOTE_THRESHOLD - votesT2);
      await replyToMessage(message,
        `🗳️ Voto registrado! Placar atual:\n` +
        `Time 1: ${bar1} (${votesT1}/${VOTE_THRESHOLD})\n` +
        `Time 2: ${bar2} (${votesT2}/${VOTE_THRESHOLD})\n` +
        `_Precisa de ${VOTE_THRESHOLD} votos para confirmar. Total: ${total} votos._`
      );
    }
  } catch (error) {
    console.error('[ERRO] !votar:', error);
    await replyToMessage(message, `❌ Erro ao votar: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleListCommand(message, args = []) {
  try {
    const queueData = await loadQueue();
    const currentVoiceChannelId = message.member?.voice?.channelId || null;
    const lobbies = Object.values(queueData?.lobbies || {});
    
    if (lobbies.length === 0) {
      return await replyToMessage(message, 'Nao ha nenhuma fila ativa no momento.');
    }

    // Tentar encontrar um lobby específico pelo seletor ou pelo canal atual
    const lobby = findLobbyBySelector(queueData, args) || (currentVoiceChannelId ? findLobbyByChannelId(queueData, currentVoiceChannelId) : null);

    if (lobby) {
      // Se encontrou um lobby específico, mostra o detalhe dele
      const embed = buildQueueEmbed(lobby);
      await sendToMessageChannel(message, { embeds: [embed] });
    } else {
      // Se não especificou e não está em um canal de lobby, mostra um resumo de todos
      const embed = buildQueueEmbed(null, lobbies);
      await sendToMessageChannel(message, { embeds: [embed] });
    }

    await updateQueueDashboard(message.guild);
  } catch (error) {
    console.error('[ERRO] !lista:', error);
    await replyToMessage(message, `❌ Erro ao listar filas: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handlePingCommand(message) {
  const latency = message.client.ws.ping >= 0 ? `${Math.round(message.client.ws.ping)} ms` : 'indisponivel';
  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('Pong 🏓')
    .setDescription('O bot esta online e operacional.')
    .addFields({ name: 'Latencia', value: latency, inline: true })
    .setTimestamp();
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleLeaderboardCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const normalizedArgs = args.map(a => String(a).toLowerCase());
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const format = mode === QUEUE_MODES.ARAM && normalizedArgs.includes('1x1') ? '1x1' : null;
  const embed = buildLeaderboardEmbed(statsData, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopTenCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();
  const normalizedArgs = args.map(a => String(a).toLowerCase());
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const format = mode === QUEUE_MODES.ARAM && normalizedArgs.includes('1x1') ? '1x1' : null;
  const embed = buildTopTenEmbed(statsData, seasonMeta, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handlePlayerCardCommand(message, targetUser = null) {
  const selectedUser = targetUser || message.mentions.users.first() || message.author;
  const statsData = await loadPlayerStats();
  const playerStats = Object.values(statsData.players || {}).find(p => p.discordId === selectedUser.id);
  if (!playerStats) return await replyToMessage(message, 'Jogador nao registrado no sistema.');
  await sendToMessageChannel(message, { embeds: [buildPlayerCardEmbed(playerStats, selectedUser)] });
}

async function handleHelpCommand(message) {
  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('📚 Guia Completo de Comandos')
    .setDescription('Aqui estao os comandos para gerenciar a Arena Caps.')
    .addFields(
      { name: '🕹️ Cadastro (1x)', value: '`!cadastrar Nick#TAG` • Vincula sua conta Riot\n`!nick Nick#TAG` • Atualiza seu nick' },
      { name: '🎮 Jogador', value: '`!entrar` • Fila Classic\n`!entrar aram` • Fila ARAM\n`!entrar aram 2x2` • ARAM formato\n`!sair` • Sai da fila\n`!votar 1/2` • Vota no vencedor\n`!perfil` • Seu MMR e Elo\n`!top10` • Ranking' },
      { name: '🛠️ Staff', value: '`!remover @u`, `!limpar [qnt]`, `!sync`, `!onboarding`' },
      { name: '⚙️ Partida (Staff)', value: '`!start [lobby]`, `!vitoria [1|2]`, `!cancelarstart`' },
      { name: '📊 Temporada', value: '`!temporadas`, `!resetgeral` (Admin)' }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Ajuda Atualizada` })
    .setTimestamp();
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleLeaveCommand(message) {
  try {
    await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const queueData = await loadQueue();
      const lobby = findLobbyByPlayer(queueData, message.author.id);
      if (!lobby) return await replyToMessage(message, 'Voce nao esta em nenhuma fila.');

      const playerIndex = lobby.players.findIndex(p => p.discordId === message.author.id);
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

      await saveQueue(queueData);
    });
    await updateQueueDashboard(message.guild);
  } catch (error) {
    console.error('[ERRO] !sair:', error);
    await replyToMessage(message, `❌ Erro ao sair da fila: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRemoveCommand(message, targetUserOverride = null) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para remover jogadores.');
    }
    const targetUser = targetUserOverride || message.mentions.users.first();
    if (!targetUser) return await replyToMessage(message, 'Mencione um jogador.');

    await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const queueData = await loadQueue();
      const lobby = findLobbyByPlayer(queueData, targetUser.id);
      if (!lobby) return await replyToMessage(message, 'Jogador nao esta na fila.');

      const playerIndex = lobby.players.findIndex(p => p.discordId === targetUser.id);
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

      await saveQueue(queueData);
    });
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleResetCommand(message) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para resetar o sistema.');
    }
    const queueData = await loadQueue();
    const currentMatchData = await loadCurrentMatch();

    for (const lobby of Object.values(queueData.lobbies || {})) {
      await deleteVoiceChannelIfExists(message.guild, lobby.waitingChannelId);
    }

    for (const entry of Object.values(currentMatchData.matches || {})) {
      const match = entry.match;
      if (match) {
        const players = [...(match.teamOne || []), ...(match.teamTwo || [])];
        await movePlayersToVoiceChannel(message.guild, players, getBaseQueueChannelIdByMode(match.mode));
        await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
            match.waitingChannelId, match.teamOneChannelId, match.teamTwoChannelId
        ]);
      }
    }

    await saveQueue({ lobbies: {} });
    await saveCurrentMatch({ matches: {} });
    await updateQueueDashboard(message.guild);
    await replyToMessage(message, '⚠️ Reset de fila e partidas concluído. Canais temporários removidos.');
  } catch (error) {
    console.error('[ERRO] !reset:', error);
    await replyToMessage(message, `❌ Erro ao resetar filas: \`${error.message}\`.`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleCleanupRoomsCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para limpar salas.');
  }
  const dynamicChannels = message.guild.channels.cache.filter(c => isManagedDynamicChannel(c));
  for (const channel of dynamicChannels.values()) await deleteVoiceChannelIfExists(message.guild, channel.id);
  await saveQueue({ lobbies: {} });
  await saveCurrentMatch({ matches: {} });
  await updateQueueDashboard(message.guild);
  await replyToMessage(message, 'Canais dinamicos e estados internos limpos.');
}

async function handleSeasonResetCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Comando restrito a administradores.');
  }
  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();
  const history = await loadSeasonHistory();
  const archivedSeason = archiveCurrentSeason(statsData, seasonMeta);
  history.seasons.push(archivedSeason);
  await saveSeasonHistory(history);
  await savePlayerStats(resetStatsForNewSeason(statsData));
  await saveQueue({ lobbies: {} });
  await saveCurrentMatch({ matches: {} });
  const nextMeta = { ...seasonMeta, currentSeason: seasonMeta.currentSeason + 1, startedAt: new Date().toISOString() };
  await saveSeasonMeta(nextMeta);
  await updateQueueDashboard(message.guild);
  await replyToMessage(message, 'Temporada resetada com sucesso.');
}

async function handleOfficialSeasonStartCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Comando restrito a administradores.');
  }
  const seasonMeta = await loadSeasonMeta();
  if (seasonMeta.phase === 'official') return await replyToMessage(message, 'Temporada oficial ja ativa.');
  await saveSeasonMeta({ ...seasonMeta, phase: 'official', officialSeasonStarted: true, currentSeason: 1 });
  await replyToMessage(message, 'Temporada Oficial #1 Iniciada!');
}

async function handleUndoSeasonResetCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Comando restrito a administradores.');
  }
  const history = await loadSeasonHistory();
  if (history.seasons.length === 0) return await replyToMessage(message, 'Nao ha nada para restaurar.');
  // Logic to restore last history entry (simplified for safety here)
  await replyToMessage(message, 'Funcao de desfazer aguardando revisao manual de dados.');
}

async function handleRestoreArchivedPeriodCommand(message, args = []) {
  await replyToMessage(message, 'Funcionalidade desabilitada por seguranca de dados.');
}

async function handleCancelStartCommand(message, args = []) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para cancelar partidas.');
    }
    const currentMatchData = await loadCurrentMatch();
    const matchEntry = findActiveMatchBySelector(currentMatchData, args) || getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
    if (!matchEntry) return await replyToMessage(message, 'Nenhuma partida ativa encontrada.');

    const [matchId, entry] = matchEntry;
    const match = entry.match;
    const restoredLobby = buildLobbyFromMatch(match);
    
    await movePlayersToVoiceChannel(message.guild, restoredLobby.players, match.waitingChannelId);
    await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
        match.teamOneChannelId, match.teamTwoChannelId
    ]);

    const queueData = await loadQueue();
    queueData.lobbies[restoredLobby.id] = restoredLobby;
    delete currentMatchData.matches[matchId];
    await saveQueue(queueData);
    await saveCurrentMatch(currentMatchData);
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleStartCommand(message, args = []) {
  try {
    const queueData = await loadQueue();
    const lobby = findLobbyBySelector(queueData, args) || findLobbyByChannelId(queueData, message.member.voice?.channelId);
    if (!lobby || lobby.players.length < lobby.requiredPlayers) return await replyToMessage(message, 'Fila incompleta ou lobby invalido.');

    const result = await withQueueOperationLock(`${message.guild.id}:start:${lobby.id}`, async () => {
      const q = await loadQueue();
      const m = await loadCurrentMatch();
      const teams = createBalancedTeams(lobby.players);
      const chs = await createTeamChannelsForLobby(message.guild, lobby);
      
      teams.mode = lobby.mode;
      teams.format = lobby.format;
      await movePlayersToTeamChannels(message.guild, teams, chs);

      m.matches[lobby.id] = {
        active: true,
        votes: {},
        match: { ...lobby, teamOne: teams.teamOne, teamTwo: teams.teamTwo, teamOneChannelId: chs.teamOneChannelId, teamTwoChannelId: chs.teamTwoChannelId, teamSize: teams.teamOne.length, createdAt: new Date().toISOString() }
      };
      delete q.lobbies[lobby.id];
      await saveQueue(q);
      await saveCurrentMatch(m);
      return { teams, chs, lobby };
    });

    await sendMatchStartAnnouncement(message.guild, result.teams);
    await updateQueueDashboard(message.guild);
    await replyToMessage(message, { embeds: [buildTeamsEmbed(result.teams, result.chs, result.lobby)] });
  } catch (error) {
    console.error('[ERRO] !start:', error);
    await replyToMessage(message, `❌ Erro ao iniciar partida: \`${error.message}\`.`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleVictoryCommand(message, args) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para declarar vitoria.');
    }
    const winningTeam = args[args.length - 1];
    if (!['1', '2'].includes(winningTeam)) return await replyToMessage(message, 'Use !vitoria 1 ou 2.');
    // Staff pode declarar vitória sem checar cargo de jogador
    const isStaff = message.member.permissions.has(PermissionFlagsBits.MoveMembers);
    if (!isStaff) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para declarar vitoria. Use `!votar 1/2` para votar.');
    }

    const currentMatchData = await loadCurrentMatch();
    const matchEntry = findActiveMatchBySelector(currentMatchData, args.slice(0, -1)) || getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
    if (!matchEntry) return await replyToMessage(message, 'Partida nao encontrada.');

    const [matchId, entry] = matchEntry;
    const match = entry.match;
    const winningPlayers = winningTeam === '1' ? match.teamOne : match.teamTwo;
    const losingPlayers = winningTeam === '1' ? match.teamTwo : match.teamOne;
    await withQueueOperationLock(`${message.guild.id}:victory:${matchId}`, async () => {
        const currentMatchData = await loadCurrentMatch();
        const matchEntryStatus = currentMatchData.matches[matchId];
        if (!matchEntryStatus) throw new Error('A partida ja foi finalizada ou nao existe mais.');

        const statsData = await loadPlayerStats();
        
        const winners = []; const losers = [];
        for(const p of winningPlayers) {
            const s = getStoredPlayerStats(statsData, p);
            const m = getModeStats(s, match.mode, match.format);
            const beforeRank = m.internalRating || 0;
            const beforeRecord = formatCustomRecord(m);
            const delta = Math.round(calculateEloDelta(beforeRank, 1200, 1, 0) * (match.mode === QUEUE_MODES.ARAM ? 0.5 : 1));
            const afterRank = beforeRank + delta;
            const updatedModes = { ...normalizePlayerModes(s), [getStatsBucketKey(match.mode, match.format)]: { ...m, customWins: (m.customWins || 0) + 1, internalRating: afterRank, winStreak: (m.winStreak || 0) + 1 } };
            upsertPlayerStats(statsData, p, { modes: updatedModes });
            winners.push({ ...p, beforeRank, afterRank, beforeRecord, afterRecord: formatCustomRecord(updatedModes[getStatsBucketKey(match.mode, match.format)]), ratingDelta: delta, winStreak: (m.winStreak || 0) + 1 });
        }
        for(const p of losingPlayers) {
            const s = getStoredPlayerStats(statsData, p);
            const m = getModeStats(s, match.mode, match.format);
            const beforeRank = m.internalRating || 0;
            const beforeRecord = formatCustomRecord(m);
            const delta = Math.round(calculateEloDelta(beforeRank, 1200, 0, 0) * (match.mode === QUEUE_MODES.ARAM ? 0.5 : 1));
            const afterRank = Math.max(0, beforeRank + delta);
            const updatedModes = { ...normalizePlayerModes(s), [getStatsBucketKey(match.mode, match.format)]: { ...m, customLosses: (m.customLosses || 0) + 1, internalRating: afterRank, winStreak: 0 } };
            upsertPlayerStats(statsData, p, { modes: updatedModes });
            losers.push({ ...p, beforeRank, afterRank, beforeRecord, afterRecord: formatCustomRecord(updatedModes[getStatsBucketKey(match.mode, match.format)]), ratingDelta: delta });
        }

        await savePlayerStats(statsData);
        delete currentMatchData.matches[matchId];
        await saveCurrentMatch(currentMatchData);

        // Export data for history log inside lock to ensure consistency
        match.winners = winners;
        match.losers = losers;
    });

    const { winners, losers } = match;
    for(const p of [...winners, ...losers]) await syncMemberRankRole(message.guild, p.discordId, p.afterRank);

    for(const p of [...winners, ...losers]) await syncMemberRankRole(message.guild, p.discordId, p.afterRank);
    const maxStreak = Math.max(...winners.map(p => p.winStreak || 0));
    const mvps = maxStreak > 0 ? winners.filter(p => (p.winStreak || 0) === maxStreak) : [];
    await clearMvpRoles(message.guild);
    for (const mvp of mvps) {
      await syncMvpRole(message.guild, mvp.discordId);
      await postMvpAnnouncement(message.guild, mvp);
    }
    
    // Mover jogadores de volta para o lobby principal antes de apagar as salas
    const baseLobbyChannelId = getBaseQueueChannelIdByMode(match.mode);
    await movePlayersToVoiceChannel(message.guild, [...winners, ...losers], baseLobbyChannelId);

    await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
        match.teamOneChannelId, match.teamTwoChannelId, match.waitingChannelId
    ]);

    await replyToMessage(message, `Vitoria registrada para a Equipe ${winningTeam}!`);
    await updateQueueDashboard(message.guild);
    await postMatchHistoryLog(message.guild, { 
        winningTeam, 
        modeLabel: match.mode, 
        formatLabel: match.format, 
        winners, 
        losers, 
        finishedAt: new Date().toISOString(),
        startedAt: match.createdAt,
        initialDifference: match.difference || 0,
        letter: match.letter || '?',
        periodLabel: getSeasonDisplayLabel(await loadSeasonMeta())
    });
  } catch (error) {
    console.error('[ERRO] !vitoria:', error);
    await replyToMessage(message, `❌ Erro ao processar resultado: \`${error.message}\`.`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleSeasonHistoryCommand(message, args = []) {
  const history = await loadSeasonHistory();
  if (args.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(THEME.INFO)
      .setTitle('📚 Histórico de Temporadas')
      .setDescription(history.seasons.length > 0 ? history.seasons.map(s => `• Periodo #${s.seasonNumber} | ${s.label}`).join('\n') : 'Nenhuma temporada arquivada ainda.')
      .setFooter({ text: `${FOOTER_PREFIX} • Historico` })
      .setTimestamp();
    await sendToMessageChannel(message, { embeds: [embed] });
  } else {
    const seasonNumber = parseInt(args[0]);
    const embed = buildSeasonHistoryEmbed(history, seasonNumber);
    await sendToMessageChannel(message, { embeds: [embed] });
  }
}

async function handleSyncAllRolesCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para sincronizar cargos.');
  }
  const statsData = await loadPlayerStats();
  const players = Object.values(statsData.players || {});
  await replyToMessage(message, `Sincronizando ${players.length} jogadores...`);
  for(const p of players) await syncMemberRankRole(message.guild, p.discordId, p.internalRating || 1200);
  await replyToMessage(message, 'Sincronizacao concluida.');
}

async function handleOnboardingCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para usar o onboarding.');
  }

  const embedGuia = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🎮 Arena Caps — Guia de Início Rápido')
    .setDescription(
      '> Bem-vindo à Arena de Personalizadas Balanceadas!\n' +
      '> Aqui seu desempenho **dentro do servidor** conta mais que seu elo na Riot.\n\n' +
      '**Siga os passos abaixo e entre em campo! 🏆**'
    )
    .addFields(
      {
        name: '⚡ PASSO 1 — Cadastre sua conta (uma única vez)',
        value:
          'Vincule seu Nick da Riot ao seu Discord:\n' +
          '```\n!cadastrar SeuNick#TAG\n```\n' +
          '✅ Após isso, você **nunca mais precisará digitar seu nick**.\n' +
          '> Se trocar de nick na Riot: `!nick NovoNick#TAG`'
      },
      {
        name: '🎯 PASSO 2 — Entre na fila',
        value:
          'Entre em um canal de voz de **Lobby** e use:\n' +
          '```\n!entrar              → Fila Classic 5x5\n!entrar aram         → Fila ARAM 5x5\n!entrar aram 2x2     → Fila ARAM 2x2\n```\n' +
          '⚡ A partida inicia **automaticamente** quando todos entram!'
      },
      {
        name: '🗳️ PASSO 3 — Vote no vencedor',
        value:
          'Ao terminar a partida, vote no time que ganhou:\n' +
          '```\n!votar 1   → Voto no Time 1\n!votar 2   → Voto no Time 2\n```\n' +
          '> **3 votos** confirmam o resultado automaticamente.\n' +
          '> Staff pode registrar com `!vitoria 1` ou `!vitoria 2` a qualquer momento.'
      },
      {
        name: '📊 Canais Importantes',
        value:
          `• <#${config.textChannels.queueStatusChannelId}> — Status das filas em tempo real\n` +
          `• <#${config.textChannels.matchOngoingChannelId}> — Partidas em andamento\n` +
          `• <#${config.textChannels.mvpAnnouncementsChannelId}> — Destaques e MVPs`
      },
      {
        name: '🕹️ Outros Comandos Úteis',
        value:
          '`!perfil` — Seu MMR e histórico\n' +
          '`!top10` — Ranking do servidor\n' +
          '`!sair` — Sair da fila\n' +
          '`!ajuda` — Lista completa de comandos'
      },
      {
        name: '⚖️ Regras e Fair Play',
        value:
          'Mantenha o respeito dentro e fora das partidas.\n' +
          'Atitudes tóxicas resultam em **banimento do sistema de elo**.\n' +
          '*Bom jogo e que vença o melhor! 🛡️*'
      }
    )
    .setThumbnail(message.guild.iconURL({ dynamic: true }))
    .setFooter({ text: `${FOOTER_PREFIX} • Guia Atualizado` })
    .setTimestamp();

  await sendToMessageChannel(message, { embeds: [embedGuia] });
  if (message.deletable) await message.delete().catch(() => null);
}

async function handleClearCommand(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para limpar mensagens.');
  }
  const amount = parseInt(args[0]) || 10;
  await (message.channel || message).bulkDelete(Math.min(amount + 1, 100), true);
}

module.exports = {
  handleEnterCommand, handleListCommand, handlePingCommand, handleLeaderboardCommand, handleTopTenCommand,
  handleSeasonHistoryCommand, handlePlayerCardCommand, handleHelpCommand, handleLeaveCommand, handleRemoveCommand,
  handleResetCommand, handleCleanupRoomsCommand, handleSeasonResetCommand, handleOfficialSeasonStartCommand,
  handleUndoSeasonResetCommand, handleRestoreArchivedPeriodCommand, handleCancelStartCommand, handleStartCommand,
  handleSyncAllRolesCommand, handleVictoryCommand, handleOnboardingCommand, handleClearCommand,
  handleRegisterCommand, handleNickUpdateCommand, handleVoteCommand, pendingAutoStarts
};
