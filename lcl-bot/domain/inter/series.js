// Regras puras do modo inter-servidores (N x J na CAPS ARENA).
// Sem dependencia de Discord ou banco: testavel isoladamente.
//
// Serie MD1: 1 jogo. Serie MD3: melhor de 3 (J1/J2 alternam lados,
// J3 so existe em empate 1-1, com lados sorteados).

const TEAM_SIZE = 5;
const SERIES_MD1 = 'MD1';
const SERIES_MD3 = 'MD3';

// Pontuacao do ranking inter (separado do ranking interno).
// MD1: 2 pts. MD3: 5 pts no 2x0, 4 pts no 2x1. Sem ponto por jogo.
const DEFAULT_POINTS = {
  md1Win: 2,
  md3Win20: 5,
  md3Win21: 4
};

function parseSerieArg(value) {
  const v = String(value || '').trim().toUpperCase();
  if (v === SERIES_MD1 || v === '1') return SERIES_MD1;
  if (v === SERIES_MD3 || v === '3') return SERIES_MD3;
  return null;
}

function teamKey(originGuildId, teamName) {
  return `${String(originGuildId || '')}:${String(teamName || '').trim().toLowerCase()}`;
}

function sanitizeTeamName(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
}

// Valida o elenco de 5 fixos. Retorna {ok, reason?}.
function validateRoster(discordIds) {
  const ids = (Array.isArray(discordIds) ? discordIds : []).map(String).filter(Boolean);
  if (ids.length !== TEAM_SIZE) return { ok: false, reason: 'roster_size' };
  if (new Set(ids).size !== TEAM_SIZE) return { ok: false, reason: 'roster_duplicates' };
  return { ok: true };
}

// Sorteia qual time (A ou B) fica no lado AZUL. rand injetavel p/ testes.
function drawSides(rand = Math.random) {
  return { azul: rand() < 0.5 ? 'A' : 'B' };
}

function invertSide(side) {
  return side === 'A' ? 'B' : 'A';
}

// Lados do jogo N: J1 = sorteio inicial; J2 = invertido; J3 = novo sorteio.
function sidesForGame(serie, gameNumber, firstAzul, thirdAzul = null) {
  if (serie === SERIES_MD1 || gameNumber <= 1) return { azul: firstAzul };
  if (gameNumber === 2) return { azul: invertSide(firstAzul) };
  return { azul: thirdAzul || firstAzul };
}

function gamesToWin(serie) {
  return serie === SERIES_MD3 ? 2 : 1;
}

function maxGames(serie) {
  return serie === SERIES_MD3 ? 3 : 1;
}

// Aplica o resultado de um jogo ao match (mutacao). vencedor: 'AZUL' | 'VERM'.
// Retorna {closed, seriesWinner: 'A'|'B'|null}.
function applyGameResult(match, gameNumber, vencedorSide) {
  const game = (match.jogos || []).find((g) => g.n === gameNumber);
  if (!match || match.status !== 'open' || !game || game.vencedor) {
    return { error: 'invalid_game' };
  }
  const azulTeam = game.ladoAzul; // 'A' | 'B'
  const winnerTeam = vencedorSide === 'AZUL' ? azulTeam : invertSide(azulTeam);
  game.vencedor = winnerTeam;
  game.wo = false;
  if (winnerTeam === 'A') match.placarA += 1;
  else match.placarB += 1;

  const need = gamesToWin(match.serie);
  const closed = match.placarA >= need || match.placarB >= need
    || (match.serie === SERIES_MD1)
    || (match.serie === SERIES_MD3 && decidedGames(match) >= maxGames(match.serie));
  if (closed) {
    match.status = 'closed';
    match.winner = match.placarA > match.placarB ? 'A' : 'B';
    match.closedAt = new Date().toISOString();
  }
  return { closed, seriesWinner: closed ? match.winner : null };
}

function decidedGames(match) {
  return (match.jogos || []).filter((g) => g.vencedor).length;
}

// W.O.: faltoso 'A'|'B' perde a serie (1-0 MD1, 2-0 MD3).
function applyWO(match, faltoso) {
  if (!match || match.status !== 'open') return { error: 'invalid_match' };
  const presente = faltoso === 'A' ? 'B' : 'A';
  if (match.serie === SERIES_MD1) {
    match.placarA = presente === 'A' ? 1 : 0;
    match.placarB = presente === 'B' ? 1 : 0;
  } else {
    match.placarA = presente === 'A' ? 2 : 0;
    match.placarB = presente === 'B' ? 2 : 0;
  }
  for (const game of match.jogos || []) {
    if (!game.vencedor) {
      game.vencedor = presente;
      game.wo = true;
    }
  }
  match.status = 'closed';
  match.winner = presente;
  match.wo = { faltoso, presente };
  match.closedAt = new Date().toISOString();
  return { closed: true, seriesWinner: presente };
}

// Cria a estrutura de jogos da serie.
function buildGames(serie, firstAzul, thirdAzul = null) {
  const total = maxGames(serie);
  const games = [];
  for (let n = 1; n <= total; n += 1) {
    const { azul } = sidesForGame(serie, n, firstAzul, thirdAzul);
    games.push({ n, ladoAzul: azul, ladoVermelho: invertSide(azul), vencedor: null, wo: false });
  }
  return games;
}

// Pontuacao do ranking inter para um time ao fechar a serie.
// MD1: md1Win. MD3: md3Win20 (2x0) ou md3Win21 (2x1). Derrota = 0.
function seriesPoints(serie, placarV, placarD, venceuSerie, points = DEFAULT_POINTS) {
  if (!venceuSerie) return 0;
  if (serie === SERIES_MD1) return Number(points.md1Win ?? DEFAULT_POINTS.md1Win);
  if (Number(placarD) === 0) return Number(points.md3Win20 ?? DEFAULT_POINTS.md3Win20);
  return Number(points.md3Win21 ?? DEFAULT_POINTS.md3Win21);
}

function nextOpenGame(match) {
  return (match.jogos || []).find((g) => !g.vencedor) || null;
}

module.exports = {
  TEAM_SIZE,
  SERIES_MD1,
  SERIES_MD3,
  DEFAULT_POINTS,
  parseSerieArg,
  teamKey,
  sanitizeTeamName,
  validateRoster,
  drawSides,
  invertSide,
  sidesForGame,
  gamesToWin,
  maxGames,
  buildGames,
  applyGameResult,
  applyWO,
  seriesPoints,
  nextOpenGame,
  decidedGames
};
