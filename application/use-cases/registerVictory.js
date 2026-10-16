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
    formatCustomRecord,
    getPdlMultiplier,
    onVictoryPdlApplied
  } = deps;

  const winningPlayers = winningTeam === '1' ? match.teamOne : match.teamTwo;
  const losingPlayers = winningTeam === '1' ? match.teamTwo : match.teamOne;
  const mmrWeight = match.mode === QUEUE_MODES.ARAM
    ? getAramWeightByTeamSize(match.teamSize || Number(String(match.format || '5x5').split('x')[0]))
    : 1;
  const avgWinnerOppMmr = Math.round(losingPlayers.reduce((sum, player) => sum + Number(player.mmr || player.internalRating || 0), 0) / (losingPlayers.length || 1));
  const avgLoserOppMmr = Math.round(winningPlayers.reduce((sum, player) => sum + Number(player.mmr || player.internalRating || 0), 0) / (winningPlayers.length || 1));

  // Lock por guild (nao por partida): duas vitorias simultaneas (A e B) fazem
  // read-modify-write no MESMO documento de stats. Com lock por match elas
  // corriam em paralelo e o ultimo save apagava o resultado do outro.
  return withQueueOperationLock(`${guildId}:victory`, async () => {
    const currentMatchData = await loadCurrentMatch();
    const currentEntry = currentMatchData.matches[matchId];

    if (!currentEntry) {
      throw new Error('A partida ja foi finalizada ou nao existe mais.');
    }

    const statsData = await loadPlayerStats();
    const winners = [];
    const losers = [];
    const pdlMultiplier = typeof getPdlMultiplier === 'function' ? Number(getPdlMultiplier()) || 1 : 1;
    const hojeSP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    for (const player of winningPlayers) {
      const storedStats = getStoredPlayerStats(statsData, player);
      const modeStats = getModeStats(storedStats, match.mode, match.format);
      const beforeRank = modeStats.internalRating || 0;
      const beforeRecord = formatCustomRecord(modeStats);
      const delta = Math.round(
        calculateEloDelta(beforeRank, avgWinnerOppMmr, 1, (modeStats.customWins || 0) + (modeStats.customLosses || 0)) * mmrWeight * pdlMultiplier
      );
      // Bônus primeira vitória do dia (+50%).
      let firstWinBonus = 0;
      if (storedStats?.ultimaVitoriaEm !== hojeSP) {
        firstWinBonus = Math.round(delta * 0.5);
      }
      const afterRank = beforeRank + delta + firstWinBonus;
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

      upsertPlayerStats(statsData, player, { modes: updatedModes, ultimaVitoriaEm: hojeSP });
      winners.push({
        ...player,
        beforeRank,
        afterRank,
        beforeRecord,
        afterRecord: formatCustomRecord(updatedModes[bucketKey]),
        ratingDelta: delta + firstWinBonus,
        firstWinBonus,
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

    // Bolão: quem apostou no time vencedor divide o bolo proporcionalmente.
    // (A aposta foi debitada na hora do !palpite; aqui só credita os ganhadores.)
    const payouts = [];
    const palpites = currentEntry.palpites || {};
    const bettorIds = Object.keys(palpites);
    const allMatchPlayers = [...winningPlayers, ...losingPlayers];
    if (bettorIds.length > 0) {
      const pool = bettorIds.reduce((s, id) => s + Number(palpites[id]?.pontos || 0), 0);
      const winPool = bettorIds
        .filter((id) => String(palpites[id]?.time) === String(winningTeam))
        .reduce((s, id) => s + Number(palpites[id]?.pontos || 0), 0);
      if (pool > 0 && winPool > 0) {
        for (const id of bettorIds) {
          if (String(palpites[id]?.time) !== String(winningTeam)) continue;
          const credit = Math.floor(Number(palpites[id].pontos) * pool / winPool);
          if (credit <= 0) continue;
          const bPlayer = allMatchPlayers.find((p) => p.discordId === id) || { discordId: id };
          const bStored = getStoredPlayerStats(statsData, bPlayer);
          if (!bStored) continue;
          const bModes = getModeStats(bStored, match.mode, match.format);
          const bKey = getStatsBucketKey(match.mode, match.format);
          upsertPlayerStats(statsData, bPlayer, {
            modes: { ...normalizePlayerModes(bStored), [bKey]: { ...bModes, internalRating: Number(bModes.internalRating || 0) + credit } }
          });
          payouts.push({ discordId: id, valor: credit });
        }
      }
    }

    await savePlayerStats(statsData);
    delete currentMatchData.matches[matchId];
    await saveCurrentMatch(currentMatchData);

    if (typeof onVictoryPdlApplied === 'function') {
      await onVictoryPdlApplied({ guildId, matchId, match, winners, winningTeam, pdlMultiplier }).catch(() => null);
    }

    return {
      winners,
      losers,
      winningPlayers,
      losingPlayers,
      mmrWeight,
      pdlMultiplier,
      payouts,
      avgWinnerOppMmr,
      avgLoserOppMmr
    };
  });
}

module.exports = {
  registerVictory
};
