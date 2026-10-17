// Evento SEXTA CAPS ARENA: toda sexta (08h-23h59, horário de SP) as vitórias
// valem PDL em dobro; às 23h59 o bot posta top 3 + melhor da noite.
// Estado em systemMeta.sextaRank { date, gains } e flags sextaAbertaEm/EncerradaEm.
const { EmbedBuilder } = require('discord.js');
const path = require('path');
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
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    postOpen = defaultPostOpen,
    postClose = defaultPostClose
  } = deps;
  return withQueueOperationLock('evento:sexta', async () => {
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
  });
}

function startSextaScheduler() {
  setInterval(() => {
    runSextaTick(Date.now()).catch((err) => console.error('[SEXTA] Erro no tick:', err.message));
  }, 30000).unref?.();
}

// ─── Fim de semana LCL (sex 08h → dom 23h59, horário de SP) ────────────────
// Sex 08h: abre a fila LCL ARENA e liga o LCL BOT. Dom 23h59: posta o ranking
// do fim de semana (séries inter fechadas na janela) e desliga o LCL BOT.
// Fora da janela a fila informa que volta sexta.

const SP_WEEKDAY_INDEX = { dom: 0, sun: 0, seg: 1, mon: 1, ter: 2, tue: 2, qua: 3, wed: 3, qui: 4, thu: 4, sex: 5, fri: 5, sab: 6, sat: 6 };

function spWeekdayIndex(nowMs = Date.now()) {
  const wd = getSPParts(nowMs).weekday.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  return SP_WEEKDAY_INDEX[wd] ?? -1;
}

function isLclWeekendWindow(nowMs = Date.now()) {
  const { minutes } = getSPParts(nowMs);
  const wd = spWeekdayIndex(nowMs);
  if (wd === 5) return minutes >= 8 * 60; // sexta a partir das 08h
  if (wd === 6) return true; // sábado inteiro
  if (wd === 0) return minutes < 24 * 60; // domingo até 23h59
  return false;
}

// Janela Fri 08:00 → Sun 23:59:59 (ms) contendo nowMs.
function lclWeekendRange(nowMs = Date.now()) {
  const parts = getSPParts(nowMs);
  const [y, m, d] = parts.key.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const friday = new Date(base);
  friday.setUTCDate(base.getUTCDate() - ((spWeekdayIndex(nowMs) - 5 + 7) % 7));
  const startMs = Date.UTC(friday.getUTCFullYear(), friday.getUTCMonth(), friday.getUTCDate(), 11, 0, 0);
  const sunday = new Date(friday);
  sunday.setUTCDate(friday.getUTCDate() + 2);
  const endMs = Date.UTC(sunday.getUTCFullYear(), sunday.getUTCMonth(), sunday.getUTCDate() + 1, 2, 59, 59);
  return { startMs, endMs };
}

function spDateKey(ms) {
  return getSPParts(ms).key;
}

function defaultLoadInterMatches() {
  const candidates = [
    process.env.LCL_BOT_DIR,
    path.join(__dirname, '..', 'lcl-bot'),
    'C:\\Users\\ErickSiqueira\\Documents\\BOT CAPS DISCORD\\lcl-bot'
  ];
  for (const dir of candidates) {
    try {
      if (!dir) continue;
      const ds = require(path.join(dir, 'services', 'dataService.js'));
      if (ds?.loadInterMatches) return ds.loadInterMatches();
    } catch { /* proximo */ }
  }
  return Promise.resolve({ matches: {} });
}

async function getLclWeekendTop(loadInterMatches, startMs, endMs) {
  const data = await loadInterMatches().catch(() => ({ matches: {} }));
  const wins = {};
  for (const match of Object.values(data.matches || {})) {
    if (!match?.winner) continue;
    const ts = new Date(match.closedAt || match.endedAt || 0).getTime();
    if (!Number.isFinite(ts) || ts < startMs || ts > endMs) continue;
    const side = match.winner === 'A' ? match.teamA : match.teamB;
    const name = side?.name || `Lado ${match.winner}`;
    const key = `${side?.originGuildId || '?'}:${name}`;
    wins[key] ||= { name, originGuildId: side?.originGuildId || null, wins: 0 };
    wins[key].wins += 1;
  }
  return Object.values(wins).sort((a, b) => b.wins - a.wins);
}

function buildLclWeekendEmbed(top) {
  const embed = new EmbedBuilder()
    .setColor('#FF6B00')
    .setTitle('🔥 Fim de semana LCL — resultado')
    .setFooter({ text: 'Caps Bot • LCL ARENA (sex–dom)' })
    .setTimestamp();
  if (top.length === 0) {
    embed.setDescription('Sem séries inter concluídas neste fim de semana.');
  } else {
    embed.setDescription(
      top.map((t, i) => `**${i + 1}º ${t.name}** — ${t.wins} vitória(s)`).join('\n')
    );
  }
  return embed;
}

