// ─── Parser de contas Riot no cadastro ──────────────────────────────────────
// O nome de invocador pode ter espacos (ex.: "PAYASUO ASSASINO#SHACO"), entao
// nao da para simplesmente quebrar por espaco. A regra e: cada conta termina
// no token que contem "#". Assim:
//   "Nick#TAG"                       -> ["Nick#TAG"]
//   "PAYASUO ASSASINO#SHACO"         -> ["PAYASUO ASSASINO#SHACO"]
//   "Nick1#TAG Nick2#TAG"            -> ["Nick1#TAG", "Nick2#TAG"]
//   "Nick Com Espaco#TAG Outro#TAG"  -> ["Nick Com Espaco#TAG", "Outro#TAG"]
// Separadores como "," e ";" tambem funcionam.

const MAX_ACCOUNTS = 2;

function splitRiotIdInput(input) {
  const tokens = String(input || '')
    .replace(/\s*[,;]\s*/g, ' ')
    .replace(/\s+\+\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const accounts = [];
  let current = [];

  for (const token of tokens) {
    current.push(token);
    if (token.includes('#')) {
      accounts.push(current.join(' ').trim());
      current = [];
    }
  }

  if (current.length) accounts.push(current.join(' ').trim());

  return accounts.filter(Boolean);
}

function isValidRiotIdFormat(value) {
  const text = String(value || '').trim();
  if (!text.includes('#')) return false;
  const [gameName, tagLine, ...rest] = text.split('#');
  return Boolean(gameName.trim()) && Boolean(tagLine.trim()) && rest.length === 0;
}

module.exports = {
  MAX_ACCOUNTS,
  splitRiotIdInput,
  isValidRiotIdFormat
};
