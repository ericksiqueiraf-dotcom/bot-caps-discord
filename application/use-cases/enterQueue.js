async function enterQueue({
  guild,
  guildId,
  author,
  selectedMode,
  selectedFormat,
  providedNick,
  riotService,
  deps,
  selectedTier = null,
  member = null
}) {
  const {
    loadPlayerStats,
    loadQueue,
    loadCurrentMatch,
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
    applyLeagueMmrChange
  } = deps;

  const playerStats = await loadPlayerStats();
  const allEntries = Object.values(playerStats.players || {}).filter((player) => player.discordId === author.id);
  const storedEntry = allEntries.sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0))[0] || null;
  const registeredNick = storedEntry?.registeredNickname || storedEntry?.nickname || null;

  let rankProfile;
  let usedApiCall = false;

  if (!registeredNick) {
    return { status: 'missing_registration' };
  }

  if (providedNick) {
    rankProfile = await riotService.getPlayerRankProfile(providedNick);
    usedApiCall = true;
  } else {
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
  }

  const result = await withQueueOperationLock(`${guildId}:global:queue`, async () => {
    const queueData = await loadQueue();
    const currentMatchData = await loadCurrentMatch();
    const freshStats = await loadPlayerStats();
    const alreadyInQueue = findLobbyByPlayer(queueData, author.id);

    if (alreadyInQueue) {
      return { status: 'already_in_queue', lobby: alreadyInQueue };
    }

    const waitingListKey = `${selectedMode}:${selectedFormat || '5x5'}`;
    const waitingList = Array.isArray(queueData.waitingLists?.[waitingListKey])
      ? queueData.waitingLists[waitingListKey]
      : [];
    const waitingPosition = waitingList.findIndex((player) => player.discordId === author.id);

    if (waitingList.length > 0 && waitingPosition !== 0) {
      // INFERNAL no top5 pode entrar mesmo sem ser o 1o (furo da !espera converte em vaga)
      const meEntry = Object.values(freshStats.players || {}).find((entry) => entry.discordId === author.id) || null;
      const infernalValid = meEntry?.infernalExpiresAt && new Date(meEntry.infernalExpiresAt).getTime() > Date.now();
      const inTop5 = waitingPosition >= 0 && waitingPosition < 5;
      if (!(infernalValid && inTop5)) {
        return {
          status: 'waiting_list_priority',
          position: waitingPosition === -1 ? null : waitingPosition + 1
        };
      }
    }

    const storedStats = getStoredPlayerStats(freshStats, {
      discordId: author.id,
      nickname: rankProfile.nickname,
      puuid: rankProfile.puuid
    });
    // Gate TIER S: lobby S exige Esmeralda IV+ (elo ou cargo). Sem bypass:
    // staff sem o elo pode organizar (voz/comandos), mas NAO entra com !entrar.
    if (selectedTier === 'S' && selectedMode === 'classic') {
      const { isTierSEligibleByStats, isTierSEligibleMember } = deps;
      const eligibleByStats = isTierSEligibleByStats
        ? isTierSEligibleByStats({ baseMmr: Number(rankProfile.mmr || 0), tier: rankProfile.tier })
          || isTierSEligibleByStats({ baseMmr: Number(storedStats?.baseMmr || 0), tier: storedStats?.tier })
        : true;
      const eligibleByRole = !isTierSEligibleMember || !member ? true : isTierSEligibleMember(member, storedStats);
      if (!eligibleByStats && !eligibleByRole) {
        return { status: 'tierS_denied' };
      }
    }
    const storedModeStats = getModeStats(storedStats, selectedMode, selectedFormat);
    const leagueMmr = Number(rankProfile.mmr || storedModeStats.baseMmr || 1200);
    const balancedModeStats = applyLeagueMmrChange(storedModeStats, leagueMmr);
    const balanceMmr = calculateHybridMmr(
      leagueMmr,
      balancedModeStats.customWins,
      balancedModeStats.customLosses,
      balancedModeStats.internalRating
    );

    const duplicateNickname = Object.values(queueData.lobbies || {}).some((lobby) =>
      lobby.players.some((player) => player.nickname.toLowerCase() === rankProfile.nickname.toLowerCase())
    );

    if (duplicateNickname) {
      return { status: 'duplicate_nickname' };
    }

    const tierFilter = selectedMode === 'classic' ? (selectedTier === 'S' ? 'S' : 'normal') : null;
    let lobby = (getOpenLobby(queueData, selectedMode, selectedFormat, tierFilter)
      || findReusableWaitingLobby(guild, queueData, currentMatchData, selectedMode, selectedFormat));

    // Reuso pode trazer lobby do tier errado; garante o tier certo
    if (lobby && selectedMode === 'classic') {
      const { getLobbyTier } = deps;
      const lobbyTier = getLobbyTier ? getLobbyTier(lobby) : 'normal';
      if ((selectedTier === 'S' ? 'S' : 'normal') !== lobbyTier) lobby = null;
    }

    if (!lobby) {
      const letter = getNextLobbyLetter(queueData, currentMatchData, selectedMode, selectedFormat);
      const createdLobby = await createLobbyChannels(guild, selectedMode, selectedFormat, letter, selectedTier === 'S' ? 'S' : null);
      lobby = {
        id: `${selectedMode}-${selectedFormat}-${selectedTier === 'S' ? 's-' : ''}${letter.toLowerCase()}`,
        mode: selectedMode,
        format: selectedFormat,
        tier: selectedTier === 'S' ? 'S' : 'normal',
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
      baseMmr: leagueMmr,
      customWins: balancedModeStats.customWins || 0,
      customLosses: balancedModeStats.customLosses || 0,
      mmr: balanceMmr,
      internalRating: balancedModeStats.internalRating,
      ratingVersion: balancedModeStats.ratingVersion,
      puuid: rankProfile.puuid,
      summonerId: rankProfile.summonerId,
      mode: selectedMode,
      format: selectedFormat,
      joinedAt: new Date().toISOString()
    });
    queueData.lobbies[lobby.id] = lobby;

    for (const [listKey, players] of Object.entries(queueData.waitingLists || {})) {
      if (!Array.isArray(players)) continue;

      const remainingPlayers = players.filter((player) => player.discordId !== author.id);
      if (remainingPlayers.length === 0) {
        delete queueData.waitingLists[listKey];
      } else {
        queueData.waitingLists[listKey] = remainingPlayers;
      }
    }

    const currentModeStats = getModeStats(storedStats, selectedMode, selectedFormat);
    const updatedFields = {
      modes: {
        ...normalizePlayerModes(storedStats),
        [getStatsBucketKey(selectedMode, selectedFormat)]: applyLeagueMmrChange(currentModeStats, leagueMmr)
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