async function defaultPostLclOpen() {
  const ids = [config.textChannels?.matchOngoingChannelId, config.textChannels?.queueStatusChannelId].filter(Boolean);
  for (const id of [...new Set(ids)]) {
    const channel = await global.discordClient?.channels?.fetch(id).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send('🔥 **LCL ARENA aberto** — fila interservidores até **domingo 23h59**! Boa sorte aos times.').catch(() => null);
    }
  }
}

async function defaultPostLclClose(top) {
  const id = config.textChannels?.matchOngoingChannelId;
  const channel = id ? await global.discordClient?.channels?.fetch(id).catch(() => null) : null;
  if (channel?.isTextBased?.()) {
    await channel.send({ embeds: [buildLclWeekendEmbed(top)] }).catch(() => null);
  }
}

function defaultSetLclBot(active) {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(`pm2 ${active ? 'start' : 'stop'} lcl-bot`, { timeout: 30000, shell: true }, (error, stdout) => {
      if (error) {
        console.error(`[LCL] Falha ao ${active ? 'ligar' : 'desligar'} lcl-bot:`, error.message.slice(0, 150));
        resolve({ ok: false });
      } else {
        console.log(`[LCL] lcl-bot ${active ? 'ligado' : 'desligado'} para o fim de semana.`);
        resolve({ ok: true });
      }
    });
  });
}

async function runLclTick(nowMs = Date.now(), deps = {}) {
  const {
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    loadInterMatches = defaultLoadInterMatches,
    postOpen = defaultPostLclOpen,
    postClose = defaultPostLclClose,
    setLclBot = defaultSetLclBot
  } = deps;
  return withQueueOperationLock('evento:lcl', async () => {
  const { startMs, endMs } = lclWeekendRange(nowMs);
  const fridayKey = spDateKey(startMs);
  const inWindow = isLclWeekendWindow(nowMs);
  const meta = await loadSystemMeta();
  if (inWindow) {
    if (meta.lclAbertoEm !== fridayKey) {
      await setLclBot(true);
      await postOpen();
      meta.lclAbertoEm = fridayKey;
      await saveSystemMeta(meta);
    }
    return meta;
  }
  if (meta.lclAbertoEm === fridayKey && meta.lclEncerradoEm !== fridayKey && nowMs >= endMs) {
    const top = await getLclWeekendTop(loadInterMatches, startMs, endMs);
    await postClose(top);
    await setLclBot(false);
    meta.lclEncerradoEm = fridayKey;
    await saveSystemMeta(meta);
  }
  return meta;
  });
}

function startLclScheduler() {
  setInterval(() => {
    runLclTick(Date.now()).catch((err) => console.error('[LCL] Erro no tick:', err.message));
  }, 60000).unref?.();
}

// ─── Torneio agendado (dias/horários definidos pelo Admin) ─────────────────
async function defaultPostTorneio(text) {
  const id = config.textChannels?.matchOngoingChannelId;
  const channel = id ? await global.discordClient?.channels?.fetch(id).catch(() => null) : null;
  if (channel?.isTextBased?.()) {
    await channel.send(text).catch(() => null);
  }
}

async function runTorneioTick(nowMs = Date.now(), deps = {}) {
  const {
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    post = defaultPostTorneio
  } = deps;
  return withQueueOperationLock('evento:torneio', async () => {
    const meta = await loadSystemMeta();
    const t = meta.torneio;
    if (!t) return meta;
    const Torneio = require('./torneioService');
    const decision = Torneio.autoTorneioAction(t, nowMs, { abertoEm: meta.torneioAbertoEm, fechadoEm: meta.torneioFechadoEm });
    if (!decision) return meta;
    const flag = decision.action === 'fechar' ? 'torneioFechadoEm' : 'torneioAbertoEm';
    if (meta[flag] === decision.dateKey) return meta;
    if (decision.action === 'abrir') {
      const keep = t.active && !t.champion && (t.players || []).length > 0;
      if (!keep) {
        const nextEdition = !t.active || t.champion ? (t.edition || 0) + 1 : t.edition;
        meta.torneio = Torneio.newTournament(nextEdition);
        if (t.agenda) meta.torneio.agenda = t.agenda;
      } else {
        meta.torneio.active = true;
        meta.torneio.inscricoes = true;
      }
      await post(`🏆 **Inscrições abertas — Torneio #${meta.torneio.edition}!** Use \`!torneio entrar\` (mínimo 20, múltiplo de 10).`);
    } else {
      meta.torneio.inscricoes = false;
      await post(`🔒 **Inscrições do Torneio #${t.edition} encerradas.** Boa sorte a todos!`);
    }
    meta[flag] = decision.dateKey;
    await saveSystemMeta(meta);
    return meta;
  });
}

function startTorneioScheduler() {
  setInterval(() => {
    runTorneioTick(Date.now()).catch((err) => console.error('[TORNEIO] Erro no tick:', err.message));
  }, 60000).unref?.();
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
  startSextaScheduler,
  isLclWeekendWindow,
  lclWeekendRange,
  getLclWeekendTop,
  buildLclWeekendEmbed,
  runLclTick,
  startLclScheduler,
  runTorneioTick,
  startTorneioScheduler
};
