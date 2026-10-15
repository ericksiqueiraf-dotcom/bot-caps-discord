const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  VIP_TIERS,
  getMemberVipTier,
  getVipSeal,
  buildVipTierResolver,
  buildClubeEmbed,
  buildClubeDetalEmbed,
  isRecentVipSubscription,
  parseLiveLink,
  getLiveCooldownRemainingMs,
  formatCooldownRemaining,
  buildLiveEmbed,
  buildClubePromoEmbed,
  shouldPostClubePromo,
  findPromoChannel
} = require('../utils/lobbyUtils');

function mockMember(roleNames) {
  const cache = new Map(roleNames.map((name, index) => [String(index), { name }]));
  return { roles: { cache } };
}

function mockGuild(membersById = {}, roleCounts = {}) {
  const membersCache = new Map(
    Object.entries(membersById).map(([id, roleNames]) => [id, mockMember(roleNames)])
  );
  const rolesCache = new Map(
    Object.entries(roleCounts).map(([name, size]) => [name, { name, members: { size } }])
  );
  rolesCache.find = (predicate) => {
    for (const role of rolesCache.values()) {
      if (predicate(role)) return role;
    }
    return undefined;
  };
  return { members: { cache: membersCache }, roles: { cache: rolesCache } };
}

describe('clube VIP (status, sem vantagem competitiva)', () => {
  it('getMemberVipTier prioriza o maior tier', () => {
    assert.equal(getMemberVipTier(mockMember(['Jogador'])), null);
    assert.equal(getMemberVipTier(mockMember(['💜 Apoiador'])), '💜 Apoiador');
    assert.equal(getMemberVipTier(mockMember(['💜 Apoiador', '⭐ VIP'])), '⭐ VIP');
    assert.equal(getMemberVipTier(mockMember(['⭐ VIP', '👑 Lendário'])), '👑 Lendário');
    assert.equal(getMemberVipTier(null), null);
  });

  it('getVipSeal retorna o emoji do tier', () => {
    assert.equal(getVipSeal('👑 Lendário'), ' 👑');
    assert.equal(getVipSeal('⭐ VIP'), ' ⭐');
    assert.equal(getVipSeal('💜 Apoiador'), ' 💜');
    assert.equal(getVipSeal('Jogador'), '');
  });

  it('buildVipTierResolver usa o cache sem fetch', () => {
    const guild = mockGuild({ 1: ['⭐ VIP'], 2: ['Jogador'] });
    const resolve = buildVipTierResolver(guild);
    assert.equal(resolve('1'), ' ⭐');
    assert.equal(resolve('2'), '');
    assert.equal(resolve('999'), '');
    assert.equal(buildVipTierResolver(null)('1'), '');
  });

  it('buildClubeEmbed lista tiers, contagens e regra sem vantagem', () => {    const guild = mockGuild({}, { '💜 Apoiador': 3, '⭐ VIP': 0, '👑 Lendário': 1 });
    const embed = buildClubeEmbed(guild);
    const data = embed.toJSON();
    assert.match(data.title, /Clube VIP/);
    assert.match(data.description, /NÃO dá vantagem/);
    const names = data.fields.map((field) => field.name).join(' ');
    for (const tier of VIP_TIERS) {
      assert.ok(names.includes(tier.name), `ficha do ${tier.name}`);
    }
    assert.ok(names.includes('3 membro(s)'));
  });

  it('buildClubeDetalEmbed tem beneficios por tier com precos e limites', () => {
    const embed = buildClubeDetalEmbed();
    const data = embed.toJSON();
    assert.match(data.title, /benefícios detalhados/);
    assert.match(data.description, /NÃO dá vantagem/);
    assert.equal(data.fields.length, 4);
    const text = data.fields.map((f) => `${f.name} ${f.value}`).join('\n');
    assert.ok(text.includes('R$ 9,99'));
    assert.ok(text.includes('R$ 16,90'));
    assert.ok(text.includes('R$ 21,90'));
    assert.ok(text.includes('!salalock'));
    assert.ok(text.includes('!live'));
    assert.ok(JSON.stringify(data).length < 6000);
  });

  it('isRecentVipSubscription evita anúncio duplicado do webhook', () => {
    const now = Date.now();
    const fresh = [{ status: 'active', guildId: 'g1', discordId: 'u1', startedAt: new Date(now - 60 * 1000).toISOString() }];
    const old = [{ status: 'active', guildId: 'g1', discordId: 'u1', startedAt: new Date(now - 3600 * 1000).toISOString() }];
    assert.equal(isRecentVipSubscription(fresh, 'g1', 'u1', now), true);
    assert.equal(isRecentVipSubscription(old, 'g1', 'u1', now), false);
    assert.equal(isRecentVipSubscription(fresh, 'g2', 'u1', now), false);
    assert.equal(isRecentVipSubscription([], 'g1', 'u1', now), false);
  });
});

