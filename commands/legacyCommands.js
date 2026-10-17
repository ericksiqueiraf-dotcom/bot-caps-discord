const { ChannelType, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
  getCustomPointsDelta, getCustomDisplayScore, buildTopInfernalEmbed, buildQueueFeedText, postQueueFeedMessage,
  buildQueueJoinActionRow, getMemberVipTier, buildVipTierResolver, buildClubeEmbed,
  parseLiveLink, getLiveCooldownRemainingMs, formatCooldownRemaining,
  buildLiveEmbed, findPromoChannel, ensureAoVivoRole
} = require('../utils/lobbyUtils');

const { 
  QUEUE_MODES, loadQueue, saveQueue, loadPlayerStats, 
  savePlayerStats, loadCurrentMatch, saveCurrentMatch, 
  loadSeasonMeta, saveSeasonMeta, loadSeasonHistory, 
  saveSeasonHistory, loadSystemMeta, saveSystemMeta,
  loadContentTemplates, loadVipSubscriptions,
  withQueueOperationLock 
} = require('../services/dataService');
const { getResolvedContentTemplates } = require('../services/contentTextService');

const {
  calculateSeedRating, calculateHybridMmr, calculateEloDelta,
  createBalancedTeams, applyLeagueMmrChange, migrateInternalRating,
  calculateTeamMmr, calculateTeamPdlDelta
} = require('../services/balanceService');

const getRiotService = () => global.riotService;

/**
 * Trava de level mínimo da conta Riot (config.cadastro.minSummonerLevel).
 * Fail-open quando o level é desconhecido (ex.: cache antigo sem o campo).
 */
function getSummonerLevelGate(summonerLevel) {
  const minLevel = Number(config.cadastro?.minSummonerLevel || 0);
  const level = Number(summonerLevel);
  if (!(minLevel > 0) || !(level > 0)) return { ok: true, minLevel, level: null };
  if (level < minLevel) return { ok: false, minLevel, level };
  return { ok: true, minLevel, level };
}

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
    formatCustomRecord,
    calculateTeamMmr,
    calculateTeamPdlDelta,
    getPdlMultiplier: () => require('../services/eventoService').getPdlMultiplier(),
    onVictoryPdlApplied: async ({ winners, match, winningTeam }) => {
      try {
        const evento = require('../services/eventoService');
        const missoes = require('../services/missoesService');
        const duelo = require('../services/dueloService');
        const systemMeta = await loadSystemMeta();
        if (evento.isSextaRankedWindow()) {
          evento.accumulateSextaGains(systemMeta, winners);
        }
        const teamOneIds = (match.teamOne || []).map((p) => p.discordId);
        const teamTwoIds = (match.teamTwo || []).map((p) => p.discordId);
        const allPlayers = [...(match.teamOne || []), ...(match.teamTwo || [])];
        const byId = new Map(allPlayers.map((p) => [String(p.discordId), p]));
        const playerStats = await loadPlayerStats();
        const bucketKey = getStatsBucketKey(match.mode, match.format);
        const credit = (discordId, valor) => {
          const ref = byId.get(String(discordId)) || { discordId };
          const stored = getStoredPlayerStats(playerStats, ref);
          if (!stored) return;
          const modes = getModeStats(stored, match.mode, match.format);
          upsertPlayerStats(playerStats, ref, {
            modes: { ...normalizePlayerModes(stored), [bucketKey]: { ...modes, internalRating: Math.max(0, Number(modes.internalRating || 0) + valor) } }
          });
        };
        // Missões semanais: progresso + bônus na hora.
        const mStore = missoes.ensureMissionsStore(systemMeta);
        const done = missoes.recordMatchPlayed(mStore, [...teamOneIds, ...teamTwoIds], (winners || []).map((w) => w.discordId));
        for (const { userId, mission } of done) {
          credit(userId, mission.premio);
          const w = (winners || []).find((x) => String(x.discordId) === String(userId));
          if (w) {
            w.missionBonus = Number(w.missionBonus || 0) + mission.premio;
            (w.missoesConcluidas ||= []).push(mission.desc);
          }
        }
        // Duelos: transfere pontos quando os dois estão em lados opostos.
        systemMeta.duelos ||= [];
        const { settled } = duelo.settleDuels(systemMeta.duelos, teamOneIds, teamTwoIds, winningTeam);
        for (const s of settled) {
          credit(s.winnerId, s.pontos);
          credit(s.loserId, -s.pontos);
          const w = (winners || []).find((x) => String(x.discordId) === String(s.winnerId));
          if (w) w.duelBonus = Number(w.duelBonus || 0) + s.pontos;
        }
        await savePlayerStats(playerStats);
        await saveSystemMeta(systemMeta);
      } catch { /* nao quebra o registro da vitoria */ }
    }
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
        buildQueueFeedText,
        postQueueFeedMessage,
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
    const levelGate = getSummonerLevelGate(rankProfile.summonerLevel);
    if (!levelGate.ok) {
      await replyToMessage(message, `❌ Conta level ${levelGate.level}. O mínimo para jogar na CAPS Arena é level ${levelGate.minLevel} — upe sua conta e tente de novo.`);
      return;
    }
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
    const nickLevelGate = getSummonerLevelGate(rankProfile.summonerLevel);
    if (!nickLevelGate.ok) {
      await replyToMessage(message, `❌ Conta level ${nickLevelGate.level}. O mínimo para jogar na CAPS Arena é level ${nickLevelGate.minLevel} — upe sua conta e tente de novo.`);
      return;
    }
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
    
    // Tentar encontrar um lobby específico pelo seletor ou pelo canal atual
    const lobby = findLobbyBySelector(queueData, args) || (currentVoiceChannelId ? findLobbyByChannelId(queueData, currentVoiceChannelId) : null);

    if (lobby) {
      // Se encontrou um lobby específico, mostra o detalhe dele
      const embed = buildQueueEmbed(lobby);
      await sendToMessageChannel(message, { embeds: [embed], components: [buildQueueJoinActionRow()] });
    } else {
      // Se não especificou e não está em um canal de lobby, mostra um resumo de todos
      const embed = buildQueueEmbed(null, lobbies);
      await sendToMessageChannel(message, { embeds: [embed], components: [buildQueueJoinActionRow()] });
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
    let justJoined = false;
    let joinPosition = 0;
    let joinInfernal = false;

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
        justJoined = true;
        joinInfernal = Boolean(isInfernal);
      }

      players = currentList;
      const position = currentList.findIndex((player) => player.discordId === message.author.id) + 1;
      if (justJoined) joinPosition = position;
      if (!isViewOnly && position > 0) {
        response = playerIndex === -1
          ? `Voce entrou na fila de espera na posicao **${position}**.`
          : `Voce ja esta na fila de espera, na posicao **${position}**.`;
      }
    });

    if (response) {
      await replyToMessage(message, response);
    }

    // Feed automatico no canal #fila a cada entrada na !espera / !esperatiers
    if (justJoined && joinPosition > 0) {
      const feedText = buildQueueFeedText({
        kind: 'espera-join',
        discordId: message.author.id,
        modeLabel,
        position: joinPosition,
        isInfernalBoost: joinInfernal
      });
      if (feedText) await postQueueFeedMessage(message.guild, feedText);
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
  const embed = buildLeaderboardEmbed(statsData, mode, format, { tierSOnly, tierResolver: buildVipTierResolver(message.guild), excludeTierS: !tierSOnly && mode === QUEUE_MODES.CLASSIC });
  await sendToMessageChannel(message, { embeds: [embed] });
}

