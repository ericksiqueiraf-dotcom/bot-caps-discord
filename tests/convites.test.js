const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const convites = require('../services/convitesService');

function freshStore() {
  return { links: {}, uses: [], monthly: {}, rewarded: {} };
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const OLD_ACCOUNT = new Date(NOW - 30 * 24 * 3600 * 1000).toISOString();
const NEW_ACCOUNT = new Date(NOW - 2 * 24 * 3600 * 1000).toISOString();

describe('convites com recompensa', () => {
  it('conta entrada por convite (mensal + total)', () => {
    const store = freshStore();
    const r = convites.recordInviteUse(store, { code: 'abc', inviterId: 'u1', newMemberId: 'novo1', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    assert.equal(r.counted, true);
    assert.equal(r.monthCount, 1);
    assert.equal(r.lifetime, 1);
    assert.equal(convites.getRecruiterStats(store, 'u1', '2026-10').month, 1);
  });

  it('conta nova (< 7 dias) nao conta; auto-convite nao conta', () => {
    const store = freshStore();
    assert.equal(convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'n1', memberCreatedAtMs: NEW_ACCOUNT, nowMs: NOW }).counted, false);
    assert.equal(convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'u1', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW }).counted, false);
    assert.equal(convites.recordInviteUse(store, { inviterId: null, newMemberId: 'n2', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW }).counted, false);
    assert.equal(convites.countLifetime(store, 'u1'), 0);
  });

  it('mesmo membro conta 1x', () => {
    const store = freshStore();
    convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'n1', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    const r = convites.recordInviteUse(store, { inviterId: 'u2', newMemberId: 'n1', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    assert.equal(r.counted, false);
    assert.equal(r.reason, 'ja-contado');
  });

  it('saida em 24h estorna; depois disso mantem', () => {
    const store = freshStore();
    convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'n1', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    const r1 = convites.handleMemberLeave(store, { newMemberId: 'n1', nowMs: NOW + 2 * 3600 * 1000 });
    assert.equal(r1.reverted.length, 1);
    assert.equal(convites.countLifetime(store, 'u1'), 0);
    assert.equal(convites.getRecruiterStats(store, 'u1', '2026-10').month, 0);

    convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'n2', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    const r2 = convites.handleMemberLeave(store, { newMemberId: 'n2', nowMs: NOW + 48 * 3600 * 1000 });
    assert.equal(r2.reverted.length, 0);
    assert.equal(convites.countLifetime(store, 'u1'), 1);
  });

  it('metas 3/5/10 anunciam 1x cada', () => {
    const store = freshStore();
    for (let i = 1; i <= 3; i++) {
      convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: `n${i}`, memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    }
    assert.deepEqual(convites.checkThresholdRewards(store, 'u1').unlocked, [3]);
    assert.deepEqual(convites.checkThresholdRewards(store, 'u1').unlocked, []);
    for (let i = 4; i <= 10; i++) {
      convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: `n${i}`, memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    }
    assert.deepEqual(convites.checkThresholdRewards(store, 'u1').unlocked, [5, 10]);
  });

  it('top mensal ordenado e limitado', () => {
    const store = freshStore();
    convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'a', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    convites.recordInviteUse(store, { inviterId: 'u1', newMemberId: 'b', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    convites.recordInviteUse(store, { inviterId: 'u2', newMemberId: 'c', memberCreatedAtMs: OLD_ACCOUNT, nowMs: NOW });
    const top = convites.getMonthlyTop(store, '2026-10', 10);
    assert.deepEqual(top, [
      { position: 1, userId: 'u1', count: 2 },
      { position: 2, userId: 'u2', count: 1 }
    ]);
    assert.equal(convites.getMonthlyTop(store, '2026-10', 1).length, 1);
    assert.deepEqual(convites.getMonthlyTop(store, '2026-09', 10), []);
  });
});
