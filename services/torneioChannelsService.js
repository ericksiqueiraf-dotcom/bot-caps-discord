// Torneio CAPS ARENA — infra de Discord: categoria dedicada + lobbies + embeds.
// Tudo em um serviço separado (torneioService.js continua puro, sem Discord).
// Estado dos canais vive em `systemMeta.torneio.canais`:
//   { categoria, regras, inscricoes, bracket, campeoes, lobbies: [] }
// Regras visuais acordadas (plano Etapa 1):
//   • categoria criada quando o torneio abre; após o campeão, só resultado final
//     + hall dos campeões permanecem;
//   • texto só-leitura (- SendMessages para @everyone; staff e bot em allow);
//   • lobby por jogo da rodada, limite 10, só os 10 sorteados conectam;
//   • ausência: aviso T+5min, substituição T+10min (lógica pura no torneioService).
const { ChannelType, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const T = require('./torneioService');

const BANNER_PATH = path.join(__dirname, '..', 'assets', 'torneio-banner.png');
const BANNER_ANEXO = 'torneio-banner.png';

const MIN = 60 * 1000;
const AUSENCIA_AVISO_MS = T.AUSENCIA_AVISO_MIN * MIN;
const AUSENCIA_SUBSTITUICAO_MS = (T.AUSENCIA_SUBSTITUICAO_MIN - T.AUSENCIA_AVISO_MIN) * MIN;

const CATEGORIA_NOME = '🏆・TORNEIO CAPS ARENA';
const TEXTO_SPECS = [
  { key: 'regras', nome: '📜・regras' },
  { key: 'inscricoes', nome: '🎲・inscrições' },
  { key: 'bracket', nome: '📊・bracket' },
  { key: 'campeoes', nome: '👑・campeões' }
];

function normKey(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function staffOverwrites(guild) {
  const out = [];
  for (const [, role] of guild.roles.cache) {
    if (['staff', 'moderador'].includes(normKey(role.name))) {
      out.push({ id: role.id, type: 0, allow: ['ViewChannel', 'SendMessages', 'ManageMessages'] });
    }
  }
  return out;
}

function overwritesTexto(guild) {
  const bot = guild.members.me;
  return [
    { id: guild.roles.everyone.id, type: 0, allow: ['ViewChannel'], deny: ['SendMessages'] },
    ...(bot ? [{ id: bot.id, type: 1, allow: ['ViewChannel', 'SendMessages', 'ManageMessages', 'EmbedLinks'] }] : []),
    ...staffOverwrites(guild)
  ];
}

// ─── Categoria + canais de texto ────────────────────────────────────────────
// Idempotente: reaproveita os canais que ainda existem; recria os que sumiram.
async function ensureCategoriaTorneio(guild, t) {
  if (!guild) return null;
  if (!t?.canais || typeof t.canais !== 'object') t.canais = { lobbies: [] };
  if (!Array.isArray(t.canais.lobbies)) t.canais.lobbies = [];

  let categoria = t.canais.categoria
    ? await guild.channels.fetch(String(t.canais.categoria)).catch(() => null)
    : null;
  if (!categoria) {
    categoria = await guild.channels.create({
      name: CATEGORIA_NOME,
      type: ChannelType.GuildCategory
    }).catch((err) => { console.error('[TORNEIO] categoria:', err.message); return null; });
    if (!categoria) return null;
  }
  t.canais.categoria = categoria.id;

  const criados = [];
  for (const spec of TEXTO_SPECS) {
    let ch = t.canais[spec.key]
      ? await guild.channels.fetch(String(t.canais[spec.key])).catch(() => null)
      : null;
    if (!ch) {
      ch = await guild.channels.create({
        name: spec.nome,
        type: ChannelType.GuildText,
        parent: categoria.id,
        permissionOverwrites: overwritesTexto(guild)
      }).catch((err) => { console.error(`[TORNEIO] canal ${spec.key}:`, err.message); return null; });
      if (ch) criados.push(spec.key);
    }
    t.canais[spec.key] = ch?.id || null;
  }

  // 1ª vez com canal novo: posta o manual (regras) e o intro do bracket.
  try {
    if (criados.includes('regras') && t.canais.regras) {
      const canal = await guild.channels.fetch(t.canais.regras);
      if (canal) {
        const anexos = fs.existsSync(BANNER_PATH) ? [new AttachmentBuilder(BANNER_PATH, { name: BANNER_ANEXO })] : [];
        await canal.send({ embeds: [buildRegrasEmbed(t, anexos.length > 0)], files: anexos });
      }
    }
    if (criados.includes('bracket') && t.canais.bracket) {
      const canal = await guild.channels.fetch(t.canais.bracket);
      if (canal) await canal.send({ embeds: [buildIntroducaoBracketEmbed()] });
    }
  } catch (err) { console.error('[TORNEIO] embeds iniciais:', err.message); }

  return t.canais;
}

// Após o campeão: mantém SO categoria + bracket (resultado final) + campeões.
async function arquivarPosCampeao(guild, t) {
  if (!guild || !t?.canais) return null;
  await apagarLobbies(guild, t);
  for (const key of ['regras', 'inscricoes']) {
    const id = t.canais[key];
    if (!id) continue;
    const ch = await guild.channels.fetch(String(id)).catch(() => null);
    if (ch) await ch.delete('Torneio encerrado — mantém só resultado final e campeões').catch(() => null);
    t.canais[key] = null;
  }
  return t.canais;
}

// ─── Embeds ────────────────────────────────────────────────────────────────
function buildRegrasEmbed(t, withBanner = false) {
  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`🏆 TORNEIO CAPS ARENA — Edição #${t?.edition ?? '?'}`)
    .setDescription(T.TORNEIO_INFO)
    .setFooter({ text: 'Caps Bot • dúvidas com a staff' });
  if (withBanner) embed.setImage(`attachment://${BANNER_ANEXO}`);
  return embed;
}

function buildIntroducaoBracketEmbed() {
  return new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('📊 COMO FUNCIONA O BRACKET')
    .setDescription(
      'O **bracket** é a chave do mata-mata: cada rodada mostra os jogos com os **nomes dos times** (`R1 TIME A` 🆚 `R1 TIME B`) e o resultado.\n\n' +
      '• **Sorteou?** O bot move os 10 de cada jogo para o lobby da rodada — limite 10, só os sorteados conectam\n' +
      '• **Ausência no lobby**: **5 min** = aviso → **10 min** = `reserva` (ou **reforço** de rodada anterior) assume e o jogo é re-balanceado → **20 min** sem alternativa = **W.O.** do lado do ausente (na final, só a staff registra)\n' +
      '• **Rodada em aberto tem 90 min** de resultado — staff é avisada e pode `prorrogar` ⏳ ou `adiar⏸/retomar▶️` (pausa sem punir)\n' +
      '• ⏸️ **PAUSE**: cada time tem **1 pause de até 5 min por jogo** — aciona pelo `/pause` dentro do jogo (personalizada); quem pausou retoma quando quiser, sem aviso prévio\n' +
      '• **Times nascem com nome no sorteio** e o nome mantém até a final — só o jogador muda (reserva/reforço)\n' +
      '• Vencedores avançam; se não fecham 10, os **5 melhores perdedores** entram na **repescagem** (re-balance na próxima rodada)\n' +
      '• **FINAL MD3**: mesmos times congelados • J1 azul sorteado • J2 lados invertidos • J3 quem venceu o J1 escolhe\n' +
      '• 🚫 **FEARLESS**: na final, proibido pickar campeão usado na partida anterior da série'
    );
}

function buildInscricoesEmbed(t) {
  const st = T.getStatus(t);
  const embed = new EmbedBuilder().setColor('#FFD700').setTitle('🎲 INSCRIÇÕES — Torneio CAPS ARENA');
  const mencoes = (ids) => ids.map((id) => `<@${id}>`).join(' ') || '—';
  if (st.inscricoes) {
    embed.setDescription(`📅 Inscrições **abertas** até **${fmtData(st.inscricoesAte)}**\n👉 \`!torneio entrar\``);
    embed.addFields({ name: `✅ Inscritos (${st.inscritos}/${T.MIN_PLAYERS} mínimo)`, value: mencoes(t.players || []) });
  } else {
    embed.setDescription(`🔒 Inscrições **encerradas** — ${st.inscritos} titulares.`);
    embed.addFields({ name: `✅ Titulares (${st.inscritos})`, value: mencoes(t.players || []) });
    if (st.reservasLista.length) {
      const fila = st.reservasLista.map((id, i) => `${i + 1}º <@${id}>`).join('\n');
      embed.addFields({ name: `⬇️ Lista de Reservas (${st.reservasLista.length})`, value: fila });
    }
  }
  if (st.champion) {
    embed.addFields({ name: '👑 Campeões', value: st.champion.team.map((id) => `<@${id}>`).join(' ') + ` — ${st.champion.placar}` });
  }
  return embed;
}

// Rodada completa OU final, em 1 embed só (editado conforme resultados)
function buildRodadaEmbed(t) {
  const st = T.getStatus(t);
  if (st.final) return buildFinalEmbed(t);
  const lastN = st.rodada;
  const rodada = (t.rounds || []).find((r) => r.n === lastN);
  if (!rodada) return null;
  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`🎲 RODADA ${rodada.n} — ${rodada.games.length} jogo(s)${rodada.repechage?.length ? ' (com repescagem)' : ''}`);
  const linhas = rodada.games.map((g) => {
    const nomeA = g.nomeTimeA || 'Time 1';
    const nomeB = g.nomeTimeB || 'Time 2';
    const t1 = g.teamOne.map((p) => `<@${p.discordId}>`).join(' ');
    const t2 = g.teamTwo.map((p) => `<@${p.discordId}>`).join(' ');
    const soma = (team) => team.reduce((s, p) => s + Number(p.baseMmr || 0), 0);
    const diff = Math.abs(soma(g.teamOne) - soma(g.teamTwo));
    const status = g.winner ? `✅ **${g.winner === '1' ? nomeA : nomeB} venceu**` : '⏳ aguardando';
    return `**${g.id}** — ${status}\n🟦 **${nomeA}**: ${t1}\n🟥 **${nomeB}**: ${t2}\nΔ MMR **${diff}**`;
  });
  embed.setDescription(linhas.join('\n\n'));
  if (rodada.repechage?.length) {
    embed.addFields({ name: '🍀 Repescagem (melhores perdedores)', value: rodada.repechage.map((id) => `<@${id}>`).join(' ') });
  }
  return embed;
}

