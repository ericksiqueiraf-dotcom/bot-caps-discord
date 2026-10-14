// Salas de voz temporárias ("entre-para-criar") para partidas personalizadas.
//
// FLUXO (opção B):
//   1. Staff roda `!salahub` (ou o setup-servidor) e cria o canal-hub "➕ Criar sala".
//   2. Quem tem o cargo permitido entra no hub -> o bot cria "🎧 Sala de <nome>"
//      (privada: só o dono + staff enxergam) e move a pessoa para lá.
//   3. O dono convida o time com `!convidar @...`, ajusta com `!limite N`,
//      abre/fecha com `!unlock` / `!lock` e renomeia com `!sala <nome>`.
//   4. Sala vazia é apagada sozinha após `deleteDelaySeconds`.
//
// Somente guilds em `allowedGuildIds` são atendidas (mesma trava do resto do bot).
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const { isGuildAllowed, replyToMessage } = require('../utils/lobbyUtils');

const TEMP_TOPIC_PREFIX = 'caps-temp:';
const HUB_CHANNEL_NAME = '➕ Criar sala';
const TEMP_ROOM_PREFIX = '🎧 Sala de ';
const TEMP_ROOM_CATEGORY_NAME = '⚔️・PARTIDAS';
const HUB_CATEGORY_NAME = '🎙️・FILAS';
const TEMP_ROOM_REGISTRY_DEFAULT = path.join(__dirname, '..', 'database', 'tempVoiceRooms.json');

function registryPath() {
  return process.env.TEMPVOICE_REGISTRY_PATH || TEMP_ROOM_REGISTRY_DEFAULT;
}

// channelId -> timeout de exclusão agendada
const pendingDeletions = new Map();

// Registro persistente das salas criadas (channelId -> { ownerId, guildId, createdAt }).
// Evita depender do topic do canal (o Discord rejeita alguns formatos).
let roomRegistry = null;

function loadRoomRegistry() {
  if (roomRegistry) return roomRegistry;
  try {
    roomRegistry = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
    if (!roomRegistry || typeof roomRegistry !== 'object') roomRegistry = {};
  } catch {
    roomRegistry = {};
  }
  return roomRegistry;
}

function saveRoomRegistry() {
  try {
    fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
    fs.writeFileSync(registryPath(), JSON.stringify(loadRoomRegistry(), null, 2));
  } catch (err) {
    console.warn('[TEMPVOZ] Nao salvei o registro de salas:', err.message);
  }
}

function registerTempRoom(channelId, ownerId, guildId) {
  loadRoomRegistry()[String(channelId)] = { ownerId: String(ownerId), guildId: String(guildId || ''), createdAt: new Date().toISOString() };
  saveRoomRegistry();
}

function unregisterTempRoom(channelId) {
  if (loadRoomRegistry()[String(channelId)]) {
    delete loadRoomRegistry()[String(channelId)];
    saveRoomRegistry();
  }
}

function getTempVoiceConfig() {
  return config.tempVoice || {};
}

function getHubChannelId() {
  return String(getTempVoiceConfig().hubChannelId || '');
}

function isTempVoiceEnabled() {
  return getHubChannelId().length > 0;
}

function getUserLimit() {
  const value = Number(getTempVoiceConfig().userLimit || 10);
  if (!Number.isFinite(value) || value < 0) return 10;
  return Math.min(99, Math.floor(value));
}

function getDeleteDelayMs() {
  const value = Number(getTempVoiceConfig().deleteDelaySeconds ?? 60);
  if (!Number.isFinite(value) || value < 5) return 60 * 1000;
  return Math.min(15 * 60, Math.floor(value)) * 1000;
}

function getAllowedRoleIds() {
  const ids = getTempVoiceConfig().allowedRoleIds;
  return Array.isArray(ids) ? ids.map(String) : [];
}

function getAllowedRoleNames() {
  const names = getTempVoiceConfig().allowedRoleNames;
  if (Array.isArray(names) && names.length > 0) return names.map(String);
  return ['👑 Capitão de Customs', 'Staff', '⭐ VIP', '👑 Lendário'];
}

