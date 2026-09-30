const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findPendingAutoStartLobby } = require('../commands/legacyCommands');

const lobby = (letter, mode = 'classic', format = '5x5') => ({
  id: `${mode}-${format}-${letter.toLowerCase()}`,
  mode,
  format,
  letter,
  players: new Array(10).fill({ discordId: 'x' }),
  requiredPlayers: 10,
  status: 'waiting'
});

describe('!cancelarstart por letra (auto-start pendente)', () => {
  it('acha o lobby pendente da letra pedida', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A'), 'classic-5x5-b': lobby('B') } };
    const pending = new Map([['classic-5x5-a', 1], ['classic-5x5-b', 2]]);
    assert.equal(findPendingAutoStartLobby(queueData, pending, ['B']).id, 'classic-5x5-b');
    assert.equal(findPendingAutoStartLobby(queueData, pending, ['b']).id, 'classic-5x5-b');
  });

  it('ignora lobby sem contagem pendente mesmo com a letra certa', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A'), 'classic-5x5-b': lobby('B') } };
    const pending = new Map([['classic-5x5-a', 1]]);
    assert.equal(findPendingAutoStartLobby(queueData, pending, ['B']), null);
    assert.equal(findPendingAutoStartLobby(queueData, pending, ['A']).id, 'classic-5x5-a');
  });

  it('sem letra so resolve com pendente unico (evita sala errada)', () => {
    const one = { lobbies: { 'classic-5x5-a': lobby('A') } };
    assert.equal(findPendingAutoStartLobby(one, new Map([['classic-5x5-a', 1]]), []).id, 'classic-5x5-a');

    const two = { lobbies: { 'classic-5x5-a': lobby('A'), 'classic-5x5-b': lobby('B') } };
    const both = new Map([['classic-5x5-a', 1], ['classic-5x5-b', 2]]);
    assert.equal(findPendingAutoStartLobby(two, both, []), null);
  });

  it('retorna null sem pendentes ou com letra inexistente', () => {
    const queueData = { lobbies: { 'classic-5x5-a': lobby('A') } };
    assert.equal(findPendingAutoStartLobby(queueData, new Map(), ['A']), null);
    assert.equal(findPendingAutoStartLobby(queueData, new Map([['classic-5x5-a', 1]]), ['Z']), null);
    assert.equal(findPendingAutoStartLobby({ lobbies: {} }, new Map(), ['A']), null);
  });
});
