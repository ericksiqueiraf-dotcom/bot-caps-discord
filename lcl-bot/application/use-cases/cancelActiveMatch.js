async function cancelActiveMatch({
  guild,
  currentMatchData,
  matchEntry,
  deps
}) {
  const {
    buildLobbyFromMatch,
    movePlayersToVoiceChannel,
    deleteManagedChannelsForLobby,
    loadQueue,
    saveQueue,
    saveCurrentMatch
  } = deps;

  const [matchId, entry] = matchEntry;
  const match = entry.match;
  const restoredLobby = buildLobbyFromMatch(match);

  await movePlayersToVoiceChannel(guild, restoredLobby.players, match.waitingChannelId);
  await deleteManagedChannelsForLobby(guild, match.mode, match.format, match.letter, [
    match.teamOneChannelId,
    match.teamTwoChannelId
  ]);

  const queueData = await loadQueue();
  queueData.lobbies[restoredLobby.id] = restoredLobby;
  delete currentMatchData.matches[matchId];

  await saveQueue(queueData);
  await saveCurrentMatch(currentMatchData);

  return {
    restoredLobby,
    match
  };
}

module.exports = {
  cancelActiveMatch
};
