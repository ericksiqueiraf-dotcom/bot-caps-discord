// Missões semanais: jogar e vencer partidas rende bônus de PDL.
// Estado em systemMeta.missoes { week, users: { id: { jogos, vitorias, bonus: {} } } }.
// Semana vira sozinha (isoWeekKey); bônus creditado 1x por missão/semana.
const { isoWeekKey } = require('./voiceTimeService');

const MISSIONS = [
  { id: 'jogar3', tipo: 'jogos', meta: 3, premio: 20, desc: 'Jogue 3 partidas na semana' },
  { id: 'vencer2', tipo: 'vitorias', meta: 2, premio: 40, desc: 'Vença 2 partidas na semana' }
];

function ensureMissionsStore(systemMeta, nowMs = Date.now()) {
  const week = isoWeekKey(nowMs);
  if (!systemMeta.missoes || systemMeta.missoes.week !== week) {
    systemMeta.missoes = { week, users: {} };
  }
  systemMeta.missoes.users ||= {};
  return systemMeta.missoes;
}

// Registra 1 partida; retorna missões recém-completadas [{ userId, mission }].
function recordMatchPlayed(store, participantIds = [], winnerIds = []) {
  const completed = [];
  const winners = new Set((winnerIds || []).map(String));
  for (const raw of new Set((participantIds || []).map(String))) {
    if (!raw) continue;
    const u = store.users[raw] ||= { jogos: 0, vitorias: 0, bonus: {} };
    u.jogos = Number(u.jogos || 0) + 1;
    if (winners.has(raw)) u.vitorias = Number(u.vitorias || 0) + 1;
    for (const mission of MISSIONS) {
      const val = mission.tipo === 'jogos' ? u.jogos : u.vitorias;
      if (val >= mission.meta && !u.bonus[mission.id]) {
        u.bonus[mission.id] = true;
        completed.push({ userId: raw, mission });
      }
    }
  }
  return completed;
}

function getProgress(store, userId) {
  const u = store.users?.[String(userId)] || { jogos: 0, vitorias: 0, bonus: {} };
  return MISSIONS.map((mission) => {
    const val = mission.tipo === 'jogos' ? Number(u.jogos || 0) : Number(u.vitorias || 0);
    return { ...mission, atual: Math.min(val, mission.meta), feito: Boolean(u.bonus?.[mission.id]) };
  });
}

module.exports = {
  MISSIONS,
  ensureMissionsStore,
  recordMatchPlayed,
  getProgress
};
