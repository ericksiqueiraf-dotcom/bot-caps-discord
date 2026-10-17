// Torneio CAPS ARENA — mata-mata com sorteio por rodada.
// - Inscrição individual; mínimo 20, sempre múltiplo de 10.
// - Cada rodada: grupos de 10 sorteados por MMR + times 5x5 balanceados.
// - Vencedores avançam; se não fechar 10, repescagem dos melhores perdedores
//   (maior baseMmr da rodada).
// - Final com 10: 1 sorteio, mesmos times, MD3.
// - Estado em systemMeta.torneio (vale p/ Mongo e JSON). Puro e testável;
//   Discord (cargos/anúncios) fica nos handlers.
const MIN_PLAYERS = 20;
const TEAM_SIZE = 5;
const FINAL_SIZE = 10;
const TORNEIO_CARGO_NOME = '🏆 Campeão CAPS';

const TORNEIO_INFO =
  '🏆 **TORNEIO CAPS ARENA** — mata-mata com sorteio por rodada.\n' +
  '• Inscrição individual: `!torneio entrar` (mínimo 20, múltiplo de 10)\n' +
  '• A cada rodada o bot monta partidas **5x5 balanceadas**; quem perde sai, quem ganha avança\n' +
  '• Se os vencedores não fecharem 10, entra a **repescagem** (melhores perdedores da rodada)\n' +
  '• **Final**: 1 sorteio, mesmos times, **MD3** (melhor de 3)\n' +
  '• Campeões ganham o cargo 🏆 (premiação extra a decidir)';

function newTournament(edition = 1) {
  return {
    active: true,
    inscricoes: true,
    agenda: null,
    edition,
    players: [],
    rounds: [],
    final: null,
    champion: null,
    createdAt: new Date().toISOString()
  };
}

function joinTournament(t, userId) {
  const id = String(userId || '');
  if (!t?.active) return { ok: false, message: 'Nenhum torneio aberto. Aguarde o próximo!' };
  if (t.inscricoes === false) return { ok: false, message: 'Inscrições fechadas para este torneio.' };
  if (!id) return { ok: false, message: 'Usuário inválido.' };
  if (t.players.includes(id)) return { ok: false, message: 'Você já está inscrito no torneio!' };
  if (t.rounds.length > 0) return { ok: false, message: 'O torneio já começou — inscrições encerradas.' };
  t.players.push(id);
  return { ok: true, count: t.players.length };
}

function leaveTournament(t, userId) {
  const id = String(userId || '');
  const idx = (t.players || []).indexOf(id);
  if (idx < 0) return { ok: false, message: 'Você não está inscrito.' };
  if (t.rounds.length > 0) return { ok: false, message: 'O torneio já começou — não dá mais para sair.' };
  t.players.splice(idx, 1);
  return { ok: true, count: t.players.length };
}

function startRequirement(t) {
  const n = (t.players || []).length;
  if (n < MIN_PLAYERS) return { ok: false, message: `Faltam ${MIN_PLAYERS - n} inscritos (mínimo ${MIN_PLAYERS}, múltiplo de 10).` };
  if (n % FINAL_SIZE !== 0) return { ok: false, message: `São ${n} inscritos — precisa ser múltiplo de 10.` };
  return { ok: true };
}

// pool: [{ discordId, nickname, baseMmr }]. balanceFn: (grupoDe10) => { teamOne, teamTwo }.
function drawGames(pool, balanceFn, roundLabel) {
  const sorted = [...pool].sort((a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0));
  const ng = sorted.length / FINAL_SIZE;
  const groups = Array.from({ length: ng }, () => []);
  sorted.forEach((p, idx) => {
    const round = Math.floor(idx / ng);
    const g = round % 2 === 0 ? idx % ng : ng - 1 - (idx % ng);
    groups[g].push(p);
  });
  return groups.map((group, gi) => {
    const teams = balanceFn(group);
    const slim = (list) => list.map((p) => ({ discordId: String(p.discordId), nickname: p.nickname || p.discordId, baseMmr: Number(p.baseMmr || 0) }));
    return { id: `${roundLabel}-J${gi + 1}`, teamOne: slim(teams.teamOne), teamTwo: slim(teams.teamTwo), winner: null };
  });
}

