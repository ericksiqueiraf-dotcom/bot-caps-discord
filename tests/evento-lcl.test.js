const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const evento = require('../services/eventoService');

// SP = UTC-3. Sex 2026-10-16 08h SP = 11:00Z; dom 23h59 SP = 02:59Z de seg 19.
const SEX_0759 = Date.UTC(2026, 9, 16, 10, 59, 0);
const SEX_0800 = Date.UTC(2026, 9, 16, 11, 0, 0);
const SAB_1200 = Date.UTC(2026, 9, 17, 15, 0, 0);
const DOM_0000 = Date.UTC(2026, 9, 18, 3, 0, 0);
const DOM_2359 = Date.UTC(2026, 9, 19, 2, 59, 0);
const SEG_0000 = Date.UTC(2026, 9, 19, 3, 0, 0);
const QUI_1200 = Date.UTC(2026, 9, 15, 15, 0, 0);

function fakeMatches() {
  return {
    matches: {
      m1: { winner: 'A', closedAt: new Date(Date.UTC(2026, 9, 16, 15, 0, 0)).toISOString(), teamA: { name: 'CAPS', originGuildId: 'g1' }, teamB: { name: 'Rival', originGuildId: 'g2' } },
      m2: { winner: 'B', closedAt: new Date(Date.UTC(2026, 9, 17, 15, 0, 0)).toISOString(), teamA: { name: 'CAPS', originGuildId: 'g1' }, teamB: { name: 'Rival', originGuildId: 'g2' } },
      m3: { winner: 'A', closedAt: new Date(Date.UTC(2026, 9, 17, 16, 0, 0)).toISOString(), teamA: { name: 'CAPS', originGuildId: 'g1' }, teamB: { name: 'Rival', originGuildId: 'g2' } },
      aberta: { winner: null, closedAt: null, teamA: { name: 'CAPS', originGuildId: 'g1' }, teamB: { name: 'Rival', originGuildId: 'g2' } },
      antiga: { winner: 'A', closedAt: new Date(Date.UTC(2026, 9, 10, 15, 0, 0)).toISOString(), teamA: { name: 'CAPS', originGuildId: 'g1' }, teamB: { name: 'Rival', originGuildId: 'g2' } }
    }
  };
}

describe('fim de semana LCL (sex 08h -> dom 23h59, SP)', () => {
  it('janela: sex 08h ate dom 23h59', () => {
    assert.equal(evento.isLclWeekendWindow(SEX_0759), false);
    assert.equal(evento.isLclWeekendWindow(SEX_0800), true);
    assert.equal(evento.isLclWeekendWindow(SAB_1200), true);
    assert.equal(evento.isLclWeekendWindow(DOM_0000), true);
    assert.equal(evento.isLclWeekendWindow(DOM_2359), true);
    assert.equal(evento.isLclWeekendWindow(SEG_0000), false);
    assert.equal(evento.isLclWeekendWindow(QUI_1200), false);
  });

  it('range da janela contem sex-dom', async () => {
    const { startMs, endMs } = evento.lclWeekendRange(SAB_1200);
    assert.equal(new Date(startMs).toISOString(), '2026-10-16T11:00:00.000Z');
    assert.equal(new Date(endMs).toISOString(), '2026-10-19T02:59:59.000Z');
    const top = await evento.getLclWeekendTop(async () => fakeMatches(), startMs, endMs);
    assert.deepEqual(top, [
      { name: 'CAPS', originGuildId: 'g1', wins: 2 },
      { name: 'Rival', originGuildId: 'g2', wins: 1 }
    ]);
  });

  it('tick abre sexta, encerra domingo, 1x cada (com fecha tardio na segunda)', async () => {
    const calls = [];
    const store = {};
    const deps = {
      loadSystemMeta: async () => store,
      saveSystemMeta: async () => {},
      loadInterMatches: async () => fakeMatches(),
      postOpen: async () => { calls.push('open'); },
      postClose: async () => { calls.push('close'); },
      setLclBot: async () => ({ ok: true })
    };
    await evento.runLclTick(SEX_0800, deps);
    await evento.runLclTick(SAB_1200, deps);
    await evento.runLclTick(DOM_2359, deps);
    await evento.runLclTick(DOM_2359, deps);
    assert.deepEqual(calls, ['open']);
    assert.equal(store.lclAbertoEm, '2026-10-16');
    // Segunda de manha: fecha tardio com o top.
    let closedTop = null;
    await evento.runLclTick(SEG_0000, { ...deps, postClose: async (top) => { calls.push('close'); closedTop = top; } });
    assert.deepEqual(calls, ['open', 'close']);
    assert.equal(closedTop.length, 2);
    assert.equal(store.lclEncerradoEm, '2026-10-16');
    await evento.runLclTick(SEG_0000 + 3600000, deps);
    assert.deepEqual(calls, ['open', 'close']);
  });
});
