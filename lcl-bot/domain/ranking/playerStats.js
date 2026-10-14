const { calculateSeedRating, migrateInternalRating, RATING_VERSION } = require('../../services/balanceService');
const { QUEUE_MODES } = require('../constants/queueModes');
const { isGroupedAramStreakFormat, normalizeQueueFormat } = require('../constants/queueFormats');

function createEmptyModeStats(baseMmr = 0) {
  const seedRating = calculateSeedRating(baseMmr);

  return {
    customWins: 0,
    customLosses: 0,
    baseMmr: Number(baseMmr || 0),
    internalRating: seedRating,
    winStreak: 0,
    ratingVersion: RATING_VERSION
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
      normalized[key] = migrateInternalRating({
        ...baseStats,
        ...modeStats,
        customWins: Number(modeStats.customWins ?? legacyWins),
        customLosses: Number(modeStats.customLosses ?? legacyLosses),
        baseMmr: Number(modeStats.baseMmr ?? legacyBaseMmr),
        internalRating: Number.isFinite(Number(modeStats.internalRating))
          ? Number(modeStats.internalRating)
          : undefined,
        winStreak: Number(modeStats.winStreak ?? 0),
        ratingVersion: modeStats.ratingVersion
      });
      continue;
    }

    normalized[key] = migrateInternalRating({
      ...baseStats,
      ...modeStats,
      customWins: Number(modeStats.customWins ?? 0),
      customLosses: Number(modeStats.customLosses ?? 0),
      baseMmr: Number(modeStats.baseMmr ?? legacyBaseMmr),
      internalRating: Number.isFinite(Number(modeStats.internalRating))
        ? Number(modeStats.internalRating)
        : undefined,
      winStreak: Number(modeStats.winStreak ?? 0),
      ratingVersion: modeStats.ratingVersion
    });
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

function getPureCustomScore(modeStats) {
  // Pontuacao pura base 1000, sem o elo do LoL:
  // internalRating = 1000 + baseMmr + deltas  =>  pura = internalRating - baseMmr
  const baseMmr = Number(modeStats?.baseMmr || 0);
  const raw = Number(modeStats?.internalRating);
  const internal = Number.isFinite(raw) ? raw : calculateSeedRating(baseMmr);
  return Math.round(internal - baseMmr);
}

function mapPlayerRankingEntry(player, modeStats) {
  const baseMmr = Number(modeStats.baseMmr || 0);
  const customWins = Number(modeStats.customWins || 0);
  const customLosses = Number(modeStats.customLosses || 0);
  const totalGames = customWins + customLosses;
  const internalRating = Number(modeStats.internalRating || calculateSeedRating(baseMmr));

  return {
    ...player,
    baseMmr,
    customWins,
    customLosses,
    totalGames,
    adjustedMmr: internalRating,
    customScore: getPureCustomScore({ ...modeStats, baseMmr, internalRating }),
    winRate: totalGames > 0 ? ((customWins / totalGames) * 100).toFixed(0) : '0',
    internalRating,
    winStreak: Number(modeStats.winStreak || 0)
  };
}

function getWinRateValue(player) {
  const total = Number(player.totalGames || 0);
  if (total <= 0) return 0;
  return Number(player.customWins || 0) / total;
}

const TIER_S_MIN_MMR_RANK = 2000;

function isTierSRankedEntry(entry) {
  const classicBase = Number(entry?.modes?.classic?.baseMmr ?? entry?.baseMmr ?? 0);
  if (Number.isFinite(classicBase) && classicBase >= TIER_S_MIN_MMR_RANK) return true;
  return false;
}

function getRankedPlayersByMode(statsData, mode, format = null, seasonMeta = null, options = {}) {
  const players = Object.values(statsData.players || {});
  const minGames = seasonMeta?.phase === 'official' ? 10 : 5;

  const ranked = players
    .map((player) => mapPlayerRankingEntry(player, getModeStats(player, mode, format)))
    .filter((player) => player.totalGames >= minGames)
    .filter((player) => {
      if (options?.tierSOnly && mode === QUEUE_MODES.CLASSIC) {
        const raw = Object.values(statsData.players || {}).find((entry) =>
          (entry.discordId && entry.discordId === player.discordId) || entry.nickname === player.nickname);
        return isTierSRankedEntry(raw || player);
      }
      return true;
    });

  // CLASSIC: ordena por pontos custom puros (base 1000, sem elo LoL),
  // desempatando por winrate e depois por total de jogos.
  if (mode === QUEUE_MODES.CLASSIC) {
    return ranked.sort((a, b) => {
      const bScore = Number.isFinite(Number(b.customScore)) ? Number(b.customScore) : 1000;
      const aScore = Number.isFinite(Number(a.customScore)) ? Number(a.customScore) : 1000;
      if (bScore !== aScore) {
        return bScore - aScore;
      }

      const winRateDiff = getWinRateValue(b) - getWinRateValue(a);
      if (winRateDiff !== 0) {
        return winRateDiff;
      }

      if (b.totalGames !== a.totalGames) {
        return b.totalGames - a.totalGames;
      }

      if (b.customWins !== a.customWins) {
        return b.customWins - a.customWins;
      }

      if (b.customLosses !== a.customLosses) {
        return a.customLosses - b.customLosses;
      }

      return b.internalRating - a.internalRating;
    });
  }

  return ranked.sort((a, b) => {
      if (b.customWins !== a.customWins) {
        return b.customWins - a.customWins;
      }

      if (b.customLosses !== a.customLosses) {
        return a.customLosses - b.customLosses;
      }

      if (b.adjustedMmr !== a.adjustedMmr) {
        return b.adjustedMmr - a.adjustedMmr;
      }

      return b.internalRating - a.internalRating;
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
  getPureCustomScore,
  getRankedPlayersByMode,
  getRankedPlayersByStreak,
  TIER_S_MIN_MMR_RANK,
  isTierSRankedEntry
};
