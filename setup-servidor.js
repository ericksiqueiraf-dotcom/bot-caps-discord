// Setup automático do servidor Discord da CAPS Arena.
// Cria cargos, categorias, canais e permissões e grava os IDs no config.json.
//
// USO:
//   node setup-servidor.js <GUILD_ID>            -> executa (com backup do config.json)
//   node setup-servidor.js <GUILD_ID> --dry-run  -> só mostra o plano, não cria nada
//   node setup-servidor.js <GUILD_ID> --skip-config -> não altera o config.json
//
// PRÉ-REQUISITO: o bot já convidado no servidor COM permissão de Administrador.
// Pode rodar de novo sem medo: tudo é "procurar-ou-criar" (idempotente).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN não configurado no .env');
  process.exit(1);
}

const [, , GUILD_ID, ...flags] = process.argv;
if (!GUILD_ID) {
  console.error('Uso: node setup-servidor.js <GUILD_ID> [--dry-run] [--skip-config]');
  process.exit(1);
}
const DRY_RUN = flags.includes('--dry-run');
const SKIP_CONFIG = flags.includes('--skip-config');

// ─── Planta do servidor ─────────────────────────────────────────────
const ROLES = [
  { name: 'Staff', color: '#E74C3C', reason: 'Equipe do servidor' },
  { name: 'Capitão', color: '#F1C40F', reason: 'Pode !start / !vitoria' },
  { name: 'Jogador', color: '#3498DB', reason: 'Recebe no !cadastrar' },
  { name: 'INFERNAL', color: '#FF6B00', reason: 'Bot dá/remove sozinho (5 wins)' },
  { name: 'MVP player', color: '#9B59B6', reason: 'Bot dá/remove sozinho (MVP)' },
  // Clube VIP (comercializáveis — o bot não mexe, só a staff vende/remove)
  { name: '💜 Apoiador', color: '#A855F7', reason: 'Tier 1 do clube VIP' },
  { name: '⭐ VIP', color: '#FFD700', reason: 'Tier 2 do clube VIP' },
  { name: '👑 Lendário', color: '#FF2D78', reason: 'Tier 3 do clube VIP' }
];

const VIP_ROLE_NAMES = ['💜 Apoiador', '⭐ VIP', '👑 Lendário'];

const CATEGORIES = ['📥・ENTRADA', '🎙️・FILAS', '⚔️・PARTIDAS', '📊・ARENA', '💎・CLUBE VIP', '💬・COMUNIDADE'];

const TEXT_CHANNELS = [
  // { name, category, configKey, note }
  { name: 'boas-vindas', category: '📥・ENTRADA', configKey: 'welcomeChannelId', open: true },
  { name: 'como-jogar', category: '📥・ENTRADA', configKey: null, open: true },
  { name: 'fila', category: '📊・ARENA', configKey: 'queueStatusChannelId' },
  { name: 'partidas-em-andamento', category: '📊・ARENA', configKey: 'matchOngoingChannelId' },
  { name: 'historico-partidas', category: '📊・ARENA', configKey: 'matchHistoryChannelId' },
  { name: 'destaques-mvp', category: '📊・ARENA', configKey: 'mvpAnnouncementsChannelId' },
  { name: 'meu-elo', category: '📊・ARENA', configKey: 'playerLogChannelId' },
  { name: 'temporada', category: '📊・ARENA', configKey: 'seasonLogChannelId' },
  { name: 'ranking', category: '📊・ARENA', configKey: 'rankUpdatesChannelId' },
  { name: 'comandos', category: '📊・ARENA', configKey: null, talk: true },
  { name: 'clube-vip', category: '💎・CLUBE VIP', configKey: null, vip: true, talk: true },
  { name: 'geral', category: '💬・COMUNIDADE', configKey: null, open: true, talk: true },
  { name: 'clips', category: '💬・COMUNIDADE', configKey: null, open: true, talk: true },
  { name: 'sugestoes', category: '💬・COMUNIDADE', configKey: null, open: true, talk: true }
];

