// Divulgação das redes sociais / canais oficiais da CAPS ARENA.
// - Posta automaticamente 3x/dia (horário de SP) no canal geral — horários e
//   canal configuráveis em `config.social`, sem mexer no código.
// - `!social` / `/social` posta o mesmo painel sob demanda.
// - Anti-duplicação por slot em `systemMeta.socialUltimoSlot` (ex.: "2026-10-17#17"):
//   cada horário posta no máximo 1x por dia, mesmo com restart no meio.
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const config = require('../config.json');
const { getSPParts } = require('./eventoService');

const HORAS_DEFAULT = [10, 16, 21];
const CANAIS_PADRAO = ['💬・geral-leagueoflegends'];
const FALLBACK_NOME_RE = /comunicado|an[úu]ncio|announcement/i;

// Pôster agendado do torneio: vai p/ comunicados + geral, nos mesmos horários.
const POSTER_CANAIS_DEFAULT = ['📢┃comunicados', '💬・geral-leagueoflegends'];

// Prévia agendada do torneio (embeds de regras/bracket + banner novo) — `social.torneioPreview`.
const PREVIEW_CANAIS_DEFAULT = ['🤖・comandos'];
const PREVIEW_BANNER_DEFAULT = 'assets/torneio-banner.png';
const PREVIEW_ANEXO_NOME = 'torneio-banner.png';

const REDES = [
  { key: 'instagram', emoji: '📸', nome: 'Instagram' },
  { key: 'twitch', emoji: '🟣', nome: 'Twitch' },
  { key: 'tiktok', emoji: '🎵', nome: 'TikTok' },
  { key: 'youtube', emoji: '▶️', nome: 'YouTube' }
];

// Link só vale se estiver configurado e for uma URL http(s).
function linkDaRede(key, cfg = config) {
  const url = String(cfg?.social?.links?.[key] || '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function getRedes(cfg = config) {
  return REDES.map((rede) => ({ ...rede, url: linkDaRede(rede.key, cfg) }));
}

function buildSocialEmbed(cfg = config) {
  const linhas = getRedes(cfg).map((rede) => (
    rede.url ? `${rede.emoji} **${rede.nome}** — ${rede.url}` : `${rede.emoji} **${rede.nome}** — em breve 🔜`
  ));
  return new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('📣 CAPS ARENA — canais e redes sociais oficiais')
    .setDescription(
      ['Siga a **CAPS ARENA** e não perca nada: lives, torneios, cortes e novidades.', '', ...linhas].join('\n')
    )
    .setFooter({ text: 'Caps Bot • Redes oficiais • !social' })
    .setTimestamp();
}

// Horas (0-23 SP) em que a divulgação roda. Config inválida cai no padrão.
function getHoras(cfg = config) {
  const raw = cfg?.social?.horas;
  if (!Array.isArray(raw)) return [...HORAS_DEFAULT];
  const horas = [...new Set(raw.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))]
    .sort((a, b) => a - b);
  return horas.length ? horas : [...HORAS_DEFAULT];
}

// Slot do momento atual ("AAAA-MM-DD#HH") ou null se não for hora de divulgar.
function socialSlot(nowMs = Date.now(), cfg = config) {
  const partes = getSPParts(nowMs);
  const hora = Math.floor(partes.minutes / 60);
  if (!getHoras(cfg).includes(hora)) return null;
  return `${partes.key}#${hora}`;
}

// Canal da divulgação: id do config > nome exato > nome parcial > canal de avisos.
function findSocialChannel(guild, cfg = config) {
  try {
    const canais = [...(guild?.channels?.cache?.values?.() || [])];
    const id = String(cfg?.social?.divulgacaoChannelId || '');
    if (id) {
      const porId = guild?.channels?.cache?.get?.(id);
      if (porId?.isTextBased?.()) return porId;
    }
    for (const nome of CANAIS_PADRAO) {
      const exato = canais.find((c) => c?.isTextBased?.() && String(c?.name || '') === nome);
      if (exato) return exato;
    }
    const parcial = canais.find((c) => c?.isTextBased?.() && String(c?.name || '').includes('geral-leagueoflegends'));
    if (parcial) return parcial;
    return canais.find((c) => c?.isTextBased?.() && FALLBACK_NOME_RE.test(String(c?.name || ''))) || null;
  } catch { return null; }
}

