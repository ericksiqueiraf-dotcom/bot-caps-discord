const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { registerVictory } = require('../application/use-cases/registerVictory');
const { clone, makeTwoMatchWorld, makeRegisterVictoryDeps } = require('./helpers');

const classicWinsOf = (stats, tag) => stats.players[`puuid-${tag}`]?.modes?.classic?.customWins || 0;
const classicLossesOf = (stats, tag) => stats.players[`puuid-${tag}`]?.modes?.classic?.customLosses || 0;

describe('registerVictory com 2 partidas simultaneas', () => {
  it('finalizar a A nao toca na B', async () => {
    const state = makeTwoMatchWorld();
    const deps = makeRegisterVictoryDeps(state);
    const matchA = state.matches['classic-5x5-a'].match;
    const beforeB = clone(state.stats.players);

    await registerVictory({ guildId: 'g1', matchId: 'classic-5x5-a', match: matchA, winningTeam: '1', deps });

    assert.equal(state.matches['classic-5x5-a'], undefined);
    assert.ok(state.matches['classic-5x5-b']?.active);

    for (const [key, before] of Object.entries(beforeB)) {
      if (key.startsWith('puuid-B-')) {
        assert.deepEqual(state.stats.players[key], before);
      }
    }

    for (let i = 1; i <= 5; i++) assert.equal(classicWinsOf(state.stats, `A-p${i}`), 1);
    for (let i = 6; i <= 10; i++) assert.equal(classicLossesOf(state.stats, `A-p${i}`), 1);
  });

  it('bolão: apostadores do time vencedor dividem o bolo', async () => {
    const state = makeTwoMatchWorld();
    const deps = makeRegisterVictoryDeps(state);
    const matchA = state.matches['classic-5x5-a'].match;
    const t1id = matchA.teamOne[0].discordId;
    const t2id = matchA.teamTwo[0].discordId;
    state.matches['classic-5x5-a'].palpites = {
      [t1id]: { time: '1', pontos: 100 },
      [t2id]: { time: '2', pontos: 60 }
    };
    const before = (id) => state.stats.players[`puuid-${id.replace('dc-', '')}`]?.modes?.classic?.internalRating;
    const b1 = before(t1id);
    const result = await registerVictory({ guildId: 'g1', matchId: 'classic-5x5-a', match: matchA, winningTeam: '1', deps });
    assert.equal(result.payouts.length, 1);
    assert.equal(result.payouts[0].discordId, t1id);
    assert.equal(result.payouts[0].valor, 160); // 100 * (100+60) / 100
    const winnerEntry = result.winners.find((w) => w.discordId === t1id);
    assert.equal(before(t1id), b1 + winnerEntry.ratingDelta + 160);
  });

  it('primeira vitória do dia ganha +50% e carimba a data', async () => {
    const state = makeTwoMatchWorld();
    const deps = makeRegisterVictoryDeps(state);
    const matchA = state.matches['classic-5x5-a'].match;
    const result = await registerVictory({ guildId: 'g1', matchId: 'classic-5x5-a', match: matchA, winningTeam: '1', deps });
    const hojeSP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    assert.ok(result.winners.length > 0);
    assert.ok(result.winners[0].firstWinBonus >= 1);
    const stored = state.stats.players[`puuid-${result.winners[0].discordId.replace('dc-', '')}`];
    assert.ok(stored);
    assert.equal(stored.ultimaVitoriaEm, hojeSP);
  });

  it('duas vitorias AO MESMO TEMPO aplicam ambas (sem lost update)', async () => {
    const state = makeTwoMatchWorld();
    const deps = makeRegisterVictoryDeps(state);

    await Promise.all([
      registerVictory({ guildId: 'g1', matchId: 'classic-5x5-a', match: state.matches['classic-5x5-a'].match, winningTeam: '1', deps }),
      registerVictory({ guildId: 'g1', matchId: 'classic-5x5-b', match: state.matches['classic-5x5-b'].match, winningTeam: '2', deps })
    ]);

    assert.equal(Object.keys(state.matches).length, 0);

    for (let i = 1; i <= 5; i++) assert.equal(classicWinsOf(state.stats, `A-p${i}`), 1);
    for (let i = 6; i <= 10; i++) assert.equal(classicLossesOf(state.stats, `A-p${i}`), 1);
    for (let i = 6; i <= 10; i++) assert.equal(classicWinsOf(state.stats, `B-p${i}`), 1);
    for (let i = 1; i <= 5; i++) assert.equal(classicLossesOf(state.stats, `B-p${i}`), 1);
  });

  it('registrar a mesma partida 2x nao duplica stats', async () => {
    const state = makeTwoMatchWorld();
    const deps = makeRegisterVictoryDeps(state);
    const matchA = state.matches['classic-5x5-a'].match;

    await registerVictory({ guildId: 'g1', matchId: 'classic-5x5-a', match: matchA, winningTeam: '1', deps });
    await assert.rejects(
      registerVictory({ guildId: 'g1', matchId: 'classic-5x5-a', match: matchA, winningTeam: '1', deps }),
      /finalizada ou nao existe/
    );
    assert.equal(classicWinsOf(state.stats, 'A-p1'), 1);
  });
});
