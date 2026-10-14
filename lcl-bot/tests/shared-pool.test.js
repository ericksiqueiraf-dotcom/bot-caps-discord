// Testes do MVP compartilhado: pool, guildSettings, start com destino, auth admin.
const { describe, it } = require('node:test');
const assert = require('node:assert');

const P = require('../domain/shared/pool');
const { enterQueue } = require('../application/use-cases/enterQueue');
const { startMatch } = require('../application/use-cases/startMatch');
const D = require('../services/dataService');
const L = require('../utils/lobbyUtils');
const B = require('../services/balanceService');
const A = require('../admin/auth');

const clone = (o) => JSON.parse(JSON.stringify(o));

function storedStatsFor(discordId) {
  return {
    players: {
      [`discord:${discordId}`]: {
        discordId,
        nickname: `Jog${discordId}#br1`,
        registeredNickname: `Jog${discordId}#br1`,
        registeredAt: new Date().toISOString(),
        puuid: `puuid-${discordId}`,
        tier: 'GOLD',
        rank: 'IV',
        leaguePoints: 0,
        baseMmr: 1200,
        internalRating: 2200,
        customWins: 0,
        customLosses: 0,
        ratingVersion: 2,
        modes: {
          classic: { customWins: 0, customLosses: 0, baseMmr: 1200, internalRating: 2200, winStreak: 0, ratingVersion: 2 }
        }
      }
    }
  };
}

function makeEnterDeps(state) {
  return {
    loadPlayerStats: async () => clone(state.stats),
    loadQueue: async () => clone(state.queue),
    loadCurrentMatch: async () => clone(state.current),
    loadSystemMeta: async () => ({}),
    saveQueue: async (d) => { state.queue = clone(d); },
    savePlayerStats: async (d) => { state.stats = clone(d); },
    withQueueOperationLock: D.withQueueOperationLock,
    findLobbyByPlayer: L.findLobbyByPlayer,
    getStoredPlayerStats: L.getStoredPlayerStats,
    getModeStats: L.getModeStats,
    getOpenLobby: L.getOpenLobby,
    findReusableWaitingLobby: () => null,
    getNextLobbyLetter: L.getNextLobbyLetter,
    createLobbyChannels: async () => ({ waitingChannelId: 'wait-1', parentId: null }),
    getRequiredPlayersByModeAndFormat: L.getRequiredPlayersByModeAndFormat,
    normalizePlayerModes: L.normalizePlayerModes,
    getStatsBucketKey: L.getStatsBucketKey,
    upsertPlayerStats: L.upsertPlayerStats,
    calculateHybridMmr: B.calculateHybridMmr,
    calculateSeedRating: B.calculateSeedRating,
    applyLeagueMmrChange: B.applyLeagueMmrChange
  };
}

describe('shared pool: regras puras', () => {
  it('chaves shared vs locais', () => {
    assert.strictEqual(P.getSharedWaitingListKey('classic', '5x5'), 'shared:classic:5x5');
    assert.strictEqual(P.getSharedWaitingListKey('classic', '5x5', 'S'), 'shared:classic:5x5:s');
    assert.strictEqual(P.getLocalWaitingListKey('classic', '5x5'), 'classic:5x5');
    assert.strictEqual(P.isSharedGuild({ sharedMatchmaking: true }), true);
    assert.strictEqual(P.isSharedGuild({ sharedMatchmaking: false }), false);
    assert.strictEqual(P.isSharedGuild(null), false);
  });

  it('eleicao de destino: maioria vence; empate usa ultimo; preferido prevalece', () => {
    const lobby = { players: [
      { originGuildId: 'gA' }, { originGuildId: 'gA' }, { originGuildId: 'gA' },
      { originGuildId: 'gB' }, { originGuildId: 'gB' }
    ] };
    assert.strictEqual(P.electDestinationGuild(lobby, {}), 'gA');
    const tie = { players: [{ originGuildId: 'gA' }, { originGuildId: 'gB' }] };
    assert.strictEqual(P.electDestinationGuild(tie, { lastJoinedGuildId: 'gB' }), 'gB');
    assert.strictEqual(P.electDestinationGuild(tie, { preferredHostGuildId: 'gA' }), 'gA');
    assert.deepStrictEqual(P.lobbyOriginGuilds(lobby), ['gA', 'gB']);
  });

  it('playersNeedingInvite filtra destino', () => {
    const players = [{ discordId: '1', originGuildId: 'gA' }, { discordId: '2', originGuildId: 'gB' }];
    assert.deepStrictEqual(P.playersNeedingInvite(players, 'gA').map((p) => p.discordId), ['2']);
  });
});

