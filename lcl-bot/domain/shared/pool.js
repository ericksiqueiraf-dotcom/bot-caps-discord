// Regras puras do pool compartilhado entre servidores.
// Sem dependencia de Discord ou banco.
//
// Guilds com sharedMatchmaking=true dividem o pool `shared:<mode>:<format>`;
// as demais usam o caminho local, inalterado.

const SHARED_LOCK = 'shared:global:queue';

function isSharedGuild(guildSetting) {
  return Boolean(guildSetting && guildSetting.sharedMatchmaking);
}

// Chave da waitingList: mesma serie compartilha entre guilds opt-in.
function getSharedWaitingListKey(mode, format, tier = null) {
  if (mode === 'classic' && tier === 'S') return `shared:classic:${format || '5x5'}:s`;
  return `shared:${mode}:${format || '5x5'}`;
}

function getLocalWaitingListKey(mode, format, tier = null) {
  if (mode === 'classic' && tier === 'S') return `classic:${format || '5x5'}:s`;
  return `${mode}:${format || '5x5'}`;
}

// Guilds de origem distintas presentes no lobby.
function lobbyOriginGuilds(lobby) {
  const set = new Set();
  for (const p of lobby?.players || []) {
    if (p.originGuildId) set.add(String(p.originGuildId));
  }
  return [...set];
}

// Eleicao do destino: maioria de origem; empate usa o desempate:
// 'last' (guild que completou), 'least-load' (menos matches ativos) ou
// preferredHostGuildId quando configurado.
function electDestinationGuild(lobby, opts = {}) {
  const counts = new Map();
  for (const p of lobby?.players || []) {
    const g = String(p.originGuildId || opts.fallbackGuildId || '');
    if (!g) continue;
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  if (counts.size === 0) return String(opts.fallbackGuildId || '');
  if (opts.preferredHostGuildId && counts.has(String(opts.preferredHostGuildId))) {
    return String(opts.preferredHostGuildId);
  }
  let best = null;
  let bestCount = -1;
  for (const [guildId, count] of counts) {
    if (count > bestCount) {
      best = guildId;
      bestCount = count;
      continue;
    }
    if (count === bestCount) {
      // Empate: ultimo a completar vence ('last'), senao menor carga.
      if (opts.tiebreak === 'least-load' && opts.loads) {
        const loadBest = Number(opts.loads[best] ?? 0);
        const loadCur = Number(opts.loads[guildId] ?? 0);
        if (loadCur < loadBest) best = guildId;
      } else if (String(opts.lastJoinedGuildId || '') === String(guildId)) {
        best = guildId;
      }
    }
  }
  return best;
}

// Jogadores que precisam de invite (origem != destino).
function playersNeedingInvite(players, destinationGuildId) {
  return (players || []).filter((p) => String(p.originGuildId || '') !== String(destinationGuildId || ''));
}

module.exports = {
  SHARED_LOCK,
  isSharedGuild,
  getSharedWaitingListKey,
  getLocalWaitingListKey,
  lobbyOriginGuilds,
  electDestinationGuild,
  playersNeedingInvite
};