// Quem pode fazer a limpeza geral (!limparvoz): staff + Moderadores/VIP/Lendário.
function getManagerRoleNames() {
  const names = getTempVoiceConfig().managerRoleNames;
  if (Array.isArray(names) && names.length > 0) return names.map(String);
  return ['Moderador', 'Moderadores', '⭐ VIP', '👑 Lendário'];
}

function memberCanManageTempVoice(member) {
  if (memberIsStaff(member)) return true;
  if (!member?.roles?.cache) return false;
  const cfg = getTempVoiceConfig();
  const ids = new Set(Array.isArray(cfg.managerRoleIds) ? cfg.managerRoleIds.map(String) : []);
  const wanted = new Set(getManagerRoleNames().map((name) => String(name).toLowerCase()));
  try {
    for (const role of member.roles.cache.values()) {
      if (!role) continue;
      if (ids.has(String(role.id))) return true;
      if (wanted.has(String(role.name || '').toLowerCase())) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isHubChannel(channelId) {
  const hubId = getHubChannelId();
  return Boolean(hubId && channelId && String(channelId) === String(hubId));
}

function isTempRoom(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (isHubChannel(channel.id)) return false;
  if (loadRoomRegistry()[String(channel.id)]) return true;
  return typeof channel.topic === 'string' && channel.topic.startsWith(TEMP_TOPIC_PREFIX);
}

function getTempRoomOwnerId(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice || isHubChannel(channel.id)) return null;
  const registered = loadRoomRegistry()[String(channel.id)];
  if (registered?.ownerId) return String(registered.ownerId);
  if (!isTempRoom(channel)) return null;
  return channel.topic.slice(TEMP_TOPIC_PREFIX.length) || null;
}

function sanitizeChannelName(value) {
  return String(value || 'Jogador').replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || 'Jogador';
}

function buildTempRoomName(displayName) {
  return `${TEMP_ROOM_PREFIX}${sanitizeChannelName(displayName)}`.slice(0, 100);
}

function memberIsStaff(member) {
  if (!member) return false;
  try {
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  } catch { /* sem permissoes resolvidas */ }
  try {
    const captainRoleId = config.roles?.captainRoleId;
    if (captainRoleId && member.roles?.cache?.has(String(captainRoleId))) return true;
  } catch { /* sem cargos */ }
  return false;
}

function memberHasAllowedRole(member) {
  if (!member?.roles?.cache) return false;
  const ids = new Set(getAllowedRoleIds());
  const names = new Set(getAllowedRoleNames().map((name) => name.toLowerCase()));
  try {
    for (const role of member.roles.cache.values()) {
      if (!role) continue;
      if (ids.has(String(role.id))) return true;
      if (names.has(String(role.name || '').toLowerCase())) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function memberCanCreateTempRoom(member) {
  if (!member) return false;
  if (memberIsStaff(member)) return true;
  return memberHasAllowedRole(member);
}

function resolveCreatorRoleIds(guild) {
  const ids = new Set(getAllowedRoleIds().filter(Boolean));
  const wantedNames = new Set(getAllowedRoleNames().map((name) => String(name).toLowerCase()));
  try {
    for (const role of guild.roles.cache.values()) {
      if (role && wantedNames.has(String(role.name || '').toLowerCase())) ids.add(String(role.id));
    }
  } catch { /* cache indisponivel */ }
  if (config.roles?.captainRoleId) ids.add(String(config.roles.captainRoleId));
  return [...ids];
}

function buildHubOverwrites(guild) {
  const everyoneId = guild.roles.everyone.id;
  const overwrites = [{ id: everyoneId, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] }];
  for (const roleId of resolveCreatorRoleIds(guild)) {
    if (String(roleId) === String(everyoneId)) continue;
    overwrites.push({
      id: String(roleId),
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
    });
  }
  return overwrites;
}

function findCategoryByName(guild, name) {
  try {
    return guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name) || null;
  } catch {
    return null;
  }
}

function findOwnedTempRoom(guild, userId) {
  try {
    for (const channel of guild.channels.cache.values()) {
      if (isTempRoom(channel) && getTempRoomOwnerId(channel) === String(userId)) return channel;
    }
  } catch { /* cache indisponivel */ }
  return null;
}

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(String(channelId))
    || await guild.channels.fetch(String(channelId)).catch(() => null);
}

// Mantem so overwrites com ID resolvivel no cache (cargo/membro).
// IDs inexistentes na guild (ex. cargo de outro servidor) estouram
// TypeError SINCRONO no create/set — aqui eles sao descartados com aviso.
function filterResolvableOverwrites(guild, overwrites) {
  const ok = [];
  for (const ow of overwrites || []) {
    const id = String(ow?.id || '');
    let valid = false;
    try {
      if (id && guild.roles?.cache?.has(id)) valid = true;
      else if (id && guild.client?.users?.cache?.has(id)) valid = true;
    } catch { valid = false; }
    if (valid) ok.push(ow);
    else console.warn(`[TEMPVOZ] Overwrite ignorado (id sem cache/inexistente): ${id}`);
  }
  return ok;
}

async function createTempRoom(guild, member, hubChannel) {
  // Aquece o cache de cargos: sem isso o Discord rejeita overwrites com
  // "Supplied parameter is not a cached User or Role" no channels.create.
  await guild.roles?.fetch?.().catch(() => null);
  const configuredCategory = getTempVoiceConfig().categoryId
    ? await resolveChannel(guild, getTempVoiceConfig().categoryId).catch(() => null)
    : null;
  const parentId = configuredCategory?.id || hubChannel?.parentId || findCategoryByName(guild, TEMP_ROOM_CATEGORY_NAME)?.id || null;
  const staffAllow = resolveCreatorRoleIds(guild)
    .filter((id) => String(id) !== String(member.id))
    .map((id) => ({
      id: String(id),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.MoveMembers
      ]
    }));

  const roomOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles
      ]
    },
    ...staffAllow
  ];

  try {
    return await guild.channels.create({
      name: buildTempRoomName(member.displayName),
      type: ChannelType.GuildVoice,
      parent: parentId,
      userLimit: getUserLimit(),
      reason: `Sala temporaria CAPS de ${member.user?.tag || member.id}`,
      permissionOverwrites: filterResolvableOverwrites(guild, roomOverwrites)
    });
  } catch (err) {
    // Fallback: cria sem overwrites e aplica o essencial em seguida.
    console.warn('[TEMPVOZ] Create com overwrites falhou, tentando sem:', err.message);
    const room = await guild.channels.create({
      name: buildTempRoomName(member.displayName),
      type: ChannelType.GuildVoice,
      parent: parentId,
      userLimit: getUserLimit(),
      reason: `Sala temporaria CAPS de ${member.user?.tag || member.id} (fallback)`
    });
    for (const overwrite of filterResolvableOverwrites(guild, roomOverwrites)) {
      const perms = {};
      if (overwrite.allow) perms.allow = overwrite.allow;
      if (overwrite.deny) perms.deny = overwrite.deny;
      try {
        await room.permissionOverwrites.edit(overwrite.id, perms);
      } catch { /* overwrite individual intolerante: segue */ }
    }
    return room;
  }
}

