const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const duelo = require('../services/dueloService');

describe('duelo de PDL', () => {
  it('cria, valida e impede duplicado', () => {
    let duelos = [];
    let r = duelo.createDuel(duelos, 'a', 'a');
    assert.equal(r.ok, false);
    r = duelo.createDuel(duelos, 'a', 'b', 500);
    assert.equal(r.ok, false);
    r = duelo.createDuel(duelos, 'a', 'b', 50);
    assert.equal(r.ok, true);
    assert.equal(r.valor, 50);
    duelos = r.duelos;
    assert.equal(duelo.createDuel(duelos, 'b', 'a', 50).ok, false);
    assert.equal(duelo.createDuel([], 'a', 'b').valor, 50);
  });

  it('aceita e recusa o mais recente', () => {
    let duelos = [];
    duelos = duelo.createDuel(duelos, 'a', 'b', 50).duelos;
    duelos = duelo.createDuel(duelos, 'c', 'b', 30).duelos;
    let r = duelo.refuseDuel(duelos, 'b');
    assert.equal(r.ok, true);
    assert.equal(r.duel.a, 'c');
    r = duelo.acceptDuel(r.duelos, 'b');
    assert.equal(r.ok, true);
    assert.equal(r.duel.a, 'a');
    assert.equal(duelo.acceptDuel(r.duelos, 'z').ok, false);
  });

  it('liquida quando duelistas caem em lados opostos', () => {
    let duelos = [];
    duelos = duelo.createDuel(duelos, 'a', 'b', 50).duelos;
    duelos = duelo.acceptDuel(duelos, 'b').duelos;
    let r = duelo.settleDuels(duelos, ['a', 'x'], ['b', 'y'], '1');
    assert.deepEqual(r.settled, [{ winnerId: 'a', loserId: 'b', pontos: 50 }]);
    // Mesmo lado: nada acontece.
    duelos = duelo.createDuel([], 'a', 'b', 50).duelos;
    duelos = duelo.acceptDuel(duelos, 'b').duelos;
    r = duelo.settleDuels(duelos, ['a', 'b'], ['x', 'y'], '1');
    assert.deepEqual(r.settled, []);
    // Pendente (não aceito) não liquida.
    duelos = duelo.createDuel([], 'a', 'b', 50).duelos;
    r = duelo.settleDuels(duelos, ['a'], ['b'], '2');
    assert.deepEqual(r.settled, []);
  });

  it('desafio com 7+ dias expira', () => {
    const now = Date.now();
    const duelos = [{ id: 'd1', a: 'a', b: 'b', pontos: 50, status: 'pendente', createdAt: new Date(now - 8 * 24 * 3600 * 1000).toISOString() }];
    assert.deepEqual(duelo.expireDuels(duelos, now), []);
  });
});
