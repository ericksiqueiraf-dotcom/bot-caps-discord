const test = require('node:test');
const assert = require('node:assert');

const { parseRankingView, RANKING_VIEWS } = require('../domain/ranking/rankingViews');
const { getRankedPlayersByDuel, aggregateDuels } = require('../domain/ranking/duelRanking');
const { getStatsBucketLabel } = require('../utils/lobbyUtils');

// ─── Views do menu de ranking ────────────────────────────────────────────────

test('menu de ranking tem exatamente as 5 views ativas', () => {
  assert.deepEqual([...RANKING_VIEWS], ['duelo', 'classic', 'tiers', 'infernal', 'tt3x3']);
});

test('sem argumento o ranking cai no CLASSIC', () => {
  const view = parseRankingView([]);
  assert.equal(view.ok, true);
  assert.equal(view.view, 'classic');
});

test('duelo: aceita duelo/duelos/duel e o antigo 1x1', () => {
  for (const token of ['duelo', 'duelos', 'duel', '1x1']) {
    const view = parseRankingView([token]);
    assert.equal(view.ok, true, `${token} deveria ser valido`);
    assert.equal(view.view, 'duelo');
    assert.equal(view.label, 'DUELO');
  }
});

test('twisted treeline: aceita 3x3, tt, tt3x3, twisted e treeline', () => {
  for (const token of ['3x3', 'tt', 'tt3x3', 'twisted', 'treeline', 'twisted treeline']) {
    const view = parseRankingView([token]);
    assert.equal(view.ok, true, `${token} deveria ser valido`);
    assert.equal(view.view, 'tt3x3');
    assert.equal(view.label, 'TWISTED TREELINE 3X3');
  }
});

test('classic, tiers e infernal seguem aceitos', () => {
  assert.equal(parseRankingView(['classic']).view, 'classic');
  assert.equal(parseRankingView(['tiers']).view, 'tiers');
  assert.equal(parseRankingView(['tier-s']).view, 'tiers');
  assert.equal(parseRankingView(['s']).view, 'tiers');
  assert.equal(parseRankingView(['infernal']).view, 'infernal');
});

test('rankings retirados (2x2, 4x4, 5x5, aram) respondem com aviso', () => {
  for (const token of ['2x2', '4x4', '5x5', 'aram']) {
    const view = parseRankingView([token]);
    assert.equal(view.ok, false, `${token} deveria estar retirado`);
    assert.match(view.message, /retirado|desativado|Rankings ativos/i);
  }
});

test('ranking desconhecido nao quebra', () => {
  const view = parseRankingView(['xpto']);
  assert.equal(view.ok, false);
  assert.match(view.message, /Rankings ativos/i);
});

test('topstreak so aceita classic e tt3x3', () => {
  const allowed = ['classic', 'tt3x3'];
  assert.equal(parseRankingView(['tt'], { allowed }).view, 'tt3x3');
  assert.equal(parseRankingView([], { allowed }).view, 'classic');

  const duelNaStreak = parseRankingView(['duelo'], { allowed });
  assert.equal(duelNaStreak.ok, false);
  assert.match(duelNaStreak.message, /não tem ranking neste comando/i);

  const tierNaStreak = parseRankingView(['tiers'], { allowed });
  assert.equal(tierNaStreak.ok, false);
});

// ─── Rotulos das views ───────────────────────────────────────────────────────

test('getStatsBucketLabel: 3x3 vira Twisted Treeline, duel vira Duelo', () => {
  assert.equal(getStatsBucketLabel('aram', '3x3'), 'TWISTED TREELINE 3X3');
  assert.equal(getStatsBucketLabel('duel'), 'DUELO');
  assert.equal(getStatsBucketLabel('classic'), 'CLASSIC');
  assert.equal(getStatsBucketLabel('aram'), 'ARAM');
});

// ─── Rank do duelo ───────────────────────────────────────────────────────────

const statsData = {
  players: {
    k1: { discordId: '1', nickname: 'Ana', modes: { classic: { baseMmr: 1700 } } },
    k2: { discordId: '2', nickname: 'Bru', modes: { classic: { baseMmr: 1500 } } },
    k3: { discordId: '3', nickname: 'Cau', modes: { classic: { baseMmr: 0 } } }
  }
};

