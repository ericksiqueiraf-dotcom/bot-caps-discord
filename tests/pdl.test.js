const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { adjustPdl } = require('../application/use-cases/adjustPdl');
const H = require('./helpers');

function makePdlWorld(internalRating = 2300) {
  const state = { stats: H.mkStats(['A']) };
  const key = Object.keys(state.stats.players)[0];
  state.stats.players[key].modes.classic.internalRating = internalRating;
  state.stats.players[key].internalRating = internalRating;
  const target = state.stats.players[key];
  return { state, target };
}

function makePdlDeps(state) {
  const base = H.makeRegisterVictoryDeps(state);
  const B = require('../services/balanceService');
  return {
    withQueueOperationLock: base.withQueueOperationLock,
    loadPlayerStats: base.loadPlayerStats,
    savePlayerStats: base.savePlayerStats,
    getStoredPlayerStats: base.getStoredPlayerStats,
    getModeStats: base.getModeStats,
    normalizePlayerModes: base.normalizePlayerModes,
    getStatsBucketKey: base.getStatsBucketKey,
    upsertPlayerStats: base.upsertPlayerStats,
    calculateSeedRating: B.calculateSeedRating
  };
}

describe('!pdl (ajuste staff)', () => {
  it('aplica -50 sem tocar em W/L', async () => {
    const { state, target } = makePdlWorld(2300);
    const before = { ...target.modes.classic };
    const result = await adjustPdl({ guildId: 'g', discordId: target.discordId, delta: -50, deps: makePdlDeps(state) });
    assert.equal(result.before, 2300);
    assert.equal(result.after, 2250);
    assert.equal(result.applied, -50);
    const afterStats = state.stats.players[Object.keys(state.stats.players)[0]];
    assert.equal(afterStats.modes.classic.customWins, before.customWins);
    assert.equal(afterStats.modes.classic.customLosses, before.customLosses);
  });

  it('piso em zero e teto de 500', async () => {
    const { state, target } = makePdlWorld(30);
    const result = await adjustPdl({ guildId: 'g', discordId: target.discordId, delta: -50, deps: makePdlDeps(state) });
    assert.equal(result.after, 0);
    assert.equal(result.applied, -30);
    await assert.rejects(
      adjustPdl({ guildId: 'g', discordId: target.discordId, delta: -501, deps: makePdlDeps(state) }),
      /Limite/
    );
    await assert.rejects(
      adjustPdl({ guildId: 'g', discordId: target.discordId, delta: 0, deps: makePdlDeps(state) }),
      /diferente de zero/
    );
  });

  it('jogador inexistente falha', async () => {
    const { state } = makePdlWorld();
    await assert.rejects(
      adjustPdl({ guildId: 'g', discordId: 'dc-fantasma', delta: -50, deps: makePdlDeps(state) }),
      /não cadastrado/
    );
  });
});
