const { ChannelType, EmbedBuilder } = require('discord.js');
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
const { calculateSeedRating, calculateHybridMmr, calculateEloDelta } = require('../services/balanceService');

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
  if (val < 900) return 'Ferro';
  if (val < 1100) return 'Bronze';
  if (val < 1300) return 'Prata';
  if (val < 1500) return 'Ouro';
  if (val < 1700) return 'Platina';
  return 'Diamante';
}

const RANK_ROLES_MAP = {
  Ferro: 'Ferro',
  Bronze: '🥉 Bronze',
  Prata: '🥈 Prata',
  Ouro: '🥇 Ouro',
  Platina: '🔷Platina',
  Diamante: '💎 Diamante'
};

const ALL_RANK_ROLE_NAMES = Object.values(RANK_ROLES_MAP);
const MVP_ROLE_NAME = '⭐ MVP';

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


function isMemberInQueueVoiceChannel(member, mode) {
  const voiceChannel = member.voice?.channel;

  if (!voiceChannel) {
    return false;
  }

  if (mode === QUEUE_MODES.ARAM) {
    return voiceChannel.id === config.voiceChannels.aramQueueChannelId;
  }

  return voiceChannel.id === config.voiceChannels.classicQueueChannelId;
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

function getBaseQueueChannelIdByMode(mode) {
  return mode === QUEUE_MODES.ARAM ? config.voiceChannels.aramQueueChannelId : config.voiceChannels.classicQueueChannelId;
}

function getOpenLobby(queueData, mode, format) {
  return Object.values(queueData.lobbies || {}).find(
    (lobby) => lobby.mode === mode && lobby.format === format && lobby.status === 'waiting' && lobby.players.length < lobby.requiredPlayers
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

async function createLobbyChannels(guild, mode, format, letter) {
  const baseChannel = guild.channels.cache.get(getBaseQueueChannelIdByMode(mode));

  if (!baseChannel || baseChannel.type !== ChannelType.GuildVoice) {
    throw new Error(`Canal base do modo ${formatQueueMode(mode)} nao encontrado no config.json.`);
  }

  const parent = baseChannel.parentId || null;
  const waitingName = getExpectedWaitingRoomName(mode, format, letter);
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
  const baseChannel = guild.channels.cache.get(getBaseQueueChannelIdByMode(lobby.mode));

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
  if (!guild || !discordId) return;

  try {
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return;

    const rankTier = getRankName(mmr);
    const targetRoleName = RANK_ROLES_MAP[rankTier];
    if (!targetRoleName) return;

    const roles = guild.roles.cache;
    const targetRole = roles.find(r => r.name === targetRoleName);

    // Remove other rank roles
    const currentRankRoles = member.roles.cache.filter(r => 
      ALL_RANK_ROLE_NAMES.includes(r.name) && r.name !== targetRoleName
    );

    if (currentRankRoles.size > 0) {
      await member.roles.remove(currentRankRoles).catch(err => 
        console.error(`[ROLES] Erro ao remover cargos de ${member.user.tag}:`, err.message)
      );
    }

    // Add target role if not present
    if (targetRole && !member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole).catch(err => 
        console.error(`[ROLES] Erro ao adicionar cargo ${targetRoleName} em ${member.user.tag}:`, err.message)
      );
    }
  } catch (err) {
    console.error(`[ROLES] Erro crítico na sincronização de cargo para ${discordId}:`, err.message);
  }
}

async function syncMvpRole(guild, mvpId) {
  if (!guild || !mvpId) return;

  try {
    const mvpRole = guild.roles.cache.find(r => r.name === MVP_ROLE_NAME);
    if (!mvpRole) return;

    // Add to new MVP (não remove dos outros — a remoção é feita no início da próxima partida)
    const newMvp = await guild.members.fetch(mvpId).catch(() => null);
    if (newMvp && !newMvp.roles.cache.has(mvpRole.id)) {
      await newMvp.roles.add(mvpRole).catch(err => 
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
    const mvpRole = guild.roles.cache.find(r => r.name === MVP_ROLE_NAME);
    if (!mvpRole) return;
    for (const [, member] of mvpRole.members) {
      await member.roles.remove(mvpRole).catch(() => null);
    }
  } catch (err) {
    console.error(`[ROLES] Erro ao limpar cargos MVP:`, err.message);
  }
}

function getPlayerStatsKey(player) {
  return player.puuid || `discord:${player.discordId}`;
}

function getStoredPlayerStats(statsData, player) {
  const key = getPlayerStatsKey(player);
  const normalizedModes = normalizePlayerModes(player);

  return (
    statsData.players[key] || {
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
            (entry) =>
              `**${entry.letter || '?'}** | ${formatQueueMode(entry.mode)} ${entry.mode === QUEUE_MODES.ARAM ? entry.format || '5x5' : '5x5'} | ${Array.isArray(entry.players) ? entry.players.length : 0}/${entry.requiredPlayers || 0}`
          )
          .join('\n')
      : 'Nenhuma sala de espera ativa no momento.';

    embed.addFields({
      name: 'Salas de espera ativas',
      value: overview
    });

    return embed;
  }

  embed
    .addFields(
      { name: 'Lobby', value: `\`${normalizedLobby.letter || '?'}\``, inline: true },
      { name: 'Modo', value: `\`${formatQueueMode(normalizedLobby.mode)}\``, inline: true },
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
      `**${index + 1}.** <@${player.discordId}>\nNick: \`${player.nickname}\`\nElo: \`${formatRank(player)}\`\nCustom ${formatQueueMode(normalizedLobby.mode)}: \`${formatCustomRecord(player)}\`\nRank: \`${player.mmr}\``
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

function buildTeamsEmbed(teams) {
  const teamOneText = teams.teamOne
    .map(
      (player) =>
        `- <@${player.discordId}> | ${player.nickname} | ${formatRank(player)} | ${formatCustomRecord(player)} | MMR: ${player.mmr}`
    )
    .join('\n');

  const teamTwoText = teams.teamTwo
    .map(
      (player) =>
        `- <@${player.discordId}> | ${player.nickname} | ${formatRank(player)} | ${formatCustomRecord(player)} | MMR: ${player.mmr}`
    )
    .join('\n');

  return new EmbedBuilder()
    .setColor(THEME.SUCCESS)
    .setTitle('⚔️ Times Balanceados')
    .setDescription(
      `Os times foram montados automaticamente com base no MMR dos jogadores.\nModo: **${formatQueueMode(teams.mode)}** | Formato: **${teams.teamOne.length}x${teams.teamTwo.length}**`
    )
    .addFields(
      {
        name: `Equipe 1 | MMR total: ${teams.teamOneMmr}`,
        value: teamOneText || 'Sem jogadores'
      },
      {
        name: `Equipe 2 | MMR total: ${teams.teamTwoMmr}`,
        value: teamTwoText || 'Sem jogadores'
      },
      {
        name: 'Diferenca de MMR',
        value: `${teams.difference}`
      }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Times Formados` })
    .setTimestamp();
}

function buildLeaderboardEmbed(statsData, mode = QUEUE_MODES.CLASSIC, format = null) {
  const rankedPlayers = getRankedPlayersByMode(statsData, mode, format);
  const modeLabel = getStatsBucketLabel(mode, format);
  const medals = ['🥇', '🥈', '🥉'];

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle(`🏆 Placar Geral - ${modeLabel}`)
    .setDescription(`Ranking interno de **${modeLabel}** baseado no histórico.`)
    .setFooter({ text: `${FOOTER_PREFIX} • Ranking ${modeLabel}` })
    .setTimestamp();

  if (rankedPlayers.length === 0) {
    embed.addFields({
      name: 'Sem estatísticas ainda',
      value: `Nenhuma partida ${modeLabel} foi registrada até o momento.`
    });
    return embed;
  }

  const rawEntries = rankedPlayers
    .slice(0, 15)
    .map((player, index) => {
      const medal = medals[index] || `#${index + 1}`;
      const rankName = getRankName(player.adjustedMmr);
      const label = player.discordId ? `<@${player.discordId}>` : `\`${player.nickname}\``;

      return `${medal} ${label}\n**${rankName} (${player.adjustedMmr} pts)** • ${player.customWins}V / ${player.customLosses}D`;
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

function buildTopTenEmbed(statsData, seasonMeta, mode, format = null) {
  const rankedPlayers = getRankedPlayersByMode(statsData, mode, format, seasonMeta).slice(0, 10);
  const modeLabel = getStatsBucketLabel(mode, format);
  const medals = ['🥇', '🥈', '🥉'];

  const embed = new EmbedBuilder()
    .setColor(THEME.RANK)
    .setTitle(`🏆 Top 10 - ${modeLabel}`)
    .setDescription(`Período atual: **${getSeasonDisplayLabel(seasonMeta)}**`)
    .setFooter({ text: `${FOOTER_PREFIX} • Top 10 ${modeLabel}` })
    .setTimestamp();

  if (rankedPlayers.length === 0) {
    embed.addFields({
      name: 'Sem ranking ainda',
      value: `Ainda nao ha jogadores ranqueados no modo ${modeLabel} neste periodo.`
    });

    return embed;
  }

  const rawEntries = rankedPlayers
    .map(
      (player, index) => {
        const medal = medals[index] || `#${index + 1}`;
        const rankName = getRankName(player.adjustedMmr);
        return `${medal} <@${player.discordId}>\n**${rankName} (${player.adjustedMmr} pts)** • ${player.customWins}V / ${player.customLosses}D`;
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
        winStreak: 0
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

function buildPlayerCardEmbed(playerStats, targetUser) {
  const modes = normalizePlayerModes(playerStats);
  const classicStats = modes.classic;
  const classicMmr = calculateHybridMmr(
    classicStats.baseMmr,
    classicStats.customWins,
    classicStats.customLosses,
    classicStats.internalRating
  );

  const embed = new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('👤 Ficha do Jogador')
    .setDescription(targetUser ? `${targetUser}` : `\`${playerStats.nickname}\``)
    .addFields(
      { name: 'Nick', value: `\`${playerStats.nickname || 'Nao identificado'}\``, inline: true },
      { name: 'Rank Principal', value: `**${getRankName(classicMmr)}** (${classicMmr} pts)`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true }
    );

  // Adicionar campos para cada modo que tenha pelo menos 1 partida jogada
  for (const [key, stats] of Object.entries(modes)) {
    const totalGames = Number(stats.customWins || 0) + Number(stats.customLosses || 0);
    if (totalGames === 0 && key !== 'classic') continue;

    const winRate = totalGames > 0 ? ((Number(stats.customWins || 0) / totalGames) * 100).toFixed(1) : '0.0';
    
    // Gerar um label amigável baseado na chave (ex: aram5x5 -> ARAM 5x5)
    let label = key.toUpperCase();
    if (key.startsWith('aram') && key.length > 4) {
       const format = key.slice(4);
       label = `ARAM ${format.slice(0, 1)}x${format.slice(1)}`;
    }

    embed.addFields({
      name: `📊 ${label}`,
      value: `\`${stats.customWins}V / ${stats.customLosses}D\`\nWR: \`${winRate}%\`\nStreak: \`${stats.winStreak || 0}\``,
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
    channel.name.startsWith('Lobby ARAM ') ||
    channel.name.startsWith('CLASSIC 1 ') ||
    channel.name.startsWith('CLASSIC 2 ') ||
    /^ARAM\s[1-5]x[1-5]\s[12]\s[A-Z]+$/i.test(channel.name)
  );
}

function getExpectedWaitingRoomName(mode, format, letter) {
  return mode === QUEUE_MODES.ARAM ? `Lobby ARAM ${format} ${letter}` : `Lobby CLASSIC ${letter}`;
}

function getExpectedTeamRoomNames(mode, format, letter) {
  return mode === QUEUE_MODES.ARAM
    ? [`ARAM ${format} 1 ${letter}`, `ARAM ${format} 2 ${letter}`]
    : [`CLASSIC 1 ${letter}`, `CLASSIC 2 ${letter}`];
}

async function deleteManagedChannelsForLobby(guild, mode, format, letter, extraChannelIds = []) {
  const expectedNames = [getExpectedWaitingRoomName(mode, format, letter), ...getExpectedTeamRoomNames(mode, format, letter)];
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
  const isWin = delta.result === 'vitória';
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
  syncMemberRankRole,
  syncMvpRole,
  clearMvpRoles,
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
  MVP_ROLE_NAME,
  THEME,
  FOOTER_PREFIX
};