function findGame(t, gameId) {
  for (const round of t.rounds || []) {
    const game = (round.games || []).find((g) => g.id === String(gameId).toUpperCase());
    if (game) return { game, round };
  }
  return {};
}

function recordGameResult(t, gameId, winner) {
  const w = String(winner);
  if (!['1', '2'].includes(w)) return { ok: false, message: 'Use `!torneio resultado <jogo> <1|2>` (ex: `!torneio resultado R1-J1 2`).' };
  const { game } = findGame(t, gameId);
  if (!game) return { ok: false, message: `Jogo ${String(gameId).toUpperCase()} não encontrado.` };
  if (game.winner) return { ok: false, message: `Jogo ${game.id} já teve resultado (time ${game.winner}).` };
  game.winner = w;
  return { ok: true, game };
}

function roundGames(t, roundN) {
  const round = (t.rounds || []).find((r) => r.n === roundN);
  return round ? round.games : [];
}

function roundComplete(t, roundN) {
  const games = roundGames(t, roundN);
  return games.length > 0 && games.every((g) => g.winner);
}

function roundWinners(t, roundN) {
  const out = [];
  for (const g of roundGames(t, roundN)) {
    if (!g.winner) continue;
    out.push(...(g.winner === '1' ? g.teamOne : g.teamTwo));
  }
  return out;
}

function roundLosers(t, roundN) {
  const out = [];
  for (const g of roundGames(t, roundN)) {
    if (!g.winner) continue;
    out.push(...(g.winner === '1' ? g.teamTwo : g.teamOne));
  }
  return out.sort((a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0));
}

// Avança: vencedores (+ repescagem se não fechar 10) viram próxima rodada ou final.
function advanceTournament(t, balanceFn) {
  const lastN = (t.rounds || []).length;
  if (lastN === 0) return { ok: false, message: 'Nenhuma rodada sorteada ainda.' };
  if (!roundComplete(t, lastN)) return { ok: false, message: `Rodada ${lastN} ainda tem jogos sem resultado.` };
  if (t.final) return { ok: false, message: 'A final já está rolando.' };
  const winners = roundWinners(t, lastN);
  if (winners.length === FINAL_SIZE) {
    const teams = balanceFn(winners);
    t.final = {
      teamOne: teams.teamOne, teamTwo: teams.teamTwo,
      wins1: 0, wins2: 0, games: []
    };
    return { ok: true, type: 'final', final: t.final };
  }
  const need = Math.ceil(winners.length / FINAL_SIZE) * FINAL_SIZE - winners.length;
  const losers = roundLosers(t, lastN);
  if (losers.length < need) return { ok: false, message: 'Repescagem impossível: perdedores insuficientes.' };
  const repechage = losers.slice(0, need);
  const pool = [...winners, ...repechage];
  const games = drawGames(pool, balanceFn, `R${lastN + 1}`);
  t.rounds.push({ n: lastN + 1, games, repechage: repechage.map((p) => p.discordId) });
  return { ok: true, type: 'round', round: lastN + 1, games, repechage };
}

function recordFinalGame(t, winner) {
  const w = String(winner);
  if (!t.final) return { ok: false, message: 'Ainda não há final.' };
  if (t.champion) return { ok: false, message: 'Torneio já encerrado.' };
  if (!['1', '2'].includes(w)) return { ok: false, message: 'Use `!torneio resultado FINAL <1|2>`.' };
  t.final.games.push(w);
  if (w === '1') t.final.wins1 += 1;
  else t.final.wins2 += 1;
  if (t.final.wins1 >= 2 || t.final.wins2 >= 2) {
    const champs = t.final.wins1 >= 2 ? t.final.teamOne : t.final.teamTwo;
    t.champion = { team: champs.map((p) => p.discordId), at: new Date().toISOString(), placar: `${t.final.wins1}x${t.final.wins2}` };
    return { ok: true, champion: true, final: t.final };
  }
  return { ok: true, champion: false, final: t.final };
}

const DIAS_PT = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, 'terça': 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6, 'sábado': 6 };

