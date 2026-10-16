// Evento SEXTA CAPS ARENA: toda sexta (08h-23h59, horário de SP) as vitórias
// valem PDL em dobro; às 23h59 o bot posta top 3 + melhor da noite.
// Estado em systemMeta.sextaRank { date, gains } e flags sextaAbertaEm/EncerradaEm.
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

function getSPParts(nowMs = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    }).formatToParts(new Date(nowMs))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: String(parts.weekday || '').toLowerCase()
  };
}

function isFridaySP(nowMs = Date.now()) {
  const wd = getSPParts(nowMs).weekday;
  return wd.startsWith('sex') || wd.startsWith('fri');
}

function isSextaRankedWindow(nowMs = Date.now()) {
  if (!isFridaySP(nowMs)) return false;
  const { minutes } = getSPParts(nowMs);
  return minutes >= 8 * 60 && minutes < 24 * 60;
}

function sextaDayKey(nowMs = Date.now()) {
  return getSPParts(nowMs).key;
}

function getPdlMultiplier(nowMs = Date.now()) {
  return isSextaRankedWindow(nowMs) ? 2 : 1;
}

// Soma o PDL ganho pelos vencedores (só dentro da janela; zera ao trocar de dia).
function accumulateSextaGains(store, winners = [], nowMs = Date.now()) {
  if (!isSextaRankedWindow(nowMs)) return store.sextaRank || null;
  const key = sextaDayKey(nowMs);
  store.sextaRank ||= {};
  if (store.sextaRank.date !== key) store.sextaRank = { date: key, gains: {} };
  store.sextaRank.gains ||= {};
  for (const w of winners || []) {
    const id = String(w?.discordId || '');
    if (!id) continue;
    store.sextaRank.gains[id] = (store.sextaRank.gains[id] || 0) + Number(w?.ratingDelta || 0);
  }
  return store.sextaRank;
}

function getSextaTop(store, limit = 3) {
  const entries = Object.entries(store.sextaRank?.gains || {})
    .filter(([, total]) => Number(total) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit));
  return entries.map(([userId, total], index) => ({ position: index + 1, userId, total }));
}

function buildSextaTopEmbed(top) {
  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('🔥 SEXTA CAPS ARENA — resultado da noite')
    .setFooter({ text: 'Caps Bot • Sexta Ranked (PDL em dobro)' })
    .setTimestamp();
  if (top.length === 0) {
    embed.setDescription('Nenhuma vitória com PDL em dobro hoje. Semana que vem tem mais!');
  } else {
    const [best, ...rest] = top;
    embed.setDescription(
      `👑 **Melhor da noite: <@${best.userId}>** (+${best.total} PDL)\n\n` +
      top.map((t) => `**${t.position}º** <@${t.userId}> — +${t.total} PDL`).join('\n')
    );
    void rest;
  }
  return embed;
}

async function defaultPostOpen() {
  const ids = [config.textChannels?.matchOngoingChannelId, config.textChannels?.queueStatusChannelId].filter(Boolean);
  for (const id of [...new Set(ids)]) {
    const channel = await global.discordClient?.channels?.fetch(id).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send('🔥 **SEXTA CAPS ARENA** — até 23h59 as vitórias valem **PDL em dobro**! Boa noite de jogos!').catch(() => null);
    }
  }
}

async function defaultPostClose(top) {
  const id = config.textChannels?.matchOngoingChannelId;
  const channel = id ? await global.discordClient?.channels?.fetch(id).catch(() => null) : null;
  if (channel?.isTextBased?.()) {
    await channel.send({ embeds: [buildSextaTopEmbed(top)] }).catch(() => null);
  }
}

async function runSextaTick(nowMs = Date.now(), deps = {}) {
  const {
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    postOpen = defaultPostOpen,
    postClose = defaultPostClose
  } = deps;
  const { minutes, key } = getSPParts(nowMs);
  const friday = isFridaySP(nowMs);
  const meta = await loadSystemMeta();
  if (friday && minutes >= 8 * 60 && meta.sextaAbertaEm !== key) {
    await postOpen();
    meta.sextaAbertaEm = key;
    await saveSystemMeta(meta);
  }
  if (friday && minutes >= 23 * 60 + 59 && meta.sextaEncerradaEm !== key) {
    const top = getSextaTop(meta, 3);
    await postClose(top);
    meta.sextaEncerradaEm = key;
    await saveSystemMeta(meta);
  }
  return meta;
}

function startSextaScheduler() {
  setInterval(() => {
    runSextaTick(Date.now()).catch((err) => console.error('[SEXTA] Erro no tick:', err.message));
  }, 30000).unref?.();
}

module.exports = {
  getSPParts,
  isFridaySP,
  isSextaRankedWindow,
  sextaDayKey,
  getPdlMultiplier,
  accumulateSextaGains,
  getSextaTop,
  buildSextaTopEmbed,
  runSextaTick,
  startSextaScheduler
};
