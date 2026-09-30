const voteCooldowns = new Map();

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
    withQueueOperationLock,
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

  const now = Date.now();
  if (voteCooldowns.has(message.author.id)) {
    const lastVote = voteCooldowns.get(message.author.id);
    if (now - lastVote < 30000) {
      await replyToMessage(message, `⏳ Aguarde mais ${Math.ceil((30000 - (now - lastVote)) / 1000)}s antes de registrar outro voto.`);
      return;
    }
  }
  voteCooldowns.set(message.author.id, now);

  // Lock por guild no registro do voto: votos simultaneos em partidas A e B
  // fazem read-modify-write no mesmo documento e um apagaria o outro.
  // A vitoria automatica (threshold) roda FORA do lock para nao dar deadlock
  // com o lock de mesma chave usado pelo registerVictory.
  const voteOutcome = await withQueueOperationLock(`${message.guild.id}:victory`, async () => {
    const currentMatchData = await loadCurrentMatch();
    const matchEntry = Object.entries(currentMatchData.matches || {}).find(([, entry]) => {
      if (!entry.active || !entry.match) return false;
      const { teamOne = [], teamTwo = [] } = entry.match;
      return [...teamOne, ...teamTwo].some((player) => player.discordId === message.author.id);
    });

    if (!matchEntry) {
      return { status: 'no_match' };
    }

    const teamSize = matchEntry[1].match.teamOne.length;
    const currentThreshold = deps.getVoteThreshold ? deps.getVoteThreshold(teamSize) : VOTE_THRESHOLD;

    const voteResult = await castVictoryVote({
      currentMatchData,
      matchEntry,
      voterId: message.author.id,
      teamVote,
      voteThreshold: currentThreshold,
      deps: createCastVictoryVoteDeps()
    });

    return { status: voteResult.status, voteResult, currentThreshold, matchLetter: matchEntry[1].match.letter };
  });

  if (voteOutcome.status === 'no_match') {
    await replyToMessage(message, '❌ Voce nao esta em nenhuma partida ativa.');
    return;
  }

  const { voteResult, currentThreshold } = voteOutcome;

  if (voteResult.status === 'already_voted') {
    await replyToMessage(message, `⚠️ Voce ja votou no **Time ${voteResult.previousVote}** nesta partida.`);
    return;
  }

  if (voteResult.status === 'threshold_reached') {
    await replyToMessage(
      message,
      `🗳️ **${currentThreshold} votos atingidos!** Registrando vitoria do **Time ${voteResult.winnerTeam}** automaticamente...`
    );
    // Repassa a letra da partida para mirar a partida certa quando houver A e B ativas
    const victoryArgs = voteOutcome.matchLetter ? [voteResult.winnerTeam, voteOutcome.matchLetter] : [voteResult.winnerTeam];
    await handleVictoryCommand(message, victoryArgs);
    return;
  }

  const bar1 = '🟦'.repeat(voteResult.votesT1) + '⬜'.repeat(Math.max(0, currentThreshold - voteResult.votesT1));
  const bar2 = '🟥'.repeat(voteResult.votesT2) + '⬜'.repeat(Math.max(0, currentThreshold - voteResult.votesT2));
  await replyToMessage(
    message,
    `🗳️ Voto registrado! Placar atual:\n` +
    `Time 1: ${bar1} (${voteResult.votesT1}/${currentThreshold})\n` +
    `Time 2: ${bar2} (${voteResult.votesT2}/${currentThreshold})\n` +
    `_Precisa de ${currentThreshold} votos para confirmar. Total: ${voteResult.totalVotes} votos._`
  );
}

module.exports = {
  handleStartCommandFlow,
  handleVoteCommandFlow
};