async function handleTopTenCommand(message, args = []) {
  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();
  const { mode, format, tierSOnly } = parseModeAndFormatArgs(args);
  const embed = buildTopTenEmbed(statsData, seasonMeta, mode, format, { tierSOnly, tierResolver: buildVipTierResolver(message.guild), excludeTierS: !tierSOnly && mode === QUEUE_MODES.CLASSIC });
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
  const targetMember = message.guild?.members?.cache?.get?.(selectedUser.id) || null;
  await sendToMessageChannel(message, { embeds: [buildPlayerCardEmbed(playerStats, selectedUser, getMemberVipTier(targetMember))] });
}

async function handleClubeFixarCommand(message) {
  try {
    if (!isStaffViewer(message.member)) {
      return await replyToMessage(message, '❌ Restrito à staff.');
    }
    const { buildClubeDetalEmbed } = require('../utils/lobbyUtils');
    const guild = message.guild;
    const target = guild.channels.cache.find((c) => c.name === '🔰clube-vip' && c.isTextBased?.())
      || (message.channel?.isTextBased?.() ? message.channel : null);
    if (!target) {
      return await replyToMessage(message, '❌ Canal #clube-vip não encontrado.');
    }
    const embed = buildClubeDetalEmbed();
    const title = embed.data?.title;
    const botId = guild.members.me?.id;
    const pinned = await target.messages.fetchPinned().catch(() => null);
    const olds = [...(pinned?.values?.() || [])].filter(
      (m) => m.author?.id === botId && (m.embeds || []).some((e) => e.title === title)
    );
    for (const old of olds) {
      await old.unpin().catch(() => null);
      await old.delete().catch(() => null);
    }
    const sent = await target.send({ embeds: [embed] });
    await sent.pin().catch(() => null);
    await replyToMessage(message, `✅ Benefícios detalhados postados e fixados em ${target}. Apague a mensagem antiga manualmente se ainda estiver lá.`);
  } catch (error) {
    console.error('[ERRO] !clubefixar:', error);
    await replyToMessage(message, `❌ Erro ao fixar benefícios: \`${error.message}\``);
  }
}

async function handleAjudaFixarCommand(message) {
  try {
    if (!isStaffViewer(message.member)) {
      return await replyToMessage(message, '❌ Restrito à staff.');
    }
    const guild = message.guild;
    const target = guild.channels.cache.find((c) => c.name === '💡┃infos-lol' && c.isTextBased?.())
      || (message.channel?.isTextBased?.() ? message.channel : null);
    if (!target) {
      return await replyToMessage(message, '❌ Canal #infos-lol não encontrado.');
    }
    const titles = ['📚 Guia de Comandos (1/2) — O essencial', '📚 Guia de Comandos (2/2) — Ranking e extras'];
    const botId = guild.members.me?.id;
    const pinned = await target.messages.fetchPinned().catch(() => null);
    const olds = [...(pinned?.values?.() || [])].filter(
      (m) => m.author?.id === botId && (m.embeds || []).some((e) => titles.includes(e.title))
    );
    for (const old of olds) {
      await old.unpin().catch(() => null);
      await old.delete().catch(() => null);
    }
    for (const page of [1, 2]) {
      const sent = await target.send({ embeds: [buildAjudaEmbed(page)] });
      await sent.pin().catch(() => null);
    }
    await replyToMessage(message, `✅ Guias postados e fixados em ${target}. Apague as mensagens antigas manualmente se ainda estiverem lá.`);
  } catch (error) {
    console.error('[ERRO] !ajudafixar:', error);
    await replyToMessage(message, `❌ Erro ao fixar ajuda: \`${error.message}\``);
  }
}

function normalizePresentearTier(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('apoiador') || v.includes('💜')) return 'apoiador';
  if (v === 'vip' || v.includes('⭐')) return 'vip';
  if (v.includes('lendario') || v.includes('lendário') || v.includes('👑')) return 'lendario';
  return null;
}

async function handlePresentearCommand(message, args = [], targetUserOverride = null) {
  try {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return await replyToMessage(message, '❌ Restrito a administradores.');
    }
    const { getClubeTierConfig } = require('../services/clubePaymentsService');
    const targetUser = targetUserOverride || message.mentions.users.first();
    const tierKey = normalizePresentearTier(args.find((a) => normalizePresentearTier(a)));
    const diasArg = args.map(Number).find((n) => Number.isInteger(n));
    if (!targetUser) {
      return await replyToMessage(message, '❌ Use: `!presentear @usuário <apoiador|vip|lendario> [dias]`.');
    }
    if (!tierKey) {
      return await replyToMessage(message, '❌ Tier inválido. Use: `apoiador`, `vip` ou `lendario`.');
    }
    const tier = getClubeTierConfig(config, tierKey);
    if (!tier) {
      return await replyToMessage(message, '❌ Tier inválido.');
    }
    const dias = diasArg && diasArg >= 1 && diasArg <= 365 ? diasArg : tier.dias;
    const guild = message.guild;
    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return await replyToMessage(message, '❌ Usuário não está no servidor.');
    }
    const role = guild.roles.cache.find((r) => r.name === tier.roleName);
    if (!role) {
      return await replyToMessage(message, `❌ Cargo ${tier.roleName} não encontrado no servidor.`);
    }
    await member.roles.add(role, `Presente de ${message.author?.tag || message.author?.id}`).catch(() => null);
    const { loadVipSubscriptions, saveVipSubscriptions } = require('../services/dataService');
    const { subscriptions } = await loadVipSubscriptions();
    const now = Date.now();
    subscriptions.push({
      paymentId: `presente:${message.author.id}:${now}`,
      guildId: guild.id,
      discordId: targetUser.id,
      tierKey,
      status: 'active',
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + dias * 24 * 3600 * 1000).toISOString(),
      gift: true,
      grantedBy: message.author.id
    });
    await saveVipSubscriptions({ subscriptions });
    try {
      const dm = await member.createDM();
      await dm.send(`🎁 Você ganhou **${dias} dias de ${tier.roleName}** na CAPS Arena! Aproveite!`).catch(() => null);
    } catch { /* DM fechada: segue o jogo */ }
    await replyToMessage(message, `✅ ${targetUser} ganhou **${dias} dias de ${tier.roleName}**! 🎁`);
  } catch (error) {
    console.error('[ERRO] !presentear:', error);
    await replyToMessage(message, `❌ Erro ao presentear: \`${error.message}\``);
  }
}

async function handleQueroLiveCommand(message) {
  const guild = message.guild;
  if (!guild) return;
  const role = await ensureAoVivoRole(guild);
  if (!role) return await replyToMessage(message, 'Não consegui liberar o cargo 🔴 Ao Vivo agora. Tente de novo.');
  const member = message.member;
  if (!member) return;
  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role.id, '!quero-live: saiu').catch(() => null);
    return await replyToMessage(message, '🔕 Você saiu do 🔴 Ao Vivo e não receberá pings de live.');
  }
  await member.roles.add(role.id, '!quero-live: entrou').catch(() => null);
  return await replyToMessage(message, '🔔 Você entrou no 🔴 Ao Vivo e será avisado das lives!');
}

const LIVE_COOLDOWN_BY_TIER_MS = {
  '👑 Lendário': 6 * 60 * 60 * 1000,
  '⭐ VIP': 12 * 60 * 60 * 1000,
  '💜 Apoiador': 24 * 60 * 60 * 1000
};

