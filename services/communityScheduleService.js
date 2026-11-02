const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { getSPParts } = require('./eventoService');
const { findCanaisPorNomes } = require('./socialService');

const WEEKLY_SCHEDULE_CHANNELS = ['📢┃comunicados', '💬・geral-leagueoflegends'];
const SCHEDULE_TITLE = '📅 Agenda de modos semanais';
const LEGACY_SCHEDULE_TITLE = '📅 Programação semanal • CAPS ARENA';
const DAYS = [
  { offset: 0, title: 'SEGUNDA • LIVRE', summary: 'Sem modo fixo; partidas podem ser organizadas espontaneamente.' },
  { offset: 1, title: 'TERÇA • LIVRE', summary: 'Sem modo fixo; partidas podem ser organizadas espontaneamente.' },
  { offset: 2, title: 'QUARTA • CLASSIC', summary: 'Partidas Classic durante o dia todo.' },
  { offset: 3, title: 'QUINTA • CLASSIC', summary: 'Partidas Classic durante o dia todo.' },
  { offset: 4, title: 'SEXTA • DIA COMPETITIVO', summary: 'Classic, Tier S e Duelos durante o dia todo. Use !duelo para desafiar alguém. PDL em dobro no Classic e no Tier S.' },
  { offset: 5, title: 'SÁBADO', summary: 'Torneio se houver edição agendada; caso contrário, Classic, Tier S e Duelos. Use !duelo para desafiar alguém. PDL em dobro no Classic e no Tier S.' },
  { offset: 6, title: 'DOMINGO', summary: 'Torneio se houver edição agendada; caso contrário, Classic, Tier S e Duelos. Use !duelo para desafiar alguém. PDL em dobro no Classic e no Tier S.' }
];

