/**
 * Script de migração: importa os dados dos ficheiros JSON para o MongoDB
 * Uso: node migrateToMongo.js
 * Requer MONGODB_URI no .env
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const URI = process.env.MONGODB_URI;
if (!URI) { console.error('MONGODB_URI não definida no .env'); process.exit(1); }

const DB_NAME = 'caps-bot';
const BASE = path.join(__dirname, 'database');

const files = {
  queue:         { file: 'queue.json',         fallback: { lobbies: {} } },
  playerStats:   { file: 'playerStats.json',   fallback: { players: {} } },
  currentMatch:  { file: 'currentMatch.json',  fallback: { matches: {} } },
  seasonMeta:    { file: 'seasonMeta.json',     fallback: { currentSeason: 1 } },
  seasonHistory: { file: 'seasonHistory.json', fallback: { seasons: [] } },
  systemMeta:    { file: 'systemMeta.json',     fallback: { lastQueueMessageId: null } },
};

async function migrate() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('data');

  for (const [id, { file, fallback }] of Object.entries(files)) {
    const filePath = path.join(BASE, file);
    let data = fallback;
    if (fs.existsSync(filePath)) {
      try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
    }
    await col.updateOne({ _id: id }, { $set: { data } }, { upsert: true });
    console.log(`✅ ${id} migrado.`);
  }

  await client.close();
  console.log('\nMigração concluída!');
}

migrate().catch(err => { console.error(err); process.exit(1); });
