require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits
} = require('discord.js');

const GUILD_ID = process.argv[2] || '1273653944169660427';
const DRY_RUN = process.argv.includes('--dry-run');
const CAPS_DIR = __dirname;
// LCL mora dentro do repo (lcl-bot/); mantém fallback p/ a pasta antiga externa.
const LCL_DIR = [process.env.LCL_BOT_DIR, path.join(CAPS_DIR, 'lcl-bot'), 'C:\\Users\\ErickSiqueira\\Documents\\LCL BOT'].find((dir) => {
  try { return dir && fs.existsSync(path.join(dir, 'server-pattern.json')); } catch { return false; }
}) || path.join(CAPS_DIR, 'lcl-bot');

const capsPattern = require(path.join(CAPS_DIR, 'server-pattern.json'));
const lclPattern = require(path.join(LCL_DIR, 'server-pattern.json'));

const desiredCategories = [...new Set([...capsPattern.categories, ...lclPattern.categories])];
const categoryMerges = {
  ...(capsPattern.categoryMerges || {}),
  ...(lclPattern.categoryMerges || {})
};

const textSpecs = [
  ...capsPattern.textChannels.map((spec) => ({ ...spec, owner: 'caps' })),
  ...lclPattern.textChannels.map((spec) => ({ ...spec, owner: 'lcl' }))
];

const voiceSpecs = [
  ...capsPattern.voiceChannels.map((spec) => ({
    ...spec,
    owner: 'caps',
    name: spec.name === 'HUB' ? '➕ Criar sala' : spec.name,
    aliases: [
      ...(spec.aliases || []),
      ...(spec.name === '⏳・sala-de-espera' ? ['😶‍🌫️ Sala Classic'] : []),
      ...(spec.name === '⏳・sala-de-espera-tier-s' ? ['😶‍🌫️ Sala de espera - tier S'] : [])
    ]
  })),
  ...lclPattern.voiceChannels.map((spec) => ({ ...spec, owner: 'lcl' }))
];

