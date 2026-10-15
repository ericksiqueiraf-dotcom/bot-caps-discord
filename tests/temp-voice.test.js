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

function backupConfig() {
  return JSON.parse(JSON.stringify(config.tempVoice || {}));
}

function restoreConfig(bak) {
  config.tempVoice = bak;
}

function mockGuild({ roles = [], members = {}, channels = {} } = {}) {
  const roleList = roles.map((r, i) => ({ id: String(r.id || `r${i}`), name: r.name || `cargo-${i}` }));
  const channelCache = new Map(Object.entries(channels));
  const memberCache = new Map(Object.entries(members));
  return {
    id: 'g1',
    roles: { cache: { find: (fn) => roleList.find(fn) } },
    members: {
      cache: memberCache,
      me: null,
      fetch: async (id) => memberCache.get(id) || null
    },
    channels: {
      cache: channelCache,
      fetch: async (id) => channelCache.get(id) || null
    }
  };
}

function mockMember({ id = 'u1', displayName = 'Teste', username = 'teste', guild = null, roleIds = [], perms = [], voiceChannel = null } = {}) {
  const cache = new Map(roleIds.map((r) => [String(r), { id: String(r) }]));
  return {
    id,
    displayName,
    user: { username, tag: `${username}#0001`, send: async () => {} },
    guild,
    permissions: { has: (perm) => perms.includes(perm) },
    roles: { cache },
    voice: {
      channel: voiceChannel,
      setChannel: async () => {}
    },
    send: async () => {}
  };
}

function mockVoiceChannel({ id = 'c1', name = '➕・Teste', guild = null, memberCount = 0 } = {}) {
  return {
    id,
    name,
    type: ChannelType.GuildVoice,
    parentId: 'cat1',
    position: 3,
    guild,
    members: { size: memberCount },
    setName: async function (n) { this.name = n; },
    delete: async function () { this.deleted = true; },
    setPosition: async () => {}
  };
}

