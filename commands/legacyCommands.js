const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const utils = require('../utils/lobbyUtils');
const db = require('../services/dataService');
const balance = require('../services/balanceService');
const config = require('../config.json');

const QUEUE_MODES = db.QUEUE_MODES;

// Re-map internal usages of client/riotService
const getRiotService = () => global.riotService;

// Attach all utility functions to the module scope
Object.assign(global, utils);
Object.assign(global, db);
Object.assign(global, balance);

async function handleEnterCommand(message, args) {
  const selectedMode = args[0]?.toLowerCase() === QUEUE_MODES.ARAM ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const selectedFormat = getFormatFromArgs(selectedMode, args);
  const nickname = getNicknameArgs(selectedMode, args, selectedFormat).join(' ').trim();

  if (!nickname) {
    await replyToMessage(message, 'Use `!entrar Nome#TAG` ou `!entrar aram 1x1 Nome#TAG`.');
    return;
  }

  if (!isMemberInQueueVoiceChannel(message.member, selectedMode)) {
    const expectedChannelName = selectedMode === QUEUE_MODES.ARAM ? 'Lista de espera - ARAM' : 'Lista de espera - CLASSIC';
    await replyToMessage(message, `Voce precisa estar no canal de voz \`${expectedChannelName}\` para entrar nessa fila.`);
    return;
  }

  try {
    const rankProfile = await global.riotService.getPlayerRankProfile(nickname);
    const result = await withQueueOperationLock(`${message.guild.id}:${selectedMode}:${selectedFormat}`, async () => {
      const queueData = loadQueue();
      const playerStats = loadPlayerStats();
      const alreadyInQueue = findLobbyByPlayer(queueData, message.author.id);

      if (alreadyInQueue) return { alreadyInQueue };

      const storedStats = getStoredPlayerStats(playerStats, { discordId: message.author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid });
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

      upsertPlayerStats(playerStats, {
        discordId: message.author.id,
        nickname: rankProfile.nickname,
        puuid: rankProfile.puuid,
        modes: {
          ...normalizePlayerModes(storedStats),
          [getStatsBucketKey(selectedMode, selectedFormat)]: {
            ...getModeStats(storedStats, selectedMode, selectedFormat),
            baseMmr: rankProfile.mmr,
            internalRating: Number(getModeStats(storedStats, selectedMode, selectedFormat).internalRating || 0) || calculateSeedRating(rankProfile.mmr)
          }
        }
      });

      saveQueue(queueData);
      savePlayerStats(playerStats);
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
  } catch (error) {
    await replyToMessage(message, `Erro ao entrar na fila: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleListCommand(message, args = []) {
  try {
    const queueData = loadQueue();
    const currentVoiceChannelId = message.member?.voice?.channelId || null;
    const lobbies = Object.values(queueData?.lobbies || {});
    const lobby = findLobbyBySelector(queueData, args) || (currentVoiceChannelId ? findLobbyByChannelId(queueData, currentVoiceChannelId) : null);

    await updateQueueDashboard(message.guild);
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
  const statsData = loadPlayerStats();
  const normalizedArgs = args.map(a => String(a).toLowerCase());
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const format = mode === QUEUE_MODES.ARAM && normalizedArgs.includes('1x1') ? '1x1' : null;
  const embed = buildLeaderboardEmbed(statsData, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopTenCommand(message, args = []) {
  const statsData = loadPlayerStats();
  const seasonMeta = loadSeasonMeta();
  const normalizedArgs = args.map(a => String(a).toLowerCase());
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const format = mode === QUEUE_MODES.ARAM && normalizedArgs.includes('1x1') ? '1x1' : null;
  const embed = buildTopTenEmbed(statsData, seasonMeta, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handlePlayerCardCommand(message, targetUser = null) {
  const selectedUser = targetUser || message.mentions.users.first() || message.author;
  const statsData = loadPlayerStats();
  const playerStats = Object.values(statsData.players || {}).find(p => p.discordId === selectedUser.id);
  if (!playerStats) return await replyToMessage(message, 'Jogador nao registrado no sistema.');
  await sendToMessageChannel(message, { embeds: [buildPlayerCardEmbed(playerStats, selectedUser)] });
}

async function handleHelpCommand(message) {
  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('📚 Guia de Comandos')
    .setDescription('Lista de comandos principais para membros e staff.')
    .addFields(
      { name: '🕹️ Jogador', value: '`!entrar [nick]`, `!sair`, `!perfil`, `!top10`' },
      { name: '🛠️ Staff', value: '`!remover @u`, `!limpar [qnt]`, `!sync`, `!onboarding`' },
      { name: '⚙️ Partida', value: '`!start [lobby]`, `!vitoria [1|2]`, `!cancelarstart`' }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Ajuda` })
    .setTimestamp();
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleLeaveCommand(message) {
  try {
    const queueData = loadQueue();
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

    saveQueue(queueData);
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRemoveCommand(message, targetUserOverride = null) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const targetUser = targetUserOverride || message.mentions.users.first();
    if (!targetUser) return await replyToMessage(message, 'Mencione um jogador.');

    const queueData = loadQueue();
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

    saveQueue(queueData);
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleResetCommand(message) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const queueData = loadQueue();
    const currentMatchData = loadCurrentMatch();

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

    saveQueue({ lobbies: {} });
    saveCurrentMatch({ matches: {} });
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleCleanupRoomsCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  const dynamicChannels = message.guild.channels.cache.filter(c => isManagedDynamicChannel(c));
  for (const channel of dynamicChannels.values()) await deleteVoiceChannelIfExists(message.guild, channel.id);
  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });
  await updateQueueDashboard(message.guild);
  await replyToMessage(message, 'Canais dinamicos e estados internos limpos.');
}

async function handleSeasonResetCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const statsData = loadPlayerStats();
  const seasonMeta = loadSeasonMeta();
  archiveCurrentSeason(statsData, seasonMeta);
  savePlayerStats(resetStatsForNewSeason(statsData));
  saveQueue({ lobbies: {} });
  saveCurrentMatch({ matches: {} });
  const nextMeta = { ...seasonMeta, currentSeason: seasonMeta.currentSeason + 1, startedAt: new Date().toISOString() };
  saveSeasonMeta(nextMeta);
  await updateQueueDashboard(message.guild);
  await replyToMessage(message, 'Temporada resetada com sucesso.');
}

async function handleOfficialSeasonStartCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const seasonMeta = loadSeasonMeta();
  if (seasonMeta.phase === 'official') return await replyToMessage(message, 'Temporada oficial ja ativa.');
  saveSeasonMeta({ ...seasonMeta, phase: 'official', officialSeasonStarted: true, currentSeason: 1 });
  await replyToMessage(message, 'Temporada Oficial #1 Iniciada!');
}

