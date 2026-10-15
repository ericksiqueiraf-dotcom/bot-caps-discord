// Comportamento REAL atual do cadastro: sem trava de level/servico.
// - getPlayerRankProfile NAO expoe summonerLevel (descarta o campo da Riot)
//   e usa cache em memoria por puuid (TTL 1h).
// - Nao existe cadastroNeedsApproval em commands/legacyCommands;
//   config.cadastro.minSummonerLevel existe (30) mas nao e consumido por
//   nenhum modulo de producao (drift de spec nao implementada).
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

  it('profile expoe rank/mmr sem summonerLevel e usa cache por puuid', async () => {
    stubRiot({ summonerLevel: 234 });
    // require fresco a cada stub: o client axios e capturado no createRiotService,
    // e o cache de profile e por modulo (persiste entre instancias).
    const freshService = () => require('../services/riotService').createRiotService('key', 'br1');
    const p1 = await freshService().getPlayerRankProfile('Jog#BR1');
    // A API real descarta summonerLevel: nao aparece no profile.
    assert.strictEqual(p1.summonerLevel, undefined);
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
    assert.strictEqual(p3.summonerLevel, undefined);
  });

  it('sem gate de aprovacao por level: legacyCommands nao expoe cadastroNeedsApproval', () => {
    const legacy = require('../commands/legacyCommands');
    assert.strictEqual(typeof legacy.cadastroNeedsApproval, 'undefined');
    // O valor existe no config mas nenhum modulo de producao o consome.
    const config = require('../config.json');
    assert.strictEqual(config.cadastro.minSummonerLevel, 30);
  });
});