async function handleLiveCommand(message, args = []) {
  const guild = message.guild;
  if (!guild) return;
  const liveTier = getMemberVipTier(message.member);
  const tierCooldownMs = LIVE_COOLDOWN_BY_TIER_MS[liveTier] || 0;
  if (!tierCooldownMs) {
    return await replyToMessage(message, '❌ O `!live` é do **Clube VIP** (Apoiador 24h, VIP 12h, Lendário 6h). Veja o `!clube`.');
  }
  const parsed = parseLiveLink(args.join(' '));
  if (!parsed) {
    return await replyToMessage(message, '❌ Uso: `!live <link da Twitch, YouTube ou Kick>`.');
  }
  const systemMeta = await loadSystemMeta();
  systemMeta.liveCooldowns ||= {};
  const remaining = Math.max(0, Number(systemMeta.liveCooldowns[message.author.id] || 0) + tierCooldownMs - Date.now());
  if (remaining > 0) {
    return await replyToMessage(message, `⏳ Aguarde **${formatCooldownRemaining(remaining)}** para divulgar de novo.`);
  }
  const role = await ensureAoVivoRole(guild);
  const embed = buildLiveEmbed({ memberMention: `<@${message.author.id}>`, url: parsed.url, platform: parsed.platform });
  const target = findPromoChannel(guild) || message.channel;
  const payload = { embeds: [embed] };
  if (role) payload.content = `<@&${role.id}> 🔴 **${message.author.username}** está ao vivo!`;
  await target.send(payload).catch(() => null);
  systemMeta.liveCooldowns[message.author.id] = Date.now();
  await saveSystemMeta(systemMeta);
  return await replyToMessage(message, '🔴 Live divulgada!');
}

async function handleClubeCommand(message) {
  const paymentsEnabled = Boolean(process.env.MP_ACCESS_TOKEN);
  const components = [];
  if (paymentsEnabled) {
    const { TIER_KEYS, TIER_ROLE_NAMES, findRenewableSub } = require('../services/clubePaymentsService');
    let subscriptions = [];
    try {
      ({ subscriptions } = await loadVipSubscriptions());
    } catch { /* sem store, só Assinar */ }
    const guildId = message.guild?.id;
    const discordId = message.author?.id;
    const row = new ActionRowBuilder().addComponents(
      TIER_KEYS.map((tierKey) => {
        const renewable = subscriptions.length && guildId && discordId
          ? findRenewableSub(subscriptions, guildId, discordId, tierKey)
          : null;
        return new ButtonBuilder()
          .setCustomId(renewable ? `clube:buy:${tierKey}:renew` : `clube:buy:${tierKey}`)
          .setLabel(renewable ? `Renovar ${TIER_ROLE_NAMES[tierKey]} -10%` : `Assinar ${TIER_ROLE_NAMES[tierKey]}`)
          .setStyle(renewable ? ButtonStyle.Success : ButtonStyle.Primary);
      })
    );
    components.push(row);
  }
  const payload = { embeds: [buildClubeEmbed(message.guild)] };
  if (components.length) payload.components = components;
  else payload.content = '💳 Assinaturas PIX em configuração — fale com a Staff.';
  await sendToMessageChannel(message, payload);
}

async function handleClubeAdminCommand(message) {
  try {
    if (!isStaffViewer(message.member)) {
      return await replyToMessage(message, '❌ Restrito à staff.');
    }
    const { TIER_KEYS, TIER_ROLE_NAMES } = require('../services/clubePaymentsService');
    const { subscriptions } = await loadVipSubscriptions();
    const guildId = String(message.guild?.id || '');
    const now = Date.now();
    const active = (subscriptions || []).filter(
      (s) => s?.status === 'active' && String(s?.guildId || '') === guildId
    );

    if (active.length === 0) {
      return await replyToMessage(message, '💎 Nenhuma assinatura ativa do clube neste servidor.');
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const lines = [];
    for (const tierKey of [...TIER_KEYS].reverse()) {
      const subs = active
        .filter((s) => s.tierKey === tierKey)
        .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
      if (subs.length === 0) continue;
      const rows = subs.map((s) => {
        const diffDays = Math.ceil((new Date(s.expiresAt).getTime() - now) / dayMs);
        const when = diffDays <= 0 ? 'vence hoje' : diffDays === 1 ? 'vence amanhã' : `vence em ${diffDays} dias`;
        return `• <@${s.discordId}> — ${when}`;
      });
      lines.push(`**${TIER_ROLE_NAMES[tierKey]} (${subs.length})**\n${rows.join('\n')}`);
    }

    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(THEME?.INFO ?? '#0099ff')
      .setTitle('💎 Assinaturas ativas do clube')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: `${FOOTER_PREFIX} • visível só aqui (comando de staff)` })
      .setTimestamp();
    await replyToMessage(message, { embeds: [embed] });
  } catch (error) {
    console.error('[ERRO] !clubeadmin:', error);
    await replyToMessage(message, `❌ Erro ao listar assinaturas: \`${error.message}\``);
  }
}

async function handleConviteCommand(message) {
  try {
    const { ensureInvitesStore, getRecruiterStats } = require('../services/convitesService');
    const systemMeta = await loadSystemMeta();
    const store = ensureInvitesStore(systemMeta);

    let invite = null;
    try {
      const invites = await message.guild.invites.fetch();
      invite = [...invites.values()].find((inv) => inv.inviterId === message.author.id && !inv.expiresAt) || null;
    } catch { /* sem permissao de ver convites: cria direto */ }
    if (!invite) {
      const welcome = message.guild.channels.cache.find((c) => c.name === '👋-boas-vindas' && c.isTextBased?.());
      const target = welcome || (message.channel?.isTextBased?.() ? message.channel : null);
      if (target?.createInvite) {
        invite = await target.createInvite({ maxAge: 0, maxUses: 0, reason: `Convite pessoal de ${message.author.tag}` }).catch(() => null);
      }
    }
    if (!invite) {
      return await replyToMessage(message, '❌ Não consegui criar seu link agora. Fale com a Staff.');
    }

    store.links[message.author.id] = { code: invite.code, channelId: invite.channelId, createdAt: new Date().toISOString() };
    await saveSystemMeta(systemMeta);
    const stats = getRecruiterStats(store, message.author.id);
    await replyToMessage(message,
      `🔗 Seu link pessoal: ${invite.url}\n` +
      `Traga gente e ganhe: **3** = cargo 🌱 Recrutador • **5** = destaque na Arena • **10** = **7 dias de ⭐ VIP grátis**\n` +
      `Você já trouxe **${stats.lifetime}** (${stats.month} este mês). Use \`!topconvites\` para ver o ranking.`
    );
  } catch (error) {
    console.error('[ERRO] !convite:', error);
    await replyToMessage(message, `❌ Erro ao gerar convite: \`${error.message}\``);
  }
}

