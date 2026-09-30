const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../services/balanceService');

const eloSum = (team) => team.reduce((s, p) => s + p.baseMmr, 0);

describe('balanceamento de times', () => {
  it('usa so o elo do LoL e ignora os pontos custom', () => {
    const players = [
      { nickname: 'low-elo-muitas-wins', baseMmr: 1000, mmr: 2500 },
      { nickname: 'high-elo-muitas-losses', baseMmr: 2000, mmr: 1100 },
      { nickname: 'mid1', baseMmr: 1500, mmr: 1500 },
      { nickname: 'mid2', baseMmr: 1500, mmr: 1500 },
      { nickname: 'mid3', baseMmr: 1400, mmr: 1400 },
      { nickname: 'mid4', baseMmr: 1400, mmr: 1400 },
      { nickname: 'mid5', baseMmr: 1300, mmr: 1300 },
      { nickname: 'mid6', baseMmr: 1300, mmr: 1300 },
      { nickname: 'mid7', baseMmr: 1200, mmr: 1200 },
      { nickname: 'mid8', baseMmr: 1200, mmr: 1200 }
    ];

    const teams = B.createBalancedTeams(players);

    assert.equal(teams.teamOne.length, 5);
    assert.equal(teams.teamTwo.length, 5);
    assert.equal(eloSum(teams.teamOne), eloSum(teams.teamTwo));
    assert.equal(teams.difference, 0);
  });

  it('getBalanceWeight retorna o baseMmr (0 quando ausente)', () => {
    assert.equal(B.getBalanceWeight({ baseMmr: 1734 }), 1734);
    assert.equal(B.getBalanceWeight({ mmr: 2500 }), 0);
    assert.equal(B.getBalanceWeight({}), 0);
  });

  it('exige quantidade par de jogadores', () => {
    assert.throws(() => B.createBalancedTeams([{ baseMmr: 1 }]), /quantidade par/);
  });
});