const roleSpecs = [
  ...capsPattern.roles,
  ...lclPattern.roles
].filter((spec, index, all) => all.findIndex((item) => item.name === spec.name) === index);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonWithBackup(filePath, data) {
  const backupPath = `${filePath}.bak-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return backupPath;
}

async function hasTextContent(channel) {
  if (!channel?.isTextBased?.()) return false;
  const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  return Boolean(messages && messages.size > 0);
}

async function isDeletableWithoutTextLoss(channel) {
  if (channel.type === ChannelType.GuildVoice) return (channel.members?.size || 0) === 0;
  if (channel.type === ChannelType.GuildCategory) {
    return ![...channel.guild.channels.cache.values()].some(
      (item) => item.parentId === channel.id && item.type !== ChannelType.GuildCategory
    );
  }
  if (channel.isTextBased?.()) return !(await hasTextContent(channel));
  return true;
}

async function ensureRole(guild, spec) {
  const existing = guild.roles.cache.find((role) => role.name === spec.name);
  if (existing) {
    if (spec.mentionable && !existing.mentionable && !DRY_RUN) {
      await existing.edit({ mentionable: true }).catch(() => null);
    }
    return existing;
  }
  if (DRY_RUN) {
    console.log(`+ criaria cargo "${spec.name}"`);
    return { id: `(novo-${spec.name})`, name: spec.name };
  }
  const role = await guild.roles.create({
    name: spec.name,
    color: spec.color,
    mentionable: Boolean(spec.mentionable),
    reason: `Organizar CAPS/LCL: ${spec.reason || spec.name}`
  });
  console.log(`+ cargo "${spec.name}" criado (${role.id})`);
  return role;
}

async function reconcileCategory(guild, targetName) {
  const keys = new Set([normalize(targetName), ...((categoryMerges[targetName] || []).map(normalize))]);
  let matches = [...guild.channels.cache.values()].filter(
    (channel) => channel.type === ChannelType.GuildCategory && keys.has(normalize(channel.name))
  );
  let target = matches.find((channel) => channel.name === targetName) || null;
  if (!target && matches.length > 0) {
    target = matches.shift();
    if (DRY_RUN) console.log(`~ renomearia categoria "${target.name}" -> "${targetName}"`);
    else {
      await target.edit({ name: targetName }).catch((error) => console.log(`! categoria "${target.name}": ${error.message}`));
      console.log(`~ categoria renomeada para "${targetName}"`);
    }
  }
  if (!target) {
    if (DRY_RUN) {
      console.log(`+ criaria categoria "${targetName}"`);
      return { id: `(nova-${targetName})`, name: targetName };
    }
    target = await guild.channels.create({ name: targetName, type: ChannelType.GuildCategory });
    console.log(`+ categoria "${targetName}" criada (${target.id})`);
  }

  matches = [...guild.channels.cache.values()].filter(
    (channel) => channel.type === ChannelType.GuildCategory && keys.has(normalize(channel.name)) && channel.id !== target.id
  );
  for (const duplicate of matches) {
    const children = [...guild.channels.cache.values()].filter((channel) => channel.parentId === duplicate.id);
    for (const child of children) {
      const collision = [...guild.channels.cache.values()].find(
        (channel) => channel.parentId === target.id && channel.type === child.type && channel.name === child.name
      );
      if (collision) {
        if (await isDeletableWithoutTextLoss(child)) {
          if (DRY_RUN) console.log(`- apagaria duplicado vazio "${child.name}"`);
          else {
            await child.delete('Organizar CAPS/LCL: duplicado vazio').catch(() => null);
            console.log(`- duplicado vazio "${child.name}" apagado`);
          }
        } else {
          console.log(`! preservado duplicado com conteudo/gente: "${child.name}"`);
        }
        continue;
      }
      if (DRY_RUN) console.log(`~ moveria "${child.name}" para "${targetName}"`);
      else {
        await child.setParent(target.id, { lockPermissions: false }).catch(() => null);
        console.log(`~ "${child.name}" movido para "${targetName}"`);
      }
    }
    if (await isDeletableWithoutTextLoss(duplicate)) {
      if (DRY_RUN) console.log(`- apagaria categoria vazia "${duplicate.name}"`);
      else {
        await duplicate.delete('Organizar CAPS/LCL: categoria duplicada vazia').catch(() => null);
        console.log(`- categoria vazia "${duplicate.name}" apagada`);
      }
    }
  }
  return target;
}

function channelNames(spec) {
  return [spec.name, ...(spec.aliases || [])].filter(Boolean);
}

function findDesiredChannel(guild, spec, type, parentId) {
  const names = channelNames(spec);
  return guild.channels.cache.find((channel) => channel.type === type && names.includes(channel.name) && channel.parentId === parentId)
    || guild.channels.cache.find((channel) => channel.type === type && names.includes(channel.name))
    || null;
}

function basicOverwrites(guild, roles, spec, type) {
  const everyone = guild.roles.everyone;
  const jogador = roles.Jogador;
  const capitao = roles['👑 Capitão LCL'];
  const staff = roles['🛠️ Staff'];
  if (spec.open) {
    return [
      { id: everyone.id, deny: spec.talk ? [] : [PermissionFlagsBits.SendMessages] },
      ...(staff?.id ? [{ id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }] : [])
    ];
  }
  if (spec.vip) {
    const vipIds = (capsPattern.vipRoleNames || []).map((name) => roles[name]?.id).filter(Boolean);
    return [
      { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: type === ChannelType.GuildVoice ? [PermissionFlagsBits.Connect] : [PermissionFlagsBits.SendMessages] },
      ...vipIds.map((id) => ({ id, allow: type === ChannelType.GuildVoice ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
      ...(staff?.id ? [{ id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] }] : [])
    ];
  }
  if (type === ChannelType.GuildVoice) {
    return [
      { id: everyone.id, deny: spec.hidden ? [PermissionFlagsBits.ViewChannel] : [PermissionFlagsBits.Connect] },
      ...(jogador?.id ? [{ id: jogador.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }] : []),
      ...(capitao?.id ? [{ id: capitao.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers] }] : []),
      ...(staff?.id ? [{ id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }] : [])
    ];
  }
  return [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...(jogador?.id ? [{ id: jogador.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions], deny: spec.talk ? [] : [PermissionFlagsBits.SendMessages] }] : []),
    ...(capitao?.id ? [{ id: capitao.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] }] : []),
    ...(staff?.id ? [{ id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions] }] : [])
  ];
}

async function ensureChannel(guild, roles, categories, spec, type) {
  const parent = categories[spec.category];
  const existing = findDesiredChannel(guild, spec, type, parent.id);
  let channel = existing;
  if (!channel) {
    if (DRY_RUN) {
      console.log(`+ criaria ${type === ChannelType.GuildVoice ? 'voz' : 'texto'} "${spec.name}" em "${spec.category}"`);
      return null;
    }
    channel = await guild.channels.create({
      name: spec.name,
      type,
      parent: parent.id,
      userLimit: type === ChannelType.GuildVoice ? spec.userLimit || 0 : undefined,
      permissionOverwrites: basicOverwrites(guild, roles, spec, type)
    });
    console.log(`+ "${spec.name}" criado (${channel.id})`);
  } else {
    if (channel.name !== spec.name) {
      if (DRY_RUN) console.log(`~ renomearia "${channel.name}" -> "${spec.name}"`);
      else {
        await channel.edit({ name: spec.name }).catch((error) => console.log(`! renomear "${channel.name}": ${error.message}`));
        console.log(`~ "${spec.name}" padronizado`);
      }
    }
    if (channel.parentId !== parent.id) {
      if (DRY_RUN) console.log(`~ moveria "${spec.name}" para "${spec.category}"`);
      else {
        await channel.setParent(parent.id, { lockPermissions: false }).catch((error) => console.log(`! mover "${spec.name}": ${error.message}`));
        console.log(`~ "${spec.name}" movido para "${spec.category}"`);
      }
    }
    if (!DRY_RUN && type === ChannelType.GuildVoice && spec.userLimit && channel.userLimit !== spec.userLimit) {
      await channel.edit({ userLimit: spec.userLimit }).catch(() => null);
    }
    console.log(`ok "${spec.name}" (${channel.id})`);
  }
  return channel;
}

async function cleanupExtras(guild, standardIds) {
  console.log('Limpeza de sobras fora do padrao:');
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => channel.type !== ChannelType.GuildCategory)
    .filter((channel) => !standardIds.has(channel.id));

  for (const channel of channels) {
    if (channel.type === ChannelType.GuildVoice) {
      if (await isDeletableWithoutTextLoss(channel)) {
        if (DRY_RUN) console.log(`- apagaria voz fora do padrao "${channel.name}"`);
        else {
          await channel.delete('Organizar CAPS/LCL: voz fora do padrao').catch(() => null);
          console.log(`- voz fora do padrao "${channel.name}" apagada`);
        }
      } else {
        console.log(`! voz fora do padrao preservada por estar ocupada: "${channel.name}"`);
      }
      continue;
    }
    if (channel.isTextBased?.()) {
      if (await isDeletableWithoutTextLoss(channel)) {
        if (DRY_RUN) console.log(`- apagaria texto vazio fora do padrao "${channel.name}"`);
        else {
          await channel.delete('Organizar CAPS/LCL: texto vazio fora do padrao').catch(() => null);
          console.log(`- texto vazio fora do padrao "${channel.name}" apagado`);
        }
      } else {
        console.log(`! texto fora do padrao preservado por ter conteudo: "${channel.name}" (${channel.id})`);
      }
      continue;
    }
    if (DRY_RUN) console.log(`- apagaria canal fora do padrao "${channel.name}"`);
    else {
      await channel.delete('Organizar CAPS/LCL: canal fora do padrao').catch(() => null);
      console.log(`- canal fora do padrao "${channel.name}" apagado`);
    }
  }

  await guild.channels.fetch().catch(() => null);
  for (const category of [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildCategory && !desiredCategories.includes(channel.name))) {
    if (await isDeletableWithoutTextLoss(category)) {
      if (DRY_RUN) console.log(`- apagaria categoria vazia fora do padrao "${category.name}"`);
      else {
        await category.delete('Organizar CAPS/LCL: categoria vazia fora do padrao').catch(() => null);
        console.log(`- categoria vazia fora do padrao "${category.name}" apagada`);
      }
    } else {
      console.log(`! categoria fora do padrao preservada por conter canais: "${category.name}"`);
    }
  }
}

function updateConfigs(ids, roles) {
  if (DRY_RUN) return;
  const capsConfigPath = path.join(CAPS_DIR, 'config.json');
  const caps = readJson(capsConfigPath);
  caps.roles = {
    ...caps.roles,
    registeredPlayerRoleId: roles.Jogador?.id || caps.roles?.registeredPlayerRoleId,
    captainRoleId: roles['👑 Capitão LCL']?.id || caps.roles?.captainRoleId,
    visitanteRoleId: roles.Visitante?.id || caps.roles?.visitanteRoleId || ''
  };
  caps.voiceChannels = { ...caps.voiceChannels, ...ids.capsVoice };
  caps.textChannels = { ...caps.textChannels, ...ids.capsText };
  caps.tempVoice = {
    ...(caps.tempVoice || {}),
    hubChannelId: ids.tempVoice.hubChannelId || caps.tempVoice?.hubChannelId || '',
    userLimit: Number(caps.tempVoice?.userLimit || 10),
    deleteDelaySeconds: Number(caps.tempVoice?.deleteDelaySeconds || 60)
  };
  const capsBackup = writeJsonWithBackup(capsConfigPath, caps);
  console.log(`config CAPS atualizado; backup ${path.basename(capsBackup)}`);

  const lclConfigPath = path.join(LCL_DIR, 'config.json');
  const lcl = readJson(lclConfigPath);
  lcl.roles = {
    ...lcl.roles,
    registeredPlayerRoleId: roles.Jogador?.id || lcl.roles?.registeredPlayerRoleId,
    captainRoleId: roles['👑 Capitão LCL']?.id || lcl.roles?.captainRoleId
  };
  lcl.voiceChannels = { ...lcl.voiceChannels, ...ids.lclVoice };
  lcl.textChannels = { ...lcl.textChannels, ...ids.lclText };
  lcl.inter = {
    ...(lcl.inter || {}),
    arenaGuildId: GUILD_ID,
    inviteChannelId: ids.lclText.matchOngoingChannelId || lcl.inter?.inviteChannelId,
    announceChannelId: ids.lclText.matchOngoingChannelId || lcl.inter?.announceChannelId,
    rankChannelId: ids.lclText.rankUpdatesChannelId || lcl.inter?.rankChannelId
  };
  const lclBackup = writeJsonWithBackup(lclConfigPath, lcl);
  console.log(`config LCL atualizado; backup ${path.basename(lclBackup)}`);
}

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN nao configurado no .env do CAPS');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) throw new Error('Servidor nao encontrado pelo CAPS BOT');
  await guild.roles.fetch();
  await guild.channels.fetch();

  console.log(`Servidor: ${guild.name} (${guild.id})${DRY_RUN ? ' - DRY RUN' : ''}`);

  const roles = {};
  for (const spec of roleSpecs) roles[spec.name] = await ensureRole(guild, spec);
  await guild.roles.fetch().catch(() => null);

  // Nomes anteriores ao padrão com emoticons: nunca apagados automaticamente.
  for (const legacy of ['Jogador Ativo', 'Capitão', 'MVP player', 'INFERNAL', 'Staff', '👑 Capitão de Customs']) {
    const found = guild.roles.cache.find((r) => r.name === legacy);
    if (found) console.log(`! cargo legado "${legacy}" ainda existe (${found.id}) — remova manualmente após migrar os membros`);
  }

  const categories = {};
  for (const categoryName of desiredCategories) {
    categories[categoryName] = await reconcileCategory(guild, categoryName);
  }
  await guild.channels.fetch().catch(() => null);

  const standardIds = new Set(Object.values(categories).map((category) => category.id).filter((id) => !String(id).startsWith('(')));
  const ids = { capsText: {}, capsVoice: {}, lclText: {}, lclVoice: {}, tempVoice: {} };

  for (const spec of textSpecs) {
    const channel = await ensureChannel(guild, roles, categories, spec, ChannelType.GuildText);
    if (!channel) continue;
    standardIds.add(channel.id);
    if (spec.configKey) ids[spec.owner === 'lcl' ? 'lclText' : 'capsText'][spec.configKey] = channel.id;
  }

  for (const spec of voiceSpecs) {
    const channel = await ensureChannel(guild, roles, categories, spec, ChannelType.GuildVoice);
    if (!channel) continue;
    standardIds.add(channel.id);
    if (spec.configKey) ids[spec.owner === 'lcl' ? 'lclVoice' : 'capsVoice'][spec.configKey] = channel.id;
    if (spec.tempVoiceKey) ids.tempVoice[spec.tempVoiceKey] = channel.id;
  }

  await cleanupExtras(guild, standardIds);
  updateConfigs(ids, roles);

  await client.destroy();
}

main().catch((error) => {
  console.error('Falha:', error.message);
  process.exit(1);
});