function buildFinalEmbed(t) {
  const f = t.final;
  const nome1 = f.nomeTime1 || 'Time 1';
  const nome2 = f.nomeTime2 || 'Time 2';
  const soma = (team) => team.reduce((s, p) => s + Number(p.baseMmr || 0), 0);
  const diff = Math.abs(soma(f.teamOne) - soma(f.teamTwo));
  const azul = f.sides?.j1 === '1' ? `${nome1} começa no AZUL 🟦` : `${nome2} começa no AZUL 🟦`;
  const jogo1 = (f.games || [])[0];
  const escolheJ3 = jogo1 === '1' ? nome1 : jogo1 === '2' ? nome2 : null;
  const linhas = f.games?.length
    ? `Placar: **${f.wins1} x ${f.wins2}** (${f.games.length} jogo(s))`
    : 'Placar: **0 x 0**';
  const embed = new EmbedBuilder()
    .setColor('#FF2D00')
    .setTitle('🔥 FINAL MD3 — Melhor de 3')
    .setDescription(
      `🟦 **${nome1}**\n${f.teamOne.map((p) => `<@${p.discordId}>`).join(' ')}\n\n` +
      `🟥 **${nome2}**\n${f.teamTwo.map((p) => `<@${p.discordId}>`).join(' ')}\n\n` +
      `${linhas} • Δ MMR **${diff}**\n\n` +
      `Lados: ${azul} (J1) • J2 inverte • ${escolheJ3 ? `${escolheJ3} escolhe o lado no J3` : 'J3: o vencedor do J1 escolhe o lado'}\n` +
      '🚫 **FEARLESS**: proibido pickar campeão usado na partida anterior\n\n' +
      'Staff: `!torneio resultado FINAL <1|2>`'
    );
  return embed;
}

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildCampeoesEmbed({ edition, placar, campeoes, data }) {
  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`🏆 CAMPEÕES DA EDIÇÃO #${edition}`)
    .setDescription(
      `**${placar}**${data ? ` • ${data}` : ''}\n\n` +
      (campeoes || []).map((p) => `<@${p.discordId}> — **${p.nickname}**`).join('\n')
    )
    .setFooter({ text: 'Hall dos Campeões CAPS ARENA' });
  const primeiro = campeoes?.[0]?.avatarURL;
  if (primeiro) embed.setThumbnail(primeiro);
  return embed;
}

