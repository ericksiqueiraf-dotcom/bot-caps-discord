const { ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const config = require('../config.json');
const { QUEUE_MODES } = require('../domain/constants/queueModes');
const { KNOWN_ARAM_FORMATS, isGroupedAramStreakFormat, normalizeQueueFormat } = require('../domain/constants/queueFormats');
const {
  createEmptyModeStats,
  getStatsBucketKey,
  normalizePlayerModes,
  getModeStats,
  getTopStreakModeStats,
  getRankedPlayersByMode,
  getRankedPlayersByStreak
} = require('../domain/ranking/playerStats');
const { 
  loadQueue, saveQueue, loadSystemMeta, saveSystemMeta, 
  loadPlayerStats, savePlayerStats, loadSeasonMeta, 
  loadSeasonHistory, saveSeasonHistory 
} = require('../services/dataService');
const { calculateSeedRating, calculateHybridMmr, calculateEloDelta, RATING_VERSION, DEFAULT_CUSTOM_POINTS } = require('../services/balanceService');

const THEME = {
  SUCCESS: '#00ff88',
  ERROR: '#ff4d4d',
  INFO: '#00c3ff',
  WARNING: '#ffaa00',
  RANK: '#ffd700'
};

const FOOTER_PREFIX = 'Caps Bot';

let lastDailyRankPostKey = null;

function getRankName(mmr) {
  const val = Number(mmr || 0);
  if (val < 400) return 'Ferro';
  if (val < 800) return 'Bronze';
  if (val < 1200) return 'Prata';
  if (val < 1600) return 'Ouro';
  if (val < 2000) return 'Platina';
  if (val < 2400) return 'Esmeralda';
  if (val < 2800) return 'Diamante';
  if (val < 3200) return 'Mestre';
  if (val < 3600) return 'GraoMestre';
  return 'Desafiante';
}

const RANK_ROLES_MAP = {
  Ferro: ['Ferro'],
  Bronze: ['🥉Bronze', 'Bronze'],
  Prata: ['🥈Prata', 'Prata'],
  Ouro: ['🥇Ouro', 'Ouro'],
  Platina: ['🔷Platina', 'Platina'],
  Esmeralda: ['Esmeralda', 'Mestre Esmeralda'],
  Diamante: ['💎Diamante', 'Diamante'],
  Mestre: ['Mestre'],
  GraoMestre: ['Grão Mestre', 'Grao Mestre'],
  Desafiante: ['Desafiante']
};

const ALL_RANK_ROLE_NAMES = [
  'Ferro',
  '🥉Bronze', '🥉 Bronze', 'Bronze',
  '🥈Prata', '🥈 Prata', 'Prata',
  '🥇Ouro', '🥇 Ouro', 'Ouro',
  '🔷Platina', '🔷 Platina', 'Platina',
  'Esmeralda', 'Mestre Esmeralda',
  '💎Diamante', '💎 Diamante', '💎 DIAMANTE', 'Diamante',
  'Mestre',
  'Grão Mestre', 'Grao Mestre',
  'Desafiante'
];

const RANK_ROLE_PATTERNS = [
  { key: 'GraoMestre', needle: 'graomestre' },
  { key: 'Desafiante', needle: 'desafiante' },
  { key: 'Diamante', needle: 'diamante' },
  { key: 'Esmeralda', needle: 'mestreesmeralda' },
  { key: 'Esmeralda', needle: 'esmeralda' },
  { key: 'Platina', needle: 'platina' },
  { key: 'Ouro', needle: 'ouro' },
  { key: 'Prata', needle: 'prata' },
  { key: 'Bronze', needle: 'bronze' },
  { key: 'Mestre', needle: 'mestre' },
  { key: 'Ferro', needle: 'ferro' }
];

function normalizeRoleName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function getRankTierFromRoleName(roleName) {
  const normalized = normalizeRoleName(roleName);
  return RANK_ROLE_PATTERNS.find((entry) => normalized.includes(entry.needle))?.key || null;
}

function getPreferredRankRoleNames(rankTier) {
  const mapped = RANK_ROLES_MAP[rankTier];
  if (!mapped) return [];
  return Array.isArray(mapped) ? mapped : [mapped];
}

function findRankRole(guild, rankTier) {
  const roles = guild.roles.cache;

  for (const preferredName of getPreferredRankRoleNames(rankTier)) {
    const preferredNormalized = normalizeRoleName(preferredName);
    const exact = roles.find((role) => normalizeRoleName(role.name) === preferredNormalized);
    if (exact) return exact;
  }

  return roles.find((role) => getRankTierFromRoleName(role.name) === rankTier) || null;
}

function isRankRole(role) {
  if (!role) return false;
  const normalizedName = role.name.replace(/\s+/g, '').toLowerCase();
  if (ALL_RANK_ROLE_NAMES.some((name) => name.replace(/\s+/g, '').toLowerCase() === normalizedName)) {
    return true;
  }
  return Boolean(getRankTierFromRoleName(role.name));
}

const MVP_ROLE_NAMES = [config.roles?.mvpPlayerRoleName || 'MVP player', '⭐ MVP'];
const INFERNAL_ROLE_NAME = config.roles?.infernalRoleName || 'INFERNAL';
const INFERNAL_STREAK = 5;
const MVP_VOTE_DURATION_MS = 2 * 60 * 1000;
const pendingMvpVotes = new Map();
const mvpVoteTimeouts = new Map();

function getSeasonDisplayLabel(seasonMeta) {
  if (seasonMeta.phase === 'official') {
    return `Temporada #${seasonMeta.currentSeason}`;
  }

  return `Fase de Testes #${seasonMeta.testingCycle || 1}`;
}

function formatDateTimeForHistory(dateInput) {
  if (!dateInput) return 'N/A';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'N/A';

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getArchivedSeasonLabel(season) {
  if (season.label) {
    return season.label;
  }

  if (season.type === 'official') {
    return `Temporada #${season.seasonNumber}`;
  }

  if (season.type === 'testing') {
    return season.testingCycle ? `Fase de Testes #${season.testingCycle}` : `Pre-Temporada`;
  }

  return `Temporada #${season.seasonNumber}`;
}
function getQueueChannel(guild) {
  return {
    classicQueueChannel: guild.channels.cache.get(config.voiceChannels.classicQueueChannelId),
    aramQueueChannel: guild.channels.cache.get(config.voiceChannels.aramQueueChannelId)
  };
}


const TIER_S_MIN_MMR = Number(config.tierS?.minBaseMmr || 2000);
const TIER_S_TIERS = (config.tierS?.tiers || ['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'])
  .map((tier) => String(tier || '').toUpperCase());

function isTierSTier(tier) {
  return TIER_S_TIERS.includes(String(tier || '').toUpperCase());
}

function isTierSEligibleByStats({ baseMmr, tier } = {}) {
  if (isTierSTier(tier)) return true;
  return Number(baseMmr || 0) >= TIER_S_MIN_MMR;
}

function isTierSEligibleMember(member, storedEntry) {
  if (isTierSEligibleByStats({ baseMmr: storedEntry?.baseMmr, tier: storedEntry?.tier })) return true;
  if (isTierSEligibleByStats({ baseMmr: storedEntry?.modes?.classic?.baseMmr, tier: storedEntry?.tier })) return true;
  if (!member?.roles?.cache) return false;
  for (const role of member.roles.cache.values()) {
    const rankTier = getRankTierFromRoleName(role.name);
    if (!rankTier) continue;
    // getRankTierFromRoleName retorna 'GraoMestre'; normaliza para GRANDMASTER
    const normalized = String(rankTier).toUpperCase() === 'GRAOMESTRE' ? 'GRANDMASTER' : String(rankTier).toUpperCase();
    // Esmeralda vem como 'Esmeralda' -> EMERALD
    const mapped = normalized === 'ESMERALDA' ? 'EMERALD' : normalized === 'DESAFIANTE' ? 'CHALLENGER' : normalized === 'MESTRE' ? 'MASTER' : normalized;
    if (TIER_S_TIERS.includes(mapped)) return true;
  }
  return false;
}

function getClassicTierSQueueChannelId() {
  return config.voiceChannels.classicTierSQueueChannelId || null;
}

function isTierSVoiceChannel(channelId) {
  const tierSId = getClassicTierSQueueChannelId();
  return Boolean(tierSId && channelId && String(channelId) === String(tierSId));
}

function getLobbyTier(lobby) {
  if (!lobby) return 'normal';
  if (lobby.tier === 'S') return 'S';
  if (isTierSVoiceChannel(lobby.waitingChannelId)) return 'S';
  return 'normal';
}

function isMemberInQueueVoiceChannel(member, mode) {
  const voiceChannel = member.voice?.channel;

  if (!voiceChannel) {
    return false;
  }

  if (mode === QUEUE_MODES.ARAM) {
    return voiceChannel.id === config.voiceChannels.aramQueueChannelId;
  }

  return voiceChannel.id === config.voiceChannels.classicQueueChannelId
    || isTierSVoiceChannel(voiceChannel.id);
}

function isMemberInTierSVoiceChannel(member) {
  return Boolean(member?.voice?.channel && isTierSVoiceChannel(member.voice.channel.id));
}

function isStaffBypass(member) {
  if (!member) return false;
  try {
    if (member.permissions?.has('ManageMessages') || member.permissions?.has('Administrator')) return true;
  } catch { /* sem permissoes resolvidas */ }
  const captainRoleId = config.roles?.captainRoleId;
  try {
    if (captainRoleId && member.roles?.cache?.has(captainRoleId)) return true;
  } catch { /* sem cargos */ }
  return false;
}

function formatRank(player) {
  if (player.isFallbackUnranked) {
    return 'UNRANKED - Base Gold IV';
  }

  return `${player.tier} ${player.rank} - ${player.leaguePoints} PDL`;
}

function formatQueueMode(mode) {
  return mode === QUEUE_MODES.ARAM ? 'ARAM' : 'CLASSIC';
}

function getStatsBucketLabel(mode, format = null) {
  if (mode === QUEUE_MODES.ARAM) {
    const normalizedFormat = normalizeQueueFormat(format);
    if (isGroupedAramStreakFormat(normalizedFormat)) {
      return 'ARAM 2X2/3X3/4X4';
    }

    return normalizedFormat && normalizedFormat !== '5x5' ? `ARAM ${normalizedFormat}`.toUpperCase() : 'ARAM';
  }

  return 'CLASSIC';
}

function getAramFormatLabel(teamSize) {
  return `${teamSize}x${teamSize}`;
}

/** Multiplicador do delta de MMR interno em ARAM 5v5 vs CLASSIC (1.0 = Summoner's Rift). */
const ARAM_5V5_RATING_WEIGHT = 0.3;

function getAramWeightByTeamSize(teamSize) {
  const numericTeamSize = Number(teamSize || 0);

  if (numericTeamSize === 1) {
    return 1.4;
  }

  if (numericTeamSize === 2) {
    return 0.65;
  }

  if (numericTeamSize === 3) {
    return 0.8;
  }

  if (numericTeamSize === 4) {
    return 1.0;
  }

  if (numericTeamSize === 5) {
    return ARAM_5V5_RATING_WEIGHT;
  }

  return 1.0;
}

function getRequiredPlayersLabel(queueData) {
  if (queueData.mode === QUEUE_MODES.ARAM) {
    return '2, 4, 6, 8 ou 10 jogadores';
  }

  return '10 jogadores';
}

function isValidQueueSize(queueData) {
  const totalPlayers = queueData.players.length;

  if (queueData.mode === QUEUE_MODES.ARAM) {
    return [2, 4, 6, 8, 10].includes(totalPlayers);
  }

  return totalPlayers === 10;
}

function getRequiredPlayersByModeAndFormat(mode, format) {
  if (mode === QUEUE_MODES.ARAM) {
    const teamSize = Number(String(format || '1x1').split('x')[0]);
    return teamSize * 2;
  }

  return 10;
}

function getFormatFromArgs(mode, args) {
  if (mode !== QUEUE_MODES.ARAM) {
    return '5x5';
  }

  const normalizedArgs = args.map((arg) => normalizeQueueFormat(arg));
  const detectedFormat = normalizedArgs.find((arg) => KNOWN_ARAM_FORMATS.includes(arg));

  if (detectedFormat) {
    return detectedFormat;
  }

  return '5x5';
}

function getNicknameArgs(mode, args, format) {
  if (mode === QUEUE_MODES.ARAM) {
    const normalizedFormat = String(format || '').toLowerCase();
    let removedAram = false;
    let removedFormat = false;

    return args.filter((arg) => {
      const normalizedArg = String(arg || '').toLowerCase();

      if (!removedAram && normalizedArg === QUEUE_MODES.ARAM) {
        removedAram = true;
        return false;
      }

      if (!removedFormat && normalizedArg === normalizedFormat) {
        removedFormat = true;
        return false;
      }

      return true;
    });
  }

  return args;
}

function numberToLobbyLetter(value) {
  let current = value;
  let result = '';

  while (current >= 0) {
    result = String.fromCharCode((current % 26) + 65) + result;
    current = Math.floor(current / 26) - 1;
  }

  return result;
}

function getReservedLobbyLetters(queueData, currentMatchData, mode, format) {
  const waitingLetters = Object.values(queueData.lobbies || {})
    .filter((lobby) => lobby.mode === mode && lobby.format === format)
    .map((lobby) => lobby.letter);
  const activeLetters = Object.values(currentMatchData?.matches || {})
    .filter((entry) => entry.active && entry.match && entry.match.mode === mode && entry.match.format === format)
    .map((entry) => entry.match.letter);

  return new Set([...waitingLetters, ...activeLetters].filter(Boolean));
}

function getNextLobbyLetter(queueData, currentMatchData, mode, format) {
  const letters = getReservedLobbyLetters(queueData, currentMatchData, mode, format);

  let index = 0;

  while (letters.has(numberToLobbyLetter(index))) {
    index += 1;
  }

  return numberToLobbyLetter(index);
}

function getBaseQueueChannelIdByMode(mode, tier = null) {
  if (mode === QUEUE_MODES.ARAM) return config.voiceChannels.aramQueueChannelId;
  if (tier === 'S' || tier === 'TIERS') return getClassicTierSQueueChannelId() || config.voiceChannels.classicQueueChannelId;
  return config.voiceChannels.classicQueueChannelId;
}

function getRouletteTimeoutMs() {
  return Number(config.roulette?.timeoutSeconds || 300) * 1000;
}

function getRouletteWarnMs() {
  return Number(config.roulette?.warnSeconds || 240) * 1000;
}

function getRouletteAnnounceChannelId() {
  return config.textChannels?.queueStatusChannelId || null;
}

function getPostMatchVoiceChannelId(mode) {
  const waitingChannelId = config.voiceChannels.postMatchWaitingChannelId;
  if (waitingChannelId) {
    return waitingChannelId;
  }
  return getBaseQueueChannelIdByMode(mode);
}

async function ensureNamedRole(guild, name) {
  const existing = findRoleByNames(guild, [name]);
  if (existing) {
    return existing;
  }

  try {
    return await guild.roles.create({
      name,
      mentionable: true,
      reason: 'Cargo automatico do CAPS Bot'
    });
  } catch (error) {
    console.warn(`[ROLES] Nao foi possivel criar o cargo ${name}:`, error.message);
    return null;
  }
}

function findRoleByNames(guild, names = []) {
  const normalized = names.map((name) => String(name || '').replace(/\s+/g, '').toLowerCase());
  return guild.roles.cache.find((role) =>
    normalized.includes(String(role.name || '').replace(/\s+/g, '').toLowerCase())
  ) || null;
}

function findMvpRole(guild) {
  return findRoleByNames(guild, MVP_ROLE_NAMES);
}

async function ensureMvpRole(guild) {
  return findMvpRole(guild) || ensureNamedRole(guild, config.roles?.mvpPlayerRoleName || 'MVP player');
}

function findInfernalRole(guild) {
  return findRoleByNames(guild, [INFERNAL_ROLE_NAME]);
}

async function ensureInfernalRole(guild) {
  return findInfernalRole(guild) || ensureNamedRole(guild, INFERNAL_ROLE_NAME);
}

function getNextEightAmSaoPauloIso(from = new Date()) {
  const parts = getSaoPauloDateParts(from);
  const eightAmTodayUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 11, 0, 0);
  return new Date(eightAmTodayUtc + 24 * 60 * 60 * 1000).toISOString();
}

function getOpenLobby(queueData, mode, format, tier = null) {
  return Object.values(queueData.lobbies || {}).find(
    (lobby) => lobby.mode === mode && lobby.format === format && lobby.status === 'waiting' && lobby.players.length < lobby.requiredPlayers
      && (tier == null || getLobbyTier(lobby) === tier)
  );
}

function findLobbyByChannelId(queueData, channelId) {
  return Object.values(queueData.lobbies || {}).find(
    (lobby) =>
      lobby.waitingChannelId === channelId || lobby.teamOneChannelId === channelId || lobby.teamTwoChannelId === channelId
  );
}

function findLobbyByPlayer(queueData, discordId) {
  return Object.values(queueData.lobbies || {}).find((lobby) =>
    Array.isArray(lobby.players) ? lobby.players.some((player) => player.discordId === discordId) : false
  );
}

function findActiveMatchByChannelId(currentMatchData, channelId) {
  return Object.entries(currentMatchData.matches || {}).find(([, entry]) => {
    const match = entry.match;

    return entry.active && match && [match.waitingChannelId, match.teamOneChannelId, match.teamTwoChannelId].includes(channelId);
  });
}

function normalizeLobbySelectorArgs(args = []) {
  const normalizedArgs = args.map((arg) => String(arg || '').toLowerCase());

  if (normalizedArgs.length === 0) {
    return null;
  }

  if (normalizedArgs[0] === QUEUE_MODES.ARAM) {
    return {
      mode: QUEUE_MODES.ARAM,
      format: ['1x1', '2x2', '3x3', '4x4', '5x5'].includes(normalizedArgs[1]) ? normalizedArgs[1] : null,
      letter: (normalizedArgs[2] || '').toUpperCase() || null
    };
  }

  if (normalizedArgs[0] === QUEUE_MODES.CLASSIC) {
    return {
      mode: QUEUE_MODES.CLASSIC,
      format: '5x5',
      letter: (normalizedArgs[1] || '').toUpperCase() || null
    };
  }

  if (/^[a-z]+$/i.test(normalizedArgs[0])) {
    return {
      mode: null,
      format: null,
      letter: normalizedArgs[0].toUpperCase()
    };
  }

  return null;
}

function findLobbyBySelector(queueData, args = []) {
  const selector = normalizeLobbySelectorArgs(args);

  if (!selector) {
    return null;
  }

  const lobbies = Object.values(queueData.lobbies || {});

  return (
    lobbies.find((lobby) => {
      if (selector.letter && lobby.letter !== selector.letter) {
        return false;
      }

      if (selector.mode && lobby.mode !== selector.mode) {
        return false;
      }

      if (selector.format && lobby.format !== selector.format) {
        return false;
      }

      return true;
    }) || null
  );
}

function findActiveMatchBySelector(currentMatchData, args = []) {
  const selector = normalizeLobbySelectorArgs(args);

  if (!selector) {
    return null;
  }

  const activeEntries = Object.entries(currentMatchData.matches || {}).filter(([, entry]) => entry.active && entry.match);

  return (
    activeEntries.find(([, entry]) => {
      const match = entry.match;

      if (selector.letter && match.letter !== selector.letter) {
        return false;
      }

      if (selector.mode && match.mode !== selector.mode) {
        return false;
      }

      if (selector.format && match.format !== selector.format) {
        return false;
      }

      return true;
    }) || null
  );
}

async function createLobbyChannels(guild, mode, format, letter, tier = null) {
  const baseChannel = guild.channels.cache.get(getBaseQueueChannelIdByMode(mode, tier));

  if (!baseChannel || baseChannel.type !== ChannelType.GuildVoice) {
    throw new Error(`Canal base do modo ${formatQueueMode(mode)} nao encontrado no config.json.`);
  }

  const parent = baseChannel.parentId || null;
  const waitingName = getExpectedWaitingRoomName(mode, format, letter, tier);
  const existingWaitingChannels = guild.channels.cache
    .filter((channel) => channel.type === ChannelType.GuildVoice && channel.name === waitingName)
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp);
  const existingWaitingChannel = existingWaitingChannels.first() || null;

  if (existingWaitingChannels.size > 1) {
    for (const duplicateChannel of existingWaitingChannels.values()) {
      if (existingWaitingChannel && duplicateChannel.id === existingWaitingChannel.id) {
        continue;
      }

      await deleteVoiceChannelIfExists(guild, duplicateChannel.id);
    }
  }

  if (existingWaitingChannel) {
    return {
      waitingChannelId: existingWaitingChannel.id,
      parentId: existingWaitingChannel.parentId || parent
    };
  }

  const waitingChannel = await guild.channels.create({
    name: waitingName,
    type: ChannelType.GuildVoice,
    parent,
    userLimit: getRequiredPlayersByModeAndFormat(mode, format),
    permissionOverwrites: baseChannel.permissionOverwrites.cache.map((overwrite) => overwrite.toJSON())
  });

  return {
    waitingChannelId: waitingChannel.id,
    parentId: parent
  };
}

