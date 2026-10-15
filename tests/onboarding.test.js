const { describe, it } = require('node:test');
const assert = require('node:assert');

const onboarding = require('../services/onboardingService');
const { getResolvedContentTemplates } = require('../services/contentTextService');

describe('onboarding 2 passos', () => {
  it('button ids incluem aceite de regras', () => {
    assert.strictEqual(onboarding.ONBOARDING_BUTTON_IDS.ACCEPT_RULES, 'onboarding_accept_rules');
    assert.ok(onboarding.ONBOARDING_BUTTON_IDS.LOL_PLAYER);
    assert.ok(onboarding.ONBOARDING_BUTTON_IDS.NON_PLAYER);
  });

  it('needsRulesAcceptance exige cadastro + sem aceite', () => {
    assert.strictEqual(onboarding.needsRulesAcceptance(null), false);
    assert.strictEqual(onboarding.needsRulesAcceptance({}), false);
    assert.strictEqual(
      onboarding.needsRulesAcceptance({ discordId: '1', registeredNickname: 'Foo#BR1' }),
      true
    );
    assert.strictEqual(
      onboarding.needsRulesAcceptance({ discordId: '1', registeredNickname: 'Foo#BR1', rulesAcceptedAt: new Date().toISOString() }),
      false
    );
  });

  it('findPlayerByDiscordId pega o registro mais recente', () => {
    const stats = {
      players: {
        a: { discordId: '9', registeredNickname: 'Old#BR1', registeredAt: '2024-01-01T00:00:00.000Z' },
        b: { discordId: '9', registeredNickname: 'New#BR1', registeredAt: '2024-02-01T00:00:00.000Z' }
      }
    };
    assert.strictEqual(onboarding.findPlayerByDiscordId(stats, '9').registeredNickname, 'New#BR1');
    assert.strictEqual(onboarding.findPlayerByDiscordId(stats, 'missing'), null);
  });

  it('buildRulesAcceptanceUpdate carimba data e versao', () => {
    const update = onboarding.buildRulesAcceptanceUpdate(3);
    assert.ok(update.rulesAcceptedAt);
    assert.strictEqual(update.rulesAcceptedVersion, 3);
    assert.ok(!Number.isNaN(Date.parse(update.rulesAcceptedAt)));
  });

  it('welcome templates vendem a Arena (vaga + 2 minutos + cadastro)', () => {
    const resolved = getResolvedContentTemplates({});
    assert.ok(String(resolved.welcome.rulesText).includes('!cadastrar'));
    assert.ok(String(resolved.welcome.titleTemplate).includes('{{username}}'));
    assert.ok(String(resolved.welcome.description).includes('2 minutos'));
    assert.ok(String(resolved.welcome.description).includes('!entrar'));
    assert.ok(String(resolved.welcome.unlockText).includes('Quero jogar agora'));
    assert.ok(String(resolved.onboarding.registrationTitle).includes('PASSO 1'));
    assert.ok(String(resolved.welcome.commandsText).includes('!cadastrar'));
  });

  it('legacyCommands expoe handler de onboarding e aceite vive no onboardingService', () => {
    const legacy = require('../commands/legacyCommands');
    assert.strictEqual(typeof legacy.handleOnboardingCommand, 'function');
    assert.strictEqual(typeof legacy.handleRegisterCommand, 'function');
    assert.strictEqual(typeof legacy.handleNickUpdateCommand, 'function');
    assert.strictEqual(typeof onboarding.needsRulesAcceptance, 'function');
    assert.strictEqual(typeof onboarding.buildRulesAcceptanceUpdate, 'function');
    assert.strictEqual(typeof onboarding.grantRoleById, 'function');
    assert.strictEqual(typeof onboarding.getVisitanteRoleId, 'function');
  });
});
