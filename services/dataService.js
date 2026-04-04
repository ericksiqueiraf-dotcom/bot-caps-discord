const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'caps-bot';

const QUEUE_MODES = {
  CLASSIC: 'classic',
  ARAM: 'aram'
};

let client = null;
let db = null;

async function getDb() {
  if (db) return db;
  if (!MONGODB_URI) throw new Error('MONGODB_URI não foi configurada no arquivo .env.');
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('[DB] Conectado ao MongoDB Atlas.');
  return db;
}

// Garante que os documentos base existem (equivalente ao ensureDataFiles)
async function ensureDataFiles() {
  const database = await getDb();
  const col = database.collection('data');

  const defaults = [
    { _id: 'queue',         data: { lobbies: {} } },
    { _id: 'playerStats',   data: { players: {} } },
    { _id: 'currentMatch',  data: { matches: {} } },
    { _id: 'seasonMeta',    data: { currentSeason: 1, startedAt: new Date().toISOString(), phase: 'testing', officialSeasonStarted: false, testingCycle: 1 } },
    { _id: 'seasonHistory', data: { seasons: [] } },
    { _id: 'systemMeta',    data: { lastQueueMessageId: null } },
  ];

  for (const doc of defaults) {
    await col.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  }
}

async function readDoc(id, fallback) {
  const database = await getDb();
  const doc = await database.collection('data').findOne({ _id: id });
  return doc ? doc.data : fallback;
}

async function writeDoc(id, data) {
  const database = await getDb();
  await database.collection('data').updateOne(
    { _id: id },
    { $set: { data } },
    { upsert: true }
  );
}

// --- Lock de operações (mantido em memória, igual ao anterior) ---
const queueOperationLocks = new Map();

async function withQueueOperationLock(lockKey, operation) {
  const currentLock = queueOperationLocks.get(lockKey) || Promise.resolve();
  let releaseLock;
  const nextLock = new Promise((resolve) => { releaseLock = resolve; });
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

// --- Queue ---
async function loadQueue() {
  const parsed = await readDoc('queue', { lobbies: {} });
  if (parsed.lobbies && typeof parsed.lobbies === 'object') return { lobbies: parsed.lobbies };
  return { lobbies: {} };
}

async function saveQueue(data) {
  await writeDoc('queue', data);
}

// --- Player Stats ---
async function loadPlayerStats() {
  const parsed = await readDoc('playerStats', { players: {} });
  if (!parsed.players || typeof parsed.players !== 'object') return { players: {} };
  return parsed;
}

async function savePlayerStats(data) {
  await writeDoc('playerStats', data);
}

// --- Current Match ---
async function loadCurrentMatch() {
  const parsed = await readDoc('currentMatch', { matches: {} });
  if (parsed.matches && typeof parsed.matches === 'object') return { matches: parsed.matches };
  return { matches: {} };
}

async function saveCurrentMatch(data) {
  await writeDoc('currentMatch', data);
}

// --- Season Meta ---
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

// --- Season History ---
async function loadSeasonHistory() {
  const parsed = await readDoc('seasonHistory', { seasons: [] });
  if (!Array.isArray(parsed.seasons)) return { seasons: [] };
  return parsed;
}

async function saveSeasonHistory(data) {
  await writeDoc('seasonHistory', data);
}

// --- System Meta ---
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
