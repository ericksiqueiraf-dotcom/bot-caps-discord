const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRulesEmbed, RULES_SECTIONS, buildStaffEmbed, STAFF_SECTIONS } = require('../utils/lobbyUtils');

describe('!regras', () => {
  it('embed dentro dos limites do Discord e cobre os temas', () => {
    const embed = buildRulesEmbed();
    assert.ok(embed.data.title.includes('Regras'));
    assert.equal(embed.data.fields.length, RULES_SECTIONS.length);
    for (const field of embed.data.fields) {
      assert.ok(field.value.length <= 1024, `field excede 1024: ${field.name}`);
    }
    const text = embed.data.fields.map((f) => `${f.name} ${f.value}`).join('\n').toLowerCase();
    for (const keyword of ['cadastrar', 'tier s', 'infernal', 'espera', 'roleta', 'mvp', 'temporada', 'top10']) {
      assert.ok(text.includes(keyword), `regras sem o tema: ${keyword}`);
    }
  });

  it('guia da staff dentro dos limites e cobre as frentes', () => {
    const embed = buildStaffEmbed();
    assert.ok(embed.data.title.toLowerCase().includes('staff'));
    assert.equal(embed.data.fields.length, STAFF_SECTIONS.length);
    for (const field of embed.data.fields) {
      assert.ok(field.value.length <= 1024, `field excede 1024: ${field.name}`);
    }
    const text = embed.data.fields.map((f) => `${f.name} ${f.value}`).join('\n').toLowerCase();
    for (const keyword of ['!start', '!vitoria', '!rematch', '!roleta', '!pdl', '!remover', '!limparsalas', '!sincronizarelo', '!resetgeral', '!iniciartemporada']) {
      assert.ok(text.includes(keyword), `guia sem o comando: ${keyword}`);
    }
  });
});