function cancelPendingDeletion(channelId) {
  const timeoutId = pendingDeletions.get(String(channelId));
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingDeletions.delete(String(channelId));
  }
}

function scheduleDeleteIfEmpty(guild, channel) {
  const key = String(channel.id);
  if (pendingDeletions.has(key)) return;
  const timeoutId = setTimeout(async () => {
    pendingDeletions.delete(key);
    try {
      const fresh = await guild.channels.fetch(key).catch(() => null);
      if (!fresh || !isTempRoom(fresh)) {
        unregisterTempRoom(key);
        return;
      }
      if ((fresh.members?.size || 0) > 0) return;
      await fresh.delete('Sala temporaria vazia').catch(() => null);
      unregisterTempRoom(key);
      console.log(`[TEMPVOZ] Sala "${fresh.name}" removida (vazia).`);
    } catch (err) {
      console.error('[TEMPVOZ] Erro ao remover sala vazia:', err.message);
    }
  }, getDeleteDelayMs());
  if (typeof timeoutId.unref === 'function') timeoutId.unref();
  pendingDeletions.set(key, timeoutId);
}

async function handleVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild || !isGuildAllowed(guild.id)) return;
  if (!isTempVoiceEnabled()) return;

  const newChannel = newState.channelId ? await resolveChannel(guild, newState.channelId) : null;
  const oldChannel = oldState.channelId ? await resolveChannel(guild, oldState.channelId) : null;

  // Saiu de uma sala temporária e ela esvaziou -> agenda exclusão.
  // (Feito ANTES do hub: ao entrar no hub vindo de uma sala, a sala antiga
  // também precisa ser recolhida.)
  if (oldChannel && isTempRoom(oldChannel) && (!oldChannel.members || oldChannel.members.size === 0)) {
    scheduleDeleteIfEmpty(guild, oldChannel);
  }

  // Entrou em alguma sala com exclusão agendada -> cancela (voltou gente).
  if (newChannel && isTempRoom(newChannel)) cancelPendingDeletion(newChannel.id);

  // Entrou no hub -> cria a sala temporária (se tiver o cargo).
  if (newChannel && isHubChannel(newChannel.id)) {
    const member = newState.member;
    if (!memberCanCreateTempRoom(member)) {
      await newState.disconnect().catch(() => null);
      return;
    }
    try {
      const room = await createTempRoom(guild, member, newChannel);
      registerTempRoom(room.id, member.id, guild.id);
      console.log(`[TEMPVOZ] Sala "${room.name}" criada para ${member.user?.tag || member.id}.`);
      await newState.setChannel(room).catch(() => null);
    } catch (err) {
      console.error('[TEMPVOZ] Erro ao criar sala:', err.message);
    }
    return;
  }
}