// ─── Publicação dos embeds ─────────────────────────────────────────────────
async function canalGuild(guild, id) {
  return guild && id ? guild.channels.fetch(String(id)).catch(() => null) : null;
}

// Status das inscrições (embed editável fixo).
async function atualizarInscricoes(guild, t) {
  if (!guild || !t?.canais?.inscricoes) return;
  const canal = await canalGuild(guild, t.canais.inscricoes);
  if (!canal) return;
  const embed = buildInscricoesEmbed(t);
  try {
    if (t.canais.inscricoesStatusMsg) {
      const msg = await canal.messages.fetch(t.canais.inscricoesStatusMsg).catch(() => null);
      if (msg) { await msg.edit({ embeds: [embed] }); return; }
    }
    const nova = await canal.send({ embeds: [embed] });
    t.canais.inscricoesStatusMsg = nova.id;
  } catch (err) { console.error('[TORNEIO] atualizarInscricoes:', err.message); }
}

// Log de eventos no canal de inscrições (entrada, substituição, avisos).
async function logInscricoes(guild, t, texto) {
  const canal = await canalGuild(guild, t?.canais?.inscricoes);
  if (canal) await canal.send(String(texto).slice(0, 1900)).catch(() => null);
}

// Posta/refresh o embed da rodada atual (ou final) no bracket.
async function atualizarBracket(guild, t, texto = null) {
  if (!guild || !t?.canais?.bracket) return;
  const canal = await canalGuild(guild, t.canais.bracket);
  if (!canal) return;
  try {
    const embedFinal = t.champion ? buildResultadoFinalEmbed(t) : buildRodadaEmbed(t);
    if (embedFinal) {
      await canal.send({ embeds: [embedFinal] });
    }
    if (texto) await canal.send(String(texto).slice(0, 1900));
  } catch (err) { console.error('[TORNEIO] atualizarBracket:', err.message); }
}

