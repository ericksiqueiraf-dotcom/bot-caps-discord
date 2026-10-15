const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// O codigo le o config global (utils/lobbyUtils -> require('../config.json')),
// e o config real atual NAO tem roles.rankRoleIds. Para testar a via por ID
// sem depender de IDs mutaveis do config real, injetamos IDs fake em memoria
// (nao altera config.json em disco; node --test isola por processo/arquivo).
const config = require('../config.json');
config.roles = config.roles || {};
const hadOwnRankRoleIds = Object.prototype.hasOwnProperty.call(config.roles, 'rankRoleIds');
const originalRankRoleIds = config.roles.rankRoleIds;
const FAKE_PRATA_ID = 'id-prata-fake';
config.roles.rankRoleIds = { Prata: FAKE_PRATA_ID };

after(() => {
  if (hadOwnRankRoleIds) config.roles.rankRoleIds = originalRankRoleIds;
  else delete config.roles.rankRoleIds;
});

const {
  findRankRole,
  isRankRole,
  getConfiguredRankRoleId
} = require('../utils/lobbyUtils');

// Guild fake: roles com nome "estranho" (quebra o match por nome) mas ID certo no config.
function fakeGuild(roles) {
  const list = roles.map((r, i) => ({ id: r.id || `id-${i}`, name: r.name, position: r.position ?? 1 }));
  return {
    roles: {
      cache: {
        get: (id) => list.find((r) => r.id === id) || null,
        find: (fn) => list.find(fn) || null
      }
    }
  };
}

describe('cargo de elo por ID (rankRoleIds)', () => {
  it('getConfiguredRankRoleId le o ID injetado (via por ID)', () => {
    assert.equal(getConfiguredRankRoleId('Prata'), FAKE_PRATA_ID);
    assert.equal(getConfiguredRankRoleId('Ouro'), null);
  });

  it('findRankRole acha o Prata pelo ID mesmo com nome fora do padrao', () => {
    const guild = fakeGuild([
      { id: FAKE_PRATA_ID, name: 'Nome Totalmente Diferente' },
      { id: 'x-ouro', name: '🥇Ouro' }
    ]);
    const role = findRankRole(guild, 'Prata');
    assert.ok(role, 'deveria achar o cargo');
    assert.equal(role.id, FAKE_PRATA_ID);
  });

  it('findRankRole cai no match por nome quando nao ha ID configurado', () => {
    const guild = fakeGuild([{ id: 'x-ouro', name: '🥇Ouro' }]);
    const role = findRankRole(guild, 'Ouro');
    assert.ok(role);
    assert.equal(role.id, 'x-ouro');
  });

  it('findRankRole retorna nulo quando nao existe', () => {
    const guild = fakeGuild([{ id: 'x-ouro', name: '🥇Ouro' }]);
    assert.equal(findRankRole(guild, 'Ferro'), null);
  });

  it('isRankRole reconhece o cargo fixado por ID', () => {
    assert.equal(isRankRole({ id: FAKE_PRATA_ID, name: 'Qualquer Nome' }), true);
    assert.equal(isRankRole({ id: 'x-ouro', name: '🥇Ouro' }), true);
    assert.equal(isRankRole({ id: 'x-nada', name: 'Cargo Qualquer' }), false);
    assert.equal(isRankRole(null), false);
  });
});
