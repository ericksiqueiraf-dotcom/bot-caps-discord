const fs = require('fs');
const path = require('path');

const QUEUE_FILE_PATH = path.join(__dirname, '..', 'database', 'queue.json');
const PLAYER_STATS_FILE_PATH = path.join(__dirname, '..', 'database', 'playerStats.json');
const CURRENT_MATCH_FILE_PATH = path.join(__dirname, '..', 'database', 'currentMatch.json');
const SEASON_META_FILE_PATH = path.join(__dirname, '..', 'database', 'seasonMeta.json');
const SEASON_HISTORY_FILE_PATH = path.join(__dirname, '..', 'database', 'seasonHistory.json');

const QUEUE_MODES = {
  CLASSIC: 'classic',
  ARAM: 'aram'
};

const queueOperationLocks = new Map();

function ensureDataFiles() {
  const directory = path.dirname(QUEUE_FILE_PATH);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(QUEUE_FILE_PATH)) {
    fs.writeFileSync(QUEUE_FILE_PATH, JSON.stringify({ lobbies: {} }, null, 2));
  }

  if (!fs.existsSync(PLAYER_STATS_FILE_PATH)) {
    fs.writeFileSync(PLAYER_STATS_FILE_PATH, JSON.stringify({ players: {} }, null, 2));
  }

  if (!fs.existsSync(CURRENT_MATCH_FILE_PATH)) {
    fs.writeFileSync(CURRENT_MATCH_FILE_PATH, JSON.stringify({ matches: {} }, null, 2));
  }

  if (!fs.existsSync(SEASON_META_FILE_PATH)) {
    fs.writeFileSync(
      SEASON_META_FILE_PATH,
      JSON.stringify({ currentSeason: 1, startedAt: new Date().toISOString() }, null, 2)
    );
  }

  if (!fs.existsSync(SEASON_HISTORY_FILE_PATH)) {
    fs.writeFileSync(SEASON_HISTORY_FILE_PATH, JSON.stringify({ seasons: [] }, null, 2));
  }
}

function readJsonFile(filePath, fallbackValue) {
  ensureDataFiles();
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  return parsed ?? fallbackValue;
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function withQueueOperationLock(lockKey, operation) {
  const currentLock = queueOperationLocks.get(lockKey) || Promise.resolve();
  let releaseLock;
  const nextLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  queueOperationLocks.set(lockKey, currentLock.then(() => nextLock));
  await currentLock;

  try {
    return await operation();
  } finally {
    releaseLock();

    if (queueOperationLocks.get(lockKey) === nextLock) {
      queueOperationLocks.delete(lockKey);
    }
  }
}

function loadQueue() {
  const parsed = readJsonFile(QUEUE_FILE_PATH, { lobbies: {} });

  if (parsed.lobbies && typeof parsed.lobbies === 'object') {
    return { lobbies: parsed.lobbies };
  }

  if (Array.isArray(parsed.players) && parsed.players.length > 0) {
    return {
      lobbies: {
        legacy: {
          id: 'legacy',
          mode: parsed.mode || QUEUE_MODES.CLASSIC,
          format: parsed.mode === QUEUE_MODES.ARAM ? '5x5' : '5x5',
          letter: 'A',
          waitingChannelId: null,
          players: parsed.players,
          requiredPlayers: parsed.players.length,
          status: 'waiting'
        }
      }
    };
  }

  return { lobbies: {} };
}

function saveQueue(queueData) {
  writeJsonFile(QUEUE_FILE_PATH, queueData);
}

function loadPlayerStats() {
  const parsed = readJsonFile(PLAYER_STATS_FILE_PATH, { players: {} });

  if (!parsed.players || typeof parsed.players !== 'object') {
    return { players: {} };
  }

  return parsed;
}

function savePlayerStats(statsData) {
  writeJsonFile(PLAYER_STATS_FILE_PATH, statsData);
}

function loadCurrentMatch() {
  const parsed = readJsonFile(CURRENT_MATCH_FILE_PATH, { matches: {} });

  if (parsed.matches && typeof parsed.matches === 'object') {
    return { matches: parsed.matches };
  }

  if (parsed.active && parsed.match) {
    return {
      matches: {
        legacy: {
          active: true,
          match: parsed.match
        }
      }
    };
  }

  return { matches: {} };
}

function saveCurrentMatch(matchData) {
  writeJsonFile(CURRENT_MATCH_FILE_PATH, matchData);
}

function loadSeasonMeta() {
  const parsed = readJsonFile(SEASON_META_FILE_PATH, {
    currentSeason: 1,
    startedAt: new Date().toISOString(),
    phase: 'testing',
    officialSeasonStarted: false,
    testingCycle: 1
  });

  return {
    currentSeason: Number(parsed.currentSeason || 1),
    startedAt: parsed.startedAt || new Date().toISOString(),
    phase: parsed.phase === 'official' ? 'official' : 'testing',
    officialSeasonStarted: Boolean(parsed.officialSeasonStarted),
    testingCycle: Number(parsed.testingCycle || parsed.currentSeason || 1)
  };
}

function saveSeasonMeta(meta) {
  writeJsonFile(SEASON_META_FILE_PATH, meta);
}

function loadSeasonHistory() {
  const parsed = readJsonFile(SEASON_HISTORY_FILE_PATH, { seasons: [] });

  if (!Array.isArray(parsed.seasons)) {
    return { seasons: [] };
  }

  return parsed;
}

function saveSeasonHistory(history) {
  writeJsonFile(SEASON_HISTORY_FILE_PATH, history);
}

module.exports = {
  ensureDataFiles,
  withQueueOperationLock,
  loadQueue,
  saveQueue,
  loadPlayerStats,
  savePlayerStats,
  loadCurrentMatch,
  saveCurrentMatch,
  loadSeasonMeta,
  saveSeasonMeta,
  loadSeasonHistory,
  saveSeasonHistory,
  QUEUE_MODES
};
