// Handlers do modo inter-servidores (N x J na CAPS ARENA).
// Camada de Discord: permissoes, canais, invites, DMs e anuncios.
// Regra pura vive em domain/inter/series.js; persistencia nos use-cases.

const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { buscarTime, cancelarBusca, restaurarBuscas } = require('../../application/use-cases/inter/interBusca');
const { formarMatch, registrarResultadoJogo, aplicarWO, findOpenMatchForPlayer } = require('../../application/use-cases/inter/interMatch');
const { parseSerieArg, SERIES_MD1, SERIES_MD3, teamKey, sanitizeTeamName, drawSides } = require('../../domain/inter/series');
const { createMatchInvite, buildInterInviteMessage, sendInterInvites } = require('../../services/inviteService');

// Normaliza nome de cargo p/ comparacao sem acento/caixa/emoji.
function normalizeRoleName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Cargos que operam o inter por NOME (vale mesmo sem captainRoleId no config).
// Padrao atual: "🛠️ Staff" e "👑 Capitão LCL". Variacoes sem emoji
// ("Staff", "Capitão", "Capitão LCL") e o nome legado "👑 Capitão de Customs" tambem valem.
const PRIVILEGED_ROLE_NAMES = new Set([
  'staff',            // 🛠️ Staff / Staff
  'capitaolcl',       // 👑 Capitão LCL / Capitão LCL
  'capitao',          // Capitão
  'capitaodecustoms'  // 👑 Capitão de Customs (legado)
]);

function isCapitaoOuStaff(member, config) {
  if (!member) return false;
  try {
    if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  } catch { /* sem permissoes resolvidas */ }
  try {
    const captainRoleId = config?.roles?.captainRoleId;
    if (captainRoleId && member.roles?.cache?.has(String(captainRoleId))) return true;
    // Cargo da liga por nome (vale em qualquer servidor, sem ID por guild).
    for (const role of member.roles?.cache?.values?.() || []) {
      if (PRIVILEGED_ROLE_NAMES.has(normalizeRoleName(role?.name))) return true;
    }
  } catch { /* sem cargos */ }
  return false;
}

function getInterConfig(config) {
  return {
    arenaGuildId: String(config?.inter?.arenaGuildId || ''),
    inviteChannelId: String(config?.inter?.inviteChannelId || ''),
    announceChannelId: String(config?.inter?.announceChannelId || ''),
    buscaExpiryMinutes: Number(config?.inter?.buscaExpiryMinutes ?? 30),
    woTimeoutMinutes: Number(config?.inter?.woTimeoutMinutes ?? 15),
    points: {
      md1Win: Number(config?.inter?.md1WinPoints ?? 2),
      md3Win20: Number(config?.inter?.md3Win20Points ?? 5),
      md3Win21: Number(config?.inter?.md3Win21Points ?? 4)
    }
  };
}

async function resolveArenaGuild(message, interConfig) {
  if (interConfig.arenaGuildId) {
    const fetched = await message.client?.guilds?.fetch(interConfig.arenaGuildId).catch(() => null);
    if (fetched) return fetched;
  }
  return message.guild;
}

