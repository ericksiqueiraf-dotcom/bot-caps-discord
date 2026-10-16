// Duelos 1x1 de PDL: A desafia B valendo pontos; quem vencer leva.
// Estado em systemMeta.duelos [ { id, a, b, pontos, status, createdAt } ].
// Liquidação acontece no pós-vitória (adversários em times opostos).
const DUEL_MIN = 10;
const DUEL_MAX = 200;
const DUEL_DEFAULT = 50;
const DUEL_EXPIRY_MS = 7 * 24 * 3600 * 1000;

function expireDuels(duelos = [], nowMs = Date.now()) {
  return (duelos || []).filter((d) => d?.status !== 'pendente' || nowMs - new Date(d.createdAt).getTime() <= DUEL_EXPIRY_MS);
}

function pendingBetween(duelos = [], idA, idB) {
  const a = String(idA), b = String(idB);
  return (duelos || []).find((d) => d?.status === 'pendente' &&
    ((d.a === a && d.b === b) || (d.a === b && d.b === a))) || null;
}

function createDuel(duelos, challengerId, challengedId, pontos, nowMs = Date.now()) {
  const a = String(challengerId || ''), b = String(challengedId || '');
  if (!a || !b || a === b) return { ok: false, message: 'Desafie alguém válido (não vale você mesmo).' };
  const valor = Number(pontos ?? DUEL_DEFAULT);
  if (!Number.isInteger(valor) || valor < DUEL_MIN || valor > DUEL_MAX) {
    return { ok: false, message: `Pontos de ${DUEL_MIN} a ${DUEL_MAX} (padrão ${DUEL_DEFAULT}).` };
  }
  const pending = expireDuels(duelos, nowMs);
  if (pendingBetween(pending, a, b)) return { ok: false, message: 'Já existe um duelo pendente entre vocês.' };
  pending.push({ id: `d${nowMs}`, a, b, pontos: valor, status: 'pendente', createdAt: new Date(nowMs).toISOString() });
  return { ok: true, duelos: pending, valor };
}

function acceptDuel(duelos, userId, nowMs = Date.now()) {
  const pending = expireDuels(duelos, nowMs);
  const duel = [...pending].reverse().find((d) => d?.status === 'pendente' && d.b === String(userId));
  if (!duel) return { ok: false, duelos: pending, message: 'Nenhum desafio para você aceitar.' };
  duel.status = 'aceito';
  return { ok: true, duelos: pending, duel };
}

function refuseDuel(duelos, userId, nowMs = Date.now()) {
  const pending = expireDuels(duelos, nowMs);
  const duel = [...pending].reverse().find((d) => d?.status === 'pendente' && d.b === String(userId));
  if (!duel) return { ok: false, duelos: pending, message: 'Nenhum desafio pendente.' };
  duel.status = 'recusado';
  return { ok: true, duelos: pending, duel };
}

// Liquida duelos aceitos quando os dois caem em lados opostos da partida.
function settleDuels(duelos, teamOneIds = [], teamTwoIds = [], winningTeam, nowMs = Date.now()) {
  const pending = expireDuels(duelos, nowMs);
  const t1 = new Set(teamOneIds.map(String));
  const t2 = new Set(teamTwoIds.map(String));
  const settled = [];
  for (const duel of pending) {
    if (duel?.status !== 'aceito') continue;
    const aIn1 = t1.has(duel.a), aIn2 = t2.has(duel.a);
    const bIn1 = t1.has(duel.b), bIn2 = t2.has(duel.b);
    if (!((aIn1 && bIn2) || (aIn2 && bIn1))) continue;
    const winnerIsA = (winningTeam === '1' && aIn1) || (winningTeam === '2' && aIn2);
    const winnerId = winnerIsA ? duel.a : duel.b;
    const loserId = winnerIsA ? duel.b : duel.a;
    duel.status = 'concluido';
    duel.winnerId = winnerId;
    settled.push({ winnerId, loserId, pontos: duel.pontos });
  }
  return { duelos: pending, settled };
}

module.exports = {
  DUEL_MIN,
  DUEL_MAX,
  DUEL_DEFAULT,
  DUEL_EXPIRY_MS,
  expireDuels,
  pendingBetween,
  createDuel,
  acceptDuel,
  refuseDuel,
  settleDuels
};