describe('guildSettings: defaults', () => {
  it('getGuildSetting mescla defaults e oscuras guilds ausentes', () => {
    const s = D.getGuildSetting({ guilds: {} }, 'gx');
    assert.strictEqual(s.sharedMatchmaking, false);
    assert.strictEqual(s.sharedGroupId, null);
    const s2 = D.getGuildSetting({ guilds: { gx: { sharedMatchmaking: true } } }, 'gx');
    assert.strictEqual(s2.sharedMatchmaking, true);
    assert.strictEqual(D.DEFAULT_GUILD_SETTINGS.sharedMatchmaking, false);
  });
});

describe('enterQueue: caminho shared vs local', () => {
  it('shared carimba scope e origem; duas guilds caem no mesmo lobby', async () => {
    const state = {
      queue: { lobbies: {}, waitingLists: {} },
      current: { matches: {} },
      stats: { players: { ...storedStatsFor('u1').players, ...storedStatsFor('u2').players } }
    };
    const deps = makeEnterDeps(state);
    const r1 = await enterQueue({
      guild: {}, guildId: 'gA', author: { id: 'u1', username: 'u1' },
      selectedMode: 'classic', selectedFormat: '5x5', providedNick: '',
      riotService: {}, deps, shared: true, originGuildName: 'Guild A'
    });
    assert.strictEqual(r1.status, 'joined');
    assert.strictEqual(r1.lobby.scope, 'shared');
    assert.strictEqual(r1.lobby.players[0].originGuildId, 'gA');

    const r2 = await enterQueue({
      guild: {}, guildId: 'gB', author: { id: 'u2', username: 'u2' },
      selectedMode: 'classic', selectedFormat: '5x5', providedNick: '',
      riotService: {}, deps, shared: true, originGuildName: 'Guild B'
    });
    assert.strictEqual(r2.status, 'joined');
    assert.strictEqual(r2.lobby.id, r1.lobby.id); // mesmo lobby cross-guild
    assert.deepStrictEqual(P.lobbyOriginGuilds(state.queue.lobbies[r1.lobby.id]), ['gA', 'gB']);
  });

  it('local mantem scope local e mesma fila de antes', async () => {
    const state = { queue: { lobbies: {}, waitingLists: {} }, current: { matches: {} }, stats: storedStatsFor('u9') };
    const deps = makeEnterDeps(state);
    const r = await enterQueue({
      guild: {}, guildId: 'gZ', author: { id: 'u9', username: 'u9' },
      selectedMode: 'classic', selectedFormat: '5x5', providedNick: '',
      riotService: {}, deps, shared: false, originGuildName: 'Guild Z'
    });
    assert.strictEqual(r.status, 'joined');
    assert.strictEqual(r.lobby.scope, 'local');
  });

  it('duplicata cross-guild bloqueada (ja na fila)', async () => {
    const state = { queue: { lobbies: {}, waitingLists: {} }, current: { matches: {} }, stats: storedStatsFor('u1') };
    const deps = makeEnterDeps(state);
    await enterQueue({
      guild: {}, guildId: 'gA', author: { id: 'u1', username: 'u1' },
      selectedMode: 'classic', selectedFormat: '5x5', providedNick: '',
      riotService: {}, deps, shared: true, originGuildName: 'A'
    });
    const r = await enterQueue({
      guild: {}, guildId: 'gB', author: { id: 'u1', username: 'u1' },
      selectedMode: 'classic', selectedFormat: '5x5', providedNick: '',
      riotService: {}, deps, shared: true, originGuildName: 'B'
    });
    assert.strictEqual(r.status, 'already_in_queue');
  });
});

