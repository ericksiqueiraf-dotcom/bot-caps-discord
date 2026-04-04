async function enterQueue({
  guild,
  guildId,
  author,
  selectedMode,
  selectedFormat,
  providedNick,
  riotService,
  deps
}) {
  const {
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
  } = deps;

  const playerStats = await loadPlayerStats();
  const allEntries = Object.values(playerStats.players || {}).filter((player) => player.discordId === author.id);
  const storedEntry = allEntries.sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0))[0] || null;
  const registeredNick = storedEntry?.registeredNickname || null;

  let rankProfile;
  let usedApiCall = false;

  if (providedNick) {
    rankProfile = await riotService.getPlayerRankProfile(providedNick);
    usedApiCall = true;
  } else if (registeredNick) {
    const storedModeStats = getModeStats(storedEntry, selectedMode, selectedFormat);
    rankProfile = {
      puuid: storedEntry.puuid,
      summonerId: storedEntry.summonerId || null,
      nickname: registeredNick,
      tier: storedEntry.tier || 'GOLD',
      rank: storedEntry.rank || 'IV',
      leaguePoints: storedEntry.leaguePoints || 0,
      mmr: storedModeStats.baseMmr || storedEntry.baseMmr || 1200,
      isFallbackUnranked: Boolean(storedEntry.isFallbackUnranked)
    };
  } else {
    return { status: 'missing_registration' };
  }

  const result = await withQueueOperationLock(`${guildId}:${selectedMode}:${selectedFormat}`, async () => {
    const queueData = await loadQueue();
    const freshStats = await loadPlayerStats();
    const alreadyInQueue = findLobbyByPlayer(queueData, author.id);

    if (alreadyInQueue) {
      return { status: 'already_in_queue', lobby: alreadyInQueue };
    }

    const storedStats = getStoredPlayerStats(freshStats, {
      discordId: author.id,
      nickname: rankProfile.nickname,
      puuid: rankProfile.puuid
    });
    const storedModeStats = getModeStats(storedStats, selectedMode, selectedFormat);
    const hybridMmr = calculateHybridMmr(
      rankProfile.mmr,
      storedModeStats.customWins,
      storedModeStats.customLosses,
      storedModeStats.internalRating
    );

    const duplicateNickname = Object.values(queueData.lobbies || {}).some((lobby) =>
      lobby.players.some((player) => player.nickname.toLowerCase() === rankProfile.nickname.toLowerCase())
    );

    if (duplicateNickname) {
      return { status: 'duplicate_nickname' };
    }

    let lobby = getOpenLobby(queueData, selectedMode, selectedFormat)
      || findReusableWaitingLobby(guild, queueData, selectedMode, selectedFormat);

    if (!lobby) {
      const letter = getNextLobbyLetter(queueData, selectedMode, selectedFormat);
      const createdLobby = await createLobbyChannels(guild, selectedMode, selectedFormat, letter);
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
      discordId: author.id,
      discordUsername: author.username,
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

    const currentModeStats = getModeStats(storedStats, selectedMode, selectedFormat);
    const updatedFields = {
      modes: {
        ...normalizePlayerModes(storedStats),
        [getStatsBucketKey(selectedMode, selectedFormat)]: {
          ...currentModeStats,
          baseMmr: rankProfile.mmr,
          internalRating: Number(currentModeStats.internalRating || 0) || calculateSeedRating(rankProfile.mmr)
        }
      }
    };

    if (usedApiCall) {
      updatedFields.registeredNickname = rankProfile.nickname;
      updatedFields.registeredAt = new Date().toISOString();
      updatedFields.tier = rankProfile.tier;
      updatedFields.rank = rankProfile.rank;
      updatedFields.leaguePoints = rankProfile.leaguePoints;
      updatedFields.baseMmr = rankProfile.mmr;
      updatedFields.puuid = rankProfile.puuid;
      updatedFields.summonerId = rankProfile.summonerId;
      updatedFields.isFallbackUnranked = Boolean(rankProfile.isFallbackUnranked);
    }

    upsertPlayerStats(
      freshStats,
      { discordId: author.id, nickname: rankProfile.nickname, puuid: rankProfile.puuid },
      updatedFields
    );

    await saveQueue(queueData);
    await savePlayerStats(freshStats);

    return {
      status: 'joined',
      lobby,
      usedApiCall,
      rankProfile
    };
  });

  return result;
}

module.exports = {
  enterQueue
};
