// ─── Estatisticas pos-partida (Match-V5 por PUUID) ──────────────────────────
// Roda em background depois do !vitoria manual em CLASSIC 5x5.
// A Riot leva de 30s a ~2min para indexar uma custom, entao tentamos algumas
// vezes com espera entre elas. Nunca lanca erro para fora: o !vitoria nao pode
// quebrar por causa das estatisticas.

const config = require('../../config.json');
const {
  buildMatchStatsEmbed,
  postMatchStatsLog
} = require('../../utils/lobbyUtils');

// 6 tentativas ao longo de ~6 minutos.
const RETRY_DELAYS_MS = [20_000, 25_000, 45_000, 60_000, 90_000, 120_000];
const RATE_LIMIT_DELAY_MS = 120_000;

const inflightKeys = new Set();

// Cargos considerados "ancora": quem cria/hospeda as customs (Capitao, Staff e Admin).
// Basta UMA conta ancora dentro da partida para o bot achar a custom com seguranca.
function getAnchorRoleIds() {
  const configured = Array.isArray(config.roles?.anchorRoleIds) ? config.roles.anchorRoleIds : [];
  return [...new Set([...configured, config.roles?.captainRoleId].filter(Boolean).map(String))];
}

function isAnchorMember(member, anchorRoleIds = getAnchorRoleIds()) {
  if (!member) return false;
  try {
    if (member.permissions?.has?.('Administrator')) return true;
  } catch {
    /* sem permissoes resolvidas */
  }
  try {
    return anchorRoleIds.some((roleId) => member.roles?.cache?.has?.(roleId) === true);
  } catch {
    return false;
  }
}

// Marca quais jogadores da sala tem cargo ancora (Capitao/Staff/Admin).
// Roda uma vez por partida (o resultado fica cacheado em context.resolvedPlayers).
async function markAnchorPlayers(guild, groups) {
  if (!Array.isArray(groups) || groups.length === 0) return groups;
  const anchorRoleIds = getAnchorRoleIds();

  await Promise.all(groups.map(async (group) => {
    group.isAnchor = false;
    if (!group.discordId || !guild?.members) return;

    let member = guild.members.cache?.get?.(String(group.discordId)) || null;
    if (!member && typeof guild.members.fetch === 'function') {
      member = await guild.members.fetch(String(group.discordId)).catch(() => null);
    }
    if (!member) return;
    group.isAnchor = isAnchorMember(member, anchorRoleIds);
  }));

  return groups;
}

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
    groups.push({ discordId: player.discordId || null, nickname, puuids, isAnchor: false });

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
  await markAnchorPlayers(context.guild, context.resolvedPlayers.groups);
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
  if (groups.length === 0) return 'disabled';

  const anchorCount = groups.filter((group) => group.isAnchor).length;
  // Sem conta ancora (Capitao/Staff/Admin) exigimos pelo menos 3 contas conhecidas.
  if (anchorCount === 0 && groups.length < 3) {
    console.log('[MATCH STATS] Ignorado: sem conta ancora na sala e menos de 3 contas conhecidas.');
    return 'disabled';
  }

  if (attempt === 0) {
    console.log(`[MATCH STATS] ${groups.length} conta(s) conhecida(s), ${anchorCount} ancora(s) na sala.`);
  }

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
  if (groups.length < 1) {
    console.log('[MATCH STATS] Ignorado: nenhum jogador da sala tem conta vinculada.');
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
  getAnchorRoleIds,
  isAnchorMember,
  markAnchorPlayers,
  RETRY_DELAYS_MS
};