async function handleTopConvitesCommand(message) {
  try {
    const { ensureInvitesStore, getMonthlyTop, monthKey } = require('../services/convitesService');
    const systemMeta = await loadSystemMeta();
    const store = ensureInvitesStore(systemMeta);
    const month = monthKey();
    const top = getMonthlyTop(store, month, 10);
    if (top.length === 0) {
      return await replyToMessage(message, '📭 Ninguém trouxe gente nova este mês ainda. Use `!convite` e seja o primeiro!');
    }
    const lines = top.map((t) => `${t.position === 1 ? '👑 ' : ''}**${t.position}º** <@${t.userId}> — ${t.count} convite(s)`);
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(THEME?.RANK ?? '#FFD700')
      .setTitle(`🔗 Top convites — ${month.slice(5)}/${month.slice(0, 4)}`)
      .setDescription(lines.join('\n') + '\n\nMetas: 3 = 🌱 Recrutador • 5 = destaque • 10 = 7 dias de ⭐ VIP grátis')
      .setFooter({ text: `${FOOTER_PREFIX} • zera todo dia 1º` })
      .setTimestamp();
    await replyToMessage(message, { embeds: [embed] });
  } catch (error) {
    console.error('[ERRO] !topconvites:', error);
    await replyToMessage(message, `❌ Erro ao listar ranking: \`${error.message}\``);
  }
}

async function resolveTorneioPool(guild, ids) {
  const playerStats = await loadPlayerStats();
  const out = [];
  for (const id of ids || []) {
    const member = await guild.members.fetch(id).catch(() => null);
    let baseMmr = 1500;
    let nickname = member?.displayName || id;
    try {
      const stored = getStoredPlayerStats(playerStats, { discordId: id });
      const modeStats = stored ? getModeStats(stored, QUEUE_MODES.CLASSIC) : null;
      if (Number.isFinite(Number(modeStats?.baseMmr))) baseMmr = Number(modeStats.baseMmr);
      if (stored?.registeredNickname) nickname = member?.displayName || stored.registeredNickname;
    } catch { /* fallback neutro */ }
    out.push({ discordId: String(id), nickname, baseMmr });
  }
  return out;
}