function getMondayKey(nowMs = Date.now()) {
  const { key } = getSPParts(nowMs);
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function weeklyScheduleSlot(nowMs = Date.now()) {
  // Uma divulgação por dia no horário configurado; o embed mostra a semana atual.
  return getSPParts(nowMs).key;
}

function formatScheduleDate(mondayKey, offset) {
  const date = new Date(`${mondayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit'
  }).format(date);
}

function getWeeklyScheduleState(meta = {}, weekKey = getMondayKey()) {
  const previous = meta.communitySchedule;
  if (previous?.weekKey === weekKey) {
    return {
      weekKey,
      posts: { ...(previous.posts || {}) },
      dedupeCheckedAt: { ...(previous.dedupeCheckedAt || {}) },
      uiVersion: previous.uiVersion || 0
    };
  }
  return { weekKey, posts: {}, dedupeCheckedAt: {}, uiVersion: 0 };
}

function buildWeeklyScheduleEmbed(weekKey = getMondayKey()) {
  const embed = new EmbedBuilder()
    .setColor('#C9A227')
    .setTitle(SCHEDULE_TITLE)
    .setDescription(
      `Confira a programação da semana de **${formatScheduleDate(weekKey, 0)} a ${formatScheduleDate(weekKey, 6)}**.\n` +
      'Chame a galera nos canais de voz e acompanhe os anúncios de torneio.'
    );

  for (const day of DAYS) {
    embed.addFields({
      name: `${day.title} • ${formatScheduleDate(weekKey, day.offset)}`,
      value: day.summary,
      inline: false
    });
  }

  return embed
    .setFooter({ text: 'Classic: conecte-se ao Lobby Classic e use !entrar. Duelos: use !duelo para desafiar alguém.' })
    .setTimestamp();
}

function buildWeeklySchedulePayload(weekKey = getMondayKey()) {
  return {
    content: '📣 **Agenda de modos semanais da CAPS ARENA**',
    embeds: [buildWeeklyScheduleEmbed(weekKey)],
    components: []
  };
}

function sameWeekScheduleMessage(message, weekKey, botUserId) {
  if (String(message?.author?.id || '') !== String(botUserId || '')) return false;
  const embed = message.embeds?.find((item) => [SCHEDULE_TITLE, LEGACY_SCHEDULE_TITLE].includes(item.title));
  if (!embed) return false;
  const expected = `**${formatScheduleDate(weekKey, 0)} a ${formatScheduleDate(weekKey, 6)}**`;
  return String(embed.description || '').includes(expected);
}

async function findAndDedupeWeeklyMessage(channel, weekKey, botUserId, preferredMessageId = null) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const matches = [...messages.values()].filter((message) => sameWeekScheduleMessage(message, weekKey, botUserId));
  if (!matches.length) return null;
  const keep = matches.find((message) => String(message.id) === String(preferredMessageId))
    || matches.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0))[0];
  for (const duplicate of matches) {
    if (duplicate.id === keep.id) continue;
    await duplicate.delete()
      .then(() => console.log(`[AGENDA] Duplicata removida em #${channel.name}: ${duplicate.id}`))
      .catch((error) => console.error(`[AGENDA] Não foi possível remover duplicata ${duplicate.id}:`, error.message));
  }
  return keep;
}

async function runWeeklyScheduleTick(nowMs = Date.now(), deps = {}) {
  const {
    withQueueOperationLock = require('./dataService').withQueueOperationLock,
    loadSystemMeta = require('./dataService').loadSystemMeta,
    saveSystemMeta = require('./dataService').saveSystemMeta,
    guilds = global.discordClient?.guilds?.cache?.values?.() || [],
    cfg = config
  } = deps;
  const dailyKey = weeklyScheduleSlot(nowMs);
  const sp = getSPParts(nowMs);
  const targetHour = Number(cfg?.social?.agendaHour ?? 8);
  if (Math.floor(sp.minutes / 60) !== targetHour) return { posted: 0, reason: 'fora do horário diário' };
  const weekKey = getMondayKey(nowMs);

  return withQueueOperationLock('evento:systemMeta', async () => {
    const meta = (await loadSystemMeta()) || {};
    const state = getWeeklyScheduleState(meta, weekKey);
    if (state.dailySlot === dailyKey) return { posted: 0, reason: 'agenda já divulgada hoje' };
    const dailyRefresh = state.dailySlot !== dailyKey;
    const payload = buildWeeklySchedulePayload(weekKey);
    const now = Number(nowMs);
    let posted = 0;
    let changed = state.uiVersion !== 4 || meta.communitySchedule?.weekKey !== weekKey;

    for (const guild of guilds) {
      for (const channel of findCanaisPorNomes(guild, WEEKLY_SCHEDULE_CHANNELS)) {
        const channelId = String(channel.id);
        const priorPost = state.posts[channelId];
        const checkedAt = Number(state.dedupeCheckedAt[channelId] || 0);
        let existing = null;

        if (state.uiVersion !== 4 || now - checkedAt >= 5 * 60 * 1000) {
          try {
            existing = await findAndDedupeWeeklyMessage(
              channel,
              weekKey,
              guild.client?.user?.id || global.discordClient?.user?.id,
              priorPost?.messageId
            );
          } catch (error) {
            console.error(`[AGENDA] Não foi possível verificar duplicatas em ${channelId}:`, error.message);
          }
          state.dedupeCheckedAt[channelId] = now;
          changed = true;
        }

        if (existing) {
          state.posts[channelId] = { guildId: guild.id, channelId, messageId: existing.id };
          if (state.uiVersion !== 4 || existing.id !== priorPost?.messageId || dailyRefresh) {
            await existing.edit(payload);
            changed = true;
          }
          continue;
        }

        if (priorPost?.messageId) {
          if (state.uiVersion !== 4 || dailyRefresh) {
            try {
              const previousMessage = await channel.messages.fetch(priorPost.messageId);
              await previousMessage.edit(payload);
              changed = true;
            } catch (error) {
              console.error(`[AGENDA] Não foi possível atualizar ${priorPost.messageId}:`, error.message);
            }
          }
          continue;
        }

        try {
          const message = await channel.send(payload);
          state.posts[channelId] = { guildId: guild.id, channelId, messageId: message.id };
          posted += 1;
          changed = true;
        } catch (error) {
          console.error(`[AGENDA] Não foi possível publicar em ${channelId}:`, error.message);
        }
      }
    }

    state.uiVersion = 4;
    if (posted || Object.keys(state.posts).length) {
      state.dailySlot = dailyKey;
      changed = true;
    }
    if (changed) {
      meta.communitySchedule = state;
      await saveSystemMeta(meta);
    }
    if (posted) console.log(`[AGENDA] Agenda de modos semanais publicada em ${posted} canal(is) (${weekKey}).`);
    return { posted, weekKey };
  });
}

module.exports = {
  WEEKLY_SCHEDULE_CHANNELS,
  SCHEDULE_TITLE,
  DAYS,
  getMondayKey,
  weeklyScheduleSlot,
  formatScheduleDate,
  getWeeklyScheduleState,
  buildWeeklyScheduleEmbed,
  buildWeeklySchedulePayload,
  sameWeekScheduleMessage,
  findAndDedupeWeeklyMessage,
  runWeeklyScheduleTick
};
