const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

const HUB_CHANNEL_NAME = '➕・criar-sala';
const TEMP_CHANNEL_PREFIX = '➕・';
const deleteTimers = new Map();

function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function getOptionalPermission(name) {
  return PermissionFlagsBits[name] || null;
}

function compactPermissions(values) {
  return values.filter(Boolean);
}

function getConfiguredCreatorRoles(guild) {
  const configuredIds = Array.isArray(config.tempVoice?.allowedRoleIds)
    ? config.tempVoice.allowedRoleIds.filter(Boolean)
    : [];
  const configuredNames = Array.isArray(config.tempVoice?.allowedRoleNames)
    ? config.tempVoice.allowedRoleNames
    : [];

  const rolesByName = configuredNames
    .map((name) => guild.roles.cache.find((role) => normalizeName(role.name) === normalizeName(name)))
    .filter(Boolean)
    .map((role) => role.id);

  return [...new Set([...configuredIds, ...rolesByName])];
}

function canCreateTempVoice(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

  const creatorRoleIds = getConfiguredCreatorRoles(member.guild);
  if (creatorRoleIds.length === 0) return true;

  return creatorRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function buildHubOverwrites(guild) {
  const creatorRoleIds = getConfiguredCreatorRoles(guild);
  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.Connect]
    }
  ];

  for (const roleId of creatorRoleIds) {
    overwrites.push({
      id: roleId,
      allow: compactPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak
      ])
    });
  }

  if (guild.members.me) {
    overwrites.push({
      id: guild.members.me.id,
      allow: compactPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers
      ])
    });
  }

  return overwrites;
}

function buildTempChannelOverwrites(member) {
  const guild = member.guild;
  const creatorRoleIds = getConfiguredCreatorRoles(guild);
  const voiceStatusPermission = getOptionalPermission('SetVoiceChannelStatus');
  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.Connect]
    }
  ];

  for (const roleId of creatorRoleIds) {
    overwrites.push({
      id: roleId,
      allow: compactPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak
      ])
    });
  }

  overwrites.push({
    id: member.id,
    allow: compactPermissions([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.ManageChannels,
      voiceStatusPermission
    ])
  });

  if (guild.members.me) {
    overwrites.push({
      id: guild.members.me.id,
      allow: compactPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers
      ])
    });
  }

  return overwrites;
}

function isHubChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (config.tempVoice?.hubChannelId && channel.id === config.tempVoice.hubChannelId) return true;

  const normalized = normalizeName(channel.name);
  return normalized === normalizeName(HUB_CHANNEL_NAME) || normalized.includes('criar sala');
}

function isManagedTempVoiceChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (isHubChannel(channel)) return false;
  return String(channel.name || '').startsWith(TEMP_CHANNEL_PREFIX);
}

function buildTempVoiceName(member) {
  const displayName = String(member.displayName || member.user?.username || 'sala')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 80);
  return `${TEMP_CHANNEL_PREFIX}${displayName || 'sala'}`;
}

async function scheduleTempVoiceDeletion(channel) {
  if (!isManagedTempVoiceChannel(channel) || channel.members.size > 0) return;

  if (deleteTimers.has(channel.id)) {
    clearTimeout(deleteTimers.get(channel.id));
  }

  const delayMs = Math.max(1, Number(config.tempVoice?.deleteDelaySeconds || 60)) * 1000;
  const timeout = setTimeout(async () => {
    deleteTimers.delete(channel.id);
    const freshChannel = await channel.guild.channels.fetch(channel.id).catch(() => null);
    if (isManagedTempVoiceChannel(freshChannel) && freshChannel.members.size === 0) {
      await freshChannel.delete('Sala temporaria vazia').catch((error) => {
        console.error('[TEMP VOICE] Erro ao apagar sala temporaria:', error.message);
      });
    }
  }, delayMs);

  deleteTimers.set(channel.id, timeout);
}

async function createTempVoiceForMember(member, hubChannel) {
  const channel = await member.guild.channels.create({
    name: buildTempVoiceName(member),
    type: ChannelType.GuildVoice,
    parent: hubChannel.parentId || null,
    userLimit: Number(config.tempVoice?.userLimit || 10),
    permissionOverwrites: buildTempChannelOverwrites(member),
    reason: `Sala temporaria criada por ${member.user?.tag || member.id}`
  });

  await channel.setPosition((hubChannel.position || 0) + 1).catch(() => null);

  try {
    await member.voice.setChannel(channel, 'Mover para sala temporaria criada');
  } catch (error) {
    await channel.delete('Falha ao mover criador da sala temporaria').catch(() => null);
    throw error;
  }

  return channel;
}

async function handleTempVoiceStateUpdate(oldState, newState) {
  const joinedChannel = newState.channel || null;
  const leftChannel = oldState.channel || null;

  if (joinedChannel && isManagedTempVoiceChannel(joinedChannel) && deleteTimers.has(joinedChannel.id)) {
    clearTimeout(deleteTimers.get(joinedChannel.id));
    deleteTimers.delete(joinedChannel.id);
  }

  if (joinedChannel && isHubChannel(joinedChannel)) {
    const member = newState.member;

    if (!canCreateTempVoice(member)) {
      await member.voice.disconnect('Sem permissao para criar sala temporaria').catch(() => null);
      return;
    }

    await createTempVoiceForMember(member, joinedChannel).catch((error) => {
      console.error('[TEMP VOICE] Erro ao criar sala temporaria:', error.message);
    });
  }

  if (leftChannel && isManagedTempVoiceChannel(leftChannel) && leftChannel.members.size === 0) {
    await scheduleTempVoiceDeletion(leftChannel);
  }
}

module.exports = {
  HUB_CHANNEL_NAME,
  buildHubOverwrites,
  handleTempVoiceStateUpdate,
  isHubChannel,
  isManagedTempVoiceChannel,
  canCreateTempVoice
};
