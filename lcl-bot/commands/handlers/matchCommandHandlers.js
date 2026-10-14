const voteCooldowns = new Map();

const { electDestinationGuild, playersNeedingInvite, lobbyOriginGuilds } = require('../../domain/shared/pool');
const { createMatchInvite, buildInterInviteMessage, sendInterInvites } = require('../../services/inviteService');

// Núcleo do start em lobby shared: elege destino, cria na destino,
// convida (só no match pronto), anuncia e atualiza todas as origens.
// Retorna {ok, match, teams, inviteUrl, dmFailed} ou {ok:false, reason}.
async function startSharedMatchCore({ client, guild, lobby, deps }) {
  const {
    startMatch,
    createStartMatchDeps,
    pendingAutoStarts,
    updateSharedDashboards,
    announceMatchStartShared,
    buildTeamsEmbed,
    config
  } = deps;

  const election = electDestinationGuild(lobby, {
    fallbackGuildId: guild.id,
    lastJoinedGuildId: guild.id,
    preferredHostGuildId: config?.inter?.preferredHostGuildId || null
  });
  let destGuild = guild;
  if (String(election) !== String(guild.id)) {
    destGuild = await client?.guilds?.fetch(String(election)).catch(() => null);
  }
  if (!destGuild) {
    return { ok: false, reason: 'destination_unreachable' };
  }

  const useCaseResult = await startMatch({
    guild: destGuild,
    guildId: destGuild.id,
    lobby,
    deps: createStartMatchDeps(),
    destinationGuildId: destGuild.id
  });

  if (!useCaseResult) {
    return { ok: false, reason: 'already_started' };
  }

  const pendingTimeout = pendingAutoStarts.get(lobby.id);
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingAutoStarts.delete(lobby.id);
  }

  // Invite SÓ no match pronto, para quem precisa trocar de servidor.
  let inviteUrl = null;
  const needInvite = playersNeedingInvite(lobby.players, destGuild.id);
  if (needInvite.length > 0) {
    try {
      const inviteChannelId = config?.inter?.inviteChannelId || config?.textChannels?.matchOngoingChannelId;
      const inviteChannel = inviteChannelId
        ? await destGuild.channels.fetch(String(inviteChannelId)).catch(() => null)
        : null;
      if (inviteChannel && typeof inviteChannel.createInvite === 'function') {
        const inviteRes = await createMatchInvite(inviteChannel, {
          maxUses: Math.max(needInvite.length + 2, 6),
          reason: `Shared ${lobby.mode} ${lobby.format} ${lobby.letter} (${lobby.id})`
        });
        if (inviteRes.ok) inviteUrl = inviteRes.invite.url;
      }
    } catch (err) {
      console.warn('[SHARED] Falha ao criar invite:', err.message);
    }
  }

  // DMs para quem precisa trocar de servidor (falha nunca bloqueia).
  let dmFailed = [];
  if (needInvite.length > 0 && inviteUrl) {
    try {
      const fetchUser = async (id) => {
        const member = await destGuild.members.fetch(String(id)).catch(() => null);
        if (member?.user) return member.user;
        return client?.users?.fetch(String(id)).catch(() => null);
      };
      const text = buildInterInviteMessage({
        teamName: `Sala ${lobby.letter}`,
        opponentName: `${lobby.mode.toUpperCase()} ${lobby.format || ''}`.trim(),
        serie: 'MD1',
        inviteUrl,
        arenaName: destGuild.name
      });
      const res = await sendInterInvites(fetchUser, needInvite.map((p) => p.discordId), text);
      dmFailed = res.dmFailed;
    } catch (err) {
      console.warn('[SHARED] Falha nas DMs:', err.message);
    }
  }

  const currentMatchData = await deps.loadCurrentMatch();
  const savedMatch = currentMatchData.matches?.[lobby.id]?.match || null;

  await announceMatchStartShared(client, savedMatch || {
    playerOrigins: Object.fromEntries((lobby.players || []).map((p) => [p.discordId, p.originGuildId])),
    destinationGuildId: destGuild.id
  }, useCaseResult.teams);

  await updateSharedDashboards(client, lobbyOriginGuilds(lobby));

  return {
    ok: true,
    teams: useCaseResult.teams,
    chs: useCaseResult.chs,
    lobby: useCaseResult.lobby,
    inviteUrl,
    dmFailed,
    destGuild
  };
}

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

  // Pool compartilhado: destino eleito + invites + anuncios multi-guild.
  if (lobby.scope === 'shared') {
    const shared = await startSharedMatchCore({
      client: message.client,
      guild: message.guild,
      lobby,
      deps
    });
    if (!shared.ok) {
      const why = shared.reason === 'destination_unreachable'
        ? '❌ Servidor de destino inacessível. Tente de novo ou chame a staff.'
        : 'Partida ja iniciada ou lobby nao encontrado.';
      return await replyToMessage(message, why);
    }
    let extra = '';
    if (shared.inviteUrl) {
      extra += `\n🔗 Convite do destino **${shared.destGuild.name}**: ${shared.inviteUrl}`;
      if (shared.dmFailed.length > 0) {
        extra += ` (DM fechada p/ <@${shared.dmFailed.join('> <@')}> — usem o link)`;
      }
    }
    const commandChannelId = message.channelId || message.channel?.id || null;
    if (commandChannelId !== config.textChannels.matchOngoingChannelId) {
      await replyToMessage(message, { content: `⚔️ Partida shared iniciada!${extra}`, embeds: [buildTeamsEmbed(shared.teams, shared.chs, shared.lobby)] });
    } else if (extra) {
      await replyToMessage(message, extra);
    }
    return;
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
    // Sem número: se o jogador está em partida ativa, mostra o painel de votação
    // (botões Time 1 / Time 2) para votar com 1 clique.
    try {
      const votePanel = deps.votePanel;
      if (votePanel) {
        const currentMatchData = await loadCurrentMatch();
        const matchEntry = Object.entries(currentMatchData.matches || {}).find(([, entry]) => {
          if (!entry.active || !entry.match) return false;
          const { teamOne = [], teamTwo = [] } = entry.match;
          return [...teamOne, ...teamTwo].some((player) => player.discordId === message.author.id);
        });
        if (matchEntry) {
          const [matchId, entry] = matchEntry;
          const teamSize = entry.match.teamOne.length;
          const threshold = deps.getVoteThreshold ? deps.getVoteThreshold(teamSize) : VOTE_THRESHOLD;
          await votePanel.postOrUpdate({
            guild: message.guild,
            matchId,
            match: entry.match,
            votes: entry.votes || {},
            threshold
          });
          await replyToMessage(message, '🗳️ Abri o painel de votação no canal da partida — clique em **Time 1** ou **Time 2** (ou use `!votar 1` / `!votar 2`).');
          return;
        }
      }
    } catch (err) {
      console.error('[VOTEPANEL] Falha ao abrir painel via !votar:', err.message);
    }
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

    return { status: voteResult.status, voteResult, currentThreshold, matchLetter: matchEntry[1].match.letter, matchId: matchEntry[0], match: matchEntry[1].match, votes: { ...(matchEntry[1].votes || {}) } };
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
    // Vitória automática pela maioria: não exige staff (bypass de permissão).
    message._isAutoVote = true;
    // Repassa a letra da partida para mirar a partida certa quando houver A e B ativas
    const victoryArgs = voteOutcome.matchLetter ? [voteResult.winnerTeam, voteOutcome.matchLetter] : [voteResult.winnerTeam];
    await handleVictoryCommand(message, victoryArgs);
    return;
  }

  const bar1 = '🟦'.repeat(voteResult.votesT1) + '⬜'.repeat(Math.max(0, currentThreshold - voteResult.votesT1));
  const bar2 = '🟥'.repeat(voteResult.votesT2) + '⬜'.repeat(Math.max(0, currentThreshold - voteResult.votesT2));
  // Publica/atualiza o painel com botões: menciona quem ainda não votou
  // (notificação = "popup") para ninguém esquecer e a próxima começar rápido.
  try {
    if (deps.votePanel) {
      await deps.votePanel.postOrUpdate({
        guild: message.guild,
        matchId: voteOutcome.matchId,
        match: voteOutcome.match,
        votes: voteOutcome.votes,
        threshold: currentThreshold
      });
    }
  } catch (err) {
    console.error('[VOTEPANEL] Falha ao publicar painel:', err.message);
  }
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
  handleVoteCommandFlow,
  startSharedMatchCore
};