async function createTeamChannelsForLobby(guild, lobby) {
  const baseChannel = guild.channels.cache.get(getBaseQueueChannelIdByMode(lobby.mode, getLobbyTier(lobby)));

  if (!baseChannel || baseChannel.type !== ChannelType.GuildVoice) {
    throw new Error(`Canal base do modo ${formatQueueMode(lobby.mode)} nao encontrado no config.json.`);
  }

  const parent = lobby.parentId || baseChannel.parentId || null;
  const [teamOneName, teamTwoName] = getExpectedTeamRoomNames(lobby.mode, lobby.format, lobby.letter);

  await deleteChannelsByNames(guild, [teamOneName, teamTwoName]);

  const teamOneChannel = await guild.channels.create({
    name: teamOneName,
    type: ChannelType.GuildVoice,
    parent,
    permissionOverwrites: baseChannel.permissionOverwrites.cache.map((overwrite) => overwrite.toJSON())
  });
  const teamTwoChannel = await guild.channels.create({
    name: teamTwoName,
    type: ChannelType.GuildVoice,
    parent,
    permissionOverwrites: baseChannel.permissionOverwrites.cache.map((overwrite) => overwrite.toJSON())
  });

  return {
    teamOneChannelId: teamOneChannel.id,
    teamTwoChannelId: teamTwoChannel.id
  };
}

function formatCustomRecord(player) {
  const wins = Number(player.customWins || 0);
  const losses = Number(player.customLosses || 0);

  return `${wins}V / ${losses}D`;
}

async function syncMemberRankRole(guild, discordId, mmr) {
  if (!guild || !discordId) {
    return { ok: false, reason: 'missing_target' };
  }

  try {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: 'member_not_found' };
    }

    const rankTier = getRankName(mmr);
    const targetRole = findRankRole(guild, rankTier);
    if (!targetRole) {
      console.warn(`[ROLES] Cargo de elo nao encontrado para ${rankTier}`);
      return { ok: false, reason: 'role_not_found', rankTier };
    }

    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (botMember && targetRole.position >= botMember.roles.highest.position) {
      console.warn(`[ROLES] Hierarquia impede atribuir ${targetRole.name} para ${member.user.tag}`);
      return { ok: false, reason: 'hierarchy', roleName: targetRole.name, rankTier };
    }

    const currentRankRoles = member.roles.cache.filter((role) => isRankRole(role) && role.id !== targetRole.id);

    if (currentRankRoles.size > 0) {
      await member.roles.remove(currentRankRoles);
    }

    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole);
    }

    return { ok: true, roleName: targetRole.name, rankTier };
  } catch (err) {
    console.error(`[ROLES] Erro na sincronizacao de cargo para ${discordId}:`, err.message);
    return { ok: false, reason: 'discord_error', error: err.message };
  }
}

async function syncMvpRole(guild, mvpId) {
  if (!guild || !mvpId) return;

  try {
    const mvpRole = await ensureMvpRole(guild);
    if (!mvpRole) {
      console.warn('[MVP] Cargo MVP player / ⭐ MVP nao encontrado.');
      return;
    }

    const newMvp = await guild.members.fetch(mvpId).catch(() => null);
    if (newMvp && !newMvp.roles.cache.has(mvpRole.id)) {
      await newMvp.roles.add(mvpRole).catch((err) =>
        console.error(`[ROLES] Erro ao atribuir cargo MVP para ${newMvp.user.tag}:`, err.message)
      );
    }
  } catch (err) {
    console.error(`[ROLES] Erro ao sincronizar cargo MVP:`, err.message);
  }
}

