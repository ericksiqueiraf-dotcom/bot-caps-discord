const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const { parseModeAndFormatArgs, shouldMirrorAramGroupedStats } = require('../domain/queue/selection');
const { enterQueue } = require('../application/use-cases/enterQueue');
const { startMatch } = require('../application/use-cases/startMatch');
const { registerVictory } = require('../application/use-cases/registerVictory');
const { resetSystem } = require('../application/use-cases/resetSystem');
const { cancelActiveMatch } = require('../application/use-cases/cancelActiveMatch');
const { castVictoryVote } = require('../application/use-cases/castVictoryVote');
const { handleStartCommandFlow, handleVoteCommandFlow } = require('./handlers/matchCommandHandlers');
const { handleEnterCommandFlow } = require('./handlers/queueCommandHandlers');
const { handleVictoryCommandFlow } = require('./handlers/victoryCommandHandlers');

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
  findLobbyBySelector, buildLeaderboardEmbed, buildTopTenEmbed, buildTopStreakEmbed,
  getRankedPlayersByMode, archiveCurrentSeason, resetStatsForNewSeason, 
  buildLobbyFromMatch, upsertPlayerStats, normalizePlayerModes, 
  movePlayersToTeamChannels, sendMatchStartAnnouncement, syncMvpRole, clearMvpRoles,
  postMvpAnnouncement, postMatchHistoryLog, buildPlayerCardEmbed, 
  buildSeasonHistoryEmbed, formatCustomRecord,
  postPlayerLogs, postMatchSummaryToSeasonLog, postSeasonSummaryToSeasonLog
} = require('../utils/lobbyUtils');

const { 
  QUEUE_MODES, loadQueue, saveQueue, loadPlayerStats, 
  savePlayerStats, loadCurrentMatch, saveCurrentMatch, 
  loadSeasonMeta, saveSeasonMeta, loadSeasonHistory, 
  saveSeasonHistory, loadSystemMeta, saveSystemMeta,
  loadContentTemplates,
  withQueueOperationLock 
} = require('../services/dataService');
const { getResolvedContentTemplates } = require('../services/contentTextService');

const { 
  calculateSeedRating, calculateHybridMmr, calculateEloDelta, 
  createBalancedTeams 
} = require('../services/balanceService');

const getRiotService = () => global.riotService;

/**
 * Atribui o cargo definido em config.roles.registeredPlayerRoleId apos !cadastrar / !nick.
 */
async function grantRegisteredPlayerRole(guild, userId) {
  const roleId = config.roles?.registeredPlayerRoleId;
  if (!roleId || typeof roleId !== 'string' || !roleId.trim()) {
    return { ok: false, reason: 'not_configured' };
  }
  const trimmed = roleId.trim();
  try {
    const role = await guild.roles.fetch(trimmed).catch(() => null);
    if (!role) {
      console.warn('[CADASTRO] Cargo registeredPlayerRoleId nao encontrado:', trimmed);
      return { ok: false, reason: 'role_missing' };
    }
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { ok: false, reason: 'member_missing' };
    if (member.roles.cache.has(trimmed)) return { ok: true, alreadyHad: true };
    await member.roles.add(role, 'Vinculacao Riot (!cadastrar)');
    return { ok: true };
  } catch (err) {
    console.error('[CADASTRO] Falha ao adicionar cargo de cadastrado:', err.message);
    return { ok: false, reason: 'discord_error' };
  }
}

// Armazena timeouts de auto-start pendentes: { [lobbyId]: timeoutId }
const pendingAutoStarts = new Map();
const VOTE_THRESHOLD = 3; // Fase de testes: 3 votos decidem
const RECENT_VICTORY_WINDOW_MS = 2 * 60 * 1000;