describe('!live e promo automática', () => {
  it('parseLiveLink aceita só Twitch/YouTube/Kick', () => {
    assert.equal(parseLiveLink('https://twitch.tv/faker').platform, 'Twitch');
    assert.equal(parseLiveLink('https://www.youtube.com/watch?v=x').platform, 'YouTube');
    assert.equal(parseLiveLink('https://youtu.be/x').platform, 'YouTube');
    assert.equal(parseLiveLink('https://kick.com/x').platform, 'Kick');
    assert.equal(parseLiveLink('https://twitch.tv/'), null);
    assert.equal(parseLiveLink('https://evil.com/twitch.tv/x'), null);
    assert.equal(parseLiveLink('nao-link'), null);
    assert.equal(parseLiveLink(''), null);
  });

  it('cooldown do !live por tier (Lendario 6h, VIP 12h, Apoiador 24h)', () => {
    const { LIVE_COOLDOWN_BY_TIER_MS } = require('../commands/legacyCommands');
    assert.equal(LIVE_COOLDOWN_BY_TIER_MS['👑 Lendário'], 6 * 3600000);
    assert.equal(LIVE_COOLDOWN_BY_TIER_MS['⭐ VIP'], 12 * 3600000);
    assert.equal(LIVE_COOLDOWN_BY_TIER_MS['💜 Apoiador'], 24 * 3600000);
    assert.equal(LIVE_COOLDOWN_BY_TIER_MS['Jogador'], undefined);
  });

  it('cooldown de 6h com formatacao', () => {
    const now = Date.now();
    assert.equal(getLiveCooldownRemainingMs(null, now), 0);
    assert.ok(getLiveCooldownRemainingMs(now, now) > 5 * 3600 * 1000);
    assert.equal(getLiveCooldownRemainingMs(now - 7 * 3600 * 1000, now), 0);
    assert.equal(formatCooldownRemaining(30 * 60000), '30min');
    assert.equal(formatCooldownRemaining(6 * 3600000), '6h');
  });

  it('buildLiveEmbed e promo respeitam limites', () => {
    const live = buildLiveEmbed({ memberMention: '<@1>', url: 'https://twitch.tv/x', platform: 'Twitch' }).toJSON();
    assert.match(live.title, /AO VIVO/);
    const promo = buildClubePromoEmbed({ clubePagamentos: { apoiador: { preco: 9.99 } } }).toJSON();
    assert.match(promo.title, /Clube VIP/);
    assert.ok(JSON.stringify(promo).length < 6000);
  });

  it('shouldPostClubePromo com intervalo mínimo de 10h', () => {
    const now = Date.now();
    assert.equal(shouldPostClubePromo(null, now), true);
    assert.equal(shouldPostClubePromo(new Date(now - 3600 * 1000).toISOString(), now), false);
    assert.equal(shouldPostClubePromo(new Date(now - 11 * 3600 * 1000).toISOString(), now), true);
  });

  it('findPromoChannel acha o geral', () => {
    const text = (name) => ({ name, isTextBased: () => true });
    const guild = { channels: { cache: new Map([['1', text('🤖・comandos')], ['2', text('💬・geral-leagueoflegends')]]) } };
    guild.channels.cache.values = function* () { yield* [...Map.prototype.values.call(this)]; };
    const found = findPromoChannel(guild);
    assert.equal(found?.name, '💬・geral-leagueoflegends');
    assert.equal(findPromoChannel({ channels: { cache: new Map() } }), null);
  });
});
