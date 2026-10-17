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
const INSCRICOES_DIAS_DEFAULT = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

const TORNEIO_INFO =
  '🏆 **TORNEIO CAPS ARENA** — mata-mata com sorteio por rodada.\n' +
  '• Inscrição individual: `!torneio entrar` (mínimo 20, múltiplo de 10)\n' +
  '• A cada rodada o bot monta partidas **5x5 balanceadas**; quem perde sai, quem ganha avança\n' +
  '• Se os vencedores não fecharem 10, entra a **repescagem** (melhores perdedores da rodada)\n' +
  '• **Final**: 1 sorteio, mesmos times, **MD3** (melhor de 3)\n' +
  '• Campeões ganham o cargo 🏆 (premiação extra a decidir)\n' +
  '• A staff abre/fecha o torneio com `!torneioon` / `!torneiooff`';

function newTournament(edition = 1, options = {}) {
  return {
    active: true,
    inscricoes: true,
    inscricoesAte: options.inscricoesAte || null,
    origem: options.origem || null,
    reservas: [],
    agenda: null,
    edition,
    players: [],
    rounds: [],
    final: null,
    champion: null,
    createdAt: new Date().toISOString()
  };
}

function addDias(nowMs, dias = INSCRICOES_DIAS_DEFAULT) {
  const n = Number(dias) > 0 ? Math.floor(Number(dias)) : INSCRICOES_DIAS_DEFAULT;
  return new Date(Number(nowMs) + n * DIA_MS).toISOString();
}

// Cria a próxima edição (ou reaproveita a edição caso ainda esteja vazia).
function novaEdicao(prev, { origem = 'manual', dias = INSCRICOES_DIAS_DEFAULT, nowMs = Date.now() } = {}) {
  const edition = prev && prev.active && !prev.champion
    ? (Number(prev.edition) || 1)
    : Math.max(1, Number(prev?.edition || 0) + 1);
  const t = newTournament(edition, { origem, inscricoesAte: addDias(nowMs, dias) });
  if (prev?.agenda) t.agenda = prev.agenda;
  return t;
}

function renovarInscricoes(t, dias = INSCRICOES_DIAS_DEFAULT, nowMs = Date.now()) {
  t.active = true;
  t.inscricoes = true;
  t.inscricoesAte = addDias(nowMs, dias);
  return t;
}

function inscricoesVencidas(t, nowMs = Date.now()) {
  if (!t?.active || t.inscricoes === false) return false;
  const at = Date.parse(t.inscricoesAte || '');
  if (!Number.isFinite(at)) return false;
  return Number(nowMs) >= at;
}

// Fecha as inscrições. Se o total não for múltiplo de 10, mantém os primeiros
// (ordem de inscrição) e o excedente vira reserva.
function fecharInscricoes(t) {
  const players = t.players || [];
  if (players.length < MIN_PLAYERS) {
    return { ok: false, message: `Menos de ${MIN_PLAYERS} inscritos — inscrições seguem abertas.` };
  }
  const keep = Math.floor(players.length / FINAL_SIZE) * FINAL_SIZE;
  t.reservas = players.slice(keep);
  t.players = players.slice(0, keep);
  t.inscricoes = false;
  return { ok: true, kept: t.players.length, reservas: t.reservas };
}

// Há um torneio em andamento (com gente ou rodada sorteada) que não pode ser
// sobrescrito pela agenda.
function torneioEmAndamento(t) {
  return Boolean(
    t?.active && !t.champion &&
    ((t.players || []).length > 0 || (t.rounds || []).length > 0 || t.final)
  );
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
  const insc = Number(agenda.diasInscricao) > 0 ? Math.floor(Number(agenda.diasInscricao)) : INSCRICOES_DIAS_DEFAULT;
  return `${dias} • abre ${hora(agenda.abrirMin)} • inscrições ${insc} dia(s)`;
}

// Agenda: dias + hora de abrir (+ dias de inscrição, padrão 7).
function setAgenda(t, diasRaw, abrirRaw, diasInscricaoRaw) {
  const dias = parseDiasArg(diasRaw);
  const abrirMin = parseHoraArg(abrirRaw);
  if (dias.length === 0) return { ok: false, message: 'Dias inválidos. Ex: `sex,sab` ou `5,6`.' };
  if (abrirMin === null) return { ok: false, message: 'Horário inválido. Ex: `19:00`.' };
  const diasInscricao = Number(diasInscricaoRaw) > 0 ? Math.floor(Number(diasInscricaoRaw)) : INSCRICOES_DIAS_DEFAULT;
  t.agenda = { dias, abrirMin, diasInscricao };
  return { ok: true, agenda: t.agenda };
}

// Decide se deve abrir automaticamente agora (ou null). Abre 1x/dia no dia/hora
// agendados e nunca sobrescreve um torneio em andamento — o que evita duplicar
// com a ativação manual (`!torneioon` grava torneioAbertoEm = hoje).
function autoTorneioAction(t, nowMs = Date.now(), flags = {}) {
  const agenda = t?.agenda;
  if (!agenda?.dias?.length) return null;
  const { getSPParts } = require('./eventoService');
  const parts = getSPParts(nowMs);
  const wd = weekdayIndex(parts.weekday);
  if (wd < 0 || !agenda.dias.includes(wd)) return null;
  if (parts.minutes < agenda.abrirMin) return null;
  if (flags.abertoEm === parts.key) return null;
  if (torneioEmAndamento(t)) return null;
  return { action: 'abrir', dateKey: parts.key };
}

function dateKeySP(nowMs = Date.now()) {
  const { getSPParts } = require('./eventoService');
  return getSPParts(nowMs).key;
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
    inscricoes: t.inscricoes !== false,
    inscricoesAte: t.inscricoesAte || null,
    reservas: (t.reservas || []).length,
    origem: t.origem || null,
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
  INSCRICOES_DIAS_DEFAULT,
  addDias,
  newTournament,
  novaEdicao,
  renovarInscricoes,
  inscricoesVencidas,
  fecharInscricoes,
  torneioEmAndamento,
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
  dateKeySP,
  autoTorneioAction
};
