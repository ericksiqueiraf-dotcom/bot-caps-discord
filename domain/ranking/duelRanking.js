// ─── Rank do Duelo (Top 10) ──────────────────────────────────────────────────
// Monta o ranking do `!duelo` a partir de `systemMeta.duelos`
// ([ { id, a, b, pontos, status, createdAt, winnerId? } ]).
//
// Regras:
//   - Só entram duelos `concluido` (são os que foram liquidados no pós-vitória);
//   - Em temporada OFICIAL, só contam os duelos criados depois do início da
//     temporada (`seasonMeta.startedAt`) — assim o rank zera junto com a season;
//   - Ordena por VITÓRIAS em duelo; desempate pelo PDL líquido ganho
//     (ganho nos duelos vencidos menos perdido nos duelos perdidos);
//   - O formato de saída é o mesmo dos outros rankings (ver playerStats.js),
//     para reaproveitar o `buildTopTenEmbed` / `buildLeaderboardEmbed`.

function duelWithinSeason(duel, cutoff) {
  if (!cutoff) return true;
  const at = new Date(duel?.createdAt || 0).getTime();
  if (!Number.isFinite(at) || at <= 0) return true;
  return at >= cutoff;
}

function seasonCutoff(seasonMeta) {
  if (!seasonMeta || seasonMeta.phase !== 'official' || !seasonMeta.startedAt) return 0;
  const at = new Date(seasonMeta.startedAt).getTime();
  return Number.isFinite(at) ? at : 0;
}

/** Agrega os duelos concluídos por discordId. */
function aggregateDuels(duelos = [], seasonMeta = null) {
  const cutoff = seasonCutoff(seasonMeta);
  const byId = new Map();

  const bucket = (discordId) => {
    const key = String(discordId);
    if (!byId.has(key)) {
      byId.set(key, { discordId: key, duelWins: 0, duelLosses: 0, duelPointsWon: 0, duelPointsLost: 0 });
    }
    return byId.get(key);
  };

  for (const duel of duelos || []) {
    if (!duel || duel.status !== 'concluido' || !duel.winnerId) continue;
    if (!duelWithinSeason(duel, cutoff)) continue;

    const loserId = String(duel.winnerId) === String(duel.a) ? duel.b : duel.a;
    if (!loserId) continue;

    const pontos = Number(duel.pontos || 0);
    const winner = bucket(duel.winnerId);
    winner.duelWins += 1;
    winner.duelPointsWon += pontos;

    const loser = bucket(loserId);
    loser.duelLosses += 1;
    loser.duelPointsLost += pontos;
  }

  return byId;
}

function findPlayerByDiscordId(statsData, discordId) {
  return Object.values(statsData?.players || {})
    .find((player) => player && String(player.discordId || '') === String(discordId)) || null;
}

/**
 * @returns {Array<object>} entradas no formato dos outros rankings
 *   (discordId, nickname, customWins, customLosses, adjustedMmr, customScore, winRate...)
 */
function getRankedPlayersByDuel(duelos = [], statsData = {}, seasonMeta = null) {
  const aggregated = aggregateDuels(duelos, seasonMeta);
  if (aggregated.size === 0) return [];

  return [...aggregated.values()]
    .filter((entry) => entry.duelWins + entry.duelLosses > 0)
    .map((entry) => {
      const player = findPlayerByDiscordId(statsData, entry.discordId);
      const totalGames = entry.duelWins + entry.duelLosses;
      const net = entry.duelPointsWon - entry.duelPointsLost;

      return {
        discordId: entry.discordId,
        nickname: player?.registeredNickname || player?.nickname || entry.discordId,
        baseMmr: Number(player?.modes?.classic?.baseMmr ?? player?.baseMmr ?? 0),
        customWins: entry.duelWins,
        customLosses: entry.duelLosses,
        totalGames,
        adjustedMmr: net,
        customScore: net,
        duelWins: entry.duelWins,
        duelLosses: entry.duelLosses,
        duelPointsWon: entry.duelPointsWon,
        duelPointsLost: entry.duelPointsLost,
        duelPoints: net,
        winRate: totalGames > 0 ? ((entry.duelWins / totalGames) * 100).toFixed(0) : '0',
        winStreak: 0
      };
    })
    .sort((a, b) =>
      b.duelWins - a.duelWins
      || b.duelPoints - a.duelPoints
      || String(a.nickname).localeCompare(String(b.nickname))
    );
}

module.exports = {
  aggregateDuels,
  getRankedPlayersByDuel,
  seasonCutoff
};
