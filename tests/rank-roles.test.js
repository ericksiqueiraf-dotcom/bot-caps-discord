const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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
  it('config tem o ID do Prata', () => {
    assert.equal(getConfiguredRankRoleId('Prata'), '1552537451388608602');
  });

  it('findRankRole acha o Prata pelo ID mesmo com nome fora do padrao', () => {
    const guild = fakeGuild([
      { id: '1552537451388608602', name: '🥈 Prata Diferente' },
      { id: 'x-ouro', name: '🥇Ouro' }
    ]);
    const role = findRankRole(guild, 'Prata');
    assert.ok(role, 'deveria achar o cargo');
    assert.equal(role.id, '1552537451388608602');
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
    assert.equal(isRankRole({ id: '1552537451388608602', name: 'Qualquer Nome' }), true);
    assert.equal(isRankRole({ id: 'x-ouro', name: '🥇Ouro' }), true);
    assert.equal(isRankRole({ id: 'x-nada', name: 'Cargo Qualquer' }), false);
    assert.equal(isRankRole(null), false);
  });
});
