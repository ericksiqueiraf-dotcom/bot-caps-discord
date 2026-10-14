const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeTwoMatchWorld, resolveVictoryTarget } = require('./helpers');

describe('seletor de partida do !vitoria (A e B ativas)', () => {
  it('!vitoria 1 A resolve a partida A, time 1', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['1', 'A']);
    assert.equal(r.winningTeam, '1');
    assert.ok(r.entry);
    assert.equal(r.entry[0], 'classic-5x5-a');
  });

  it('!vitoria A 1 resolve a partida A (ordem invertida)', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['A', '1']);
    assert.ok(r.entry);
    assert.equal(r.entry[0], 'classic-5x5-a');
  });

  it('!vitoria 1 B resolve a partida B', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['1', 'B']);
    assert.ok(r.entry);
    assert.equal(r.entry[0], 'classic-5x5-b');
  });

  it('!vitoria 2 B resolve a partida B, time 2', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['2', 'B']);
    assert.equal(r.winningTeam, '2');
    assert.ok(r.entry);
    assert.equal(r.entry[0], 'classic-5x5-b');
  });

  it('letra inexistente nao resolve nada', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['1', 'Z']);
    assert.equal(r.entry, null);
  });

  it('sem letra e com 2 ativas nao resolve sozinho (seguro)', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['1'], undefined);
    assert.equal(r.entry, null);
  });

  it('sem letra mas com staff no canal do time resolve pelo canal de voz', () => {
    const w = makeTwoMatchWorld();
    const r = resolveVictoryTarget({ matches: w.matches }, ['1'], 't1-A');
    assert.ok(r.entry);
    assert.equal(r.entry[0], 'classic-5x5-a');
  });
});
