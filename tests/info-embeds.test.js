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

  it('buildTempoEmbed tem visual proprio (avatar, cor por cargo, ritmo)', () => {
    const legacy = require('../commands/legacyCommands');
    const e0 = legacy.buildTempoEmbed({
      displayName: 'Zerado', avatarURL: null,
      times: { totalMs: 0, weekMs: 0, monthMs: 0 },
      rank: { current: null, next: { name: '🎙️ Ativo', hours: 5 } }
    }).toJSON();
    assert.match(e0.title, /tempo em call/);
    assert.ok(e0.description.includes('Zerado'));
    assert.ok(!e0.thumbnail, 'sem avatar sem thumbnail');
    assert.ok(e0.fields.some((f) => f.name === '💡 Ritmo'));
    const e1 = legacy.buildTempoEmbed({
      displayName: 'Ativo', avatarURL: 'https://x/y.png',
      times: { totalMs: 10 * 3600000, weekMs: 2 * 3600000, monthMs: 8 * 3600000 },
      rank: { current: { name: '🎙️ Ativo', hours: 5 }, next: { name: '🎙️ Frequente', hours: 15 } }
    }).toJSON();
    assert.equal(e1.thumbnail.url, 'https://x/y.png');
    assert.ok(e1.fields.find((f) => f.name === '📊 Progresso').value.includes('▰'));
    assert.ok(!e1.fields.find((f) => f.name === '📊 Progresso').value.includes('█'));
    assert.ok(JSON.stringify(e1).length < 6000);
  });

  it('buildAjudaEmbed tem 2 paginas com ida e volta', () => {
    const legacy = require('../commands/legacyCommands');
    const p1 = legacy.buildAjudaEmbed(1).toJSON();
    const p2 = legacy.buildAjudaEmbed(2).toJSON();
    assert.match(p1.title, /\(1\/2\)/);
    assert.match(p2.title, /\(2\/2\)/);
    assert.ok(p1.fields.some((f) => f.value.includes('!ajuda2')));
    assert.ok(p2.fields.some((f) => f.value.includes('`!ajuda`')));
    assert.ok(JSON.stringify(p1).length < 6000);
    assert.ok(JSON.stringify(p2).length < 6000);
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