// Todos os canais (únicos, na ordem pedida) que casam com os nomes — exato
// primeiro, depois parcial. Entradas numéricas (ID) são resolvidas por ID.
// Usado pelo pôster, que vai em mais de um canal.
function findCanaisPorNomes(guild, nomes = []) {
  const achados = [];
  const vistos = new Set();
  try {
    const canais = [...(guild?.channels?.cache?.values?.() || [])];
    const push = (canal) => {
      if (!canal?.isTextBased?.() || vistos.has(String(canal.id))) return;
      vistos.add(String(canal.id));
      achados.push(canal);
    };
    for (const nome of nomes) {
      const alvo = String(nome || '');
      if (!alvo) continue;
      if (/^\d{17,20}$/.test(alvo)) { push(guild?.channels?.cache?.get?.(alvo)); continue; }
      const exatos = canais.filter((c) => c?.isTextBased?.() && String(c?.name || '') === alvo);
      if (exatos.length) { exatos.forEach(push); continue; }
      canais.filter((c) => c?.isTextBased?.() && String(c?.name || '').includes(alvo)).forEach(push);
    }
  } catch { /* devolve o que achou */ }
  return achados;
}

// Config do pôster agendado (`config.social.poster`) com defaults seguros.
function getPosterCfg(cfg = config) {
  const p = cfg?.social?.poster || {};
  return {
    ativo: p.ativo !== false,
    canais: Array.isArray(p.canais) && p.canais.length ? p.canais.map(String) : [...POSTER_CANAIS_DEFAULT],
    horas: Array.isArray(p.horas) && p.horas.length ? getHoras({ social: { horas: p.horas } }) : getHoras(cfg)
  };
}

// Canais do pôster: os nomeados na config; se nenhum existir, cai no canal da divulgação.
function findPosterChannels(guild, cfg = config) {
  const alvo = getPosterCfg(cfg);
  const canais = findCanaisPorNomes(guild, alvo.canais);
  if (canais.length) return canais;
  const fallback = findSocialChannel(guild, cfg);
  return fallback ? [fallback] : [];
}

// Slot do pôster ("AAAA-MM-DD#HH") ou null se não for hora de postar.
function posterSlot(nowMs = Date.now(), cfg = config) {
  const partes = getSPParts(nowMs);
  const hora = Math.floor(partes.minutes / 60);
  if (!getPosterCfg(cfg).horas.includes(hora)) return null;
  return `${partes.key}#${hora}`;
}

// Payload CANÔNICO do torneio para os posts automáticos: pôster (comunicados/
// geral) e prévia (comandos) usam os MESMOS embeds — fonte única no
// TORNEIO_INFO — para nunca circularem dois regulamentos diferentes.
// Edição real quando existe torneio no estado; senão demo (edição 1).
function buildTorneioPayload(meta = {}) {
  // Require dentro (torneioChannels→torneioService carregam jogo; evita ordem pesada no boot).
  const C = require('./torneioChannelsService');
  const T = require('./torneioService');
  const torneio = meta.torneio?.edition ? { ...meta.torneio } : T.newTournament(1);
  return {
    content: `🏆 **Torneio CAPS ARENA (Edição #${torneio.edition})** — regulamento em \`!torneio info\` • inscrição: \`!torneio entrar\``,
    embeds: [C.buildRegrasEmbed(torneio, true), C.buildIntroducaoBracketEmbed()]
  };
}

