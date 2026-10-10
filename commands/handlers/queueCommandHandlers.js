async function handleEnterCommandFlow({
  message,
  args,
  deps
}) {
  const {
    QUEUE_MODES,
    getFormatFromArgs,
    getNicknameArgs,
    isMemberInQueueVoiceChannel,
    isMemberInTierSVoiceChannel,
    enterQueue,
    createEnterQueueDeps,
    replyToMessage,
    updateQueueDashboard,
    triggerAutoStart,
    pendingAutoStarts
  } = deps;

  const normalizedArgs = args.map((arg) => String(arg || '').toLowerCase());
  const selectedMode = normalizedArgs.includes(QUEUE_MODES.ARAM) || normalizedArgs.some((arg) => ['1x1', '2x2', '3x3', '4x4', '5x5'].includes(arg))
    ? QUEUE_MODES.ARAM
    : QUEUE_MODES.CLASSIC;
  const selectedFormat = getFormatFromArgs(selectedMode, args);
  const providedNick = getNicknameArgs(selectedMode, args, selectedFormat).join(' ').trim();
  const selectedTier = selectedMode === QUEUE_MODES.CLASSIC && isMemberInTierSVoiceChannel && isMemberInTierSVoiceChannel(message.member) ? 'S' : null;

  if (!isMemberInQueueVoiceChannel(message.member, selectedMode)) {
    const expectedChannelName = selectedMode === QUEUE_MODES.ARAM ? 'Lobby ARAM' : 'Lobby Classic ou Lobby TIER S';
    await replyToMessage(message, `Voce precisa estar no canal de voz \`${expectedChannelName}\` para entrar nessa fila.`);
    return;
  }

  const result = await enterQueue({
    guild: message.guild,
    guildId: message.guild.id,
    author: message.author,
    selectedMode,
    selectedFormat,
    providedNick,
    riotService: global.riotService,
    deps: createEnterQueueDeps(),
    selectedTier,
    member: message.member
  });

  if (result.status === 'tierS_denied') {
    await replyToMessage(message, '⛔ Lobby TIER S exige elo **Esmeralda IV ou superior** (ou cargo Esmeralda+). Use o `Lobby Classic` normal.');
    return;
  }

  if (result.status === 'missing_registration') {
    await replyToMessage(
      message,
      '❌ Voce ainda nao tem cadastro!\n' +
      'Use `!cadastrar SeuNick#TAG` uma vez para vincular sua conta — depois e so dar `!entrar` 😊'
    );
    return;
  }

  if (result.status === 'already_in_queue') {
    await replyToMessage(message, `Voce ja esta na sala ${result.lobby.letter}.`);
    return;
  }

  if (result.status === 'waiting_list_priority') {
    const positionMessage = result.position
      ? `Voce esta na posicao **${result.position}** da fila de espera.`
      : 'Ha jogadores aguardando antes de voce.';
    await replyToMessage(
      message,
      `${positionMessage} Aguarde os jogadores anteriores entrarem na proxima sala.`
    );
    return;
  }

  if (result.status === 'roulette_pending') {
    const letters = (result.letters || []).join(', ');
    const secs = Number(result.secondsRemaining || 0);
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');
    const when = secs >= 60 ? `${mm}m${ss}s` : `${secs}s`;
    await replyToMessage(
      message,
      `⏳ Aguarde a **!roleta da sala ${letters}** (${when} restantes). O \`!entrar\` libera após o sorteio — staff: use \`!roleta N ${letters.split(', ')[0] || 'A'}\`.`
    );
    return;
  }

  if (result.status === 'duplicate_nickname') {
    await replyToMessage(message, 'Ja existe um jogador com esse nick na fila.');
    return;
  }

  const { lobby } = result;
  const waitingChannel = await message.guild.channels.fetch(lobby.waitingChannelId).catch(() => null);
  if (waitingChannel && message.member.voice.channel) {
    await message.member.voice.setChannel(waitingChannel).catch(() => null);
  }

  await updateQueueDashboard(message.guild);

  // Notifica quando falta 1 jogador para completar a sala
  const playersCount = lobby.players.length;
  const required = lobby.requiredPlayers;
  if (playersCount === required - 1 && playersCount > 0) {
    try {
      const statusChannelId = require('../config.json').textChannels?.matchOngoingChannelId;
      const statusChannel = statusChannelId
        ? await message.guild.channels.fetch(statusChannelId).catch(() => null)
        : null;
      if (statusChannel?.isTextBased()) {
        const modeLabel = lobby.mode === 'aram' ? `ARAM ${lobby.format || '5x5'}` : 'Classic';
        await statusChannel.send(
          `⚡ **Fila ${lobby.letter} (${modeLabel})** quase cheia! Falta **1 jogador** — entre no canal de voz para participar!`
        ).catch(() => null);
      }
    } catch (e) {
      // notificação não é crítica, ignora erro silenciosamente
    }
  }

  if (lobby.players.length >= lobby.requiredPlayers && !pendingAutoStarts.has(lobby.id)) {
    await triggerAutoStart(message.guild, lobby.id);
  }
}

module.exports = {
  handleEnterCommandFlow
};