async function clearMvpRoles(guild) {
  if (!guild) return;
  try {
    const mvpRole = findMvpRole(guild);
    if (!mvpRole) return;
    for (const [, member] of mvpRole.members) {
      await member.roles.remove(mvpRole).catch(() => null);
    }
  } catch (err) {
    console.error(`[ROLES] Erro ao limpar cargos MVP:`, err.message);
  }
}

async function hasInfernalPriority(guild, discordId, statsData = null) {
  if (!guild || !discordId) return false;
  try {
    const data = statsData || await loadPlayerStats();
    const stored = Object.values(data.players || {}).find((entry) => entry.discordId === discordId) || null;
    const validDb = stored?.infernalExpiresAt && new Date(stored.infernalExpiresAt).getTime() > Date.now();
    if (!validDb) return false;
    const member = await guild.members.fetch(discordId).catch(() => null);
    const role = findInfernalRole(guild);
    if (!role) return true; // banco válido mesmo sem cargo no servidor
    return Boolean(member?.roles.cache.has(role.id));
  } catch {
    return false;
  }
}

async function syncInfernalRolesAfterMatch(guild, winners = [], losers = []) {
  const newlyAwarded = [];
  const removed = [];
  const failed = [];
  if (!guild) return Object.assign(newlyAwarded, { removed, failed });

  const infernalRole = await ensureInfernalRole(guild);
  if (!infernalRole) {
    console.warn('[INFERNAL] Cargo INFERNAL nao encontrado. Crie o cargo no Discord.');
    return Object.assign(newlyAwarded, { removed, failed });
  }

  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);

  // Regra: derrota NAO tira o INFERNAL na hora. O cargo vale até as 08h do dia seguinte
  // (expira via expireInfernalRolesIfDue/reconcile). Aqui só registramos quem perdeu
  // tendo o cargo, sem remover nada.
  for (const loser of losers) {
    try {
      const statsData = await loadPlayerStats();
      const stored = getStoredPlayerStats(statsData, loser);
      const stillValid = stored?.infernalExpiresAt && new Date(stored.infernalExpiresAt).getTime() > Date.now();
      if (stillValid) {
        removed.push({ discordId: loser.discordId, nickname: loser.nickname, keptUntil: stored.infernalExpiresAt });
      }
    } catch (err) {
      failed.push({ discordId: loser.discordId, action: 'read_db', error: err.message });
    }
  }

  for (const winner of winners) {
    if (Number(winner.winStreak || 0) < INFERNAL_STREAK) {
      continue;
    }

    const statsData = await loadPlayerStats();
    const stored = getStoredPlayerStats(statsData, winner);
    const stillValid = stored.infernalExpiresAt && new Date(stored.infernalExpiresAt).getTime() > Date.now();
    const infernalExpiresAt = stillValid ? stored.infernalExpiresAt : getNextEightAmSaoPauloIso();
    try {
      upsertPlayerStats(statsData, winner, { infernalExpiresAt });
      await savePlayerStats(statsData);
    } catch (err) {
      failed.push({ discordId: winner.discordId, action: 'save_db', error: err.message });
      continue;
    }

    const member = await guild.members.fetch(winner.discordId).catch(() => null);
    if (!member) {
      failed.push({ discordId: winner.discordId, action: 'add_role', error: 'member_not_found' });
      continue;
    }
    if (!member.roles.cache.has(infernalRole.id)) {
      if (botMember && infernalRole.position >= botMember.roles.highest.position) {
        failed.push({ discordId: winner.discordId, action: 'add_role', error: 'hierarchy' });
        continue;
      }
      try {
        await member.roles.add(infernalRole);
        newlyAwarded.push({
          discordId: winner.discordId,
          nickname: winner.nickname,
          winStreak: Number(winner.winStreak || 0),
          infernalExpiresAt
        });
      } catch (err) {
        failed.push({ discordId: winner.discordId, action: 'add_role', error: err.message });
      }
    }
  }

  if (failed.length > 0) {
    console.warn('[INFERNAL] Falhas no pos-jogo:', failed.map((f) => `${f.discordId}:${f.action}:${f.error}`).join(' | '));
  }
  return Object.assign(newlyAwarded, { removed, failed });
}

async function reconcileInfernalRoles(guild) {
  // Limpa órfãos: membro com role no Discord mas sem infernalExpiresAt válida no banco
  if (!guild) return { removedOrphans: 0, failed: [] };
  const infernalRole = findInfernalRole(guild);
  if (!infernalRole) return { removedOrphans: 0, failed: [] };
  // role.members depende de cache: busca geral p/ enxergar todos (servidor pequeno, 1 chamada)
  await guild.members.fetch().catch(() => null);
  const statsData = await loadPlayerStats();
  let removedOrphans = 0;
  for (const [, member] of infernalRole.members) {
    const stored = Object.values(statsData.players || {}).find((entry) => entry.discordId === member.id) || null;
    const valid = stored?.infernalExpiresAt && new Date(stored.infernalExpiresAt).getTime() > Date.now();
    if (!valid) {
      const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
      if (botMember && infernalRole.position >= botMember.roles.highest.position) {
        failed.push({ discordId: member.id, action: 'remove_orphan', error: 'hierarchy_bot_below_infernal' });
        continue;
      }
      await member.roles.remove(infernalRole).catch((err) => failed.push({ discordId: member.id, action: 'remove_orphan', error: err.message }));
      removedOrphans += 1;
    }
  }
  if (failed.length > 0) {
    console.warn('[INFERNAL] Reconciliacao com falhas (verifique a hierarquia: cargo do bot precisa ficar ACIMA do INFERNAL):', failed.map((f) => `${f.discordId}:${f.error}`).join(' | '));
  }
  return { removedOrphans, failed };
}

async function postInfernalAnnouncement(guild, awarded = []) {
  if (!guild || !Array.isArray(awarded) || awarded.length === 0) return;

  const channelId = config.textChannels.mvpAnnouncementsChannelId || config.textChannels.matchHistoryChannelId;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn('[INFERNAL] Canal de anuncio nao encontrado.');
    return;
  }

  const mentions = awarded.map((p) => `<@${p.discordId}>`).join(' ');
  const lines = awarded
    .map((p) => `• **${p.nickname || p.discordId}** — \`${p.winStreak}\` vitorias seguidas (vale ate ${formatDateTimeForHistory(p.infernalExpiresAt)})`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle('🔥 NOVO INFERNAL 🔥')
    .setDescription(`${mentions}\nChegou a **${INFERNAL_STREAK} vitorias seguidas** e conquistou o cargo **${INFERNAL_ROLE_NAME}**!`)
    .addFields({ name: 'Conquistas', value: lines || 'Sem detalhes' })
    .setFooter({ text: `${FOOTER_PREFIX} • Streak INFERNAL` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch((err) =>
    console.error('[INFERNAL] Erro ao postar anuncio:', err.message)
  );
}

async function postRouletteAnnouncement(guild, { letter, leaving = [], staying = [], winners = [], vacancies = 0, destinationLabel = '' } = {}) {
  const channelId = getRouletteAnnounceChannelId();
  if (!guild || !channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const fmt = (list) => (list.length > 0 ? list.map((p) => `<@${p.discordId}>`).join(' ') : '—');
  const embed = new EmbedBuilder()
    .setColor(THEME.WARNING)
    .setTitle(`🎯 Roleta — Sala ${letter || '?'}`)
    .setDescription(destinationLabel ? `Destino: **${destinationLabel}**` : 'Sorteio de quem sai da próxima partida.')
    .addFields(
      { name: `❌ Saem (${leaving.length})`, value: fmt(leaving).slice(0, 1024) },
      { name: `✅ Ficam (${staying.length})`, value: fmt(staying).slice(0, 1024) },
      { name: `🏆 Winners movidos (${winners.length})`, value: fmt(winners).slice(0, 1024) },
      { name: '⏳ Vagas abertas', value: `\`${vacancies}\` — use \`!espera\`` }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Roleta` })
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => null);
}

async function expireInfernalRolesIfDue(guild) {
  if (!guild) return;

  const infernalRole = findInfernalRole(guild);
  const statsData = await loadPlayerStats();
  const now = Date.now();
  let changed = false;

  for (const player of Object.values(statsData.players || {})) {
    if (!player.infernalExpiresAt) {
      continue;
    }

    if (new Date(player.infernalExpiresAt).getTime() > now) {
      continue;
    }

    upsertPlayerStats(statsData, player, { infernalExpiresAt: null });
    changed = true;

    if (!infernalRole || !player.discordId) {
      continue;
    }

    const member = await guild.members.fetch(player.discordId).catch(() => null);
    if (member?.roles.cache.has(infernalRole.id)) {
      await member.roles.remove(infernalRole).catch(() => null);
    }
  }

  if (changed) {
    await savePlayerStats(statsData);
  }
}

function countMvpVotes(session) {
  const tallies = new Map();
  for (const targetId of Object.values(session.votes || {})) {
    tallies.set(targetId, (tallies.get(targetId) || 0) + 1);
  }
  return tallies;
}

function pickAutomaticMvp(session) {
  const candidates = (session.players || []).filter((player) => player.wasWinner);
  const pool = candidates.length > 0 ? candidates : (session.players || []);
  let best = null;
  for (const player of pool) {
    if (!best || (player.ratingDelta || 0) > (best.ratingDelta || 0)) {
      best = player;
    }
  }
  if (!best || (best.ratingDelta || 0) <= 0) {
    return null;
  }
  return { ...best, votes: 0, automatic: true };
}

function pickMvpWinner(session) {
  const tallies = countMvpVotes(session);
  if (tallies.size === 0) {
    return pickAutomaticMvp(session);
  }

  let best = null;
  for (const player of session.players) {
    const votes = tallies.get(player.discordId) || 0;
    if (votes === 0) continue;
    if (
      !best ||
      votes > best.votes ||
      (votes === best.votes && (player.ratingDelta || 0) > (best.ratingDelta || 0))
    ) {
      best = { ...player, votes };
    }
  }
  return best;
}

async function persistPendingMvpVotes() {
  const systemMeta = await loadSystemMeta();
  systemMeta.pendingMvpVotes = Object.fromEntries(pendingMvpVotes.entries());
  await saveSystemMeta(systemMeta);
}

async function finalizeMvpVote(voteId) {
  const session = pendingMvpVotes.get(voteId);
  if (!session || session.closed) {
    return;
  }

  session.closed = true;
  pendingMvpVotes.set(voteId, session);
  const timeoutId = mvpVoteTimeouts.get(voteId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    mvpVoteTimeouts.delete(voteId);
  }

  const guild = global.discordClient?.guilds.cache.get(session.guildId)
    || await global.discordClient?.guilds.fetch(session.guildId).catch(() => null);
  const channel = await guild?.channels.fetch(session.channelId).catch(() => null);
  const message = session.messageId && channel?.isTextBased()
    ? await channel.messages.fetch(session.messageId).catch(() => null)
    : null;

  const winner = pickMvpWinner(session);
  const voteLines = session.players
    .map((player) => {
      const votes = countMvpVotes(session).get(player.discordId) || 0;
      return `• ${player.nickname}: **${votes}** voto(s)`;
    })
    .join('\n');

  if (guild) {
    await clearMvpRoles(guild);
    if (winner) {
      await syncMvpRole(guild, winner.discordId);
      await postMvpAnnouncement(guild, {
        discordId: winner.discordId,
        nickname: winner.nickname,
        winStreak: winner.winStreak || 0,
        afterRank: winner.afterRank || 0,
        mvpVotes: winner.votes
      });
    }
  }

  if (message) {
    const winnerDescription = winner
      ? (winner.automatic
        ? `<@${winner.discordId}> ficou com o MVP pelo maior ganho de rating (ninguem votou).`
        : `<@${winner.discordId}> foi o mais votado (**${winner.votes}** voto(s)).`)
      : 'Nenhum voto foi registrado.';
    const resultEmbed = EmbedBuilder.from(message.embeds[0] || new EmbedBuilder())
      .setTitle(winner ? `MVP: ${winner.nickname}` : 'Votacao de MVP encerrada')
      .setDescription(winnerDescription)
      .spliceFields(0, 25, { name: 'Placar', value: voteLines || 'Sem votos' });

    await message.edit({ embeds: [resultEmbed], components: [] }).catch(() => null);
  }

  pendingMvpVotes.delete(voteId);
  await persistPendingMvpVotes();
}

async function startMvpVote(guild, match, winners = [], losers = []) {
  const players = [...winners, ...losers].filter((player) => player.discordId);
  if (!guild || players.length === 0) {
    return;
  }

  const channelId = config.textChannels.mvpAnnouncementsChannelId || config.textChannels.matchHistoryChannelId;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn('[MVP] Canal de votacao nao encontrado.');
    return;
  }

  const voteId = `${Date.now().toString(36)}`;
  const session = {
    voteId,
    guildId: guild.id,
    channelId,
    messageId: null,
    players: players.map((player) => ({
      discordId: player.discordId,
      nickname: player.nickname,
      ratingDelta: player.ratingDelta || 0,
      afterRank: player.afterRank || 0,
      winStreak: player.winStreak || 0,
      wasWinner: winners.some((winner) => winner.discordId === player.discordId)
    })),
    votes: {},
    closed: false,
    expiresAt: Date.now() + MVP_VOTE_DURATION_MS
  };

  const select = new StringSelectMenuBuilder()
    .setCustomId(`mvpvote:${voteId}`)
    .setPlaceholder('Escolha o MVP desta partida')
    .addOptions(
      session.players.map((player) => ({
        label: String(player.nickname || player.discordId).slice(0, 100),
        value: player.discordId,
        description: player.wasWinner ? 'Time vencedor' : 'Time oponente'
      }))
    );

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle('Vote no MVP da partida')
    .setDescription(
      `Lobby **${match.letter || '?'}** • ${formatQueueMode(match.mode)} ${match.format || ''}\n` +
      `Apenas quem jogou esta partida pode votar. Tempo: **2 minutos**.`
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Votacao MVP` })
    .setTimestamp();

  const message = await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)]
  });

  session.messageId = message.id;
  pendingMvpVotes.set(voteId, session);
  await persistPendingMvpVotes();

  const timeoutId = setTimeout(() => {
    finalizeMvpVote(voteId).catch((error) => console.error('[MVP] Falha ao encerrar votacao:', error));
  }, MVP_VOTE_DURATION_MS);
  mvpVoteTimeouts.set(voteId, timeoutId);
}

