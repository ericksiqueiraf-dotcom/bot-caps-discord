const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const payments = require('../services/clubePaymentsService');

const CONFIG = {
  clubePagamentos: {
    apoiador: { preco: 9.99, dias: 30 },
    vip: { preco: 19.99, dias: 30 },
    lendario: { preco: 29.99, dias: 30 }
  }
};

function mockMpFetch(handler) {
  return async (url, options) => ({
    ok: true,
    status: 200,
    json: async () => handler(url, JSON.parse(options?.body || '{}'))
  });
}

function mockStore(initial = []) {
  let saved = null;
  return {
    loadVipSubscriptions: async () => ({ subscriptions: [...initial] }),
    saveVipSubscriptions: async (data) => { saved = data; },
    saved: () => saved
  };
}

function mockDiscordRest() {
  const calls = [];
  return {
    calls,
    findRoleIdByName: async (guildId, roleName) => `role-${roleName}`,
    addMemberRole: async (guildId, userId, roleId) => { calls.push(['add', guildId, userId, roleId]); },
    removeMemberRole: async (guildId, userId, roleId) => { calls.push(['remove', guildId, userId, roleId]); },
    sendChannelMessage: async (channelId, content) => { calls.push(['msg', channelId, content]); },
    findTextChannelIdByName: async () => 'chan-1',
    sendDm: async (userId, content) => { calls.push(['dm', userId, content]); }
  };
}

describe('clube PIX (Mercado Pago)', () => {
  it('tiers e preços vêm do config com defaults', () => {
    assert.equal(payments.getClubeTierConfig(CONFIG, 'vip').preco, 19.99);
    assert.equal(payments.getClubeTierConfig(CONFIG, 'vip').roleName, '⭐ VIP');
    assert.equal(payments.getClubeTierConfig({}, 'apoiador').preco, 9.99);
    assert.equal(payments.getClubeTierConfig(CONFIG, 'diamante'), null);
    assert.ok(payments.isValidEmail('a@b.com'));
    assert.ok(!payments.isValidEmail('sem-arroba'));
  });

  it('external_reference identifica clube e ignora SnapFlow', () => {
    const ref = payments.buildExternalReference('g1', 'u2', 'vip');
    assert.deepEqual(payments.parseVipReference(ref), { guildId: 'g1', discordId: 'u2', tierKey: 'vip' });
    assert.equal(payments.parseVipReference('sess_abc123'), null);
    assert.equal(payments.parseVipReference('caps-vip:g1:u2:ouro'), null);
  });

  it('createVipPixPayment monta o payload PIX', async () => {
    let seen = null;
    const mpFetch = mockMpFetch((url, body) => {
      seen = { url, body };
      return { id: 'pay-1', status: 'pending', point_of_interaction: { transaction_data: { qr_code: 'BR...', qr_code_base64: 'aGVsbG8=' } } };
    });
    const result = await payments.createVipPixPayment({
      tierKey: 'lendario', email: 'vip@email.com', discordId: 'u1', guildId: 'g1',
      config: CONFIG, accessToken: 'APP_USR-test', publicBaseUrl: 'https://x.ngrok.io', mpFetch
    });
    assert.equal(result.qrCode, 'BR...');
    assert.equal(seen.body.payment_method_id, 'pix');
    assert.equal(seen.body.transaction_amount, 29.99);
    assert.equal(seen.body.external_reference, 'caps-vip:g1:u1:lendario');
    assert.equal(seen.body.notification_url, 'https://x.ngrok.io/webhooks/mercadopago');
    assert.ok(seen.body.payer.email.includes('@'));
  });

  it('createVipPixPayment falha sem token ou e-mail', async () => {
    await assert.rejects(() => payments.createVipPixPayment({
      tierKey: 'vip', email: 'a@b.com', discordId: 'u', guildId: 'g', config: CONFIG, accessToken: '', mpFetch: mockMpFetch(() => ({}))
    }), /MP_ACCESS_TOKEN/);
    await assert.rejects(() => payments.createVipPixPayment({
      tierKey: 'vip', email: 'ruim', discordId: 'u', guildId: 'g', config: CONFIG, accessToken: 't', mpFetch: mockMpFetch(() => ({}))
    }), /E-mail inválido/);
  });

  it('webhook aprova, dá cargo e grava assinatura (ignora SnapFlow)', async () => {
    const mpFetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ id: 'pay-9', status: 'approved', external_reference: 'caps-vip:g1:u7:vip' })
    });
    const store = mockStore();
    const discordRest = mockDiscordRest();
    const result = await payments.handleMpWebhook(
      { query: { 'data.id': 'pay-9', topic: 'payment' }, body: {}, headers: {} },
      { config: CONFIG, mpFetch, accessToken: 'test-token', discordRest, store }
    );
    assert.equal(result.granted, true);
    assert.ok(discordRest.calls.some((c) => c[0] === 'add' && c[2] === 'u7'));
    const saved = store.saved();
    assert.equal(saved.subscriptions.length, 1);
    assert.equal(saved.subscriptions[0].tierKey, 'vip');
    assert.ok(new Date(saved.subscriptions[0].expiresAt).getTime() > Date.now());
  });

  it('webhook ignora pagamento do SnapFlow e status pendente', async () => {
    const snap = async () => ({
      ok: true, status: 200,
      json: async () => ({ id: 's1', status: 'approved', external_reference: 'sess_abc' })
    });
    const r1 = await payments.handleMpWebhook(
      { query: { 'data.id': 's1', topic: 'payment' }, body: {}, headers: {} },
      { config: CONFIG, mpFetch: snap, accessToken: 'test-token', discordRest: mockDiscordRest(), store: mockStore() }
    );
    assert.equal(r1.handled, false);

    const pend = async () => ({
      ok: true, status: 200,
      json: async () => ({ id: 'p2', status: 'pending', external_reference: 'caps-vip:g1:u7:vip' })
    });
    const r2 = await payments.handleMpWebhook(
      { query: { 'data.id': 'p2', topic: 'payment' }, body: {}, headers: {} },
      { config: CONFIG, mpFetch: pend, accessToken: 'test-token', discordRest: mockDiscordRest(), store: mockStore() }
    );
    assert.equal(r2.granted, false);
  });

  it('webhook não processa o mesmo pagamento 2x', async () => {
    const mpFetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ id: 'pay-d', status: 'approved', external_reference: 'caps-vip:g1:u7:vip' })
    });
    const store = mockStore([{ discordId: 'u7', guildId: 'g1', tierKey: 'vip', paymentId: 'pay-d', status: 'active', startedAt: '', expiresAt: '' }]);
    const discordRest = mockDiscordRest();
    const result = await payments.handleMpWebhook(
      { query: { 'data.id': 'pay-d', topic: 'payment' }, body: {}, headers: {} },
      { config: CONFIG, mpFetch, accessToken: 'test-token', discordRest, store }
    );
    assert.equal(result.granted, false);
    assert.ok(!discordRest.calls.some((c) => c[0] === 'add'));
  });
});
