// Testes do modo inter-servidores (N x J na CAPS ARENA).
// Regras puras + casos de uso com mocks em memoria (sem Discord).
const { describe, it } = require('node:test');
const assert = require('node:assert');

const S = require('../domain/inter/series');
const { buscarTime, cancelarBusca, restaurarBuscas } = require('../application/use-cases/inter/interBusca');
const { formarMatch, registrarResultadoJogo, aplicarWO } = require('../application/use-cases/inter/interMatch');
const I = require('../services/inviteService');
const D = require('../services/dataService');
const L = require('../utils/lobbyUtils');

const clone = (o) => JSON.parse(JSON.stringify(o));
const FIXED_NOW = new Date('2026-10-10T12:00:00Z').getTime();
const nowFn = () => FIXED_NOW;
const randA = () => 0.1; // drawSides -> 'A'

function teamIds(prefix) {
  return [1, 2, 3, 4, 5].map((i) => `${prefix}${i}`);
}

function makeInterDeps(state) {
  return {
    loadInterBusca: async () => clone(state.busca),
    saveInterBusca: async (d) => { state.busca = clone(d); },
    loadInterMatches: async () => clone(state.matches),
    saveInterMatches: async (d) => { state.matches = clone(d); },
    loadInterRanking: async () => clone(state.ranking),
    saveInterRanking: async (d) => { state.ranking = clone(d); },
    loadQueue: async () => clone(state.queue || { lobbies: {}, waitingLists: {} }),
    loadCurrentMatch: async () => clone(state.current || { matches: {} }),
    findLobbyByPlayer: L.findLobbyByPlayer,
    withQueueOperationLock: D.withQueueOperationLock
  };
}

function freshState() {
  return { busca: { buscas: [] }, matches: { matches: {} }, ranking: { times: {} }, queue: { lobbies: {}, waitingLists: {} }, current: { matches: {} } };
}

const CONFIG = { buscaExpiryMinutes: 30 };

describe('inter: regras puras (domain/inter/series)', () => {
  it('parseSerieArg aceita MD1/MD3 e rejeita lixo', () => {
    assert.strictEqual(S.parseSerieArg('md1'), 'MD1');
    assert.strictEqual(S.parseSerieArg('MD3'), 'MD3');
    assert.strictEqual(S.parseSerieArg('xyz'), null);
  });

  it('validateRoster exige 5 distintos', () => {
    assert.strictEqual(S.validateRoster(teamIds('a')).ok, true);
    assert.strictEqual(S.validateRoster(['a', 'b']).ok, false);
    assert.strictEqual(S.validateRoster(['a', 'a', 'b', 'c', 'd']).ok, false);
  });

  it('lados: J1 sorteado, J2 invertido, J3 do novo sorteio', () => {
    assert.deepStrictEqual(S.sidesForGame('MD3', 1, 'A'), { azul: 'A' });
    assert.deepStrictEqual(S.sidesForGame('MD3', 2, 'A'), { azul: 'B' });
    assert.deepStrictEqual(S.sidesForGame('MD3', 3, 'A', 'B'), { azul: 'B' });
    assert.deepStrictEqual(S.sidesForGame('MD1', 1, 'B'), { azul: 'B' });
  });

  it('MD1 fecha no 1o jogo; MD3 precisa de 2 vitorias', () => {
    const m1 = { serie: 'MD1', status: 'open', placarA: 0, placarB: 0, jogos: [{ n: 1, ladoAzul: 'A', vencedor: null, wo: false }] };
    const r1 = S.applyGameResult(m1, 1, 'AZUL');
    assert.strictEqual(r1.closed, true);
    assert.strictEqual(r1.seriesWinner, 'A');

    const m3 = { serie: 'MD3', status: 'open', placarA: 0, placarB: 0, jogos: S.buildGames('MD3', 'A', 'B') };
    const g1 = S.applyGameResult(m3, 1, 'AZUL');
    assert.strictEqual(g1.closed, false);
    assert.strictEqual(m3.jogos[1].ladoAzul, 'B'); // J2 invertido
    const g2 = S.applyGameResult(m3, 2, 'AZUL'); // vence B
    assert.strictEqual(g2.closed, false);
    assert.strictEqual(m3.placarA, 1);
    assert.strictEqual(m3.placarB, 1);
    const g3 = S.applyGameResult(m3, 3, 'VERM'); // ladoAzul=B -> VERM = A
    assert.strictEqual(g3.closed, true);
    assert.strictEqual(g3.seriesWinner, 'A');
  });

  it('W.O. fecha 1-0 (MD1) e 2-0 (MD3)', () => {
    const m1 = { serie: 'MD1', status: 'open', placarA: 0, placarB: 0, jogos: [{ n: 1, ladoAzul: 'A', vencedor: null, wo: false }] };
    const w1 = S.applyWO(m1, 'A');
    assert.deepStrictEqual([m1.placarA, m1.placarB], [0, 1]);
    assert.strictEqual(w1.seriesWinner, 'B');
    const m3 = { serie: 'MD3', status: 'open', placarA: 0, placarB: 0, jogos: S.buildGames('MD3', 'A', 'B') };
    const w3 = S.applyWO(m3, 'B');
    assert.deepStrictEqual([m3.placarA, m3.placarB], [2, 0]);
    assert.strictEqual(w3.seriesWinner, 'A');
  });

  it('MD3 pontua fixo: 5 no 2x0, 4 no 2x1; derrota zera', () => {
    const md1 = S.seriesPoints('MD1', 1, 0, true);
    const md3_20 = S.seriesPoints('MD3', 2, 0, true);
    const md3_21 = S.seriesPoints('MD3', 2, 1, true);
    assert.strictEqual(md1, 2);
    assert.strictEqual(md3_20, 5);
    assert.strictEqual(md3_21, 4);
    assert.strictEqual(S.seriesPoints('MD3', 0, 2, false), 0);
    assert.strictEqual(S.seriesPoints('MD1', 0, 1, false), 0);
    assert.ok(md3_21 > md1, 'MD3 (4) deve valer mais que MD1 (3)');
  });
});