// Args texto (ordem livre):
//   !desafiar <nome do time> [MD1|MD3] [@j1 @j2 @j3 @j4 @j5]
// - Com 5+ mencoes: os 5 primeiros marcados formam o time.
// - Com autor + mencoes somando 5: autor + marcados.
// - Sem mencoes suficientes: os 5 da call de voz do autor (sala = time).
// Formato antigo (!desafiar MD1 Nome @...) continua valendo.
function parseDesafiarArgs(message, args) {
  if (message._slashDesafiar) {
    const s = message._slashDesafiar;
    return {
      serie: parseSerieArg(s.serie) || SERIES_MD1,
      teamName: sanitizeTeamName(s.nome),
      memberIds: [String(message.author.id), ...(s.jogadores || []).map(String)],
      via: 'mentions'
    };
  }
  const tokens = [...args];
  let serie = null;
  const serieIdx = tokens.findIndex((t) => parseSerieArg(t));
  if (serieIdx !== -1) {
    serie = parseSerieArg(tokens[serieIdx]);
    tokens.splice(serieIdx, 1);
  }
  const mentionIds = [];
  try {
    const users = message.mentions?.users;
    if (users) {
      const list = typeof users.values === 'function' ? [...users.values()] : [...(users.first ? [users.first()].filter(Boolean) : [])];
      for (const u of list) {
        if (u && !u.bot) mentionIds.push(String(u.id));
      }
    }
    const members = message.mentions?.members;
    if (members && typeof members.values === 'function') {
      for (const m of members.values()) {
        const id = String(m?.id || m?.user?.id || '');
        if (id && !mentionIds.includes(id)) mentionIds.push(id);
      }
    }
  } catch { /* sem mencoes */ }
  // Elenco por mencao: 5+ marcados OU autor + marcados somando 5.
  if (mentionIds.length >= 5) {
    return { serie: serie || SERIES_MD1, teamName: sanitizeTeamName(tokens.join(' ')), memberIds: mentionIds.slice(0, 5), via: 'mentions' };
  }
  const viaMentions = [String(message.author.id), ...mentionIds];
  if (viaMentions.length >= 5) {
    return { serie: serie || SERIES_MD1, teamName: sanitizeTeamName(tokens.join(' ')), memberIds: viaMentions.slice(0, 5), via: 'mentions' };
  }
  // Sem mencoes suficientes: snapshot da call de voz do autor (sala = time).
  try {
    const voiceChannel = message.member?.voice?.channel;
    const members = voiceChannel?.members
      ? [...voiceChannel.members.values()]
      : [];
    const inVoice = members
      .filter((m) => m && !m.user?.bot)
      .map((m) => String(m.id || m?.user?.id || ''))
      .filter(Boolean);
    if (inVoice.includes(String(message.author.id)) && inVoice.length === 5) {
      return { serie: serie || SERIES_MD1, teamName: sanitizeTeamName(tokens.join(' ')), memberIds: inVoice, via: 'voice' };
    }
  } catch { /* sem voz */ }
  return {
    serie: serie || SERIES_MD1,
    teamName: sanitizeTeamName(tokens.join(' ')),
    memberIds: viaMentions,
    via: 'incomplete'
  };
}

function sanitizeChannelName(value, fallback) {
  const clean = String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
  return clean || fallback;
}

async function createInterChannels(arenaGuild, matchDraft) {
  const tag = `${matchDraft.teamA.name} vs ${matchDraft.teamB.name}`.slice(0, 40);
  const category = await arenaGuild.channels.create({
    name: `⚔️ INTER ${tag}`.slice(0, 100),
    type: ChannelType.GuildCategory,
    reason: `Inter-servidores ${matchDraft.id}`
  });
  const slug = `${matchDraft.teamA.name}-vs-${matchDraft.teamB.name}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'inter';
  const texto = await arenaGuild.channels.create({
    name: `📋・${slug}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    reason: `Inter-servidores ${matchDraft.id}`
  });
  const azulName = matchDraft.firstAzul === 'A' ? matchDraft.teamA.name : matchDraft.teamB.name;
  const vermName = matchDraft.firstAzul === 'A' ? matchDraft.teamB.name : matchDraft.teamA.name;
  const vozAzul = await arenaGuild.channels.create({
    name: `🔵 ${sanitizeChannelName(azulName, 'Azul')} (J1)`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: category.id,
    userLimit: 6,
    reason: `Inter-servidores ${matchDraft.id}`
  });
  const vozVerm = await arenaGuild.channels.create({
    name: `🔴 ${sanitizeChannelName(vermName, 'Vermelho')} (J1)`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: category.id,
    userLimit: 6,
    reason: `Inter-servidores ${matchDraft.id}`
  });
  return {
    categoriaId: category.id,
    textoId: texto.id,
    vozAzulId: vozAzul.id,
    vozVermId: vozVerm.id,
    textoChannel: texto
  };
}

