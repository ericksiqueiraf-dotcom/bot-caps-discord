// Casos de uso do match inter-servidores: formar, registrar resultado, W.O.
// Ranking inter separado do ranking interno (docs proprios).

const {
  SERIES_MD1,
  SERIES_MD3,
  DEFAULT_POINTS,
  teamKey,
  buildGames,
  applyGameResult,
  applyWO,
  seriesPoints,
  nextOpenGame
} = require('../../../domain/inter/series');

const INTER_MATCH_LOCK = 'inter:global:match';

function ensureTeamEntry(ranking, key, name, originGuildId) {
  ranking.times ||= {};
  if (!ranking.times[key]) {
    ranking.times[key] = {
      name, originGuildId, md1V: 0, md1D: 0, md3V: 0, md3D: 0,
      jogosV: 0, jogosD: 0, pontos: 0, woV: 0, woD: 0
    };
  } else {
    ranking.times[key].name = name;
    ranking.times[key].originGuildId = originGuildId;
  }
  return ranking.times[key];
}

function pointsFor(serie, points) {
  void serie;
  return {
    md1Win: Number(points?.md1WinPoints ?? points?.md1Win ?? DEFAULT_POINTS.md1Win),
    md3Win20: Number(points?.md3Win20Points ?? points?.md3Win20 ?? DEFAULT_POINTS.md3Win20),
    md3Win21: Number(points?.md3Win21Points ?? points?.md3Win21 ?? DEFAULT_POINTS.md3Win21)
  };
}

// Aplica o fechamento no ranking inter. Mutacao; retorna detalhe.
function applyCloseToRanking(ranking, match, points) {
  const pts = pointsFor(match.serie, points);
  const keyA = teamKey(match.teamA.originGuildId, match.teamA.name);
  const keyB = teamKey(match.teamB.originGuildId, match.teamB.name);
  const entryA = ensureTeamEntry(ranking, keyA, match.teamA.name, match.teamA.originGuildId);
  const entryB = ensureTeamEntry(ranking, keyB, match.teamB.name, match.teamB.originGuildId);
  const winEntry = match.winner === 'A' ? entryA : entryB;
  const loseEntry = match.winner === 'A' ? entryB : entryA;
  const winPlacar = match.winner === 'A' ? match.placarA : match.placarB;
  const losePlacar = match.winner === 'A' ? match.placarB : match.placarA;

  if (match.serie === SERIES_MD1) {
    winEntry.md1V += 1;
    loseEntry.md1D += 1;
  } else {
    winEntry.md3V += 1;
    loseEntry.md3D += 1;
  }
  // Pontos fixos: MD1 = md1Win; MD3 = 5 no 2x0, 4 no 2x1. Sem ponto por jogo.
  winEntry.pontos += seriesPoints(match.serie, winPlacar, losePlacar, true, pts);
  winEntry.jogosV += winPlacar;
  winEntry.jogosD += losePlacar;
  loseEntry.jogosV += losePlacar;
  loseEntry.jogosD += winPlacar;
  if (match.wo) {
    winEntry.woV += 1;
    const loseWo = match.wo.faltoso === match.winner ? winEntry : loseEntry;
    // faltoso perde por WO: marca no perdedor real
    const faltosoEntry = match.wo.faltoso === 'A' ? entryA : entryB;
    faltosoEntry.woD += 1;
    void loseWo;
  }
  return { winEntry, loseEntry };
}

// Persiste o match formado (canais/invite ja criados pelo handler).
async function formarMatch({ matchDraft, arenaGuildId, canais, invite, deps }) {
  const { loadInterMatches, saveInterMatches, loadInterRanking, withQueueOperationLock } = deps;
  return withQueueOperationLock(INTER_MATCH_LOCK, async () => {
    const data = await loadInterMatches();
    // J3 e criado na estrutura, mas travado ate o 1-1 (registrarResultadoJogo reforca).
    const thirdAzul = matchDraft.thirdAzul || (matchDraft.firstAzul === 'A' ? 'B' : 'A');
    const match = {
      id: matchDraft.id,
      serie: matchDraft.serie,
      status: 'open',
      arenaGuildId: String(arenaGuildId || ''),
      teamA: matchDraft.teamA,
      teamB: matchDraft.teamB,
      firstAzul: matchDraft.firstAzul,
      thirdAzul,
      jogos: buildGames(matchDraft.serie, matchDraft.firstAzul, thirdAzul),
      placarA: 0,
      placarB: 0,
      winner: null,
      wo: null,
      invite: invite || null,
      canais: canais || null,
      createdAt: matchDraft.createdAt,
      closedAt: null
    };
    data.matches ||= {};
    data.matches[match.id] = match;
    await saveInterMatches(data);
    // ranking: garante entradas existindo sem pontuar
    if (typeof loadInterRanking === 'function') {
      const ranking = await loadInterRanking();
      ensureTeamEntry(ranking, teamKey(match.teamA.originGuildId, match.teamA.name), match.teamA.name, match.teamA.originGuildId);
      ensureTeamEntry(ranking, teamKey(match.teamB.originGuildId, match.teamB.name), match.teamB.name, match.teamB.originGuildId);
      if (deps.saveInterRanking) await deps.saveInterRanking(ranking);
    }
    return { status: 'formed', match };
  });
}

