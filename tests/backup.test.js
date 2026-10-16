const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backup = require('../services/backupService');

function fakeLoads(tag) {
  const fn = async () => ({ tag });
  return {
    loadQueue: fn, loadPlayerStats: fn, loadCurrentMatch: fn, loadSeasonMeta: fn,
    loadSeasonHistory: fn, loadSystemMeta: fn, loadVipSubscriptions: fn, loadContentTemplates: fn
  };
}

describe('backup diário do banco', () => {
  it('fotografa todos os docs e mantém só os 7 mais novos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
    try {
      // Preenche 8 backups antigos.
      for (let d = 1; d <= 8; d++) {
        fs.writeFileSync(path.join(dir, `backup-2026-09-${String(d).padStart(2, '0')}.json`), '{}');
      }
      // 07h05 SP de 16/10/2026 = 10:05Z.
      const r = await backup.runBackupTick(Date.UTC(2026, 9, 16, 10, 5, 0), {
        dataDir: dir,
        ...fakeLoads('x'),
        shouldRun: () => true
      });
      assert.equal(r.ok, true);
      assert.equal(r.fileName, 'backup-2026-10-16.json');
      const snap = JSON.parse(fs.readFileSync(path.join(dir, r.fileName), 'utf8'));
      for (const key of ['queue', 'playerStats', 'currentMatch', 'seasonMeta', 'seasonHistory', 'systemMeta', 'vipSubscriptions', 'contentTemplates']) {
        assert.deepEqual(snap[key], { tag: 'x' });
      }
      const remaining = backup.listBackups(dir);
      assert.equal(remaining.length, 7);
      assert.ok(!remaining.includes('backup-2026-09-01.json'));
      assert.ok(!remaining.includes('backup-2026-09-02.json'));
      // Segunda chamada no mesmo dia: pula.
      const r2 = await backup.runBackupTick(Date.UTC(2026, 9, 16, 10, 6, 0), { dataDir: dir, ...fakeLoads('y'), shouldRun: () => true });
      assert.equal(r2.skipped, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fora do horário pula sem tocar em disco', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
    try {
      let called = false;
      const r = await backup.runBackupTick(Date.UTC(2026, 9, 16, 15, 0, 0), {
        dataDir: dir,
        loadQueue: async () => { called = true; return {}; },
        loadPlayerStats: async () => ({}), loadCurrentMatch: async () => ({}),
        loadSeasonMeta: async () => ({}), loadSeasonHistory: async () => ({}),
        loadSystemMeta: async () => ({}), loadVipSubscriptions: async () => ({}),
        loadContentTemplates: async () => ({})
      });
      assert.equal(r.skipped, true);
      assert.equal(called, false);
      assert.deepEqual(backup.listBackups(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
