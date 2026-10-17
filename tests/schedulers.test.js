// Garante que todo scheduler/poller EXPORTADO por um módulo de serviço/handler
// é de fato INICIADO no boot do bot. Essa classe de bug (declarado, exportado e
// nunca chamado) já aconteceu: o `startTorneioScheduler` ficou sem ser chamado
// por muito tempo — o torneio nunca abria nem fechava sozinho.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { exportedNames } = require('./lib/module-exports');

const ROOT = path.join(__dirname, '..');

const TARGETS = [
  { bot: 'CAPS', root: ROOT, indexFile: path.join(ROOT, 'index.js') },
  { bot: 'LCL', root: path.join(ROOT, 'lcl-bot'), indexFile: path.join(ROOT, 'lcl-bot', 'index.js') }
];

// Pastas onde schedulers podem viver (relativas à raiz de cada bot).
const SCAN_DIRS = ['services', path.join('commands', 'handlers')];

const SCHEDULER_RE = /^start[A-Z].*(Scheduler|Poller)$/;

function schedulersIn(botRoot) {
  const out = [];
  for (const rel of SCAN_DIRS) {
    const dir = path.join(botRoot, rel);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js')) continue;
      for (const name of exportedNames(path.join(dir, file))) {
        if (SCHEDULER_RE.test(name)) out.push({ file: path.join(rel, file), name });
      }
    }
  }
  return out;
}

describe('schedulers/pollers ligados no boot', () => {
  for (const target of TARGETS) {
    const indexText = fs.readFileSync(target.indexFile, 'utf8');
    const schedulers = schedulersIn(target.root);

    it(`${target.bot}: encontrou schedulers/pollers exportados`, () => {
      assert.ok(schedulers.length > 0, `nenhum scheduler exportado em ${target.root}`);
    });

    for (const { file, name } of schedulers) {
      it(`${target.bot}: ${name} (${file}) é chamado no index.js`, () => {
        const called = new RegExp(`\\b${name}\\s*\\(`).test(indexText);
        assert.ok(
          called,
          `${name} é exportado por ${file} mas nunca é iniciado em ${path.basename(target.indexFile)}`
        );
      });
    }
  }
});
