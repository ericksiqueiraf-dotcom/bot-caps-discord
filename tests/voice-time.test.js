const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const vt = require('../services/voiceTimeService');

const H = 3600000;

describe('tempo em call', () => {
  it('closeSession acumula geral/semana/mes e zera ao virar janela', () => {
    const store = { users: {}, sessions: {} };
    const t0 = Date.UTC(2026, 9, 16, 12, 0, 0); // sex
    store.sessions['g:u1'] = { since: t0 - 90 * 60000, channelId: 'c' };
    assert.equal(vt.closeSession(store, 'g', 'u1', t0), 90 * 60000);
    assert.equal(vt.getUserTime(store, 'u1', t0).totalMs, 90 * 60000);
    assert.equal(vt.getUserTime(store, 'u1', t0).monthMs, 90 * 60000);
    // Semana seguinte: week zera, total acumula.
    const t1 = t0 + 8 * 24 * 3600 * 1000;
    store.sessions['g:u1'] = { since: t1 - 30 * 60000, channelId: 'c' };
    vt.closeSession(store, 'g', 'u1', t1);
    const got = vt.getUserTime(store, 'u1', t1);
    assert.equal(got.weekMs, 30 * 60000);
    assert.equal(got.totalMs, 120 * 60000);
  });

  it('sem sessao aberta nao acumula', () => {
    const store = { users: {}, sessions: {} };
    assert.equal(vt.closeSession(store, 'g', 'u1', Date.now()), 0);
    assert.equal(vt.getUserTime(store, 'u9').totalMs, 0);
  });

  it('escada de cargos por horas no mes', () => {
    assert.equal(vt.rankForMonth(0).current, null);
    assert.equal(vt.rankForMonth(4 * H).next.name, '🎙️ Ativo');
    assert.equal(vt.rankForMonth(5 * H).current.name, '🎙️ Ativo');
    assert.equal(vt.rankForMonth(20 * H).current.name, '🎙️ Frequente');
    assert.equal(vt.rankForMonth(20 * H).next.name, '🎙️ Viciado em Call');
    assert.equal(vt.rankForMonth(40 * H).current.name, '🎙️ Viciado em Call');
    assert.equal(vt.rankForMonth(40 * H).next, null);
  });

  it('formatTempo e barra de progresso', () => {
    assert.equal(vt.formatTempo(0), '0 min');
    assert.equal(vt.formatTempo(3 * H + 50 * 60000), '3 h 50 min');
    assert.equal(vt.progressBar(3.8 * H, { hours: 5 }), '███████□□□ 76%');
    assert.equal(vt.progressBar(40 * H, null), '██████████ 100%');
  });

  it('top mensal ordenado; apuracao com lounge + voz do mes', () => {
    const store = { users: {}, sessions: {} };
    const t0 = Date.UTC(2026, 9, 16, 12, 0, 0);
    store.sessions['g:a'] = { since: t0 - 40 * H, channelId: 'c' };
    store.sessions['g:b'] = { since: t0 - 20 * H, channelId: 'c' };
    store.sessions['g:c'] = { since: t0 - 6 * H, channelId: 'c' };
    for (const u of ['a', 'b', 'c']) vt.closeSession(store, 'g', u, t0);
    const top = vt.getMonthlyTop(store, '2026-10', 10);
    assert.deepEqual(top.map((t) => t.userId), ['a', 'b', 'c']);
    const r = vt.computeMonthlyRewards(store, '2026-10');
    assert.deepEqual(r.earners.viciado, ['a']);
    assert.deepEqual(r.earners.frequente, ['a', 'b']);
    assert.deepEqual(r.earners.ativo, ['a', 'b', 'c']);
    assert.equal(r.vozDoMes, 'a');
  });

  it('sem ninguem acima de 5h nao ha voz do mes', () => {
    const store = { users: { x: { totalMs: H, month: { key: '2026-10', ms: H } } }, sessions: {} };
    const r = vt.computeMonthlyRewards(store, '2026-10');
    assert.equal(r.vozDoMes, null);
    assert.deepEqual(r.earners.ativo, []);
  });
});