async function handleUndoSeasonResetCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const history = loadSeasonHistory();
  if (history.seasons.length === 0) return await replyToMessage(message, 'Nao ha nada para restaurar.');
  // Logic to restore last history entry (simplified for safety here)
  await replyToMessage(message, 'Funcao de desfazer aguardando revisao manual de dados.');
}

async function handleRestoreArchivedPeriodCommand(message, args = []) {
  await replyToMessage(message, 'Funcionalidade desabilitada por seguranca de dados.');
}

async function handleCancelStartCommand(message, args = []) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const currentMatchData = loadCurrentMatch();
    const matchEntry = findActiveMatchBySelector(currentMatchData, args) || getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
    if (!matchEntry) return await replyToMessage(message, 'Nenhuma partida ativa encontrada.');

    const [matchId, entry] = matchEntry;
    const match = entry.match;
    const restoredLobby = buildLobbyFromMatch(match);
    
    await movePlayersToVoiceChannel(message.guild, restoredLobby.players, match.waitingChannelId);
    await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
        match.teamOneChannelId, match.teamTwoChannelId
    ]);

    const queueData = loadQueue();
    queueData.lobbies[restoredLobby.id] = restoredLobby;
    delete currentMatchData.matches[matchId];
    saveQueue(queueData);
    saveCurrentMatch(currentMatchData);
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleStartCommand(message, args = []) {
  try {
    const queueData = loadQueue();
    const lobby = findLobbyBySelector(queueData, args) || findLobbyByChannelId(queueData, message.member.voice?.channelId);
    if (!lobby || lobby.players.length < lobby.requiredPlayers) return await replyToMessage(message, 'Fila incompleta ou lobby invalido.');

    const result = await withQueueOperationLock(`${message.guild.id}:start:${lobby.id}`, async () => {
      const q = loadQueue();
      const m = loadCurrentMatch();
      const teams = createBalancedTeams(lobby.players);
      const chs = await createTeamChannelsForLobby(message.guild, lobby);
      
      teams.mode = lobby.mode;
      teams.format = lobby.format;
      await movePlayersToTeamChannels(message.guild, teams, chs);

      m.matches[lobby.id] = { active: true, match: { ...lobby, teamOne: teams.teamOne, teamTwo: teams.teamTwo, teamOneChannelId: chs.teamOneChannelId, teamTwoChannelId: chs.teamTwoChannelId, teamSize: teams.teamOne.length, createdAt: new Date().toISOString() } };
      delete q.lobbies[lobby.id];
      saveQueue(q);
      saveCurrentMatch(m);
      return { teams };
    });

    await sendMatchStartAnnouncement(message.guild, result.teams);
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleVictoryCommand(message, args) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) return;
    const winningTeam = args[args.length - 1];
    if (!['1', '2'].includes(winningTeam)) return await replyToMessage(message, 'Use !vitoria 1 ou 2.');

    const currentMatchData = loadCurrentMatch();
    const matchEntry = findActiveMatchBySelector(currentMatchData, args.slice(0, -1)) || getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
    if (!matchEntry) return await replyToMessage(message, 'Partida nao encontrada.');

    const [matchId, entry] = matchEntry;
    const match = entry.match;
    const winningPlayers = winningTeam === '1' ? match.teamOne : match.teamTwo;
    const losingPlayers = winningTeam === '1' ? match.teamTwo : match.teamOne;
    const statsData = loadPlayerStats();
    
    // Logic for MMR calculation and update (Re-implemented for security)
    const winners = []; const losers = [];
    for(const p of winningPlayers) {
        const s = getStoredPlayerStats(statsData, p);
        const m = getModeStats(s, match.mode, match.format);
        const delta = Math.round(calculateEloDelta(m.internalRating, 1200, 1, 0) * (match.mode === QUEUE_MODES.ARAM ? 0.5 : 1));
        upsertPlayerStats(statsData, p, { modes: { ...normalizePlayerModes(s), [getStatsBucketKey(match.mode, match.format)]: { ...m, customWins: (m.customWins || 0) + 1, internalRating: (m.internalRating || 0) + delta, winStreak: (m.winStreak || 0) + 1 } } });
        winners.push({ ...p, afterRank: (m.internalRating || 0) + delta, ratingDelta: delta, winStreak: (m.winStreak || 0) + 1 });
    }
    for(const p of losingPlayers) {
        const s = getStoredPlayerStats(statsData, p);
        const m = getModeStats(s, match.mode, match.format);
        const delta = Math.round(calculateEloDelta(m.internalRating, 1200, 0, 0) * (match.mode === QUEUE_MODES.ARAM ? 0.5 : 1));
        upsertPlayerStats(statsData, p, { modes: { ...normalizePlayerModes(s), [getStatsBucketKey(match.mode, match.format)]: { ...m, customLosses: (m.customLosses || 0) + 1, internalRating: Math.max(0, (m.internalRating || 0) + delta), winStreak: 0 } } });
        losers.push({ ...p, afterRank: Math.max(0, (m.internalRating || 0) + delta), ratingDelta: delta });
    }

    savePlayerStats(statsData);
    delete currentMatchData.matches[matchId];
    saveCurrentMatch(currentMatchData);

    for(const p of [...winners, ...losers]) await syncMemberRankRole(message.guild, p.discordId, p.afterRank);
    const mvp = winners.reduce((a, b) => a.winStreak > b.winStreak ? a : b, winners[0]);
    if(mvp) { await syncMvpRole(message.guild, mvp.discordId); await postMvpAnnouncement(message.guild, mvp); }

    await replyToMessage(message, `Vitoria registrada para a Equipe ${winningTeam}!`);
    await updateQueueDashboard(message.guild);
    await postMatchHistoryLog(message.guild, { winningTeam, modeLabel: match.mode, formatLabel: match.format, winners, losers, finishedAt: new Date().toISOString() });
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleSyncAllRolesCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const statsData = loadPlayerStats();
  const players = Object.values(statsData.players || {});
  await replyToMessage(message, `Sincronizando ${players.length} jogadores...`);
  for(const p of players) await syncMemberRankRole(message.guild, p.discordId, p.internalRating || 1200);
  await replyToMessage(message, 'Sincronizacao concluida.');
}

async function handleOnboardingCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const embed = new EmbedBuilder().setColor(THEME.INFO).setTitle('🏠 Bem-vindo ao Caps Bot!').setDescription('Use `!entrar` para jogar.').setTimestamp();
  await sendToMessageChannel(message, { embeds: [embed] });
  if (message.deletable) await message.delete().catch(() => null);
}

async function handleClearCommand(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  const amount = parseInt(args[0]) || 10;
  await (message.channel || message).bulkDelete(Math.min(amount + 1, 100), true);
}

module.exports = {
  handleEnterCommand, handleListCommand, handlePingCommand, handleLeaderboardCommand, handleTopTenCommand,
  handleSeasonHistoryCommand, handlePlayerCardCommand, handleHelpCommand, handleLeaveCommand, handleRemoveCommand,
  handleResetCommand, handleCleanupRoomsCommand, handleSeasonResetCommand, handleOfficialSeasonStartCommand,
  handleUndoSeasonResetCommand, handleRestoreArchivedPeriodCommand, handleCancelStartCommand, handleStartCommand,
  handleSyncAllRolesCommand, handleVictoryCommand, handleOnboardingCommand, handleClearCommand
};