function fmtDataBR(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTorneioGames(games) {
  const somaMmr = (team) => (team || []).reduce((s, p) => s + Number(p.baseMmr || 0), 0);
  return games.map((g) => {
    const t1 = g.teamOne.map((p) => `<@${p.discordId}>`).join(' ');
    const t2 = g.teamTwo.map((p) => `<@${p.discordId}>`).join(' ');
    const placar = g.winner ? ` — **venceu time ${g.winner}**` : '';
    const diff = Math.abs(somaMmr(g.teamOne) - somaMmr(g.teamTwo));
    return `**${g.id}**: ${t1} 🆚 ${t2}${placar} • **Δ MMR ${diff}**`;
  }).join('\n');
}

async function handleTorneioCommand(message, args = []) {
  const T = require('../services/torneioService');
  const { createBalancedTeams } = require('../services/balanceService');
  const sub = String(args[0] || 'info').toLowerCase();
  const rest = args.slice(1);
  try {
    const systemMeta = await loadSystemMeta();
    const t = systemMeta.torneio || null;
    const habilitado = systemMeta.torneioHabilitado === true;
    const staff = isTournamentStaff(message.member);
    const save = async () => { await saveSystemMeta(systemMeta); };

    if (sub === 'info') {
      const lines = [];
      if (!habilitado) lines.push('⏸️ O torneio está **desativado** no momento.');
      if (t?.active && t.inscricoes !== false && t.inscricoesAte) {
        lines.push(`📅 Inscrições abertas até **${fmtDataBR(t.inscricoesAte)}** — ${t.players.length} inscrito(s) (mínimo ${T.MIN_PLAYERS}).`);
      }
      if (t?.agenda) lines.push(`🗓️ Agenda: ${T.formatAgenda(t.agenda)}.`);
      return await replyToMessage(message, lines.length ? `${lines.join('\n')}\n\n${T.TORNEIO_INFO}` : T.TORNEIO_INFO);
    }

    if (sub === 'entrar') {
      if (!habilitado && !staff) {
        return await replyToMessage(message, '🏆 O torneio está **desativado** no momento. Aguarde a staff ativar com `!torneioon`.');
      }
      if (!t?.active) return await replyToMessage(message, '❌ Nenhum torneio aberto. Aguarde o anúncio da staff.');
      if (t.inscricoes === false) return await replyToMessage(message, '❌ As inscrições já foram encerradas. Aguarde o sorteio!');
      const r = T.joinTournament(t, message.author.id);
      await save();
      return await replyToMessage(message, r.ok ? `✅ Inscrito no **Torneio #${t.edition}**! (${r.count} inscritos)` : `❌ ${r.message}`);
    }

    if (sub === 'sair') {
      if (!t?.active) return await replyToMessage(message, '❌ Nenhum torneio aberto.');
      const r = T.leaveTournament(t, message.author.id);
      await save();
      return await replyToMessage(message, r.ok ? `Inscrição removida. (${r.count} inscritos)` : `❌ ${r.message}`);
    }

    if (sub === 'lista') {
      if (!t?.active || t.players.length === 0) return await replyToMessage(message, '📭 Nenhum inscrito ainda. Use `!torneio entrar`.');
      const mentions = t.players.map((id) => `<@${id}>`).join(' ');
      return await replyToMessage(message, `🏆 **Torneio #${t.edition}** — ${t.players.length} inscrito(s):\n${mentions}`);
    }

    if (sub === 'status') {
      if (!t?.active) return await replyToMessage(message, '📭 Nenhum torneio ativo.');
      const st = T.getStatus(t);
      const lines = [`🏆 **Torneio #${st.edition}** — ${st.inscritos} inscrito(s)`, `Rodada atual: ${st.rodada || 'ainda não sorteada'}`];
      if (st.inscricoes && st.inscricoesAte) lines.push(`📅 Inscrições até ${fmtDataBR(st.inscricoesAte)}${st.reservas ? ` • ${st.reservas} reserva(s)` : ''}`);
      if (!st.inscricoes && st.rodada === 0 && !st.champion) lines.push('🔒 Inscrições encerradas — aguardando o sorteio.');
      if (st.final) lines.push(`🔥 FINAL MD3: **${st.placarFinal}**`);
      if (st.jogosPendentes.length) lines.push(`⏳ Aguardando: ${st.jogosPendentes.join(', ')}`);
      if (st.champion) lines.push(`👑 Campeões: ${st.champion.team.map((id) => `<@${id}>`).join(' ')} (${st.champion.placar})`);
      return await replyToMessage(message, lines.join('\n'));
    }

    // ---- staff ----
    if (!staff) {
      return await replyToMessage(message, '❌ Esse subcomando é **restrito à Staff**. Jogadores: `!torneio entrar | sair | lista | info | status`.');
    }

    if (sub === 'on') {
      const dias = Number(rest[0]) > 0 ? Math.floor(Number(rest[0])) : T.INSCRICOES_DIAS_DEFAULT;
      const now = Date.now();
      systemMeta.torneioHabilitado = true;
      const emRodada = Boolean(t && (t.rounds || []).length > 0);
      const emFinal = Boolean(t?.final);
      if (t && t.active && !t.champion && (emRodada || emFinal)) {
        await save();
        return await replyToMessage(message,
          `🏆 **Torneio #${t.edition} reativado.** Ele já está em andamento — conduza com \`!torneio sortear\`/\`resultado\`.`);
      }
      if (t && t.active && !t.champion && (t.players || []).length > 0) {
        T.renovarInscricoes(t, dias, now);
      } else {
        systemMeta.torneio = T.novaEdicao(t, { origem: 'manual', dias, nowMs: now });
      }
      systemMeta.torneioAbertoEm = T.dateKeySP(now);
      await save();
      const ed = systemMeta.torneio.edition;
      return await replyToMessage(message,
        `🏆 **Torneio #${ed} aberto!** Inscrições até **${fmtDataBR(systemMeta.torneio.inscricoesAte)}** (${dias} dia(s)).\nMembros: \`!torneio entrar\`.`);
    }

    if (sub === 'off') {
      systemMeta.torneioHabilitado = false;
      if (t) t.inscricoes = false;
      await save();
      return await replyToMessage(message, '🔒 **Torneio desativado.** As inscrições estão fechadas — reative com `!torneioon`.');
    }

    if (sub === 'agenda') {
      const alvo = String(rest[0] || '').toLowerCase();
      if (['off', 'limpar', 'remover', 'cancelar'].includes(alvo)) {
        if (systemMeta.torneio) systemMeta.torneio.agenda = null;
        await save();
        return await replyToMessage(message, '🗓️ Agendamento do torneio removido.');
      }
      if (!systemMeta.torneio) {
        const placeholder = T.newTournament(0);
        placeholder.active = false;
        placeholder.inscricoes = false;
        systemMeta.torneio = placeholder;
      }
      const r = T.setAgenda(systemMeta.torneio, rest[0], rest[1], rest[2]);
      if (!r.ok) return await replyToMessage(message, `❌ ${r.message}`);
      await save();
      return await replyToMessage(message,
        `🗓️ **Agenda do torneio:** ${T.formatAgenda(r.agenda)}.\nEle abre sozinho nesses dias (limpe com \`!torneioagenda off\`).`);
    }

    if (sub === 'novo') {
      if (T.torneioEmAndamento(t)) {
        return await replyToMessage(message, '❌ Já há torneio em andamento. Use `!torneio encerrar` primeiro.');
      }
      const dias = Number(rest[1]) > 0 ? Math.floor(Number(rest[1])) : T.INSCRICOES_DIAS_DEFAULT;
      const edition = Number(rest[0]) > 0 ? Number(rest[0]) : ((t?.edition || 0) + 1);
      systemMeta.torneio = T.novaEdicao(t, { origem: 'manual', dias, nowMs: Date.now() });
      systemMeta.torneio.edition = edition;
      systemMeta.torneioHabilitado = true;
      await save();
      return await replyToMessage(message, `🏆 **Torneio #${edition} aberto!** Inscrições até **${fmtDataBR(systemMeta.torneio.inscricoesAte)}** (${dias} dia(s)). Use \`!torneio entrar\`.`);
    }

    if (sub === 'encerrar') {
      if (!t?.active) return await replyToMessage(message, '📭 Nenhum torneio ativo.');
      t.active = false;
      await save();
      return await replyToMessage(message, `Torneio #${t.edition} encerrado.`);
    }

    if (sub === 'sortear') {
      if (!t?.active) return await replyToMessage(message, '❌ Nenhum torneio ativo.');
      if (t.final) return await replyToMessage(message, '🔥 A final já está rolando. Use `!torneio resultado FINAL <1|2>`.');
      if (t.rounds.length === 0) {
        const req = T.startRequirement(t);
        if (!req.ok) return await replyToMessage(message, `❌ ${req.message}`);
        const pool = await resolveTorneioPool(message.guild, t.players);
        const games = T.drawGames(pool, (g) => createBalancedTeams(g), 'R1');
        t.rounds.push({ n: 1, games });
        await save();
        return await replyToMessage(message, `🎲 **Rodada 1 sorteada!**\n${formatTorneioGames(games)}\n\nStaff: \`!torneio resultado <jogo> <1|2>\``);
      }
      const adv = T.advanceTournament(t, (g) => createBalancedTeams(g));
      if (!adv.ok) return await replyToMessage(message, `❌ ${adv.message}`);
      await save();
      if (adv.type === 'final') {
        return await replyToMessage(message,
          `🔥 **FINAL MD3!** Mesmos times, melhor de 3:\n${formatTorneioGames([{ id: 'FINAL', teamOne: t.final.teamOne, teamTwo: t.final.teamTwo, winner: null }])}\n\nStaff: \`!torneio resultado FINAL <1|2>\``);
      }
      const rep = adv.repechage?.length ? `\n🍀 Repescagem: ${adv.repechage.map((p) => `<@${p.discordId}>`).join(' ')}` : '';
      return await replyToMessage(message, `🎲 **Rodada ${adv.round} sorteada!**${rep}\n${formatTorneioGames(adv.games)}\n\nStaff: \`!torneio resultado <jogo> <1|2>\``);
    }

    if (sub === 'resultado') {
      if (!t?.active) return await replyToMessage(message, '❌ Nenhum torneio ativo.');
      const [jogo, time] = rest;
      if (!jogo || !time) return await replyToMessage(message, '❌ Use: `!torneio resultado <jogo> <1|2>` ou `!torneio resultado FINAL <1|2>`.');
      if (String(jogo).toUpperCase() === 'FINAL') {
        const r = T.recordFinalGame(t, time);
        if (!r.ok) return await replyToMessage(message, `❌ ${r.message}`);
        await save();
        if (!r.champion) {
          return await replyToMessage(message, `📝 Final: **${r.final.wins1}x${r.final.wins2}**. Faltam ${2 - Math.max(r.final.wins1, r.final.wins2)} vitória(s) para fechar!`);
        }
        const guild = message.guild;
        let cargo = guild.roles.cache.find((r_) => r_.name === T.TORNEIO_CARGO_NOME);
        if (!cargo) cargo = await guild.roles.create({ name: T.TORNEIO_CARGO_NOME, reason: 'Cargo de campeão do torneio' }).catch(() => null);
        if (cargo) {
          for (const [, m] of cargo.members) await m.roles.remove(cargo, 'Novo campeão do torneio').catch(() => null);
          for (const id of t.champion.team) {
            const m = await guild.members.fetch(id).catch(() => null);
            if (m) await m.roles.add(cargo, 'Campeão do torneio').catch(() => null);
          }
        }
        return await replyToMessage(message,
          `🏆 **CAMPEÕES DO TORNEIO #${t.edition}** (${t.champion.placar})!\n` +
          `${t.champion.team.map((id) => `<@${id}>`).join(' ')}\nParabéns!`);
      }
      const r = T.recordGameResult(t, jogo, time);
      if (!r.ok) return await replyToMessage(message, `❌ ${r.message}`);
      await save();
      return await replyToMessage(message, `✅ ${r.game.id}: venceu o **time ${r.game.winner}**.`);
    }

    return await replyToMessage(message, '❌ Use: `!torneio entrar | sair | lista | info | status` (staff: `!torneioon`, `!torneiooff`, `!torneioagenda`, `novo | sortear | resultado | encerrar`).');
  } catch (error) {
    console.error('[ERRO] !torneio:', error);
    await replyToMessage(message, `❌ Erro no torneio: \`${error.message}\``);
  }
}

const TEMPO_RANK_COLORS = {
  '🎙️ Viciado em Call': '#FFD700',
  '🎙️ Frequente': '#9B59B6',
  '🎙️ Ativo': '#2ECC71'
};

function buildTempoEmbed({ displayName = '', avatarURL = null, times, rank }) {
  const { EmbedBuilder } = require('discord.js');
  const vt = require('../services/voiceTimeService');
  const color = (rank.current && TEMPO_RANK_COLORS[rank.current.name]) || '#95A5A6';
  const falta = rank.next ? vt.formatTempo(rank.next.hours * 3600000 - times.monthMs) : null;
  const daysElapsed = Math.max(1, new Date().getUTCDate());
  const dailyAvg = times.monthMs / daysElapsed;
  const ritmo = !rank.next
    ? 'Máximo alcançado! 🎉'
    : dailyAvg <= 0
      ? 'Entre em call para começar o ritmo!'
      : `~${vt.formatTempo(dailyAvg)}/dia → cargo em ~${Math.ceil((rank.next.hours * 3600000 - times.monthMs) / dailyAvg)} dia(s)`;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🎙️ Seu tempo em call')
    .setDescription(`Estatísticas de **${displayName || 'você'}**`)
    .addFields(
      { name: '⏱️ Geral', value: vt.formatTempo(times.totalMs), inline: true },
      { name: '📅 Semana', value: vt.formatTempo(times.weekMs), inline: true },
      { name: '🗓️ Mês', value: vt.formatTempo(times.monthMs), inline: true },
      { name: '🎖️ Cargo atual', value: rank.current ? rank.current.name : 'Cinzas', inline: true },
      { name: '🎯 Próximo cargo', value: rank.next ? `${rank.next.name} — faltam ${falta}` : 'Máximo alcançado 🎉', inline: true },
      { name: '📊 Progresso', value: vt.progressBar(times.monthMs, rank.next).replace(/█/g, '▰').replace(/□/g, '▱'), inline: false },
      { name: '💡 Ritmo', value: ritmo, inline: false }
    )
    .setFooter({ text: 'Conta o tempo em call, mesmo sozinho • Pausa mudo, ensurdecido ou AFK' })
    .setTimestamp();
  if (avatarURL) embed.setThumbnail(avatarURL);
  return embed;
}

async function handleTempoCommand(message) {
  try {
    const vt = require('../services/voiceTimeService');
    const systemMeta = await loadSystemMeta();
    const store = vt.ensureVoiceStore(systemMeta);
    const t = vt.getUserTime(store, message.author.id);
    const rank = vt.rankForMonth(t.monthMs);
    await replyToMessage(message, {
      embeds: [buildTempoEmbed({
        displayName: message.member?.displayName || message.author?.username || '',
        avatarURL: message.author?.displayAvatarURL?.(),
        times: t,
        rank
      })]
    });
  } catch (error) {
    console.error('[ERRO] !tempo:', error);
    await replyToMessage(message, `❌ Erro ao ver tempo: \`${error.message}\``);
  }
}

async function handleTopVozCommand(message) {
  try {
    const vt = require('../services/voiceTimeService');
    const systemMeta = await loadSystemMeta();
    const store = vt.ensureVoiceStore(systemMeta);
    const top = vt.getMonthlyTop(store, vt.monthKey(), 10);
    if (top.length === 0) {
      return await replyToMessage(message, '📭 Ninguém pontuou tempo em call este mês ainda. Entre em voz!');
    }
    const lines = top.map((t) => `**${t.position}º** <@${t.userId}> — ${vt.formatTempo(t.ms)}`);
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(THEME?.RANK ?? '#FFD700')
      .setTitle('🎙️ Top tempo em call do mês')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${FOOTER_PREFIX} • 5h Ativo • 15h Frequente (+Lounge) • 30h Viciado` })
      .setTimestamp();
    await replyToMessage(message, { embeds: [embed] });
  } catch (error) {
    console.error('[ERRO] !topvoz:', error);
    await replyToMessage(message, `❌ Erro no ranking: \`${error.message}\``);
  }
}

