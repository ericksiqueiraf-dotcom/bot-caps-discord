const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const fs = require('fs');
const path = require('path');

const HUB_CHANNEL_NAME = '➕・criar-sala';
const TEMP_CHANNEL_PREFIX = '➕・';
const deleteTimers = new Map();

// Persistence file for temp voice rooms
const TEMP_VOICE_REGISTRY_PATH = process.env.TEMPVOICE_REGISTRY_PATH || path.join(__dirname, '..', 'database', 'tempVoiceRooms.json');

function loadTempVoiceRegistry() {
  try {
    if (fs.existsSync(TEMP_VOICE_REGISTRY_PATH)) {
      const data = fs.readFileSync(TEMP_VOICE_REGISTRY_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[TEMP VOICE] Erro ao carregar registro:', error.message);
  }
  return {};
}

function saveTempVoiceRegistry(registry) {
  try {
    fs.writeFileSync(TEMP_VOICE_REGISTRY_PATH, JSON.stringify(registry, null, 2));
  } catch (error) {
    console.error('[TEMP VOICE] Erro ao salvar registro:', error.message);
  }
}

function registerTempRoom(channelId, ownerId, guildId) {
  const registry = loadTempVoiceRegistry();
  if (!registry[guildId]) registry[guildId] = {};
  registry[guildId][channelId] = { ownerId, createdAt: Date.now() };
  saveTempVoiceRegistry(registry);
}

function unregisterTempRoom(channelId, guildId) {
  const registry = loadTempVoiceRegistry();
  if (registry[guildId] && registry[guildId][channelId]) {
    delete registry[guildId][channelId];
    saveTempVoiceRegistry(registry);
  }
}

function getTempRoomOwner(channelId, guildId) {
  const registry = loadTempVoiceRegistry();
  return registry[guildId]?.[channelId]?.ownerId || null;
}

function getUserTempRoom(userId, guildId) {
  const registry = loadTempVoiceRegistry();
  const guildRooms = registry[guildId] || {};
  for (const [channelId, data] of Object.entries(guildRooms)) {
    if (data.ownerId === userId) return channelId;
  }
  return null;
}

function getAllTempRooms(guildId) {
  const registry = loadTempVoiceRegistry();
  return registry[guildId] || {};
}

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
    if (!freshChannel) {
      unregisterTempRoom(channel.id, channel.guild.id);
      return;
    }
    if (isManagedTempVoiceChannel(freshChannel) && freshChannel.members.size === 0) {
      await freshChannel.delete('Sala temporaria vazia').catch((error) => {
        console.error('[TEMP VOICE] Erro ao apagar sala temporaria:', error.message);
      });
      unregisterTempRoom(channel.id, channel.guild.id);
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

    const newChannel = await createTempVoiceForMember(member, joinedChannel).catch((error) => {
      console.error('[TEMP VOICE] Erro ao criar sala temporaria:', error.message);
      return null;
    });
    
    if (newChannel) {
      registerTempRoom(newChannel.id, member.id, member.guild.id);
    }
  }

  if (leftChannel && isManagedTempVoiceChannel(leftChannel) && leftChannel.members.size === 0) {
    await scheduleTempVoiceDeletion(leftChannel);
  }
}

// --- Management commands ---

async function inviteToTempRoom(ownerMember, targetUser) {
  const guild = ownerMember.guild;
  const ownerTempRoomId = getUserTempRoom(ownerMember.id, guild.id);
  
  if (!ownerTempRoomId) {
    return { success: false, message: 'Você não possui uma sala temporária ativa.' };
  }
  
  const tempChannel = await guild.channels.fetch(ownerTempRoomId).catch(() => null);
  if (!tempChannel || !isManagedTempVoiceChannel(tempChannel)) {
    unregisterTempRoom(ownerTempRoomId, guild.id);
    return { success: false, message: 'Sua sala temporária não existe mais.' };
  }
  
  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return { success: false, message: 'Usuário não encontrado no servidor.' };
  }
  
  // Check if target is already in a voice channel
  if (targetMember.voice.channel) {
    if (targetMember.voice.channel.id === tempChannel.id) {
      return { success: false, message: 'Este usuário já está na sua sala.' };
    }
    // Move them
    try {
      await targetMember.voice.setChannel(tempChannel, `Convidado por ${ownerMember.user.tag}`);
      return { success: true, message: `${targetMember} foi movido para sua sala.` };
    } catch (error) {
      return { success: false, message: `Falha ao mover usuário: ${error.message}` };
    }
  }
  
  // Send invite via DM or mention
  try {
    await targetMember.send(`🎮 **${ownerMember.user.tag}** te convidou para a sala temporária **${tempChannel.name}**!\nClique para entrar: <#${tempChannel.id}>`).catch(() => null);
    return { success: true, message: `Convite enviado para ${targetMember} (via DM).` };
  } catch (error) {
    return { success: false, message: `Falha ao enviar convite: ${error.message}` };
  }
}

