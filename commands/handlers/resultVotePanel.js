// Painel de votação de resultado com botões (Discord não permite "popup" forçado:
// o equivalente é uma mensagem com botões mencionando os 10 jogadores — cada um
// recebe notificação/destaque e vota com 1 clique, sem digitar comando).
//
// Fluxo:
// - o 1º `!votar X` da partida publica o painel e marca os 9 que faltam;
// - cada voto (texto ou botão) atualiza o placar no painel;
// - aos 2 min sem fechar, o bot manda 1 lembrete marcando quem falta;
// - aos 5 min sem maioria, os botões desativam (o `!votar` texto continua valendo);
// - na maioria (6 no 5x5), a vitória é registrada sozinha, sem staff.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const VOTE_PANEL_DURATION_MS = 5 * 60 * 1000;
const VOTE_PANEL_REMINDER_MS = 2 * 60 * 1000;
const BUTTON_PREFIX = 'votewin';

// matchId (lobby.id, ex: "classic-5x5-a") nunca contém ":" — split seguro.
function parseVoteButtonId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 3 || parts[0] !== BUTTON_PREFIX) return null;
  const [, matchId, team] = parts;
  if (!matchId || !['1', '2'].includes(team)) return null;
  return { matchId, team };
}

// Maioria simples dos participantes (10 jogadores => 6).
function getMajorityThreshold(totalPlayers) {
  const n = Number(totalPlayers) || 0;
  if (n <= 0) return 1;
  return Math.floor(n / 2) + 1;
}

function getMatchPlayers(match) {
  return [...(match?.teamOne || []), ...(match?.teamTwo || [])];
}

function getMissingVoters(match, votes) {
  const voted = new Set(Object.keys(votes || {}));
  return getMatchPlayers(match).filter((p) => p?.discordId && !voted.has(p.discordId));
}

function countVotes(votes) {
  const values = Object.values(votes || {});
  return {
    votesT1: values.filter((v) => v === '1').length,
    votesT2: values.filter((v) => v === '2').length,
    total: values.length
  };
}

