require('dotenv').config();

const {
  ensureDataFiles,
  loadQueue,
  saveQueue,
  loadPlayerStats,
  savePlayerStats,
  loadCurrentMatch,
  saveCurrentMatch,
  loadSeasonMeta,
  loadSeasonHistory,
  loadContentTemplates,
  saveContentTemplates,
  withQueueOperationLock,
  QUEUE_MODES
} = require('../services/dataService');
const { KNOWN_ARAM_FORMATS } = require('../domain/constants/queueFormats');
const {
  normalizePlayerModes,
  getModeStats,
  getStatsBucketKey,
  getRankedPlayersByMode
} = require('../domain/ranking/playerStats');
const { calculateHybridMmr, calculateSeedRating, calculateEloDelta } = require('../services/balanceService');
const { DEFAULT_CONTENT_TEMPLATES, getResolvedContentTemplates } = require('../services/contentTextService');

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatModeLabel(mode, format) {
  if (mode === QUEUE_MODES.ARAM) {
    return `ARAM ${format || '5x5'}`;
  }

  return 'CLASSIC';
}

function getPlayerEntries(statsData) {
  return Object.entries(statsData.players || {}).map(([key, player]) => ({ key, ...player }));
}

function getOverviewCards({ statsData, queueData, currentMatchData, seasonMeta, seasonHistory }) {
  const players = Object.values(statsData.players || {});
  const lobbies = Object.values(queueData.lobbies || {});
  const matches = Object.values(currentMatchData.matches || {});

  return [
    { label: 'Jogadores', value: players.length },
    { label: 'Lobbies ativos', value: lobbies.length },
    { label: 'Partidas ativas', value: matches.length },
    { label: 'Temporada atual', value: seasonMeta.currentSeason },
    { label: 'Periodo', value: seasonMeta.phase === 'official' ? 'Oficial' : 'Testes' },
    { label: 'Arquivos historicos', value: ensureArray(seasonHistory.seasons).length }
  ];
}

function buildLobbySummaries(queueData) {
  return Object.values(queueData.lobbies || {})
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((lobby) => ({
      ...lobby,
      modeLabel: formatModeLabel(lobby.mode, lobby.format),
      occupancyLabel: `${ensureArray(lobby.players).length}/${lobby.requiredPlayers}`,
      players: ensureArray(lobby.players).sort((a, b) => String(a.nickname).localeCompare(String(b.nickname)))
    }));
}

function buildMatchSummaries(currentMatchData) {
  return Object.entries(currentMatchData.matches || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([matchId, entry]) => {
      const match = entry.match || {};
      const teamOne = ensureArray(match.teamOne);
      const teamTwo = ensureArray(match.teamTwo);
      const teamOneAvg = teamOne.length > 0 ? Math.round(teamOne.reduce((sum, player) => sum + safeNumber(player.mmr, 1200), 0) / teamOne.length) : 0;
      const teamTwoAvg = teamTwo.length > 0 ? Math.round(teamTwo.reduce((sum, player) => sum + safeNumber(player.mmr, 1200), 0) / teamTwo.length) : 0;

      return {
        matchId,
        active: Boolean(entry.active),
        mode: match.mode,
        format: match.format,
        letter: match.letter,
        modeLabel: formatModeLabel(match.mode, match.format),
        createdAt: match.createdAt,
        teamOne,
        teamTwo,
        teamOneAvg,
        teamTwoAvg,
        voteCount: Object.keys(entry.votes || {}).length
      };
    });
}

function buildPlayerSummaries(statsData, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  return getPlayerEntries(statsData)
    .filter((player) => {
      if (!normalizedQuery) return true;

      return [
        player.discordId,
        player.discordUsername,
        player.registeredNickname,
        player.nickname,
        player.puuid
      ].some((field) => String(field || '').toLowerCase().includes(normalizedQuery));
    })
    .map((player) => {
      const classicStats = getModeStats(player, QUEUE_MODES.CLASSIC);
      const aramStats = getModeStats(player, QUEUE_MODES.ARAM);

      return {
        ...player,
        classicStats,
        aramStats,
        adjustedClassicMmr: calculateHybridMmr(classicStats.baseMmr, classicStats.customWins, classicStats.customLosses, classicStats.internalRating),
        adjustedAramMmr: calculateHybridMmr(aramStats.baseMmr, aramStats.customWins, aramStats.customLosses, aramStats.internalRating)
      };
    })
    .sort((a, b) => {
      if (b.adjustedClassicMmr !== a.adjustedClassicMmr) {
        return b.adjustedClassicMmr - a.adjustedClassicMmr;
      }

      return String(a.registeredNickname || '').localeCompare(String(b.registeredNickname || ''));
    });
}