// Embed definitivo pós-campeão (fica no bracket, já que o regras/inscrições somem).
function buildResultadoFinalEmbed(t) {
  const f = t.final || {};
  const campeoes = t.champion ? (t.champion.team || []).map((id) => `<@${id}>`).join(' ') : '';
  return new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`🏆 RESULTADO FINAL — EDIÇÃO #${t.edition}`)
    .setDescription(
      `Placar: **${t.champion?.placar || '—'}**\n` +
      `Time 1: ${(f.teamOne || []).map((p) => `<@${p.discordId}>`).join(' ') || '—'}\n` +
      `Time 2: ${(f.teamTwo || []).map((p) => `<@${p.discordId}>`).join(' ') || '—'}\n\n` +
      (campeoes ? `👑 Campeões: ${campeoes}` : '')
    )
    .setFooter({ text: 'Hall dos Campeões CAPS ARENA' });
}

// Posta a nova edição no hall de campeões (1 embed por edição, mais novo embaixo por cronologia de post).
async function postarCampeoes(guild, t, entrada) {
  const canal = await canalGuild(guild, t?.canais?.campeoes);
  if (!canal) return;
  await canal.send({ embeds: [buildCampeoesEmbed(entrada)] }).catch(() => null);
}

// ─── Lobbies de voz ────────────────────────────────────────────────────────
async function lerLobbiesConectados(guild, t) {
  const presente = {};
  for (const lobby of t?.canais?.lobbies || []) {
    const ch = guild ? await guild.channels.fetch(String(lobby.canal)).catch(() => null) : null;
    if (!ch?.members) continue;
    presente[lobby.gameId] = [...ch.members.keys()];
  }
  return presente;
}

