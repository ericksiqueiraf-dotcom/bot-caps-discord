async function handleVictoryCommandFlow({
  message,
  args,
  deps
}) {
  const {
    QUEUE_MODES,
    loadCurrentMatch,
    findActiveMatchBySelector,
    getActiveMatchEntry,
    loadSystemMeta,
    getRecentVictoryForGuild,
    formatQueueMode,
    replyToMessage,
    registerVictory,
    createRegisterVictoryDeps,
    syncMemberRankRole,
    clearMvpRoles,
    syncMvpRole,
    postMvpAnnouncement,
    getBaseQueueChannelIdByMode,
    movePlayersToVoiceChannel,
    deleteManagedChannelsForLobby,
    updateQueueDashboard,
    saveSystemMeta,
    postMatchHistoryLog,
    getSeasonDisplayLabel,
    loadSeasonMeta,
    loadPlayerStats,
    postPlayerLogs,
    postMatchSummaryToSeasonLog
  } = deps;

  const winningTeam = args[args.length - 1];
  if (!['1', '2'].includes(winningTeam)) {
    await replyToMessage(message, 'Use !vitoria 1 ou 2.');
    return;
  }

  const currentMatchData = await loadCurrentMatch();
  const matchEntry = findActiveMatchBySelector(currentMatchData, args.slice(0, -1)) || getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
  if (!matchEntry) {
    const systemMeta = await loadSystemMeta();
    const recentVictory = getRecentVictoryForGuild(systemMeta, message.guild.id);

    if (recentVictory && recentVictory.winnerTeam === winningTeam) {
      const modeLabel = formatQueueMode(recentVictory.mode);
      const formatLabel = recentVictory.mode === QUEUE_MODES.ARAM ? ` ${recentVictory.format || '5x5'}` : '';
      const lobbyLabel = recentVictory.letter ? ` lobby ${recentVictory.letter}` : ' partida recente';
      await replyToMessage(
        message,
        `⚠️ Esse resultado ja foi registrado recentemente para o${lobbyLabel} (${modeLabel}${formatLabel}).`
      );
      return;
    }

    await replyToMessage(message, 'Partida nao encontrada.');
    return;
  }

  const [matchId, entry] = matchEntry;
  const match = entry.match;
  const victoryResult = await registerVictory({
    guildId: message.guild.id,
    matchId,
    match,
    winningTeam,
    deps: createRegisterVictoryDeps()
  });
  match.winners = victoryResult.winners;
  match.losers = victoryResult.losers;

  const { winners, losers } = match;
  for (const player of [...winners, ...losers]) {
    await syncMemberRankRole(message.guild, player.discordId, player.afterRank);
  }

  const maxStreak = Math.max(...winners.map((player) => player.winStreak || 0));
  const mvps = maxStreak > 0 ? winners.filter((player) => (player.winStreak || 0) === maxStreak) : [];
  await clearMvpRoles(message.guild);
  for (const mvp of mvps) {
    await syncMvpRole(message.guild, mvp.discordId);
    await postMvpAnnouncement(message.guild, mvp);
  }

  const baseLobbyChannelId = getBaseQueueChannelIdByMode(match.mode);
  await movePlayersToVoiceChannel(message.guild, [...winners, ...losers], baseLobbyChannelId);

  await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
    match.teamOneChannelId,
    match.teamTwoChannelId,
    match.waitingChannelId
  ]);

  await replyToMessage(message, `Vitoria registrada para a Equipe ${winningTeam}!`);
  await updateQueueDashboard(message.guild);

  const finishedAt = new Date().toISOString();
  const systemMeta = await loadSystemMeta();
  await saveSystemMeta({
    ...systemMeta,
    recentVictory: {
      guildId: message.guild.id,
      matchId,
      winnerTeam: winningTeam,
      mode: match.mode,
      format: match.format,
      letter: match.letter || null,
      finishedAt
    }
  });

  await postMatchHistoryLog(message.guild, {
    winningTeam,
    modeLabel: match.mode,
    formatLabel: match.format,
    winners,
    losers,
    finishedAt,
    startedAt: match.createdAt,
    initialDifference: match.difference || 0,
    letter: match.letter || '?',
    periodLabel: getSeasonDisplayLabel(await loadSeasonMeta())
  });

  const playerDeltas = {};
  for (const player of winners) {
    playerDeltas[player.discordId] = {
      nickname: player.nickname,
      mmrBefore: player.beforeRank,
      mmrAfter: player.afterRank,
      result: 'vitoria',
      winStreak: player.winStreak || 0,
      customWins: (player.customWins || 0) + 1,
      customLosses: player.customLosses || 0
    };
  }
  for (const player of losers) {
    playerDeltas[player.discordId] = {
      nickname: player.nickname,
      mmrBefore: player.beforeRank,
      mmrAfter: player.afterRank,
      result: 'derrota',
      winStreak: 0,
      customWins: player.customWins || 0,
      customLosses: (player.customLosses || 0) + 1
    };
  }

  const teamOneAvgDelta = winners.length > 0
    ? Math.round(winners.reduce((sum, player) => sum + (player.afterRank - player.beforeRank), 0) / winners.length)
    : 0;
  const teamTwoAvgDelta = losers.length > 0
    ? Math.round(losers.reduce((sum, player) => sum + (player.afterRank - player.beforeRank), 0) / losers.length)
    : 0;
  const matchResult = {
    match: { ...match, finishedAt },
    winnerTeam: winningTeam,
    playerDeltas,
    teamOneAvgDelta: winningTeam === '1' ? teamOneAvgDelta : teamTwoAvgDelta,
    teamTwoAvgDelta: winningTeam === '1' ? teamTwoAvgDelta : teamOneAvgDelta
  };

  const freshStats = await loadPlayerStats();
  await Promise.all([
    postPlayerLogs(message.guild, matchResult, freshStats),
    postMatchSummaryToSeasonLog(message.guild, matchResult)
  ]);
}

module.exports = {
  handleVictoryCommandFlow
};
