const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../services/balanceService');
const { mkStats, tenTags } = require('./helpers');

// O !vitoria salva teamOne/teamTwo (discordId + nickname) no recentVictory,
// e o !rematch recoloca os 10 na fila COM os pesos de balance (baseMmr/mmr).
describe('!rematch', () => {
  it('recentVictory carrega os 2 times e o rematch preserva os pesos', () => {
    const stats = mkStats(['A']);

    // Simula os times salvos pelo !vitoria no recentVictory
    const recentVictory = {
      mode: 'classic',
      format: '5x5',
      letter: 'A',
      teamOne: tenTags().slice(0, 5).map((t) => ({ discordId: `dc-A-${t}`, nickname: `A-${t}#br1` })),
      teamTwo: tenTags().slice(5, 10).map((t) => ({ discordId: `dc-A-${t}`, nickname: `A-${t}#br1` }))
    };

    const allPlayers = [...(recentVictory.teamOne || []), ...(recentVictory.teamTwo || [])];
    assert.equal(allPlayers.length, 10);

    // Replica o enriquecimento do handleRematchCommand
    const L = require('../utils/lobbyUtils');
    const lobbyPlayers = allPlayers.map((player) => {
      const stored = L.getStoredPlayerStats(stats, { discordId: player.discordId, nickname: player.nickname });
      const modeStats = L.getModeStats(stored, 'classic', '5x5');
      const leagueMmr = Number(stored.baseMmr || modeStats.baseMmr || 1200);
      return {
        ...player,
        baseMmr: leagueMmr,
        mmr: B.calculateHybridMmr(leagueMmr, modeStats.customWins, modeStats.customLosses, modeStats.internalRating)
      };
    });

    assert.ok(lobbyPlayers.every((p) => p.baseMmr === 1200));
    assert.ok(lobbyPlayers.every((p) => p.mmr === 2200));

    // E esses 10 ainda balanceiam em times pares por elo
    const teams = B.createBalancedTeams(lobbyPlayers);
    assert.equal(teams.teamOne.length, 5);
    assert.equal(teams.teamTwo.length, 5);
    assert.equal(teams.difference, 0);
  });

  it('recentVictory sem times nao tem quem recolocar', () => {
    const recentVictory = { mode: 'classic', format: '5x5', letter: 'A' };
    const allPlayers = [...(recentVictory.teamOne || []), ...(recentVictory.teamTwo || [])];
    assert.equal(allPlayers.length, 0);
  });
});

describe('!rematch por letra (A, B, C)', () => {
  const { findRecentVictoryByLetter } = require('../commands/legacyCommands');

  const entry = (letter, secondsAgo, guildId = 'g1') => ({
    guildId,
    matchId: `classic-5x5-${letter.toLowerCase()}`,
    winnerTeam: '1',
    mode: 'classic',
    format: '5x5',
    letter,
    finishedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
    teamOne: [],
    teamTwo: []
  });

  it('acha a partida da letra pedida mesmo com A e B finalizadas', () => {
    const systemMeta = { recentVictories: [entry('B', 10), entry('A', 30)] };
    const found = findRecentVictoryByLetter(systemMeta, 'g1', 'A');
    assert.ok(found);
    assert.equal(found.matchId, 'classic-5x5-a');
  });

  it('letra minuscula funciona e prioriza a mais recente da mesma letra', () => {
    const systemMeta = { recentVictories: [entry('A', 5), entry('A', 100), entry('B', 10)] };
    const found = findRecentVictoryByLetter(systemMeta, 'g1', 'a');
    assert.ok(found);
    assert.equal(found.finishedAt, systemMeta.recentVictories[0].finishedAt);
  });

  it('retorna null para letra sem partida, expirada ou de outro servidor', () => {
    const systemMeta = { recentVictories: [entry('B', 10), entry('A', 30)] };
    assert.equal(findRecentVictoryByLetter(systemMeta, 'g1', 'C'), null);
    assert.equal(findRecentVictoryByLetter(systemMeta, 'g1', ''), null);
    assert.equal(findRecentVictoryByLetter(systemMeta, 'outra-guild', 'A'), null);

    const expired = { recentVictories: [entry('A', 300)] };
    assert.equal(findRecentVictoryByLetter(expired, 'g1', 'A'), null);
    assert.equal(findRecentVictoryByLetter({}, 'g1', 'A'), null);
  });
});
