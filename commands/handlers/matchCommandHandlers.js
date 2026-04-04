async function handleStartCommandFlow({
  message,
  args,
  deps
}) {
  const {
    loadQueue,
    findLobbyBySelector,
    findLobbyByChannelId,
    startMatch,
    createStartMatchDeps,
    pendingAutoStarts,
    sendMatchStartAnnouncement,
    updateQueueDashboard,
    buildTeamsEmbed,
    replyToMessage,
    config
  } = deps;

  const queueData = await loadQueue();
  const lobby = findLobbyBySelector(queueData, args) || findLobbyByChannelId(queueData, message.member.voice?.channelId);
  if (!lobby || lobby.players.length < lobby.requiredPlayers) {
    return await replyToMessage(message, 'Fila incompleta ou lobby invalido.');
  }

  const useCaseResult = await startMatch({
    guild: message.guild,
    guildId: message.guild.id,
    lobby,
    deps: createStartMatchDeps()
  });

  if (!useCaseResult) {
    return await replyToMessage(message, 'Partida ja iniciada ou lobby nao encontrado.');
  }

  const pendingTimeout = pendingAutoStarts.get(lobby.id);
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingAutoStarts.delete(lobby.id);
  }

  await sendMatchStartAnnouncement(message.guild, useCaseResult.teams);
  await updateQueueDashboard(message.guild);

  const commandChannelId = message.channelId || message.channel?.id || null;
  if (commandChannelId !== config.textChannels.matchOngoingChannelId) {
    await replyToMessage(message, { embeds: [buildTeamsEmbed(useCaseResult.teams, useCaseResult.chs, useCaseResult.lobby)] });
  }
}

async function handleVoteCommandFlow({
  message,
  args,
  deps
}) {
  const {
    VOTE_THRESHOLD,
    loadCurrentMatch,
    castVictoryVote,
    createCastVictoryVoteDeps,
    replyToMessage,
    handleVictoryCommand
  } = deps;

  const teamVote = args[args.length - 1];
  if (!['1', '2'].includes(teamVote)) {
    await replyToMessage(message, '❌ Use `!votar 1` ou `!votar 2` para votar no time vencedor.');
    return;
  }

  const currentMatchData = await loadCurrentMatch();
  const matchEntry = Object.entries(currentMatchData.matches || {}).find(([, entry]) => {
    if (!entry.active || !entry.match) return false;
    const { teamOne = [], teamTwo = [] } = entry.match;
    return [...teamOne, ...teamTwo].some((player) => player.discordId === message.author.id);
  });

  if (!matchEntry) {
    await replyToMessage(message, '❌ Voce nao esta em nenhuma partida ativa.');
    return;
  }

  const voteResult = await castVictoryVote({
    currentMatchData,
    matchEntry,
    voterId: message.author.id,
    teamVote,
    voteThreshold: VOTE_THRESHOLD,
    deps: createCastVictoryVoteDeps()
  });

  if (voteResult.status === 'already_voted') {
    await replyToMessage(message, `⚠️ Voce ja votou no **Time ${voteResult.previousVote}** nesta partida.`);
    return;
  }

  if (voteResult.status === 'threshold_reached') {
    await replyToMessage(
      message,
      `🗳️ **${VOTE_THRESHOLD} votos atingidos!** Registrando vitoria do **Time ${voteResult.winnerTeam}** automaticamente...`
    );
    await handleVictoryCommand(message, [voteResult.winnerTeam]);
    return;
  }

  const bar1 = '🟦'.repeat(voteResult.votesT1) + '⬜'.repeat(VOTE_THRESHOLD - voteResult.votesT1);
  const bar2 = '🟥'.repeat(voteResult.votesT2) + '⬜'.repeat(VOTE_THRESHOLD - voteResult.votesT2);
  await replyToMessage(
    message,
    `🗳️ Voto registrado! Placar atual:\n` +
    `Time 1: ${bar1} (${voteResult.votesT1}/${VOTE_THRESHOLD})\n` +
    `Time 2: ${bar2} (${voteResult.votesT2}/${VOTE_THRESHOLD})\n` +
    `_Precisa de ${VOTE_THRESHOLD} votos para confirmar. Total: ${voteResult.totalVotes} votos._`
  );
}

module.exports = {
  handleStartCommandFlow,
  handleVoteCommandFlow
};