async function handleMvpVoteInteraction(interaction) {
  const voteId = String(interaction.customId || '').split(':')[1];
  const session = pendingMvpVotes.get(voteId);

  if (!session || session.closed || Date.now() > session.expiresAt) {
    await interaction.reply({ content: 'Essa votacao de MVP ja encerrou.', ephemeral: true }).catch(() => null);
    return;
  }

  const isParticipant = session.players.some((player) => player.discordId === interaction.user.id);
  if (!isParticipant) {
    await interaction.reply({ content: 'So quem jogou essa partida pode votar no MVP.', ephemeral: true }).catch(() => null);
    return;
  }

  const selectedId = interaction.values?.[0];
  if (!selectedId || !session.players.some((player) => player.discordId === selectedId)) {
    await interaction.reply({ content: 'Jogador invalido.', ephemeral: true }).catch(() => null);
    return;
  }

  session.votes[interaction.user.id] = selectedId;
  pendingMvpVotes.set(voteId, session);
  await persistPendingMvpVotes();

  const target = session.players.find((player) => player.discordId === selectedId);
  await interaction.reply({
    content: `Seu voto de MVP foi para **${target.nickname}**. Voce pode mudar o voto ate o tempo acabar.`,
    ephemeral: true
  }).catch(() => null);
}

async function resumePendingMvpVotes() {
  const systemMeta = await loadSystemMeta();
  const stored = systemMeta.pendingMvpVotes || {};

  for (const [voteId, session] of Object.entries(stored)) {
    if (!session || session.closed) {
      continue;
    }

    const remaining = Number(session.expiresAt || 0) - Date.now();
    pendingMvpVotes.set(voteId, session);

    if (remaining <= 0) {
      await finalizeMvpVote(voteId);
      continue;
    }

    const timeoutId = setTimeout(() => {
      finalizeMvpVote(voteId).catch((error) => console.error('[MVP] Falha ao encerrar votacao:', error));
    }, remaining);
    mvpVoteTimeouts.set(voteId, timeoutId);
  }
}

function getPlayerStatsKey(player) {
  return player.puuid || `discord:${player.discordId}`;
}

function getStoredPlayerStats(statsData, player) {
  const key = getPlayerStatsKey(player);
  const storedByDiscordId = player.discordId
    ? Object.values(statsData.players || {}).find((entry) => entry.discordId === player.discordId)
    : null;
  const normalizedModes = normalizePlayerModes(player);

  return (
    statsData.players[key] || storedByDiscordId || {
      discordId: player.discordId,
      nickname: player.nickname,
      puuid: player.puuid || null,
      customWins: normalizedModes.classic.customWins,
      customLosses: normalizedModes.classic.customLosses,
      baseMmr: normalizedModes.classic.baseMmr,
      internalRating: normalizedModes.classic.internalRating,
      modes: normalizedModes
    }
  );
}

function upsertPlayerStats(statsData, player, updates = {}) {
  const key = getPlayerStatsKey(player);
  const previous = getStoredPlayerStats(statsData, player);

  // Remove entradas antigas com o mesmo discordId mas chave diferente (nick/puuid mudou)
  if (player.discordId) {
    for (const existingKey of Object.keys(statsData.players)) {
      if (existingKey !== key && statsData.players[existingKey].discordId === player.discordId) {
        delete statsData.players[existingKey];
      }
    }
  }
  
  const merged = {
    ...previous,
    discordId: player.discordId,
    nickname: player.nickname,
    puuid: player.puuid || previous.puuid || null,
    ...updates
  };

  // Garante que o objeto 'modes' esteja sempre normalizado e dinâmico
  merged.modes = normalizePlayerModes(merged);

  // Sincroniza campos legados (topo do objeto) com o modo 'classic'
  if (merged.modes.classic) {
    const c = merged.modes.classic;
    merged.customWins = Number(c.customWins || 0);
    merged.customLosses = Number(c.customLosses || 0);
    merged.baseMmr = Number(c.baseMmr || 0);
    merged.internalRating = Number(c.internalRating || calculateSeedRating(c.baseMmr || 0));
  }

  statsData.players[key] = merged;
  return statsData.players[key];
}

function buildQueueEmbed(lobby, allLobbies = []) {
  const normalizedLobbies = Array.isArray(allLobbies)
    ? allLobbies.filter((entry) => entry && typeof entry === 'object')
    : [];
  const normalizedLobby = lobby && typeof lobby === 'object' ? lobby : null;
  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('Fila Atual')
    .setDescription('Acompanhe os jogadores confirmados para a partida personalizada.')
    .setTimestamp();

  if (!normalizedLobby) {
    const waitingLobbies = normalizedLobbies.filter((entry) => entry.status === 'waiting');
    const overview = waitingLobbies.length
      ? waitingLobbies
          .map(
            (entry) => {
              const tierTag = entry.mode === QUEUE_MODES.CLASSIC && getLobbyTier(entry) === 'S' ? ' TIER S' : '';
              return `**${entry.letter || '?'}** | ${formatQueueMode(entry.mode)}${tierTag} ${entry.mode === QUEUE_MODES.ARAM ? entry.format || '5x5' : '5x5'} | ${Array.isArray(entry.players) ? entry.players.length : 0}/${entry.requiredPlayers || 0}`;
            }
          )
          .join('\n')
      : 'Nenhuma sala de espera ativa no momento.';

    embed.addFields({
      name: 'Salas de espera ativas',
      value: overview
    });

    return embed;
  }

  const lobbyModeLabel = normalizedLobby.mode === QUEUE_MODES.CLASSIC && getLobbyTier(normalizedLobby) === 'S'
    ? 'CLASSIC TIER S'
    : formatQueueMode(normalizedLobby.mode);
  embed
    .addFields(
      { name: 'Lobby', value: `\`${normalizedLobby.letter || '?'}\``, inline: true },
      { name: 'Modo', value: `\`${lobbyModeLabel}\``, inline: true },
      { name: 'Formato', value: `\`${normalizedLobby.format || '5x5'}\``, inline: true },
      {
        name: 'Status da fila',
        value: `\`${Array.isArray(normalizedLobby.players) ? normalizedLobby.players.length : 0}/${normalizedLobby.requiredPlayers || 0}\` jogadores`,
        inline: true
      }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Fila de Espera` });

  if (!Array.isArray(normalizedLobby.players) || normalizedLobby.players.length === 0) {
    embed.addFields({
      name: 'Nenhum jogador na fila',
      value: 'A fila esta vazia no momento.'
    });

    return embed;
  }

  const queueEntries = normalizedLobby.players.map(
    (player, index) =>
      `**${index + 1}.** <@${player.discordId}>\nNick: \`${player.nickname}\`\nElo: \`${formatRank(player)}\`\nCustom ${formatQueueMode(normalizedLobby.mode)}: \`${formatCustomRecord(player)}\`\nPontos: \`${player.mmr}\``
  );
  const chunks = [];
  let currentChunk = '';

  for (const entry of queueEntries) {
    const nextValue = currentChunk ? `${currentChunk}\n\n${entry}` : entry;

    if (nextValue.length > 1024) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = entry;
    } else {
      currentChunk = nextValue;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  chunks.forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? 'Participantes da fila' : `Participantes da fila (${index + 1})`,
      value: chunk
    });
  });

  return embed;
}