const VOICE_CHANNELS = [
  // { name, category, configKey }
  { name: '🔊 Lobby Classic', category: '🎙️・FILAS', configKey: 'classicQueueChannelId' },
  { name: '💎 Lobby TIER S', category: '🎙️・FILAS', configKey: 'classicTierSQueueChannelId' },
  { name: '🔊 Lobby ARAM', category: '🎙️・FILAS', configKey: 'aramQueueChannelId' },
  { name: '⏳ Sala de Espera', category: '🎙️・FILAS', configKey: 'postMatchWaitingChannelId' },
  { name: '⏳ Sala de Espera Tier S', category: '🎙️・FILAS', configKey: 'postMatchTierSWaitingChannelId' },
  { name: '👑 Lounge VIP', category: '💎・CLUBE VIP', configKey: null, vip: true }
];

const PIN_NOTICES = {
  'como-jogar': '🎮 **Bem-vindo à CAPS Arena!**\n1️⃣ Digite `!cadastrar SeuNick#TAG` aqui ou no #comandos\n2️⃣ Entre num canal 🔊 Lobby e digite `!entrar`\n3️⃣ Jogou? Vote com `!votar 1` ou `!votar 2`\nDúvidas: `!ajuda`',
  comandos: '⌨️ **Canal de comandos** — use aqui: `!entrar` • `!fila` • `!votar 1/2` • `!perfil` • `!placar` • `!ajuda`',
  fila: '📊 **Status das filas e resultado da roleta aparecem aqui.** Este canal é só leitura.',
  'partidas-em-andamento': '⚔️ **Início das partidas e votação de resultado (botões Time 1 / Time 2) aqui.** Este canal é só leitura — vote clicando ou use o #comandos.'
};

async function findOrCreateRole(guild, { name, color, reason }) {
  const existing = guild.roles.cache.find((r) => r.name === name);
  if (existing) {
    console.log(`   ✔ cargo "${name}" já existe (${existing.id})`);
    return existing;
  }
  if (DRY_RUN) {
    console.log(`   + criaria cargo "${name}"`);
    return { id: `(novo)`, name };
  }
  const role = await guild.roles.create({ name, color, reason: `Setup CAPS Arena: ${reason}` });
  console.log(`   + cargo "${name}" criado (${role.id})`);
  return role;
}

async function findOrCreateCategory(guild, name) {
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (existing) return existing;
  if (DRY_RUN) {
    console.log(`   + criaria categoria "${name}"`);
    return { id: '(nova)', name };
  }
  return guild.channels.create({ name, type: ChannelType.GuildCategory });
}