async function renameTempRoom(ownerMember, newName) {
  const guild = ownerMember.guild;
  const ownerTempRoomId = getUserTempRoom(ownerMember.id, guild.id);
  
  if (!ownerTempRoomId) {
    return { success: false, message: 'Você não possui uma sala temporária ativa.' };
  }
  
  const tempChannel = await guild.channels.fetch(ownerTempRoomId).catch(() => null);
  if (!tempChannel || !isManagedTempVoiceChannel(tempChannel)) {
    unregisterTempRoom(ownerTempRoomId, guild.id);
    return { success: false, message: 'Sua sala temporária não existe mais.' };
  }
  
  const cleanName = String(newName).replace(/[\r\n]/g, ' ').trim().slice(0, 80);
  if (!cleanName) {
    return { success: false, message: 'Nome inválido.' };
  }
  
  const newChannelName = `${TEMP_CHANNEL_PREFIX}${cleanName}`;
  try {
    await tempChannel.setName(newChannelName, `Renomeado por ${ownerMember.user.tag}`);
    return { success: true, message: `Sala renomeada para **${newChannelName}**.` };
  } catch (error) {
    return { success: false, message: `Falha ao renomear: ${error.message}` };
  }
}

async function deleteTempRoom(ownerMember) {
  const guild = ownerMember.guild;
  const ownerTempRoomId = getUserTempRoom(ownerMember.id, guild.id);
  
  if (!ownerTempRoomId) {
    return { success: false, message: 'Você não possui uma sala temporária ativa.' };
  }
  
  const tempChannel = await guild.channels.fetch(ownerTempRoomId).catch(() => null);
  if (!tempChannel || !isManagedTempVoiceChannel(tempChannel)) {
    unregisterTempRoom(ownerTempRoomId, guild.id);
    return { success: false, message: 'Sala não encontrada.' };
  }
  
  try {
    await tempChannel.delete('Deletada pelo dono via comando');
    unregisterTempRoom(ownerTempRoomId, guild.id);
    return { success: true, message: 'Sala temporária deletada.' };
  } catch (error) {
    return { success: false, message: `Falha ao deletar: ${error.message}` };
  }
}

function listTempRooms(guild) {
  const rooms = getAllTempRooms(guild.id);
  const result = [];
  
  for (const [channelId, data] of Object.entries(rooms)) {
    const channel = guild.channels.cache.get(channelId);
    if (channel && isManagedTempVoiceChannel(channel)) {
      const owner = guild.members.cache.get(data.ownerId);
      result.push({
        channel,
        owner: owner?.user?.tag || data.ownerId,
        memberCount: channel.members.size,
        locked: Boolean(data.locked)
      });
    }
  }
  
  return result;
}

function isTempRoomOwner(member, channelId) {
  const guild = member.guild;
  const ownerId = getTempRoomOwner(channelId, guild.id);
  return ownerId === member.id || member.permissions?.has(PermissionFlagsBits.Administrator);
}

function getUserTempRoomChannel(guild, userId) {
  const roomId = getUserTempRoom(userId, guild.id);
  if (!roomId) return null;
  return guild.channels.cache.get(roomId) || null;
}

