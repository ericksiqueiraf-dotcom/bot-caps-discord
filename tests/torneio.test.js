const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const T = require('../services/torneioService');
const { createBalancedTeams } = require('../services/balanceService');

function pool(n, base = 2000) {
  return Array.from({ length: n }, (_, i) => ({ discordId: `u${i + 1}`, nickname: `P${i + 1}`, baseMmr: base - i * 50 }));
}

function balance(group) {
  return createBalancedTeams(group);
}

describe('torneio CAPS ARENA', () => {
  it('inscricao: entra, nao duplica, sai, trava apos inicio', () => {
    const t = T.newTournament(1);
    assert.equal(T.joinTournament(t, 'u1').count, 1);
    assert.equal(T.joinTournament(t, 'u1').ok, false);
    assert.equal(T.leaveTournament(t, 'u2').ok, false);
    assert.equal(T.leaveTournament(t, 'u1').count, 0);
  });

  it('exige minimo 20 e multiplo de 10', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 19; i++) T.joinTournament(t, `u${i}`);
    assert.equal(T.startRequirement(t).ok, false);
    T.joinTournament(t, 'u20');
    T.joinTournament(t, 'u21');
    assert.equal(T.startRequirement(t).ok, false);
    for (let i = 22; i <= 30; i++) T.joinTournament(t, `u${i}`);
    assert.equal(T.startRequirement(t).ok, true);
  });

  it('20 inscritos: 2 jogos -> 10 vencedores -> final MD3', () => {
    const t = T.newTournament(1);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    assert.equal(T.startRequirement(t).ok, true);
    const games = T.drawGames(players, balance, 'R1');
    assert.equal(games.length, 2);
    t.rounds.push({ n: 1, games });
    for (const g of games) assert.equal(T.recordGameResult(t, g.id, '1').ok, true);
    assert.equal(T.roundComplete(t, 1), true);
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.ok, true);
    assert.equal(adv.type, 'final');
    assert.equal(t.final.teamOne.length, 5);
    let r = T.recordFinalGame(t, '1');
    assert.equal(r.champion, false);
    r = T.recordFinalGame(t, '2');
    assert.equal(r.champion, false);
    r = T.recordFinalGame(t, '1');
    assert.equal(r.champion, true);
    assert.equal(t.champion.team.length, 5);
    assert.equal(t.champion.placar, '2x1');
  });

  it('30 inscritos: repescagem completa 20', () => {
    const t = T.newTournament(2);
    const players = pool(30);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    assert.equal(games.length, 3);
    t.rounds.push({ n: 1, games });
    for (const g of games) T.recordGameResult(t, g.id, '1');
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.ok, true);
    assert.equal(adv.type, 'round');
    assert.equal(adv.round, 2);
    assert.equal(adv.games.length, 2);
    assert.equal(adv.repechage.length, 5);
    // Repescados sao os 5 perdedores de maior elo.
    const r1losers = T.roundLosers(t, 1).map((p) => p.discordId);
    assert.deepEqual(adv.repechage.map((p) => p.discordId).sort(), r1losers.slice(0, 5).sort());
  });

  it('resultado invalido e jogo inexistente falham', () => {
    const t = T.newTournament(3);
    assert.equal(T.recordGameResult(t, 'R1-J1', '1').ok, false);
    assert.equal(T.recordGameResult(t, 'R1-J1', '3').ok, false);
    assert.equal(T.getStatus({}).active, false);
  });
});