function splitEmbedFieldChunks(entries, maxLength = 1024) {
  const chunks = [];
  let currentChunk = '';

  for (const entry of entries) {
    const nextValue = currentChunk ? `${currentChunk}\n\n${entry}` : entry;

    if (nextValue.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = entry;
    } else {
      currentChunk = nextValue;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

const RULES_SECTIONS = [
  {
    name: '📝 1. Cadastro (uma vez só)',
    value: '`!cadastrar Nick#TAG` vincula sua conta Riot (ex: `!cadastrar Faker#BR1`). Depois, `!nick Nick#TAG` atualiza se mudar de conta. `!perfil` mostra seu elo e seus pontos.'
  },
  {
    name: '🎮 2. Como jogar',
    value: 'Entre no canal de voz **Lobby Classic**, **Lobby TIER S** ou **Lobby ARAM** e digite `!entrar` (só vale dentro desses canais — na Sala de Espera não funciona, troque de canal primeiro). Com 10 jogadores a partida inicia sozinha. `!fila` mostra quem está na sala, `!sair` tira você dela.'
  },
  {
    name: '💎 3. Lobby TIER S (Esmeralda IV ou mais)',
    value: 'Só entra com `!entrar` quem tem elo ou cargo **Esmeralda, Diamante, Mestre, Grão-Mestre ou Desafiante**. Quem é Tier S pode jogar nos dois lobbies; os demais, só no Classic. Staff sem o elo organiza, mas não joga no Tier S.'
  },
  {
    name: '🏆 4. Pontos e rankings',
    value: 'Todo mundo começa com **1000 pontos custom + elo**. Ganhar de time mais forte vale mais PDL; ganhar de time mais fraco vale menos. `!top10` e `!placar` = geral; `!top10 tiers` e `!placar tiers` = só Esmeralda+. Desempate por winrate. Na temporada oficial, precisa de **10 jogos** para aparecer no ranking.'
  },
  {
    name: '🔥 5. Cargo INFERNAL (5 vitórias seguidas)',
    value: 'Fez 5 wins seguidas? Ganha o cargo até as **08h da manhã seguinte** (perder no caminho não tira). Dá prioridade: entra direto na **posição 5 da `!espera`** e **não cai na roleta**. `!sync infernal` (admin) conserta casos travados.'
  },
  {
    name: '⏳ 6. Espera e 🎯 roleta',
    value: '`!espera` guarda seu lugar para a próxima (🔥 = prioridade INFERNAL). Após a partida todos vão à **Sala de Espera**: um comando `!roleta N A` sorteia na hora quem sai (N = 1–5, letra da sala; só losers entram, 🔥 INFERNAL é imune). Não quer a próxima? `!roletasair A` (fora do sorteio e da subida). Resultado sai no canal **fila**; vagas restantes vão para a `!espera`.'
  },
  {
    name: '🗳️ 7. Fim de jogo e MVP',
    value: 'Durante a partida vote com `!votar 1` ou `!votar 2`. Depois, vote no **MVP** no canal de destaques (2 min; sem votos, o bot escolhe o maior PDL ganho). Staff registra com `!vitoria 1 A` e reabre com `!rematch A`.'
  },
  {
    name: '📊 8. Temporada',
    value: 'Os pontos zeram a cada temporada (volta aos 1000 + elo) e os campeões ficam no histórico (`!temporadas`). Jogue sério desde o dia 1: cada vitória conta para o top 10.'
  }
];

const STAFF_SECTIONS = [
  {
    name: '⚔️ Partida — conduzir o jogo',
    value: '`!start A` • Inicia a sala A manualmente (quando não iniciou sozinha).\n`!cancelarstart A` • Cancela a contagem de início (jogadores ficam na fila).\n`!vitoria 1 A` • Registra o time 1 como vencedor da sala A (pós-jogo).\n`!rematch A` • Volta os 10 da sala A para novo lobby, com times reequilibrados.'
  },
  {
    name: '🎯 Roleta — vagas da próxima (Sala de Espera)',
    value: '`!roleta N A` • Sorteia NA HORA N losers para sair (1–5, letra da sala).\nQuem pode: um loser da partida ou staff. Só losers entram; 🔥 INFERNAL é imune (só com `--com-infernal`).\nCada sala só pode ser roletada 1x (anti-duplo).\n`!roletasair A` • Jogador fora da próxima (staff: `!roletasair @jogador A`).'
  },
  {
    name: '🧹 Filas e salas — organizar e limpar',
    value: '`!remover @jogador` • Tira alguém da fila (🔥 INFERNAL só sai com Admin).\n`!limparsalas A` • Apaga a sala A vazia/travada (sem letra = todas; com partida ativa, recusa).\n`!limpar 10` • Apaga 10 mensagens do canal.\n`!espera` + `!limparespera` • Ver a espera e (staff) zerá-la.\n`!reset` • Emergência: limpa filas e partidas (não mexe em pontos).'
  },
  {
    name: '🎖️ Elos e cargos — manter atualizado',
    value: '`!sincronizarelo @jogador` • Atualiza elo Riot + cargo de um jogador (mostra se o cargo falhou).\n`!sincronizartodos` • Atualiza TODO MUNDO (demora ~2,5s por jogador; use com calma).\n`!sync` • Reaplica cargos pelo elo já salvo (sem chamar a Riot).\n`!sync infernal` • Limpa INFERNALs travados/órfãos.'
  },
  {
    name: '📊 Temporada — só Admin, com fila vazia',
    value: '`!temporadas` • Ver períodos arquivados.\n`!resetgeral` • Arquiva o período e ZERA os pontos (sem volta!).\n`!iniciartemporada` (ou `!iniciarseason`) • Liga a fase oficial.\nAbertura: `!resetgeral` e depois `!iniciartemporada`, antes dos primeiros jogos.'
  }
];

function buildStaffEmbed() {
  const embed = new EmbedBuilder()
    .setColor(THEME.WARNING)
    .setTitle('🛠️ Guia da Staff — CAPS Arena')
    .setDescription('Quando e como usar cada comando. Jogadores: usem `!regras`.')
    .setFooter({ text: `${FOOTER_PREFIX} • Staff` })
    .setTimestamp();
  for (const section of STAFF_SECTIONS) {
    embed.addFields({ name: section.name, value: section.value });
  }
  return embed;
}

function buildRulesEmbed() {
  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('📚 Regras — CAPS Arena')
    .setDescription('Resumo de como o bot funciona. Dúvidas? Chame a staff.')
    .setFooter({ text: `${FOOTER_PREFIX} • Regras` })
    .setTimestamp();
  for (const section of RULES_SECTIONS) {
    embed.addFields({ name: section.name, value: section.value });
  }
  return embed;
}

function buildTeamsEmbed(teams) {
  const teamOneText = teams.teamOne
    .map(
      (player) =>
        `- <@${player.discordId}> | ${player.nickname} | ${formatRank(player)} | ${formatCustomRecord(player)} | Pontos: ${player.mmr}`
    )
    .join('\n');

  const teamTwoText = teams.teamTwo
    .map(
      (player) =>
        `- <@${player.discordId}> | ${player.nickname} | ${formatRank(player)} | ${formatCustomRecord(player)} | Pontos: ${player.mmr}`
    )
    .join('\n');

  return new EmbedBuilder()
    .setColor(THEME.SUCCESS)
    .setTitle('⚔️ Times Balanceados')
    .setDescription(
      `Os times foram montados automaticamente com base no elo do LoL dos jogadores.\nModo: **${formatQueueMode(teams.mode)}** | Formato: **${teams.teamOne.length}x${teams.teamTwo.length}**`
    )
    .addFields(
      {
        name: `Equipe 1 | Elo total: ${teams.teamOneMmr}`,
        value: teamOneText || 'Sem jogadores'
      },
      {
        name: `Equipe 2 | Elo total: ${teams.teamTwoMmr}`,
        value: teamTwoText || 'Sem jogadores'
      },
      {
        name: 'Diferenca de Elo',
        value: `${teams.difference}`
      }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Times Formados` })
    .setTimestamp();
}

function buildLeaderboardEmbed(statsData, mode = QUEUE_MODES.CLASSIC, format = null, options = {}) {
  const rankedPlayers = getRankedPlayersByMode(statsData, mode, format, null, options);
  const modeLabel = getStatsBucketLabel(mode, format);
  const titleLabel = options?.tierSOnly && mode === QUEUE_MODES.CLASSIC ? 'CLASSIC TIER S (Esmeralda+)' : modeLabel;
  const medals = ['🥇', '🥈', '🥉'];

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle(`🏆 Placar Geral - ${titleLabel}`)
    .setDescription(options?.tierSOnly
      ? 'Mesmo PDL do Classic, filtrado para **Esmeralda IV ou superior**.'
      : `Ranking interno de **${modeLabel}** baseado no histórico.`)
    .setFooter({ text: `${FOOTER_PREFIX} • Ranking ${titleLabel}` })
    .setTimestamp();

  if (rankedPlayers.length === 0) {
    embed.addFields({
      name: 'Sem estatísticas ainda',
      value: `Nenhuma partida ${modeLabel} foi registrada até o momento.`
    });
    return embed;
  }

  const isClassicRank = mode === QUEUE_MODES.CLASSIC;
  const rawEntries = rankedPlayers
    .slice(0, 15)
    .map((player, index) => {
      const medal = medals[index] || `#${index + 1}`;
      const rankName = getRankName(player.baseMmr);
      const label = player.discordId ? `<@${player.discordId}>` : `\`${player.nickname}\``;
      const displayScore = isClassicRank
        ? (Number.isFinite(Number(player.customScore)) ? Number(player.customScore) : player.adjustedMmr)
        : player.adjustedMmr;

      return `${medal} ${label}\n**${rankName} (${displayScore} pts)** • ${player.customWins}V / ${player.customLosses}D`;
    });

  const { decoratedEntries, streakFooter } = decorateWithLeaderIcons(rawEntries, rankedPlayers.slice(0, 15));

  splitEmbedFieldChunks(decoratedEntries).forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? `Top jogadores - ${modeLabel}` : `Top jogadores - ${modeLabel} (${index + 1})`,
      value: chunk
    });
  });

  if (streakFooter) {
    embed.addFields({ name: '\u200B', value: streakFooter });
  }

  return embed;
}

function buildTopTenEmbed(statsData, seasonMeta, mode, format = null, options = {}) {
  const rankedPlayers = getRankedPlayersByMode(statsData, mode, format, seasonMeta, options).slice(0, 10);
  const modeLabel = getStatsBucketLabel(mode, format);
  const titleLabel = options?.tierSOnly && mode === QUEUE_MODES.CLASSIC ? 'CLASSIC TIER S (Esmeralda+)' : modeLabel;
  const medals = ['🥇', '🥈', '🥉'];

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle(`🏆 Top 10 - ${titleLabel}`)
    .setDescription(options?.tierSOnly
      ? `Mesmo PDL do Classic, filtrado para **Esmeralda IV ou superior**. Período: **${getSeasonDisplayLabel(seasonMeta)}**`
      : `Período atual: **${getSeasonDisplayLabel(seasonMeta)}**`)
    .setFooter({ text: `${FOOTER_PREFIX} • Top 10 ${titleLabel}` })
    .setTimestamp();

  if (rankedPlayers.length === 0) {
    embed.addFields({
      name: 'Sem ranking ainda',
      value: `Ainda nao ha jogadores ranqueados no modo ${modeLabel} neste periodo.`
    });

    return embed;
  }

  const isClassicTop = mode === QUEUE_MODES.CLASSIC;
  const rawEntries = rankedPlayers
    .map(
      (player, index) => {
        const medal = medals[index] || `#${index + 1}`;
        const rankName = getRankName(player.baseMmr);
        const totalGames = player.customWins + player.customLosses;
        const winRate = totalGames > 0 ? ((player.customWins / totalGames) * 100).toFixed(0) : '0';
        const displayScore = isClassicTop
          ? (Number.isFinite(Number(player.customScore)) ? Number(player.customScore) : player.adjustedMmr)
          : player.adjustedMmr;

        return `${medal} <@${player.discordId}>\n**${rankName} (${displayScore} pts)** • ${player.customWins}V / ${player.customLosses}D • ${winRate}% WR`;
      }
    );

  const { decoratedEntries, streakFooter } = decorateWithLeaderIcons(rawEntries, rankedPlayers);

  splitEmbedFieldChunks(decoratedEntries).forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? `Top 10 ${modeLabel}` : `Top 10 ${modeLabel} (${index + 1})`,
      value: chunk
    });
  });

  if (streakFooter) {
    embed.addFields({ name: '\u200B', value: streakFooter });
  }

  return embed;
}

function buildSeasonHistoryEmbed(history, seasonNumber) {
  const season = history.seasons.find(
    (item) => item.seasonNumber === seasonNumber || item.testingCycle === seasonNumber
  );

  if (!season) {
    return new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle('Periodo nao encontrado')
      .setDescription(`Nao encontrei dados arquivados para o periodo #${seasonNumber}.`)
      .setTimestamp();
  }

  const classicTop = (season.topClassic || [])
    .slice(0, 5)
    .map((player, index) => `**${index + 1}.** ${player.nickname} | Rank: ${player.adjustedMmr} | ${player.customWins}V/${player.customLosses}D`)
    .join('\n');

  const aramTop = (season.topAram || [])
    .slice(0, 5)
    .map((player, index) => `**${index + 1}.** ${player.nickname} | Rank: ${player.adjustedMmr} | ${player.customWins}V/${player.customLosses}D`)
    .join('\n');
  const aram1x1Top = (season.topAram1x1 || [])
    .slice(0, 5)
    .map((player, index) => `**${index + 1}.** ${player.nickname} | Rank: ${player.adjustedMmr} | ${player.customWins}V/${player.customLosses}D`)
    .join('\n');

  return new EmbedBuilder()
    .setColor(0x7f8c8d)
    .setTitle(`Historico - ${getArchivedSeasonLabel(season)}`)
    .setDescription(`Inicio: \`${season.startedAt}\`\nFim: \`${season.endedAt}\``)
    .addFields(
      { name: 'Top 5 CLASSIC', value: classicTop || 'Sem dados' },
      { name: 'Top 5 ARAM', value: aramTop || 'Sem dados' },
      { name: 'Top 5 ARAM 1x1', value: aram1x1Top || 'Sem dados' }
    )
    .setTimestamp();
}

