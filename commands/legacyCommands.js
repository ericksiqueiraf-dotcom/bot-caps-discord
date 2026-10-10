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
const votePanel = require('./handlers/resultVotePanel');

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
  getBaseQueueChannelIdByMode, getPostMatchVoiceChannelId, findLobbyByChannelId, getActiveMatchEntry, 
  findActiveMatchBySelector, getSaoPauloDateParts, getSeasonDisplayLabel, 
  formatDateTimeForHistory, getArchivedSeasonLabel, splitEmbedFieldChunks,
  THEME, FOOTER_PREFIX, createLobbyChannels, createTeamChannelsForLobby, 
  findLobbyBySelector, buildLeaderboardEmbed, buildTopTenEmbed, buildTopStreakEmbed,
  getRankedPlayersByMode, archiveCurrentSeason, resetStatsForNewSeason, 
  buildLobbyFromMatch, upsertPlayerStats, normalizePlayerModes, 
  movePlayersToTeamChannels, sendMatchStartAnnouncement, syncMvpRole, clearMvpRoles,
  syncInfernalRolesAfterMatch, hasInfernalPriority, reconcileInfernalRoles, postInfernalAnnouncement, postRouletteAnnouncement, buildRulesEmbed, buildStaffEmbed, startMvpVote,
  postMvpAnnouncement, postMatchHistoryLog, buildPlayerCardEmbed,
  buildSeasonHistoryEmbed, formatCustomRecord,
  postPlayerLogs, postMatchSummaryToSeasonLog, postSeasonSummaryToSeasonLog, postSmurfAlerts,
  getCustomPointsDelta, getCustomDisplayScore, buildTopInfernalEmbed
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
  createBalancedTeams, applyLeagueMmrChange, migrateInternalRating
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
let bulkEloSyncRunning = false;
const BULK_ELO_SYNC_DELAY_MS = 2500;
// Calcula o threshold de votos baseado no tamanho do time da partida
function getVoteThreshold(teamSize) {
  const size = Number(teamSize || 5);
  if (size <= 1) return 1;  // 1x1: 1 voto decide
  if (size <= 2) return 2;  // 2x2: 2 votos
  if (size <= 3) return 3;  // 3x3: 3 votos
  if (size <= 4) return 3;  // 4x4: 3 votos
  return 6;                  // 5x5 Classic: maioria dos 10
}
const RECENT_VICTORY_WINDOW_MS = 2 * 60 * 1000;

function syncBaseMmrAcrossModes(playerStats, baseMmr) {
  return Object.fromEntries(
    Object.entries(normalizePlayerModes(playerStats)).map(([modeKey, modeStats]) => [
      modeKey,
      applyLeagueMmrChange(modeStats, baseMmr)
    ])
  );
}

function createEnterQueueDeps() {
  return {
    loadPlayerStats,
    loadQueue,
    loadCurrentMatch,
    loadSystemMeta,
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
    calculateSeedRating,
    applyLeagueMmrChange,
    isTierSEligibleByStats: require('../utils/lobbyUtils').isTierSEligibleByStats,
    isTierSEligibleMember: require('../utils/lobbyUtils').isTierSEligibleMember,
    getLobbyTier: require('../utils/lobbyUtils').getLobbyTier
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
    calculateHybridMmr,
    migrateInternalRating,
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

// Deps do painel de votação de resultado (botões Time 1 / Time 2).
// Centraliza aqui para texto (!votar) e botão usarem o mesmo canal/lock.
function createVotePanelDeps() {
  const panelDeps = {
    loadCurrentMatch,
    saveCurrentMatch,
    withQueueOperationLock,
    castVictoryVote,
    createCastVictoryVoteDeps,
    getVoteThreshold,
    resolveChannel: async (guild) => {
      const channelId = config.textChannels?.matchOngoingChannelId;
      if (!channelId) return null;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      return channel?.isTextBased() ? channel : null;
    },
    postOrUpdate: (args) => votePanel.postOrUpdateResultVotePanel({ ...args, deps: panelDeps }),
    close: (args) => votePanel.closeResultVotePanel({ ...args, deps: panelDeps }),
    // Maioria atingida via botão: registra a vitória sem exigir staff.
    onThresholdReached: async ({ guild, matchId, match, winnerTeam, voterMember }) => {
      const panelChannelId = config.textChannels?.matchOngoingChannelId;
      const channel = panelChannelId ? await guild.channels.fetch(panelChannelId).catch(() => null) : null;
      const shimMessage = {
        _isAutoVote: true,
        guild,
        member: voterMember,
        author: voterMember?.user || { id: voterMember?.id || 'unknown', tag: 'votacao-botao' },
        channelId: panelChannelId,
        channel,
        client: guild.client,
        deletable: false
      };
      shimMessage.reply = async (payload) => {
        if (channel?.isTextBased()) return channel.send(payload).catch(() => null);
        return null;
      };
      await handleVictoryCommand(shimMessage, [String(winnerTeam), String(match?.letter || '')].filter(Boolean));
    }
  };
  return panelDeps;
}

// Clique nos botões do painel de resultado (votewin:<matchId>:<time>).
async function handleResultVoteButton(interaction) {
  try {
    await votePanel.handleResultVoteButton(interaction, createVotePanelDeps());
  } catch (error) {
    console.error('[ERRO] voto por botao:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Não consegui registrar seu voto agora.', ephemeral: true }).catch(() => null);
    }
  }
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

function findRecentVictoryByLetter(systemMeta, guildId, letter) {
  const normalizedLetter = String(letter || '').trim().toUpperCase();
  if (!normalizedLetter) return null;

  const entries = Array.isArray(systemMeta?.recentVictories) ? systemMeta.recentVictories : [];
  for (const entry of entries) {
    if (!entry || entry.guildId !== guildId || !entry.finishedAt) continue;
    if (String(entry.letter || '').toUpperCase() !== normalizedLetter) continue;
    const finishedAtMs = new Date(entry.finishedAt).getTime();
    if (Number.isNaN(finishedAtMs)) continue;
    if (Date.now() - finishedAtMs <= RECENT_VICTORY_WINDOW_MS) return entry;
  }
  return null;
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
        isMemberInTierSVoiceChannel: require('../utils/lobbyUtils').isMemberInTierSVoiceChannel,
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
      modes: syncBaseMmrAcrossModes(previousEntry || storedStats, rankProfile.mmr)
    });
    await savePlayerStats(playerStats);
    const gate = await grantRegisteredPlayerRole(message.guild, message.author.id);
    await syncMemberRankRole(message.guild, message.author.id, rankProfile.mmr);
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
      modes: syncBaseMmrAcrossModes(storedStats, rankProfile.mmr)
    });
    await savePlayerStats(playerStats);
    const gate = await grantRegisteredPlayerRole(message.guild, message.author.id);
    await syncMemberRankRole(message.guild, message.author.id, rankProfile.mmr);
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

