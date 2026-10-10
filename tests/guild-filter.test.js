const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isGuildAllowed } = require('../utils/lobbyUtils');
const config = require('../config.json');

describe('filtro de guild (allowedGuildIds)', () => {
  it('exportado como funcao', () => {
    assert.equal(typeof isGuildAllowed, 'function');
  });

  it('sem lista configurada libera todas (comportamento da producao)', () => {
    const backup = config.allowedGuildIds;
    delete config.allowedGuildIds;
    assert.equal(isGuildAllowed('qualquer-guild'), true);
    if (backup !== undefined) config.allowedGuildIds = backup;
  });

  it('com lista configurada so libera as listadas', () => {
    const backup = config.allowedGuildIds;
    config.allowedGuildIds = ['1558217291123138561'];
    assert.equal(isGuildAllowed('1558217291123138561'), true);
    assert.equal(isGuildAllowed('1273653944169660427'), false);
    if (backup !== undefined) config.allowedGuildIds = backup;
    else delete config.allowedGuildIds;
  });
});
