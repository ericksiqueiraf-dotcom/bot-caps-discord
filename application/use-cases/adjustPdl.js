async function adjustPdl({
  guildId,
  discordId,
  delta,
  deps
}) {
  const {
    withQueueOperationLock,
    loadPlayerStats,
    savePlayerStats,
    getStoredPlayerStats,
    getModeStats,
    normalizePlayerModes,
    getStatsBucketKey,
    upsertPlayerStats,
    calculateSeedRating
  } = deps;

  const amount = Number(delta);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error('Use um valor inteiro diferente de zero. Ex: `!pdl @jogador -50`.');
  }
  if (Math.abs(amount) > 500) {
    throw new Error('Limite de 500 PDL por comando.');
  }

  // Mesmo lock da vitória: mexe no mesmo documento de stats
  return withQueueOperationLock(`${guildId}:victory`, async () => {
    const statsData = await loadPlayerStats();
    const stored = Object.values(statsData.players || {}).find((entry) => entry.discordId === discordId);
    if (!stored) {
      throw new Error('Jogador não cadastrado no sistema.');
    }

    const modeStats = getModeStats(stored, 'classic', null);
    const before = Number(modeStats.internalRating ?? calculateSeedRating(modeStats.baseMmr || 0));
    const after = Math.max(0, before + amount);
    const bucketKey = getStatsBucketKey('classic', null);

    upsertPlayerStats(statsData, stored, {
      modes: {
        ...normalizePlayerModes(stored),
        [bucketKey]: { ...modeStats, internalRating: after }
      }
    });
    await savePlayerStats(statsData);

    return {
      discordId,
      nickname: stored.registeredNickname || stored.nickname,
      before,
      after,
      applied: after - before
    };
  });
}

module.exports = {
  adjustPdl
};
