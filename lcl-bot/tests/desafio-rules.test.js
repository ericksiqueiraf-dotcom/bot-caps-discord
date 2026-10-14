const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildDesafioRulesEmbed, DESAFIO_RULES_SECTIONS } = require('../utils/lobbyUtils');

describe('!regrasdesafio', () => {
  it('embed dentro dos limites e cobre desafio, pontos, wo e comandos', () => {
    const embed = buildDesafioRulesEmbed();
    assert.ok(embed.data.title.toLowerCase().includes('desafio'));
    assert.equal(embed.data.fields.length, DESAFIO_RULES_SECTIONS.length);
    for (const field of embed.data.fields) {
      assert.ok(field.value.length <= 1024, `field excede 1024: ${field.name}`);
    }
    const text = embed.data.fields.map((f) => `${f.name} ${f.value}`).join('\n').toLowerCase();
    for (const keyword of ['!desafiar', 'md1', 'md3', '!resultado-inter', '!wo', '!inter-ranking', 'w.o.', 'capitão']) {
      assert.ok(text.includes(keyword), `regras do desafio sem: ${keyword}`);
    }
  });
});
