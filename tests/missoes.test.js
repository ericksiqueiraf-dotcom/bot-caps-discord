const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const missoes = require('../services/missoesService');

describe('missões semanais', () => {
  it('conta jogos/vitorias e completa 1x cada', () => {
    const systemMeta = {};
    const store = missoes.ensureMissionsStore(systemMeta);
    assert.equal(store.week, missoes && require('../services/voiceTimeService').isoWeekKey());
    let done = missoes.recordMatchPlayed(store, ['u1', 'u2'], ['u1']);
    assert.deepEqual(done, []);
    done = missoes.recordMatchPlayed(store, ['u1', 'u2'], ['u2']);
    assert.deepEqual(done, []);
    done = missoes.recordMatchPlayed(store, ['u1', 'u3'], ['u1']);
    assert.equal(done.length, 2); // u1: jogar3 + vencer2
    assert.ok(done.some((d) => d.userId === 'u1' && d.mission.id === 'jogar3'));
    assert.ok(done.some((d) => d.userId === 'u1' && d.mission.id === 'vencer2'));
    // Não repete na mesma semana.
    done = missoes.recordMatchPlayed(store, ['u1'], ['u1']);
    assert.deepEqual(done, []);
    const progress = missoes.getProgress(store, 'u1');
    assert.ok(progress.every((p) => p.feito));
    assert.equal(missoes.getProgress(store, 'novo')[0].atual, 0);
  });

  it('semana nova zera o progresso', () => {
    const systemMeta = {};
    const store = missoes.ensureMissionsStore(systemMeta, Date.UTC(2026, 9, 12));
    missoes.recordMatchPlayed(store, ['u1'], ['u1']);
    const store2 = missoes.ensureMissionsStore(systemMeta, Date.UTC(2026, 9, 20));
    assert.notEqual(store2.week, store.week);
    assert.equal(missoes.getProgress(store2, 'u1')[0].atual, 0);
  });
});