async function setTempRoomLock(ownerMember, locked) {
  const guild = ownerMember.guild;
  const roomId = getUserTempRoom(ownerMember.id, guild.id);
  if (!roomId) {
    return { success: false, message: 'Você não possui uma sala temporária ativa.' };
  }

  const channel = await guild.channels.fetch(roomId).catch(() => null);
  if (!channel || !isManagedTempVoiceChannel(channel)) {
    unregisterTempRoom(roomId, guild.id);
    return { success: false, message: 'Sua sala temporária não existe mais.' };
  }

  try {
    const creatorRoleIds = getConfiguredCreatorRoles(guild);
    for (const roleId of creatorRoleIds) {
      await channel.permissionOverwrites.edit(roleId, { Connect: !locked }).catch(() => null);
    }
    const registry = loadTempVoiceRegistry();
    if (registry[guild.id]?.[roomId]) {
      registry[guild.id][roomId].locked = locked;
      saveTempVoiceRegistry(registry);
    }
    return {
      success: true,
      locked,
      message: locked
        ? '🔒 Sala trancada: ninguém novo entra (só você, dono).'
        : '🔓 Sala destrancada: cargos permitidos podem entrar de novo.'
    };
  } catch (error) {
    return { success: false, message: `Falha ao ${locked ? 'trancar' : 'destrancar'}: ${error.message}` };
  }
}

async function setTempRoomLimit(ownerMember, limit) {
  const guild = ownerMember.guild;
  const roomId = getUserTempRoom(ownerMember.id, guild.id);
  if (!roomId) {
    return { success: false, message: 'Você não possui uma sala temporária ativa.' };
  }

  const channel = await guild.channels.fetch(roomId).catch(() => null);
  if (!channel || !isManagedTempVoiceChannel(channel)) {
    unregisterTempRoom(roomId, guild.id);
    return { success: false, message: 'Sua sala temporária não existe mais.' };
  }

  const value = Number(limit);
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    return { success: false, message: 'Use `!salalimit <0-99>` (0 = sem limite).' };
  }

  try {
    await channel.setUserLimit(value, `Limite alterado por ${ownerMember.user?.tag || ownerMember.id}`);
    return { success: true, message: value === 0 ? 'Limite de usuários removido (sem limite).' : `Limite da sala: **${value}** usuário(s).` };
  } catch (error) {
    return { success: false, message: `Falha ao mudar o limite: ${error.message}` };
  }
}

async function kickFromTempRoom(ownerMember, targetUser) {
  const guild = ownerMember.guild;
  const roomId = getUserTempRoom(ownerMember.id, guild.id);
  if (!roomId) {
    return { success: false, message: 'Você não possui uma sala temporária ativa.' };
  }

  const channel = await guild.channels.fetch(roomId).catch(() => null);
  if (!channel || !isManagedTempVoiceChannel(channel)) {
    unregisterTempRoom(roomId, guild.id);
    return { success: false, message: 'Sua sala temporária não existe mais.' };
  }

  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return { success: false, message: 'Usuário não encontrado no servidor.' };
  }
  if (targetMember.id === ownerMember.id) {
    return { success: false, message: 'Você não pode se expulsar da própria sala.' };
  }
  if (targetMember.user?.bot) {
    return { success: false, message: 'Não é possível expulsar bots.' };
  }
  if (!targetMember.voice?.channel || targetMember.voice.channel.id !== channel.id) {
    return { success: false, message: 'Este usuário não está na sua sala.' };
  }

  try {
    await targetMember.voice.disconnect(`Removido da sala por ${ownerMember.user?.tag || ownerMember.id}`);
    return { success: true, message: `${targetMember} foi removido da sua sala.` };
  } catch (error) {
    return { success: false, message: `Falha ao remover: ${error.message}` };
  }
}

module.exports = {
  HUB_CHANNEL_NAME,
  buildHubOverwrites,
  handleTempVoiceStateUpdate,
  isHubChannel,
  isManagedTempVoiceChannel,
  canCreateTempVoice,
  registerTempRoom,
  unregisterTempRoom,
  getTempRoomOwner,
  getUserTempRoom,
  getAllTempRooms,
  inviteToTempRoom,
  renameTempRoom,
  deleteTempRoom,
  listTempRooms,
  isTempRoomOwner,
  setTempRoomLock,
  setTempRoomLimit,
  kickFromTempRoom
};
