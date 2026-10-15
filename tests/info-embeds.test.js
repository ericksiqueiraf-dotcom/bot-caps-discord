// Embeds informativos fixos por sala (setup) — mesmos do !regras / !onboarding.
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { buildRulesEmbed, buildStaffEmbed, buildOnboardingGuideEmbed, RULES_SECTIONS, STAFF_SECTIONS, ONBOARDING_SECTIONS } = require('../utils/lobbyUtils');

function assertDiscordLimits(embed, label) {
  const json = embed.toJSON();
  assert.ok((json.title || '').length <= 256, `${label}: titulo`);
  assert.ok((json.description || '').length <= 4096, `${label}: descricao`);
  assert.ok((json.fields || []).length <= 25, `${label}: fields`);
  for (const f of json.fields || []) {
    assert.ok(f.name.length <= 256 && f.value.length <= 1024, `${label}: field ${f.name}`);
  }
}

describe('embeds informativos por sala', () => {
  it('regras: titulo fixo + dentro dos limites', () => {
    const embed = buildRulesEmbed();
    assert.strictEqual(embed.data.title, '📚 Regras — CAPS Arena');
    assert.strictEqual(embed.data.fields.length, RULES_SECTIONS.length);
    assertDiscordLimits(embed, 'regras');
  });

  it('guia: titulo fixo + campos ONBOARDING_SECTIONS + dentro dos limites (sem guild)', () => {
    const embed = buildOnboardingGuideEmbed();
    assert.strictEqual(embed.data.title, '🧩 Como jogar na CAPS Arena');
    assert.strictEqual(embed.data.fields.length, ONBOARDING_SECTIONS.length);
    assertDiscordLimits(embed, 'onboarding');
  });

  it('guia com guild usa o nome do servidor', () => {
    const embed = buildOnboardingGuideEmbed({ name: 'Servidor X' });
    assert.ok(embed.data.description.includes('Servidor X'));
  });

  it('staff: titulo fixo + campos STAFF_SECTIONS + dentro dos limites (sem guild)', () => {
    const embed = buildStaffEmbed();
    assert.strictEqual(embed.data.title, '🛠️ Guia da Staff — CAPS Arena');
    assert.strictEqual(embed.data.fields.length, STAFF_SECTIONS.length);
    assertDiscordLimits(embed, 'staff');
  });

  it('pattern so usa tipos de embed conhecidos', () => {
    const pattern = require('../server-pattern.json');
    const known = new Set(['rules', 'onboarding']);
    for (const spec of pattern.textChannels) {
      if (spec.infoEmbed) assert.ok(known.has(spec.infoEmbed), `${spec.name}: ${spec.infoEmbed}`);
    }
    const types = pattern.textChannels.filter((s) => s.infoEmbed).map((s) => s.infoEmbed);
    assert.ok(types.includes('rules'));
    assert.ok(types.includes('onboarding'));
  });
});
