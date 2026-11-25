// INFERNAL: duração por sequência (5 = 3 dias, 10 = 5 dias) e ranking único.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getInfernalGrantDays,
  computeInfernalExpiry,
  getInfernalRanking,
  buildTopInfernalEmbed
} = require('../utils/lobbyUtils');

const DAY = 24 * 60 * 60 * 1000;

describe('duração do cargo INFERNAL', () => {
  it('5 seguidas = 3 dias (6 a 9 mantêm o mesmo marco)', () => {
    assert.equal(getInfernalGrantDays(5), 3);
    assert.equal(getInfernalGrantDays(6), 3);
    assert.equal(getInfernalGrantDays(9), 3);
  });

  it('10 seguidas = 5 dias; cada 5 a mais soma +5 dias', () => {
    assert.equal(getInfernalGrantDays(10), 5);
    assert.equal(getInfernalGrantDays(11), 5);
    assert.equal(getInfernalGrantDays(15), 10);
    assert.equal(getInfernalGrantDays(20), 15);
  });

  it('10 seguidas sem validade atual vale 5 dias a partir de agora', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    const expiry = computeInfernalExpiry(10, null, now);
    assert.equal(expiry, new Date(now + 5 * DAY).toISOString());
  });

  it('10 seguidas garante 5 dias a partir de agora (estende o que for menor)', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    const current = new Date(now + 3 * DAY).toISOString();
    assert.equal(computeInfernalExpiry(10, current, now), new Date(now + 5 * DAY).toISOString());
  });

  it('não encurta uma validade maior que já exista', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    const current = new Date(now + 8 * DAY).toISOString();
    assert.equal(computeInfernalExpiry(10, current, now), current);
  });

  it('5 seguidas sem validade atual vale 3 dias a partir de agora', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    assert.equal(computeInfernalExpiry(5, null, now), new Date(now + 3 * DAY).toISOString());
  });

  it('5 seguidas garante 3 dias (estende o que for menor)', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    const current = new Date(now + 2 * DAY).toISOString();
    assert.equal(computeInfernalExpiry(5, current, now), new Date(now + 3 * DAY).toISOString());
  });

  it('5 seguidas não encurta uma validade maior', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    const current = new Date(now + 5 * DAY).toISOString();
    assert.equal(computeInfernalExpiry(5, current, now), current);
  });

  it('streak abaixo de 5 mantém a validade atual ou cai nas 08h SP', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    const current = new Date(now + 2 * DAY).toISOString();
    assert.equal(computeInfernalExpiry(4, current, now), current);
    const expiry = new Date(computeInfernalExpiry(4, null, now));
    assert.ok(expiry.getTime() > now);
    assert.ok(expiry.getTime() <= now + DAY);
    assert.equal(expiry.getUTCHours(), 11); // 08h em São Paulo (UTC-3)
  });
});

describe('ranking único do INFERNAL', () => {
  const stats = {
    players: {
      a: { discordId: 'a', nickname: 'Zed#BR1', infernalCount: 2, infernalLastMilestone: 5 },
      b: { discordId: 'b', nickname: 'Ana#BR1', infernalCount: 2, infernalBestStreak: 10 },
      c: { discordId: 'c', nickname: 'Bia#BR1', infernalCount: 2, infernalLastMilestone: 5 },
      d: { discordId: 'd', nickname: 'Sem#BR1', infernalCount: 0, infernalBestStreak: 99 }
    }
  };

  it('ordena por conquistas e desempata pela melhor sequência', () => {
    const ranked = getInfernalRanking(stats);
    assert.deepEqual(ranked.map((p) => p.discordId), ['b', 'c', 'a']);
    assert.equal(ranked[0].bestStreak, 10);
  });

  it('usa infernalLastMilestone quando não existe infernalBestStreak', () => {
    const ranked = getInfernalRanking({
      players: {
        x: { discordId: 'x', nickname: 'X#BR1', infernalCount: 1, infernalLastMilestone: 10 },
        y: { discordId: 'y', nickname: 'Y#BR1', infernalCount: 1, infernalLastMilestone: 5 }
      }
    });
    assert.deepEqual(ranked.map((p) => p.discordId), ['x', 'y']);
  });

  it('o embed usa a mesma ordem e mostra a melhor sequência', () => {
    const embed = buildTopInfernalEmbed(stats, { phase: 'official', currentSeason: 2 });
    const firstField = embed.data.fields[0].value;
    assert.ok(firstField.includes('<@b>'));
    assert.ok(firstField.includes('melhor sequência: **10**'));
    assert.ok(firstField.indexOf('<@b>') < firstField.indexOf('<@c>'));
  });
});