// Posta o pôster nos canais configurados. Anti-duplicação por canal/slot em
// `systemMeta.posterSlots` (sobrevive a restart e não perde canal que falhou).
// A janela load→save roda na fila global 'evento:systemMeta' — sem ela, ticks
// concorrentes (social/pôster/prévia/torneio) sobrescrevem o meta inteiro e o
// slot se perde → post duplicado no minuto seguinte.
// Conteúdo: MESMO payload canônico da prévia (regras + bracket + banner) —
// nunca dois regulamentos diferentes no servidor.
async function runPosterTick(nowMs = Date.now(), deps = {}) {
  const {
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    guilds = global.discordClient?.guilds?.cache?.values?.() || [],
    cfg = config,
    anexoFactory = (arquivo) => new AttachmentBuilder(arquivo, { name: PREVIEW_ANEXO_NOME })
  } = deps;

  const alvo = getPosterCfg(cfg);
  if (!alvo.ativo) return { posted: 0, reason: 'pôster desativado' };

  const slot = posterSlot(nowMs, cfg);
  if (!slot) return { posted: 0, reason: 'fora de horário' };

  const arquivo = bannerPreviewPath(cfg);
  if (!fs.existsSync(arquivo)) return { posted: 0, reason: `banner ausente: ${getTorneioPreviewCfg(cfg).banner}` };

  return withQueueOperationLock('evento:systemMeta', async () => {
    const meta = (await loadSystemMeta()) || {};
    const slots = meta.posterSlots && typeof meta.posterSlots === 'object' ? meta.posterSlots : {};
    const { content, embeds } = buildTorneioPayload(meta);
    let posted = 0;

    for (const guild of guilds) {
      for (const canal of findPosterChannels(guild, cfg)) {
        const chave = String(canal.id);
        if (slots[chave] === slot) continue;
        try {
          await canal.send({ content, embeds, files: [anexoFactory(arquivo)] });
          slots[chave] = slot;
          posted += 1;
        } catch { /* próximo canal */ }
      }
    }

    if (posted > 0) {
      meta.posterSlots = slots;
      meta.posterUltimoSlot = slot;
      await saveSystemMeta(meta);
    }
    return { posted, slot };
  });
}

// ─── Prévia agendada do torneio (`config.social.torneioPreview`) ────────────
// 3x/dia (mesmos horários do pôster) nos canais configurados: regras + bracket
// + banner anexado. Anti-duplicação por canal/slot em `systemMeta.torneioPreviewSlots`.
function getTorneioPreviewCfg(cfg = config) {
  const p = cfg?.social?.torneioPreview || {};
  return {
    ativo: p.ativo !== false,
    canais: Array.isArray(p.canais) && p.canais.length ? p.canais.map(String) : [...PREVIEW_CANAIS_DEFAULT],
    horas: Array.isArray(p.horas) && p.horas.length ? getHoras({ social: { horas: p.horas } }) : getHoras(cfg),
    banner: String(p.banner || PREVIEW_BANNER_DEFAULT)
  };
}

function bannerPreviewPath(cfg = config) {
  const bruto = getTorneioPreviewCfg(cfg).banner;
  return path.isAbsolute(bruto) ? bruto : path.join(__dirname, '..', bruto);
}

function torneioPreviewSlot(nowMs = Date.now(), cfg = config) {
  const partes = getSPParts(nowMs);
  const hora = Math.floor(partes.minutes / 60);
  if (!getTorneioPreviewCfg(cfg).horas.includes(hora)) return null;
  return `${partes.key}#${hora}`;
}