async function deleteInterChannels(guild, canais) {
  if (!guild || !canais) return;
  for (const id of [canais.vozAzulId, canais.vozVermId, canais.textoId, canais.categoriaId]) {
    if (!id) continue;
    await guild.channels.fetch(String(id)).then((c) => c?.delete?.().catch(() => null)).catch(() => null);
  }
}

function buildMatchEmbed(match, inviteUrl) {
  const lado = (t) => (match.jogos?.[0]?.ladoAzul === t ? '🔵' : '🔴');
  return new EmbedBuilder()
    .setColor('#ffaa00')
    .setTitle(`⚔️ INTER ${match.teamA.name} vs ${match.teamB.name} (${match.serie})`)
    .setDescription(
      `${lado('A')} **${match.teamA.name}** (origem: ${match.teamA.originGuildName || match.teamA.originGuildId})\n` +
      `${lado('B')} **${match.teamB.name}** (origem: ${match.teamB.originGuildName || match.teamB.originGuildId})\n\n` +
      `Jogo 1: **${match.teamA.name}** de ${match.jogos?.[0]?.ladoAzul === 'A' ? 'AZUL' : 'VERMELHO'}.\n` +
      (inviteUrl ? `Convite da arena: ${inviteUrl}` : 'Convite indisponível — chame a staff.')
    )
    .setFooter({ text: 'Caps Bot • Inter-servidores' })
    .setTimestamp();
}