// Remove do Discord as salas temporárias registradas que estão vazias
// (órfãs de reinícios ou de idas ao hub). Chamado ao ligar o bot.
async function pruneTempRooms(guild) {
  if (!guild || !isGuildAllowed(guild.id)) return { removed: 0 };
  const registry = loadRoomRegistry();
  let removed = 0;
  for (const [channelId, entry] of Object.entries(registry)) {
    if (entry?.guildId && String(entry.guildId) !== String(guild.id)) continue;
    const channel = await guild.channels.fetch(String(channelId)).catch(() => null);
    if (!channel || !isTempRoom(channel)) {
      unregisterTempRoom(channelId);
      continue;
    }
    if ((channel.members?.size || 0) === 0) {
      await channel.delete('Sala temporaria orfa').catch(() => null);
      unregisterTempRoom(channelId);
      removed += 1;
    }
  }
  if (removed > 0) console.log(`[TEMPVOZ] ${removed} sala(s) orfa(s) removida(s).`);
  return { removed };
}

// Reconhece salas criadas pelo hub mesmo sem registro (ex.: criadas antes
// do registro existir): prefixo do nome + negação de visão p/ @everyone.
function looksLikeTempRoom(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (isHubChannel(channel.id)) return false;
  if (typeof channel.name !== 'string' || !channel.name.startsWith(TEMP_ROOM_PREFIX)) return false;
  try {
    const everyone = channel.guild?.roles?.everyone;
    if (!everyone) return true;
    const overwrite = channel.permissionOverwrites?.cache?.get(String(everyone.id));
    if (!overwrite) return false;
    return overwrite.deny?.has(PermissionFlagsBits.ViewChannel) === true;
  } catch {
    return false;
  }
}

