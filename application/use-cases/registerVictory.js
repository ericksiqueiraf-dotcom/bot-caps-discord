async function registerVictory({
  guildId,
  matchId,
  match,
  winningTeam,
  deps
}) {
  const {
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
  } = deps;

  const winningPlayers = winningTeam === '1' ? match.teamOne : match.teamTwo;
  const losingPlayers = winningTeam === '1' ? match.teamTwo : match.teamOne;
  const mmrWeight = match.mode === QUEUE_MODES.ARAM
    ? getAramWeightByTeamSize(match.teamSize || Number(String(match.format || '5x5').split('x')[0]))
    : 1;
  const avgWinnerOppMmr = Math.round(losingPlayers.reduce((sum, player) => sum + Number(player.mmr || 1200), 0) / (losingPlayers.length || 1));
  const avgLoserOppMmr = Math.round(winningPlayers.reduce((sum, player) => sum + Number(player.mmr || 1200), 0) / (winningPlayers.length || 1));

  return withQueueOperationLock(`${guildId}:victory:${matchId}`, async () => {
    const currentMatchData = await loadCurrentMatch();
    const currentEntry = currentMatchData.matches[matchId];

    if (!currentEntry) {
      throw new Error('A partida ja foi finalizada ou nao existe mais.');
    }

    const statsData = await loadPlayerStats();
    const winners = [];
    const losers = [];

    for (const player of winningPlayers) {
      const storedStats = getStoredPlayerStats(statsData, player);
      const modeStats = getModeStats(storedStats, match.mode, match.format);
      const beforeRank = modeStats.internalRating || 0;
      const beforeRecord = formatCustomRecord(modeStats);
      const delta = Math.round(
        calculateEloDelta(beforeRank, avgWinnerOppMmr, 1, (modeStats.customWins || 0) + (modeStats.customLosses || 0)) * mmrWeight
      );
      const afterRank = beforeRank + delta;
      const bucketKey = getStatsBucketKey(match.mode, match.format);
      const updatedModes = {
        ...normalizePlayerModes(storedStats),
        [bucketKey]: {
          ...modeStats,
          customWins: (modeStats.customWins || 0) + 1,
          internalRating: afterRank,
          winStreak: (modeStats.winStreak || 0) + 1
        }
      };

      if (shouldMirrorAramGroupedStats(match.mode, match.format)) {
        const groupedStats = getModeStats(storedStats, QUEUE_MODES.ARAM, null);
        updatedModes.aram = {
          ...groupedStats,
          customWins: (groupedStats.customWins || 0) + 1,
          internalRating: afterRank,
          winStreak: (groupedStats.winStreak || 0) + 1
        };
      }

      upsertPlayerStats(statsData, player, { modes: updatedModes });
      winners.push({
        ...player,
        beforeRank,
        afterRank,
        beforeRecord,
        afterRecord: formatCustomRecord(updatedModes[bucketKey]),
        ratingDelta: delta,
        winStreak: (modeStats.winStreak || 0) + 1
      });
    }

    for (const player of losingPlayers) {
      const storedStats = getStoredPlayerStats(statsData, player);
      const modeStats = getModeStats(storedStats, match.mode, match.format);
      const beforeRank = modeStats.internalRating || 0;
      const beforeRecord = formatCustomRecord(modeStats);
      const delta = Math.round(
        calculateEloDelta(beforeRank, avgLoserOppMmr, 0, (modeStats.customWins || 0) + (modeStats.customLosses || 0)) * mmrWeight
      );
      const afterRank = Math.max(0, beforeRank + delta);
      const bucketKey = getStatsBucketKey(match.mode, match.format);
      const updatedModes = {
        ...normalizePlayerModes(storedStats),
        [bucketKey]: {
          ...modeStats,
          customLosses: (modeStats.customLosses || 0) + 1,
          internalRating: afterRank,
          winStreak: 0
        }
      };

      if (shouldMirrorAramGroupedStats(match.mode, match.format)) {
        const groupedStats = getModeStats(storedStats, QUEUE_MODES.ARAM, null);
        updatedModes.aram = {
          ...groupedStats,
          customLosses: (groupedStats.customLosses || 0) + 1,
          internalRating: afterRank,
          winStreak: 0
        };
      }

      upsertPlayerStats(statsData, player, { modes: updatedModes });
      losers.push({
        ...player,
        beforeRank,
        afterRank,
        beforeRecord,
        afterRecord: formatCustomRecord(updatedModes[bucketKey]),
        ratingDelta: delta
      });
    }

    await savePlayerStats(statsData);
    delete currentMatchData.matches[matchId];
    await saveCurrentMatch(currentMatchData);

    return {
      winners,
      losers,
      winningPlayers,
      losingPlayers,
      mmrWeight,
      avgWinnerOppMmr,
      avgLoserOppMmr
    };
  });
}

module.exports = {
  registerVictory
};