async function handleDesafiarCommandFlow({ message, args, deps }) {
  const { config, replyToMessage, createInterDeps, isMemberInClandestinoChannel } = deps;
  const interConfig = getInterConfig(config);
  if (!isCapitaoOuStaff(message.member, config)) {
    await replyToMessage(message, '❌ Só **Capitão/Staff** pode buscar partida inter-servidores.');
    return;
  }
  // Lobby Clandestino: o desafio só sai da sala oficial (limite 5 na call).
  if (typeof isMemberInClandestinoChannel === 'function' && !isMemberInClandestinoChannel(message.member)) {
    await replyToMessage(message, '❌ Entre no canal de voz **Lobby Clandestino** com seu time (5 na call) para usar o `!desafiar`.');
    return;
  }
  const { serie, teamName, memberIds, via } = parseDesafiarArgs(message, args);
  if (!teamName) {
    await replyToMessage(message, '❌ Uso: `!desafiar <nome do time> [MD1|MD3] [@j1 @j2 @j3 @j4 @j5]`.\nCom menções: marque os 5 (ou você + 4). Sem menções: junte os **5 na mesma call de voz** e rode `!desafiar <nome> [MD1|MD3]`.');
    return;
  }

  // Marcados precisam estar na mesma call (a sala confirma o time).
  if (via === 'mentions') {
    const inVoice = new Set(
      [...(message.member?.voice?.channel?.members?.values?.() || [])]
        .map((m) => String(m?.id || m?.user?.id || ''))
    );
    const missing = memberIds.filter((id) => !inVoice.has(String(id)));
    if (missing.length > 0) {
      await replyToMessage(message, `❌ Todos do time precisam estar na call: faltam <@${missing.join('> <@')}>.`);
      return;
    }
  }

  const d = createInterDeps();
  const result = await buscarTime({
    input: {
      teamName,
      originGuildId: message.guild.id,
      originGuildName: message.guild.name,
      capitaoId: message.author.id,
      jogadores: memberIds,
      serie
    },
    config: interConfig,
    deps: d
  });

  if (result.status === 'missing_team_name' || result.status === 'roster_size') {
    await replyToMessage(message, '❌ O time precisa de **5 fixos**. Marque os 5 (`!desafiar <nome> [MD1|MD3] @j1 @j2 @j3 @j4 @j5`) ou junte os **5 na mesma call de voz** e rode `!desafiar <nome> [MD1|MD3]`.');
    return;
  }
  if (result.status === 'roster_duplicates') {
    await replyToMessage(message, '❌ Elenco com repetidos. Marque 5 jogadores diferentes.');
    return;
  }
  if (result.status === 'capitao_not_in_roster') {
    await replyToMessage(message, '❌ Erro interno: capitão fora do elenco.');
    return;
  }
  if (result.status === 'already_waiting') {
    await replyToMessage(message, `⏳ **${teamName}** já está buscando adversário (${serie}). Use \`!desafiar-cancelar\` para sair.`);
    return;
  }
  if (result.status === 'player_busy_busca') {
    await replyToMessage(message, `❌ <@${result.discordId}> já está em outra busca inter. Cancele a anterior primeiro.`);
    return;
  }
  if (result.status === 'player_busy_match') {
    await replyToMessage(message, `❌ <@${result.discordId}> já está em partida ativa (inter ou interna).`);
    return;
  }
  if (result.status === 'player_busy_queue') {
    await replyToMessage(message, `❌ <@${result.discordId}> está na fila interna. Use \`!sair\` antes de desafiar.`);
    return;
  }
  if (result.status === 'waiting') {
    await replyToMessage(message, `🔎 **${teamName}** (${serie}) na busca! Posição **${result.position}**. Avisamos quando achar adversário.`);
    return;
  }
  if (result.status !== 'matched') {
    await replyToMessage(message, '❌ Não consegui registrar a busca agora. Tente de novo.');
    return;
  }

  // Match formado: monta a arena (canais) e SÓ AGORA cria o invite.
  const { matchDraft, opponent } = result;
  const arenaGuild = await resolveArenaGuild(message, interConfig);
  let canais = null;
  try {
    canais = await createInterChannels(arenaGuild, matchDraft);
  } catch (err) {
    await restaurarBuscas({ buscaId: result.busca.id, opponentId: opponent.id, deps: d });
    await replyToMessage(message, `❌ Não consegui criar as salas na arena (${err.message}). As buscas voltaram para a fila.`);
    return;
  }

  let inviteChannel = canais.textoChannel;
  if (interConfig.inviteChannelId) {
    inviteChannel = await arenaGuild.channels.fetch(interConfig.inviteChannelId).catch(() => canais.textoChannel);
  }
  const inviteRes = await createMatchInvite(inviteChannel, { reason: `Inter ${matchDraft.teamA.name} vs ${matchDraft.teamB.name} (${matchDraft.id})` });
  if (!inviteRes.ok) {
    await deleteInterChannels(arenaGuild, canais);
    await restaurarBuscas({ buscaId: result.busca.id, opponentId: opponent.id, deps: d });
    const why = inviteRes.reason === 'missing_permissions'
      ? 'sem permissão **Criar convite** na arena. Staff: libere a permissão no canal de convites.'
      : `(${inviteRes.reason}).`;
    await replyToMessage(message, `❌ Não consegui gerar o convite da arena ${why} As buscas voltaram para a fila.`);
    return;
  }

  const formed = await formarMatch({
    matchDraft,
    arenaGuildId: arenaGuild.id,
    canais: { categoriaId: canais.categoriaId, textoId: canais.textoId, vozAzulId: canais.vozAzulId, vozVermId: canais.vozVermId },
    invite: inviteRes.invite,
    deps: d
  });
  const match = formed.match;
  const allIds = [...match.teamA.jogadores, ...match.teamB.jogadores];
  const fetchUser = async (id) => {
    const member = await arenaGuild.members.fetch(String(id)).catch(() => null);
    if (member?.user) return member.user;
    return message.client?.users?.fetch(String(id)).catch(() => null);
  };
  const dmTextA = buildInterInviteMessage({
    teamName: match.teamA.name, opponentName: match.teamB.name,
    serie: match.serie, inviteUrl: inviteRes.invite.url, arenaName: arenaGuild.name
  });
  // Mesma mensagem para os dois times (cada um ve o proprio nome? envia personalizado por time).
  const dmTextB = buildInterInviteMessage({
    teamName: match.teamB.name, opponentName: match.teamA.name,
    serie: match.serie, inviteUrl: inviteRes.invite.url, arenaName: arenaGuild.name
  });
  const resA = await sendInterInvites(fetchUser, match.teamA.jogadores, dmTextA);
  const resB = await sendInterInvites(fetchUser, match.teamB.jogadores, dmTextB);
  const dmFailed = [...resA.dmFailed, ...resB.dmFailed];

  const embed = buildMatchEmbed(match, inviteRes.invite.url);
  if (dmFailed.length > 0) {
    embed.addFields({ name: '⚠️ DM fechada', value: `<@${dmFailed.join('> <@')}> — entrem pelo link acima.` });
  }
  const announceTarget = canais.textoChannel?.isTextBased?.() ? canais.textoChannel : null;
  if (announceTarget) {
    const mentions = allIds.map((id) => `<@${id}>`).join(' ');
    await announceTarget.send({ content: mentions, embeds: [embed] }).catch(() => null);
  }
  await replyToMessage(
    message,
    `✅ **MATCH FORMADO: ${match.teamA.name} vs ${match.teamB.name}** (${match.serie}) na **${arenaGuild.name}**!\n` +
    `Convite: ${inviteRes.invite.url}${dmFailed.length > 0 ? `\n⚠️ DM fechada p/ <@${dmFailed.join('> <@')}> — avisem de entrar pelo link.` : ''}`
  );
}