async function handleSyncPlayerRankCommand(message, targetUserOverride = null) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para sincronizar o elo de jogadores.');
    }

    const targetUser = targetUserOverride || message.mentions.users.first();
    if (!targetUser) {
      return await replyToMessage(message, '❌ Mencione o jogador. Ex.: `!sincronizarelo @jogador`');
    }

    const playerStats = await loadPlayerStats();
    const storedEntry = Object.values(playerStats.players || {}).find((player) => player.discordId === targetUser.id);
    if (!storedEntry?.registeredNickname && !storedEntry?.nickname) {
      return await replyToMessage(message, '❌ Esse jogador nao possui uma conta Riot cadastrada.');
    }

    if (storedEntry.puuid && global.riotService.invalidateCache) {
      global.riotService.invalidateCache(storedEntry.puuid);
    }

    const rankProfile = await global.riotService.getPlayerRankProfile(storedEntry.registeredNickname || storedEntry.nickname);
    upsertPlayerStats(playerStats, {
      discordId: targetUser.id,
      nickname: rankProfile.nickname,
      puuid: rankProfile.puuid
    }, {
      registeredNickname: rankProfile.nickname,
      registeredAt: new Date().toISOString(),
      tier: rankProfile.tier,
      rank: rankProfile.rank,
      leaguePoints: rankProfile.leaguePoints,
      baseMmr: rankProfile.mmr,
      puuid: rankProfile.puuid,
      summonerId: rankProfile.summonerId,
      isFallbackUnranked: Boolean(rankProfile.isFallbackUnranked),
      modes: syncBaseMmrAcrossModes(storedEntry, rankProfile.mmr)
    });
    await savePlayerStats(playerStats);
    const roleSync = await syncMemberRankRole(message.guild, targetUser.id, rankProfile.mmr);

    const rankLabel = rankProfile.isFallbackUnranked
      ? 'Unranked (base Gold IV)'
      : `${rankProfile.tier} ${rankProfile.rank} - ${rankProfile.leaguePoints} PDL`;

    let roleLine = '';
    if (roleSync?.ok) {
      roleLine = `\nCargo atualizado: **${roleSync.roleName}**.`;
    } else if (roleSync?.reason === 'hierarchy') {
      roleLine = `\n⚠️ Elo salvo, mas o cargo **${roleSync.roleName}** nao foi aplicado: o cargo do bot precisa ficar **acima** dos cargos de elo.`;
    } else if (roleSync?.reason === 'role_not_found') {
      roleLine = `\n⚠️ Elo salvo, mas nao achei o cargo de **${roleSync.rankTier}** no servidor.`;
    } else if (roleSync?.reason === 'member_not_found') {
      roleLine = '\n⚠️ Elo salvo, mas o jogador nao esta no servidor.';
    } else if (roleSync?.reason === 'discord_error') {
      roleLine = `\n⚠️ Elo salvo, mas o Discord recusou o cargo: ${roleSync.error}`;
    } else {
      roleLine = '\n⚠️ Elo salvo, mas o cargo nao foi alterado.';
    }

    await replyToMessage(message, `✅ Elo de ${targetUser} sincronizado: **${rankLabel}**.${roleLine}`);
  } catch (error) {
    console.error('[ERRO] !sincronizarelo:', error);
    await replyToMessage(message, `❌ Erro ao sincronizar elo: ${error.message}`);
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
        getVoteThreshold,
        withQueueOperationLock,
        loadCurrentMatch,
        castVictoryVote,
        createCastVictoryVoteDeps,
        replyToMessage,
        handleVictoryCommand,
        votePanel: createVotePanelDeps()
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

async function handleWaitingListCommand(message, args = [], options = {}) {
  try {
    const action = String(args[0] || '').toLowerCase();
    const isViewOnly = ['ver', 'listar', 'lista'].includes(action);
    const isLeaving = ['sair', 'remover'].includes(action);
    const queueArgs = isViewOnly || isLeaving ? args.slice(1) : args;
    const { mode, format, tierSOnly: parsedTierS } = parseModeAndFormatArgs(queueArgs);
    const tierSOnly = Boolean(options.forceTierS || parsedTierS);
    const listKey = tierSOnly && mode === QUEUE_MODES.CLASSIC ? 'classic:5x5:s' : `${mode}:${format || '5x5'}`;
    const modeLabel = mode === QUEUE_MODES.ARAM ? `ARAM ${format || '5x5'}` : (tierSOnly ? 'CLASSIC TIER S' : 'CLASSIC 5x5');
    let players = [];
    let response = null;

    await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const queueData = await loadQueue();
      queueData.waitingLists ||= {};
      const currentList = Array.isArray(queueData.waitingLists[listKey])
        ? queueData.waitingLists[listKey]
        : [];
      const playerIndex = currentList.findIndex((player) => player.discordId === message.author.id);
      const otherWaitingList = Object.entries(queueData.waitingLists).find(
        ([key, players]) => key !== listKey && Array.isArray(players) && players.some((player) => player.discordId === message.author.id)
      );

      if (isLeaving) {
        // !espera sair / !esperatiers sair: sai da lista atual ou de qualquer outra onde esteja
        if (playerIndex !== -1) {
          currentList.splice(playerIndex, 1);
          if (currentList.length === 0) {
            delete queueData.waitingLists[listKey];
          } else {
            queueData.waitingLists[listKey] = currentList;
          }
          await saveQueue(queueData);
          response = 'Voce saiu da fila de espera.';
          players = currentList;
          return;
        }
        if (otherWaitingList) {
          const [otherKey, otherPlayers] = otherWaitingList;
          const idx = otherPlayers.findIndex((player) => player.discordId === message.author.id);
          if (idx !== -1) {
            otherPlayers.splice(idx, 1);
            if (otherPlayers.length === 0) {
              delete queueData.waitingLists[otherKey];
            } else {
              queueData.waitingLists[otherKey] = otherPlayers;
            }
            await saveQueue(queueData);
            response = 'Voce saiu da fila de espera.';
            players = [];
            return;
          }
        }
        response = 'Voce nao esta na fila de espera.';
        players = currentList;
        return;
      }

      if (!isViewOnly && playerIndex === -1) {
        if (otherWaitingList) {
          response = 'Voce ja esta aguardando em outra fila. Use `!espera sair` ou `!esperatiers sair` antes de entrar em uma fila diferente.';
          players = currentList;
          return;
        }

        const playerStats = await loadPlayerStats();
        const registeredPlayer = Object.values(playerStats.players || {}).find(
          (player) => player.discordId === message.author.id
        );

        if (!registeredPlayer) {
          response = 'Voce precisa se cadastrar com `!cadastrar Nick#TAG` antes de entrar na fila de espera.';
          players = currentList;
          return;
        }

        // Gate TIER S na espera: so Esmeralda IV+ (elo ou cargo)
        if (tierSOnly) {
          const { isTierSEligibleMember } = require('../utils/lobbyUtils');
          if (!isTierSEligibleMember(message.member, registeredPlayer)) {
            response = '⛔ `!esperatiers` exige elo **Esmeralda IV ou superior** (ou cargo Esmeralda+). Use o `!espera` normal.';
            players = currentList;
            return;
          }
        }

        const isInfernal = await hasInfernalPriority(message.guild, message.author.id, playerStats).catch(() => false);
        const newEntry = {
          discordId: message.author.id,
          discordUsername: message.author.username,
          nickname: registeredPlayer.registeredNickname || registeredPlayer.nickname || message.author.username,
          joinedAt: new Date().toISOString(),
          isInfernalBoost: Boolean(isInfernal)
        };
        // INFERNAL fura para a posicao 5 (empurra 5o -> 6o). Lista curta (<5): append normal.
        if (isInfernal && currentList.length >= 5) {
          currentList.splice(4, 0, newEntry);
        } else {
          currentList.push(newEntry);
        }
        queueData.waitingLists[listKey] = currentList;
        await saveQueue(queueData);
      }

      players = currentList;
      const position = currentList.findIndex((player) => player.discordId === message.author.id) + 1;
      if (!isViewOnly && position > 0) {
        response = playerIndex === -1
          ? `Voce entrou na fila de espera na posicao **${position}**.`
          : `Voce ja esta na fila de espera, na posicao **${position}**.`;
      }
    });

    if (response) {
      await replyToMessage(message, response);
    }

    if (players.length === 0) {
      if (!response) {
        await replyToMessage(message, 'Nao ha jogadores aguardando nessa fila no momento.');
      }
      return;
    }

    const orderedPlayers = [...players];
    const entries = orderedPlayers.map(
      (player, index) => `**${index + 1}.** <@${player.discordId}> - \`${player.nickname}\`${player.isInfernalBoost ? ' 🔥' : ''}`
    );
    const embed = new EmbedBuilder()
      .setColor(THEME.INFO)
      .setTitle(`Fila de Espera - ${modeLabel}`)
      .setDescription('Ordem de prioridade para a proxima partida.')
      .setFooter({ text: `${FOOTER_PREFIX} • Fila de Espera` })
      .setTimestamp();

    splitEmbedFieldChunks(entries).forEach((chunk, index) => {
      embed.addFields({
        name: index === 0 ? 'Jogadores aguardando' : 'Jogadores aguardando (continua)',
        value: chunk
      });
    });

    await sendToMessageChannel(message, { embeds: [embed] });
  } catch (error) {
    console.error('[ERRO] !espera:', error);
    await replyToMessage(message, `Erro ao mostrar a ordem da fila: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleTierSWaitingListCommand(message, args = []) {
  return handleWaitingListCommand(message, args, { forceTierS: true });
}

function hasCaptainRole(member) {
  const captainRoleId = config.roles?.captainRoleId;
  return Boolean(captainRoleId && member?.roles?.cache?.has(captainRoleId));
}

async function handleClearWaitingListsCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages) && !hasCaptainRole(message.member)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para limpar filas de espera.');
  }

  let clearedLists = 0;
  let clearedPlayers = 0;

  await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
    const queueData = await loadQueue();
    const waitingLists = queueData.waitingLists || {};

    for (const players of Object.values(waitingLists)) {
      if (!Array.isArray(players)) continue;
      clearedLists += 1;
      clearedPlayers += players.length;
    }

    queueData.waitingLists = {};
    await saveQueue(queueData);
  });

  await updateQueueDashboard(message.guild);
  await replyToMessage(
    message,
    `✅ Filas de espera limpas: ${clearedPlayers} jogador(es) removido(s) de ${clearedLists} fila(s).`
  );
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
  const { mode, format, tierSOnly } = parseModeAndFormatArgs(args);
  const embed = buildLeaderboardEmbed(statsData, mode, format, { tierSOnly });
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopTenCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();
  const { mode, format, tierSOnly } = parseModeAndFormatArgs(args);
  const embed = buildTopTenEmbed(statsData, seasonMeta, mode, format, { tierSOnly });
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopStreakCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const { mode, format } = parseModeAndFormatArgs(args);
  const embed = buildTopStreakEmbed(statsData, mode, format);
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopInfernalCommand(message) {
  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();
  const embed = buildTopInfernalEmbed(statsData, seasonMeta);
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
  try {
    const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('📚 Guia Completo de Comandos')
    .setDescription('Aqui estao os comandos para gerenciar a CAPS Arena.')
    .addFields(
      { name: '🕹️ Cadastro (1x)', value: '`!cadastrar Nick#TAG` • Vincula sua conta Riot\n`!nick Nick#TAG` • Atualiza seu nick' },
      { name: '🎮 Jogador (1/2) — Fila e voto', value: '`!regras` • Regulamento completo\n`!entrar` • Fila Classic (no canal Lobby Classic ou Lobby TIER S)\n`!entrar aram` • Fila ARAM\n`!entrar aram 2x2` • ARAM formato\n`!fila` • Mostra jogadores em sala\n`!espera` • Entra na espera (🔥 INFERNAL entra na posição 5)\n`!esperatiers` • Espera do Lobby TIER S (só Esmeralda+)\n`!espera ver` • Mostra a ordem\n`!espera sair` • Sai da espera\n`!sair` • Sai da sala\n`!votar 1/2` • Vota no vencedor (abre painel com botões p/ os 10 votarem)\n`!votar` • Reabre o painel de votação' },
      { name: '🎮 Jogador (2/2) — Ranking', value: '`!roleta N A` • Sorteia na hora quem sai da sala A (N = 1–5)\n`!roletasair A` • Fica fora da próxima (sem sorteio nem subida)\n`!perfil` • Seus Pontos Custom (base 1000) e Elo LoL\n`!placar` • Ranking geral (CLASSIC = pontos custom)\n`!placar tiers` • Só Esmeralda+\n`!top10` • Top 10 CLASSIC por pontos custom, desempate por winrate\n`!top10 tiers` • Top 10 só Esmeralda+\n`!topstreak` • Ranking Streak 🔥\n`!toprankinfernal` • Quem mais pegou INFERNAL na temporada 🔥\n🗳️ Após a partida, vote no MVP no canal de destaques • 🔥 5 wins seguidas = cargo INFERNAL (prioridade na espera + proteção na roleta)' },
      { name: '🛠️ Staff', value: '`!staff` • Guia completo da staff\n`!pdl @u -50 motivo` • Ajuste/punição de PDL Classic (só Admin)\n`!remover @u`, `!limpar [qnt]`, `!limparsalas [sala]` • Limpa sala A/B/C (sem letra = todas)\n`!sincronizarelo @u`, `!sincronizartodos` (ou `!sync todos`), `!sync`, `!onboarding`' },
      { name: '⚙️ Partida (Staff)', value: '`!start [sala]`, `!vitoria [1|2] [sala]`, `!cancelarstart [sala]`\n`!rematch [sala]` • Volta os 10 pra fila, rebalanceia e inicia na hora' },
      { name: '📊 Temporada', value: '`!temporadas`, `!resetgeral` (Admin)' }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Ajuda Atualizada` })
    .setTimestamp();
  const sent = await sendToMessageChannel(message, { embeds: [embed] });
    if (!sent) {
      await replyToMessage(message, '📚 Comandos: `!cadastrar Nick#TAG` • `!entrar` • `!entrar aram` • `!fila` • `!espera` • `!sair` • `!votar 1/2` • `!perfil` • `!placar` • `!top10` • `!topstreak` • `!staff` • `!start` • `!vitoria` • `!temporadas`');
    }
  } catch (error) {
    console.error('[ERRO] !ajuda:', error);
    await replyToMessage(message, '❌ Erro ao mostrar ajuda. Tente de novo ou use `/ajuda`.').catch(() => null);
  }
}

