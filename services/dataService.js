const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { QUEUE_MODES } = require('../domain/constants/queueModes');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'caps-bot';
const DATA_DIR = path.join(__dirname, '..', 'database');

const LOCAL_FILES = {
  queue: { file: 'queue.json', fallback: { lobbies: {} } },
  playerStats: { file: 'playerStats.json', fallback: { players: {} } },
  currentMatch: { file: 'currentMatch.json', fallback: { matches: {} } },
  seasonMeta: {
    file: 'seasonMeta.json',
    fallback: {
      currentSeason: 1,
      startedAt: new Date().toISOString(),
      phase: 'testing',
      officialSeasonStarted: false,
      testingCycle: 1
    }
  },
  seasonHistory: { file: 'seasonHistory.json', fallback: { seasons: [] } },
  systemMeta: { file: 'systemMeta.json', fallback: { lastQueueMessageId: null } }
};

let client = null;
let db = null;
let storageMode = null;

function ensureLocalDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  for (const { file, fallback } of Object.values(LOCAL_FILES)) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    }
  }
}

function readLocalDoc(id, fallback) {
  ensureLocalDataFiles();
  const config = LOCAL_FILES[id];
  if (!config) return fallback;

  try {
    const filePath = path.join(DATA_DIR, config.file);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeLocalDoc(id, data) {
  ensureLocalDataFiles();
  const config = LOCAL_FILES[id];
  if (!config) return;

  const filePath = path.join(DATA_DIR, config.file);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function getDb() {
  if (db) return db;
  if (storageMode === 'local') return null;

  if (!MONGODB_URI) {
    storageMode = 'local';
    console.warn('[DB] MONGODB_URI ausente. Usando arquivos locais em database/.');
    return null;
  }

  try {
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db(DB_NAME);
    storageMode = 'mongo';
    console.log('[DB] Conectado ao MongoDB Atlas.');
    return db;
  } catch (error) {
    storageMode = 'local';
    db = null;
    client = null;
    console.warn(`[DB] Falha ao conectar no MongoDB (${error.code || error.name}: ${error.message}). Usando arquivos locais em database/.`);
    return null;
  }
}

async function ensureDataFiles() {
  const database = await getDb();
  if (!database) {
    ensureLocalDataFiles();
    return;
  }

  const col = database.collection('data');
  const defaults = [
    { _id: 'queue', data: { lobbies: {} } },
    { _id: 'playerStats', data: { players: {} } },
    { _id: 'currentMatch', data: { matches: {} } },
    {
      _id: 'seasonMeta',
      data: {
        currentSeason: 1,
        startedAt: new Date().toISOString(),
        phase: 'testing',
        officialSeasonStarted: false,
        testingCycle: 1
      }
    },
    { _id: 'seasonHistory', data: { seasons: [] } },
    { _id: 'systemMeta', data: { lastQueueMessageId: null } }
  ];

  for (const doc of defaults) {
    await col.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  }
}

async function readDoc(id, fallback) {
  const database = await getDb();
  if (!database) {
    return readLocalDoc(id, fallback);
  }

  const doc = await database.collection('data').findOne({ _id: id });
  return doc ? doc.data : fallback;
}

async function writeDoc(id, data) {
  const database = await getDb();
  if (!database) {
    writeLocalDoc(id, data);
    return;
  }

  await database.collection('data').updateOne(
    { _id: id },
    { $set: { data } },
    { upsert: true }
  );
}

const queueOperationLocks = new Map();

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

async function loadQueue() {
  const parsed = await readDoc('queue', { lobbies: {} });
  if (parsed.lobbies && typeof parsed.lobbies === 'object') return { lobbies: parsed.lobbies };
  return { lobbies: {} };
}

async function saveQueue(data) {
  await writeDoc('queue', data);
}

async function loadPlayerStats() {
  const parsed = await readDoc('playerStats', { players: {} });
  if (!parsed.players || typeof parsed.players !== 'object') return { players: {} };
  return parsed;
}

async function savePlayerStats(data) {
  await writeDoc('playerStats', data);
}

async function loadCurrentMatch() {
  const parsed = await readDoc('currentMatch', { matches: {} });
  if (parsed.matches && typeof parsed.matches === 'object') return { matches: parsed.matches };
  return { matches: {} };
}

async function saveCurrentMatch(data) {
  await writeDoc('currentMatch', data);
}

async function loadSeasonMeta() {
  const parsed = await readDoc('seasonMeta', {
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

async function saveSeasonMeta(data) {
  await writeDoc('seasonMeta', data);
}

async function loadSeasonHistory() {
  const parsed = await readDoc('seasonHistory', { seasons: [] });
  if (!Array.isArray(parsed.seasons)) return { seasons: [] };
  return parsed;
}

async function saveSeasonHistory(data) {
  await writeDoc('seasonHistory', data);
}

async function loadSystemMeta() {
  const parsed = await readDoc('systemMeta', { lastQueueMessageId: null });
  return { lastQueueMessageId: null, ...parsed };
}

async function saveSystemMeta(data) {
  await writeDoc('systemMeta', data);
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
  loadSystemMeta,
  saveSystemMeta,
  QUEUE_MODES
};
