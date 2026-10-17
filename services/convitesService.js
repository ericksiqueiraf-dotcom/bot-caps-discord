// Sistema de convites com recompensa (captar novos membros).
// Estado guardado em systemMeta.invites (vale p/ Mongo e JSON local):
// { links: { userId: { code, channelId, createdAt } },
//   uses: [ { code, inviterId, newMemberId, joinedAt, counted } ],
//   monthly: { 'YYYY-MM': { userId: count } },
//   rewarded: { userId: { '3': true, '5': true, '10': true } } }
//
// Tudo aqui é puro (sem Discord API) para ser testável; o index.js faz a
// ponte com guild.invites + guildMemberAdd/guildMemberRemove.

const RECRUIT_THRESHOLDS = [3, 5, 10];
const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FRAUD_LEAVE_WINDOW_MS = 24 * 60 * 60 * 1000;

function monthKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ensureInvitesStore(systemMeta) {
  systemMeta.invites ||= {};
  systemMeta.invites.links ||= {};
  systemMeta.invites.uses ||= [];
  systemMeta.invites.monthly ||= {};
  systemMeta.invites.rewarded ||= {};
  return systemMeta.invites;
}

function countLifetime(store, inviterId) {
  return (store.uses || []).filter((u) => u?.counted && String(u?.inviterId) === String(inviterId)).length;
}

// Registra a entrada de um membro via convite. Retorna o resultado p/ DM/anúncio.
function recordInviteUse(store, { code, inviterId, newMemberId, memberCreatedAtMs, nowMs = Date.now() } = {}) {
  if (!inviterId || !newMemberId || String(inviterId) === String(newMemberId)) {
    return { counted: false, reason: 'sem-convite' };
  }
  const ageMs = nowMs - Number(new Date(memberCreatedAtMs).getTime());
  if (!Number.isFinite(ageMs) || ageMs < MIN_ACCOUNT_AGE_MS) {
    return { counted: false, reason: 'conta-nova' };
  }
  if ((store.uses || []).some((u) => String(u?.newMemberId) === String(newMemberId) && u?.counted)) {
    return { counted: false, reason: 'ja-contado' };
  }
  store.uses.push({
    code: code || null,
    inviterId: String(inviterId),
    newMemberId: String(newMemberId),
    joinedAt: new Date(nowMs).toISOString(),
    counted: true
  });
  const month = monthKey(nowMs);
  store.monthly[month] ||= {};
  store.monthly[month][String(inviterId)] = (store.monthly[month][String(inviterId)] || 0) + 1;
  return { counted: true, monthCount: store.monthly[month][String(inviterId)], lifetime: countLifetime(store, inviterId) };
}

// Saída em até 24h após entrar via convite: estorna o ponto (anti-farm entra/sai).
function handleMemberLeave(store, { newMemberId, nowMs = Date.now() } = {}) {
  const reverted = [];
  for (const use of store.uses || []) {
    if (String(use?.newMemberId) !== String(newMemberId) || !use?.counted) continue;
    if (nowMs - new Date(use.joinedAt).getTime() > FRAUD_LEAVE_WINDOW_MS) continue;
    use.counted = false;
    const month = monthKey(new Date(use.joinedAt).getTime());
    if (store.monthly[month]?.[String(use.inviterId)] > 0) {
      store.monthly[month][String(use.inviterId)] -= 1;
    }
    reverted.push({ inviterId: String(use.inviterId), month });
  }
  return { reverted };
}

// Metas recém-atingidas (marca rewarded para anunciar 1x cada).
function checkThresholdRewards(store, inviterId) {
  const lifetime = countLifetime(store, inviterId);
  store.rewarded[String(inviterId)] ||= {};
  const unlocked = [];
  for (const threshold of RECRUIT_THRESHOLDS) {
    if (lifetime >= threshold && !store.rewarded[String(inviterId)][String(threshold)]) {
      store.rewarded[String(inviterId)][String(threshold)] = true;
      unlocked.push(threshold);
    }
  }
  return { lifetime, unlocked };
}

function getMonthlyTop(store, month = monthKey(), limit = 10) {
  const entries = Object.entries(store.monthly?.[month] || {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit));
  return entries.map(([userId, count], index) => ({ position: index + 1, userId, count }));
}

function getRecruiterStats(store, userId, month = monthKey()) {
  return {
    lifetime: countLifetime(store, userId),
    month: Number(store.monthly?.[month]?.[String(userId)] || 0)
  };
}

module.exports = {
  RECRUIT_THRESHOLDS,
  MIN_ACCOUNT_AGE_MS,
  FRAUD_LEAVE_WINDOW_MS,
  monthKey,
  ensureInvitesStore,
  countLifetime,
  recordInviteUse,
  handleMemberLeave,
  checkThresholdRewards,
  getMonthlyTop,
  getRecruiterStats
};
