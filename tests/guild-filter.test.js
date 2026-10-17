const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lobbyUtils = require('../utils/lobbyUtils');
const config = require('../config.json');

describe('filtro de guild (allowedGuildIds)', () => {
  it('exportado como funcao', () => {
    assert.equal(typeof lobbyUtils.isGuildAllowed, 'function');
  });

  it('sem lista configurada libera todas (comportamento da producao)', () => {
    const bak = config.allowedGuildIds;
    try {
      delete config.allowedGuildIds;
      assert.equal(lobbyUtils.isGuildAllowed('qualquer-guild'), true);
      config.allowedGuildIds = [];
      assert.equal(lobbyUtils.isGuildAllowed('qualquer-guild'), true);
    } finally {
      if (bak === undefined) delete config.allowedGuildIds;
      else config.allowedGuildIds = bak;
    }
  });

  it('com lista configurada so libera as listadas', () => {
    const bak = config.allowedGuildIds;
    try {
      config.allowedGuildIds = ['g1', 'g2'];
      assert.equal(lobbyUtils.isGuildAllowed('g1'), true);
      assert.equal(lobbyUtils.isGuildAllowed('g2'), true);
      assert.equal(lobbyUtils.isGuildAllowed('outra'), false);
      assert.equal(lobbyUtils.isGuildAllowed(null), false);
    } finally {
      if (bak === undefined) delete config.allowedGuildIds;
      else config.allowedGuildIds = bak;
    }
  });

  it('pipeline de comandos consulta o gate', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.ok(indexSrc.includes('isGuildAllowed(message.guild.id)'), 'messageCreate com gate');
    assert.ok(indexSrc.includes('isGuildAllowed(interaction.guild.id)'), 'interactionCreate com gate');
  });
});