function parseDiasArg(raw) {
  const parts = String(raw || '').split(/[,\s/]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const dias = [];
  for (const part of parts) {
    if (/^[0-6]$/.test(part)) {
      if (!dias.includes(Number(part))) dias.push(Number(part));
      continue;
    }
    const key = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (DIAS_PT[key] !== undefined && !dias.includes(DIAS_PT[key])) dias.push(DIAS_PT[key]);
  }
  return dias.sort();
}

function parseHoraArg(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(?::|h)?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatAgenda(agenda) {
  if (!agenda?.dias?.length) return 'sem agendamento';
  const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const dias = agenda.dias.map((d) => nomes[d]).join(', ');
  const hora = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return `${dias} • abre ${hora(agenda.abrirMin)} / fecha ${hora(agenda.fecharMin)}`;
}

function setAgenda(t, diasRaw, abrirRaw, fecharRaw) {
  const dias = parseDiasArg(diasRaw);
  const abrirMin = parseHoraArg(abrirRaw);
  const fecharMin = parseHoraArg(fecharRaw);
  if (dias.length === 0) return { ok: false, message: 'Dias inválidos. Ex: `sex,sab` ou `5,6`.' };
  if (abrirMin === null || fecharMin === null) return { ok: false, message: 'Horário inválido. Ex: `19:00`.' };
  if (abrirMin >= fecharMin) return { ok: false, message: 'A abertura precisa ser antes do fechamento.' };
  t.agenda = { dias, abrirMin, fecharMin };
  return { ok: true, agenda: t.agenda };
}

// Decide ação automática (ou null) para o instante dado.
// flags: { abertoEm, fechadoEm } (dateKeys já anunciados) — garante 1x/dia.
// Nunca mexe em torneio com rodada sorteada (em andamento).
function autoTorneioAction(t, nowMs = Date.now(), flags = {}) {
  const agenda = t?.agenda;
  if (!agenda?.dias?.length) return null;
  const { getSPParts } = require('./eventoService');
  const parts = getSPParts(nowMs);
  const wd = weekdayIndex(parts.weekday);
  if (wd < 0 || !agenda.dias.includes(wd)) return null;
  if ((t.rounds || []).length > 0 || t.final) return null;
  if (parts.minutes >= agenda.abrirMin && parts.minutes < agenda.fecharMin) {
    if (flags.abertoEm === parts.key) return null;
    if ((t.rounds || []).length > 0 || t.final) return null;
    return { action: 'abrir', dateKey: parts.key };
  }
  if (parts.minutes >= agenda.fecharMin) {
    if (flags.fechadoEm === parts.key) return null;
    if (t.active && t.inscricoes !== false) return { action: 'fechar', dateKey: parts.key };
    return null;
  }
  return null;
}

function weekdayIndex(weekdayStr) {
  const map = { dom: 0, sun: 0, seg: 1, mon: 1, ter: 2, tue: 2, qua: 3, wed: 3, qui: 4, thu: 4, sex: 5, fri: 5, sab: 6, sat: 6 };
  const wd = String(weekdayStr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  return map[wd] ?? -1;
}
function getStatus(t) {
  if (!t?.active) return { active: false };
  const lastN = (t.rounds || []).length;
  const pending = lastN ? roundGames(t, lastN).filter((g) => !g.winner).map((g) => g.id) : [];
  return {
    active: true,
    edition: t.edition,
    inscritos: (t.players || []).length,
    rodada: lastN,
    jogosPendentes: pending,
    final: Boolean(t.final),
    placarFinal: t.final ? `${t.final.wins1}x${t.final.wins2}` : null,
    champion: t.champion
  };
}

module.exports = {
  MIN_PLAYERS,
  TEAM_SIZE,
  FINAL_SIZE,
  TORNEIO_CARGO_NOME,
  TORNEIO_INFO,
  newTournament,
  joinTournament,
  leaveTournament,
  startRequirement,
  drawGames,
  findGame,
  recordGameResult,
  roundGames,
  roundComplete,
  roundWinners,
  roundLosers,
  advanceTournament,
  recordFinalGame,
  getStatus,
  parseDiasArg,
  parseHoraArg,
  formatAgenda,
  setAgenda,
  weekdayIndex,
  autoTorneioAction
};
