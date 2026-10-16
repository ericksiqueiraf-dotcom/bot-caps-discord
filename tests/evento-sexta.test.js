const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const evento = require('../services/eventoService');

// Horários em UTC; SP = UTC-3 (outubro, sem horário de verão).
// Sexta 2026-10-16: 08h SP = 11:00Z; 23h59 SP = 02:59Z do dia 17.
const SEX_0759 = Date.UTC(2026, 9, 16, 10, 59, 0);
const SEX_0800 = Date.UTC(2026, 9, 16, 11, 0, 0);
const SEX_1200 = Date.UTC(2026, 9, 16, 15, 0, 0);
const SEX_2359 = Date.UTC(2026, 9, 17, 2, 59, 0);
const SAB_0000 = Date.UTC(2026, 9, 17, 3, 0, 0);
const QUI_1200 = Date.UTC(2026, 9, 15, 15, 0, 0);
const SAB_1200 = Date.UTC(2026, 9, 17, 15, 0, 0);

describe('SEXTA CAPS ARENA (08h-23h59 de sexta, SP)', () => {
  it('janela: sexta 08h-23h59 SP, fora disso fechada', () => {
    assert.equal(evento.isSextaRankedWindow(SEX_0759), false);
    assert.equal(evento.isSextaRankedWindow(SEX_0800), true);
    assert.equal(evento.isSextaRankedWindow(SEX_1200), true);
    assert.equal(evento.isSextaRankedWindow(SEX_2359), true);
    assert.equal(evento.isSextaRankedWindow(SAB_0000), false);
    assert.equal(evento.isSextaRankedWindow(QUI_1200), false);
    assert.equal(evento.isSextaRankedWindow(SAB_1200), false);
  });

  it('multiplicador: 2 na janela, 1 fora', () => {
    assert.equal(evento.getPdlMultiplier(SEX_1200), 2);
    assert.equal(evento.getPdlMultiplier(QUI_1200), 1);
    assert.equal(evento.getPdlMultiplier(SAB_1200), 1);
  });

  it('acumula ganhos dos vencedores e zera ao trocar de dia', () => {
    const store = {};
    evento.accumulateSextaGains(store, [{ discordId: 'u1', ratingDelta: 40 }], SEX_1200);
    evento.accumulateSextaGains(store, [{ discordId: 'u1', ratingDelta: 20 }, { discordId: 'u2', ratingDelta: 50 }], SEX_1200);
    assert.deepEqual(store.sextaRank.gains, { u1: 60, u2: 50 });
    assert.deepEqual(evento.getSextaTop(store, 3), [
      { position: 1, userId: 'u1', total: 60 },
      { position: 2, userId: 'u2', total: 50 }
    ]);
    // Fora da janela nao acumula.
    evento.accumulateSextaGains(store, [{ discordId: 'u1', ratingDelta: 999 }], SAB_1200);
    assert.equal(store.sextaRank.gains.u1, 60);
  });

  it('tick abre 08h e encerra 23h59, 1x por dia', async () => {
    const calls = [];
    const store = {};
    const deps = {
      loadSystemMeta: async () => store,
      saveSystemMeta: async () => {},
      postOpen: async () => { calls.push('open'); },
      postClose: async () => { calls.push('close'); }
    };
    await evento.runSextaTick(SEX_0800, deps);
    await evento.runSextaTick(SEX_1200, deps);
    await evento.runSextaTick(SEX_2359, deps);
    await evento.runSextaTick(SEX_2359, deps);
    await evento.runSextaTick(QUI_1200, deps);
    assert.deepEqual(calls, ['open', 'close']);
    assert.equal(store.sextaAbertaEm, '2026-10-16');
    assert.equal(store.sextaEncerradaEm, '2026-10-16');
  });
});
