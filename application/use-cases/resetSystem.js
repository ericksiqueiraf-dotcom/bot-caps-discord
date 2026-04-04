async function resetSystem({
  guild,
  deps
}) {
  const {
    loadQueue,
    loadCurrentMatch,
    deleteVoiceChannelIfExists,
    movePlayersToVoiceChannel,
    getBaseQueueChannelIdByMode,
    deleteManagedChannelsForLobby,
    saveQueue,
    saveCurrentMatch
  } = deps;

  const queueData = await loadQueue();
  const currentMatchData = await loadCurrentMatch();

  for (const lobby of Object.values(queueData.lobbies || {})) {
    await deleteVoiceChannelIfExists(guild, lobby.waitingChannelId);
  }

  for (const entry of Object.values(currentMatchData.matches || {})) {
    const match = entry.match;
    if (!match) {
      continue;
    }

    const players = [...(match.teamOne || []), ...(match.teamTwo || [])];
    await movePlayersToVoiceChannel(guild, players, getBaseQueueChannelIdByMode(match.mode));
    await deleteManagedChannelsForLobby(guild, match.mode, match.format, match.letter, [
      match.waitingChannelId,
      match.teamOneChannelId,
      match.teamTwoChannelId
    ]);
  }

  await saveQueue({ lobbies: {} });
  await saveCurrentMatch({ matches: {} });
}

module.exports = {
  resetSystem
};