async function handleDesafiarCancelarCommandFlow({ message, deps }) {
  const { config, replyToMessage, createInterDeps, loadInterBusca } = deps;
  if (!isCapitaoOuStaff(message.member, config)) {
    await replyToMessage(message, '❌ Só **Capitão/Staff** pode cancelar a busca.');
    return;
  }
  // Acha a busca em espera que envolve o autor (qualquer time).
  const buscaData = await loadInterBusca();
  const mine = (buscaData.buscas || []).find((b) =>
    b.status === 'waiting' && (b.jogadores || []).map(String).includes(String(message.author.id)));
  if (!mine) {
    await replyToMessage(message, 'Você não está em nenhuma busca inter em espera.');
    return;
  }
  if (String(mine.capitaoId) !== String(message.author.id) && !isCapitaoOuStaff(message.member, config)) {
    await replyToMessage(message, '❌ Só o capitão da busca ou a staff pode cancelar.');
    return;
  }
  const res = await cancelarBusca({ key: mine.key, deps: createInterDeps() });
  await replyToMessage(message, res.status === 'cancelled'
    ? `🗑️ Busca de **${mine.teamName}** cancelada.`
    : 'Não achei busca em espera para cancelar.');
}

function findMyOpenInterMatch(interMatches, message) {
  const found = findOpenMatchForPlayer(interMatches, message.author.id);
  if (!found) return null;
  return { id: found[0], match: found[1] };
}

function myTeamLetter(match, discordId) {
  const id = String(discordId);
  if ((match.teamA.jogadores || []).map(String).includes(id)) return 'A';
  if ((match.teamB.jogadores || []).map(String).includes(id)) return 'B';
  return null;
}

async function announceInterUpdate(arenaGuild, match, text, embedExtra = null) {
  const channelId = match.canais?.textoId;
  const channel = channelId ? await arenaGuild.channels.fetch(String(channelId)).catch(() => null) : null;
  if (channel?.isTextBased?.()) {
    await channel.send({ content: text, ...(embedExtra ? { embeds: [embedExtra] } : {}) }).catch(() => null);
  }
}