describe('startMatch: destino e origens persistidos', () => {
  it('salva destinationGuildId e playerOrigins', async () => {
    const players = ['a1', 'a2', 'b1', 'b2'].map((id, i) => ({
      discordId: id, nickname: `${id}#br1`, baseMmr: 1200, internalRating: 2200,
      customWins: 0, customLosses: 0, originGuildId: i < 2 ? 'gA' : 'gB'
    }));
    const state = {
      queue: { lobbies: { 'classic-5x5-a': { id: 'classic-5x5-a', mode: 'classic', format: '5x5', letter: 'A', scope: 'shared', requiredPlayers: 4, players } }, waitingLists: {} },
      current: { matches: {} }
    };
    const deps = {
      withQueueOperationLock: D.withQueueOperationLock,
      loadQueue: async () => clone(state.queue),
      loadCurrentMatch: async () => clone(state.current),
      saveQueue: async (d) => { state.queue = clone(d); },
      saveCurrentMatch: async (d) => { state.current = clone(d); },
      createBalancedTeams: (ps) => ({ teamOne: ps.slice(0, 2), teamTwo: ps.slice(2), teamOneMmr: 0, teamTwoMmr: 0, difference: 0 }),
      calculateHybridMmr: B.calculateHybridMmr,
      migrateInternalRating: B.migrateInternalRating,
      createTeamChannelsForLobby: async () => ({ teamOneChannelId: 't1', teamTwoChannelId: 't2' }),
      movePlayersToTeamChannels: async () => {}
    };
    const res = await startMatch({
      guild: { id: 'gA' }, guildId: 'gA',
      lobby: state.queue.lobbies['classic-5x5-a'],
      deps, destinationGuildId: 'gA'
    });
    assert.ok(res);
    const saved = state.current.matches['classic-5x5-a'].match;
    assert.strictEqual(saved.destinationGuildId, 'gA');
    assert.strictEqual(saved.playerOrigins.a1, 'gA');
    assert.strictEqual(saved.playerOrigins.b2, 'gB');
    assert.ok(!state.queue.lobbies['classic-5x5-a']);
  });
});

describe('admin auth: hash, sessao e papeis', () => {
  it('hash/verify com timing seguro', () => {
    const { salt, hash } = A.hashPassword('segredo-123');
    assert.strictEqual(A.verifyPassword('segredo-123', salt, hash), true);
    assert.strictEqual(A.verifyPassword('errada', salt, hash), false);
    assert.strictEqual(A.verifyPassword('x', null, null), false);
  });

  it('sessao expira e logout revoga', () => {
    const token = A.issueSession({ username: 'dono', role: 'admin' });
    assert.strictEqual(A.getSessionUser(token).username, 'dono');
    A.revokeSession(token);
    assert.strictEqual(A.getSessionUser(token), null);
    assert.strictEqual(A.getSessionUser('inexistente'), null);
  });

  it('requireRole barra viewer em acao admin', () => {
    let status = 0;
    const res = { status: (s) => { status = s; return res; }, send: () => res, redirect: () => res };
    const next = () => { throw new Error('nao devia passar'); };
    A.requireRole('admin')({ adminUser: { username: 'v', role: 'viewer' } }, res, next);
    assert.strictEqual(status, 403);
    let passed = false;
    A.requireRole('admin')({ adminUser: { username: 'a', role: 'admin' } }, res, () => { passed = true; });
    assert.strictEqual(passed, true);
  });

  it('parseCookies le o cookie de sessao', () => {
    assert.strictEqual(A.parseCookies({ headers: { cookie: 'a=1; caps_admin=tok123' } }).caps_admin, 'tok123');
  });
});
