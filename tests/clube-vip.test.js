const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  VIP_TIERS,
  getMemberVipTier,
  getVipSeal,
  buildVipTierResolver,
  buildClubeEmbed,
  isRecentVipSubscription
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