// !resultado-inter [jogoN] AZUL|VERM
async function handleResultadoInterCommandFlow({ message, args, deps }) {
  const { config, replyToMessage, createInterDeps, loadInterMatches } = deps;
  const interConfig = getInterConfig(config);
  const upper = args.map((a) => String(a || '').toUpperCase());
  const side = [...upper].reverse().find((a) => a === 'AZUL' || a === 'VERM');
  const num = upper.map((a) => Number(a)).find((n) => Number.isInteger(n) && n >= 1 && n <= 3);
  if (!side) {
    await replyToMessage(message, '❌ Uso: `!resultado-inter [jogo] AZUL|VERM` (ex. `!resultado-inter 1 AZUL`).');
    return;
  }
  const interMatches = await loadInterMatches();
  const found = findMyOpenInterMatch(interMatches, message);
  if (!found) {
    await replyToMessage(message, '❌ Você não está em série inter aberta.');
    return;
  }
  const { id: matchId, match } = found;
  const arenaGuild = await resolveArenaGuild(message, interConfig);
  // Permissao: capitao de time envolvido (tem o cargo) ou staff.
  // Jogador comum nao passa em isCapitaoOuStaff.
  const allowed = isCapitaoOuStaff(message.member, config);
  if (!allowed) {
    await replyToMessage(message, '❌ Só **Capitão/Staff** pode lançar o resultado.');
    return;
  }

  const jogoN = num || (match.jogos || []).find((g) => !g.vencedor)?.n || 1;
  let thirdAzul = null;
  if (match.serie === SERIES_MD3 && jogoN === 3) {
    thirdAzul = drawSides().azul;
  }
  const res = await (async () => {
    const { registrarResultadoJogo } = require('../../application/use-cases/inter/interMatch');
    return registrarResultadoJogo({
      matchId, jogoN, vencedorSide: side, thirdAzul,
      points: interConfig.points, deps: createInterDeps()
    });
  })();

  if (res.status === 'match_not_found') {
    await replyToMessage(message, '❌ Série inter não encontrada ou já fechada.');
    return;
  }
  if (res.status === 'invalid_game') {
    await replyToMessage(message, '❌ Jogo inválido ou já decidido. Confira o número do jogo.');
    return;
  }
  if (res.status === 'invalid_side') {
    await replyToMessage(message, '❌ Lado inválido. Use `AZUL` ou `VERM`.');
    return;
  }
  if (res.status === 'game_locked') {
    await replyToMessage(message, '🔒 O Jogo 3 só acontece em empate **1-1**.');
    return;
  }

  const m = res.match;
  const game = m.jogos.find((g) => g.n === jogoN);
  const winName = game.vencedor === 'A' ? m.teamA.name : m.teamB.name;
  if (res.status === 'game_recorded') {
    const next = res.nextGame;
    const placar = `${m.teamA.name} **${m.placarA}** x **${m.placarB}** ${m.teamB.name}`;
    await announceInterUpdate(arenaGuild, m,
      `✅ Jogo ${jogoN}: **${winName}** venceu! Placar da série: ${placar}.` +
      (next ? ` Próximo: Jogo ${next.n} (${next.ladoAzul === 'A' ? m.teamA.name : m.teamB.name} de AZUL).` : ''));
    await replyToMessage(message, `✅ Jogo ${jogoN} para **${winName}**. Série: ${placar}.`);
    return;
  }

  // Serie fechada: anuncia campeao, pontuacao e limpa as salas.
  const champ = res.seriesWinner === 'A' ? m.teamA : m.teamB;
  const champKey = teamKey(champ.originGuildId, champ.name);
  const pts = res.rankingDetail?.winEntry?.pontos;
  await announceInterUpdate(arenaGuild, m,
    `🏆 **SÉRIE FECHADA: ${champ.name} vence ${m.teamA.name} vs ${m.teamB.name} por ${m.placarA}x${m.placarB}!**` +
    (pts != null ? ` Pontos inter de ${champ.name}: **${pts}**.` : ''));
  await deleteInterChannels(arenaGuild, m.canais);
  await replyToMessage(message,
    `🏆 Série fechada! **${champ.name}** (${champKey}) vence por **${m.placarA}x${m.placarB}**. Salas da arena apagadas.`);
}