async function findChannel(guild, name, categoryId) {
  return guild.channels.cache.find((c) => c.name === name && c.parentId === categoryId && c.type !== ChannelType.GuildCategory) || null;
}

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(DISCORD_TOKEN);
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) {
    console.error('❌ Servidor não encontrado. Confira o GUILD_ID e se o bot está no servidor com permissão de Administrador.');
    process.exit(1);
  }
  await guild.channels.fetch();
  await guild.roles.fetch();
  console.log(`🏟️ Servidor: ${guild.name} (${guild.id})${DRY_RUN ? ' — DRY RUN (nada será criado)' : ''}`);

  // 1. Cargos
  console.log('🎭 Cargos:');
  const roles = {};
  for (const spec of ROLES) roles[spec.name] = await findOrCreateRole(guild, spec);

  const everyone = guild.roles.everyone;
  const get = (name) => roles[name];

  // 2. Categorias
  console.log('📁 Categorias:');
  const cats = {};
  for (const name of CATEGORIES) {
    cats[name] = await findOrCreateCategory(guild, name);
    console.log(`   ✔ categoria "${name}"`);
  }

  // 3. Canais de texto
  console.log('💬 Canais de texto:');
  const textIds = {};
  for (const spec of TEXT_CHANNELS) {
    const parent = cats[spec.category];
    let channel = await findChannel(guild, spec.name, parent.id);
    const vipOverwrites = [
      { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...VIP_ROLE_NAMES.map((vip) => ({
        id: get(vip).id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions]
      })),
      { id: get('Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
    ];
    const overwrites = spec.vip
      ? vipOverwrites
      : spec.open
      ? [
          { id: everyone.id, deny: [PermissionFlagsBits.SendMessages] },
          { id: get('Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
        ]
      : [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: get('Jogador').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions], deny: spec.talk ? [] : [PermissionFlagsBits.SendMessages] },
          { id: get('Capitão').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] },
          { id: get('Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] }
        ];
    if (!channel) {
      if (DRY_RUN) {
        console.log(`   + criaria #${spec.name} em ${spec.category}`);
        continue;
      }
      channel = await guild.channels.create({ name: spec.name, type: ChannelType.GuildText, parent: parent.id, permissionOverwrites: overwrites });
      console.log(`   + #${spec.name} criado (${channel.id})`);
    } else {
      console.log(`   ✔ #${spec.name} já existe (${channel.id})`);
      if (!DRY_RUN) await channel.permissionOverwrites.set(overwrites).catch((e) => console.log(`     ⚠ permissões de #${spec.name}: ${e.message}`));
    }
    if (spec.configKey) textIds[spec.configKey] = channel.id;
    if (PIN_NOTICES[spec.name] && !DRY_RUN && channel?.send) {
      const pins = await channel.messages.fetchPins().catch(() => null);
      if (!pins || pins.size === 0) {
        const msg = await channel.send(PIN_NOTICES[spec.name]).catch(() => null);
        if (msg) await msg.pin().catch(() => null);
      }
    }
  }

  // 4. Canais de voz
  console.log('🔊 Canais de voz:');
  const voiceIds = {};
  for (const spec of VOICE_CHANNELS) {
    const parent = cats[spec.category];
    let channel = await findChannel(guild, spec.name, parent.id);
    const overwrites = spec.vip
      ? [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          ...VIP_ROLE_NAMES.map((vip) => ({
            id: get(vip).id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          })),
          { id: get('Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }
        ]
      : [
      { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
      { id: get('Jogador').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
      { id: get('Capitão').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] },
      { id: get('Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }
    ];
    if (!channel) {
      if (DRY_RUN) {
        console.log(`   + criaria "${spec.name}" em ${spec.category}`);
        continue;
      }
      channel = await guild.channels.create({ name: spec.name, type: ChannelType.GuildVoice, parent: parent.id, permissionOverwrites: overwrites });
      console.log(`   + "${spec.name}" criado (${channel.id})`);
    } else {
      console.log(`   ✔ "${spec.name}" já existe (${channel.id})`);
      if (!DRY_RUN) await channel.permissionOverwrites.set(overwrites).catch((e) => console.log(`     ⚠ permissões: ${e.message}`));
    }
    if (spec.configKey) voiceIds[spec.configKey] = channel.id;
  }

  // 5. Grava no config.json (com backup)
  if (!DRY_RUN && !SKIP_CONFIG) {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const backupPath = path.join(__dirname, `config.json.bak-${Date.now()}`);
    fs.copyFileSync(configPath, backupPath);
    console.log(`💾 Backup do config atual: ${path.basename(backupPath)}`);
    config.roles = { ...config.roles, registeredPlayerRoleId: roles.Jogador.id, captainRoleId: roles['Capitão'].id };
    config.voiceChannels = { ...config.voiceChannels, ...voiceIds };
    config.textChannels = { ...config.textChannels, ...textIds };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✔ config.json atualizado com os IDs novos');
  }

  console.log('\n✅ Setup concluído! Próximos passos:');
  console.log('   1. Confira os cargos: dê "Staff" e "Capitão" para quem é da equipe.');
  console.log('   2. Reinicie o bot (pm2 restart caps-bot --update-env).');
  console.log('   3. Teste: !cadastrar Nick#TAG → !entrar (no Lobby) → !votar 1.');
  await client.destroy();
}

main().catch((err) => {
  console.error('❌ Falha no setup:', err.message);
  process.exit(1);
});
