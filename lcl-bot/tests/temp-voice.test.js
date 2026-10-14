const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

process.env.TEMPVOICE_REGISTRY_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tempvoice-')), 'rooms.json');
const tempVoice = require('../services/tempVoiceService');
const config = require('../config.json');

after(() => {
  try { fs.rmSync(path.dirname(process.env.TEMPVOICE_REGISTRY_PATH), { recursive: true, force: true }); } catch {}
});

function mockMember({ id = 'u1', displayName = 'Teste', roleIds = [], roleNames = [], perms = [] } = {}) {
  const roles = roleIds.map((roleId, i) => ({ id: String(roleId), name: roleNames[i] || `cargo-${i}` }));
  const cache = new Map(roles.map((r) => [r.id, r]));
  return {
    id,
    displayName,
    permissions: { has: (perm) => perms.includes(perm) },
    roles: { cache }
  };
}

function mockVoiceChannel({ id = 'c1', name = 'voz', topic = null } = {}) {
  return { id, name, type: ChannelType.GuildVoice, topic };
}

describe('voz temporaria (tempVoice)', () => {
  it('hub desabilitado sem hubChannelId', () => {
    const backup = config.tempVoice;
    config.tempVoice = { ...(backup || {}), hubChannelId: '' };
    assert.equal(tempVoice.isTempVoiceEnabled(), false);
    assert.equal(tempVoice.isHubChannel('qualquer'), false);
    config.tempVoice = backup;
  });

  it('detecta hub e sala temporaria pelo topic', () => {
    const backup = config.tempVoice;
    config.tempVoice = { ...(backup || {}), hubChannelId: 'hub123' };
    assert.equal(tempVoice.isHubChannel('hub123'), true);
    assert.equal(tempVoice.isHubChannel('outro'), false);
    const room = mockVoiceChannel({ id: 'r1', topic: 'caps-temp:u1' });
    assert.equal(tempVoice.isTempRoom(room), true);
    assert.equal(tempVoice.isTempRoom(mockVoiceChannel({ id: 'hub123', topic: 'caps-temp:u1' })), false);
    assert.equal(tempVoice.getTempRoomOwnerId(room), 'u1');
    assert.equal(tempVoice.getTempRoomOwnerId(mockVoiceChannel({ topic: null })), null);
    config.tempVoice = backup;
  });

  it('staff (admin) sempre pode criar', () => {
    const member = mockMember({ perms: [PermissionFlagsBits.Administrator] });
    assert.equal(tempVoice.memberCanCreateTempRoom(member), true);
  });

  it('cargo permitido pode criar; sem cargo nao pode', () => {
    const backup = config.tempVoice;
    config.tempVoice = { ...(backup || {}), allowedRoleNames: ['Capitão'], allowedRoleIds: [] };
    assert.equal(tempVoice.memberCanCreateTempRoom(mockMember({ roleIds: ['9'], roleNames: ['Capitão'] })), true);
    assert.equal(tempVoice.memberCanCreateTempRoom(mockMember({ roleIds: ['9'], roleNames: ['Jogador'] })), false);
    assert.equal(tempVoice.memberCanCreateTempRoom(null), false);
    config.tempVoice = backup;
  });

  it('registro persistente identifica a sala sem topic', () => {
    const room = mockVoiceChannel({ id: 'reg1', topic: null });
    assert.equal(tempVoice.isTempRoom(room), false);
    tempVoice.registerTempRoom('reg1', 'u9', 'g1');
    assert.equal(tempVoice.isTempRoom(room), true);
    assert.equal(tempVoice.getTempRoomOwnerId(room), 'u9');
    tempVoice.unregisterTempRoom('reg1');
    assert.equal(tempVoice.isTempRoom(room), false);
  });

  it('gerencia liberada p/ Moderadores/VIP/Lendario', () => {
    const backup = config.tempVoice;
    config.tempVoice = { ...(backup || {}) };
    delete config.tempVoice.managerRoleNames;
    const mockPerms = (name) => mockMember({ roleIds: ['1'], roleNames: [name] });
    assert.equal(tempVoice.memberCanManageTempVoice(mockPerms('Moderadores')), true);
    assert.equal(tempVoice.memberCanManageTempVoice(mockPerms('⭐ VIP')), true);
    assert.equal(tempVoice.memberCanManageTempVoice(mockPerms('👑 Lendário')), true);
    assert.equal(tempVoice.memberCanManageTempVoice(mockPerms('Jogador')), false);
    config.tempVoice = backup;
  });

  it('prune remove sala registrada vazia e mantem ocupada', async () => {
    const deleted = [];
    const emptyRoom = { id: 'prune1', name: 'Sala', type: ChannelType.GuildVoice, topic: null, members: { size: 0 }, delete: async () => { deleted.push('prune1'); } };
    const busyRoom = { id: 'prune2', name: 'Sala', type: ChannelType.GuildVoice, topic: null, members: { size: 2 }, delete: async () => { deleted.push('prune2'); } };
    const guild = { id: '1558217291123138561', channels: { fetch: async (id) => ({ prune1: emptyRoom, prune2: busyRoom })[id] || null } };
    tempVoice.registerTempRoom('prune1', 'u1', guild.id);
    tempVoice.registerTempRoom('prune2', 'u2', guild.id);
    const result = await tempVoice.pruneTempRooms(guild);
    assert.equal(result.removed, 1);
    assert.deepEqual(deleted, ['prune1']);
    tempVoice.unregisterTempRoom('prune2');
  });

  it('nome da sala com prefixo e limite de tamanho', () => {
    const name = tempVoice.buildTempRoomName('UmNomeMuitoLongo'.repeat(10));
    assert.ok(name.startsWith('🎧 Sala de '));
    assert.ok(name.length <= 100);
  });
});
