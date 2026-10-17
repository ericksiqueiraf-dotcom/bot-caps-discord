// Setup automático do servidor da LCL — Liga Clandestina de LoL.
// Cria cargos, categorias, canais e permissões e grava os IDs no config.json,
// incluindo a seção `inter` (convite/anúncio/ranking apontando p/ os canais LCL).
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
const { buildHubOverwrites, HUB_CHANNEL_NAME } = require('./services/tempVoiceService');
const { buildRulesEmbed } = require('./utils/lobbyUtils');
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
if (!GUILD_ID && require.main === module) {
  console.error('Uso: node setup-servidor.js <GUILD_ID> [--dry-run] [--skip-config]');
  process.exit(1);
}
const DRY_RUN = flags.includes('--dry-run');
const SKIP_CONFIG = flags.includes('--skip-config');

// ─── Planta do servidor (fonte da verdade: server-pattern.json) ─────────────
// A voz clandestina vive na FILA (mesma categoria dos bots CAPS); os textos
// do inter ficam separados na categoria 🔥・LCL.
const PATTERN = require('./server-pattern.json');
const ROLES = PATTERN.roles;
const VIP_ROLE_NAMES = PATTERN.vipRoleNames;
const CATEGORIES = PATTERN.categories;
const CATEGORY_MERGES = PATTERN.categoryMerges || {};
const TEXT_CHANNELS = PATTERN.textChannels;
const VOICE_CHANNELS = PATTERN.voiceChannels.map((spec) =>
  spec.name === 'HUB' ? { ...spec, name: HUB_CHANNEL_NAME } : spec
);
const PIN_NOTICES = PATTERN.pinNotices;
const INTER_KEYS = PATTERN.interKeys || {};

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
  const role = await guild.roles.create({ name, color, reason: `Setup LCL: ${reason}` });
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

function normalizeCategoryKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Junta todas as categorias com a mesma chave normalizada no nome exato alvo.
// Ex.: VOZ + FILAS + 🎙️・FILAS -> FILA. Move o que falta; apaga duplicada
// somente se estiver vazia (com historico/gente, avisa p/ acao manual).
async function reconcileCategory(guild, targetName, extraKeys = []) {
  const keys = new Set([normalizeCategoryKey(targetName), ...extraKeys]);
  const sameKey = [...guild.channels.cache.values()].filter(
    (c) => c.type === ChannelType.GuildCategory && keys.has(normalizeCategoryKey(c.name))
  );
  let target = sameKey.find((c) => c.name === targetName) || null;
  const others = sameKey.filter((c) => c !== target);
  if (DRY_RUN) {
    if (!target && others.length) console.log(`   ~ renomearia ${others.map((c) => `"${c.name}"`).join(', ')} -> "${targetName}"`);
    else if (others.length) console.log(`   ~ juntaria ${others.map((c) => `"${c.name}"`).join(', ')} em "${targetName}"`);
    return;
  }
  if (!target) {
    if (!others.length) return;
    target = others.shift();
    await target.edit({ name: targetName }).catch((e) => console.log(`     ⚠ renomear categoria: ${e.message}`));
    console.log(`   ~ categoria renomeada para "${targetName}"`);
  }
  for (const other of others) {
    const children = [...guild.channels.cache.values()].filter(
      (c) => c.parentId === other.id && c.type !== ChannelType.GuildCategory
    );
    for (const ch of children) {
      const dup = [...guild.channels.cache.values()].find(
        (a) => a.parentId === target.id && a.type === ch.type && a.name === ch.name
      );
      if (dup) {
        if (await isChannelEmpty(ch)) {
          await ch.delete('Setup LCL: categoria duplicada').catch(() => null);
          console.log(`   - duplicada "${ch.name}" apagada`);
        } else {
          console.log(`   ! "${ch.name}" existe em "${target.name}" e em "${other.name}" com conteudo — mover manualmente`);
        }
        continue;
      }
      await ch.setParent(target.id, { lockPermissions: false }).catch(() => null);
      console.log(`   → "${ch.name}" movida para "${targetName}"`);
    }
    await guild.channels.fetch().catch(() => null);
    const stillHas = [...guild.channels.cache.values()].some(
      (c) => c.parentId === other.id && c.type !== ChannelType.GuildCategory
    );
    if (!stillHas) {
      await other.delete('Setup LCL: categoria duplicada vazia').catch(() => null);
      console.log(`   - categoria duplicada "${other.name}" apagada`);
    } else {
      console.log(`   ! categoria "${other.name}" mantida (ainda tem canais)`);
    }
  }
  await guild.channels.fetch().catch(() => null);
}