describe('voz temporaria (tempVoice) — API atual', () => {
  it('hub detectado por ID configurado ou pelo nome', () => {
    const bak = backupConfig();
    try {
      config.tempVoice = { ...(bak || {}), hubChannelId: 'hub123' };
      assert.equal(tempVoice.isHubChannel({ id: 'hub123', name: 'outro', type: ChannelType.GuildVoice }), true);
      assert.equal(tempVoice.isHubChannel({ id: 'x', name: '➕・criar-sala', type: ChannelType.GuildVoice }), true);
      assert.equal(tempVoice.isHubChannel({ id: 'x', name: '➕ Criar sala', type: ChannelType.GuildVoice }), true);
      assert.equal(tempVoice.isHubChannel({ id: 'x', name: 'lobby', type: ChannelType.GuildVoice }), false);
      assert.equal(tempVoice.isHubChannel({ id: 'hub123', name: 'hub', type: ChannelType.GuildText }), false);
    } finally {
      restoreConfig(bak);
    }
  });

  it('sala gerenciada tem prefixo e nunca e o hub', () => {
    const bak = backupConfig();
    try {
      config.tempVoice = { ...(bak || {}), hubChannelId: 'hub123' };
      assert.equal(tempVoice.isManagedTempVoiceChannel({ id: 'r1', name: '➕・BuGãO', type: ChannelType.GuildVoice }), true);
      assert.equal(tempVoice.isManagedTempVoiceChannel({ id: 'hub123', name: '➕・criar-sala', type: ChannelType.GuildVoice }), false);
      assert.equal(tempVoice.isManagedTempVoiceChannel({ id: 'r2', name: 'lobby', type: ChannelType.GuildVoice }), false);
    } finally {
      restoreConfig(bak);
    }
  });

  it('quem pode criar: admin sempre; sem cargos configurados libera; com cargos exige um deles', () => {
    const bak = backupConfig();
    try {
      const guildSemRegras = mockGuild();
      assert.equal(tempVoice.canCreateTempVoice(null), false);
      assert.equal(
        tempVoice.canCreateTempVoice(mockMember({ guild: guildSemRegras, perms: [PermissionFlagsBits.Administrator] })),
        true
      );

      config.tempVoice = { ...(bak || {}), allowedRoleIds: [], allowedRoleNames: [] };
      assert.equal(tempVoice.canCreateTempVoice(mockMember({ guild: mockGuild() })), true);

      config.tempVoice = { ...(bak || {}), allowedRoleIds: [], allowedRoleNames: ['Capitão'] };
      const guild = mockGuild({ roles: [{ id: '9', name: 'Capitão' }] });
      assert.equal(tempVoice.canCreateTempVoice(mockMember({ guild, roleIds: ['9'] })), true);
      assert.equal(tempVoice.canCreateTempVoice(mockMember({ guild, roleIds: ['7'] })), false);
    } finally {
      restoreConfig(bak);
    }
  });

  it('registro persistente: dono por sala e por usuario', () => {
    tempVoice.registerTempRoom('reg1', 'u9', 'greg');
    assert.equal(tempVoice.getTempRoomOwner('reg1', 'greg'), 'u9');
    assert.equal(tempVoice.getUserTempRoom('u9', 'greg'), 'reg1');
    assert.deepEqual(Object.keys(tempVoice.getAllTempRooms('greg')), ['reg1']);
    tempVoice.unregisterTempRoom('reg1', 'greg');
    assert.equal(tempVoice.getTempRoomOwner('reg1', 'greg'), null);
    assert.equal(tempVoice.getUserTempRoom('u9', 'greg'), null);
  });

  it('dono da sala: criador ou admin', () => {
    tempVoice.registerTempRoom('room9', 'owner1', 'g9');
    try {
      const guild = mockGuild();
      assert.equal(tempVoice.isTempRoomOwner(mockMember({ id: 'owner1', guild }), 'room9'), false); // guild.id diverge
      const guild9 = mockGuild();
      guild9.id = 'g9';
      assert.equal(tempVoice.isTempRoomOwner(mockMember({ id: 'owner1', guild: guild9 }), 'room9'), true);
      assert.equal(tempVoice.isTempRoomOwner(mockMember({ id: 'outro', guild: guild9 }), 'room9'), false);
      assert.equal(
        tempVoice.isTempRoomOwner(mockMember({ id: 'outro', guild: guild9, perms: [PermissionFlagsBits.Administrator] }), 'room9'),
        true
      );
    } finally {
      tempVoice.unregisterTempRoom('room9', 'g9');
    }
  });

  it('!sala renomeia a sala do dono', async () => {
    const guild = mockGuild();
    guild.id = 'grename';
    const room = mockVoiceChannel({ id: 'roomR', name: '➕・Antigo', guild, memberCount: 1 });
    guild.channels.cache.set('roomR', room);
    guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
    tempVoice.registerTempRoom('roomR', 'u1', 'grename');
    try {
      const owner = mockMember({ id: 'u1', guild });
      const ok = await tempVoice.renameTempRoom(owner, 'Sala Nova');
      assert.equal(ok.success, true);
      assert.equal(room.name, '➕・Sala Nova');

      const semSala = await tempVoice.renameTempRoom(mockMember({ id: 'ninguem', guild }), 'X');
      assert.equal(semSala.success, false);
    } finally {
      tempVoice.unregisterTempRoom('roomR', 'grename');
    }
  });

  it('!limparvoz apaga a sala do dono e limpa o registro', async () => {
    const guild = mockGuild();
    guild.id = 'gdel';
    const room = mockVoiceChannel({ id: 'roomD', name: '➕・Apagar', guild, memberCount: 1 });
    guild.channels.cache.set('roomD', room);
    guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
    tempVoice.registerTempRoom('roomD', 'u1', 'gdel');
    try {
      const res = await tempVoice.deleteTempRoom(mockMember({ id: 'u1', guild }));
      assert.equal(res.success, true);
      assert.equal(room.deleted, true);
      assert.equal(tempVoice.getTempRoomOwner('roomD', 'gdel'), null);

      const semSala = await tempVoice.deleteTempRoom(mockMember({ id: 'u1', guild }));
      assert.equal(semSala.success, false);
    } finally {
      tempVoice.unregisterTempRoom('roomD', 'gdel');
    }
  });

  it('!convidar move quem esta em voz e manda DM p/ quem esta fora', async () => {
    const guild = mockGuild();
    guild.id = 'ginv';
    const room = mockVoiceChannel({ id: 'roomI', name: '➕・Sala', guild, memberCount: 1 });
    guild.channels.cache.set('roomI', room);
    guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
    tempVoice.registerTempRoom('roomI', 'dono', 'ginv');
    try {
      const dono = mockMember({ id: 'dono', guild });
      const semSala = await tempVoice.inviteToTempRoom(mockMember({ id: 'sem', guild }), { id: 'alvo' });
      assert.equal(semSala.success, false);

      let movidoPara = null;
      const emOutra = mockMember({ id: 'alvo1', guild, voiceChannel: { id: 'outra' } });
      emOutra.voice.setChannel = async (ch) => { movidoPara = ch.id; };
      guild.members.cache.set('alvo1', emOutra);
      const r1 = await tempVoice.inviteToTempRoom(dono, { id: 'alvo1' });
      assert.equal(r1.success, true);
      assert.equal(movidoPara, 'roomI');

      let dmEnviada = false;
      const foraDaVoz = mockMember({ id: 'alvo2', guild });
      foraDaVoz.send = async () => { dmEnviada = true; };
      guild.members.cache.set('alvo2', foraDaVoz);
      const r2 = await tempVoice.inviteToTempRoom(dono, { id: 'alvo2' });
      assert.equal(r2.success, true);
      assert.equal(dmEnviada, true);
    } finally {
      tempVoice.unregisterTempRoom('roomI', 'ginv');
    }
  });

  it('!salahub lista so salas validas do servidor', () => {
    const guild = mockGuild();
    guild.id = 'glist';
    const room = mockVoiceChannel({ id: 'roomL', name: '➕・Sala', guild, memberCount: 2 });
    guild.channels.cache.set('roomL', room);
    const dono = mockMember({ id: 'dono', guild, username: 'dono' });
    guild.members.cache.set('dono', dono);
    tempVoice.registerTempRoom('roomL', 'dono', 'glist');
    tempVoice.registerTempRoom('fantasma', 'alguem', 'glist');
    try {
      const rooms = tempVoice.listTempRooms(guild);
      assert.equal(rooms.length, 1);
      assert.equal(rooms[0].channel.id, 'roomL');
      assert.equal(rooms[0].memberCount, 2);
    } finally {
      tempVoice.unregisterTempRoom('roomL', 'glist');
      tempVoice.unregisterTempRoom('fantasma', 'glist');
    }
  });

  it('!salalock tranca e destranca a sala do dono', async () => {
    const bak = backupConfig();
    try {
      config.tempVoice = { ...(bak || {}), hubChannelId: 'hubZ', allowedRoleIds: [], allowedRoleNames: [] };
      const guild = mockGuild();
      guild.id = 'glock';
      const overwrites = {};
      const room = mockVoiceChannel({ id: 'roomK', name: '➕・Sala', guild, memberCount: 1 });
      room.permissionOverwrites = { edit: async (id, perms) => { overwrites[id] = perms; } };
      guild.channels.cache.set('roomK', room);
      guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
      tempVoice.registerTempRoom('roomK', 'u1', 'glock');
      try {
        const locked = await tempVoice.setTempRoomLock(mockMember({ id: 'u1', guild }), true);
        assert.equal(locked.success, true);
        assert.equal(locked.locked, true);

        const unlocked = await tempVoice.setTempRoomLock(mockMember({ id: 'u1', guild }), false);
        assert.equal(unlocked.success, true);
        assert.equal(unlocked.locked, false);

        const semSala = await tempVoice.setTempRoomLock(mockMember({ id: 'ninguem', guild }), true);
        assert.equal(semSala.success, false);
      } finally {
        tempVoice.unregisterTempRoom('roomK', 'glock');
      }
    } finally {
      restoreConfig(bak);
    }
  });

  it('!salalimit valida 0-99 e aplica no canal', async () => {
    const guild = mockGuild();
    guild.id = 'glim';
    const room = mockVoiceChannel({ id: 'roomL2', name: '➕・Sala', guild, memberCount: 1 });
    let applied = null;
    room.setUserLimit = async (v) => { applied = v; };
    guild.channels.cache.set('roomL2', room);
    guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
    tempVoice.registerTempRoom('roomL2', 'u1', 'glim');
    try {
      const ok = await tempVoice.setTempRoomLimit(mockMember({ id: 'u1', guild }), '5');
      assert.equal(ok.success, true);
      assert.equal(applied, 5);

      const zero = await tempVoice.setTempRoomLimit(mockMember({ id: 'u1', guild }), '0');
      assert.equal(zero.success, true);
      assert.equal(applied, 0);

      assert.equal((await tempVoice.setTempRoomLimit(mockMember({ id: 'u1', guild }), '100')).success, false);
      assert.equal((await tempVoice.setTempRoomLimit(mockMember({ id: 'u1', guild }), 'abc')).success, false);
      assert.equal((await tempVoice.setTempRoomLimit(mockMember({ id: 'ninguem', guild }), '5')).success, false);
    } finally {
      tempVoice.unregisterTempRoom('roomL2', 'glim');
    }
  });

  it('!salaexpulsar remove quem esta na sala do dono', async () => {
    const guild = mockGuild();
    guild.id = 'gexp';
    const room = mockVoiceChannel({ id: 'roomE', name: '➕・Sala', guild, memberCount: 2 });
    guild.channels.cache.set('roomE', room);
    guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
    tempVoice.registerTempRoom('roomE', 'dono', 'gexp');
    try {
      const dono = mockMember({ id: 'dono', guild });
      let desconectado = false;
      const alvo = mockMember({ id: 'alvo', guild, voiceChannel: { id: 'roomE' } });
      alvo.voice.disconnect = async () => { desconectado = true; };
      guild.members.cache.set('alvo', alvo);
      const r1 = await tempVoice.kickFromTempRoom(dono, { id: 'alvo' });
      assert.equal(r1.success, true);
      assert.equal(desconectado, true);

      const fora = mockMember({ id: 'fora', guild, voiceChannel: { id: 'outra' } });
      guild.members.cache.set('fora', fora);
      assert.equal((await tempVoice.kickFromTempRoom(dono, { id: 'fora' })).success, false);
      assert.equal((await tempVoice.kickFromTempRoom(dono, { id: 'dono' })).success, false);
      assert.equal((await tempVoice.kickFromTempRoom(mockMember({ id: 'sem', guild }), { id: 'alvo' })).success, false);
    } finally {
      tempVoice.unregisterTempRoom('roomE', 'gexp');
    }
  });

  it('auto-delete apaga sala vazia e limpa o registro', async () => {
    const bak = backupConfig();
    try {
      config.tempVoice = { ...(bak || {}), hubChannelId: 'hubX', deleteDelaySeconds: 1 };
      const guild = mockGuild();
      guild.id = 'gauto';
      const room = mockVoiceChannel({ id: 'roomA', name: '➕・Vazia', guild, memberCount: 0 });
      guild.channels.cache.set('roomA', room);
      guild.channels.fetch = async (id) => guild.channels.cache.get(id) || null;
      tempVoice.registerTempRoom('roomA', 'u1', 'gauto');

      await tempVoice.handleTempVoiceStateUpdate({ channel: room, member: null }, { channel: null, member: null });
      await new Promise((resolve) => setTimeout(resolve, 1300));
      assert.equal(room.deleted, true);
      assert.equal(tempVoice.getTempRoomOwner('roomA', 'gauto'), null);
    } finally {
      tempVoice.unregisterTempRoom('roomA', 'gauto');
      restoreConfig(bak);
    }
  });
});
