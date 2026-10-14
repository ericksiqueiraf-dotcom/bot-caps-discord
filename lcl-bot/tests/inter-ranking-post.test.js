// Rotina propria do LCL: publica o ranking INTER (nunca o interno).
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildInterRankingEmbed, postInterRankingUpdate } = require('../commands/handlers/interCommandHandlers');

function rankingWith(times) {
  return { times };
}

describe('lcl: publicacao do ranking inter', () => {
  it('embed lista top ordenado por pontos', () => {
    const { embed, empty } = buildInterRankingEmbed(rankingWith({
      'g1:a': { name: 'A', originGuildId: 'g1', md1V: 1, md1D: 0, md3V: 0, md3D: 0, jogosV: 1, jogosD: 0, pontos: 3, woV: 0, woD: 0 },
      'g2:b': { name: 'B', originGuildId: 'g2', md1V: 0, md1D: 0, md3V: 1, md3D: 0, jogosV: 2, jogosD: 0, pontos: 5, woV: 0, woD: 0 }
    }), 'Fase de Testes #1');
    assert.strictEqual(empty, false);
    const json = embed.toJSON();
    assert.strictEqual(json.title, '🏆 Ranking Inter-servidores');
    assert.strictEqual(json.fields[0].name, '1. B'); // 5 pts antes de 3
    assert.ok(!JSON.stringify(json).includes('Top 10 - CLASSIC'));
  });

  it('ranking vazio gera embed avisando', () => {
    const { empty } = buildInterRankingEmbed(rankingWith({}));
    assert.strictEqual(empty, true);
  });

  it('post: vazio nao envia; sem arena/canal nao envia; ok envia', async () => {
    const sent = [];
    const channel = { isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { channels: { fetch: async () => channel } };
    const client = { guilds: { fetch: async () => guild } };
    const interConfig = { arenaGuildId: 'gArena', announceChannelId: 'c1' };

    const rEmpty = await postInterRankingUpdate({
      client, interConfig, deps: { loadInterRanking: async () => rankingWith({}) }
    });
    assert.strictEqual(rEmpty.status, 'empty');
    assert.strictEqual(sent.length, 0);

    const rNoArena = await postInterRankingUpdate({
      client: { guilds: { fetch: async () => null } }, interConfig,
      deps: { loadInterRanking: async () => rankingWith({ 'g:a': { name: 'A', pontos: 3, md1V: 1, md1D: 0, md3V: 0, md3D: 0, jogosV: 1, jogosD: 0 } }) }
    });
    assert.strictEqual(rNoArena.status, 'no_arena');

    const rOk = await postInterRankingUpdate({
      client, interConfig,
      deps: { loadInterRanking: async () => rankingWith({ 'g:a': { name: 'A', pontos: 3, md1V: 1, md1D: 0, md3V: 0, md3D: 0, jogosV: 1, jogosD: 0 } }) }
    });
    assert.strictEqual(rOk.status, 'posted');
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].content.includes('inter-servidores'));
  });
});