async function isChannelEmpty(channel) {
  try {
    if (channel.type === ChannelType.GuildVoice) return (channel.members?.size || 0) === 0;
    if (typeof channel.isTextBased === 'function' && channel.isTextBased()) {
      const msgs = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      return !msgs || msgs.size === 0;
    }
  } catch { /* na duvida, nao apaga */ }
  return false;
}

async function findChannel(guild, name, categoryId) {
  return guild.channels.cache.find((c) => c.name === name && c.parentId === categoryId && c.type !== ChannelType.GuildCategory) || null;
}

// Permissoes da area VIP: visivel para todos (@everyone ve, mas nao interage);
// acesso total so para membros (Apoiador/VIP/Lendario) e gestores (Admin/Moderador/Staff).
// Puro e testavel: recebe IDs prontos.
function buildVipTextOverwrites({ everyoneId, memberIds = [], managerIds = [] }) {
  return [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
    },
    ...memberIds.filter(Boolean).map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions]
    })),
    ...managerIds.filter(Boolean).map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions, PermissionFlagsBits.ManageMessages]
    }))
  ];
}

function buildVipVoiceOverwrites({ everyoneId, memberIds = [], managerIds = [] }) {
  return [
    {
      id: everyoneId,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
    },
    ...memberIds.filter(Boolean).map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
    })),
    ...managerIds.filter(Boolean).map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers]
    }))
  ];
}

// Sala aberta (visivel p/ todos, leitura; com talk=true, todos podem digitar).
function buildOpenTextOverwrites({ everyoneId, staffId = null, talk = false }) {
  return [
    { id: everyoneId, deny: talk ? [] : [PermissionFlagsBits.SendMessages] },
    ...(staffId ? [{ id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }] : [])
  ];
}