// !wo [A|B] — W.O. contra o time ausente.
async function handleWOCommandFlow({ message, args, deps }) {
  const { config, replyToMessage, createInterDeps, loadInterMatches } = deps;
  const interConfig = getInterConfig(config);
  if (!isCapitaoOuStaff(message.member, config)) {
    await replyToMessage(message, '❌ Só **Capitão/Staff** pode aplicar W.O.');
    return;
  }
  const interMatches = await loadInterMatches();
  const found = findMyOpenInterMatch(interMatches, message);
  if (!found) {
    await replyToMessage(message, '❌ Você não está em série inter aberta.');
    return;
  }
  const { id: matchId, match } = found;
  const upper = args.map((a) => String(a || '').toUpperCase());
  let faltoso = upper.includes('A') ? 'A' : upper.includes('B') ? 'B' : null;
  if (!faltoso) {
    // Default: faltoso = time que NAO contem o autor.
    faltoso = myTeamLetter(match, message.author.id) === 'A' ? 'B' : 'A';
  }
  const { aplicarWO } = require('../../application/use-cases/inter/interMatch');
  const res = await aplicarWO({ matchId, faltoso, points: interConfig.points, deps: createInterDeps() });
  if (res.status !== 'wo_applied') {
    await replyToMessage(message, '❌ Não consegui aplicar o W.O. (série já fechada?).');
    return;
  }
  const m = res.match;
  const presente = res.seriesWinner === 'A' ? m.teamA : m.teamB;
  const ausente = faltoso === 'A' ? m.teamA : m.teamB;
  const arenaGuild = await resolveArenaGuild(message, interConfig);
  await announceInterUpdate(arenaGuild, m,
    `🚫 **W.O.!** ${ausente.name} não compareceu. **${presente.name}** vence a série por **${m.placarA}x${m.placarB}**.`);
  await deleteInterChannels(arenaGuild, m.canais);
  await replyToMessage(message, `🚫 W.O. aplicado contra **${ausente.name}**. **${presente.name}** pontua.`);
}

async function handleInterRankingCommandFlow({ message, deps }) {
  const { replyToMessage, loadInterRanking } = deps;
  const ranking = await loadInterRanking();
  const rows = Object.entries(ranking.times || {}).sort(([, a], [, b]) => (b.pontos || 0) - (a.pontos || 0)).slice(0, 10);
  if (rows.length === 0) {
    await replyToMessage(message, '📊 Ranking inter vazio. Desafiem com `!desafiar <nome> MD1 @j1 @j2 @j3 @j4 @j5`.');
    return;
  }
  const embed = new EmbedBuilder()
    .setColor('#ffd700')
    .setTitle('🏆 Ranking Inter-servidores')
    .setDescription(rows.map(([, t], i) =>
      `**${i + 1}. ${t.name}** (${t.originGuildId}) — **${t.pontos} pts** | MD1 ${t.md1V}V/${t.md1D}D | MD3 ${t.md3V}V/${t.md3D}D | Jogos ${t.jogosV}V/${t.jogosD}D${t.woV ? ` | WO ${t.woV}V` : ''}`
    ).join('\n'))
    .setFooter({ text: 'Caps Bot • Inter (separado do ranking interno)' })
    .setTimestamp();
  await replyToMessage(message, { embeds: [embed] });
}

function buildInterRankingEmbed(ranking, periodLabel) {
  const rows = Object.entries(ranking?.times || {})
    .map(([, t]) => t)
    .sort((a, b) => (b.pontos || 0) - (a.pontos || 0))
    .slice(0, 10);
  const embed = new EmbedBuilder()
    .setColor('#ffd700')
    .setTitle('🏆 Ranking Inter-servidores')
    .setFooter({ text: 'LCL • Liga Clandestina de LoL' })
    .setTimestamp();
  if (periodLabel) embed.setDescription(`Período: **${periodLabel}**`);
  if (rows.length === 0) {
    embed.addFields({ name: 'Sem pontuação', value: 'Nenhuma série inter fechada ainda. Desafiem com `!desafiar <nome> MD1 @...`.' });
    return { embed, empty: true };
  }
  rows.forEach((t, i) => {
    embed.addFields({
      name: `${i + 1}. ${t.name}`,
      value: `**${t.pontos} pts** · MD1 ${t.md1V}V/${t.md1D}D · MD3 ${t.md3V}V/${t.md3D}D · Jogos ${t.jogosV}V/${t.jogosD}D`
    });
  });
  return { embed, empty: false };
}