async function handleLeaveCommand(message) {
  try {
    let leftWaitingList = false;
    await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const queueData = await loadQueue();
      const lobby = findLobbyByPlayer(queueData, message.author.id);
      queueData.waitingLists ||= {};

      for (const [listKey, players] of Object.entries(queueData.waitingLists)) {
        if (!Array.isArray(players)) continue;
        const playerIndex = players.findIndex((player) => player.discordId === message.author.id);
        if (playerIndex === -1) continue;

        players.splice(playerIndex, 1);
        if (players.length === 0) {
          delete queueData.waitingLists[listKey];
        }
        leftWaitingList = true;
      }

      if (!lobby) {
        if (!leftWaitingList) return await replyToMessage(message, 'Voce nao esta em nenhuma fila.');
        await saveQueue(queueData);
        return;
      }

      const playerIndex = lobby.players.findIndex(p => p.discordId === message.author.id);
      const [removedPlayer] = lobby.players.splice(playerIndex, 1);

      if (message.member.voice?.channelId === lobby.waitingChannelId) {
        const baseQueueChannelId = getBaseQueueChannelIdByMode(lobby.mode, require('../utils/lobbyUtils').getLobbyTier(lobby));
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
    if (leftWaitingList) {
      await replyToMessage(message, 'Voce saiu da fila de espera.');
    }
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

    // Anti-roleta INFERNAL: staff com ManageMessages pode tirar, Admin sempre pode.
    // Sem permissao de Admin, a remocao de INFERNAL e recusada para proteger a prioridade.
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      const statsForCheck = await loadPlayerStats();
      const protectedInfernal = await hasInfernalPriority(message.guild, targetUser.id, statsForCheck).catch(() => false);
      if (protectedInfernal) {
        return await replyToMessage(message, '🔥 Jogador com cargo INFERNAL está protegido da roleta. Apenas um Admin pode removê-lo.');
      }
    }

    await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const queueData = await loadQueue();
      const lobby = findLobbyByPlayer(queueData, targetUser.id);
      if (!lobby) return await replyToMessage(message, 'Jogador nao esta na fila.');

      const playerIndex = lobby.players.findIndex(p => p.discordId === targetUser.id);
      const [removedPlayer] = lobby.players.splice(playerIndex, 1);

      const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
      if (targetMember?.voice?.channelId === lobby.waitingChannelId) {
        const baseQueueChannelId = getBaseQueueChannelIdByMode(lobby.mode, require('../utils/lobbyUtils').getLobbyTier(lobby));
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

// Decide os alvos da limpeza por letra (puro, testavel).
// Retorna { status: 'active_match' | 'not_found' | 'targets', ... }.
function resolveCleanupTargets(queueData, currentMatchData, args = [], options = {}) {
  const normalizedArgs = args.map((arg) => String(arg || '').trim().toLowerCase());
  const selectedMode = normalizedArgs.find((arg) => [QUEUE_MODES.CLASSIC, QUEUE_MODES.ARAM].includes(arg)) || null;
  let selectedLetter = normalizedArgs.find((arg) => /^[a-z]+$/i.test(arg) && arg !== selectedMode)?.toUpperCase() || null;

  // !limparsala (singular) sem letra entende-se como sala A
  if (!selectedLetter && options.defaultLetter) {
    selectedLetter = String(options.defaultLetter).toUpperCase();
  }

  if (!selectedLetter) {
    return { status: 'clean_all', selectedMode, selectedLetter: null };
  }

  const matchingLobbies = Object.values(queueData.lobbies || {}).filter(
    (lobby) => lobby.letter === selectedLetter && (!selectedMode || lobby.mode === selectedMode)
  );
  const activeMatch = Object.values(currentMatchData.matches || {}).find(
    (entry) => entry.active && entry.match?.letter === selectedLetter && (!selectedMode || entry.match.mode === selectedMode)
  );

  if (activeMatch) {
    return { status: 'active_match', selectedMode, selectedLetter };
  }

  if (matchingLobbies.length === 0) {
    return { status: 'not_found', selectedMode, selectedLetter };
  }

  return { status: 'targets', selectedMode, selectedLetter, matchingLobbies };
}

async function handleCleanupRoomsCommand(message, args = [], options = {}) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages) && !hasCaptainRole(message.member)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para limpar salas.');
  }

  const queueData = await loadQueue();
  const currentMatchData = await loadCurrentMatch();
  const resolution = resolveCleanupTargets(queueData, currentMatchData, args, options);

  if (resolution.status === 'active_match') {
    return await replyToMessage(
      message,
      `❌ A sala ${resolution.selectedLetter} possui uma partida ativa. Finalize ou cancele a partida antes de limpar a sala.`
    );
  }

  if (resolution.status === 'not_found') {
    return await replyToMessage(message, `❌ Nenhuma sala ${resolution.selectedLetter} aguardando jogadores foi encontrada.`);
  }

  if (resolution.status === 'targets') {
    const { selectedLetter, matchingLobbies } = resolution;

    const result = await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const freshQueue = await loadQueue();
      // Revalida dentro do lock (a fila pode ter mudado entre a leitura e a escrita)
      const freshTargets = matchingLobbies
        .map((lobby) => freshQueue.lobbies[lobby.id])
        .filter(Boolean);

      let removedChannels = 0;
      for (const lobby of freshTargets) {
        if (pendingAutoStarts.has(lobby.id)) {
          clearTimeout(pendingAutoStarts.get(lobby.id));
          pendingAutoStarts.delete(lobby.id);
        }

        // Move os ocupantes para a Sala de Espera (Tier S tem sala propria) antes de apagar os canais
        const occupants = lobby.players || [];
        if (occupants.length > 0) {
          await movePlayersToVoiceChannel(message.guild, occupants, getPostMatchVoiceChannelId(lobby.mode, lobby));
        }

        removedChannels += await deleteManagedChannelsForLobby(
          message.guild,
          lobby.mode,
          lobby.format,
          lobby.letter,
          [lobby.waitingChannelId, lobby.teamOneChannelId, lobby.teamTwoChannelId]
        );
        delete freshQueue.lobbies[lobby.id];
      }

      await saveQueue(freshQueue);
      return { count: freshTargets.length, removedChannels };
    });

    await updateQueueDashboard(message.guild);
    return await replyToMessage(
      message,
      `✅ Sala ${selectedLetter} limpa: ${result.count} fila(s) e ${result.removedChannels} canal(is) removido(s). Jogadores movidos para a Sala de Espera.`
    );
  }

  const dynamicChannels = message.guild.channels.cache.filter(c => isManagedDynamicChannel(c));
  for (const channel of dynamicChannels.values()) await deleteVoiceChannelIfExists(message.guild, channel.id);
  await saveQueue({ lobbies: {}, waitingLists: {} });
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
  await saveQueue({ lobbies: {}, waitingLists: {} });
  await saveCurrentMatch({ matches: {} });
  const isTesting = seasonMeta.phase === 'testing';
  const nextMeta = {
    ...seasonMeta,
    currentSeason: isTesting ? seasonMeta.currentSeason : seasonMeta.currentSeason + 1,
    testingCycle: isTesting ? (seasonMeta.testingCycle || 1) + 1 : seasonMeta.testingCycle,
    startedAt: new Date().toISOString()
  };
  await saveSeasonMeta(nextMeta);
  await updateQueueDashboard(message.guild);
  await replyToMessage(message, `Temporada resetada com sucesso. Iniciando ${getSeasonDisplayLabel(nextMeta)}.`);
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