describe('inter: busca de times', () => {
  it('primeiro time fica waiting; segundo forma match FIFO', async () => {
    const state = freshState();
    const deps = makeInterDeps(state);
    const r1 = await buscarTime({
      input: { teamName: 'Time N', originGuildId: 'gN', originGuildName: 'Servidor N', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD3' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    assert.strictEqual(r1.status, 'waiting');
    assert.strictEqual(r1.position, 1);

    const r2 = await buscarTime({
      input: { teamName: 'Time J', originGuildId: 'gJ', originGuildName: 'Servidor J', capitaoId: 'j1', jogadores: teamIds('j'), serie: 'MD3' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    assert.strictEqual(r2.status, 'matched');
    assert.strictEqual(r2.matchDraft.teamA.name, 'Time N'); // FIFO: mais antigo = A
    assert.strictEqual(r2.matchDraft.teamB.name, 'Time J');
    assert.strictEqual(r2.matchDraft.firstAzul, 'A');
  });

  it('series diferentes nao se enfrentam', async () => {
    const state = freshState();
    const deps = makeInterDeps(state);
    await buscarTime({
      input: { teamName: 'N', originGuildId: 'gN', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD1' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    const r = await buscarTime({
      input: { teamName: 'J', originGuildId: 'gJ', capitaoId: 'j1', jogadores: teamIds('j'), serie: 'MD3' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    assert.strictEqual(r.status, 'waiting');
  });

  it('mesmo time nao busca 2x; elenco invalido rejeitado', async () => {
    const state = freshState();
    const deps = makeInterDeps(state);
    const base = { teamName: 'N', originGuildId: 'gN', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD1' };
    await buscarTime({ input: base, config: CONFIG, deps, rand: randA, now: nowFn });
    const dup = await buscarTime({ input: base, config: CONFIG, deps, rand: randA, now: nowFn });
    assert.strictEqual(dup.status, 'already_waiting');

    const short = await buscarTime({
      input: { ...base, teamName: 'Curto', jogadores: ['a', 'b'] }, config: CONFIG, deps, rand: randA, now: nowFn
    });
    assert.strictEqual(short.status, 'roster_size');

    const rep = await buscarTime({
      input: { ...base, teamName: 'Rep', jogadores: ['a', 'a', 'b', 'c', 'd'] }, config: CONFIG, deps, rand: randA, now: nowFn
    });
    assert.strictEqual(rep.status, 'roster_duplicates');
  });

  it('jogador na fila interna ou em match nao pode buscar', async () => {
    const state = freshState();
    state.queue.lobbies = { 'classic-5x5-a': { players: [{ discordId: 'n3' }] } };
    const deps = makeInterDeps(state);
    const r = await buscarTime({
      input: { teamName: 'N', originGuildId: 'gN', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD1' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    assert.strictEqual(r.status, 'player_busy_queue');
    assert.strictEqual(r.discordId, 'n3');
  });

  it('cancelarBusca e restaurarBuscas', async () => {
    const state = freshState();
    const deps = makeInterDeps(state);
    await buscarTime({
      input: { teamName: 'N', originGuildId: 'gN', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD1' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    const c = await cancelarBusca({ key: 'gN:n', deps });
    assert.strictEqual(c.status, 'cancelled');
    const c2 = await cancelarBusca({ key: 'gN:n', deps });
    assert.strictEqual(c2.status, 'not_found');

    // rollback: buscas matched voltam a waiting
    state.busca.buscas.push({ id: 'b1', key: 'gX:x', status: 'matched' }, { id: 'b2', key: 'gY:y', status: 'matched' });
    const rr = await restaurarBuscas({ buscaId: 'b1', opponentId: 'b2', deps });
    assert.strictEqual(rr.status, 'restored');
    assert.ok(state.busca.buscas.every((b) => b.status !== 'matched'));
  });
});

describe('inter: match, resultado e ranking separado', () => {
  async function setupMatchedMD3() {
    const state = freshState();
    const deps = makeInterDeps(state);
    await buscarTime({
      input: { teamName: 'N', originGuildId: 'gN', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD3' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    const r2 = await buscarTime({
      input: { teamName: 'J', originGuildId: 'gJ', capitaoId: 'j1', jogadores: teamIds('j'), serie: 'MD3' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    const formed = await formarMatch({
      matchDraft: r2.matchDraft, arenaGuildId: 'gArena',
      canais: { categoriaId: 'c', textoId: 't', vozAzulId: 'a', vozVermId: 'v' },
      invite: { code: 'abc', url: 'https://discord.gg/abc', expiresAt: new Date().toISOString() },
      deps
    });
    return { state, deps, match: formed.match };
  }

  it('formarMatch cria serie aberta com invite e canais', async () => {
    const { match } = await setupMatchedMD3();
    assert.strictEqual(match.status, 'open');
    assert.strictEqual(match.jogos.length, 3);
    assert.strictEqual(match.invite.url, 'https://discord.gg/abc');
    assert.strictEqual(match.canais.textoId, 't');
  });

  it('J3 travado antes do 1-1; com 1-1 registra com lados sorteados', async () => {
    const { state, deps, match } = await setupMatchedMD3();
    const locked = await registrarResultadoJogo({ matchId: match.id, jogoN: 3, vencedorSide: 'AZUL', thirdAzul: 'B', points: {}, deps });
    assert.strictEqual(locked.status, 'game_locked');

    // J1: ladoAzul=A -> AZUL = N
    const g1 = await registrarResultadoJogo({ matchId: match.id, jogoN: 1, vencedorSide: 'AZUL', points: {}, deps });
    assert.strictEqual(g1.status, 'game_recorded');
    assert.strictEqual(g1.match.placarA, 1);
    // J2: invertido (ladoAzul=B) -> AZUL = J
    const g2 = await registrarResultadoJogo({ matchId: match.id, jogoN: 2, vencedorSide: 'AZUL', points: {}, deps });
    assert.strictEqual(g2.status, 'game_recorded');
    assert.strictEqual(g2.match.placarB, 1);
    // J3 liberado com sorteio
    const g3 = await registrarResultadoJogo({ matchId: match.id, jogoN: 3, vencedorSide: 'VERM', thirdAzul: 'B', points: {}, deps });
    assert.strictEqual(g3.status, 'series_closed');
    assert.strictEqual(g3.seriesWinner, 'A'); // ladoAzul=B, VERM=A=N
    assert.strictEqual(state.ranking.times['gN:n'].pontos, 4); // 2x1 = 4 pts
    assert.strictEqual(state.ranking.times['gJ:j'].pontos, 0);
  });

  it('MD1 fecha no jogo 1 e ranking inter nao toca playerStats', async () => {
    const state = freshState();
    const deps = makeInterDeps(state);
    await buscarTime({
      input: { teamName: 'N', originGuildId: 'gN', capitaoId: 'n1', jogadores: teamIds('n'), serie: 'MD1' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    const r2 = await buscarTime({
      input: { teamName: 'J', originGuildId: 'gJ', capitaoId: 'j1', jogadores: teamIds('j'), serie: 'MD1' },
      config: CONFIG, deps, rand: randA, now: nowFn
    });
    const formed = await formarMatch({ matchDraft: r2.matchDraft, arenaGuildId: 'gArena', canais: null, invite: null, deps });
    const res = await registrarResultadoJogo({ matchId: formed.match.id, jogoN: 1, vencedorSide: 'VERM', points: {}, deps });
    assert.strictEqual(res.status, 'series_closed');
    assert.strictEqual(res.seriesWinner, 'B');
    const t = state.ranking.times['gJ:j'];
    assert.strictEqual(t.md1V, 1);
    assert.strictEqual(t.pontos, S.DEFAULT_POINTS.md1Win);
    assert.strictEqual(state.ranking.times['gN:n'].md1D, 1);
  });

  it('W.O. fecha a serie e marca wo no ranking', async () => {
    const { deps, match } = await setupMatchedMD3();
    const res = await aplicarWO({ matchId: match.id, faltoso: 'B', points: {}, deps });
    assert.strictEqual(res.status, 'wo_applied');
    assert.strictEqual(res.seriesWinner, 'A');
    assert.strictEqual(res.match.placarA, 2);
    assert.ok(res.match.wo);
  });
});

describe('inter: elenco pela call de voz (parseDesafiarArgs)', () => {
  const { parseDesafiarArgs } = require('../commands/handlers/interCommandHandlers');

  function mockMessage({ authorId, mentionIds = [], voiceIds = null }) {
    const users = new Map(mentionIds.map((id) => [id, { id, bot: false }]));
    return {
      author: { id: authorId },
      mentions: { users, members: new Map() },
      member: voiceIds === null ? {} : {
        voice: {
          channel: {
            members: new Map(voiceIds.map((id) => [id, { id, user: { id, bot: false } }]))
          }
        }
      }
    };
  }

  it('nome primeiro + MD1 + 5 mencoes', () => {
    const msg = mockMessage({ authorId: 'c', mentionIds: ['a', 'b', 'd', 'e', 'f'] });
    const r = parseDesafiarArgs(msg, ['TimeN', 'MD1']);
    assert.strictEqual(r.serie, 'MD1');
    assert.strictEqual(r.teamName, 'TimeN');
    assert.deepStrictEqual(r.memberIds, ['a', 'b', 'd', 'e', 'f']);
    assert.strictEqual(r.via, 'mentions');
  });

  it('formato antigo (MD1 primeiro) continua valendo', () => {
    const msg = mockMessage({ authorId: 'c', mentionIds: ['a', 'b', 'd', 'e'] });
    const r = parseDesafiarArgs(msg, ['MD1', 'TimeN']);
    assert.strictEqual(r.serie, 'MD1');
    assert.strictEqual(r.teamName, 'TimeN');
    assert.deepStrictEqual(r.memberIds, ['c', 'a', 'b', 'd', 'e']);
  });

  it('autor + 4 mencoes soma 5', () => {
    const msg = mockMessage({ authorId: 'c', mentionIds: ['a', 'b', 'd', 'e'] });
    const r = parseDesafiarArgs(msg, ['TimeN']);
    assert.strictEqual(r.serie, 'MD1');
    assert.deepStrictEqual(r.memberIds, ['c', 'a', 'b', 'd', 'e']);
    assert.strictEqual(r.via, 'mentions');
  });

  it('sem mencoes usa os 5 da call (sala = time)', () => {
    const msg = mockMessage({ authorId: 'c', voiceIds: ['c', 'a', 'b', 'd', 'e'] });
    const r = parseDesafiarArgs(msg, ['MD3', 'Time', 'N']);
    assert.strictEqual(r.serie, 'MD3');
    assert.strictEqual(r.teamName, 'Time N');
    assert.deepStrictEqual([...r.memberIds].sort(), ['a', 'b', 'c', 'd', 'e']);
    assert.strictEqual(r.via, 'voice');
  });

  it('call incompleta ou autor fora da call nao fecha elenco', () => {
    const msg1 = mockMessage({ authorId: 'c', voiceIds: ['c', 'a', 'b'] });
    assert.strictEqual(parseDesafiarArgs(msg1, ['TimeN']).via, 'incomplete');
    const msg2 = mockMessage({ authorId: 'z', voiceIds: ['c', 'a', 'b', 'd', 'e'] });
    assert.strictEqual(parseDesafiarArgs(msg2, ['TimeN']).via, 'incomplete');
    const msg3 = mockMessage({ authorId: 'c' });
    assert.strictEqual(parseDesafiarArgs(msg3, ['TimeN']).via, 'incomplete');
  });
});

describe('lcl: lobby clandestino (gate do !desafiar)', () => {
  const { isMemberInClandestinoChannel, getClandestinoChannelId } = require('../utils/lobbyUtils');

  function voiceMember(channelId, guild) {
    return { voice: { channel: { id: channelId } }, guild };
  }

  it('vale por ID configurado ou por nome da sala', () => {
    const config = require('../config.json');
    const saved = config.voiceChannels.clandestinoQueueChannelId;
    try {
      config.voiceChannels.clandestinoQueueChannelId = 'voz-123';
      assert.strictEqual(isMemberInClandestinoChannel(voiceMember('voz-123', {})), true);
      assert.strictEqual(isMemberInClandestinoChannel(voiceMember('outra', {})), false);
      assert.strictEqual(isMemberInClandestinoChannel({}), false);
    } finally {
      config.voiceChannels.clandestinoQueueChannelId = saved;
    }
  });

  it('sem ID, acha sala pelo nome (fallback)', () => {
    const config = require('../config.json');
    const saved = config.voiceChannels.clandestinoQueueChannelId;
    try {
      config.voiceChannels.clandestinoQueueChannelId = '';
      const fakeGuild = {
        channels: {
          cache: {
            find: (fn) => [{ id: 'voz-9', type: 2, name: 'Lobby Clandestino' }].find(fn) || null
          }
        }
      };
      // ChannelType.GuildVoice = 2 no discord.js
      assert.strictEqual(getClandestinoChannelId(fakeGuild), 'voz-9');
    } finally {
      config.voiceChannels.clandestinoQueueChannelId = saved;
    }
  });
});
describe('inter: invites (services/inviteService)', () => {
  it('createMatchInvite ok retorna url; sem permissao mapeia motivo', async () => {
    const ok = await I.createMatchInvite({
      createInvite: async () => ({ code: 'xyz', url: 'https://discord.gg/xyz', expiresAt: new Date().toISOString() })
    });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.invite.url, 'https://discord.gg/xyz');

    const denied = await I.createMatchInvite({
      createInvite: async () => { const e = new Error('Missing Permissions'); e.code = 50013; throw e; }
    });
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.reason, 'missing_permissions');

    const bad = await I.createMatchInvite(null);
    assert.strictEqual(bad.reason, 'invalid_channel');
  });

  it('sendInterInvites coleta dmFailed sem jogar excecao', async () => {
    const res = await I.sendInterInvites(
      async (id) => (id === 'u2' ? null : { send: async () => { if (id === 'u3') throw new Error('closed'); } }),
      ['u1', 'u2', 'u3'],
      'convite!'
    );
    assert.deepStrictEqual(res.sent, ['u1']);
    assert.deepStrictEqual(res.dmFailed, ['u2', 'u3']);
  });
});
