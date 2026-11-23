// ─── Estatisticas pos-partida (Match-V5 por PUUID) ──────────────────────────
// Roda em background depois do !vitoria manual em CLASSIC 5x5.
// A Riot leva de 30s a ~2min para indexar uma custom, entao tentamos algumas
// vezes com espera entre elas. Nunca lanca erro para fora: o !vitoria nao pode
// quebrar por causa das estatisticas.

const {
  buildMatchStatsEmbed,
  postMatchStatsLog
} = require('../../utils/lobbyUtils');

// 6 tentativas ao longo de ~6 minutos.
const RETRY_DELAYS_MS = [20_000, 25_000, 45_000, 60_000, 90_000, 120_000];
const RATE_LIMIT_DELAY_MS = 120_000;

const inflightKeys = new Set();

function isClassicFiveVersusFive(match) {
  return match?.mode === 'classic' && (match?.format || '5x5') === '5x5';
}

function collectKnownPlayers(match, statsData = null) {
  const players = [...(match?.teamOne || []), ...(match?.teamTwo || [])];

  const storedByDiscordId = new Map();
  for (const entry of Object.values(statsData?.players || {})) {
    if (entry?.discordId) storedByDiscordId.set(String(entry.discordId), entry);
  }

  const groups = [];
  const byPuuid = {};

  for (const player of players) {
    const stored = storedByDiscordId.get(String(player.discordId || ''));
    const puuids = [...new Set([
      player.puuid,
      stored?.puuid,
      ...(Array.isArray(stored?.altPuuids) ? stored.altPuuids : [])
    ].filter(Boolean).map((puuid) => String(puuid)))];

    if (!puuids.length) continue;

    const nickname = player.nickname || stored?.nickname || stored?.registeredNickname || null;
    groups.push({ discordId: player.discordId || null, nickname, puuids });

    for (const puuid of puuids) {
      byPuuid[puuid] = { discordId: player.discordId || null, nickname };
    }
  }

  return {
    groups,
    puuids: [...new Set(groups.flatMap((group) => group.puuids))],
    byPuuid
  };
}

function resolveStartTimeMs(match) {
  const parsed = Date.parse(match?.createdAt || '');
  if (Number.isFinite(parsed)) return parsed;
  return Date.now() - 2 * 60 * 60 * 1000;
}

async function resolvePlayers(context) {
  if (context.resolvedPlayers) return context.resolvedPlayers;

  const loadPlayerStats = context.deps?.loadPlayerStats;
  let statsData = null;
  if (typeof loadPlayerStats === 'function') {
    try {
      statsData = await loadPlayerStats();
    } catch (error) {
      console.error('[MATCH STATS] Falha ao carregar contas vinculadas:', error?.message || error);
    }
  }

  context.resolvedPlayers = collectKnownPlayers(context.match, statsData);
  return context.resolvedPlayers;
}

async function attemptPublish(context) {
  const {
    guild,
    match,
    winningTeam,
    startTimeMs,
    attempt,
    deps
  } = context;

  const riotService = deps.riotService || global.riotService;
  if (!riotService?.findCustomMatchByPuuids) return 'disabled';

  const { groups, puuids, byPuuid } = await resolvePlayers(context);
  if (groups.length < 3) return 'disabled';

  let matchData;
  try {
    matchData = await riotService.findCustomMatchByPuuids({ puuids, playerGroups: groups, startTimeMs });
  } catch (error) {
    if (error?.code === 'AUTH_FAILED') {
      console.error('[MATCH STATS] Chave da Riot invalida/expirada; estatisticas desativadas ate renovar a key.');
      return 'auth_failed';
    }
    if (error?.code === 'RATE_LIMITED') {
      console.warn('[MATCH STATS] Rate limit da Riot; vou tentar de novo mais tarde.');
      return 'rate_limited';
    }
    console.error('[MATCH STATS] Falha ao buscar a partida:', error?.message || error);
    return 'error';
  }

  if (!matchData) {
    console.log(`[MATCH STATS] Partida ainda nao encontrada (tentativa ${attempt + 1}/${RETRY_DELAYS_MS.length}).`);
    return 'not_found';
  }

  const embed = buildMatchStatsEmbed({
    match: matchData,
    playersByPuuid: byPuuid,
    winningTeam,
    letter: match.letter || '?',
    modeLabel: 'CLASSIC',
    formatLabel: '5x5'
  });

  try {
    const posted = await postMatchStatsLog(guild, embed);
    if (posted) {
      console.log(`[MATCH STATS] Estatisticas publicadas (lobby ${match.letter || '?'}, equipe ${winningTeam} vencedora).`);
      return 'posted';
    }
  } catch (error) {
    console.error('[MATCH STATS] Falha ao postar o embed:', error?.message || error);
  }

  return 'error';
}

function scheduleAttempt(context, retryIndex, delayOverride) {
  const delay = delayOverride ?? RETRY_DELAYS_MS[retryIndex] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

  const timer = setTimeout(async () => {
    let result;
    try {
      result = await attemptPublish({ ...context, attempt: retryIndex });
    } catch (error) {
      console.error('[MATCH STATS] Erro inesperado:', error?.message || error);
      result = 'error';
    }

    if (result === 'posted' || result === 'auth_failed' || result === 'disabled') {
      inflightKeys.delete(context.key);
      return;
    }

    const nextIndex = retryIndex + 1;
    if (nextIndex >= RETRY_DELAYS_MS.length) {
      inflightKeys.delete(context.key);
      console.log(`[MATCH STATS] Desisti apos ${RETRY_DELAYS_MS.length} tentativas (lobby ${context.match?.letter || '?'}).`);
      return;
    }

    const nextDelay = result === 'rate_limited' ? RATE_LIMIT_DELAY_MS : undefined;
    scheduleAttempt(context, nextIndex, nextDelay);
  }, delay);

  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * Dispara (em background) a busca e publicacao das estatisticas da partida.
 * Retorna false quando nada sera feito (modo errado, poucos puuids ou duplicado).
 */
function publishMatchStats({ guild, match, winningTeam, deps = {} } = {}) {
  if (!guild || !match) return false;
  if (!isClassicFiveVersusFive(match)) return false;

  const { groups } = collectKnownPlayers(match);
  if (groups.length < 3) {
    console.log(`[MATCH STATS] Ignorado: apenas ${groups.length} jogador(es) com conta vinculada na sala.`);
    return false;
  }

  const key = `${guild.id || 'guild'}:${match.createdAt || 'sem-data'}:${winningTeam}:${match.letter || '?'}`;
  if (inflightKeys.has(key)) return false;
  inflightKeys.add(key);

  scheduleAttempt({
    key,
    guild,
    match,
    winningTeam,
    startTimeMs: resolveStartTimeMs(match),
    deps
  }, 0);

  return true;
}

module.exports = {
  publishMatchStats,
  // expostos para testes
  isClassicFiveVersusFive,
  collectKnownPlayers,
  RETRY_DELAYS_MS
};