function resetStatsForNewSeason(statsData) {
  const nextPlayers = {};

  for (const [key, player] of Object.entries(statsData.players || {})) {
    const modes = normalizePlayerModes(player);
    const resetModes = {};

    for (const [modeKey, modeStats] of Object.entries(modes)) {
      resetModes[modeKey] = {
        customWins: 0,
        customLosses: 0,
        baseMmr: Number(modeStats.baseMmr || 0),
        internalRating: calculateSeedRating(modeStats.baseMmr || 0),
        winStreak: 0,
        ratingVersion: RATING_VERSION
      };
    }

    nextPlayers[key] = {
      ...player,
      customWins: 0,
      customLosses: 0,
      internalRating: resetModes.classic?.internalRating || calculateSeedRating(modes.classic.baseMmr || 0),
      modes: resetModes
    };
  }

  return { players: nextPlayers };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasArchivedSeasonData(season) {
  if (!season) {
    return false;
  }

  if (season.playersSnapshot && Object.keys(season.playersSnapshot.players || {}).length > 0) {
    return true;
  }

  return ['topClassic', 'topAram', 'topAram1x1'].some((key) => Array.isArray(season[key]) && season[key].length > 0);
}

function buildRestoredStatsFromArchive(archivedSeason, currentStats) {
  if (archivedSeason.playersSnapshot) {
    return deepClone(archivedSeason.playersSnapshot);
  }

  const restoredStats = deepClone(currentStats || { players: {} });
  const buckets = [
    { key: 'topClassic', modeKey: 'classic' },
    { key: 'topAram', modeKey: 'aram' },
    { key: 'topAram1x1', modeKey: 'aram1x1' }
  ];

  for (const bucket of buckets) {
    for (const archivedPlayer of archivedSeason[bucket.key] || []) {
      const puuid = archivedPlayer.puuid;

      if (!puuid) {
        continue;
      }

      const existingPlayer = restoredStats.players[puuid] || {
        discordId: archivedPlayer.discordId || null,
        nickname: archivedPlayer.nickname,
        puuid,
        customWins: 0,
        customLosses: 0,
        baseMmr: 0,
        internalRating: 1000,
        modes: normalizePlayerModes({})
      };
      const normalizedModes = normalizePlayerModes(existingPlayer);
      const archivedModes = normalizePlayerModes(archivedPlayer);

      restoredStats.players[puuid] = {
        ...existingPlayer,
        discordId: archivedPlayer.discordId || existingPlayer.discordId || null,
        nickname: archivedPlayer.nickname || existingPlayer.nickname,
        puuid,
        modes: {
          ...normalizedModes,
          [bucket.modeKey]: {
            ...normalizedModes[bucket.modeKey],
            ...archivedModes[bucket.modeKey]
          }
        }
      };
    }
  }

  return restoredStats;
}

function inferSeasonMetaFromArchive(archivedSeason) {
  return {
    currentSeason: archivedSeason.seasonNumber,
    startedAt: archivedSeason.startedAt,
    phase: archivedSeason.type === 'official' ? 'official' : 'testing',
    officialSeasonStarted: archivedSeason.type === 'official',
    testingCycle:
      archivedSeason.type === 'testing'
        ? Number(archivedSeason.testingCycle || archivedSeason.seasonNumber || 1)
        : Number(archivedSeason.testingCycle || 1)
  };
}

function archiveCurrentSeason(statsData, seasonMeta) {
  // Nota: esta função é chamada dentro de handlers async que já têm o history carregado
  // A chamada a saveSeasonHistory foi movida para ser feita pelo caller com await
  const archivedSeason = {
    seasonNumber: seasonMeta.currentSeason,
    type: seasonMeta.phase === 'official' ? 'official' : 'testing',
    testingCycle: seasonMeta.phase === 'testing' ? Number(seasonMeta.testingCycle || seasonMeta.currentSeason || 1) : null,
    label:
      seasonMeta.phase === 'official'
        ? `Temporada #${seasonMeta.currentSeason}`
        : `Fase de Testes #${Number(seasonMeta.testingCycle || seasonMeta.currentSeason || 1)}`,
    startedAt: seasonMeta.startedAt,
    endedAt: new Date().toISOString(),
    topClassic: getRankedPlayersByMode(statsData, QUEUE_MODES.CLASSIC, null, seasonMeta).slice(0, 10),
    topAram: getRankedPlayersByMode(statsData, QUEUE_MODES.ARAM, null, seasonMeta).slice(0, 10),
    topAram1x1: getRankedPlayersByMode(statsData, QUEUE_MODES.ARAM, '1x1', seasonMeta).slice(0, 10),
    playersSnapshot: deepClone(statsData),
    seasonMetaSnapshot: deepClone(seasonMeta)
  };
  return archivedSeason;
}

function getCustomPointsDelta(modeStats) {
  const baseMmr = Number(modeStats?.baseMmr || 0);
  const seed = calculateSeedRating(baseMmr);
  const rating = Number(modeStats?.internalRating);
  const current = Number.isFinite(rating) ? rating : seed;

  return Math.round(current - seed);
}

function getCustomDisplayScore(modeStats) {
  return DEFAULT_CUSTOM_POINTS + getCustomPointsDelta(modeStats);
}

function buildPlayerCardEmbed(playerStats, targetUser) {
  const modes = normalizePlayerModes(playerStats);
  const classicStats = modes.classic;
  const lolMmr = Number(classicStats.baseMmr || playerStats.baseMmr || 0);
  const lolRankLabel = playerStats.tier
    ? formatRank(playerStats)
    : getRankName(lolMmr);

  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('👤 Ficha do Jogador')
    .setDescription(targetUser ? `${targetUser}` : `\`${playerStats.nickname}\``)
    .addFields(
      { name: 'Nick', value: `\`${playerStats.nickname || 'Nao identificado'}\``, inline: true },
      { name: 'Elo LoL', value: `**${lolRankLabel}**\n\`${lolMmr} pts\``, inline: true },
      { name: 'Pontos Custom', value: `\`${getCustomDisplayScore(classicStats)}\``, inline: true }
    );

  for (const [key, stats] of Object.entries(modes)) {
    const totalGames = Number(stats.customWins || 0) + Number(stats.customLosses || 0);
    if (totalGames === 0 && key !== 'classic') continue;

    const winRate = totalGames > 0 ? ((Number(stats.customWins || 0) / totalGames) * 100).toFixed(1) : '0.0';
    const customScore = getCustomDisplayScore(stats);

    let label = key.toUpperCase();
    if (key.startsWith('aram') && key.length > 4) {
       const format = key.slice(4);
       label = `ARAM ${format.slice(0, 1)}x${format.slice(1)}`;
    }

    embed.addFields({
      name: `📊 ${label}`,
      value: `\`${stats.customWins}V / ${stats.customLosses}D\`\nCustom: \`${customScore}\`\nWR: \`${winRate}%\`\nStreak: \`${stats.winStreak || 0}\``,
      inline: true
    });
  }

  embed.setFooter({ text: `${FOOTER_PREFIX} • Perfil` }).setTimestamp();
  return embed;
}

function getSaoPauloDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    key: `${parts.year}-${parts.month}-${parts.day}`
  };
}

async function postDailyRankUpdates() {
  const channelId = config.textChannels?.rankUpdatesChannelId;

  if (!channelId) {
    return;
  }

  const channel = await global.discordClient.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  const statsData = await loadPlayerStats();
  const seasonMeta = await loadSeasonMeta();

  await channel.send({
    content: `Atualizacao diaria de rankings | ${getSeasonDisplayLabel(seasonMeta)}`,
    embeds: [
      buildTopTenEmbed(statsData, seasonMeta, QUEUE_MODES.CLASSIC),
      buildTopTenEmbed(statsData, seasonMeta, QUEUE_MODES.ARAM),
      buildTopTenEmbed(statsData, seasonMeta, QUEUE_MODES.ARAM, '1x1')
    ]
  });
}

async function postMvpAnnouncement(guild, mvpData) {
  const channelId = config.textChannels.mvpAnnouncementsChannelId;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle('⭐ DESTAQUE DA PARTIDA ⭐')
    .setDescription(`O jogador <@${mvpData.discordId}> foi o grande destaque da ultima rodada!`)
    .addFields(
      { name: '🔥 Win Streak', value: `\`${mvpData.winStreak}\` vitorias seguidas`, inline: true },
      { name: '📊 Rank Atual', value: `**${mvpData.afterRank} pts**`, inline: true }
    )
    .setThumbnail('https://i.imgur.com/8Q9S8Xj.png')
    .setFooter({ text: `${FOOTER_PREFIX} • MVP Hall of Fame` })
    .setTimestamp();

  await channel.send({ content: `Parabens <@${mvpData.discordId}>! 🏆`, embeds: [embed] }).catch(err => 
    console.error('[MVP] Erro ao postar anuncio no canal de destaques:', err.message)
  );
}
async function updateQueueDashboard(guild) {
  const channelId = config.textChannels.queueStatusChannelId;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const queueData = await loadQueue();
  const systemMeta = await loadSystemMeta();
  const embed = buildQueueEmbed(null, Object.values(queueData.lobbies || {}));

  try {
    if (systemMeta.lastQueueMessageId) {
      const lastMessage = await channel.messages.fetch(systemMeta.lastQueueMessageId).catch(() => null);
      if (lastMessage) {
        await lastMessage.edit({ embeds: [embed] });
        return;
      }
    }

    const newMessage = await channel.send({ embeds: [embed] });
    systemMeta.lastQueueMessageId = newMessage.id;
    await saveSystemMeta(systemMeta);
  } catch (err) {
    console.error('[DASHBOARD] Erro ao atualizar painel de fila:', err.message);
  }
}

async function sendMatchStartAnnouncement(guild, teams) {
  const channelId = config.textChannels.matchOngoingChannelId;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = buildTeamsEmbed(teams);
  await channel.send({ 
    content: '⚔️ **Nova partida iniciada!** Preparem-se para a batalha.',
    embeds: [embed] 
  }).catch(err => 
    console.error('[MATCH] Erro ao anunciar partida em andamento:', err.message)
  );
}

async function postMatchHistoryLog(guild, payload) {
  const channelId = config.textChannels?.matchHistoryChannelId;

  if (!channelId) {
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  const summaryEmbed = new EmbedBuilder()
    .setColor(payload.winningTeam === '1' ? THEME.SUCCESS : THEME.WARNING)
    .setTitle('📋 Histórico de Partida')
    .setDescription(
      `**${payload.modeLabel} ${payload.formatLabel}** | Lobby **${payload.letter}**\nVencedor: **Equipe ${payload.winningTeam}**\nPeríodo: **${payload.periodLabel}**`
    )
    .addFields(
      { name: 'Início', value: `\`${formatDateTimeForHistory(payload.startedAt)}\``, inline: true },
      { name: 'Fim', value: `\`${formatDateTimeForHistory(payload.finishedAt)}\``, inline: true },
      { name: 'Diferença MMR', value: `\`${payload.initialDifference}\``, inline: true }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Histórico` })
    .setTimestamp(new Date(payload.finishedAt));

  const detailEmbed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('⭐ Jogadores e Variação de Rank')
    .setFooter({ text: `${FOOTER_PREFIX} • Detalhes` })
    .setTimestamp(new Date(payload.finishedAt));

  const winnerEntries = payload.winners.map((player, index) => {
    return [
      `**${index + 1}.** <@${player.discordId}> | \`${player.nickname}\``,
      `Antes: \`${player.beforeRank}\` | Depois: \`${player.afterRank}\``,
      `Antes W/L: \`${player.beforeRecord}\` | Depois W/L: \`${player.afterRecord}\``,
      `Resultado: \`Vitoria\``
    ].join('\n');
  });
  const loserEntries = payload.losers.map((player, index) => {
    return [
      `**${index + 1}.** <@${player.discordId}> | \`${player.nickname}\``,
      `Antes: \`${player.beforeRank}\` | Depois: \`${player.afterRank}\``,
      `Antes W/L: \`${player.beforeRecord}\` | Depois W/L: \`${player.afterRecord}\``,
      `Resultado: \`Derrota\``
    ].join('\n');
  });

  splitEmbedFieldChunks(winnerEntries).forEach((chunk, index) => {
    detailEmbed.addFields({
      name: index === 0 ? `Equipe ${payload.winningTeam} - Vencedores` : `Equipe ${payload.winningTeam} - Vencedores (${index + 1})`,
      value: chunk
    });
  });

  const losingTeam = payload.winningTeam === '1' ? '2' : '1';
  splitEmbedFieldChunks(loserEntries).forEach((chunk, index) => {
    detailEmbed.addFields({
      name: index === 0 ? `Equipe ${losingTeam} - Derrotados` : `Equipe ${losingTeam} - Derrotados (${index + 1})`,
      value: chunk
    });
  });

  await channel.send({ embeds: [summaryEmbed, detailEmbed] }).catch(() => null);
}