function getLeaderboardPreview(statsData, seasonMeta) {
  return {
    classic: getRankedPlayersByMode(statsData, QUEUE_MODES.CLASSIC, null, seasonMeta).slice(0, 5),
    aram1x1: getRankedPlayersByMode(statsData, QUEUE_MODES.ARAM, '1x1', seasonMeta).slice(0, 5),
    aram: getRankedPlayersByMode(statsData, QUEUE_MODES.ARAM, null, seasonMeta).slice(0, 5)
  };
}

async function getDashboardViewModel(query = '') {
  await ensureDataFiles();

  const [storedTemplates, statsData, queueData, currentMatchData, seasonMeta, seasonHistory] = await Promise.all([
    loadContentTemplates(),
    loadPlayerStats(),
    loadQueue(),
    loadCurrentMatch(),
    loadSeasonMeta(),
    loadSeasonHistory()
  ]);

  return {
    overviewCards: getOverviewCards({ statsData, queueData, currentMatchData, seasonMeta, seasonHistory }),
    seasonMeta,
    leaderboardPreview: getLeaderboardPreview(statsData, seasonMeta),
    players: buildPlayerSummaries(statsData, query),
    lobbies: buildLobbySummaries(queueData),
    matches: buildMatchSummaries(currentMatchData),
    contentTemplates: getResolvedContentTemplates(storedTemplates)
  };
}

async function updateContentTemplates(payload) {
  const storedTemplates = await loadContentTemplates();
  const resolved = getResolvedContentTemplates(storedTemplates);

  const nextTemplates = {
    welcome: {
      titleTemplate: String(payload.welcomeTitleTemplate || '').trim(),
      description: String(payload.welcomeDescription || '').trim(),
      rulesTitle: String(payload.welcomeRulesTitle || '').trim(),
      rulesText: String(payload.welcomeRulesText || '').trim(),
      unlockTitle: String(payload.welcomeUnlockTitle || '').trim(),
      unlockText: String(payload.welcomeUnlockText || '').trim(),
      howToPlayTitle: String(payload.welcomeHowToPlayTitle || '').trim(),
      howToPlayText: String(payload.welcomeHowToPlayText || '').trim(),
      commandsTitle: String(payload.welcomeCommandsTitle || '').trim(),
      commandsText: String(payload.welcomeCommandsText || '').trim(),
      footerText: String(payload.welcomeFooterText || '').trim()
    },
    onboarding: {
      title: String(payload.onboardingTitle || '').trim(),
      description: String(payload.onboardingDescription || '').trim(),
      registrationTitle: String(payload.onboardingRegistrationTitle || '').trim(),
      registrationText: String(payload.onboardingRegistrationText || '').trim(),
      queueTitle: String(payload.onboardingQueueTitle || '').trim(),
      queueText: String(payload.onboardingQueueText || '').trim(),
      voteTitle: String(payload.onboardingVoteTitle || '').trim(),
      voteText: String(payload.onboardingVoteText || '').trim(),
      progressTitle: String(payload.onboardingProgressTitle || '').trim(),
      progressText: String(payload.onboardingProgressText || '').trim(),
      channelsTitle: String(payload.onboardingChannelsTitle || '').trim(),
      channelsText: String(payload.onboardingChannelsText || '').trim(),
      commandsTitle: String(payload.onboardingCommandsTitle || '').trim(),
      commandsText: String(payload.onboardingCommandsText || '').trim(),
      fairPlayTitle: String(payload.onboardingFairPlayTitle || '').trim(),
      fairPlayText: String(payload.onboardingFairPlayText || '').trim(),
      footerText: String(payload.onboardingFooterText || '').trim()
    }
  };

  for (const section of Object.keys(nextTemplates)) {
    for (const [key, value] of Object.entries(nextTemplates[section])) {
      if (!value) {
        nextTemplates[section][key] = resolved[section][key];
      }
    }
  }

  await saveContentTemplates(nextTemplates);
}

