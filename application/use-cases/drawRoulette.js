const crypto = require('crypto');

function drawRoulette(pool = [], count = 1) {
  const eligible = Array.isArray(pool) ? [...pool] : [];
  const n = Math.max(0, Math.min(Number(count || 0), eligible.length));

  // Fisher-Yates parcial com crypto (sorteio justo)
  for (let i = eligible.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  const leaving = eligible.slice(0, n);
  const staying = eligible.slice(n);
  return { leaving, staying };
}

module.exports = {
  drawRoulette
};
