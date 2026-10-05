const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../utils/lobbyUtils');
const { drawRoulette } = require('../application/use-cases/drawRoulette');
const { getRankedPlayersByMode } = require('../domain/ranking/playerStats');
const { parseModeAndFormatArgs } = require('../domain/queue/selection');
const { parseRouletteArgs } = require('../commands/handlers/rouletteCommandHandlers');

describe('gate TIER S (Esmeralda IV+)', () => {
  it('baseMmr >= 2000 libera; abaixo nega', () => {
    assert.equal(L.isTierSEligibleByStats({ baseMmr: 2000, tier: 'EMERALD' }), true);
    assert.equal(L.isTierSEligibleByStats({ baseMmr: 1999, tier: 'PLATINUM' }), false);
    assert.equal(L.isTierSEligibleByStats({ baseMmr: 0, tier: 'DIAMOND' }), true);
    assert.equal(L.isTierSEligibleByStats({ baseMmr: 3600, tier: 'CHALLENGER' }), true);
  });

  it('getOpenLobby filtra por tier', () => {
    const queueData = {
      lobbies: {
        a: { id: 'a', mode: 'classic', format: '5x5', tier: 'normal', status: 'waiting', players: [], requiredPlayers: 10 },
        b: { id: 'b', mode: 'classic', format: '5x5', tier: 'S', status: 'waiting', players: [], requiredPlayers: 10 }
      }
    };
    assert.equal(L.getOpenLobby(queueData, 'classic', '5x5', 'S').id, 'b');
    assert.equal(L.getOpenLobby(queueData, 'classic', '5x5', 'normal').id, 'a');
  });

  it('staff (mod/capitao/admin) tem bypass mesmo sem elo', () => {
    const mod = { permissions: { has: (p) => p === 'ManageMessages' }, roles: { cache: new Map() } };
    const none = { permissions: { has: () => false }, roles: { cache: new Map() } };
    assert.equal(L.isStaffBypass(mod), true);
    assert.equal(L.isStaffBypass(none), false);
    assert.equal(L.isStaffBypass(null), false);
  });

  it('nomes de sala Tier S nao colidem', () => {
    assert.equal(L.getExpectedWaitingRoomName('classic', '5x5', 'A', 'S'), 'Lobby TIER S A');
    assert.equal(L.getExpectedWaitingRoomName('classic', '5x5', 'A'), 'Lobby CLASSIC A');
  });
});

describe('top10 tiers (mesmo PDL, filtro)', () => {
  it('tierSOnly filtra base < 2000', () => {
    const statsData = {
      players: {
        k1: { discordId: 'd1', nickname: 'low#br1', baseMmr: 1200, modes: { classic: { customWins: 20, customLosses: 0, baseMmr: 1200, internalRating: 2400, winStreak: 0, ratingVersion: 2 } } },
        k2: { discordId: 'd2', nickname: 'high#br1', baseMmr: 2400, modes: { classic: { customWins: 6, customLosses: 0, baseMmr: 2400, internalRating: 3500, winStreak: 0, ratingVersion: 2 } } }
      }
    };
    const all = getRankedPlayersByMode(statsData, 'classic', null, { phase: 'testing' });
    assert.equal(all.length, 2);
    const tiers = getRankedPlayersByMode(statsData, 'classic', null, { phase: 'testing' }, { tierSOnly: true });
    assert.equal(tiers.length, 1);
    assert.equal(tiers[0].nickname, 'high#br1');
  });

  it('parse aceita tiers', () => {
    assert.equal(parseModeAndFormatArgs(['tiers']).tierSOnly, true);
    assert.equal(parseModeAndFormatArgs(['top10']).tierSOnly, false);
  });
});

describe('!roleta (sorteio)', () => {
  it('sorteia exatamente N distintos', () => {
    const pool = [1, 2, 3, 4, 5].map((i) => ({ discordId: `d${i}` }));
    const { leaving, staying } = drawRoulette(pool, 2);
    assert.equal(leaving.length, 2);
    assert.equal(staying.length, 3);
    assert.equal(new Set([...leaving, ...staying].map((p) => p.discordId)).size, 5);
  });

  it('N=5 sai todo mundo', () => {
    const pool = [1, 2, 3].map((i) => ({ discordId: `d${i}` }));
    const { leaving, staying } = drawRoulette(pool, 5);
    assert.equal(leaving.length, 3);
    assert.equal(staying.length, 0);
  });

  it('opt-out tira do sorteio e da subida', () => {
    const { applyOptOuts } = require('../commands/handlers/rouletteCommandHandlers');
    const list = [{ discordId: 'd1' }, { discordId: 'd2' }, { discordId: 'd3' }];
    assert.deepEqual(applyOptOuts(list, ['d2']).map((p) => p.discordId), ['d1', 'd3']);
    assert.deepEqual(applyOptOuts(list, []).length, 3);
  });

  it('parse !roleta entende N + letra', () => {
    assert.deepEqual(parseRouletteArgs(['2', 'A']), { count: 2, letter: 'A', sub: null });
    assert.deepEqual(parseRouletteArgs(['A', '2']), { count: 2, letter: 'A', sub: null });
    assert.deepEqual(parseRouletteArgs(['A']), { count: null, letter: 'A', sub: null });
    assert.deepEqual(parseRouletteArgs(['sortear', 'B']), { count: null, letter: 'B', sub: 'sortear' });
    assert.deepEqual(parseRouletteArgs(['ver', 'A']), { count: null, letter: 'A', sub: 'ver' });
    assert.deepEqual(parseRouletteArgs(['sair', 'A']), { count: null, letter: 'A', sub: 'sair' });
  });
});
