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
    createTeamChannelsForLobby,
    movePlayersToTeamChannels
  } = deps;

  return withQueueOperationLock(`${guildId}:start:${lobby.id}`, async () => {
    const queueData = await loadQueue();
    const currentMatchData = await loadCurrentMatch();

    if (!queueData.lobbies[lobby.id] || currentMatchData.matches[lobby.id]?.active) {
      return null;
    }

    const teams = createBalancedTeams(lobby.players);
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
