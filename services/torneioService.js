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
  getStatus
};