function createEnterQueueDeps() {
  return {
    loadPlayerStats,
    loadQueue,
    saveQueue,
    savePlayerStats,
    withQueueOperationLock,
    findLobbyByPlayer,
    getStoredPlayerStats,
    getModeStats,
    getOpenLobby,
    findReusableWaitingLobby,
    getNextLobbyLetter,
    createLobbyChannels,
    getRequiredPlayersByModeAndFormat,
    normalizePlayerModes,
    getStatsBucketKey,
    upsertPlayerStats,
    calculateHybridMmr,
    calculateSeedRating
  };
}

function createStartMatchDeps() {
  return {
    withQueueOperationLock,
    loadQueue,
    loadCurrentMatch,
    saveQueue,
    saveCurrentMatch,
    createBalancedTeams,
    createTeamChannelsForLobby,
    movePlayersToTeamChannels
  };
}

function createRegisterVictoryDeps() {
  return {
    QUEUE_MODES,
    withQueueOperationLock,
    loadCurrentMatch,
    loadPlayerStats,
    savePlayerStats,
    saveCurrentMatch,
    getStoredPlayerStats,
    getModeStats,
    normalizePlayerModes,
    getStatsBucketKey,
    upsertPlayerStats,
    shouldMirrorAramGroupedStats,
    calculateEloDelta,
    getAramWeightByTeamSize,
    formatCustomRecord
  };
}

function createResetSystemDeps() {
  return {
    loadQueue,
    loadCurrentMatch,
    deleteVoiceChannelIfExists,
    movePlayersToVoiceChannel,
    getBaseQueueChannelIdByMode,
    deleteManagedChannelsForLobby,
    saveQueue,
    saveCurrentMatch
  };
}

function createCancelActiveMatchDeps() {
  return {
    buildLobbyFromMatch,
    movePlayersToVoiceChannel,
    deleteManagedChannelsForLobby,
    loadQueue,
    saveQueue,
    saveCurrentMatch
  };
}

function createCastVictoryVoteDeps() {
  return {
    saveCurrentMatch
  };
}

function getRecentVictoryForGuild(systemMeta, guildId) {
  const recentVictory = systemMeta?.recentVictory;

  if (!recentVictory || recentVictory.guildId !== guildId || !recentVictory.finishedAt) {
    return null;
  }

  const finishedAtMs = new Date(recentVictory.finishedAt).getTime();
  if (Number.isNaN(finishedAtMs)) {
    return null;
  }

  return Date.now() - finishedAtMs <= RECENT_VICTORY_WINDOW_MS ? recentVictory : null;
}

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
    const useCaseResult = await startMatch({
      guild,
      guildId: guild.id,
      lobby,
      deps: createStartMatchDeps()
    });
    if (!useCaseResult) return;
    await sendMatchStartAnnouncement(guild, useCaseResult.teams);
    await updateQueueDashboard(guild);
  } catch (err) {
    console.error('[AUTO-START INTERNAL] Erro:', err);
  }
}

