const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  LCL_TEAM_SIZE,
  LCL_QUEUE_BUTTON_IDS,
  buildLclQueueActionRow,
  parseLclQueueButtonId,
  addLclPresence,
  removeLclPresence,
  getLclGuildPresence,
  buildLclQueueEmbed
} = require('../utils/lobbyUtils');

describe('fila clandestina LCL (botoes + presenca)', () => {
  it('parse reconhece entrar e sair, rejeita desconhecidos', () => {
    assert.deepStrictEqual(parseLclQueueButtonId('lclqueue:join'), { action: 'join' });
    assert.deepStrictEqual(parseLclQueueButtonId('lclqueue:leave'), { action: 'leave' });
    assert.strictEqual(parseLclQueueButtonId('joinqueue:classic'), null);
    assert.strictEqual(parseLclQueueButtonId('lclqueue:join:extra'), null);
    assert.strictEqual(parseLclQueueButtonId(''), null);
    assert.strictEqual(parseLclQueueButtonId(null), null);
  });

  it('action row tem Entrar Queue LCL + Sair Queue LCL', () => {
    const row = buildLclQueueActionRow();
    const json = row.toJSON();
    assert.strictEqual(json.type, 1);
    assert.strictEqual(json.components.length, 2);
    const [join, leave] = json.components;
    assert.strictEqual(join.custom_id, LCL_QUEUE_BUTTON_IDS.JOIN);
    assert.strictEqual(join.label, 'Entrar Queue LCL');
    assert.strictEqual(join.style, 3); // Success
    assert.strictEqual(leave.custom_id, LCL_QUEUE_BUTTON_IDS.LEAVE);
    assert.strictEqual(leave.label, 'Sair Queue LCL');
    assert.strictEqual(leave.style, 4); // Danger
  });

  it('presenca: adiciona uma vez (idempotente por guild)', () => {
    const first = addLclPresence([], { discordId: 'u1', username: 'Ana', guildId: 'g1' });
    assert.strictEqual(first.added, true);
    assert.strictEqual(first.players.length, 1);
    const again = addLclPresence(first.players, { discordId: 'u1', username: 'Ana', guildId: 'g1' });
    assert.strictEqual(again.already, true);
    assert.strictEqual(again.players.length, 1);
    // mesma pessoa em outra guild entra separado
    const other = addLclPresence(again.players, { discordId: 'u1', username: 'Ana', guildId: 'g2' });
    assert.strictEqual(other.added, true);
    assert.strictEqual(other.players.length, 2);
  });

  it('presenca: remove so da guild certa', () => {
    const base = [
      { discordId: 'u1', username: 'Ana', guildId: 'g1', joinedAt: '2026-10-13T00:00:00.000Z' },
      { discordId: 'u1', username: 'Ana', guildId: 'g2', joinedAt: '2026-10-13T00:00:00.000Z' }
    ];
    const out = removeLclPresence(base, 'u1', 'g1');
    assert.strictEqual(out.removed, true);
    assert.deepStrictEqual(getLclGuildPresence(out.players, 'g1'), []);
    assert.strictEqual(getLclGuildPresence(out.players, 'g2').length, 1);
    const miss = removeLclPresence(out.players, 'u9', 'g2');
    assert.strictEqual(miss.removed, false);
  });

  it('embed mostra X/5 e chama o capitao com time fechado', () => {
    assert.strictEqual(LCL_TEAM_SIZE, 5);
    const empty = buildLclQueueEmbed([]).toJSON();
    assert.match(empty.description, /0\/5/);
    const full = buildLclQueueEmbed(
      Array.from({ length: 5 }, (_, i) => ({ discordId: `u${i}`, username: `P${i}`, guildId: 'g1' }))
    ).toJSON();
    assert.match(full.description, /5\/5/);
    assert.ok(full.fields.some((f) => /Time fechado/.test(f.name) && /!desafiar/.test(f.value)));
  });
});