// Cria 1 lobby de voz por jogo (limite 10, só os sorteados conectam), move os
// jogadores e grava o marcador de ausência (criadoEm) — a checagem é no tick.
async function criarLobbies(guild, t, jogos, nowMs = Date.now()) {
  if (!guild) return null;
  await apagarLobbies(guild, t);
  if (!t?.canais?.categoria) return null;
  const categoria = await guild.channels.fetch(String(t.canais.categoria)).catch(() => null);
  if (!categoria) return null;
  const bot = guild.members.me;
  const lobbies = [];
  for (const jogo of jogos) {
    const participantes = [...jogo.teamOne, ...jogo.teamTwo].map((p) => p.discordId);
    const ch = await guild.channels.create({
      name: `🔊・lobby-${String(jogo.id).toLowerCase()}-torneio`,
      type: ChannelType.GuildVoice,
      parent: categoria.id,
      userLimit: 10,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, type: 0, allow: ['ViewChannel'], deny: ['Connect'] },
        ...(bot ? [{ id: bot.id, type: 1, allow: ['ViewChannel', 'Connect', 'MoveMembers', 'MuteMembers'] }] : []),
        ...participantes.map((id) => ({ id, type: 1, allow: ['ViewChannel', 'Connect'] }))
      ]
    }).catch((err) => { console.error(`[TORNEIO] lobby ${jogo.id}:`, err.message); return null; });
    if (!ch) continue;
    lobbies.push({ gameId: jogo.id, canal: ch.id });
    for (const id of participantes) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (member?.voice?.channelId && member.voice.channelId !== ch.id) {
        await member.voice.setChannel(ch, 'Torneio CAPS ARENA — movido para o lobby da rodada').catch(() => null);
      }
    }
  }
  t.canais.lobbies = lobbies;
  // Marcador de ausência (una copia compartilhada nos jogos da rodada / final).
  const marcador = { criadoEm: new Date(nowMs).toISOString(), avisoEm: null, aplicadoEm: null };
  const lastN = (t.rounds || []).length;
  if (lastN && t.rounds[lastN - 1]?.games?.some((g) => jogos.some((j) => j.id === g.id))) {
    rodadaAtribuirAusencia(t.rounds[lastN - 1], marcador);
  } else if (t.final && jogos.some((j) => j.id === 'FINAL')) {
    t.final.ausencia = { ...marcador };
  }
  return lobbies;
}

function rodadaAtribuirAusencia(round, marcador) {
  round.ausencia = { ...marcador };
}

// Excluir lobby de um jogo específico (re-balance não precisa; fim da rodada sim).
async function apagarLobbyDoJogo(guild, t, gameId) {
  if (!guild || !t?.canais?.lobbies) return;
  const idx = t.canais.lobbies.findIndex((l) => l.gameId === String(gameId).toUpperCase());
  if (idx < 0) return;
  const [lobby] = t.canais.lobbies.splice(idx, 1);
  const ch = await guild.channels.fetch(String(lobby.canal)).catch(() => null);
  if (ch) await ch.delete('Rodada do torneio encerrada').catch(() => null);
}

// Fecha TODOS os lobbies (fim da rodada completa / encerramento).
async function apagarLobbies(guild, t) {
  if (!t?.canais?.lobbies || !t.canais.lobbies.length) return;
  for (const lobby of t.canais.lobbies) {
    const ch = guild ? await guild.channels.fetch(String(lobby.canal)).catch(() => null) : null;
    if (ch) await ch.delete('Rodada do torneio encerrada').catch(() => null);
  }
  t.canais.lobbies = [];
}

module.exports = {
  CATEGORIA_NOME,
  AUSENCIA_AVISO_MS,
  AUSENCIA_SUBSTITUICAO_MS,
  buildRegrasEmbed,
  buildIntroducaoBracketEmbed,
  ensureCategoriaTorneio,
  arquivarPosCampeao,
  buildRegrasEmbed,
  buildInscricoesEmbed,
  buildRodadaEmbed,
  buildFinalEmbed,
  buildResultadoFinalEmbed,
  buildCampeoesEmbed,
  atualizarInscricoes,
  logInscricoes,
  atualizarBracket,
  postarCampeoes,
  lerLobbiesConectados,
  criarLobbies,
  apagarLobbyDoJogo,
  apagarLobbies
};