// Puro e testável: monta o payload do painel (sem enviar).
function buildResultVotePayload({ match, votes, threshold, closed = false, closeReason = null }) {
  const { votesT1, votesT2, total } = countVotes(votes);
  const players = getMatchPlayers(match);
  const missing = getMissingVoters(match, votes);
  const matchId = match?._matchId || match?.id || match?.lobbyId || '?';

  const bar1 = '🟦'.repeat(votesT1) + '⬜'.repeat(Math.max(0, threshold - votesT1));
  const bar2 = '🟥'.repeat(votesT2) + '⬜'.repeat(Math.max(0, threshold - votesT2));

  const embed = new EmbedBuilder()
    .setColor(closed ? '#808080' : '#5865F2')
    .setTitle(`🗳️ Votação de resultado — Sala ${match?.letter || '?'}`)
    .setDescription(
      `${match?.mode === 'aram' ? 'ARAM' : 'Classic'} ${match?.format || ''} • ` +
      `faltam **${Math.max(0, threshold - Math.max(votesT1, votesT2))}** voto(s) para confirmar ` +
      `(maioria: **${threshold}**)\n` +
      `Time 1: ${bar1} (${votesT1}/${threshold})\n` +
      `Time 2: ${bar2} (${votesT2}/${threshold})\n` +
      (closed && closeReason ? `\n${closeReason}` : '')
    )
    .setFooter({ text: 'CAPS Arena • vote clicando abaixo (só quem jogou)' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:${matchId}:1`)
      .setLabel(`Time 1 (${votesT1})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:${matchId}:2`)
      .setLabel(`Time 2 (${votesT2})`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed)
  );

  return {
    embed,
    components: [row],
    missing,
    counts: { votesT1, votesT2, total },
    totalPlayers: players.length
  };
}

// Timers em memória (lembrete + expiração). O estado canônico mora em
// currentMatch.matches[matchId].resultPanel — sobrevive a reads, não a restart
// (nesse caso o botão responde "votação encerrada, use !votar").
const panelTimers = new Map(); // matchId -> { reminderId, expireId }

function clearPanelTimers(matchId) {
  const timers = panelTimers.get(matchId);
  if (!timers) return;
  if (timers.reminderId) clearTimeout(timers.reminderId);
  if (timers.expireId) clearTimeout(timers.expireId);
  panelTimers.delete(matchId);
}

async function fetchPanelMessage(guild, panel) {
  if (!guild || !panel?.channelId || !panel?.messageId) return null;
  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(panel.messageId).catch(() => null);
}

// Publica o painel na 1ª votação (menciona quem falta = "popup" via notificação)
// ou atualiza o placar nas votações seguintes. Retorna o entry atualizado.
async function postOrUpdateResultVotePanel({ guild, matchId, match, votes, threshold, deps }) {
  const { loadCurrentMatch, saveCurrentMatch, resolveChannel } = deps;
  const channel = await resolveChannel(guild);
  if (!channel) return null;

  const currentMatchData = await loadCurrentMatch();
  const entry = currentMatchData.matches?.[matchId];
  if (!entry?.active) return null;

  const payload = buildResultVotePayload({ match: { ...match, _matchId: matchId }, votes, threshold });
  const mentionLine =
    payload.missing.length > 0
      ? `⏰ Votem no resultado, <@${payload.missing.map((p) => p.discordId).join('> <@')}> — 1 clique abaixo (expira em 5 min).`
      : '✅ Todo mundo votou!';

  let panelMessage = await fetchPanelMessage(guild, entry.resultPanel);
  if (!panelMessage) {
    panelMessage = await channel.send({
      content: `🗳️ **Fim de jogo na sala ${match.letter || '?'}!** ${mentionLine}`,
      embeds: [payload.embed],
      components: payload.components
    }).catch((err) => {
      console.error('[VOTEPANEL] Falha ao publicar painel:', err.message);
      return null;
    });
    if (!panelMessage) return null;

    entry.resultPanel = {
      channelId: panelMessage.channelId,
      messageId: panelMessage.id,
      expiresAt: Date.now() + VOTE_PANEL_DURATION_MS,
      closed: false
    };
    await saveCurrentMatch(currentMatchData);
    schedulePanelTimers({ guild, matchId, deps });
  } else {
    await panelMessage.edit({
      content: panelMessage.content,
      embeds: [payload.embed],
      components: payload.components
    }).catch((err) => console.error('[VOTEPANEL] Falha ao atualizar painel:', err.message));
  }
  return entry;
}

function schedulePanelTimers({ guild, matchId, deps }) {
  clearPanelTimers(matchId);
  const { loadCurrentMatch, saveCurrentMatch } = deps;

  const reminderId = setTimeout(() => {
    (async () => {
      try {
        const data = await loadCurrentMatch();
        const entry = data.matches?.[matchId];
        if (!entry?.active || entry.resultPanel?.closed) return;
        const teamSize = entry.match?.teamOne?.length || 5;
        const threshold = getMajorityThreshold(teamSize * 2);
        const missing = getMissingVoters(entry.match, entry.votes);
        if (missing.length === 0) return;
        const channel = await guild.channels.fetch(entry.resultPanel.channelId).catch(() => null);
        if (!channel?.isTextBased()) return;
        await channel.send(
          `⏰ **Lembrete — sala ${entry.match.letter || '?'}:** ainda faltam votar ` +
          `<@${missing.map((p) => p.discordId).join('> <@')}> — clique em Time 1 ou Time 2 no painel acima. ` +
          `Sem confirmação a próxima partida atrasa!`
        ).catch(() => null);
      } catch (err) {
        console.error('[VOTEPANEL] Falha no lembrete:', err.message);
      }
    })();
  }, VOTE_PANEL_REMINDER_MS);

  const expireId = setTimeout(() => {
    closeResultVotePanel({ guild, matchId, deps, reason: '⏱️ Tempo de votação esgotado (5 min). Use `!votar 1` ou `!votar 2`.' }).catch((err) =>
      console.error('[VOTEPANEL] Falha ao expirar painel:', err.message)
    );
  }, VOTE_PANEL_DURATION_MS);

  // Não segura o processo aberto por causa do painel.
  if (reminderId.unref) reminderId.unref();
  if (expireId.unref) expireId.unref();
  panelTimers.set(matchId, { reminderId, expireId });
}

// Fecha o painel (vitória registrada ou expiração): desativa botões e cancela timers.
async function closeResultVotePanel({ guild, matchId, deps, reason = '✅ Resultado registrado!' }) {
  clearPanelTimers(matchId);
  const { loadCurrentMatch, saveCurrentMatch } = deps;
  const data = await loadCurrentMatch();
  const entry = data.matches?.[matchId];
  // Mesmo com partida já finalizada, tenta desativar os botões pelo estado salvo.
  const panel = entry?.resultPanel;
  if (!panel || panel.closed) return;
  panel.closed = true;
  await saveCurrentMatch(data).catch(() => null);

  const panelMessage = await fetchPanelMessage(guild, panel);
  if (!panelMessage) return;
  const threshold = getMajorityThreshold(getMatchPlayers(entry.match).length || 10);
  const payload = buildResultVotePayload({
    match: { ...entry.match, _matchId: matchId },
    votes: entry.votes,
    threshold,
    closed: true,
    closeReason: reason
  });
  await panelMessage.edit({ embeds: [payload.embed], components: payload.components }).catch(() => null);
}

// Clique nos botões Time 1 / Time 2. Deps injetadas (evita ciclo com legacyCommands):
// { loadCurrentMatch, saveCurrentMatch, withQueueOperationLock, castVictoryVote,
//   createCastVictoryVoteDeps, getVoteThreshold, resolveChannel,
//   onThresholdReached({ guild, matchId, match, winnerTeam, voterMember }) }
async function handleResultVoteButton(interaction, deps) {
  const parsed = parseVoteButtonId(interaction.customId);
  if (!parsed) return;

  const { loadCurrentMatch, withQueueOperationLock, castVictoryVote, createCastVictoryVoteDeps, getVoteThreshold } = deps;

  const data = await loadCurrentMatch();
  const entry = data.matches?.[parsed.matchId];
  if (!entry?.active) {
    await interaction.reply({ content: 'Essa votação já encerrou. Use `!votar 1` ou `!votar 2` na partida atual.', ephemeral: true }).catch(() => null);
    return;
  }
  if (entry.resultPanel?.closed || (entry.resultPanel?.expiresAt && Date.now() > entry.resultPanel.expiresAt)) {
    await interaction.reply({ content: '⏱️ Tempo de votação esgotado. Use `!votar 1` ou `!votar 2`.', ephemeral: true }).catch(() => null);
    return;
  }

  const isParticipant = getMatchPlayers(entry.match).some((p) => p.discordId === interaction.user.id);
  if (!isParticipant) {
    await interaction.reply({ content: 'Só quem jogou essa partida pode votar no resultado.', ephemeral: true }).catch(() => null);
    return;
  }

  const teamSize = entry.match?.teamOne?.length || 5;
  const threshold = deps.getVoteThreshold ? deps.getVoteThreshold(teamSize) : getMajorityThreshold(teamSize * 2);

  const outcome = await withQueueOperationLock(`${interaction.guildId}:victory`, async () => {
    const fresh = await loadCurrentMatch();
    const freshEntry = fresh.matches?.[parsed.matchId];
    if (!freshEntry?.active) return { status: 'no_match' };
    const voteResult = await castVictoryVote({
      currentMatchData: fresh,
      matchEntry: [parsed.matchId, freshEntry],
      voterId: interaction.user.id,
      teamVote: parsed.team,
      voteThreshold: threshold,
      deps: createCastVictoryVoteDeps()
    });
    return { status: voteResult.status, voteResult };
  });

  if (outcome.status === 'no_match') {
    await interaction.reply({ content: 'Partida não encontrada (já foi finalizada?).', ephemeral: true }).catch(() => null);
    return;
  }
  if (outcome.voteResult.status === 'already_voted') {
    await interaction.reply({ content: `⚠️ Você já votou no **Time ${outcome.voteResult.previousVote}**.`, ephemeral: true }).catch(() => null);
    return;
  }

  if (outcome.voteResult.status === 'threshold_reached') {
    await interaction.reply({
      content: `🗳️ **${threshold} votos atingidos!** Registrando vitória do **Time ${outcome.voteResult.winnerTeam}**...`,
      ephemeral: false
    }).catch(() => null);
    await deps.onThresholdReached({
      guild: interaction.guild,
      matchId: parsed.matchId,
      match: entry.match,
      winnerTeam: outcome.voteResult.winnerTeam,
      voterMember: interaction.member
    });
    return;
  }

  await interaction.reply({
    content: `🗳️ Voto no **Time ${parsed.team}** registrado! (${outcome.voteResult.votesT1 + outcome.voteResult.votesT2}/${threshold} — faltam ${threshold - Math.max(outcome.voteResult.votesT1, outcome.voteResult.votesT2)})`,
    ephemeral: true
  }).catch(() => null);

  // Atualiza o placar do painel (fora do lock de votos).
  try {
    const fresh = await loadCurrentMatch();
    const freshEntry = fresh.matches?.[parsed.matchId];
    if (freshEntry?.active && !freshEntry.resultPanel?.closed) {
      await postOrUpdateResultVotePanel({
        guild: interaction.guild,
        matchId: parsed.matchId,
        match: freshEntry.match,
        votes: freshEntry.votes,
        threshold,
        deps
      });
    }
  } catch (err) {
    console.error('[VOTEPANEL] Falha ao atualizar após botão:', err.message);
  }
}

module.exports = {
  VOTE_PANEL_DURATION_MS,
  VOTE_PANEL_REMINDER_MS,
  BUTTON_PREFIX,
  parseVoteButtonId,
  getMajorityThreshold,
  getMatchPlayers,
  getMissingVoters,
  countVotes,
  buildResultVotePayload,
  postOrUpdateResultVotePanel,
  closeResultVotePanel,
  handleResultVoteButton
};
