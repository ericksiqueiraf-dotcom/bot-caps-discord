// Backup diário do banco (07h SP): fotografa todos os docs em
// database/backup-YYYY-MM-DD.json e mantém os últimos 7.
const fs = require('fs');
const path = require('path');

const BACKUP_KEEP = 7;
const BACKUP_PREFIX = 'backup-';

function backupDir(dataDir) {
  return dataDir;
}

function listBackups(dataDir) {
  try {
    return fs.readdirSync(dataDir)
      .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

async function runBackupTick(nowMs = Date.now(), deps = {}) {
  const {
    dataDir = path.join(__dirname, '..', 'database'),
    loadQueue = require('./dataService').loadQueue,
    loadPlayerStats = require('./dataService').loadPlayerStats,
    loadCurrentMatch = require('./dataService').loadCurrentMatch,
    loadSeasonMeta = require('./dataService').loadSeasonMeta,
    loadSeasonHistory = require('./dataService').loadSeasonHistory,
    loadSystemMeta = require('./dataService').loadSystemMeta,
    loadVipSubscriptions = require('./dataService').loadVipSubscriptions,
    loadContentTemplates = require('./dataService').loadContentTemplates,
    shouldRun,
    onDone
  } = deps;
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date(nowMs)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]);
  const obj = Object.fromEntries(parts);
  if (typeof shouldRun === 'function') {
    if (!shouldRun({ day: obj.day, hour: obj.hour })) return { skipped: true };
  } else if (!(obj.day && Number(obj.hour) === 7)) {
    return { skipped: true };
  }
  const key = `${obj.year}-${obj.month}-${obj.day}`;
  const fileName = `${BACKUP_PREFIX}${key}.json`;
  const filePath = path.join(backupDir(dataDir), fileName);
  if (fs.existsSync(filePath)) return { skipped: true, reason: 'ja-existe' };
  const snapshot = {
    backedUpAt: new Date(nowMs).toISOString(),
    queue: await loadQueue(),
    playerStats: await loadPlayerStats(),
    currentMatch: await loadCurrentMatch(),
    seasonMeta: await loadSeasonMeta(),
    seasonHistory: await loadSeasonHistory(),
    systemMeta: await loadSystemMeta(),
    vipSubscriptions: await loadVipSubscriptions(),
    contentTemplates: await loadContentTemplates()
  };
  fs.writeFileSync(filePath, JSON.stringify(snapshot));
  const pruned = [];
  const all = listBackups(backupDir(dataDir));
  while (all.length > BACKUP_KEEP) {
    const oldest = all.shift();
    try { fs.unlinkSync(path.join(backupDir(dataDir), oldest)); pruned.push(oldest); } catch { /* segue */ }
  }
  if (typeof onDone === 'function') await onDone({ fileName, pruned });
  return { ok: true, fileName, pruned };
}

function startBackupScheduler() {
  setInterval(() => {
    runBackupTick(Date.now()).catch((err) => console.error('[BACKUP] Erro:', err.message));
  }, 5 * 60 * 1000).unref?.();
}

module.exports = {
  BACKUP_KEEP,
  BACKUP_PREFIX,
  listBackups,
  runBackupTick,
  startBackupScheduler
};
