const { calculateSeedRating, calculateHybridMmr } = require('../../services/balanceService');
const { QUEUE_MODES } = require('../constants/queueModes');
const { isGroupedAramStreakFormat, normalizeQueueFormat } = require('../constants/queueFormats');

function createEmptyModeStats(baseMmr = 0) {
  const seedRating = calculateSeedRating(baseMmr);

  return {
    customWins: 0,
    customLosses: 0,
    baseMmr: Number(baseMmr || 0),
    internalRating: seedRating,
    winStreak: 0
  };
}

function getStatsBucketKey(mode, format = null) {
  if (mode === QUEUE_MODES.ARAM && format) {
    return `aram${String(format).toLowerCase()}`;
  }

  return mode;
}

function normalizePlayerModes(player) {
  const legacyBaseMmr = Number(player.baseMmr || 0);
  const legacyWins = Number(player.customWins || 0);
  const legacyLosses = Number(player.customLosses || 0);
  const rawModes = player.modes || {};
  const normalized = {};
  const coreModes = ['classic', 'aram', 'aram1x1', 'aram2x2', 'aram3x3', 'aram4x4', 'aram5x5'];
  const allKeys = new Set([...coreModes, ...Object.keys(rawModes)]);

  for (const key of allKeys) {
    const modeStats = rawModes[key] || {};
    const baseStats = createEmptyModeStats(legacyBaseMmr);

    if (key === 'classic') {
      normalized[key] = {
        ...baseStats,
        ...modeStats,
        customWins: Number(modeStats.customWins ?? legacyWins),
        customLosses: Number(modeStats.customLosses ?? legacyLosses),
        baseMmr: Number(modeStats.baseMmr ?? legacyBaseMmr),
        internalRating: Number(modeStats.internalRating ?? calculateSeedRating(legacyBaseMmr)),
        winStreak: Number(modeStats.winStreak ?? 0)
      };
      continue;
    }

    normalized[key] = {
      ...baseStats,
      ...modeStats,
      customWins: Number(modeStats.customWins ?? 0),
      customLosses: Number(modeStats.customLosses ?? 0),
      baseMmr: Number(modeStats.baseMmr ?? legacyBaseMmr),
      internalRating: Number(modeStats.internalRating ?? calculateSeedRating(legacyBaseMmr)),
      winStreak: Number(modeStats.winStreak ?? 0)
    };
  }

  return normalized;
}

function getModeStats(player, mode, format = null) {
  const modes = normalizePlayerModes(player);
  const bucketKey = getStatsBucketKey(mode, format);

  return modes[bucketKey] || createEmptyModeStats(player.baseMmr || 0);
}

function getTopStreakModeStats(player, mode, format = null) {
  if (mode !== QUEUE_MODES.ARAM) {
    return getModeStats(player, mode, format);
  }

  const normalizedPlayer = normalizePlayerModes(player);
  const normalizedFormat = normalizeQueueFormat(format);

  if (normalizedFormat === '1x1') {
    return normalizedPlayer.aram1x1 || createEmptyModeStats(player.baseMmr || 0);
  }

  if (isGroupedAramStreakFormat(normalizedFormat) || normalizedFormat === '' || normalizedFormat === '5x5' || !normalizedFormat) {
    return normalizedPlayer.aram || createEmptyModeStats(player.baseMmr || 0);
  }

  return getModeStats(player, mode, format);
}

function mapPlayerRankingEntry(player, modeStats) {
  const baseMmr = Number(modeStats.baseMmr || 0);
  const customWins = Number(modeStats.customWins || 0);
  const customLosses = Number(modeStats.customLosses || 0);
  const totalGames = customWins + customLosses;

  return {
    ...player,
    baseMmr,
    customWins,
    customLosses,
    totalGames,
    adjustedMmr: calculateHybridMmr(baseMmr, customWins, customLosses, modeStats.internalRating),
    winRate: totalGames > 0 ? ((customWins / totalGames) * 100).toFixed(0) : '0',
    internalRating: Number(modeStats.internalRating || calculateSeedRating(baseMmr)),
    winStreak: Number(modeStats.winStreak || 0)
  };
}

function getRankedPlayersByMode(statsData, mode, format = null, seasonMeta = null) {
  const players = Object.values(statsData.players || {});
  const minGames = seasonMeta?.phase === 'official' ? 10 : 5;

  return players
    .map((player) => mapPlayerRankingEntry(player, getModeStats(player, mode, format)))
    .filter((player) => player.totalGames >= minGames)
    .sort((a, b) => {
      if (b.adjustedMmr !== a.adjustedMmr) {
        return b.adjustedMmr - a.adjustedMmr;
      }

      return b.customWins - a.customWins;
    });
}

function getRankedPlayersByStreak(statsData, mode, format = null) {
  return Object.values(statsData.players || {})
    .map((player) => mapPlayerRankingEntry(player, getTopStreakModeStats(player, mode, format)))
    .filter((player) => (player.winStreak || 0) >= 1)
    .sort((a, b) => {
      if (b.winStreak !== a.winStreak) {
        return b.winStreak - a.winStreak;
      }

      if (b.customWins !== a.customWins) {
        return b.customWins - a.customWins;
      }

      return b.adjustedMmr - a.adjustedMmr;
    })
    .slice(0, 5);
}

module.exports = {
  createEmptyModeStats,
  getStatsBucketKey,
  normalizePlayerModes,
  getModeStats,
  getTopStreakModeStats,
  getRankedPlayersByMode,
  getRankedPlayersByStreak
};
