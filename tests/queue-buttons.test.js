const { describe, it } = require('node:test');
const assert = require('node:assert');

const { QUEUE_JOIN_BUTTON_IDS, buildQueueJoinActionRow, parseQueueJoinButtonId } = require('../utils/lobbyUtils');

describe('painel da fila (botoes)', () => {
  it('parse reconhece entrar classic', () => {
    assert.deepStrictEqual(parseQueueJoinButtonId('queue:classic:join'), { mode: 'classic', args: [] });
    assert.deepStrictEqual(parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.CLASSIC), { mode: 'classic', args: [] });
  });

  it('parse reconhece entrar aram (args p/ fluxo !entrar)', () => {
    assert.deepStrictEqual(parseQueueJoinButtonId('queue:aram:join'), { mode: 'aram', args: ['aram'] });
    assert.deepStrictEqual(parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.ARAM), { mode: 'aram', args: ['aram'] });
  });

  it('parse rejeita ids desconhecidos', () => {
    assert.strictEqual(parseQueueJoinButtonId('queue:x:join'), null);
    assert.strictEqual(parseQueueJoinButtonId('votewin:abc:1'), null);
    assert.strictEqual(parseQueueJoinButtonId('joinqueue:classic'), null);
    assert.strictEqual(parseQueueJoinButtonId('leavequeue'), null);
    assert.strictEqual(parseQueueJoinButtonId(''), null);
    assert.strictEqual(parseQueueJoinButtonId(null), null);
    assert.strictEqual(parseQueueJoinButtonId(undefined), null);
  });

  it('parse reconhece entrar tiers (resolve pelo canal de voz)', () => {
    assert.deepStrictEqual(parseQueueJoinButtonId('queue:tiers:join'), { mode: 'tiers', args: [] });
    assert.deepStrictEqual(parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.TIERS), { mode: 'tiers', args: [] });
  });

  it('action row tem CAPS + ARAM + TIERS + Sair da Fila', () => {
    const row = buildQueueJoinActionRow();
    const json = row.toJSON();
    assert.strictEqual(json.type, 1);
    assert.strictEqual(json.components.length, 4);
    const [classic, aram, tiers, leave] = json.components;
    assert.strictEqual(classic.custom_id, QUEUE_JOIN_BUTTON_IDS.CLASSIC);
    assert.strictEqual(classic.label, 'Entrar Queue CAPS');
    assert.strictEqual(classic.style, 3); // Success
    assert.strictEqual(aram.custom_id, QUEUE_JOIN_BUTTON_IDS.ARAM);
    assert.strictEqual(aram.label, 'Entrar Queue ARAM');
    assert.strictEqual(aram.style, 1); // Primary
    assert.strictEqual(tiers.custom_id, QUEUE_JOIN_BUTTON_IDS.TIERS);
    assert.strictEqual(tiers.label, 'Entrar Queue TIERS');
    assert.strictEqual(tiers.style, 2); // Secondary
    assert.strictEqual(leave.custom_id, QUEUE_JOIN_BUTTON_IDS.LEAVE);
    assert.strictEqual(leave.label, 'Sair da Fila');
    assert.strictEqual(leave.style, 4); // Danger
  });

  it('ids constantes tem os valores esperados', () => {
    assert.strictEqual(QUEUE_JOIN_BUTTON_IDS.CLASSIC, 'queue:classic:join');
    assert.strictEqual(QUEUE_JOIN_BUTTON_IDS.ARAM, 'queue:aram:join');
    assert.strictEqual(QUEUE_JOIN_BUTTON_IDS.TIERS, 'queue:tiers:join');
    assert.strictEqual(QUEUE_JOIN_BUTTON_IDS.LEAVE, 'queue:leave');
  });

  it('parse diferencia classic de aram', () => {
    const classic = parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.CLASSIC);
    const aram = parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.ARAM);
    assert.notStrictEqual(classic.mode, aram.mode);
    assert.deepStrictEqual(classic.args, []);
    assert.deepStrictEqual(aram.args, ['aram']);
  });

  it('parse rejeita prefixo joinqueue: (api antiga inexistente)', () => {
    assert.strictEqual(parseQueueJoinButtonId('joinqueue:lobby:classic:5x5:A'), null);
    assert.strictEqual(parseQueueJoinButtonId('joinqueue:lobby:aram:2x2:B'), null);
  });

  it('parse rejeita lobby com modo/formato invalidos (nao ha botoes por sala)', () => {
    assert.strictEqual(parseQueueJoinButtonId('queue:lobby:valorant:5x5:A'), null);
    assert.strictEqual(parseQueueJoinButtonId('queue:classic:join:extra'), null);
  });

  it('action row e estavel entre chamadas', () => {
    const a = buildQueueJoinActionRow().toJSON();
    const b = buildQueueJoinActionRow().toJSON();
    assert.deepStrictEqual(a, b);
  });

  it('botoes mapeiam para os argumentos do !entrar', () => {
    // classic -> handleEnterCommand(..., []); aram -> handleEnterCommand(..., ['aram'])
    assert.deepStrictEqual(parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.CLASSIC).args, []);
    assert.deepStrictEqual(parseQueueJoinButtonId(QUEUE_JOIN_BUTTON_IDS.ARAM).args, ['aram']);
  });
});