async function runTorneioPreviewTick(nowMs = Date.now(), deps = {}) {
  const {
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    guilds = global.discordClient?.guilds?.cache?.values?.() || [],
    cfg = config,
    anexoFactory = (arquivo) => new AttachmentBuilder(arquivo, { name: PREVIEW_ANEXO_NOME })
  } = deps;

  const alvo = getTorneioPreviewCfg(cfg);
  if (!alvo.ativo) return { posted: 0, reason: 'prévia desativada' };

  const slot = torneioPreviewSlot(nowMs, cfg);
  if (!slot) return { posted: 0, reason: 'fora de horário' };

  const arquivo = bannerPreviewPath(cfg);
  if (!fs.existsSync(arquivo)) return { posted: 0, reason: `banner ausente: ${alvo.banner}` };

  // Janela meta na fila global (mesmo lock do torneio/sexta/lcl/social).
  return withQueueOperationLock('evento:systemMeta', async () => {
    const meta = (await loadSystemMeta()) || {};
    const slots = meta.torneioPreviewSlots && typeof meta.torneioPreviewSlots === 'object' ? meta.torneioPreviewSlots : {};
    // MESMO payload canônico do pôster — um regulamento só no servidor.
    const { content, embeds } = buildTorneioPayload(meta);
    let posted = 0;

    for (const guild of guilds) {
      for (const canal of findCanaisPorNomes(guild, alvo.canais)) {
        const chave = String(canal.id);
        if (slots[chave] === slot) continue;
        try {
          await canal.send({ content, embeds, files: [anexoFactory(arquivo)] });
          slots[chave] = slot;
          posted += 1;
        } catch { /* próximo canal */ }
      }
    }

    if (posted > 0) {
      meta.torneioPreviewSlots = slots;
      meta.torneioPreviewUltimoSlot = slot;
      await saveSystemMeta(meta);
    }
    return { posted, slot };
  });
}

async function runSocialTick(nowMs = Date.now(), deps = {}) {
  const {
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    guilds = global.discordClient?.guilds?.cache?.values?.() || [],
    cfg = config
  } = deps;

  const slot = socialSlot(nowMs, cfg);
  if (!slot) return { posted: 0, reason: 'fora de horário' };

  // Janela meta na fila global (mesmo lock do torneio/sexta/lcl/pôster/prévia).
  return withQueueOperationLock('evento:systemMeta', async () => {
    const meta = (await loadSystemMeta()) || {};
    if (meta.socialUltimoSlot === slot) return { posted: 0, reason: 'já postado nesse horário' };

    const embed = buildSocialEmbed(cfg);
    let posted = 0;
    for (const guild of guilds) {
      try {
        const canal = findSocialChannel(guild, cfg);
        if (!canal) continue;
        await canal.send({ embeds: [embed] });
        posted += 1;
      } catch { /* próxima guild */ }
    }
    if (posted > 0) {
      meta.socialUltimoSlot = slot;
      await saveSystemMeta(meta);
    }
    return { posted, slot };
  });
}

// Ticks sequenciais: mesmo com a fila global, evita disparar os 3 ao mesmo tempo.
function startSocialScheduler() {
  setInterval(() => {
    (async () => {
      await runSocialTick(Date.now()).catch((err) => console.error('[SOCIAL] Erro na divulgação automática:', err.message));
      await runPosterTick(Date.now()).catch((err) => console.error('[SOCIAL] Erro no pôster agendado:', err.message));
      await runTorneioPreviewTick(Date.now()).catch((err) => console.error('[SOCIAL] Erro na prévia do torneio:', err.message));
      await require('./communityScheduleService').runWeeklyScheduleTick(Date.now())
        .catch((err) => console.error('[AGENDA] Erro na publicação semanal:', err.message));
    })();
  }, 60000).unref?.();
  require('./communityScheduleService').runWeeklyScheduleTick(Date.now())
    .catch((err) => console.error('[AGENDA] Erro na publicação semanal inicial:', err.message));
}

module.exports = {
  HORAS_DEFAULT,
  CANAIS_PADRAO,
  POSTER_CANAIS_DEFAULT,
  REDES,
  getRedes,
  linkDaRede,
  buildSocialEmbed,
  getHoras,
  socialSlot,
  findSocialChannel,
  findCanaisPorNomes,
  getPosterCfg,
  findPosterChannels,
  posterSlot,
  buildTorneioPayload,
  runSocialTick,
  runPosterTick,
  runTorneioPreviewTick,
  getTorneioPreviewCfg,
  torneioPreviewSlot,
  PREVIEW_CANAIS_DEFAULT,
  PREVIEW_BANNER_DEFAULT,
  PREVIEW_ANEXO_NOME,
  startSocialScheduler
};
