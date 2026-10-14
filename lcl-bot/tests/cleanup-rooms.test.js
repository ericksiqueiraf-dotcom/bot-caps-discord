const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCleanupTargets } = require('../commands/legacyCommands');

const lobby = (letter, mode = 'classic') => ({
  id: `${mode}-5x5-${letter.toLowerCase()}`,
  mode,
  format: '5x5',
  letter,
  players: [],
  requiredPlayers: 10,
  status: 'waiting'
});
const activeMatch = (letter, mode = 'classic') => ({
  active: true,
  match: { id: `${mode}-5x5-${letter.toLowerCase()}`, mode, format: '5x5', letter }
});

describe('!limparsala por letra', () => {
  it('sem letra entende-se sala A (singular)', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A'), 'classic-5x5-b': lobby('B') } };
    const r = resolveCleanupTargets(queueData, { matches: {} }, [], { defaultLetter: 'A' });
    assert.equal(r.status, 'targets');
    assert.equal(r.selectedLetter, 'A');
    assert.equal(r.matchingLobbies.length, 1);
  });

  it('letra B/C limpa a sala especifica', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A'), 'classic-5x5-b': lobby('B') } };
    const r = resolveCleanupTargets(queueData, { matches: {} }, ['C'], { defaultLetter: 'A' });
    assert.equal(r.status, 'not_found');
    assert.equal(r.selectedLetter, 'C');

    const ok = resolveCleanupTargets(queueData, { matches: {} }, ['b'], { defaultLetter: 'A' });
    assert.equal(ok.status, 'targets');
    assert.equal(ok.matchingLobbies[0].id, 'classic-5x5-b');
  });

  it('modo + letra filtram juntos', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A', 'classic'), 'aram-5x5-a': lobby('A', 'aram') } };
    const r = resolveCleanupTargets(queueData, { matches: {} }, ['classic', 'A'], { defaultLetter: 'A' });
    assert.equal(r.status, 'targets');
    assert.equal(r.matchingLobbies.length, 1);
    assert.equal(r.matchingLobbies[0].mode, 'classic');
  });

  it('recusa quando ha partida ativa na letra', () => {
    const queueData = { lobbies: {} };
    const current = { matches: { 'classic-5x5-b': activeMatch('B') } };
    const r = resolveCleanupTargets(queueData, current, ['B'], { defaultLetter: 'A' });
    assert.equal(r.status, 'active_match');
  });

  it('partida ativa em outra letra nao bloqueia', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A') } };
    const current = { matches: { 'classic-5x5-b': activeMatch('B') } };
    const r = resolveCleanupTargets(queueData, current, [], { defaultLetter: 'A' });
    assert.equal(r.status, 'targets');
  });

  it('plural sem letra continua modo limpar-tudo', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A') } };
    const r = resolveCleanupTargets(queueData, { matches: {} }, [], {});
    assert.equal(r.status, 'clean_all');
  });
});
