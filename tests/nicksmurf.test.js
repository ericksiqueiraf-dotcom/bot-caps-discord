// !nicksmurf — troca/remove APENAS a conta secundaria (smurf), sem mexer na principal.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const dataService = require('../services/dataService');
const legacyPath = require.resolve('../commands/legacyCommands');

function freshLegacy() {
  delete require.cache[legacyPath];
  return require('../commands/legacyCommands');
}

function baseStats() {
  return {
    players: {
      'puuid-main': {
        discordId: 'u1',
        nickname: 'Main#BR1',
        registeredNickname: 'Main#BR1',
        puuid: 'puuid-main',
        altPuuids: [],
        altNicknames: [],
        modes: { classic: { customWins: 5, customLosses: 2, baseMmr: 1500 } }
      }
    }
  };
}

describe('!nicksmurf', () => {
  let saved;
  let replies;
  let stats;
  let profileToReturn;
  let originalLoad;
  let originalSave;
  let originalRiot;

  beforeEach(() => {
    saved = null;
    replies = [];
    stats = baseStats();
    profileToReturn = {
      puuid: 'puuid-smurf',
      nickname: 'Smurf#BR1',
      summonerLevel: 100,
      tier: 'GOLD',
      rank: 'IV',
      leaguePoints: 0,
      mmr: 1200,
      isFallbackUnranked: false
    };
    originalLoad = dataService.loadPlayerStats;
    originalSave = dataService.savePlayerStats;
    originalRiot = global.riotService;
    dataService.loadPlayerStats = async () => JSON.parse(JSON.stringify(stats));
    dataService.savePlayerStats = async (data) => { saved = data; };
    global.riotService = {
      invalidateCache: () => {},
      getPlayerRankProfile: async () => ({ ...profileToReturn })
    };
  });

  afterEach(() => {
    dataService.loadPlayerStats = originalLoad;
    dataService.savePlayerStats = originalSave;
    global.riotService = originalRiot;
    delete require.cache[legacyPath];
  });

  function fakeMessage(authorId = 'u1', isAdmin = false) {
    return {
      author: { id: authorId },
      member: { permissions: { has: () => isAdmin } },
      mentions: { users: { first: () => null } },
      guild: { id: 'g1' },
      deletable: false,
      reply: async (payload) => { replies.push(typeof payload === 'string' ? payload : payload.content); }
    };
  }

  it('vincula a smurf sem alterar a principal nem o historico', async () => {
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage(), ['Smurf#BR1']);

    assert.ok(saved, 'deveria ter salvo');
    const entry = saved.players['puuid-main'];
    assert.deepEqual(entry.altPuuids, ['puuid-smurf']);
    assert.deepEqual(entry.altNicknames, ['Smurf#BR1']);
    assert.equal(entry.puuid, 'puuid-main');
    assert.equal(entry.modes.classic.customWins, 5);
    assert.equal(entry.modes.classic.customLosses, 2);
  });

  it('rejeita smurf igual a conta principal', async () => {
    profileToReturn = { ...profileToReturn, puuid: 'puuid-main', nickname: 'Main#BR1' };
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage(), ['Main#BR1']);

    assert.equal(saved, null);
    assert.match(replies.join('\n'), /principal/i);
  });

  it('rejeita smurf ja vinculada a outro membro', async () => {
    stats.players['puuid-other'] = { discordId: 'u2', puuid: 'puuid-smurf', nickname: 'Outro#BR1' };
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage(), ['Smurf#BR1']);

    assert.equal(saved, null);
    assert.match(replies.join('\n'), /outro membro/i);
  });

  it('remove a smurf com !nicksmurf remover', async () => {
    stats.players['puuid-main'].altPuuids = ['puuid-smurf'];
    stats.players['puuid-main'].altNicknames = ['Smurf#BR1'];
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage(), ['remover']);

    assert.ok(saved);
    assert.deepEqual(saved.players['puuid-main'].altPuuids, []);
    assert.deepEqual(saved.players['puuid-main'].altNicknames, []);
    assert.equal(saved.players['puuid-main'].puuid, 'puuid-main');
  });

  it('exige conta principal cadastrada antes', async () => {
    stats = { players: {} };
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage(), ['Smurf#BR1']);

    assert.equal(saved, null);
    assert.match(replies.join('\n'), /cadastrar/i);
  });

  it('administrador pode trocar a smurf de outro membro', async () => {
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage('admin', true), ['Smurf#BR1'], { id: 'u1' });

    assert.ok(saved);
    assert.deepEqual(saved.players['puuid-main'].altPuuids, ['puuid-smurf']);
  });

  it('nao-admin nao pode trocar a smurf de outro membro', async () => {
    const legacy = freshLegacy();
    await legacy.handleNickSmurfCommand(fakeMessage('u9', false), ['Smurf#BR1'], { id: 'u1' });

    assert.equal(saved, null);
    assert.match(replies.join('\n'), /administradores/i);
  });
});
