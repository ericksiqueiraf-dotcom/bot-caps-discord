const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lobbyUtils = require('../utils/lobbyUtils');

describe('filtro de guild (allowedGuildIds) — comportamento real atual', () => {
  it('lobbyUtils nao exporta isGuildAllowed (drift do teste antigo)', () => {
    assert.equal(typeof lobbyUtils.isGuildAllowed, 'undefined');
  });

  it('config.json expoe allowedGuildIds apenas como dado (sem consumidor em producao)', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')
    );
    if (config.allowedGuildIds !== undefined) {
      assert.ok(Array.isArray(config.allowedGuildIds), 'allowedGuildIds deve ser array quando presente');
      for (const id of config.allowedGuildIds) {
        assert.equal(typeof id, 'string');
      }
    } else {
      assert.ok(true, 'ausente = sem filtro');
    }
  });

  it('producao nao filtra por allowedGuildIds (index.js nao consome a chave)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.ok(!indexSrc.includes('allowedGuildIds'), 'index.js nao referencia allowedGuildIds');
    const lobbySrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'lobbyUtils.js'), 'utf8');
    assert.ok(!lobbySrc.includes('allowedGuildIds'), 'lobbyUtils.js nao referencia allowedGuildIds');
  });
});