// Registra o resultado de um jogo. vencedorSide: 'AZUL' | 'VERM'.
// thirdAzul: lados sorteados do J3 (obrigatorio para registrar o J3).
async function registrarResultadoJogo({ matchId, jogoN, vencedorSide, thirdAzul, points, deps }) {
  const { loadInterMatches, saveInterMatches, loadInterRanking, saveInterRanking, withQueueOperationLock } = deps;
  return withQueueOperationLock(`${INTER_MATCH_LOCK}:${matchId}`, async () => {
    const data = await loadInterMatches();
    const match = data.matches?.[matchId];
    if (!match || match.status !== 'open') return { status: 'match_not_found' };
    const n = Number(jogoN);
    const game = (match.jogos || []).find((g) => g.n === n);
    if (!game || game.vencedor) return { status: 'invalid_game' };
    if (!['AZUL', 'VERM'].includes(String(vencedorSide).toUpperCase())) return { status: 'invalid_side' };
    // J3 so existe em empate 1-1.
    if (match.serie === SERIES_MD3 && n === 3 && !(match.placarA === 1 && match.placarB === 1)) {
      return { status: 'game_locked', match };
    }
    // Aplica lados sorteados do J3 antes do resultado.
    if (match.serie === SERIES_MD3 && n === 3 && thirdAzul && (thirdAzul === 'A' || thirdAzul === 'B')) {
      match.thirdAzul = thirdAzul;
      game.ladoAzul = thirdAzul;
      game.ladoVermelho = thirdAzul === 'A' ? 'B' : 'A';
    }
    const applied = applyGameResult(match, n, String(vencedorSide).toUpperCase());
    if (applied.error) return { status: applied.error, match };

    let rankingDetail = null;
    if (applied.closed) {
      const ranking = await loadInterRanking();
      rankingDetail = applyCloseToRanking(ranking, match, points);
      await saveInterRanking(ranking);
    }
    await saveInterMatches(data);
    return {
      status: applied.closed ? 'series_closed' : 'game_recorded',
      match, rankingDetail,
      nextGame: applied.closed ? null : nextOpenGame(match),
      seriesWinner: applied.seriesWinner
    };
  });
}

// Aplica W.O.: faltoso 'A' | 'B' (time que nao apareceu).
async function aplicarWO({ matchId, faltoso, points, deps }) {
  const { loadInterMatches, saveInterMatches, loadInterRanking, saveInterRanking, withQueueOperationLock } = deps;
  if (!['A', 'B'].includes(faltoso)) return { status: 'invalid_side' };
  return withQueueOperationLock(`${INTER_MATCH_LOCK}:${matchId}`, async () => {
    const data = await loadInterMatches();
    const match = data.matches?.[matchId];
    if (!match || match.status !== 'open') return { status: 'match_not_found' };
    const applied = applyWO(match, faltoso);
    if (applied.error) return { status: applied.error, match };
    const ranking = await loadInterRanking();
    const rankingDetail = applyCloseToRanking(ranking, match, points);
    await saveInterRanking(ranking);
    await saveInterMatches(data);
    return { status: 'wo_applied', match, rankingDetail, seriesWinner: applied.seriesWinner };
  });
}

function findOpenMatchForPlayer(interMatches, discordId) {
  const id = String(discordId);
  return Object.entries(interMatches?.matches || {}).find(([, m]) => {
    if (!m || m.status !== 'open') return false;
    const all = [...(m.teamA?.jogadores || []), ...(m.teamB?.jogadores || [])].map(String);
    return all.includes(id);
  }) || null;
}

module.exports = {
  INTER_MATCH_LOCK,
  formarMatch,
  registrarResultadoJogo,
  aplicarWO,
  applyCloseToRanking,
  ensureTeamEntry,
  findOpenMatchForPlayer
};
