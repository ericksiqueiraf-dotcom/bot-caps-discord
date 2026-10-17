// Lê os nomes exportados por um módulo CommonJS SEM executá-lo (parse estático).
// Usado pelos testes de paridade (CAPS × LCL) e de schedulers.
const fs = require('node:fs');

function exportedNames(file) {
  const text = fs.readFileSync(file, 'utf8');
  const marker = text.indexOf('module.exports');
  if (marker < 0) return new Set();
  const open = text.indexOf('{', marker);
  if (open < 0) return new Set();
  const close = text.lastIndexOf('};');
  if (close < open) return new Set();

  const body = text
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const names = new Set();
  for (const raw of body.split(/[,\n]/)) {
    const hit = raw.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|,|$)/);
    if (hit) names.add(hit[1]);
  }
  return names;
}

module.exports = { exportedNames };