// `!limparvoz` (staff, Moderadores, VIP, Lendário): apaga as salas temporárias vazias, com ou sem registro.
async function handleCleanupCommand(message) {
  if (!memberCanManageTempVoice(message.member)) {
    await replyToMessage(message, '❌ Comando liberado para Admin, Moderadores, VIP e Lendário.');
    return;
  }
  let removed = 0;
  try {
    for (const channel of message.guild.channels.cache.values()) {
      if (!isTempRoom(channel) && !looksLikeTempRoom(channel)) continue;
      if ((channel.members?.size || 0) > 0) continue;
      await channel.delete('Limpeza de salas temporarias').catch(() => null);
      unregisterTempRoom(channel.id);
      cancelPendingDeletion(channel.id);
      removed += 1;
    }
  } catch (err) {
    console.error('[TEMPVOZ] Erro na limpeza:', err.message);
  }
  await replyToMessage(message, removed > 0 ? `🧹 ${removed} sala(s) temporária(s) vazia(s) removida(s).` : '✅ Nenhuma sala temporária vazia para remover.');
}

function resolveManagedRoom(message) {
  const voiceChannel = message.member?.voice?.channel;
  if (voiceChannel && isTempRoom(voiceChannel)) {
    const ownerId = getTempRoomOwnerId(voiceChannel);
    if (ownerId === message.author.id || memberIsStaff(message.member)) return voiceChannel;
  }
  return findOwnedTempRoom(message.guild, message.author.id);
}

async function handleHubCommand(message) {
  if (!memberIsStaff(message.member)) {
    await replyToMessage(message, '❌ Comando restrito à staff.');
    return;
  }
  // Aquece o cache de cargos nos dois ramos: .set() lanca TypeError
  // SINCRONO com ID fora do cache (o .catch() encadeado nao pega).
  await message.guild.roles?.fetch?.().catch(() => null);
  const category = findCategoryByName(message.guild, HUB_CATEGORY_NAME)
    || message.guild.channels.cache.get(config.voiceChannels?.classicQueueChannelId)?.parent
    || null;
  let hub = message.guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.name === HUB_CHANNEL_NAME)
    || (isTempVoiceEnabled() ? await resolveChannel(message.guild, getHubChannelId()) : null);
  if (!hub) {
    await message.guild.roles?.fetch?.().catch(() => null);
    hub = await message.guild.channels.create({
      name: HUB_CHANNEL_NAME,
      type: ChannelType.GuildVoice,
      parent: category?.id || null,
      reason: 'Hub de salas temporarias CAPS',
      permissionOverwrites: filterResolvableOverwrites(message.guild, buildHubOverwrites(message.guild))
    });
  } else {
    try {
      await hub.permissionOverwrites.set(filterResolvableOverwrites(message.guild, buildHubOverwrites(message.guild)));
    } catch (err) {
      console.warn('[TEMPVOZ] Nao apliquei overwrites do hub:', err.message);
    }
  }
  persistHubChannelId(hub.id);
  await replyToMessage(
    message,
    `✅ Hub de voz temporária pronto: **${hub.name}**.\n` +
    `Quem tem ${getAllowedRoleNames().map((n) => `**${n}**`).join('/')} entra e ganha uma sala privada. Dono: \`!convidar @...\` • \`!limite N\` • \`!lock\` • \`!unlock\` • \`!sala <nome>\`.`
  );
}

function persistHubChannelId(hubChannelId) {
  config.tempVoice = { ...(config.tempVoice || {}), hubChannelId: String(hubChannelId) };
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    onDisk.tempVoice = { ...(onDisk.tempVoice || {}), hubChannelId: String(hubChannelId) };
    fs.writeFileSync(configPath, JSON.stringify(onDisk, null, 2));
  } catch (err) {
    console.warn('[TEMPVOZ] Hub criado mas nao salvei no config.json:', err.message);
  }
}

async function handleLockCommand(message, locked) {
  const room = resolveManagedRoom(message);
  if (!room) {
    await replyToMessage(message, '❌ Entre na sua sala temporária (ou seja o dono dela) para usar este comando.');
    return;
  }
  const everyoneId = message.guild.roles.everyone.id;
  try {
    if (locked) {
      await room.permissionOverwrites.edit(everyoneId, { ViewChannel: false, Connect: false });
      await replyToMessage(message, `🔒 **${room.name}** trancada (só quem já tem acesso).`);
    } else {
      await room.permissionOverwrites.edit(everyoneId, { ViewChannel: true, Connect: true });
      await replyToMessage(message, `🔓 **${room.name}** aberta (todo mundo pode entrar).`);
    }
  } catch (err) {
    console.warn('[TEMPVOZ] Nao travei/destravei a sala:', err.message);
    await replyToMessage(message, '❌ Não consegui ajustar a sala agora. Tente de novo.');
  }
}

