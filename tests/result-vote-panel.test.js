const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseVoteButtonId,
  getMajorityThreshold,
  getMissingVoters,
  countVotes,
  buildResultVotePayload
} = require('../commands/handlers/resultVotePanel');

function mkMatch() {
  const teamOne = Array.from({ length: 5 }, (_, i) => ({ discordId: `t1-${i}`, nickname: `T1${i}` }));
  const teamTwo = Array.from({ length: 5 }, (_, i) => ({ discordId: `t2-${i}`, nickname: `T2${i}` }));
  return { letter: 'A', mode: 'classic', format: '5x5', teamOne, teamTwo, _matchId: 'classic-5x5-a' };
}

describe('painel de votacao de resultado (botoes)', () => {
  it('maioria dos 10 = 6', () => {
    assert.equal(getMajorityThreshold(10), 6);
  });

  it('maioria de formatos menores', () => {
    assert.equal(getMajorityThreshold(2), 2);
    assert.equal(getMajorityThreshold(4), 3);
  });

  it('parse do customId votewin:<matchId>:<time>', () => {
    assert.deepEqual(parseVoteButtonId('votewin:classic-5x5-a:1'), { matchId: 'classic-5x5-a', team: '1' });
    assert.equal(parseVoteButtonId('votewin:classic-5x5-a:3'), null);
    assert.equal(parseVoteButtonId('outro:id:1'), null);
  });

  it('faltantes = quem ainda nao votou', () => {
    const match = mkMatch();
    const missing = getMissingVoters(match, { 't1-0': '1', 't2-0': '2' });
    assert.equal(missing.length, 8);
    assert.ok(missing.every((p) => !['t1-0', 't2-0'].includes(p.discordId)));
  });

  it('payload do painel dentro do limite de 1024 chars por field', () => {
    const match = mkMatch();
    const payload = buildResultVotePayload({ match, votes: { 't1-0': '1', 't2-0': '2' }, threshold: 6 });
    const json = payload.embed.toJSON();
    for (const field of json.fields || []) {
      assert.ok(String(field.value).length <= 1024, `field "${field.name}" estourou 1024`);
    }
    assert.equal(payload.components.length, 1);
    assert.equal(payload.missing.length, 8);
    assert.deepEqual(payload.counts, { votesT1: 1, votesT2: 1, total: 2 });
  });

  it('contagem de votos', () => {
    assert.deepEqual(countVotes({ a: '1', b: '1', c: '2' }), { votesT1: 2, votesT2: 1, total: 3 });
  });
});