// Publicacao dirigida do ranking inter (responsabilidade do LCL).
// Posta SOMENTE com times pontuados; sem canal configurado, nao faz nada.
async function postInterRankingUpdate({ client, interConfig, deps, periodLabel }) {
  const { loadInterRanking } = deps;
  const ranking = await loadInterRanking();
  const rows = Object.keys(ranking?.times || {}).length;
  if (rows === 0) return { status: 'empty' };
  const arenaGuild = interConfig?.arenaGuildId
    ? await client?.guilds?.fetch(String(interConfig.arenaGuildId)).catch(() => null)
    : null;
  if (!arenaGuild) return { status: 'no_arena' };
  const channelId = interConfig?.rankChannelId || interConfig?.announceChannelId;
  const channel = channelId ? await arenaGuild.channels.fetch(String(channelId)).catch(() => null) : null;
  if (!channel?.isTextBased?.()) return { status: 'no_channel' };
  const { embed } = buildInterRankingEmbed(ranking, periodLabel);
  await channel.send({ content: '📊 **Ranking inter-servidores atualizado**', embeds: [embed] }).catch(() => null);
  return { status: 'posted' };
}

let lastInterRankPostKey = null;

// Agendador diario do ranking inter (mesmo jeito do scheduler interno, intervalo 30s).
function startInterRankingScheduler(client, interConfig, deps) {
  const { getSaoPauloDateParts } = require('../../utils/lobbyUtils');
  const targetHour = Number(interConfig?.rankHour ?? deps?.config?.automation?.dailyRankUpdatesHour ?? 8);
  const targetMinute = Number(interConfig?.rankMinute ?? deps?.config?.automation?.dailyRankUpdatesMinute ?? 0);
  setInterval(async () => {
    try {
      const now = getSaoPauloDateParts(new Date());
      if (now.hour !== targetHour || now.minute !== targetMinute) return;
      if (lastInterRankPostKey === now.key) return;
      lastInterRankPostKey = now.key;
      await postInterRankingUpdate({ client, interConfig, deps });
    } catch (error) {
      console.error('[INTER-RANK] Erro no agendador:', error.message);
    }
  }, 30000);
}

async function handleInterHistoricoCommandFlow({ message, deps }) {
  const { replyToMessage, loadInterMatches } = deps;
  const data = await loadInterMatches();
  const closed = Object.values(data.matches || {})
    .filter((m) => m && m.status === 'closed')
    .sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))
    .slice(0, 8);
  if (closed.length === 0) {
    await replyToMessage(message, '📋 Nenhuma série inter fechada ainda.');
    return;
  }
  const lines = closed.map((m) => {
    const champ = m.winner === 'A' ? m.teamA.name : m.teamB.name;
    return `• **${m.teamA.name} ${m.placarA}x${m.placarB} ${m.teamB.name}** (${m.serie}) — 🏆 ${champ}${m.wo ? ' (W.O.)' : ''}`;
  });
  await replyToMessage(message, `📋 **Últimas séries inter:**\n${lines.join('\n')}`);
}

module.exports = {
  isCapitaoOuStaff,
  getInterConfig,
  parseDesafiarArgs,
  handleDesafiarCommandFlow,
  handleDesafiarCancelarCommandFlow,
  handleResultadoInterCommandFlow,
  handleWOCommandFlow,
  handleInterRankingCommandFlow,
  handleInterHistoricoCommandFlow,
  buildInterRankingEmbed,
  postInterRankingUpdate,
  startInterRankingScheduler
};