function buildAjudaEmbed(page = 1) {
  const embed = new EmbedBuilder()
  .setColor(THEME.INFO);
  if (Number(page) === 2) {
      embed
      .setTitle('📚 Guia de Comandos (2/2) — Ranking e extras')
      .setDescription('Ranking, clube VIP, salas temporárias e extras. Página 1 no `!ajuda`.')
      .addFields(
        { name: '🏆 Ranking e pós-jogo', value: '`!roleta N A` • Sorteia na hora quem sai da sala A (N = 1–5)\n`!roletasair A` • Fica fora da próxima (sem sorteio nem subida)\n`!palpite <1|2> <10-100>` • Aposta pontos no vencedor da sua partida\n`!perfil` • Seus Pontos Custom (base 1000) e Elo LoL\n`!placar` • Ranking geral (CLASSIC = pontos custom)\n`!placar tiers` • Só Esmeralda+\n`!top10` • Top 10 CLASSIC por pontos custom, desempate por winrate\n`!top10 tiers` • Top 10 só Esmeralda+\n`!topstreak` • Ranking Streak 🔥\n`!toprankinfernal` • Quem mais pegou INFERNAL na temporada 🔥\n🗳️ Após a partida, vote no MVP no canal de destaques • 🔥 5 wins seguidas = cargo INFERNAL (prioridade na espera + proteção na roleta)' },
        { name: '💎 Clube VIP', value: '`!clube` • Tiers, assinatura PIX e renovação -10%\n`!querolive` • Entrar/sair do ping 🔴 Ao Vivo\n`!live <link>` • Divulgar live Twitch/YouTube/Kick (Lendário 6h, VIP 12h, Apoiador 24h)' },
        { name: '🔊 Salas temporárias (dono da sala)', value: 'Entre no ➕・criar-sala para ganhar sua sala\n`!salahub` • Lista as salas ativas\n`!sala` • Mostra sua sala • `!sala <nome>` renomeia\n`!convidar @u` • Chama alguém p/ sua sala\n`!salalock` • Tranca (`!salalock abrir` destranca)\n`!salalimit <0-99>` • Limite de usuários (0 = sem limite)\n`!salaexpulsar @u` • Remove alguém da sala\n`!limparvoz` • Apaga sua sala (dentro dela)' },
        { name: '🎁 Extras', value: '`!convite` • Seu link pessoal (traga gente e ganhe recompensas)\n`!topconvites` • Ranking de quem mais trouxe gente\n`!torneio` • Torneio mata-mata (entrar, lista, status — staff: `!torneioon`/`!torneiooff`/`!torneioagenda`)\n`!tempo` • Seu tempo em call • `!topvoz` • Ranking de call\n`!palpite <1|2> <10-100>` • Bolão da partida • `!missoes` • Missões da semana • `!duelo @u` • Duelo de PDL\n🌅 Primeira vitória do dia vale +50% PDL (automático)\n`!regras` • Regulamento completo' },
        { name: '⬅️ Página 1', value: '`!ajuda` • Cadastro, fila e voto\n`!staff` • Guia da staff (restrito)' }
      );
    } else {
    embed
    .setTitle('📚 Guia de Comandos (1/2) — O essencial')
    .setDescription('O básico para jogar na CAPS Arena. O resto está no `!ajuda2`.')
    .addFields(
      { name: '🕹️ Cadastro (1x)', value: '`!cadastrar Nick#TAG` • Vincula sua conta Riot\n`!nick Nick#TAG` • Atualiza seu nick' },
      { name: '🎮 Fila e voto', value: '`!entrar` • Fila Classic (no canal Lobby Classic ou Lobby TIER S)\n`!entrar aram` • Fila ARAM\n`!entrar aram 2x2` • ARAM formato (1x1 até 5x5)\n`!fila` • Mostra jogadores em sala\n`!espera` • Entra na espera (🔥 INFERNAL entra na posição 5)\n`!esperatiers` • Espera do Lobby TIER S (só Esmeralda+)\n`!espera ver` • Mostra a ordem • `!espera sair` • Sai da espera\n`!sair` • Sai da sala\n`!votar 1/2` • Vota no vencedor (abre painel com botões p/ os 10 votarem)\n`!votar` • Reabre o painel de votação' },
      { name: '➡️ Página 2', value: '`!ajuda2` • Ranking, clube VIP, salas temporárias, torneio, convites e tempo em call\n`!staff` • Guia da staff (restrito)' }
    );
    }
    embed
    .setFooter({ text: `${FOOTER_PREFIX} • Ajuda Atualizada` })
    .setTimestamp();
  return embed;
}

