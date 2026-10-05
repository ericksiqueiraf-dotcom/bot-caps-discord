const config = require('../../config.json');

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
    syncInfernalRolesAfterMatch,
    postInfernalAnnouncement,
    startMvpVote,
    getPostMatchVoiceChannelId,
    movePlayersToVoiceChannel,
    deleteManagedChannelsForLobby,
    updateQueueDashboard,
    saveSystemMeta,
    postMatchHistoryLog,
    getSeasonDisplayLabel,
    loadSeasonMeta,
    loadPlayerStats,
    postPlayerLogs,
    postMatchSummaryToSeasonLog,
    postSmurfAlerts
  } = deps;

  const teamArgs = args.filter((arg) => ['1', '2'].includes(String(arg)));
  if (teamArgs.length !== 1) {
    await replyToMessage(message, 'Use `!vitoria A 1` ou `!vitoria 1 A`.');
    return;
  }
  const winningTeam = teamArgs[0];
  const selectorArgs = args.filter((arg) => String(arg) !== winningTeam);

  // Verifica se o usuário tem permissão de staff (ManageMessages ou Administrator) ou cargo de capitão
  // _isAutoVote é true quando a vitória foi disparada automaticamente pelo sistema de votos
  const captainRoleId = config.roles?.captainRoleId;
  const hasCaptainRole = captainRoleId && message.member?.roles?.cache?.has(captainRoleId);
  const hasStaffPermission = message._isAutoVote === true ||
                             message.member?.permissions?.has('ManageMessages') ||
                             message.member?.permissions?.has('Administrator') ||
                             hasCaptainRole;
  if (!hasStaffPermission) {
    await replyToMessage(message, '❌ Apenas staff ou capitães podem registrar vitórias manualmente. Use `!votar 1` ou `!votar 2` para votar.');
    return;
  }

  const currentMatchData = await loadCurrentMatch();
  const matchEntry = selectorArgs.length > 0
    ? findActiveMatchBySelector(currentMatchData, selectorArgs)
    : getActiveMatchEntry(currentMatchData, message.member.voice?.channelId);
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
  console.log(`[VITORIA] Sala ${match.letter} (${match.mode} ${match.format}) | equipe ${winningTeam} | comando: ${args.join(' ')}`);
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

  // INFERNAL: cargo automatico para 5+ vitorias seguidas (vale ate as 08h; derrota nao tira na hora)
  // + anuncio dos recem-premiados no canal de destaques. Nunca quebra o !vitoria.
  try {
    const infernalAwarded = await syncInfernalRolesAfterMatch(message.guild, winners, losers);
    await postInfernalAnnouncement(message.guild, infernalAwarded);
    if (Array.isArray(infernalAwarded?.failed) && infernalAwarded.failed.length > 0) {
      await replyToMessage(message, `⚠️ INFERNAL com ${infernalAwarded.failed.length} falha(s): ${infernalAwarded.failed.map((f) => `${f.discordId} (${f.error})`).join(', ')}`);
    }
  } catch (err) {
    console.error('[INFERNAL] Falha no pos-jogo:', err.message);
  }

  // MVP: votacao de 2 min entre os jogadores da partida + cargo MVP player ao mais votado.
  // Se ninguem votar, o encerramento usa fallback automatico (maior ganho de rating).
  await startMvpVote(message.guild, match, winners, losers);

  // Pos-partida: todos voltam para a Sala de Espera (nao para o lobby da fila)
  const postMatchChannelId = getPostMatchVoiceChannelId(match.mode);
  await movePlayersToVoiceChannel(message.guild, [...winners, ...losers], postMatchChannelId);

  await deleteManagedChannelsForLobby(message.guild, match.mode, match.format, match.letter, [
    match.teamOneChannelId,
    match.teamTwoChannelId,
    match.waitingChannelId
  ]);

  await replyToMessage(message, `Vitoria registrada para a Equipe ${winningTeam}!`);
  await updateQueueDashboard(message.guild);

  const finishedAt = new Date().toISOString();
  const finishedTeams = {
    teamOne: (match.teamOne || []).map((player) => ({ discordId: player.discordId, nickname: player.nickname })),
    teamTwo: (match.teamTwo || []).map((player) => ({ discordId: player.discordId, nickname: player.nickname }))
  };
  const systemMeta = await loadSystemMeta();
  const finishedEntry = {
    guildId: message.guild.id,
    matchId,
    winnerTeam: winningTeam,
    mode: match.mode,
    format: match.format,
    letter: match.letter || null,
    finishedAt,
    ...finishedTeams
  };
  // Historico curto das ultimas partidas finalizadas (p/ !rematch <letra>).
  // O recentVictory (ultima) e mantido como antes para o anti-duplo do !vitoria.
  const recentVictories = [finishedEntry, ...((systemMeta.recentVictories || []).filter((e) => e && e.matchId !== matchId))].slice(0, 5);
  await saveSystemMeta({
    ...systemMeta,
    recentVictory: finishedEntry,
    recentVictories
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
    postMatchSummaryToSeasonLog(message.guild, matchResult),
    postSmurfAlerts(message.guild, match, freshStats)
  ]);
}

module.exports = {
  handleVictoryCommandFlow
};
