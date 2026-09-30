async function startMatch({
  guild,
  guildId,
  lobby,
  deps
}) {
  const {
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
  } = deps;

  return withQueueOperationLock(`${guildId}:global:queue`, async () => {
    const queueData = await loadQueue();
    const currentMatchData = await loadCurrentMatch();

    if (!queueData.lobbies[lobby.id] || currentMatchData.matches[lobby.id]?.active) {
      return null;
    }

    const currentLobby = queueData.lobbies[lobby.id];
    const playersForBalance = currentLobby.players.map((player) => {
      const migrated = migrateInternalRating({
        baseMmr: player.baseMmr,
        internalRating: player.internalRating,
        customWins: player.customWins,
        customLosses: player.customLosses,
        ratingVersion: player.ratingVersion
      });

      return {
        ...player,
        ...migrated,
        mmr: calculateHybridMmr(
          migrated.baseMmr,
          migrated.customWins,
          migrated.customLosses,
          migrated.internalRating
        )
      };
    });

    const teams = createBalancedTeams(playersForBalance);
    const channels = await createTeamChannelsForLobby(guild, lobby);

    teams.mode = lobby.mode;
    teams.format = lobby.format;
    await movePlayersToTeamChannels(guild, teams, channels);

    currentMatchData.matches[lobby.id] = {
      active: true,
      votes: {},
      match: {
        ...lobby,
        teamOne: teams.teamOne,
        teamTwo: teams.teamTwo,
        teamOneChannelId: channels.teamOneChannelId,
        teamTwoChannelId: channels.teamTwoChannelId,
        teamSize: teams.teamOne.length,
        createdAt: new Date().toISOString()
      }
    };

    delete queueData.lobbies[lobby.id];
    await saveQueue(queueData);
    await saveCurrentMatch(currentMatchData);

    return { teams, chs: channels, lobby };
  });
}

module.exports = {
  startMatch
};
