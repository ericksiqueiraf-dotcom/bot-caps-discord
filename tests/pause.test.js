'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../services/pauseService');

// matches fake: 1 partida 5x5 ativa (Time 1 = u1..u5, Time 2 = u6..u10)
function matchesFake() {
  const players = (ids) => ids.map((id) => ({ discordId: id, nickname: id }));
  return {
    'lobby-A': {
      active: true,
      votes: {},
      match: {
        id: 'lobby-A', letter: 'A',
        teamOne: players(['u1', 'u2', 'u3', 'u4', 'u5']),
        teamTwo: players(['u6', 'u7', 'u8', 'u9', 'u10'])
      }
    }
  };
}

test('ladoDoPlayer/partidaDoPlayer: acha lado e partida pela letra', () => {
  const m = matchesFake();
  assert.equal(P.ladoDoPlayer(m['lobby-A'].match, 'u3'), '1');
  assert.equal(P.ladoDoPlayer(m['lobby-A'].match, 'u7'), '2');
  assert.equal(P.ladoDoPlayer(m['lobby-A'].match, 'u42'), null);
  const alvo = P.partidaDoPlayer(m, 'u7');
  assert.equal(alvo.lobbyId, 'lobby-A');
  assert.equal(P.partidaDoPlayer(m, 'u7', 'B'), null, 'letra não bate');
  assert.equal(P.partidaDoPlayer(m, 'u99'), null);
});

test('pausar: primeiro pause do time inicia com fim em +5min e conta uso', () => {
  const m = matchesFake();
  const agora = Date.UTC(2026, 9, 20, 15, 0);
  const r = P.alternarPause(m['lobby-A'], 'u2', agora);
  assert.equal(r.acao, 'pausar');
  assert.equal(r.lado, '1');
  assert.equal(r.duracaoMin, 5);
  assert.equal(m['lobby-A'].pauseUsos['1'], 1);
  assert.equal(Date.parse(m['lobby-A'].pause.fim) - agora, 5 * 60000);
});

test('retomar: o proprio time retoma na hora, SEM aviso previo; fim automatico em 5min', () => {
  const m = matchesFake();
  const agora = Date.UTC(2026, 9, 20, 15, 0);
  P.alternarPause(m['lobby-A'], 'u2', agora);
  // outro membro do MESMO time retoma sem avisar
  const r = P.alternarPause(m['lobby-A'], 'u5', agora + 2 * 60000);
  assert.equal(r.acao, 'retomar');
  assert.equal(r.duracaoMin, 2);
  assert.equal(m['lobby-A'].pause, null);
  // uso ja consumido: 2a pausa do time 1 e negada
  const r2 = P.alternarPause(m['lobby-A'], 'u1', agora + 3 * 60000);
  assert.equal(r2.acao, 'esgotado');
});

test('aguardar: o outro time NAO pode retomar o pause alheio (e nem iniciar o dele)', () => {
  const m = matchesFake();
  const agora = Date.UTC(2026, 9, 20, 15, 0);
  P.alternarPause(m['lobby-A'], 'u2', agora); // time 1 pausa
  const r = P.alternarPause(m['lobby-A'], 'u6', agora + 60000); // time 2 tenta
  assert.equal(r.acao, 'aguardar');
  assert.equal(r.ladoPausa, '1');
  assert.equal(r.restamMin, 4);
  // o time 2 ainda tem o SEU pause disponivel depois da retomada
  P.alternarPause(m['lobby-A'], 'u2', agora + 2 * 60000); // time 1 retoma
  const r2 = P.alternarPause(m['lobby-A'], 'u6', agora + 3 * 60000);
  assert.equal(r2.acao, 'pausar');
  assert.equal(r2.lado, '2');
});

test('expirada: pause vencido se resolve sozinho (varredura e comando seguinte)', () => {
  const m = matchesFake();
  const agora = Date.UTC(2026, 9, 20, 15, 0);
  P.alternarPause(m['lobby-A'], 'u2', agora);
  // varredura aos 5min+1s: encerra automatico
  const vencidas = P.varrerPausasVencidas(m, agora + 5 * 60000 + 1000);
  assert.equal(vencidas.length, 1);
  assert.equal(vencidas[0].lobbyId, 'lobby-A');
  assert.equal(vencidas[0].encerramento.lado, '1');
  assert.equal(vencidas[0].encerramento.automatica, true);
  assert.equal(m['lobby-A'].pause, null);
  // e o time 1 ja gastou o uso dele
  const r = P.alternarPause(m['lobby-A'], 'u1', agora + 6 * 60000);
  assert.equal(r.acao, 'esgotado');
});

test('sem partida / nao participante', () => {
  const m = matchesFake();
  assert.equal(P.alternarPause(m['lobby-A'], 'u42').acao, 'nao-participante');
  m['lobby-A'].active = false;
  assert.equal(P.alternarPause(m['lobby-A'], 'u1').acao, 'sem-partida');
  assert.equal(P.alternarPause(null, 'u1').acao, 'sem-partida');
});
