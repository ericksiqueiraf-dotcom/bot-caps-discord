// Modo exclusivo do bot LCL: apenas desafio + rank + utilidades.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isInterOnlyMode, isInterCommand, INTER_ONLY_REPLY } = require('../commands/interOnly');

describe('lcl: capitao da liga por nome', () => {
  const { isCapitaoOuStaff } = require('../commands/handlers/interCommandHandlers');

  function memberWithRoles(names = [], perms = []) {
    return {
      permissions: { has: (p) => perms.includes(p) },
      roles: { cache: new Map(names.map((n, i) => [`r${i}`, { id: `r${i}`, name: n }])) }
    };
  }

  it('cargo Capitão LCL libera sem ID configurado', () => {
    assert.strictEqual(isCapitaoOuStaff(memberWithRoles(['Capitão LCL']), {}), true);
    assert.strictEqual(isCapitaoOuStaff(memberWithRoles(['capitão lcl']), {}), true);
    assert.strictEqual(isCapitaoOuStaff(memberWithRoles(['Membro']), {}), false);
    assert.strictEqual(isCapitaoOuStaff(null, {}), false);
  });
});
describe('lcl: modo exclusivo inter', () => {
  it('libera desafio, rank e utilidades; barra fila interna', () => {
    for (const cmd of ['desafiar', 'desafiar-cancelar', 'resultado-inter', 'wo', 'wo-inter', 'inter-ranking', 'inter-historico', 'ping', 'ajuda', 'regras']) {
      assert.strictEqual(isInterCommand(cmd), true, cmd);
    }
    for (const cmd of ['entrar', 'start', 'vitoria', 'votar', 'fila', 'lista', 'sair', 'placar', 'top10', 'reset', 'roleta', 'convidar']) {
      assert.strictEqual(isInterCommand(cmd), false, cmd);
    }
    assert.ok(INTER_ONLY_REPLY.includes('!desafiar'));
  });

  it('flag INTER_ONLY liga/desliga', () => {
    const prev = process.env.INTER_ONLY;
    process.env.INTER_ONLY = '1';
    assert.strictEqual(isInterOnlyMode(), true);
    process.env.INTER_ONLY = '0';
    assert.strictEqual(isInterOnlyMode(), false);
    if (prev === undefined) delete process.env.INTER_ONLY;
    else process.env.INTER_ONLY = prev;
  });
});