// Acha lobby com contagem de auto-start pendente, filtrado pelos args (ex: ['B']).
// Sem args, so resolve se houver UM unico pendente (evita cancelar a sala errada).
function findPendingAutoStartLobby(queueData, pendingMap, args = []) {
  const pendingLobbies = Object.values(queueData.lobbies || {}).filter((lobby) => pendingMap.has(lobby.id));
  if (pendingLobbies.length === 0) return null;
  if (!args || args.length === 0) return pendingLobbies.length === 1 ? pendingLobbies[0] : null;

  const pseudoQueue = { lobbies: Object.fromEntries(pendingLobbies.map((lobby) => [lobby.id, lobby])) };
  return findLobbyBySelector(pseudoQueue, args);
}

async function handleCancelStartCommand(message, args = []) {
  try {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return await replyToMessage(message, '❌ Voce nao tem permissao para cancelar partidas.');
    }

    // 1) Cancela a contagem de auto-start (sala cheia ainda nao iniciada). Jogadores ficam na fila.
    const queueData = await loadQueue();
    const pendingLobby = findPendingAutoStartLobby(queueData, pendingAutoStarts, args);
    if (pendingLobby) {
      clearTimeout(pendingAutoStarts.get(pendingLobby.id));
      pendingAutoStarts.delete(pendingLobby.id);
      await updateQueueDashboard(message.guild);
      return await replyToMessage(message, `✅ Auto-start da sala **${pendingLobby.letter}** cancelado. Os jogadores continuam na fila.`);
    }

    // 2) Sem contagem pendente: cancela a partida ativa (comportamento anterior)
    const currentMatchData = await loadCurrentMatch();
    const matchEntry = findActiveMatchBySelector(currentMatchData, args) || getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
    if (!matchEntry) {
      return await replyToMessage(message, 'Nenhuma partida ativa ou auto-start pendente encontrado. Use `!cancelarstart A` informando a letra da sala.');
    }

    // Segurança: limpa timer residual do mesmo lobby, se houver
    if (pendingAutoStarts.has(matchEntry[0])) {
      clearTimeout(pendingAutoStarts.get(matchEntry[0]));
      pendingAutoStarts.delete(matchEntry[0]);
    }

    await cancelActiveMatch({
      guild: message.guild,
      currentMatchData,
      matchEntry,
      deps: createCancelActiveMatchDeps()
    });
    await updateQueueDashboard(message.guild);
    await replyToMessage(message, `✅ Partida da sala **${matchEntry[1]?.match?.letter || '?'}** cancelada e devolvida para a fila.`);
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
        syncInfernalRolesAfterMatch,
        postInfernalAnnouncement,
        startMvpVote,
        getPostMatchVoiceChannelId,
        movePlayersToVoiceChannel,
        deleteManagedChannelsForLobby,
        updateQueueDashboard,
        saveSystemMeta,
        postMatchHistoryLog,
        getSeasonDisplayLabel,
        loadSeasonMeta,
        loadPlayerStats,
        postPlayerLogs,
        postMatchSummaryToSeasonLog,
        postSmurfAlerts,
        closeResultVotePanel: votePanel.closeResultVotePanel,
        votePanelSaveDeps: { loadCurrentMatch, saveCurrentMatch }
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

async function handleSyncAllRolesCommand(message, args = []) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Voce nao tem permissao para sincronizar cargos.');
  }
  if (String(args[0] || '').toLowerCase() === 'infernal') {
    await expireInfernalRolesIfDueSafe(message.guild);
    const { removedOrphans } = await reconcileInfernalRoles(message.guild);
    return await replyToMessage(message, `🔥 INFERNAL reconciliado: ${removedOrphans} cargo(s) órfão(s) removido(s).`);
  }
  const statsData = await loadPlayerStats();
  const players = Object.values(statsData.players || {});
  await replyToMessage(message, `Sincronizando cargos de ${players.length} jogadores (elo ja cadastrado)...`);
  for(const p of players) await syncMemberRankRole(message.guild, p.discordId, p.baseMmr || 1200);
  await replyToMessage(message, 'Sincronizacao de cargos concluida.');
}