async function resetContentTemplates(section = 'all') {
  const storedTemplates = await loadContentTemplates();
  const resolved = getResolvedContentTemplates(storedTemplates);

  if (section === 'welcome') {
    await saveContentTemplates({
      ...resolved,
      welcome: { ...DEFAULT_CONTENT_TEMPLATES.welcome }
    });
    return;
  }

  if (section === 'onboarding') {
    await saveContentTemplates({
      ...resolved,
      onboarding: { ...DEFAULT_CONTENT_TEMPLATES.onboarding }
    });
    return;
  }

  await saveContentTemplates({
    welcome: { ...DEFAULT_CONTENT_TEMPLATES.welcome },
    onboarding: { ...DEFAULT_CONTENT_TEMPLATES.onboarding }
  });
}

async function updatePlayer(playerKey, payload) {
  const statsData = await loadPlayerStats();
  const player = statsData.players?.[playerKey];

  if (!player) {
    throw new Error('Jogador nao encontrado.');
  }

  const sanitizedNickname = String(payload.registeredNickname || '').trim();
  if (!sanitizedNickname) {
    throw new Error('Nick cadastrado e obrigatorio.');
  }

  const tier = String(payload.tier || 'GOLD').trim().toUpperCase();
  const rank = String(payload.rank || 'IV').trim().toUpperCase();
  const leaguePoints = Math.max(0, safeNumber(payload.leaguePoints, 0));
  const baseMmr = Math.max(0, safeNumber(payload.baseMmr, player.baseMmr || 1200));
  const internalRating = Math.max(0, safeNumber(payload.internalRating, calculateSeedRating(baseMmr)));
  const customWins = Math.max(0, safeNumber(payload.customWins, 0));
  const customLosses = Math.max(0, safeNumber(payload.customLosses, 0));
  const winStreak = Math.max(0, safeNumber(payload.winStreak, 0));
  const selectedMode = payload.mode === QUEUE_MODES.ARAM ? QUEUE_MODES.ARAM : QUEUE_MODES.CLASSIC;
  const selectedFormat = selectedMode === QUEUE_MODES.ARAM && KNOWN_ARAM_FORMATS.includes(String(payload.format || '').toLowerCase())
    ? String(payload.format).toLowerCase()
    : null;

  const bucketKey = getStatsBucketKey(selectedMode, selectedFormat);
  const currentModeStats = getModeStats(player, selectedMode, selectedFormat);
  const modes = normalizePlayerModes(player);

  modes[bucketKey] = {
    ...currentModeStats,
    baseMmr,
    internalRating,
    customWins,
    customLosses,
    winStreak
  };

  statsData.players[playerKey] = {
    ...player,
    registeredNickname: sanitizedNickname,
    tier,
    rank,
    leaguePoints,
    baseMmr,
    isFallbackUnranked: String(payload.isFallbackUnranked || '') === 'on',
    modes
  };

  await savePlayerStats(statsData);
}

async function reseedPlayer(playerKey, mode, format = null) {
  const statsData = await loadPlayerStats();
  const player = statsData.players?.[playerKey];

  if (!player) {
    throw new Error('Jogador nao encontrado.');
  }

  const bucketKey = getStatsBucketKey(mode, format);
  const modes = normalizePlayerModes(player);
  const modeStats = getModeStats(player, mode, format);

  modes[bucketKey] = {
    ...modeStats,
    internalRating: calculateSeedRating(modeStats.baseMmr)
  };

  statsData.players[playerKey] = {
    ...player,
    modes
  };

  await savePlayerStats(statsData);
}

async function removePlayerFromLobby(lobbyId, discordId) {
  await withQueueOperationLock(`admin:lobby:${lobbyId}`, async () => {
    const queueData = await loadQueue();
    const lobby = queueData.lobbies?.[lobbyId];

    if (!lobby) {
      throw new Error('Lobby nao encontrado.');
    }

    lobby.players = ensureArray(lobby.players).filter((player) => player.discordId !== discordId);

    if (lobby.players.length === 0) {
      delete queueData.lobbies[lobbyId];
    } else {
      queueData.lobbies[lobbyId] = lobby;
    }

    await saveQueue(queueData);
  });
}

async function deleteLobby(lobbyId) {
  await withQueueOperationLock(`admin:lobby:${lobbyId}`, async () => {
    const queueData = await loadQueue();

    if (!queueData.lobbies?.[lobbyId]) {
      throw new Error('Lobby nao encontrado.');
    }

    delete queueData.lobbies[lobbyId];
    await saveQueue(queueData);
  });
}

