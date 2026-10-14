// Pagamentos PIX do clube VIP via Mercado Pago (fase 1: só PIX).
//
// Fluxo: !clube -> botão do tier -> modal de e-mail -> POST /v1/payments (pix)
//   -> QR + copia-e-cola -> webhook /webhooks/mercadopago -> cargo automático.
// Expiração: expireVipSubscriptionsForGuild() roda no scheduler diário do bot.
//
// Tudo que toca rede é injetável (mpFetch/discordFetch/store) para testes.
const crypto = require('crypto');

const MP_API_BASE = 'https://api.mercadopago.com';

const TIER_ROLE_NAMES = {
  apoiador: '💜 Apoiador',
  vip: '⭐ VIP',
  lendario: '👑 Lendário'
};
const TIER_KEYS = Object.keys(TIER_ROLE_NAMES);
const DEFAULT_PRICES = {
  apoiador: { preco: 9.99, dias: 30 },
  vip: { preco: 19.99, dias: 30 },
  lendario: { preco: 29.99, dias: 30 }
};
const PIX_EXPIRY_MINUTES = 30;

function getClubeTierConfig(config, tierKey) {
  if (!TIER_KEYS.includes(tierKey)) return null;
  const fromConfig = config?.clubePagamentos?.[tierKey] || {};
  const preco = Number(fromConfig.preco ?? DEFAULT_PRICES[tierKey].preco);
  const dias = Number(fromConfig.dias ?? DEFAULT_PRICES[tierKey].dias);
  if (!Number.isFinite(preco) || preco <= 0 || !Number.isFinite(dias) || dias <= 0) return null;
  return { key: tierKey, roleName: TIER_ROLE_NAMES[tierKey], preco, dias };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

function buildExternalReference(guildId, discordId, tierKey) {
  return `caps-vip:${guildId}:${discordId}:${tierKey}`;
}

// Só aceita referências do clube (ignora pagamentos do SnapFlow no mesmo webhook).
function parseVipReference(ref) {
  const parts = String(ref || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'caps-vip') return null;
  const [, guildId, discordId, tierKey] = parts;
  if (!guildId || !discordId || !TIER_KEYS.includes(tierKey)) return null;
  return { guildId, discordId, tierKey };
}

function pixExpiryIso(nowMs = Date.now()) {
  return new Date(nowMs + PIX_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

async function createVipPixPayment({
  tierKey, email, discordId, guildId, config,
  accessToken = process.env.MP_ACCESS_TOKEN,
  publicBaseUrl = process.env.PUBLIC_BASE_URL,
  mpFetch = fetch,
  nowMs = Date.now()
}) {
  const tier = getClubeTierConfig(config, tierKey);
  if (!tier) throw new Error(`Tier inválido: ${tierKey}.`);
  const cleanEmail = String(email || '').trim();
  if (!isValidEmail(cleanEmail)) throw new Error('E-mail inválido para gerar o PIX.');
  if (!accessToken || String(accessToken).includes('your-mercado-pago-token')) {
    throw new Error('MP_ACCESS_TOKEN não configurado.');
  }

  const externalReference = buildExternalReference(guildId, discordId, tierKey);
  const body = {
    transaction_amount: tier.preco,
    payment_method_id: 'pix',
    description: `CAPS Arena - ${tier.roleName} (${tier.dias} dias)`,
    payer: { email: cleanEmail },
    external_reference: externalReference,
    date_of_expiration: pixExpiryIso(nowMs)
  };
  if (publicBaseUrl) body.notification_url = `${String(publicBaseUrl).replace(/\/$/, '')}/webhooks/mercadopago`;

  const response = await mpFetch(`${MP_API_BASE}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': externalReference
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Mercado Pago recusou: ${data?.message || response.status}.`);
  }
  const tx = data?.point_of_interaction?.transaction_data || {};
  return {
    paymentId: String(data?.id || ''),
    status: String(data?.status || ''),
    amount: tier.preco,
    tier,
    qrCode: tx.qr_code || '',
    qrCodeBase64: tx.qr_code_base64 || '',
    ticketUrl: tx.ticket_url || '',
    expiresAt: pixExpiryIso(nowMs)
  };
}

async function fetchMpPayment(paymentId, { accessToken = process.env.MP_ACCESS_TOKEN, mpFetch = fetch } = {}) {
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado.');
  const response = await mpFetch(`${MP_API_BASE}/v1/payments/${encodeURIComponent(String(paymentId))}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Falha ao consultar pagamento: ${response.status}.`);
  return data;
}

// Assinatura x-signature do MP (opcional: exige MP_WEBHOOK_SECRET).
function verifyMpSignature({ query = {}, headers = {} }, secret = process.env.MP_WEBHOOK_SECRET) {
  if (!secret) return { checked: false, valid: true };
  const get = (name) => headers?.[name] ?? headers?.[String(name).toLowerCase()];
  const parts = String(get('x-signature') || '').split(',').map((p) => p.trim().split('='));
  const parsed = {};
  for (const [key, value] of parts) if (key && value) parsed[key] = value;
  const pieces = [];
  const dataId = query?.['data.id'];
  if (dataId) pieces.push(`id:${dataId};`);
  const requestId = get('x-request-id');
  if (requestId) pieces.push(`request-id:${requestId};`);
  if (parsed.ts) pieces.push(`ts:${parsed.ts};`);
  const expected = crypto.createHmac('sha256', secret).update(pieces.join('')).digest('hex');
  const left = Buffer.from(String(parsed.v1 || ''));
  const right = Buffer.from(expected);
  const valid = left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
  return { checked: true, valid };
}

// ─── Discord REST (usado pelo webhook, que roda sem gateway) ─────────────────
function createDiscordRest({ discordToken = process.env.DISCORD_TOKEN, discordFetch = fetch } = {}) {
  async function call(path, { method = 'GET', body } = {}) {
    if (!discordToken) throw new Error('DISCORD_TOKEN não configurado.');
    const response = await discordFetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${discordToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Discord API ${response.status} em ${method} ${path}.`);
    return data;
  }

  return {
    findRoleIdByName: async (guildId, roleName) => {
      const roles = await call(`/guilds/${guildId}/roles`);
      const role = (Array.isArray(roles) ? roles : []).find((r) => String(r?.name || '') === roleName);
      return role ? String(role.id) : null;
    },
    addMemberRole: (guildId, userId, roleId) => call(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'PUT' }),
    removeMemberRole: (guildId, userId, roleId) => call(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'DELETE' }),
    sendChannelMessage: (channelId, content) => call(`/channels/${channelId}/messages`, { method: 'POST', body: { content } }),
    findTextChannelIdByName: async (guildId, name) => {
      const channels = await call(`/guilds/${guildId}/channels`);
      const channel = (Array.isArray(channels) ? channels : []).find((c) => String(c?.name || '') === name && [0, 5].includes(c?.type));
      return channel ? String(channel.id) : null;
    },
    sendDm: async (userId, content) => {
      const dm = await call('/users/@me/channels', { method: 'POST', body: { recipient_id: String(userId) } });
      if (!dm?.id) throw new Error('Não foi possível abrir DM.');
      return call(`/channels/${dm.id}/messages`, { method: 'POST', body: { content } });
    }
  };
}

// Processa o webhook do MP. Retorna sempre 200 p/ o MP (com retry só em erro real).
async function handleMpWebhook(
  { query = {}, body = {}, headers = {} } = {},
  {
    config,
    mpFetch = fetch,
    accessToken = process.env.MP_ACCESS_TOKEN,
    discordRest = createDiscordRest(),
    store = null,
    nowMs = Date.now()
  } = {}
) {
  const topic = String(query?.topic || query?.type || body?.type || '');
  const dataId = String(query?.['data.id'] || body?.data?.id || body?.id || '');
  if (topic && topic !== 'payment') return { handled: false, reason: 'topic ignorado' };
  if (!dataId) return { handled: false, reason: 'sem data.id' };

  const signature = verifyMpSignature({ query, headers });
  if (signature.checked && !signature.valid) {
    throw new Error('Assinatura de webhook inválida.');
  }

  const payment = await fetchMpPayment(dataId, { accessToken, mpFetch });
  if (String(payment?.status || '') !== 'approved') {
    return { handled: true, granted: false, reason: `status ${payment?.status}` };
  }
  return finalizeApprovedVipPayment(payment, { config, discordRest, store, nowMs });
}

// Núcleo comum: pagamento aprovado (via webhook OU polling) -> cargo + registro.
// Idempotente por paymentId.
async function finalizeApprovedVipPayment(
  payment,
  { config, discordRest = createDiscordRest(), store = null, nowMs = Date.now() } = {}
) {
  const ref = parseVipReference(payment?.external_reference);
  if (!ref) return { handled: false, reason: 'não é pagamento do clube' };

  const tier = getClubeTierConfig(config, ref.tierKey);
  if (!tier) return { handled: true, granted: false, reason: 'tier desconhecido' };

  const storeApi = store || require('./dataService');
  const { subscriptions } = await storeApi.loadVipSubscriptions();
  if (subscriptions.some((s) => String(s?.paymentId || '') === String(payment.id) && s?.status === 'active')) {
    return { handled: true, granted: false, reason: 'pagamento já processado' };
  }

  const roleId = await discordRest.findRoleIdByName(ref.guildId, tier.roleName);
  if (!roleId) throw new Error(`Cargo ${tier.roleName} não encontrado no servidor.`);
  await discordRest.addMemberRole(ref.guildId, ref.discordId, roleId);

  const startedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + tier.dias * 24 * 60 * 60 * 1000).toISOString();
  const kept = subscriptions.filter((s) => {
    if (String(s?.paymentId || '') === String(payment.id)) return false;
    if (String(s?.discordId) === ref.discordId && String(s?.guildId) === ref.guildId && s?.status === 'active') return false;
    return true;
  });
  kept.push({ discordId: ref.discordId, guildId: ref.guildId, tierKey: ref.tierKey, paymentId: String(payment.id), status: 'active', startedAt, expiresAt });
  await storeApi.saveVipSubscriptions({ subscriptions: kept });

  const mention = `<@${ref.discordId}>`;
  await discordRest.sendDm(ref.discordId, `💎 Pagamento confirmado! Você agora é **${tier.roleName}** na CAPS Arena por ${tier.dias} dias. Obrigado por apoiar!`).catch(() => null);
  const channelId = await discordRest.findTextChannelIdByName(ref.guildId, '👑┃parceiros').catch(() => null);
  if (channelId) {
    await discordRest.sendChannelMessage(channelId, `🎉 ${mention} agora faz parte do **${tier.roleName}**! Bem-vindo(a) ao clube 💎`).catch(() => null);
  }
  return { handled: true, granted: true, tierKey: ref.tierKey, discordId: ref.discordId, expiresAt };
}

// Registra a intenção de pagamento (poller acompanha até aprovar/expirar).
async function recordPendingPayment(
  { paymentId, guildId, discordId, tierKey, pixExpiresAt },
  { store = null } = {}
) {
  const storeApi = store || require('./dataService');
  const { subscriptions } = await storeApi.loadVipSubscriptions();
  const kept = subscriptions.filter((s) => String(s?.paymentId || '') !== String(paymentId));
  kept.push({
    discordId: String(discordId), guildId: String(guildId), tierKey,
    paymentId: String(paymentId), status: 'pending',
    startedAt: new Date().toISOString(), pixExpiresAt: pixExpiresAt || null
  });
  await storeApi.saveVipSubscriptions({ subscriptions: kept });
}

// Polling (fallback do webhook; permite operar sem URL pública).
// Consulta pagamentos pendentes e finaliza os aprovados.
async function pollPendingVipPayments(
  {
    config,
    mpFetch = fetch,
    accessToken = process.env.MP_ACCESS_TOKEN,
    discordRest = createDiscordRest(),
    store = null,
    nowMs = Date.now()
  } = {}
) {
  if (!accessToken) return { checked: 0, granted: [], reason: 'sem token' };
  const storeApi = store || require('./dataService');
  const { subscriptions } = await storeApi.loadVipSubscriptions();
  const pending = subscriptions.filter((s) => s?.status === 'pending');
  const granted = [];
  const expiredIds = new Set();
  for (const sub of pending) {
    if (sub?.pixExpiresAt && new Date(sub.pixExpiresAt).getTime() <= nowMs) {
      expiredIds.add(String(sub.paymentId));
      continue;
    }
    try {
      const payment = await fetchMpPayment(sub.paymentId, { accessToken, mpFetch });
      if (String(payment?.status || '') === 'approved') {
        const result = await finalizeApprovedVipPayment(payment, { config, discordRest, store: storeApi, nowMs });
        if (result.granted) granted.push(result);
      }
    } catch { /* tenta na próxima rodada */ }
  }
  if (expiredIds.size) {
    const fresh = await storeApi.loadVipSubscriptions();
    let changed = false;
    for (const sub of fresh.subscriptions) {
      if (sub?.status === 'pending' && expiredIds.has(String(sub?.paymentId))) {
        sub.status = 'expired';
        changed = true;
      }
    }
    if (changed) await storeApi.saveVipSubscriptions(fresh);
  }
  return { checked: pending.length, granted };
}

// Versão do discordRest sobre o gateway (para o poller rodar dentro do bot).
function createGatewayDiscordRest(client) {
  return {
    findRoleIdByName: async (guildId, roleName) => {
      const guild = client?.guilds?.cache?.get?.(String(guildId)) || await client?.guilds?.fetch?.(String(guildId)).catch(() => null);
      const role = guild?.roles?.cache?.find?.((r) => String(r?.name || '') === roleName);
      return role ? String(role.id) : null;
    },
    addMemberRole: async (guildId, userId, roleId) => {
      const guild = client?.guilds?.cache?.get?.(String(guildId)) || await client?.guilds?.fetch?.(String(guildId)).catch(() => null);
      const member = await guild?.members?.fetch?.(String(userId)).catch(() => null);
      if (!member) throw new Error('Membro não encontrado.');
      await member.roles.add(roleId, 'Clube VIP: pagamento aprovado');
    },
    removeMemberRole: async () => null,
    sendChannelMessage: async (channelId, content) => {
      const channel = client?.channels?.cache?.get?.(String(channelId)) || await client?.channels?.fetch?.(String(channelId)).catch(() => null);
      if (!channel?.isTextBased?.()) throw new Error('Canal indisponível.');
      return channel.send(content);
    },
    findTextChannelIdByName: async (guildId, name) => {
      const guild = client?.guilds?.cache?.get?.(String(guildId)) || await client?.guilds?.fetch?.(String(guildId)).catch(() => null);
      const channel = guild?.channels?.cache?.find?.((c) => String(c?.name || '') === name && c?.isTextBased?.());
      return channel ? String(channel.id) : null;
    },
    sendDm: async (userId, content) => {
      const user = await client?.users?.fetch?.(String(userId)).catch(() => null);
      if (!user) throw new Error('Usuário indisponível para DM.');
      return user.send(content);
    }
  };
}

function startVipPaymentPoller({ intervalMs = 3 * 60 * 1000, config = null } = {}) {
  if (!process.env.MP_ACCESS_TOKEN) {
    console.log('[CLUBE] Poller de pagamentos desativado (sem MP_ACCESS_TOKEN).');
    return null;
  }
  const timer = setInterval(async () => {
    try {
      const client = global.discordClient;
      if (!client) return;
      const result = await pollPendingVipPayments({
        config: config || require('../config.json'),
        discordRest: createGatewayDiscordRest(client)
      });
      if (result.granted?.length) console.log(`[CLUBE] Poller liberou ${result.granted.length} assinatura(s).`);
    } catch (err) {
      console.error('[CLUBE] Erro no poller de pagamentos:', err.message);
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

// Expira assinaturas vencidas (roda no bot, com objetos discord.js).
async function expireVipSubscriptionsForGuild(guild, { store = null, nowMs = Date.now() } = {}) {
  const storeApi = store || require('./dataService');
  const { subscriptions } = await storeApi.loadVipSubscriptions();
  const expired = [];
  let changed = false;
  for (const sub of subscriptions) {
    if (sub?.status !== 'active') continue;
    if (String(sub?.guildId || '') !== String(guild?.id || '')) continue;
    if (new Date(sub.expiresAt).getTime() > nowMs) continue;
    const tier = getClubeTierConfig(null, sub.tierKey) || { roleName: TIER_ROLE_NAMES[sub.tierKey] };
    if (!tier?.roleName) continue;
    try {
      const role = guild.roles.cache.find((r) => String(r?.name || '') === tier.roleName);
      const member = await guild.members.fetch(String(sub.discordId)).catch(() => null);
      if (role && member?.roles?.cache?.has(role.id)) {
        await member.roles.remove(role.id, 'Clube VIP expirado').catch(() => null);
      }
      sub.status = 'expired';
      changed = true;
      expired.push(sub);
      await member?.send(`💎 Sua assinatura **${tier.roleName}** na CAPS Arena expirou. Renove com \`!clube\` para manter os benefícios!`).catch(() => null);
    } catch { /* segue para a próxima */ }
  }
  if (changed) await storeApi.saveVipSubscriptions({ subscriptions });
  return expired;
}

module.exports = {
  TIER_KEYS,
  TIER_ROLE_NAMES,
  DEFAULT_PRICES,
  PIX_EXPIRY_MINUTES,
  getClubeTierConfig,
  isValidEmail,
  buildExternalReference,
  parseVipReference,
  pixExpiryIso,
  createVipPixPayment,
  fetchMpPayment,
  verifyMpSignature,
  createDiscordRest,
  handleMpWebhook,
  finalizeApprovedVipPayment,
  recordPendingPayment,
  pollPendingVipPayments,
  createGatewayDiscordRest,
  startVipPaymentPoller,
  expireVipSubscriptionsForGuild
};