async function handlePalpiteCommand(message, args = []) {
  try {
    const [timeArg, pontosArg] = args;
    const time = String(timeArg || '');
    const pontos = Number(pontosArg);
    if (!['1', '2'].includes(time) || !Number.isInteger(pontos) || pontos < 10 || pontos > 100) {
      return await replyToMessage(message, '❌ Use: `!palpite <1|2> <10-100>` (aposta com seus pontos custom).');
    }
    const currentMatchData = await loadCurrentMatch();
    const entry = Object.entries(currentMatchData.matches || {}).find(([, e]) => {
      if (!e?.active || !e?.match) return false;
      return [...(e.match.teamOne || []), ...(e.match.teamTwo || [])].some((p) => p.discordId === message.author.id);
    });
    if (!entry) {
      return await replyToMessage(message, '❌ Você não está em nenhuma partida ativa.');
    }
    const [matchId, matchEntry] = entry;
    matchEntry.palpites ||= {};
    if (matchEntry.palpites[message.author.id]) {
      return await replyToMessage(message, '❌ Você já apostou nesta partida.');
    }
    // Janela de aposta: 5 minutos após a formação dos times.
    const PALPITE_WINDOW_MS = 5 * 60 * 1000;
    const matchAgeMs = Date.now() - new Date(matchEntry.match.createdAt || 0).getTime();
    if (!Number.isFinite(matchAgeMs) || matchAgeMs > PALPITE_WINDOW_MS) {
      return await replyToMessage(message, '❌ Apostas encerradas para essa partida (vale nos primeiros 5 minutos após formar os times).');
    }
    const playerStats = await loadPlayerStats();
    const bettor = [...(matchEntry.match.teamOne || []), ...(matchEntry.match.teamTwo || [])]
      .find((p) => p.discordId === message.author.id) || { discordId: message.author.id };
    const stored = getStoredPlayerStats(playerStats, bettor);
    const bucketKey = getStatsBucketKey(matchEntry.match.mode, matchEntry.match.format);
    const modeStats = getModeStats(stored, matchEntry.match.mode, matchEntry.match.format);
    if (!stored || Number(modeStats?.internalRating || 0) < pontos) {
      return await replyToMessage(message, `❌ Pontos insuficientes (você tem ${Math.floor(Number(modeStats?.internalRating || 0))}).`);
    }
    const updatedModes = {
      ...normalizePlayerModes(stored),
      [bucketKey]: { ...modeStats, internalRating: Number(modeStats.internalRating) - pontos }
    };
    upsertPlayerStats(playerStats, bettor, { modes: updatedModes });
    await savePlayerStats(playerStats);
    matchEntry.palpites[message.author.id] = { time, pontos, betAt: new Date().toISOString() };
    await saveCurrentMatch(currentMatchData);
    await replyToMessage(message, `🎯 Aposta registrada: **${pontos} pontos no time ${time}**! Boa sorte!`);
  } catch (error) {
    console.error('[ERRO] !palpite:', error);
    await replyToMessage(message, `❌ Erro ao apostar: \`${error.message}\``);
  }
}

async function handleMissoesCommand(message) {
  try {
    const missoes = require('../services/missoesService');
    const systemMeta = await loadSystemMeta();
    const store = missoes.ensureMissionsStore(systemMeta);
    const progress = missoes.getProgress(store, message.author.id);
    const lines = progress.map((p) => `${p.feito ? '✅' : '⬜'} ${p.desc} (${Math.min(p.atual, p.meta)}/${p.meta}) • +${p.premio} PDL`);
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(THEME?.RANK ?? '#FFD700')
      .setTitle('🎖️ Missões da semana')
      .setDescription(lines.join('\n') + '\n\nBônus cai sozinho ao completar. Zera toda segunda.')
      .setFooter({ text: `${FOOTER_PREFIX} • Missões semanais` })
      .setTimestamp();
    await replyToMessage(message, { embeds: [embed] });
  } catch (error) {
    console.error('[ERRO] !missoes:', error);
    await replyToMessage(message, `❌ Erro nas missões: \`${error.message}\``);
  }
}

async function handleDueloCommand(message, args = [], targetUserOverride = null) {
  try {
    const duelo = require('../services/dueloService');
    const sub = String(args[0] || '').toLowerCase();
    const systemMeta = await loadSystemMeta();
    systemMeta.duelos ||= [];
    const save = async () => { await saveSystemMeta(systemMeta); };

    if (['aceitar', 'aceito'].includes(sub)) {
      const r = duelo.acceptDuel(systemMeta.duelos, message.author.id);
      systemMeta.duelos = r.duelos;
      await save();
      if (!r.ok) return await replyToMessage(message, `❌ ${r.message}`);
      return await replyToMessage(message, `⚔️ Duelo aceito! <@${r.duel.a}> 🆚 <@${r.duel.b}> valendo **${r.duel.pontos} PDL**. Joguem a partida — quem vencer leva!`);
    }

    if (['recusar', 'recuso', 'negar'].includes(sub)) {
      const r = duelo.refuseDuel(systemMeta.duelos, message.author.id);
      systemMeta.duelos = r.duelos;
      await save();
      return await replyToMessage(message, r.ok ? 'Duelo recusado.' : `❌ ${r.message}`);
    }

    if (['lista', 'status'].includes(sub)) {
      const pendentes = duelo.expireDuels(systemMeta.duelos);
      systemMeta.duelos = pendentes;
      await save();
      const mine = pendentes.filter((d) => d.status !== 'concluido' && (d.a === message.author.id || d.b === message.author.id));
      if (mine.length === 0) return await replyToMessage(message, '📭 Nenhum duelo seu pendente. Desafie com `!duelo @usuário [pontos]`.');
      return await replyToMessage(message, mine.map((d) => `⚔️ <@${d.a}> 🆚 <@${d.b}> — ${d.pontos} PDL (${d.status})`).join('\n'));
    }

    const targetUser = targetUserOverride || message.mentions.users.first();
    const pontos = args.map(Number).find((n) => Number.isInteger(n)) ?? duelo.DUEL_DEFAULT;
    if (!targetUser && !['aceitar', 'aceito', 'recusar', 'recuso', 'negar', 'lista', 'status'].includes(sub)) {
      return await replyToMessage(message, '❌ Use: `!duelo @usuário [10-200]` • `!duelo aceitar` • `!duelo recusar` • `!duelo lista`.');
    }
    const r = duelo.createDuel(systemMeta.duelos, message.author.id, targetUser.id, pontos);
    if (!r.ok) return await replyToMessage(message, `❌ ${r.message}`);
    systemMeta.duelos = r.duelos;
    await save();
    return await replyToMessage(message, `${targetUser}, você foi desafiado por ${message.author} para um duelo valendo **${r.valor} PDL**! Responda com \`!duelo aceitar\` ou \`!duelo recusar\`.`);
  } catch (error) {
    console.error('[ERRO] !duelo:', error);
    await replyToMessage(message, `❌ Erro no duelo: \`${error.message}\``);
  }
}