function startDailyRankScheduler() {
  setInterval(async () => {
    try {
      const now = getSaoPauloDateParts(new Date());
      const targetHour = Number(config.automation?.dailyRankUpdatesHour ?? 9);
      const targetMinute = Number(config.automation?.dailyRankUpdatesMinute ?? 0);

      if (now.hour !== targetHour || now.minute !== targetMinute) {
        return;
      }

      if (lastDailyRankPostKey === now.key) {
        return;
      }

      lastDailyRankPostKey = now.key;
      await postDailyRankUpdates();
      for (const guild of global.discordClient?.guilds.cache.values() || []) {
        await expireInfernalRolesIfDue(guild);
        await reconcileInfernalRoles(guild).catch(() => null);
      }
    } catch (error) {
      console.error('Erro ao publicar ranking diario:', error);
    }
  }, 30000);
}

async function movePlayersToTeamChannels(guild, teams, teamChannelIds) {
  const teamOneChannel = await guild.channels.fetch(teamChannelIds.teamOneChannelId).catch(() => null);
  const teamTwoChannel = await guild.channels.fetch(teamChannelIds.teamTwoChannelId).catch(() => null);
  const announceChannel = await guild.channels.fetch(config.textChannels.matchOngoingChannelId).catch(() => null);

  if (
    !teamOneChannel ||
    !teamTwoChannel ||
    teamOneChannel.type !== ChannelType.GuildVoice ||
    teamTwoChannel.type !== ChannelType.GuildVoice
  ) {
    console.warn('[MOVE] Canais de equipe não encontrados, pulando movimentação.');
    return;
  }

  const allPlayers = [
    ...teams.teamOne.map((player) => ({ ...player, channel: teamOneChannel })),
    ...teams.teamTwo.map((player) => ({ ...player, channel: teamTwoChannel }))
  ];

  const notInVoice = [];

  for (const player of allPlayers) {
    const member = await guild.members.fetch(player.discordId).catch(() => null);
    if (!member?.voice?.channel) {
      notInVoice.push(player);
      continue;
    }

    await member.voice.setChannel(player.channel).catch(err =>
      console.warn(`[MOVE] Não foi possível mover ${player.nickname}:`, err.message)
    );
  }

  if (notInVoice.length > 0 && announceChannel?.isTextBased()) {
    const mentions = notInVoice.map((p) => `<@${p.discordId}>`).join(' ');
    await announceChannel.send({
      content: `⚠️ Não consegui mover ${mentions} porque não estavam em call. Entrem no lobby para divisão automática.`
    }).catch(() => null);
    console.warn('[MOVE] Jogadores sem canal de voz:', notInVoice.map((p) => p.nickname || p.discordId).join(', '));
  }
}

async function movePlayersToVoiceChannel(guild, players, channelId) {
  const targetChannel = await guild.channels.fetch(channelId).catch(() => null);

  if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
    return;
  }

  for (const player of players) {
    const member = await guild.members.fetch(player.discordId).catch(() => null);

    if (member?.voice?.channel) {
      await member.voice.setChannel(targetChannel).catch(() => null);
    }
  }
}

async function deleteVoiceChannelIfExists(guild, channelId) {
  if (!channelId) {
    return false;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    return false;
  }

  if (!channel.deletable) {
    console.warn(`[CANAIS] Nao foi possivel remover o canal ${channel.name} (${channel.id}) porque ele nao esta deletavel.`);
    return false;
  }

  try {
    await channel.delete();
    return true;
  } catch (error) {
    if (error?.code === 10003) {
      return false;
    }

    console.error(`[CANAIS] Erro ao remover o canal ${channel.name} (${channel.id}):`, error);
    return false;
  }
}

function isManagedDynamicChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return false;
  }

  if ([config.voiceChannels.classicQueueChannelId, config.voiceChannels.aramQueueChannelId].includes(channel.id)) {
    return false;
  }

  return (
    channel.name.startsWith('Lobby CLASSIC ') ||
    channel.name.startsWith('Lobby TIER S ') ||
    channel.name.startsWith('Lobby ARAM ') ||
    channel.name.startsWith('CLASSIC 1 ') ||
    channel.name.startsWith('CLASSIC 2 ') ||
    /^ARAM\s[1-5]x[1-5]\s[12]\s[A-Z]+$/i.test(channel.name)
  );
}

function getExpectedWaitingRoomName(mode, format, letter, tier = null) {
  if (mode === QUEUE_MODES.ARAM) return `Lobby ARAM ${format} ${letter}`;
  if (tier === 'S') return `Lobby TIER S ${letter}`;
  return `Lobby CLASSIC ${letter}`;
}

function getExpectedTeamRoomNames(mode, format, letter) {
  return mode === QUEUE_MODES.ARAM
    ? [`ARAM ${format} 1 ${letter}`, `ARAM ${format} 2 ${letter}`]
    : [`CLASSIC 1 ${letter}`, `CLASSIC 2 ${letter}`];
}

async function deleteManagedChannelsForLobby(guild, mode, format, letter, extraChannelIds = [], tier = null) {
  const expectedNames = [getExpectedWaitingRoomName(mode, format, letter, tier), getExpectedWaitingRoomName(mode, format, letter, tier === 'S' ? null : 'S'), ...getExpectedTeamRoomNames(mode, format, letter)];
  const channelIds = new Set(extraChannelIds.filter(Boolean));

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice) {
      continue;
    }

    if (expectedNames.includes(channel.name)) {
      channelIds.add(channel.id);
    }
  }

  let removedCount = 0;

  for (const channelId of channelIds) {
    const removed = await deleteVoiceChannelIfExists(guild, channelId);

    if (removed) {
      removedCount += 1;
    }
  }

  return removedCount;
}

async function deleteChannelsByNames(guild, names = []) {
  let removedCount = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice) {
      continue;
    }

    if (!names.includes(channel.name)) {
      continue;
    }

    const removed = await deleteVoiceChannelIfExists(guild, channel.id);

    if (removed) {
      removedCount += 1;
    }
  }

  return removedCount;
}

function findReusableWaitingLobby(guild, queueData, currentMatchData, mode, format) {
  const waitingLobbies = Object.values(queueData.lobbies || {}).filter(
    (lobby) => lobby.mode === mode && lobby.format === format && lobby.status === 'waiting'
  );
  const reservedLetters = getReservedLobbyLetters(queueData, currentMatchData, mode, format);

  for (const channel of guild.channels.cache.values()) {
    if (!isManagedDynamicChannel(channel) || channel.type !== ChannelType.GuildVoice) {
      continue;
    }

    for (const letter of Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))) {
      if (reservedLetters.has(letter)) {
        continue;
      }

      if (channel.name === getExpectedWaitingRoomName(mode, format, letter)) {
        return {
          id: `${mode}-${format}-${letter.toLowerCase()}`,
          mode,
          format,
          letter,
          waitingChannelId: channel.id,
          parentId: channel.parentId || null,
          requiredPlayers: getRequiredPlayersByModeAndFormat(mode, format),
          players: [],
          status: 'waiting'
        };
      }
    }
  }

  return null;
}

function getActiveMatchEntry(currentMatchData, channelId) {
  const activeEntries = Object.entries(currentMatchData.matches || {}).filter(([, entry]) => entry.active && entry.match);

  if (channelId) {
    const matchedEntry = findActiveMatchByChannelId(currentMatchData, channelId);

    if (matchedEntry) {
      return matchedEntry;
    }
  }

  if (activeEntries.length === 1) {
    return activeEntries[0];
  }

  return null;
}

function buildLobbyFromMatch(match) {
  return {
    id: match.id,
    mode: match.mode,
    format: match.format || (match.mode === QUEUE_MODES.ARAM ? getAramFormatLabel(match.teamSize || 5) : '5x5'),
    letter: match.letter,
    waitingChannelId: match.waitingChannelId || null,
    parentId: match.parentId || null,
    requiredPlayers: Number(match.requiredPlayers || (match.teamSize || 5) * 2),
    players: [...(match.teamOne || []), ...(match.teamTwo || [])],
    status: 'waiting'
  };
}

async function resolveMessageChannel(message) {
  if (message.channel?.isTextBased?.()) {
    return message.channel;
  }

  if (!message.channelId) {
    return null;
  }

  const fetchedChannel = await message.client.channels.fetch(message.channelId).catch(() => null);
  return fetchedChannel?.isTextBased?.() ? fetchedChannel : null;
}

async function sendToMessageChannel(message, payload) {
  if (message.isInteractionContext && typeof message.send === 'function') {
    return message.send(payload);
  }

  const channel = await resolveMessageChannel(message);

  if (!channel) {
    return null;
  }

  return channel.send(payload).catch(() => null);
}

async function replyToMessage(message, payload) {
  if (message.isInteractionContext && typeof message.reply === 'function') {
    return message.reply(payload);
  }

  try {
    return await message.reply(payload);
  } catch (error) {
    return sendToMessageChannel(message, payload);
  }
}

function normalizeDiscordPayload(payload) {
  return typeof payload === 'string' ? { content: payload } : payload;
}

function createInteractionContext(interaction, overrides = {}) {
  return {
    isInteractionContext: true,
    client: interaction.client,
    guild: interaction.guild,
    member: interaction.member,
    author: interaction.user,
    channel: interaction.channel,
    channelId: interaction.channelId,
    content: overrides.content || '',
    mentions: {
      users: {
        first: () => overrides.targetUser || null
      }
    },
    async reply(payload) {
      const normalizedPayload = normalizeDiscordPayload(payload);

      if (interaction.replied || interaction.deferred) {
        return interaction.editReply(normalizedPayload).catch(() => interaction.followUp(normalizedPayload)).catch(() => null);
      }

      return interaction.reply(normalizedPayload).catch(() => null);
    },
    async send(payload) {
      const normalizedPayload = normalizeDiscordPayload(payload);

      if (interaction.replied || interaction.deferred) {
        return interaction.editReply(normalizedPayload).catch(() => interaction.followUp(normalizedPayload)).catch(() => null);
      }

      return interaction.reply(normalizedPayload).catch(() => null);
    }
  };
}

// ─── Task 2.1: getRankedPlayersByStreak ───────────────────────────────────────
// ─── Task 2.3: decorateWithLeaderIcons ────────────────────────────────────────
function decorateWithLeaderIcons(entries, rankedPlayers) {
  if (!entries || entries.length === 0 || !rankedPlayers || rankedPlayers.length === 0) {
    return { decoratedEntries: entries || [], streakFooter: null };
  }

  const maxStreak = Math.max(...rankedPlayers.map(p => p.winStreak || 0));
  const streakLeaderIndices = maxStreak >= 1
    ? rankedPlayers.map((p, i) => (p.winStreak || 0) === maxStreak ? i : -1).filter(i => i !== -1)
    : [];

  const decorated = entries.map((entry, index) => {
    let icons = '';
    if (index === 0) icons += '👑';
    if (streakLeaderIndices.includes(index)) icons += '🔥';
    return icons ? `${icons} ${entry}` : entry;
  });

  let streakFooter = null;
  if (maxStreak >= 1) {
    const leader = rankedPlayers[streakLeaderIndices[0]];
    streakFooter = `🔥 Maior Streak Ativa: ${leader.nickname} (${maxStreak} vitórias seguidas)`;
  }

  return { decoratedEntries: decorated, streakFooter };
}

// ─── Task 5.1: buildTopStreakEmbed ────────────────────────────────────────────
function buildTopStreakEmbed(statsData, mode, format = null) {
  const players = getRankedPlayersByStreak(statsData, mode, format);
  const modeLabel = getStatsBucketLabel(mode, format);
  const medals = ['🥇', '🥈', '🥉'];

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle(`🔥 Top Streak - ${modeLabel}`)
    .setDescription(`Maiores sequências de vitórias ativas em **${modeLabel}**.`)
    .setFooter({ text: `${FOOTER_PREFIX} • Top Streak ${modeLabel}` })
    .setTimestamp();

  if (players.length === 0) {
    embed.addFields({ name: 'Sem sequências ativas', value: 'Não há sequências ativas no momento.' });
    return embed;
  }

  const entries = players.map((player, index) => {
    const medal = medals[index] || `#${index + 1}`;
    return `${medal} <@${player.discordId}> | \`${player.nickname}\`\n🔥 Streak: **${player.winStreak}** | ${player.customWins}V / ${player.customLosses}D`;
  });

  splitEmbedFieldChunks(entries).forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? `Top Streak ${modeLabel}` : `Top Streak ${modeLabel} (${index + 1})`,
      value: chunk
    });
  });

  return embed;
}