const duelo = (a, b, winnerId, pontos, createdAt = '2026-05-01T12:00:00.000Z') => ({
  id: `d${a}${b}${pontos}`,
  a,
  b,
  pontos,
  status: 'concluido',
  winnerId,
  createdAt
});

test('agrega somente duelos concluidos', () => {
  const agg = aggregateDuels([
    duelo('1', '2', '1', 50),
    { id: 'x', a: '1', b: '2', pontos: 50, status: 'pendente', createdAt: '2026-05-01T12:00:00.000Z' },
    { id: 'y', a: '1', b: '2', pontos: 50, status: 'aceito', createdAt: '2026-05-01T12:00:00.000Z' }
  ]);

  assert.equal(agg.size, 2);
  assert.equal(agg.get('1').duelWins, 1);
  assert.equal(agg.get('2').duelLosses, 1);
});

test('rank do duelo ordena por vitorias e desempata pelo PDL liquido', () => {
  const duelos = [
    duelo('1', '2', '1', 100),   // Ana vence Bru (+100 / -100)
    duelo('1', '3', '1', 50),    // Ana vence Cau  (+50  / -50)
    duelo('2', '3', '2', 400),   // Bru vence Cau  (+400 / -400)
    duelo('2', '1', '2', 10),    // Bru vence Ana  (+10  / -10)
    duelo('3', '1', '3', 30)     // Cau vence Ana  (+30  / -30)
  ];

  const ranked = getRankedPlayersByDuel(duelos, statsData);

  // Vitorias: Ana 2 (liquido +110), Bru 2 (liquido +310), Cau 1 (liquido -420)
  assert.equal(ranked[0].nickname, 'Bru');
  assert.equal(ranked[0].duelWins, 2);
  assert.equal(ranked[0].duelPoints, 310);
  assert.equal(ranked[1].nickname, 'Ana');
  assert.equal(ranked[1].duelWins, 2);
  assert.equal(ranked[1].duelPoints, 110);
  assert.equal(ranked[2].nickname, 'Cau');
  assert.equal(ranked[2].duelWins, 1);
  assert.equal(ranked[2].duelPoints, -420);
});

test('rank do duelo expoe o formato esperado pelos embeds', () => {
  const ranked = getRankedPlayersByDuel([duelo('1', '2', '1', 50)], statsData);
  const top = ranked[0];

  assert.equal(top.discordId, '1');
  assert.equal(top.customWins, 1);
  assert.equal(top.customLosses, 0);
  assert.equal(top.totalGames, 1);
  assert.equal(top.adjustedMmr, 50);
  assert.equal(top.winRate, '100');
  assert.equal(top.baseMmr, 1700);
});

test('rank do duelo usa o nickname cadastrado e nao quebra sem jogador', () => {
  const duelos = [duelo('1', '999', '999', 40)];
  const ranked = getRankedPlayersByDuel(duelos, statsData);
  const orfao = ranked.find((entry) => entry.discordId === '999');

  assert.ok(orfao);
  assert.equal(orfao.nickname, '999');
  assert.equal(orfao.baseMmr, 0);
});

test('rank do duelo em temporada oficial ignora duelos anteriores', () => {
  const seasonMeta = { phase: 'official', startedAt: '2026-06-01T00:00:00.000Z' };
  const duelos = [
    duelo('1', '2', '1', 100, '2026-05-01T12:00:00.000Z'), // fora da temporada
    duelo('2', '1', '2', 30, '2026-06-02T12:00:00.000Z')    // dentro
  ];

  const ranked = getRankedPlayersByDuel(duelos, statsData, seasonMeta);

  // Só o duelo de junho conta: Bru 1V e Ana aparece só com a derrota.
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].nickname, 'Bru');
  assert.equal(ranked[0].duelWins, 1);
  assert.equal(ranked[0].duelLosses, 0);

  const ana = ranked.find((entry) => entry.discordId === '1');
  assert.equal(ana.duelWins, 0);
  assert.equal(ana.duelLosses, 1);
});

test('rank do duelo sem duelos concluidos devolve lista vazia', () => {
  assert.deepEqual(getRankedPlayersByDuel([], statsData), []);
  assert.deepEqual(getRankedPlayersByDuel(null, statsData), []);
});