async function expireInfernalRolesIfDueSafe(guild) {
  const { expireInfernalRolesIfDue } = require('../utils/lobbyUtils');
  await expireInfernalRolesIfDue(guild);
}

function collectUniqueRegisteredPlayers(statsData) {
  const byDiscordId = new Map();

  for (const player of Object.values(statsData.players || {})) {
    if (!player?.discordId || (!player.registeredNickname && !player.nickname)) {
      continue;
    }

    const previous = byDiscordId.get(player.discordId);
    if (!previous || new Date(player.registeredAt || 0) > new Date(previous.registeredAt || 0)) {
      byDiscordId.set(player.discordId, player);
    }
  }

  return [...byDiscordId.values()];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleSyncAllPlayersEloCommand(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return await replyToMessage(message, '❌ Comando restrito a administradores.');
  }

  if (bulkEloSyncRunning) {
    return await replyToMessage(message, '⚠️ Ja existe uma sincronizacao em massa em andamento. Aguarde terminar.');
  }

  bulkEloSyncRunning = true;

  try {
    const statsData = await loadPlayerStats();
    const players = collectUniqueRegisteredPlayers(statsData);

    if (players.length === 0) {
      return await replyToMessage(message, 'Nenhum jogador cadastrado para atualizar.');
    }

    const estimatedMinutes = Math.max(1, Math.ceil((players.length * BULK_ELO_SYNC_DELAY_MS) / 60000));
    await replyToMessage(
      message,
      `Atualizando elo da Riot e cargos de **${players.length}** jogadores.\nIsso leva cerca de **${estimatedMinutes} min** para nao estourar o limite da API.`
    );

    let updated = 0;
    let roleWarnings = 0;
    let failed = 0;

    for (const [index, storedEntry] of players.entries()) {
      try {
        if (storedEntry.puuid && global.riotService.invalidateCache) {
          global.riotService.invalidateCache(storedEntry.puuid);
        }

        const rankProfile = await global.riotService.getPlayerRankProfile(storedEntry.registeredNickname || storedEntry.nickname);
        const freshStats = await loadPlayerStats();
        const currentEntry = getStoredPlayerStats(freshStats, {
          discordId: storedEntry.discordId,
          nickname: rankProfile.nickname,
          puuid: rankProfile.puuid
        });

        upsertPlayerStats(freshStats, {
          discordId: storedEntry.discordId,
          nickname: rankProfile.nickname,
          puuid: rankProfile.puuid
        }, {
          registeredNickname: rankProfile.nickname,
          registeredAt: currentEntry.registeredAt || storedEntry.registeredAt || new Date().toISOString(),
          tier: rankProfile.tier,
          rank: rankProfile.rank,
          leaguePoints: rankProfile.leaguePoints,
          baseMmr: rankProfile.mmr,
          puuid: rankProfile.puuid,
          summonerId: rankProfile.summonerId,
          isFallbackUnranked: Boolean(rankProfile.isFallbackUnranked),
          modes: syncBaseMmrAcrossModes(currentEntry || storedEntry, rankProfile.mmr)
        });
        await savePlayerStats(freshStats);

        const roleSync = await syncMemberRankRole(message.guild, storedEntry.discordId, rankProfile.mmr);
        updated += 1;
        if (!roleSync?.ok) {
          roleWarnings += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(`[SYNC TODOS] Falha em ${storedEntry.registeredNickname}:`, error.message);
      }

      if (index < players.length - 1) {
        await sleep(BULK_ELO_SYNC_DELAY_MS);
      }
    }

    await replyToMessage(
      message,
      `✅ Sincronizacao em massa concluida.\nAtualizados: **${updated}**\nFalha na Riot: **${failed}**\nCargo com aviso: **${roleWarnings}**`
    );
  } catch (error) {
    console.error('[ERRO] !sincronizartodos:', error);
    await replyToMessage(message, `❌ Erro na sincronizacao em massa: \`${error.message}\`.`);
  } finally {
    bulkEloSyncRunning = false;
  }
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
    .setTitle('🎮 CAPS Arena — Guia de Início Rápido')
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
          '> **6 votos (maioria no 5x5)** confirmam o resultado automaticamente.\n' +
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

async function handlePdlCommand(message, args = [], targetUserOverride = null) {
  try {
    const adminOnly = message.member?.permissions?.has('Administrator');
    if (!adminOnly) {
      return await replyToMessage(message, '❌ Apenas administradores podem ajustar PDL.');
    }

    const targetUser = targetUserOverride || message.mentions?.users?.first?.() || null;
    if (!targetUser) {
      return await replyToMessage(message, 'Uso: `!pdl @jogador -50 motivo` (valor de -500 a +500, Classic).');
    }
    const numeric = args.map((a) => Number(a)).find((n) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= 500);
    if (numeric == null) {
      return await replyToMessage(message, 'Informe o valor. Ex: `!pdl @jogador -50 rage quit`.');
    }
    const reason = args
      .filter((a) => !/^<@!?\d+>$/.test(String(a)) && Number(a) !== numeric)
      .join(' ')
      .trim() || 'Decisão da staff';

    const { adjustPdl } = require('../application/use-cases/adjustPdl');
    const { calculateSeedRating } = require('../services/balanceService');
    const result = await adjustPdl({
      guildId: message.guild.id,
      discordId: targetUser.id,
      delta: numeric,
      deps: {
        withQueueOperationLock,
        loadPlayerStats,
        savePlayerStats,
        getStoredPlayerStats,
        getModeStats,
        normalizePlayerModes,
        getStatsBucketKey,
        upsertPlayerStats,
        calculateSeedRating
      }
    });

    const sign = result.applied >= 0 ? '+' : '';
    const embed = new EmbedBuilder()
      .setColor(result.applied >= 0 ? THEME.SUCCESS : THEME.ERROR)
      .setTitle(`⚖️ Ajuste de PDL — ${result.nickname || 'jogador'}`)
      .setDescription(`<@${result.discordId}>: \`${result.before}\` → \`${result.after}\` (**${sign}${result.applied}** PDL Classic)`)
      .addFields(
        { name: 'Motivo', value: reason.slice(0, 1024) },
        { name: 'Aplicado por', value: `<@${message.author.id}>` }
      )
      .setFooter({ text: `${FOOTER_PREFIX} • Punição/ajuste` })
      .setTimestamp();
    await sendToMessageChannel(message, { embeds: [embed] });

    // Auditoria no log da temporada
    const seasonLogId = config.textChannels?.seasonLogChannelId;
    const seasonLog = seasonLogId ? await message.guild.channels.fetch(seasonLogId).catch(() => null) : null;
    if (seasonLog?.isTextBased()) {
      await seasonLog.send({ embeds: [embed] }).catch(() => null);
    }
  } catch (error) {
    console.error('[ERRO] !pdl:', error);
    await replyToMessage(message, `❌ ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleStatsCommand(message) {
  try {
    const targetUser = message.mentions.users.first() || message.author;
    const statsData = await loadPlayerStats();
    const playerStats = Object.values(statsData.players || {}).find((p) => p.discordId === targetUser.id);

    if (!playerStats) {
      return await replyToMessage(message, 'Jogador não registrado. Use `!cadastrar SeuNick#TAG` antes de entrar no ranking.');
    }

    const modes = normalizePlayerModes(playerStats);
    const fields = Object.entries(modes)
      .filter(([key]) => key === 'classic' || key.startsWith('aram'))
      .map(([key, stats]) => {
        const totalGames = (stats.customWins || 0) + (stats.customLosses || 0);
        const winRate = totalGames ? ((stats.customWins / totalGames) * 100).toFixed(1) : '0.0';
        const modeLabel = key === 'classic' ? 'Classic' : key.toUpperCase().replace('ARAM', 'ARAM ');
        return {
          name: `${modeLabel} • ${stats.customWins || 0}W / ${stats.customLosses || 0}L`,
          value: `${totalGames} jogos • ${winRate}% WR • LoL ${stats.baseMmr || 0} pts • Custom ${getCustomDisplayScore(stats)}`,
          inline: false
        };
      });

    const embed = new EmbedBuilder()
      .setColor(THEME.INFO)
      .setTitle(`📊 Estatísticas de ${targetUser.username}`)
      .setDescription(`Recorde por modo para ${targetUser.username || targetUser.toString()}.`)
      .addFields(fields)
      .setFooter({ text: `${FOOTER_PREFIX} • Ranking Insights` })
      .setTimestamp();

    await sendToMessageChannel(message, { embeds: [embed] });
  } catch (error) {
    console.error('[ERRO] !stats:', error);
    await replyToMessage(message, `❌ Erro ao buscar estatísticas: ${error.message}`);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRematchCommand(message, args = []) {
  try {
    const hasStaffPermission = message.member?.permissions?.has('ManageMessages') || message.member?.permissions?.has('Administrator');
    if (!hasStaffPermission) {
      await replyToMessage(message, '❌ Apenas staff pode usar o comando rematch.');
      return;
    }

    const letterArg = String(args.find((arg) => /^[a-z]+$/i.test(String(arg || ''))) || '').toUpperCase() || null;

    const systemMeta = await loadSystemMeta();
    const recentVictory = letterArg
      ? findRecentVictoryByLetter(systemMeta, message.guild.id, letterArg)
      : getRecentVictoryForGuild(systemMeta, message.guild.id);
    if (!recentVictory) {
      await replyToMessage(message, letterArg
        ? `❌ Nenhuma partida da sala **${letterArg}** finalizada recentemente. (Expira em 2 minutos)`
        : '❌ Nenhuma partida finalizada recentemente encontrada no servidor. (Expira em 2 minutos)');
      return;
    }

    const allPlayers = [...(recentVictory.teamOne || []), ...(recentVictory.teamTwo || [])];
    if (allPlayers.length === 0) {
      await replyToMessage(message, '❌ Nao foi possivel identificar os jogadores da ultima partida.');
      return;
    }

    const mode = recentVictory.mode || 'classic';
    const format = recentVictory.format;

    const result = await withQueueOperationLock(`${message.guild.id}:global:queue`, async () => {
      const queueData = await loadQueue();
      const currentMatchData = await loadCurrentMatch();
      const playerStats = await loadPlayerStats();

      let lobby = getOpenLobby(queueData, mode, format);
      if (!lobby) {
        const letter = getNextLobbyLetter(queueData, currentMatchData, mode, format);
        const createdLobby = await createLobbyChannels(message.guild, mode, format, letter);
        lobby = {
          id: `${mode}-${format}-${letter.toLowerCase()}`,
          mode,
          format,
          letter,
          waitingChannelId: createdLobby.waitingChannelId,
          parentId: createdLobby.parentId,
          requiredPlayers: getRequiredPlayersByModeAndFormat(mode, format),
          players: [],
          status: 'waiting'
        };
        queueData.lobbies[lobby.id] = lobby;
      }

      let added = 0;
      for (const player of allPlayers) {
        if (!player?.discordId || lobby.players.find(p => p.discordId === player.discordId)) {
          continue;
        }

        // Recupera os dados completos para a proxima partida balancear certo
        const stored = getStoredPlayerStats(playerStats, { discordId: player.discordId, nickname: player.nickname });
        const modeStats = getModeStats(stored, mode, format);
        const leagueMmr = Number(stored.baseMmr || modeStats.baseMmr || 1200);
        lobby.players.push({
          discordId: player.discordId,
          discordUsername: stored.discordUsername || player.nickname,
          nickname: stored.registeredNickname || stored.nickname || player.nickname,
          tier: stored.tier || 'GOLD',
          rank: stored.rank || 'IV',
          leaguePoints: stored.leaguePoints || 0,
          isFallbackUnranked: Boolean(stored.isFallbackUnranked),
          baseMmr: leagueMmr,
          customWins: modeStats.customWins || 0,
          customLosses: modeStats.customLosses || 0,
          mmr: calculateHybridMmr(leagueMmr, modeStats.customWins, modeStats.customLosses, modeStats.internalRating),
          internalRating: modeStats.internalRating,
          ratingVersion: modeStats.ratingVersion,
          puuid: stored.puuid || null,
          summonerId: stored.summonerId || null,
          mode,
          format,
          joinedAt: new Date().toISOString()
        });
        added++;
      }

      await saveQueue(queueData);
      return { added, lobby };
    });

    await updateQueueDashboard(message.guild);

    const sourceLabel = recentVictory.letter ? ` da sala **${recentVictory.letter}**` : '';
    const freshQueue = await loadQueue();
    const freshLobby = freshQueue.lobbies[result.lobby.id];

    if (freshLobby && freshLobby.players.length >= freshLobby.requiredPlayers) {
      // Sala completa: rebalanceia os times e inicia NA HORA (sem revanche fixa, sem contagem)
      if (pendingAutoStarts.has(freshLobby.id)) {
        clearTimeout(pendingAutoStarts.get(freshLobby.id));
        pendingAutoStarts.delete(freshLobby.id);
      }
      await handleStartCommandInternal(message.guild, freshLobby, message.channel);
      await updateQueueDashboard(message.guild);

      const startedMatch = (await loadCurrentMatch()).matches[freshLobby.id];
      if (startedMatch?.active) {
        return await replyToMessage(message, `✅ **Rematch**${sourceLabel}: **${result.added}** jogadores rebalanceados e partida iniciada na sala **${freshLobby.letter}**!`);
      }
    }

    const missing = freshLobby ? Math.max(0, freshLobby.requiredPlayers - freshLobby.players.length) : 0;
    await replyToMessage(message, `✅ **Rematch**${sourceLabel}: **${result.added}** jogadores recolocados na sala **${result.lobby.letter}**. Faltam **${missing}** para completar.`);
  } catch (err) {
    console.error('[ERRO] !rematch:', err);
    await replyToMessage(message, `❌ Erro ao acionar rematch: \`${err.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRulesCommand(message) {
  try {
    await sendToMessageChannel(message, { embeds: [buildRulesEmbed()] });
  } catch (error) {
    console.error('[ERRO] !regras:', error);
    await replyToMessage(message, `❌ Erro ao mostrar regras: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

function isStaffViewer(member) {
  if (!member) return false;
  try {
    if (member.permissions?.has('ManageMessages') || member.permissions?.has('Administrator')) return true;
  } catch { /* noop */ }
  return Boolean(config.roles?.captainRoleId && member.roles?.cache?.has(config.roles.captainRoleId));
}

async function handleStaffCommand(message) {
  try {
    if (!isStaffViewer(message.member)) {
      return await replyToMessage(message, '❌ Guia restrito à staff. Jogadores: usem `!regras`.');
    }
    await sendToMessageChannel(message, { embeds: [buildStaffEmbed()] });
  } catch (error) {
    console.error('[ERRO] !staff:', error);
    await replyToMessage(message, `❌ Erro ao mostrar guia da staff: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRoletaSairCommand(message, args = []) {
  const { handleRouletteOptOutFlow } = require('./handlers/rouletteCommandHandlers');
  try {
    await handleRouletteOptOutFlow({ message, args, deps: { loadSystemMeta, replyToMessage } });
  } catch (error) {
    console.error('[ERRO] !roletasair:', error);
    await replyToMessage(message, `❌ Erro ao sair da roleta: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleRouletteCommand(message, args = [], targetUserOverride = null) {
  const { handleRouletteCommandFlow } = require('./handlers/rouletteCommandHandlers');
  if (targetUserOverride && !message.mentions?.users?.first?.()) {
    message.mentions = message.mentions || {};
    const col = new Map([[targetUserOverride.id, targetUserOverride]]);
    col.first = () => targetUserOverride;
    message.mentions.users = col;
  }
  try {
    await handleRouletteCommandFlow({
      message,
      args,
      deps: {
        loadSystemMeta,
        saveSystemMeta,
        loadQueue,
        loadCurrentMatch,
        loadPlayerStats,
        saveQueue,
        withQueueOperationLock,
        getOpenLobby,
        createLobbyChannels,
        getNextLobbyLetter,
        getRequiredPlayersByModeAndFormat,
        getStoredPlayerStats,
        getModeStats,
        calculateHybridMmr: require('../services/balanceService').calculateHybridMmr,
        movePlayersToVoiceChannel,
        updateQueueDashboard,
        postRouletteAnnouncement,
        hasInfernalPriority,
        replyToMessage,
        getLobbyTier: require('../utils/lobbyUtils').getLobbyTier,
        getRouletteTimeoutMs: require('../utils/lobbyUtils').getRouletteTimeoutMs,
        getRouletteWarnMs: require('../utils/lobbyUtils').getRouletteWarnMs
      }
    });
  } catch (error) {
    console.error('[ERRO] !roleta:', error);
    await replyToMessage(message, `❌ Erro na roleta: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

module.exports = {
  handleEnterCommand, handleListCommand, handleWaitingListCommand, handleTierSWaitingListCommand, handleClearWaitingListsCommand, handleStatsCommand, handlePingCommand, handleLeaderboardCommand, handleTopTenCommand, handleTopInfernalCommand,
  handleTopStreakCommand, handleSeasonHistoryCommand, handlePlayerCardCommand, handleHelpCommand, handleLeaveCommand, handleRemoveCommand,
  handleResetCommand, handleCleanupRoomsCommand, handleSeasonResetCommand, handleOfficialSeasonStartCommand,
  handleUndoSeasonResetCommand, handleRestoreArchivedPeriodCommand, handleCancelStartCommand, handleStartCommand,
  handleSyncAllRolesCommand, handleSyncAllPlayersEloCommand, handleVictoryCommand, handleOnboardingCommand, handleClearCommand,
  handleRegisterCommand, handleNickUpdateCommand, handleSyncPlayerRankCommand, handleVoteCommand, pendingAutoStarts, triggerAutoStart,
  handleRematchCommand, handleRouletteCommand, handleRoletaSairCommand, handleRulesCommand, handleStaffCommand, handlePdlCommand,
  handleResultVoteButton,
  findRecentVictoryByLetter,
  findPendingAutoStartLobby,
  resolveCleanupTargets
};
