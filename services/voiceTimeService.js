// Tempo em call: conta minutos em voz (mesmo sozinho), pausando quando
// mutado/ensurdecido ou no canal AFK. Janelas: geral, semana e mês.
// Estado em systemMeta.voiceTime (Mongo e JSON):
// { users: { id: { totalMs, week: { key, ms }, month: { key, ms } } },
//   sessions: { "guildId:userId": { since, channelId } },   // sessoes abertas
//   loungeAccess: { userId: 'YYYY-MM' },                    // acesso Lounge VIP
//   lastRewardMonth: 'YYYY-MM' }
// Cargos mensais/permanentes + ranking. Puro e testável; Discord no index.js.
const VOICE_RANKS = [
  { name: '🎙️ Viciado em Call', hours: 30 },
  { name: '🎙️ Frequente', hours: 15 },
  { name: '🎙️ Ativo', hours: 5 }
];
const VOZ_DO_MES_ROLE = '👑 Voz do Mês';
const TOP_MONTH_MIN_HOURS = 5;

function monthKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isoWeekKey(nowMs = Date.now()) {
  const d = new Date(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // seg=0
  d.setUTCDate(d.getUTCDate() - day + 3); // quinta da semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ensureVoiceStore(systemMeta) {
  systemMeta.voiceTime ||= {};
  systemMeta.voiceTime.users ||= {};
  systemMeta.voiceTime.sessions ||= {};
  systemMeta.voiceTime.loungeAccess ||= {};
  return systemMeta.voiceTime;
}

function getUserTime(store, userId, nowMs = Date.now()) {
  const entry = store.users?.[String(userId)];
  const weekKey = isoWeekKey(nowMs);
  const month = monthKey(nowMs);
  return {
    totalMs: Number(entry?.totalMs || 0),
    weekMs: entry?.week?.key === weekKey ? Number(entry.week.ms || 0) : 0,
    monthMs: entry?.month?.key === month ? Number(entry.month.ms || 0) : 0
  };
}

// Fecha sessão aberta acumulando o decorrido (chamado ao sair/mutar/AFK).
function closeSession(store, guildId, userId, nowMs = Date.now()) {
  const key = `${guildId}:${userId}`;
  const session = store.sessions?.[key];
  if (!session?.since) return 0;
  delete store.sessions[key];
  const elapsed = Math.max(0, nowMs - Number(session.since || nowMs));
  if (elapsed <= 0) return 0;
  store.users[String(userId)] ||= { totalMs: 0 };
  const entry = store.users[String(userId)];
  entry.totalMs = Number(entry.totalMs || 0) + elapsed;
  const weekKey = isoWeekKey(nowMs);
  if (!entry.week || entry.week.key !== weekKey) entry.week = { key: weekKey, ms: 0 };
  entry.week.ms = Number(entry.week.ms || 0) + elapsed;
  const month = monthKey(nowMs);
  if (!entry.month || entry.month.key !== month) entry.month = { key: month, ms: 0 };
  entry.month.ms = Number(entry.month.ms || 0) + elapsed;
  return elapsed;
}

function rankForMonth(monthMs) {
  const hours = Number(monthMs || 0) / 3600000;
  const asc = [...VOICE_RANKS].reverse();
  let current = null;
  let next = asc[0];
  for (const rank of asc) {
    if (hours >= rank.hours) current = rank;
    else { next = rank; break; }
  }
  if (current === asc[asc.length - 1]) next = null;
  return { current, next };
}

function formatTempo(ms) {
  const totalMin = Math.floor(Number(ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h} h ${m} min`;
}

function progressBar(monthMs, next) {
  if (!next) return '██████████ 100%';
  const pct = Math.min(100, Math.floor((Number(monthMs || 0) / (next.hours * 3600000)) * 100));
  const filled = Math.floor(pct / 10);
  return `${'█'.repeat(filled)}${'□'.repeat(10 - filled)} ${pct}%`;
}

function getMonthlyTop(store, month = monthKey(Date.now()), limit = 10) {
  return Object.entries(store.users || {})
    .filter(([, e]) => e?.month?.key === month && Number(e.month.ms || 0) > 0)
    .map(([userId, e]) => ({ userId, ms: Number(e.month.ms) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, Math.max(1, limit))
    .map((t, i) => ({ ...t, position: i + 1 }));
}

// Apuração mensal (dia 1º): quem bateu cada cargo no mês passado + top1.
function computeMonthlyRewards(store, refMonth) {
  const top = getMonthlyTop(store, refMonth, 100);
  const earners = { ativo: [], frequente: [], viciado: [] };
  for (const t of top) {
    const h = t.ms / 3600000;
    if (h >= 30) { earners.viciado.push(t.userId); earners.frequente.push(t.userId); earners.ativo.push(t.userId); }
    else if (h >= 15) { earners.frequente.push(t.userId); earners.ativo.push(t.userId); }
    else if (h >= 5) earners.ativo.push(t.userId);
  }
  const eligibleTop = top.find((t) => t.ms >= TOP_MONTH_MIN_HOURS * 3600000) || null;
  return { earners, vozDoMes: eligibleTop?.userId || null, top: top.slice(0, 3) };
}

module.exports = {
  VOICE_RANKS,
  VOZ_DO_MES_ROLE,
  TOP_MONTH_MIN_HOURS,
  monthKey,
  isoWeekKey,
  ensureVoiceStore,
  getUserTime,
  closeSession,
  rankForMonth,
  formatTempo,
  progressBar,
  getMonthlyTop,
  computeMonthlyRewards
};
