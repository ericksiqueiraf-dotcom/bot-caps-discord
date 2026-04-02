const { ChannelType, EmbedBuilder } = require('discord.js');
const db = require('../services/dataService');
const config = require('../config.json');
const { QUEUE_MODES } = require('../services/dataService');
const { calculateSeedRating, calculateHybridMmr, calculateEloDelta } = require('../services/balanceService');

const THEME = {
  SUCCESS: '#00ff88',
  ERROR: '#ff4d4d',
  INFO: '#00c3ff',
  WARNING: '#ffaa00',
  RANK: '#ffd700'
};

const FOOTER_PREFIX = 'Caps Bot';

function getRankName(mmr) {
  const val = Number(mmr || 0);
  if (val < 900) return 'Ferro';
  if (val < 1100) return 'Bronze';
  if (val < 1300) return 'Prata';
  if (val < 1500) return 'Ouro';
  if (val < 1700) return 'Platina';
  return 'Diamante';
}

function getSeasonDisplayLabel(seasonMeta) {
  if (seasonMeta.phase === 'official') {
    return `Temporada #${seasonMeta.currentSeason}`;
  }

  return `Fase de Testes #${seasonMeta.testingCycle || 1}`;
}

function formatDateTimeForHistory(dateInput) {
  const date = new Date(dateInput);

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

function getTeamChannels(guild) {
  return {
    classicTeamOneChannel: guild.channels.cache.get(config.voiceChannels.classicTeamOneChannelId),
    classicTeamTwoChannel: guild.channels.cache.get(config.voiceChannels.classicTeamTwoChannelId),
    aramTeamOneChannel: guild.channels.cache.get(config.voiceChannels.aramTeamOneChannelId),
    aramTeamTwoChannel: guild.channels.cache.get(config.voiceChannels.aramTeamTwoChannelId)
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

function getStatsBucketKey(mode, format = null) {
  if (mode === QUEUE_MODES.ARAM) {
    return format === '1x1' ? 'aram1x1' : 'aram';
  }

  return 'classic';
}

function getStatsBucketLabel(mode, format = null) {
  if (mode === QUEUE_MODES.ARAM) {
    return format === '1x1' ? 'ARAM 1x1' : 'ARAM';
  }

  return 'CLASSIC';
}

function getAramFormatLabel(teamSize) {
  return `${teamSize}x${teamSize}`;
}

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
    return 0;
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

  const maybeFormat = String(args[1] || '').toLowerCase();

  if (['1x1', '2x2', '3x3', '4x4', '5x5'].includes(maybeFormat)) {
    return maybeFormat;
  }

  return '5x5';
}

function getNicknameArgs(mode, args, format) {
  if (mode === QUEUE_MODES.ARAM) {
    const hasExplicitFormat = ['1x1', '2x2', '3x3', '4x4', '5x5'].includes(String(args[1] || '').toLowerCase());
    const startIndex = hasExplicitFormat ? 2 : 1;
    return args.slice(startIndex);
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

function getNextLobbyLetter(queueData, mode, format) {
  const letters = Object.values(queueData.lobbies || {})
    .filter((lobby) => lobby.mode === mode && lobby.format === format)
    .map((lobby) => lobby.letter);

  let index = 0;

  while (letters.includes(numberToLobbyLetter(index))) {
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

function createEmptyModeStats(baseMmr = 0) {
  const seedRating = calculateSeedRating(baseMmr);

  return {
    customWins: 0,
    customLosses: 0,
    baseMmr: Number(baseMmr || 0),
    internalRating: seedRating,
    winStreak: 0
  };
}

function normalizePlayerModes(player) {
  const legacyBaseMmr = Number(player.baseMmr || 0);
  const legacyWins = Number(player.customWins || 0);
  const legacyLosses = Number(player.customLosses || 0);
  const modes = player.modes || {};

  return {
    classic: {
      ...createEmptyModeStats(legacyBaseMmr),
      ...(modes.classic || {}),
      customWins: Number(modes.classic?.customWins ?? legacyWins),
      customLosses: Number(modes.classic?.customLosses ?? legacyLosses),
      baseMmr: Number(modes.classic?.baseMmr ?? legacyBaseMmr),
      internalRating: Number(modes.classic?.internalRating ?? calculateSeedRating(legacyBaseMmr)),
      winStreak: Number(modes.classic?.winStreak ?? 0)
    },
    aram: {
      ...createEmptyModeStats(legacyBaseMmr),
      ...(modes.aram || {}),
      customWins: Number(modes.aram?.customWins ?? 0),
      customLosses: Number(modes.aram?.customLosses ?? 0),
      baseMmr: Number(modes.aram?.baseMmr ?? legacyBaseMmr),
      internalRating: Number(modes.aram?.internalRating ?? calculateSeedRating(legacyBaseMmr)),
      winStreak: Number(modes.aram?.winStreak ?? 0)
    },
    aram1x1: {
      ...createEmptyModeStats(legacyBaseMmr),
      ...(modes.aram1x1 || {}),
      customWins: Number(modes.aram1x1?.customWins ?? 0),
      customLosses: Number(modes.aram1x1?.customLosses ?? 0),
      baseMmr: Number(modes.aram1x1?.baseMmr ?? legacyBaseMmr),
      internalRating: Number(modes.aram1x1?.internalRating ?? calculateSeedRating(legacyBaseMmr)),
      winStreak: Number(modes.aram1x1?.winStreak ?? 0)
    }
  };
}

function getModeStats(player, mode, format = null) {
  const modes = normalizePlayerModes(player);
  const bucketKey = getStatsBucketKey(mode, format);

  return modes[bucketKey] || createEmptyModeStats(player.baseMmr || 0);
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

  statsData.players[key] = {
    ...previous,
    discordId: player.discordId,
    nickname: player.nickname,
    puuid: player.puuid || previous.puuid || null,
    customWins: Number(previous.customWins || 0),
    customLosses: Number(previous.customLosses || 0),
    baseMmr: Number(previous.baseMmr || 0),
    internalRating: Number(previous.internalRating || calculateSeedRating(previous.baseMmr || 0)),
    modes: normalizePlayerModes(previous),
    ...updates
  };

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

  const leaderboardEntries = rankedPlayers
    .slice(0, 15)
    .map((player, index) => {
      const medal = medals[index] || `#${index + 1}`;
      const rankName = getRankName(player.adjustedMmr);
      const label = player.discordId ? `<@${player.discordId}>` : `\`${player.nickname}\``;

      return `${medal} ${label}\n**${rankName} (${player.adjustedMmr} pts)** • ${player.customWins}V / ${player.customLosses}D`;
    });

  splitEmbedFieldChunks(leaderboardEntries).forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? `Top jogadores - ${modeLabel}` : `Top jogadores - ${modeLabel} (${index + 1})`,
      value: chunk
    });
  });

  return embed;
}

function getRankedPlayersByMode(statsData, mode, format = null) {
  const players = Object.values(statsData.players || {});
  let minGames = 1;

  try {
    const seasonMeta = db.loadSeasonMeta();
    if (seasonMeta && seasonMeta.phase === 'official') {
      minGames = 3;
    }
  } catch (e) {}

  return players
    .map((player) => {
      const modeStats = getModeStats(player, mode, format);
      const baseMmr = Number(modeStats.baseMmr || 0);
      const customWins = Number(modeStats.customWins || 0);
      const customLosses = Number(modeStats.customLosses || 0);
      const totalGames = customWins + customLosses;
      const adjustedMmr = calculateHybridMmr(baseMmr, customWins, customLosses, modeStats.internalRating);
      const winRate = totalGames > 0 ? ((customWins / totalGames) * 100).toFixed(0) : '0';

      return {
        ...player,
        baseMmr,
        customWins,
        customLosses,
        totalGames,
        adjustedMmr,
        winRate,
        internalRating: Number(modeStats.internalRating || calculateSeedRating(baseMmr)),
        winStreak: Number(modeStats.winStreak || 0)
      };
    })
    .filter((player) => player.totalGames >= minGames)
    .sort((a, b) => {
      if (b.adjustedMmr !== a.adjustedMmr) {
        return b.adjustedMmr - a.adjustedMmr;
      }

      return b.customWins - a.customWins;
    });
}

function buildTopTenEmbed(statsData, seasonMeta, mode, format = null) {
  const rankedPlayers = getRankedPlayersByMode(statsData, mode, format).slice(0, 10);
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

  const entries = rankedPlayers
    .map(
      (player, index) => {
        const medal = medals[index] || `#${index + 1}`;
        const rankName = getRankName(player.adjustedMmr);
        return `${medal} <@${player.discordId}>\n**${rankName} (${player.adjustedMmr} pts)** • ${player.customWins}V / ${player.customLosses}D`;
      }
    );

  splitEmbedFieldChunks(entries).forEach((chunk, index) => {
    embed.addFields({
      name: index === 0 ? `Top 10 ${modeLabel}` : `Top 10 ${modeLabel} (${index + 1})`,
      value: chunk
    });
  });

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
    const classicSeed = calculateSeedRating(modes.classic.baseMmr);
    const aramSeed = calculateSeedRating(modes.aram.baseMmr);
    const aram1x1Seed = calculateSeedRating(modes.aram1x1.baseMmr);

    nextPlayers[key] = {
      ...player,
      customWins: 0,
      customLosses: 0,
      internalRating: classicSeed,
      modes: {
        classic: {
          customWins: 0,
          customLosses: 0,
          baseMmr: modes.classic.baseMmr,
          internalRating: classicSeed
        },
        aram: {
          customWins: 0,
          customLosses: 0,
          baseMmr: modes.aram.baseMmr,
          internalRating: aramSeed
        },
        aram1x1: {
          customWins: 0,
          customLosses: 0,
          baseMmr: modes.aram1x1.baseMmr,
          internalRating: aram1x1Seed
        }
      }
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
  const history = loadSeasonHistory();
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
    topClassic: getRankedPlayersByMode(statsData, QUEUE_MODES.CLASSIC).slice(0, 10),
    topAram: getRankedPlayersByMode(statsData, QUEUE_MODES.ARAM).slice(0, 10),
    topAram1x1: getRankedPlayersByMode(statsData, QUEUE_MODES.ARAM, '1x1').slice(0, 10),
    playersSnapshot: deepClone(statsData),
    seasonMetaSnapshot: deepClone(seasonMeta)
  };

  history.seasons.push(archivedSeason);
  saveSeasonHistory(history);
}

function buildPlayerCardEmbed(playerStats, targetUser) {
  const classicStats = getModeStats(playerStats, QUEUE_MODES.CLASSIC);
  const aramStats = getModeStats(playerStats, QUEUE_MODES.ARAM);
  const aram1x1Stats = getModeStats(playerStats, QUEUE_MODES.ARAM, '1x1');
  const classicGames = Number(classicStats.customWins || 0) + Number(classicStats.customLosses || 0);
  const aramGames = Number(aramStats.customWins || 0) + Number(aramStats.customLosses || 0);
  const aram1x1Games = Number(aram1x1Stats.customWins || 0) + Number(aram1x1Stats.customLosses || 0);
  const classicWinRate = classicGames > 0 ? ((Number(classicStats.customWins || 0) / classicGames) * 100).toFixed(1) : '0.0';
  const aramWinRate = aramGames > 0 ? ((Number(aramStats.customWins || 0) / aramGames) * 100).toFixed(1) : '0.0';
  const aram1x1WinRate = aram1x1Games > 0 ? ((Number(aram1x1Stats.customWins || 0) / aram1x1Games) * 100).toFixed(1) : '0.0';
  const classicMmr = calculateHybridMmr(
    classicStats.baseMmr,
    classicStats.customWins,
    classicStats.customLosses,
    classicStats.internalRating
  );
  const aramMmr = calculateHybridMmr(aramStats.baseMmr, aramStats.customWins, aramStats.customLosses, aramStats.internalRating);
  const aram1x1Mmr = calculateHybridMmr(
    aram1x1Stats.baseMmr,
    aram1x1Stats.customWins,
    aram1x1Stats.customLosses,
    aram1x1Stats.internalRating
  );

  return new EmbedBuilder()
    .setColor(THEME.INFO)
    .setTitle('👤 Ficha do Jogador')
    .setDescription(targetUser ? `${targetUser}` : `\`${playerStats.nickname}\``)
    .addFields(
      { name: 'Nick', value: `\`${playerStats.nickname || 'Nao identificado'}\``, inline: true },
      { name: 'Rank Principal', value: `**${getRankName(classicMmr)}** (${classicMmr} pts)`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '📊 CLASSIC', value: `\`${classicStats.customWins}V / ${classicStats.customLosses}D\`\nWR: \`${classicWinRate}%\`\nStreak: \`${classicStats.winStreak || 0}\``, inline: true },
      { name: '📊 ARAM', value: `\`${aramStats.customWins}V / ${aramStats.customLosses}D\`\nWR: \`${aramWinRate}%\`\nStreak: \`${aramStats.winStreak || 0}\``, inline: true },
      { name: '📊 ARAM 1x1', value: `\`${aram1x1Stats.customWins}V / ${aram1x1Stats.customLosses}D\`\nWR: \`${aram1x1WinRate}%\`\nStreak: \`${aram1x1Stats.winStreak || 0}\``, inline: true }
    )
    .setFooter({ text: `${FOOTER_PREFIX} • Perfil` })
    .setTimestamp();
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

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return;
  }

  const statsData = loadPlayerStats();
  const seasonMeta = loadSeasonMeta();

  await channel.send({
    content: `Atualizacao diaria de rankings | ${getSeasonDisplayLabel(seasonMeta)}`,
    embeds: [
      buildTopTenEmbed(statsData, seasonMeta, QUEUE_MODES.CLASSIC),
      buildTopTenEmbed(statsData, seasonMeta, QUEUE_MODES.ARAM),
      buildTopTenEmbed(statsData, seasonMeta, QUEUE_MODES.ARAM, '1x1')
    ]
  });
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
  const teamOneChannel = await guild.channels.fetch(teamChannelIds.teamOneChannelId);
  const teamTwoChannel = await guild.channels.fetch(teamChannelIds.teamTwoChannelId);

  if (
    !teamOneChannel ||
    !teamTwoChannel ||
    teamOneChannel.type !== ChannelType.GuildVoice ||
    teamTwoChannel.type !== ChannelType.GuildVoice
  ) {
    throw new Error('Os canais de voz das equipes nao foram encontrados no config.json.');
  }

  const allPlayers = [
    ...teams.teamOne.map((player) => ({ ...player, channel: teamOneChannel })),
    ...teams.teamTwo.map((player) => ({ ...player, channel: teamTwoChannel }))
  ];

  for (const player of allPlayers) {
    const member = await guild.members.fetch(player.discordId);

    if (member.voice?.channel) {
      await member.voice.setChannel(player.channel);
    }
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
    channel.name.startsWith('Sala de espera CLASSIC ') ||
    channel.name.startsWith('Sala de espera ARAM ') ||
    channel.name.startsWith('CLASSIC 1 ') ||
    channel.name.startsWith('CLASSIC 2 ') ||
    /^ARAM\s[1-5]x[1-5]\s[12]\s[A-Z]+$/i.test(channel.name)
  );
}

function getExpectedWaitingRoomName(mode, format, letter) {
  return mode === QUEUE_MODES.ARAM ? `Sala de espera ARAM ${format} ${letter}` : `Sala de espera CLASSIC ${letter}`;
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

function findReusableWaitingLobby(guild, queueData, mode, format) {
  const waitingLobbies = Object.values(queueData.lobbies || {}).filter(
    (lobby) => lobby.mode === mode && lobby.format === format && lobby.status === 'waiting'
  );
  const knownLetters = new Set(waitingLobbies.map((lobby) => lobby.letter));

  for (const channel of guild.channels.cache.values()) {
    if (!isManagedDynamicChannel(channel) || channel.type !== ChannelType.GuildVoice) {
      continue;
    }

    for (const letter of Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))) {
      if (knownLetters.has(letter)) {
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

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      if (interaction.deferred && !interaction.replied) {
        return interaction.editReply(normalizedPayload).catch(() => null);
      }

      return interaction.followUp(normalizedPayload).catch(() => null);
    },
    async send(payload) {
      const normalizedPayload = normalizeDiscordPayload(payload);

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      if (interaction.deferred && !interaction.replied) {
        return interaction.editReply(normalizedPayload).catch(() => null);
      }

      return interaction.followUp(normalizedPayload).catch(() => null);
    }
  };
}

module.exports = {
  getSeasonDisplayLabel,
  formatDateTimeForHistory,
  getArchivedSeasonLabel,
  getQueueChannel,
  getTeamChannels,
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
  buildQueueEmbed,
  splitEmbedFieldChunks,
  buildTeamsEmbed,
  buildLeaderboardEmbed,
  getRankedPlayersByMode,
  buildTopTenEmbed,
  buildSeasonHistoryEmbed,
  resetStatsForNewSeason,
  deepClone,
  hasArchivedSeasonData,
  buildRestoredStatsFromArchive,
  inferSeasonMetaFromArchive,
  archiveCurrentSeason,
  buildPlayerCardEmbed,
  getSaoPauloDateParts,
  postDailyRankUpdates,
  postMatchHistoryLog,
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
  createInteractionContext
};