async function deleteMatch(matchId) {
  await withQueueOperationLock(`admin:match:${matchId}`, async () => {
    const currentMatchData = await loadCurrentMatch();

    if (!currentMatchData.matches?.[matchId]) {
      throw new Error('Partida nao encontrada.');
    }

    delete currentMatchData.matches[matchId];
    await saveCurrentMatch(currentMatchData);
  });
}

async function recordManualMatchResult(matchId, winnerTeam) {
  await withQueueOperationLock(`admin:match:${matchId}:result`, async () => {
    const currentMatchData = await loadCurrentMatch();
    const entry = currentMatchData.matches?.[matchId];

    if (!entry?.match) {
      throw new Error('Partida nao encontrada.');
    }

    const match = entry.match;
    const winningPlayers = String(winnerTeam) === '1' ? ensureArray(match.teamOne) : ensureArray(match.teamTwo);
    const losingPlayers = String(winnerTeam) === '1' ? ensureArray(match.teamTwo) : ensureArray(match.teamOne);
    const statsData = await loadPlayerStats();
    const bucketKey = getStatsBucketKey(match.mode, match.format);
    const teamSize = safeNumber(match.teamSize, winningPlayers.length || losingPlayers.length || 5);
    const aramWeightMap = { 1: 1.4, 2: 0.65, 3: 0.8, 4: 1, 5: 0.3 };
    const mmrWeight = match.mode === QUEUE_MODES.ARAM ? (aramWeightMap[teamSize] || 1) : 1;
    const avgWinnerOppMmr = Math.round(losingPlayers.reduce((sum, player) => sum + safeNumber(player.mmr, 1200), 0) / Math.max(1, losingPlayers.length));
    const avgLoserOppMmr = Math.round(winningPlayers.reduce((sum, player) => sum + safeNumber(player.mmr, 1200), 0) / Math.max(1, winningPlayers.length));

    for (const player of winningPlayers) {
      const playerKey = Object.keys(statsData.players || {}).find((key) => statsData.players[key].discordId === player.discordId);
      if (!playerKey) continue;

      const storedPlayer = statsData.players[playerKey];
      const modes = normalizePlayerModes(storedPlayer);
      const modeStats = modes[bucketKey];
      const games = safeNumber(modeStats.customWins) + safeNumber(modeStats.customLosses);
      const beforeRank = safeNumber(modeStats.internalRating, calculateSeedRating(modeStats.baseMmr));
      const delta = Math.round(calculateEloDelta(beforeRank, avgWinnerOppMmr, 1, games) * mmrWeight);

      modes[bucketKey] = {
        ...modeStats,
        customWins: safeNumber(modeStats.customWins) + 1,
        internalRating: Math.max(0, beforeRank + delta),
        winStreak: safeNumber(modeStats.winStreak) + 1
      };

      statsData.players[playerKey] = { ...storedPlayer, modes };
    }

    for (const player of losingPlayers) {
      const playerKey = Object.keys(statsData.players || {}).find((key) => statsData.players[key].discordId === player.discordId);
      if (!playerKey) continue;

      const storedPlayer = statsData.players[playerKey];
      const modes = normalizePlayerModes(storedPlayer);
      const modeStats = modes[bucketKey];
      const games = safeNumber(modeStats.customWins) + safeNumber(modeStats.customLosses);
      const beforeRank = safeNumber(modeStats.internalRating, calculateSeedRating(modeStats.baseMmr));
      const delta = Math.round(calculateEloDelta(beforeRank, avgLoserOppMmr, 0, games) * mmrWeight);

      modes[bucketKey] = {
        ...modeStats,
        customLosses: safeNumber(modeStats.customLosses) + 1,
        internalRating: Math.max(0, beforeRank + delta),
        winStreak: 0
      };

      statsData.players[playerKey] = { ...storedPlayer, modes };
    }

    delete currentMatchData.matches[matchId];
    await Promise.all([savePlayerStats(statsData), saveCurrentMatch(currentMatchData)]);
  });
}

module.exports = {
  getDashboardViewModel,
  updatePlayer,
  updateContentTemplates,
  resetContentTemplates,
  reseedPlayer,
  removePlayerFromLobby,
  deleteLobby,
  deleteMatch,
  recordManualMatchResult,
  QUEUE_MODES,
  KNOWN_ARAM_FORMATS
};
