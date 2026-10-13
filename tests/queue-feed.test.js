const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildQueueFeedText } = require('../utils/lobbyUtils');

describe('feed automatico do canal #fila', () => {
  it('!entrar gera linha com sala, modo e contagem', () => {
    const text = buildQueueFeedText({
      kind: 'entrar-join',
      discordId: 'u1',
      letter: 'A',
      modeLabel: 'Classic',
      playersCount: 3,
      requiredPlayers: 10
    });
    assert.ok(text.includes('<@u1>'));
    assert.ok(text.includes('Sala A (Classic)'));
    assert.ok(text.includes('3/10'));
    assert.ok(!text.includes('Falta'), 'sem marco antes da hora');
  });

  it('!entrar em 8/10 destaca que faltam 2', () => {
    const text = buildQueueFeedText({
      kind: 'entrar-join',
      discordId: 'u1',
      letter: 'A',
      modeLabel: 'Classic',
      playersCount: 8,
      requiredPlayers: 10
    });
    assert.ok(text.includes('8/10'));
    assert.ok(text.includes('Faltam **2**'));
  });

  it('!entrar em 9/10 destaca que falta 1', () => {
    const text = buildQueueFeedText({
      kind: 'entrar-join',
      discordId: 'u1',
      letter: 'B',
      modeLabel: 'ARAM 2x2',
      playersCount: 3,
      requiredPlayers: 4
    });
    assert.ok(text.includes('3/4'));
    assert.ok(text.includes('Falta **1**'));
  });

  it('!entrar na metade marca o meio da sala', () => {
    const text = buildQueueFeedText({
      kind: 'entrar-join',
      discordId: 'u1',
      letter: 'A',
      modeLabel: 'TIER S',
      playersCount: 5,
      requiredPlayers: 10
    });
    assert.ok(text.includes('TIER S'));
    assert.ok(text.includes('Metade'));
  });

  it('!espera gera linha com posicao', () => {
    const text = buildQueueFeedText({
      kind: 'espera-join',
      discordId: 'u2',
      modeLabel: 'CLASSIC 5x5',
      position: 3,
      isInfernalBoost: false
    });
    assert.ok(text.includes('<@u2>'));
    assert.ok(text.includes('CLASSIC 5x5'));
    assert.ok(text.includes('posição **3**'));
  });

  it('!esperatiers com INFERNAL marca a chama', () => {
    const text = buildQueueFeedText({
      kind: 'espera-join',
      discordId: 'u3',
      modeLabel: 'CLASSIC TIER S',
      position: 5,
      isInfernalBoost: true
    });
    assert.ok(text.includes('CLASSIC TIER S'));
    assert.ok(text.includes('🔥'));
  });

  it('evento desconhecido retorna nulo', () => {
    assert.equal(buildQueueFeedText({ kind: 'x' }), null);
    assert.equal(buildQueueFeedText(), null);
  });
});
