// Deteccao da custom com conta ancora (Capitao / Staff / Admin).
// Uma unica conta ancora dentro da partida basta para achar a custom.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const axiosPath = require.resolve('axios');
const realCreate = require(axiosPath).create;

const config = require('../config.json');
const {
  getAnchorRoleIds,
  isAnchorMember,
  markAnchorPlayers
} = require('../application/use-cases/publishMatchStats');

function freshRiot() {
  Object.keys(require.cache)
    .filter((k) => k.endsWith('services/riotService.js'))
    .forEach((k) => delete require.cache[k]);
  return require('../services/riotService');
}

function memberWith({ roleIds = [], admin = false } = {}) {
  return {
    permissions: { has: (permission) => admin && permission === 'Administrator' },
    roles: { cache: new Map(roleIds.map((id) => [id, { id }])) }
  };
}

describe('ancoras: cargos Capitao / Staff / Admin', () => {
  it('getAnchorRoleIds inclui a config e o captainRoleId', () => {
    const ids = getAnchorRoleIds();
    assert.ok(ids.includes('1487816787666931732'), 'Admin');
    assert.ok(ids.includes('1487817903561773137'), 'Staff');
    assert.ok(ids.includes(String(config.roles.captainRoleId)), 'Capitao');
  });

  it('reconhece Admin, Staff e Capitao pelos cargos', () => {
    assert.equal(isAnchorMember(memberWith({ roleIds: ['1487816787666931732'] })), true);
    assert.equal(isAnchorMember(memberWith({ roleIds: ['1487817903561773137'] })), true);
    assert.equal(isAnchorMember(memberWith({ roleIds: [String(config.roles.captainRoleId)] })), true);
  });

  it('reconhece quem tem permissao de Administrator', () => {
    assert.equal(isAnchorMember(memberWith({ admin: true })), true);
  });

  it('nao marca jogador comum nem membro ausente', () => {
    assert.equal(isAnchorMember(memberWith({ roleIds: ['999'] })), false);
    assert.equal(isAnchorMember(null), false);
  });

  it('markAnchorPlayers marca so quem tem cargo ancora', async () => {
    const members = new Map([
      ['u-admin', memberWith({ roleIds: ['1487816787666931732'] })],
      ['u-staff', memberWith({ roleIds: ['1487817903561773137'] })],
      ['u-comum', memberWith({ roleIds: ['123'] })]
    ]);
    const guild = {
      members: {
        cache: members,
        fetch: async (id) => members.get(id) || null
      }
    };
    const groups = [
      { discordId: 'u-admin', puuids: ['a'] },
      { discordId: 'u-staff', puuids: ['b'] },
      { discordId: 'u-comum', puuids: ['c'] },
      { discordId: 'u-fora', puuids: ['d'] }
    ];

    await markAnchorPlayers(guild, groups);

    assert.equal(groups[0].isAnchor, true);
    assert.equal(groups[1].isAnchor, true);
    assert.equal(groups[2].isAnchor, false);
    assert.equal(groups[3].isAnchor, false);
  });
});

describe('busca da custom aceitando conta ancora', () => {
  let history;
  let matches;

  beforeEach(() => {
    history = {};
    matches = {};
    require(axiosPath).create = () => ({
      get: async (url) => {
        if (url.includes('/matches/by-puuid/')) {
          const puuid = decodeURIComponent(url.split('/matches/by-puuid/')[1].split('/ids')[0]);
          return { data: history[puuid] || [] };
        }
        if (url.includes('/matches/')) {
          const id = decodeURIComponent(url.split('/matches/')[1].split('?')[0]);
          if (!matches[id]) {
            const error = new Error('not found');
            error.response = { status: 404 };
            throw error;
          }
          return { data: matches[id] };
        }
        return { data: [] };
      }
    });
  });

  afterEach(() => {
    require(axiosPath).create = realCreate;
    freshRiot();
  });

  function customMatch(puuids) {
    return {
      info: {
        queueId: 0,
        gameStartTimestamp: Date.now(),
        participants: puuids.map((puuid) => ({ puuid }))
      }
    };
  }

  it('com UMA conta ancora encontra a custom', async () => {
    history = { anchor: ['BR1_1'] };
    matches = { BR1_1: customMatch(['anchor', 'x1', 'x2']) };

    const service = freshRiot().createRiotService('key', 'br1');
    const found = await service.findCustomMatchByPuuids({
      playerGroups: [{ puuids: ['anchor'], isAnchor: true }],
      startTimeMs: Date.now()
    });

    assert.ok(found, 'deveria achar a custom com 1 ancora');
    assert.equal(found.info.queueId, 0);
  });

  it('sem ancora, uma conta sozinha nao basta (exige 3+)', async () => {
    history = { solo: ['BR1_1'] };
    matches = { BR1_1: customMatch(['solo']) };

    const service = freshRiot().createRiotService('key', 'br1');
    const found = await service.findCustomMatchByPuuids({
      playerGroups: [{ puuids: ['solo'], isAnchor: false }],
      startTimeMs: Date.now()
    });

    assert.equal(found, null);
  });

  it('nao aceita partida que nao e custom (queueId != 0)', async () => {
    history = { anchor: ['BR1_1'] };
    const ranked = customMatch(['anchor']);
    ranked.info.queueId = 420;
    matches = { BR1_1: ranked };

    const service = freshRiot().createRiotService('key', 'br1');
    const found = await service.findCustomMatchByPuuids({
      playerGroups: [{ puuids: ['anchor'], isAnchor: true }],
      startTimeMs: Date.now()
    });

    assert.equal(found, null);
  });

  it('nao aceita quando a ancora nao esta na partida', async () => {
    history = { anchor: ['BR1_1'], other: ['BR1_1'] };
    matches = { BR1_1: customMatch(['other', 'x1', 'x2']) };

    const service = freshRiot().createRiotService('key', 'br1');
    const found = await service.findCustomMatchByPuuids({
      playerGroups: [
        { puuids: ['anchor'], isAnchor: true },
        { puuids: ['other'], isAnchor: false }
      ],
      startTimeMs: Date.now()
    });

    assert.equal(found, null);
  });

  it('sem ancora, aceita quando 3 contas conhecidas estao na partida', async () => {
    history = { a: ['BR1_1'], b: ['BR1_1'], c: ['BR1_1'] };
    matches = { BR1_1: customMatch(['a', 'b', 'c', 'x1']) };

    const service = freshRiot().createRiotService('key', 'br1');
    const found = await service.findCustomMatchByPuuids({
      playerGroups: [
        { puuids: ['a'], isAnchor: false },
        { puuids: ['b'], isAnchor: false },
        { puuids: ['c'], isAnchor: false }
      ],
      startTimeMs: Date.now()
    });

    assert.ok(found);
  });
});