async function handleEnterCommand(message, args) {
  try {
    await handleEnterCommandFlow({
      message,
      args,
      deps: {
        QUEUE_MODES,
        getFormatFromArgs,
        getNicknameArgs,
        isMemberInQueueVoiceChannel,
        enterQueue,
        createEnterQueueDeps,
        replyToMessage,
        updateQueueDashboard,
        triggerAutoStart,
        pendingAutoStarts
      }
    });
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
    const gate = await grantRegisteredPlayerRole(message.guild, message.author.id);
    const rankStr = rankProfile.isFallbackUnranked ? 'Unranked (base Gold IV)' : `${rankProfile.tier} ${rankProfile.rank} — ${rankProfile.leaguePoints} PDL`;
    let accessLine = '';
    if (gate.ok && !gate.alreadyHad) {
      accessLine = '\n**Salas liberadas.** Voce ja pode ver os canais de texto e voz do servidor.';
    } else if (gate.ok && gate.alreadyHad) {
      accessLine = '';
    } else if (gate.reason !== 'not_configured') {
      accessLine = '\n_Nao foi possivel atribuir o cargo automaticamente. Staff: confira o ID em config, permissoes Manage Roles e hierarquia dos cargos._';
    }
    await replyToMessage(message,
      `✅ Conta vinculada com sucesso!\n` +
      `🎮 **${rankProfile.nickname}** · ${rankStr}\n` +
      `Agora e so usar \`!entrar\` para entrar na fila rapidinho! 🚀` +
      accessLine
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
    const gate = await grantRegisteredPlayerRole(message.guild, message.author.id);
    const rankStr = rankProfile.isFallbackUnranked ? 'Unranked (base Gold IV)' : `${rankProfile.tier} ${rankProfile.rank} — ${rankProfile.leaguePoints} PDL`;
    let accessLine = '';
    if (gate.ok && !gate.alreadyHad) {
      accessLine = '\n**Salas liberadas.** Voce ja pode ver os canais de texto e voz do servidor.';
    } else if (gate.reason !== 'not_configured') {
      accessLine = '\n_Nao foi possivel atribuir o cargo automaticamente. Confira config e permissoes do bot._';
    }
    await replyToMessage(message,
      `✅ Nick atualizado!\n` +
      `🎮 **${rankProfile.nickname}** · ${rankStr}` +
      accessLine
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
    await handleVoteCommandFlow({
      message,
      args,
      deps: {
        VOTE_THRESHOLD,
        loadCurrentMatch,
        castVictoryVote,
        createCastVictoryVoteDeps,
        replyToMessage,
        handleVictoryCommand
      }
    });
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
    .setTitle('Pong')
    .setDescription('O bot esta online e operacional.')
    .addFields({ name: 'Latencia', value: latency, inline: true })
    .setTimestamp();
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleLeaderboardCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const { mode, format } = parseModeAndFormatArgs(args);
  const embed = buildLeaderboardEmbed(statsData, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopTenCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();
  const { mode, format } = parseModeAndFormatArgs(args);
  const embed = buildTopTenEmbed(statsData, seasonMeta, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopStreakCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const { mode, format } = parseModeAndFormatArgs(args);
  const embed = buildTopStreakEmbed(statsData, mode, format);
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
      { name: '🎮 Jogador', value: '`!entrar` • Fila Classic\n`!entrar aram` • Fila ARAM\n`!entrar aram 2x2` • ARAM formato\n`!sair` • Sai da fila\n`!votar 1/2` • Vota no vencedor\n`!perfil` • Seu MMR e Elo\n`!top10` • Ranking MMR\n`!topstreak` • Ranking Streak 🔥' },
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
    await resetSystem({
      guild: message.guild,
      deps: createResetSystemDeps()
    });
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
  await postSeasonSummaryToSeasonLog(message.guild, archivedSeason);
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

    await cancelActiveMatch({
      guild: message.guild,
      currentMatchData,
      matchEntry,
      deps: createCancelActiveMatchDeps()
    });
    await updateQueueDashboard(message.guild);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleStartCommand(message, args = []) {
  try {
    await handleStartCommandFlow({
      message,
      args,
      deps: {
        loadQueue,
        findLobbyBySelector,
        findLobbyByChannelId,
        startMatch,
        createStartMatchDeps,
        pendingAutoStarts,
        sendMatchStartAnnouncement,
        updateQueueDashboard,
        buildTeamsEmbed,
        replyToMessage,
        config
      }
    });
  } catch (error) {
    console.error('[ERRO] !start:', error);
    await replyToMessage(message, `❌ Erro ao iniciar partida: \`${error.message}\`.`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleVictoryCommand(message, args) {
  try {
    await handleVictoryCommandFlow({
      message,
      args,
      deps: {
        QUEUE_MODES,
        loadCurrentMatch,
        findActiveMatchBySelector,
        getActiveMatchEntry,
        loadSystemMeta,
        getRecentVictoryForGuild,
        formatQueueMode,
        replyToMessage,
        registerVictory,
        createRegisterVictoryDeps,
        syncMemberRankRole,
        clearMvpRoles,
        syncMvpRole,
        postMvpAnnouncement,
        getBaseQueueChannelIdByMode,
        movePlayersToVoiceChannel,
        deleteManagedChannelsForLobby,
        updateQueueDashboard,
        saveSystemMeta,
        postMatchHistoryLog,
        getSeasonDisplayLabel,
        loadSeasonMeta,
        loadPlayerStats,
        postPlayerLogs,
        postMatchSummaryToSeasonLog
      }
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

  const storedTemplates = await loadContentTemplates();
  const onboardingContent = getResolvedContentTemplates(storedTemplates).onboarding;
  const importantChannels = [
    config.textChannels.queueStatusChannelId ? `• <#${config.textChannels.queueStatusChannelId}> — Status das filas` : null,
    config.textChannels.matchOngoingChannelId ? `• <#${config.textChannels.matchOngoingChannelId}> — Auto-start, salas e partidas em andamento` : null,
    config.textChannels.matchHistoryChannelId ? `• <#${config.textChannels.matchHistoryChannelId}> — Histórico das partidas finalizadas` : null,
    config.textChannels.playerLogChannelId ? `• <#${config.textChannels.playerLogChannelId}> — Log individual de MMR e streak` : null,
    config.textChannels.seasonLogChannelId ? `• <#${config.textChannels.seasonLogChannelId}> — Resumos de partidas e temporadas` : null,
    config.textChannels.mvpAnnouncementsChannelId ? `• <#${config.textChannels.mvpAnnouncementsChannelId}> — MVPs e destaques` : null
  ].filter(Boolean).join('\n');

  const embedGuia = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🎮 Arena Caps — Guia de Início Rápido')
    .setDescription(
      'Partidas personalizadas com fila persistente, times balanceados por MMR interno e histórico completo de resultados.\n\n' +
      '**Fluxo rápido: cadastrar, entrar na call, jogar, votar e acompanhar sua evolução.**'
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
          '```\n!entrar              → Classic 5x5\n!entrar aram         → ARAM 5x5\n!entrar aram 1x1     → ARAM 1x1\n!entrar aram 2x2     → ARAM 2x2\n```\n' +
          '⚡ Quando a sala completa, o bot anuncia, cria os times e move a galera automaticamente.'
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
        name: '📈 Acompanhe sua evolução',
        value:
          '`!perfil` — Seu card com MMR e histórico\n' +
          '`!placar` — Ranking geral por modo\n' +
          '`!top10` — Top 10 por MMR\n' +
          '`!topstreak` — Maiores sequências de vitória ativas\n' +
          '`!temporadas` — Períodos arquivados'
      },
      {
        name: '📊 Canais Importantes',
        value: importantChannels || 'Configure os canais de texto no `config.json` para exibir os logs do sistema.'
      },
      { name: '🕹️ Outros Comandos Úteis',
        value:
          '`!lista` — Mostra filas e lobbies ativos\n' +
          '`!sair` — Sair da fila\n' +
          '`!cancelarstart` — Cancela auto-start de lobby cheio\n' +
          '`!start` / `!vitoria` — Controle manual da staff\n' +
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
  handleTopStreakCommand, handleSeasonHistoryCommand, handlePlayerCardCommand, handleHelpCommand, handleLeaveCommand, handleRemoveCommand,
  handleResetCommand, handleCleanupRoomsCommand, handleSeasonResetCommand, handleOfficialSeasonStartCommand,
  handleUndoSeasonResetCommand, handleRestoreArchivedPeriodCommand, handleCancelStartCommand, handleStartCommand,
  handleSyncAllRolesCommand, handleVictoryCommand, handleOnboardingCommand, handleClearCommand,
  handleRegisterCommand, handleNickUpdateCommand, handleVoteCommand, pendingAutoStarts
};
