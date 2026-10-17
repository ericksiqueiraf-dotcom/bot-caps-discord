// Trava de level minimo da conta Riot (conta principal).
// - getPlayerRankProfile expoe summonerLevel (campo da Riot, cache por puuid).
// - getSummonerLevelGate bloqueia level < config.cadastro.minSummonerLevel (30),
//   com fail-open quando o level e desconhecido (cache antigo sem o campo).
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const axiosPath = require.resolve('axios');
const realCreate = require(axiosPath).create;

function stubRiot({ summonerLevel, tier = 'GOLD', rank = 'IV', leaguePoints = 0 }) {
  require(axiosPath).create = () => ({
    get: async (url) => {
      if (url.includes('/accounts/by-riot-id/')) {
        return { data: { puuid: 'puuid-1' } };
      }
      if (url.includes('/summoners/by-puuid/')) {
        return { data: { puuid: 'puuid-1', id: 'sum-1', summonerLevel } };
      }
      if (url.includes('/entries/by-puuid/')) {
        return { data: [{ queueType: 'RANKED_SOLO_5x5', tier, rank, leaguePoints, wins: 10, losses: 5 }] };
      }
      throw new Error(`URL inesperada: ${url}`);
    }
  });
}

describe('cadastro conta principal', () => {
  beforeEach(() => {
    Object.keys(require.cache)
      .filter((k) => k.endsWith('services/riotService.js'))
      .forEach((k) => delete require.cache[k]);
  });

  afterEach(() => {
    require(axiosPath).create = realCreate;
    Object.keys(require.cache)
      .filter((k) => k.endsWith('services/riotService.js'))
      .forEach((k) => delete require.cache[k]);
  });

  it('profile expoe summonerLevel (fresco, mesmo com cache)', async () => {
    stubRiot({ summonerLevel: 234 });
    // require fresco a cada stub: o client axios e capturado no createRiotService,
    // e o cache de profile e por modulo (persiste entre instancias).
    const freshService = () => require('../services/riotService').createRiotService('key', 'br1');
    const p1 = await freshService().getPlayerRankProfile('Jog#BR1');
    assert.strictEqual(p1.summonerLevel, 234);
    assert.strictEqual(p1.tier, 'GOLD');
    assert.strictEqual(p1.rank, 'IV');
    assert.strictEqual(typeof p1.mmr, 'number');

    // Mesmo com stub novo, o cache por puuid retorna os dados antigos.
    stubRiot({ summonerLevel: 235, tier: 'DIAMOND', rank: 'I', leaguePoints: 75 });
    const p2 = await freshService().getPlayerRankProfile('Jog#BR1');
    assert.deepStrictEqual(p2, p1);

    // Apos invalidar o cache, os dados frescos aparecem.
    freshService().invalidateCache('puuid-1');
    const p3 = await freshService().getPlayerRankProfile('Jog#BR1');
    assert.strictEqual(p3.tier, 'DIAMOND');
    assert.strictEqual(p3.summonerLevel, 235);
  });

  it('getSummonerLevelGate barra level baixo, libera 30+', () => {
    const legacy = require('../commands/legacyCommands');
    assert.strictEqual(typeof legacy.getSummonerLevelGate, 'function');
    const config = require('../config.json');
    assert.strictEqual(config.cadastro.minSummonerLevel, 30);

    assert.equal(legacy.getSummonerLevelGate(29).ok, false);
    assert.equal(legacy.getSummonerLevelGate(30).ok, true);
    assert.equal(legacy.getSummonerLevelGate(500).ok, true);
    // Fail-open: level desconhecido (cache antigo) nao bloqueia.
    assert.equal(legacy.getSummonerLevelGate(undefined).ok, true);
    assert.equal(legacy.getSummonerLevelGate(null).ok, true);
  });
});
