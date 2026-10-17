// Divulgação das redes sociais / canais oficiais da CAPS ARENA.
// - Posta automaticamente 3x/dia (horário de SP) no canal geral — horários e
//   canal configuráveis em `config.social`, sem mexer no código.
// - `!social` / `/social` posta o mesmo painel sob demanda.
// - Anti-duplicação por slot em `systemMeta.socialUltimoSlot` (ex.: "2026-10-17#17"):
//   cada horário posta no máximo 1x por dia, mesmo com restart no meio.
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { getSPParts } = require('./eventoService');

const HORAS_DEFAULT = [10, 16, 21];
const CANAIS_PADRAO = ['💬・geral-leagueoflegends'];
const FALLBACK_NOME_RE = /comunicado|an[úu]ncio|announcement/i;

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

async function runSocialTick(nowMs = Date.now(), deps = {}) {
  const {
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    guilds = global.discordClient?.guilds?.cache?.values?.() || [],
    cfg = config
  } = deps;

  const slot = socialSlot(nowMs, cfg);
  if (!slot) return { posted: 0, reason: 'fora de horário' };

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
}

function startSocialScheduler() {
  setInterval(() => {
    runSocialTick(Date.now()).catch((err) => console.error('[SOCIAL] Erro na divulgação automática:', err.message));
  }, 60000).unref?.();
}

module.exports = {
  HORAS_DEFAULT,
  CANAIS_PADRAO,
  REDES,
  getRedes,
  linkDaRede,
  buildSocialEmbed,
  getHoras,
  socialSlot,
  findSocialChannel,
  runSocialTick,
  startSocialScheduler
};