// ─── Task 6.1: buildPlayerMatchLogEmbed ──────────────────────────────────────
function buildPlayerMatchLogEmbed(player, delta, match) {
  const normalizedResult = String(delta.result || '').toLowerCase();
  const isWin = normalizedResult === 'vitoria';
  const color = isWin ? THEME.SUCCESS : THEME.ERROR;
  const resultLabel = isWin ? '✅ Vitória' : '❌ Derrota';
  const modeLabel = getStatsBucketLabel(match.mode, match.format);
  const timestamp = formatDateTimeForHistory(match.finishedAt || new Date().toISOString());

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`📋 Log de Partida — ${modeLabel}`)
    .setDescription(`<@${player.discordId}> | \`${player.nickname}\``)
    .addFields(
      { name: 'Resultado', value: resultLabel, inline: true },
      { name: 'Modo', value: modeLabel, inline: true },
      { name: 'Lobby', value: `\`${match.letter || '?'}\``, inline: true },
      { name: 'MMR Antes', value: `\`${delta.mmrBefore}\``, inline: true },
      { name: 'MMR Depois', value: `\`${delta.mmrAfter}\``, inline: true },
      { name: 'Variação', value: `\`${delta.mmrAfter - delta.mmrBefore >= 0 ? '+' : ''}${delta.mmrAfter - delta.mmrBefore}\``, inline: true },
      { name: 'Recorde W/D', value: `\`${delta.customWins}V / ${delta.customLosses}D\``, inline: true },
      { name: '🔥 Streak', value: `\`${delta.winStreak}\``, inline: true },
      { name: '🕐 Data/Hora', value: `\`${timestamp}\``, inline: true }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Player Log` })
    .setTimestamp();
}

const SMURF_MIN_GAMES = 5;
const SMURF_MIN_WINRATE = 70;
const SMURF_MAX_LOL_MMR = 1200;
const SMURF_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const lastSmurfAlerts = new Map();

function evaluateSmurfSuspect(player, modeStats) {
  const wins = Number(modeStats.customWins || 0);
  const losses = Number(modeStats.customLosses || 0);
  const games = wins + losses;
  const lolMmr = Number(modeStats.baseMmr || player.baseMmr || 0);

  if (games < SMURF_MIN_GAMES || lolMmr >= SMURF_MAX_LOL_MMR) {
    return null;
  }

  const winRate = (wins / games) * 100;
  if (winRate < SMURF_MIN_WINRATE) {
    return null;
  }

  return {
    wins,
    losses,
    games,
    winRate,
    lolMmr,
    rankName: getRankName(lolMmr),
    customScore: getCustomDisplayScore(modeStats),
    winStreak: Number(modeStats.winStreak || 0)
  };
}

function buildSmurfAlertEmbed(player, suspect, match) {
  const mention = player.discordId ? `<@${player.discordId}>` : `\`${player.nickname}\``;
  const modeLabel = getStatsBucketLabel(match.mode, match.format);

  return new EmbedBuilder()
    .setColor(THEME.WARNING)
    .setTitle('Possivel smurf')
    .setDescription(`${mention} esta com elo baixo no cadastro e desempenho alto nas customs.`)
    .addFields(
      { name: 'Nick', value: `\`${player.nickname || player.registeredNickname || 'N/A'}\``, inline: true },
      { name: 'Elo cadastrado', value: `**${suspect.rankName}**\n\`${suspect.lolMmr} pts LoL\``, inline: true },
      { name: 'Modo', value: `\`${modeLabel}\``, inline: true },
      { name: 'Custom', value: `\`${suspect.wins}V / ${suspect.losses}D\` (${suspect.winRate.toFixed(0)}% WR)`, inline: true },
      { name: 'Pontos Custom', value: `\`${suspect.customScore}\``, inline: true },
      { name: 'Streak', value: `\`${suspect.winStreak}\``, inline: true }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Conferir conta main ou ajustar Base MMR no admin` })
    .setTimestamp();
}

async function postSmurfAlerts(guild, match, statsData) {
  const channelId = config.textChannels?.smurfAlertChannelId
    || config.textChannels?.seasonLogChannelId
    || config.textChannels?.playerLogChannelId;

  if (!channelId || !guild) {
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const participants = [...(match.teamOne || []), ...(match.teamTwo || [])];
  const now = Date.now();

  for (const participant of participants) {
    const stored = getStoredPlayerStats(statsData, participant);
    const modeStats = getModeStats(stored, match.mode, match.format);
    const suspect = evaluateSmurfSuspect(stored, modeStats);

    if (!suspect) {
      continue;
    }

    const cooldownKey = `${participant.discordId}:${match.mode}:${match.format || '5x5'}`;
    const lastAlert = lastSmurfAlerts.get(cooldownKey) || 0;
    if (now - lastAlert < SMURF_ALERT_COOLDOWN_MS) {
      continue;
    }

    lastSmurfAlerts.set(cooldownKey, now);
    await channel.send({
      embeds: [buildSmurfAlertEmbed({ ...stored, ...participant }, suspect, match)]
    }).catch((error) => {
      console.error('[SMURF] Falha ao postar alerta:', error.message);
    });
  }
}

// ─── Task 6.3: postPlayerLogs ─────────────────────────────────────────────────
async function postPlayerLogs(guild, matchResult, statsData) {
  const channelId = config.textChannels?.playerLogChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const { match, playerDeltas } = matchResult;
  for (const [discordId, delta] of Object.entries(playerDeltas)) {
    const player = { discordId, nickname: delta.nickname || discordId };
    const embed = buildPlayerMatchLogEmbed(player, delta, match);
    await channel.send({ embeds: [embed] }).catch(() => null);
  }
}

// ─── Task 7.1: postMatchSummaryToSeasonLog ────────────────────────────────────
async function postMatchSummaryToSeasonLog(guild, matchResult) {
  const channelId = config.textChannels?.seasonLogChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const { match, winnerTeam, teamOneAvgDelta, teamTwoAvgDelta } = matchResult;
  const modeLabel = getStatsBucketLabel(match.mode, match.format);

  const teamOneNames = (match.teamOne || []).map(p => p.nickname).join(', ') || 'N/A';
  const teamTwoNames = (match.teamTwo || []).map(p => p.nickname).join(', ') || 'N/A';

  const embed = new EmbedBuilder()
    .setColor(THEME.SUCCESS)
    .setTitle(`📊 Resumo de Partida — ${modeLabel}`)
    .setDescription(`Lobby **${match.letter || '?'}** | Vencedor: **Time ${winnerTeam}**`)
    .addFields(
      { name: 'Modo', value: modeLabel, inline: true },
      { name: 'Lobby', value: `\`${match.letter || '?'}\``, inline: true },
      { name: 'Vencedor', value: `**Time ${winnerTeam}**`, inline: true },
      { name: 'Time 1', value: teamOneNames, inline: false },
      { name: 'Time 2', value: teamTwoNames, inline: false },
      { name: 'Δ MMR Médio Time 1', value: `\`${teamOneAvgDelta >= 0 ? '+' : ''}${teamOneAvgDelta}\``, inline: true },
      { name: 'Δ MMR Médio Time 2', value: `\`${teamTwoAvgDelta >= 0 ? '+' : ''}${teamTwoAvgDelta}\``, inline: true }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Season Log` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

// ─── Task 7.3: postSeasonSummaryToSeasonLog ───────────────────────────────────
async function postSeasonSummaryToSeasonLog(guild, archivedSeason) {
  const channelId = config.textChannels?.seasonLogChannelId;
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const label = archivedSeason.label || `Temporada #${archivedSeason.seasonNumber}`;
  const totalMatches = archivedSeason.totalMatches || 0;

  const formatTop5 = (list) => (list || []).slice(0, 5)
    .map((p, i) => `**${i + 1}.** ${p.nickname} — ${p.adjustedMmr} pts (${p.customWins}V/${p.customLosses}D)`)
    .join('\n') || 'Sem dados';

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle(`🏆 Resumo de Temporada — ${label}`)
    .setDescription(`Início: \`${formatDateTimeForHistory(archivedSeason.startedAt)}\`\nEncerramento: \`${formatDateTimeForHistory(archivedSeason.endedAt)}\``)
    .addFields(
      { name: '🎮 Total de Partidas', value: `\`${totalMatches}\``, inline: true },
      { name: 'Top 5 CLASSIC', value: formatTop5(archivedSeason.topClassic), inline: false },
      { name: 'Top 5 ARAM', value: formatTop5(archivedSeason.topAram), inline: false },
      { name: 'Top 5 ARAM 1x1', value: formatTop5(archivedSeason.topAram1x1), inline: false }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Season Log` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = {
  getSeasonDisplayLabel,
  formatDateTimeForHistory,
  getArchivedSeasonLabel,
  getQueueChannel,
  isMemberInQueueVoiceChannel,
  formatRank,
  formatQueueMode,
  getStatsBucketKey,
  getStatsBucketLabel,
  getAramFormatLabel,
  getAramWeightByTeamSize,
  getRequiredPlayersLabel,
  isValidQueueSize,
  getRequiredPlayersByModeAndFormat,
  getFormatFromArgs,
  getNicknameArgs,
  numberToLobbyLetter,
  getReservedLobbyLetters,
  getNextLobbyLetter,
  getBaseQueueChannelIdByMode,
  getPostMatchVoiceChannelId,
  getOpenLobby,
  findLobbyByChannelId,
  findLobbyByPlayer,
  findActiveMatchByChannelId,
  normalizeLobbySelectorArgs,
  findLobbyBySelector,
  findActiveMatchBySelector,
  createLobbyChannels,
  createTeamChannelsForLobby,
  formatCustomRecord,
  createEmptyModeStats,
  normalizePlayerModes,
  getModeStats,
  getPlayerStatsKey,
  getStoredPlayerStats,
  upsertPlayerStats,
  getRankName,
  getCustomPointsDelta,
  getCustomDisplayScore,
  syncMemberRankRole,
  syncMvpRole,
  clearMvpRoles,
  syncInfernalRolesAfterMatch,
  hasInfernalPriority,
  reconcileInfernalRoles,
  postInfernalAnnouncement,
  postRouletteAnnouncement,
  expireInfernalRolesIfDue,
  isTierSEligibleByStats,
  isTierSEligibleMember,
  isTierSVoiceChannel,
  isMemberInTierSVoiceChannel,
  isStaffBypass,
  getClassicTierSQueueChannelId,
  getLobbyTier,
  getRouletteTimeoutMs,
  getRouletteWarnMs,
  getRouletteAnnounceChannelId,
  startMvpVote,
  handleMvpVoteInteraction,
  resumePendingMvpVotes,
  THEME,
  FOOTER_PREFIX,
  buildQueueEmbed,
  splitEmbedFieldChunks,
  buildTeamsEmbed,
  buildLeaderboardEmbed,
  getRankedPlayersByMode,
  getRankedPlayersByStreak,
  decorateWithLeaderIcons,
  buildTopTenEmbed,
  buildTopStreakEmbed,
  buildRulesEmbed,
  RULES_SECTIONS,
  buildStaffEmbed,
  STAFF_SECTIONS,
  buildSeasonHistoryEmbed,
  resetStatsForNewSeason,
  deepClone,
  hasArchivedSeasonData,
  buildRestoredStatsFromArchive,
  inferSeasonMetaFromArchive,
  archiveCurrentSeason,
  buildPlayerCardEmbed,
  buildPlayerMatchLogEmbed,
  postPlayerLogs,
  postSmurfAlerts,
  postMatchSummaryToSeasonLog,
  postSeasonSummaryToSeasonLog,
  getSaoPauloDateParts,
  postDailyRankUpdates,
  postMatchHistoryLog,
  postMvpAnnouncement,
  updateQueueDashboard,
  sendMatchStartAnnouncement,
  startDailyRankScheduler,
  movePlayersToTeamChannels,
  movePlayersToVoiceChannel,
  deleteVoiceChannelIfExists,
  isManagedDynamicChannel,
  getExpectedWaitingRoomName,
  getExpectedTeamRoomNames,
  deleteManagedChannelsForLobby,
  deleteChannelsByNames,
  findReusableWaitingLobby,
  getActiveMatchEntry,
  buildLobbyFromMatch,
  resolveMessageChannel,
  sendToMessageChannel,
  replyToMessage,
  normalizeDiscordPayload,
  createInteractionContext,
  RANK_ROLES_MAP,
  ALL_RANK_ROLE_NAMES,
  MVP_ROLE_NAMES,
  THEME,
  FOOTER_PREFIX
};