async function handleLimitCommand(message, args) {
  const room = resolveManagedRoom(message);
  if (!room) {
    await replyToMessage(message, '❌ Entre na sua sala temporária (ou seja o dono dela) para usar este comando.');
    return;
  }
  const value = Number(args[0]);
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    await replyToMessage(message, 'Uso: `!limite N` (0 = sem limite, máx. 99).');
    return;
  }
  await room.setUserLimit(value).catch(() => null);
  await replyToMessage(message, `👥 Limite de **${room.name}**: ${value === 0 ? 'sem limite' : `**${value}**`}.`);
}

async function handleInviteCommand(message) {
  const room = resolveManagedRoom(message);
  if (!room) {
    await replyToMessage(message, '❌ Entre na sua sala temporária (ou seja o dono dela) para usar este comando.');
    return;
  }
  const targets = [...message.mentions.members.values()];
  if (targets.length === 0) {
    await replyToMessage(message, 'Uso: `!convidar @jogador1 @jogador2`.');
    return;
  }
  const added = [];
  const dmOk = [];
  const dmFailed = [];
  for (const target of targets) {
    if (target.user.bot) continue;
    try {
      await room.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true, Speak: true });
    } catch (err) {
      console.warn('[TEMPVOZ] Nao liberei a sala p/', target.id, err.message);
    }
    added.push(`<@${target.id}>`);
    await target.send(
      `🎧 **${message.author.username}** te convidou para a sala de voz **${room.name}** no servidor **${message.guild.name}**.\n` +
      `Entre pelo canal de voz (categoria ${room.parent?.name || 'de partidas'}). A sala apaga sozinha quando esvaziar.`
    ).then(() => dmOk.push(target.id)).catch(() => dmFailed.push(target.id));
  }
  if (added.length === 0) {
    await replyToMessage(message, '❌ Ninguém válido para convidar.');
    return;
  }
  let extra = '';
  if (dmFailed.length > 0) extra += ` (DM fechada p/ <@${dmFailed.join('> <@')}>)`;
  await replyToMessage(message, `✅ Convidados para **${room.name}**: ${added.join(' ')} — avisei por DM${extra}. É só entrarem no canal de voz.`);
}

async function handleRenameCommand(message, args) {
  const room = resolveManagedRoom(message);
  if (!room) {
    await replyToMessage(message, '❌ Entre na sua sala temporária (ou seja o dono dela) para usar este comando.');
    return;
  }
  const name = sanitizeChannelName(args.join(' '));
  if (!name) {
    await replyToMessage(message, 'Uso: `!sala <nome>`.');
    return;
  }
  await room.setName(buildTempRoomName(name)).catch(() => null);
  await replyToMessage(message, `✏️ Sala renomeada para **${room.name}**.`);
}

module.exports = {
  TEMP_TOPIC_PREFIX,
  HUB_CHANNEL_NAME,
  TEMP_ROOM_PREFIX,
  getTempVoiceConfig,
  getHubChannelId,
  isTempVoiceEnabled,
  getUserLimit,
  getDeleteDelayMs,
  getAllowedRoleIds,
  getAllowedRoleNames,
  isHubChannel,
  isTempRoom,
  getTempRoomOwnerId,
  sanitizeChannelName,
  buildTempRoomName,
  memberIsStaff,
  memberHasAllowedRole,
  memberCanCreateTempRoom,
  memberCanManageTempVoice,
  getManagerRoleNames,
  resolveCreatorRoleIds,
  buildHubOverwrites,
  findOwnedTempRoom,
  registerTempRoom,
  unregisterTempRoom,
  handleVoiceStateUpdate,
  pruneTempRooms,
  looksLikeTempRoom,
  handleCleanupCommand,
  handleHubCommand,
  handleLockCommand,
  handleLimitCommand,
  handleInviteCommand,
  handleRenameCommand
};