async function handleHelpCommand(message, page = 1) {
  try {
    const embed = buildAjudaEmbed(page);
  const sent = await sendToMessageChannel(message, { embeds: [embed] });
    if (!sent) {
      await replyToMessage(message, '📚 Comandos: `!cadastrar Nick#TAG` • `!entrar` • `!entrar aram` • `!fila` • `!espera` • `!sair` • `!votar 1/2` • `!perfil` • `!placar` • `!top10` • `!topstreak` • `!clube` • `!querolive` • `!live` • `!staff` • `!start` • `!vitoria` • `!temporadas`');
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

// Staff "de verdade" (🛠️ Staff / Moderador / Admin) — SEM o cargo de Capitão.
// Usado nos comandos de gestão do torneio: Capitão não se envolve neles.
function isTournamentStaff(member) {
  if (!member) return false;
  try {
    if (member.permissions?.has('ManageMessages') || member.permissions?.has('Administrator')) return true;
  } catch { /* noop */ }
  const key = (name) => String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  try {
    return Boolean(member.roles?.cache?.some((role) => key(role?.name) === 'staff' || key(role?.name) === 'moderador'));
  } catch { return false; }
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

// --- Temp Voice Management Commands ---

const {
  inviteToTempRoom,
  renameTempRoom,
  deleteTempRoom,
  listTempRooms,
  isTempRoomOwner,
  getUserTempRoom
} = require('../services/tempVoiceService');

async function handleSalaHubCommand(message, args = []) {
  try {
    const guild = message.guild;
    const rooms = listTempRooms(guild);
    
    if (rooms.length === 0) {
      return await replyToMessage(message, '📭 Nenhuma sala temporária ativa no momento.');
    }
    
    const lines = rooms.map((r) =>
      `${r.locked ? '🔒' : '🔊'} **${r.channel.name}** — Dono: ${r.owner} — ${r.memberCount} membro(s)`
    );
    
    await replyToMessage(message, `**Salas temporárias ativas (${rooms.length}):**\n${lines.join('\n')}`);
  } catch (error) {
    console.error('[ERRO] !salahub:', error);
    await replyToMessage(message, `❌ Erro ao listar salas: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleConvidarCommand(message, args = [], targetUserOverride = null) {
  try {
    const targetUser = targetUserOverride || message.mentions.users.first();
    if (!targetUser) {
      return await replyToMessage(message, '❌ Use: `!convidar @usuario` para convidar alguém para sua sala.');
    }
    
    if (targetUser.bot) {
      return await replyToMessage(message, '❌ Não é possível convidar bots.');
    }
    
    if (targetUser.id === message.author.id) {
      return await replyToMessage(message, '❌ Você não pode se convidar.');
    }
    
    const result = await inviteToTempRoom(message.member, targetUser);
    await replyToMessage(message, result.message);
  } catch (error) {
    console.error('[ERRO] !convidar:', error);
    await replyToMessage(message, `❌ Erro ao convidar: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleLimparVozCommand(message, args = []) {
  try {
    // Check if user is in a temp voice channel they own
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return await replyToMessage(message, '❌ Você precisa estar em uma sala temporária para usar este comando.');
    }
    
    const { isManagedTempVoiceChannel } = require('../services/tempVoiceService');
    if (!isManagedTempVoiceChannel(voiceChannel)) {
      return await replyToMessage(message, '❌ Este comando só funciona em salas temporárias criadas pelo bot.');
    }
    
    if (!isTempRoomOwner(message.member, voiceChannel.id)) {
      return await replyToMessage(message, '❌ Apenas o dono da sala ou administradores podem limpar a sala.');
    }
    
    // Delete the channel
    const result = await deleteTempRoom(message.member);
    await replyToMessage(message, result.message);
  } catch (error) {
    console.error('[ERRO] !limparvoz:', error);
    await replyToMessage(message, `❌ Erro ao limpar sala: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleSalaCommand(message, args = []) {
  try {
    if (args.length === 0) {
      const roomId = getUserTempRoom(message.author.id, message.guild.id);
      if (!roomId) {
        return await replyToMessage(message, '❌ Você não possui uma sala temporária ativa.\nUse `!sala <novo-nome>` para renomear sua sala.');
      }
      
      const channel = message.guild.channels.cache.get(roomId);
      if (channel) {
        return await replyToMessage(message, `🔊 Sua sala atual: **${channel.name}** (${channel.members.size} membro(s))`);
      }
      return await replyToMessage(message, '❌ Sala não encontrada.');
    }
    
    // Rename command: !sala <novo-nome>
    const newName = args.join(' ');
    const result = await renameTempRoom(message.member, newName);
    await replyToMessage(message, result.message);
  } catch (error) {
    console.error('[ERRO] !sala:', error);
    await replyToMessage(message, `❌ Erro ao gerenciar sala: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleSalaLockCommand(message, args = []) {
  try {
    const { setTempRoomLock } = require('../services/tempVoiceService');
    const arg = String(args[0] || '').toLowerCase();
    const unlockWords = ['abrir', 'aberta', 'aberto', 'unlock', 'off', 'destrancar'];
    const locked = !unlockWords.includes(arg);
    const result = await setTempRoomLock(message.member, locked);
    await replyToMessage(message, result.message);
  } catch (error) {
    console.error('[ERRO] !salalock:', error);
    await replyToMessage(message, `❌ Erro ao trancar sala: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleSalaLimitCommand(message, args = []) {
  try {
    const { setTempRoomLimit } = require('../services/tempVoiceService');
    if (args.length === 0) {
      return await replyToMessage(message, '❌ Use: `!salalimit <0-99>` (0 = sem limite).');
    }
    const result = await setTempRoomLimit(message.member, args[0]);
    await replyToMessage(message, result.message);
  } catch (error) {
    console.error('[ERRO] !salalimit:', error);
    await replyToMessage(message, `❌ Erro ao mudar limite: \`${error.message}\``);
  } finally {
    if (message.deletable) await message.delete().catch(() => null);
  }
}

async function handleSalaExpulsarCommand(message, args = [], targetUserOverride = null) {
  try {
    const { kickFromTempRoom } = require('../services/tempVoiceService');
    const targetUser = targetUserOverride || message.mentions.users.first();
    if (!targetUser) {
      return await replyToMessage(message, '❌ Use: `!salaexpulsar @usuario` para remover alguém da sua sala.');
    }
    const result = await kickFromTempRoom(message.member, targetUser);
    await replyToMessage(message, result.message);
  } catch (error) {
    console.error('[ERRO] !salaexpulsar:', error);
    await replyToMessage(message, `❌ Erro ao expulsar: \`${error.message}\``);
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
  handleResultVoteButton, handleClubeCommand, handleClubeAdminCommand, handleClubeFixarCommand, handleQueroLiveCommand, handleLiveCommand,
  handleConviteCommand, handleTopConvitesCommand, handleTorneioCommand, handleTempoCommand, handleTopVozCommand,
  handleAjudaFixarCommand, buildAjudaEmbed, buildTempoEmbed, normalizePresentearTier, handlePresentearCommand, handlePalpiteCommand,
  handleMissoesCommand, handleDueloCommand,
  LIVE_COOLDOWN_BY_TIER_MS,
  handleSalaHubCommand, handleConvidarCommand, handleLimparVozCommand, handleSalaCommand,
  handleSalaLockCommand, handleSalaLimitCommand, handleSalaExpulsarCommand,
  isTournamentStaff,
  getSummonerLevelGate,
  findRecentVictoryByLetter,
  findPendingAutoStartLobby,
  resolveCleanupTargets
};