// Sala invisivel p/ quem nao tem acesso (ex.: lobby clandestino p/ nao cadastrados).
// So Jogador/Capitao/Staff veem e usam.
function buildHiddenVoiceOverwrites({ everyoneId, jogId = null, capId = null, staffId = null }) {
  return [
    { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
    ...(jogId ? [{ id: jogId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }] : []),
    ...(capId ? [{ id: capId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] }] : []),
    ...(staffId ? [{ id: staffId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }] : [])
  ];
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
  // Reaquece o cache: cargos recem-criados precisam estar resolviveis para os overwrites.
  await guild.roles.fetch().catch(() => null);

  // Nomes anteriores ao padrão com emoticons: o setup nao apaga cargos sozinho,
  // entao avisa para remocao manual e evita duplicidade funcional.
  for (const legacy of ['Jogador Ativo', 'Capitão', 'Staff', '👑 Capitão de Customs']) {
    const found = guild.roles.cache.find((r) => r.name === legacy);
    if (found) console.log(`   ! cargo legado "${legacy}" ainda existe (${found.id}) — remova manualmente após migrar os membros`);
  }

  const everyone = guild.roles.everyone;
  const get = (name) => roles[name];

  // VIP: visivel p/ todos, acesso de membros (clube) + gestores (Admin/Moderador/Staff).
  const paidVipIds = VIP_ROLE_NAMES.map((name) => get(name)?.id).filter(Boolean);
  const adminRole = guild.roles.cache.find((r) => r.name === '👑 Admin') || null;
  const modRole = guild.roles.cache.find((r) => r.name === '🛠️ Moderador') || null;
  if (!adminRole) console.log('     ⚠ cargo "👑 Admin" nao encontrado — VIP sem ele por enquanto');
  if (!modRole) console.log('     ⚠ cargo "🛠️ Moderador" nao encontrado — VIP sem ele por enquanto');
  const vipManagerIds = [adminRole?.id, modRole?.id, get('🛠️ Staff')?.id].filter(Boolean);

  // Descarta overwrites com ID fora do cache (ex. IDs antigos de outro servidor no config).
  function keepResolvable(overwrites) {
    const ok = [];
    for (const ow of overwrites || []) {
      const id = String(ow?.id || '');
      if (id && (id === everyone.id || guild.roles.cache.has(id))) ok.push(ow);
      else console.warn(`     ⚠ overwrite ignorado (sem cache): ${id || '(vazio)'}`);
    }
    return ok;
  }

  async function createTextOrVoice(kind, name, parentId, overwrites, userLimit = null) {
    const safe = keepResolvable(overwrites);
    const payload = { name, type: kind, parent: parentId, permissionOverwrites: safe };
    if (userLimit && kind === ChannelType.GuildVoice) payload.userLimit = userLimit;
    try {
      return await guild.channels.create(payload);
    } catch (err) {
      console.warn(`     ⚠ create com overwrites falhou (${err.message}), criando sem e aplicando depois`);
      const fallback = { name, type: kind, parent: parentId };
      if (userLimit && kind === ChannelType.GuildVoice) fallback.userLimit = userLimit;
      const channel = await guild.channels.create(fallback);
      await channel.permissionOverwrites.set(safe).catch((e) => console.log(`     ⚠ permissões de #${name}: ${e.message}`));
      return channel;
    }
  }

  // Garante o canal no padrao: reusa (renomeando alias p/ o nome canonico),
  // move de outra categoria, ou cria. Remove duplicada por alias somente se vazia.
  async function ensureChannel({ kind, name, parentId, overwrites, aliases = [], userLimit = null }) {
    const names = [name, ...aliases];
    const matches = (c) => c.type === kind && names.includes(c.name);
    let channel = guild.channels.cache.find((c) => matches(c) && c.parentId === parentId) || null;

    if (channel && channel.name !== name) {
      if (DRY_RUN) console.log(`   ~ renomearia "${channel.name}" -> "${name}"`);
      else {
        await channel.edit({ name }).catch((e) => console.log(`     ⚠ renomear: ${e.message}`));
        console.log(`   ~ "${name}" padronizado`);
      }
    }

    // Duplicadas por alias dentro do pai: apaga so se vazia.
    for (const dup of [...guild.channels.cache.values()].filter((c) => matches(c) && c.parentId === parentId && c.id !== channel?.id)) {
      if (DRY_RUN) {
        console.log(`   ~ apagaria duplicada "${dup.name}" (${dup.id})`);
        continue;
      }
      if (await isChannelEmpty(dup)) {
        await dup.delete('Setup LCL: nome duplicado do padrao').catch(() => null);
        console.log(`   - duplicada "${dup.name}" apagada`);
      } else {
        console.log(`   ! duplicada "${dup.name}" mantida (tem conteudo/gente) — resolver manualmente`);
      }
    }

    if (!channel) {
      const elsewhere = guild.channels.cache.find((c) => matches(c) && c.type !== ChannelType.GuildCategory) || null;
      if (elsewhere) {
        if (DRY_RUN) {
          console.log(`   ~ moveria "${elsewhere.name}" para a categoria correta${elsewhere.name !== name ? ` e renomearia para "${name}"` : ''}`);
          return null;
        }
        await elsewhere.setParent(parentId, { lockPermissions: false }).catch(() => null);
        if (elsewhere.name !== name) await elsewhere.edit({ name }).catch(() => null);
        console.log(`   → "${name}" movida para a categoria correta`);
        channel = elsewhere;
      } else {
        if (DRY_RUN) {
          console.log(`   + criaria "${name}"`);
          return null;
        }
        channel = await createTextOrVoice(kind, name, parentId, overwrites, userLimit);
        console.log(`   + "${name}" criado (${channel.id})`);
      }
    } else {
      console.log(`   ✔ "${name}" já existe (${channel.id})`);
    }

    if (channel && !DRY_RUN) {
      await channel.permissionOverwrites.set(keepResolvable(overwrites)).catch((e) => console.log(`     ⚠ permissões: ${e.message}`));
      if (userLimit && kind === ChannelType.GuildVoice && channel.userLimit !== userLimit) {
        await channel.edit({ userLimit }).catch(() => null);
      }
    }

    // Sobras fora do pai: apaga so se vazia.
    for (const left of [...guild.channels.cache.values()].filter((c) => matches(c) && c.parentId !== parentId && c.id !== channel?.id)) {
      if (DRY_RUN) {
        console.log(`   ~ sobra "${left.name}" fora do lugar (${left.id || 'sem id'})`);
        continue;
      }
      if (await isChannelEmpty(left)) {
        await left.delete('Setup LCL: sobra fora do padrao').catch(() => null);
        console.log(`   - sobra "${left.name}" apagada`);
      } else {
        console.log(`   ! sobra "${left.name}" mantida (tem conteudo) — mover manualmente`);
      }
    }

    return channel;
  }

  // 2. Categorias
  console.log('📁 Categorias (juntando duplicadas no padrao):');
  // FILA absorve VOZ e FILAS/🎙️・FILAS (ver categoryMerges no server-pattern.json).
  for (const targetName of CATEGORIES) {
    await reconcileCategory(guild, targetName, CATEGORY_MERGES[targetName] || []).catch((e) => console.log(`     ⚠ reconciliar ${targetName}: ${e.message}`));
  }
  await guild.channels.fetch().catch(() => null);
  const cats = {};
  for (const name of CATEGORIES) {
    cats[name] = await findOrCreateCategory(guild, name);
    console.log(`   ✔ categoria "${name}"`);
  }

  // 3. Canais de texto (LCL: fila/resultados/ranking/partidas separados)
  console.log('💬 Canais de texto (LCL):');
  const textIds = {};
  for (const spec of TEXT_CHANNELS) {
    const parent = cats[spec.category];
    const vipOverwrites = buildVipTextOverwrites({ everyoneId: everyone.id, memberIds: paidVipIds, managerIds: vipManagerIds });
    const overwrites = spec.vip
      ? vipOverwrites
      : spec.open
      ? buildOpenTextOverwrites({ everyoneId: everyone.id, staffId: get('🛠️ Staff')?.id, talk: Boolean(spec.talk) })
      : [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: get('Jogador').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions], deny: spec.talk ? [] : [PermissionFlagsBits.SendMessages] },
          { id: get('👑 Capitão LCL').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] },
          { id: get('🛠️ Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] }
        ];
    const channel = await ensureChannel({
      kind: ChannelType.GuildText,
      name: spec.name,
      parentId: parent.id,
      overwrites,
      aliases: spec.aliases || []
    });
    if (!channel) continue; // dry-run
    if (spec.configKey) textIds[spec.configKey] = channel.id;
    if (PIN_NOTICES[spec.name] && !DRY_RUN && channel?.send) {
      const pins = await channel.messages.fetchPins().catch(() => null);
      if (!pins || pins.size === 0) {
        const msg = await channel.send(PIN_NOTICES[spec.name]).catch(() => null);
        if (msg) await msg.pin().catch(() => null);
      }
    }
  }

  // 4. Canais de voz (clandestino na FILA, mesma categoria dos bots CAPS)
  console.log('🔊 Canais de voz (LCL):');
  const voiceIds = {};
  for (const spec of VOICE_CHANNELS) {
    const parent = cats[spec.category];
    const specOverwrites = spec.tempVoiceKey
      ? keepResolvable(buildHubOverwrites(guild))
      : spec.vip
      ? buildVipVoiceOverwrites({ everyoneId: everyone.id, memberIds: paidVipIds, managerIds: vipManagerIds })
      : spec.hidden
      ? buildHiddenVoiceOverwrites({ everyoneId: everyone.id, jogId: get('Jogador')?.id, capId: get('👑 Capitão LCL')?.id, staffId: get('🛠️ Staff')?.id })
      : [
      { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
      { id: get('Jogador').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
      { id: get('👑 Capitão LCL').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] },
      { id: get('🛠️ Staff').id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }
    ];
    const channel = await ensureChannel({
      kind: ChannelType.GuildVoice,
      name: spec.name,
      parentId: parent.id,
      overwrites: specOverwrites,
      aliases: spec.aliases || [],
      userLimit: spec.userLimit || null
    });
    if (!channel) continue; // dry-run
    if (spec.configKey) voiceIds[spec.configKey] = channel.id;
  }

  const lclSpec = VOICE_CHANNELS.find((s) => /clandestino/i.test(s.name));
  if (lclSpec) {
    const lclChannel = [...guild.channels.cache.values()].find((c) => c.name === lclSpec.name && c.type === ChannelType.GuildVoice);
    if (lclChannel) console.log(`🔥 Canal LCL: "${lclChannel.name}" (${lclChannel.id}) — !desafiar sai dessa call`);
  }

  // 5. Grava no config.json (com backup) — inclui a seção inter
  if (!DRY_RUN && !SKIP_CONFIG) {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const backupPath = path.join(__dirname, `config.json.bak-${Date.now()}`);
    fs.copyFileSync(configPath, backupPath);
    console.log(`💾 Backup do config atual: ${path.basename(backupPath)}`);
    config.roles = { ...config.roles, registeredPlayerRoleId: roles.Jogador.id, visitanteRoleId: roles.Visitante?.id || config.roles?.visitanteRoleId || '', captainRoleId: roles['👑 Capitão LCL'].id };
    config.voiceChannels = { ...config.voiceChannels, ...voiceIds };
    config.textChannels = { ...config.textChannels, ...textIds };
    // inter aponta p/ os canais LCL (arenaGuildId e pontos preservados)
    const inter = { ...(config.inter || {}) };
    if (INTER_KEYS.inviteChannelId && textIds[INTER_KEYS.inviteChannelId]) inter.inviteChannelId = textIds[INTER_KEYS.inviteChannelId];
    if (INTER_KEYS.announceChannelId && textIds[INTER_KEYS.announceChannelId]) inter.announceChannelId = textIds[INTER_KEYS.announceChannelId];
    if (INTER_KEYS.rankChannelId && textIds[INTER_KEYS.rankChannelId]) inter.rankChannelId = textIds[INTER_KEYS.rankChannelId];
    config.inter = inter;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✔ config.json atualizado com os IDs novos (voz + textos LCL + inter)');
  }

  console.log('\n✅ Setup LCL concluído! Próximos passos:');
  console.log('   1. Confira os cargos: dê "🛠️ Staff" e "👑 Capitão LCL" para quem é da equipe.');
  console.log('   2. Confira o padrão: 🔥・lobby-clandestino LCL na FILA + textos 🔥・LCL separados.');
  console.log('   3. Confira `inter.arenaGuildId` no config.json (não é alterado pelo setup).');
  console.log('   4. Reinicie o bot (pm2 restart lcl-bot --update-env).');
  console.log('   5. Teste: 5 na call clandestina → `!desafiar Time MD1` → match na arena → `!resultado-inter 1 AZUL` → `!inter-ranking`.');
  await client.destroy();
}

module.exports = { PATTERN, ROLES, VIP_ROLE_NAMES, CATEGORIES, CATEGORY_MERGES, TEXT_CHANNELS, VOICE_CHANNELS, PIN_NOTICES, INTER_KEYS, buildVipTextOverwrites, buildVipVoiceOverwrites, buildHiddenVoiceOverwrites, buildOpenTextOverwrites };

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Falha no setup:', err.message);
    process.exit(1);
  });
}
