// Helpers compartilhados dos testes: mocks em memoria com semantica fiel ao banco
// (load = clone profundo, save = sobrescreve o documento inteiro, como MongoDB/JSON).
const L = require('../utils/lobbyUtils');
const B = require('../services/balanceService');
const D = require('../services/dataService');
const { QUEUE_MODES } = require('../domain/constants/queueModes');
const { shouldMirrorAramGroupedStats } = require('../domain/queue/selection');

const clone = (o) => JSON.parse(JSON.stringify(o));

function mkPlayer(tag, baseMmr = 1200) {
  return {
    discordId: `dc-${tag}`,
    discordUsername: tag,
    nickname: `${tag}#br1`,
    puuid: `puuid-${tag}`,
    baseMmr,
    mmr: 1000 + baseMmr,
    internalRating: 1000 + baseMmr,
    customWins: 0,
    customLosses: 0,
    tier: 'GOLD',
    rank: 'IV',
    leaguePoints: 0,
    mode: 'classic',
    format: '5x5',
    joinedAt: new Date().toISOString()
  };
}

function mkMatch(letter, tags, mode = 'classic', format = '5x5') {
  const half = tags.length / 2;
  const ps = tags.map((t) => mkPlayer(`${letter}-${t}`));
  return {
    id: `${mode}-${format}-${letter.toLowerCase()}`,
    mode,
    format,
    letter,
    waitingChannelId: `wait-${letter}`,
    teamOneChannelId: `t1-${letter}`,
    teamTwoChannelId: `t2-${letter}`,
    requiredPlayers: tags.length,
    teamOne: ps.slice(0, half),
    teamTwo: ps.slice(half),
    teamSize: half,
    createdAt: new Date().toISOString()
  };
}

function mkStats(letters, perModeWins = 0) {
  const players = {};
  for (const l of letters) {
    for (let i = 1; i <= 10; i++) {
      const tag = `${l}-p${i}`;
      players[`puuid-${tag}`] = {
        discordId: `dc-${tag}`,
        nickname: `${tag}#br1`,
        puuid: `puuid-${tag}`,
        registeredNickname: `${tag}#br1`,
        registeredAt: new Date().toISOString(),
        baseMmr: 1200,
        internalRating: 2200,
        customWins: perModeWins,
        customLosses: 0,
        ratingVersion: 2,
        modes: {
          classic: { customWins: perModeWins, customLosses: 0, baseMmr: 1200, internalRating: 2200, winStreak: 0, ratingVersion: 2 }
        }
      };
    }
  }
  return { players };
}

function tenTags() {
  return ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
}

// Mundo com 2 partidas classic 5x5 ativas (A e B)
function makeTwoMatchWorld() {
  return {
    matches: {
      'classic-5x5-a': { active: true, votes: {}, match: mkMatch('A', tenTags()) },
      'classic-5x5-b': { active: true, votes: {}, match: mkMatch('B', tenTags()) }
    },
    stats: mkStats(['A', 'B'])
  };
}

function makeRegisterVictoryDeps(state) {
  return {
    QUEUE_MODES,
    withQueueOperationLock: D.withQueueOperationLock,
    loadCurrentMatch: async () => ({ matches: clone(state.matches) }),
    loadPlayerStats: async () => clone(state.stats),
    savePlayerStats: async (d) => { state.stats = clone(d); },
    saveCurrentMatch: async (d) => { state.matches = clone(d.matches); },
    getStoredPlayerStats: L.getStoredPlayerStats,
    getModeStats: L.getModeStats,
    normalizePlayerModes: L.normalizePlayerModes,
    getStatsBucketKey: L.getStatsBucketKey,
    upsertPlayerStats: L.upsertPlayerStats,
    shouldMirrorAramGroupedStats,
    calculateEloDelta: B.calculateEloDelta,
    getAramWeightByTeamSize: B.getAramWeightByTeamSize,
    formatCustomRecord: L.formatCustomRecord
  };
}

// Replica o parsing de args do victoryCommandHandlers (teamArgs vs selectorArgs)
function resolveVictoryTarget(currentMatchData, args, voiceChannelId) {
  const teamArgs = args.filter((a) => ['1', '2'].includes(String(a)));
  if (teamArgs.length !== 1) return { error: 'sintaxe' };
  const selectorArgs = args.filter((a) => String(a) !== teamArgs[0]);
  const entry = selectorArgs.length > 0
    ? L.findActiveMatchBySelector(currentMatchData, selectorArgs)
    : L.getActiveMatchEntry(currentMatchData, voiceChannelId);
  return { winningTeam: teamArgs[0], entry };
}

module.exports = {
  clone,
  mkPlayer,
  mkMatch,
  mkStats,
  tenTags,
  makeTwoMatchWorld,
  makeRegisterVictoryDeps,
  resolveVictoryTarget,
  QUEUE_MODES
};
