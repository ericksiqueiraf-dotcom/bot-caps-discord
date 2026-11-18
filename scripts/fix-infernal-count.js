// Recalcula o infernalCount de cada jogador a partir dos logs individuais (#meu-log),
// aplicando a regra: 1 conquista INFERNAL a cada 5 vitorias consecutivas (marco 5, 10, 15...).
// Corrige contadores inflados da regra antiga (1 por dia de selo).
//
// Uso: node scripts/fix-infernal-count.js [--aplicar]
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config.json');
const dataService = require('../services/dataService');

const APPLY = process.argv.includes('--aplicar');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function fetchAllMessages(channel, maxPages = 8) {
  const collected = [];
  let before = null;
  for (let page = 0; page < maxPages; page += 1) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch || batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return collected;
}

async function main() {
  console.log(`[INFERNAL-FIX] Modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (use --aplicar para gravar)'}`);
  await new Promise((resolve) => client.once('clientReady', resolve));
  const guild = client.guilds.cache.first();

  const seasonMeta = await dataService.loadSeasonMeta();
  const seasonStart = Date.parse(seasonMeta.startedAt);
  console.log(`[INFERNAL-FIX] Temporada iniciada em: ${seasonMeta.startedAt}`);

  const logChannel = await guild.channels.fetch(config.textChannels.playerLogChannelId).catch(() => null);
  if (!logChannel) throw new Error('Canal de log individual nao encontrado.');

  // discordId -> [{ timestamp, mode, streak }]
  const logsByPlayer = new Map();
  for (const message of await fetchAllMessages(logChannel)) {
    const embed = message.embeds?.[0];
    if (!embed || !String(embed.title || '').includes('Log de Partida')) continue;
    const fields = Object.fromEntries((embed.fields || []).map((f) => [f.name, f.value]));
    const discordId = (String(embed.description || '').match(/<@(\d+)>/) || [])[1];
    const stamp = Date.parse(embed.timestamp || message.createdTimestamp);
    const streak = Number(String(fields['🔥 Streak'] || '').replace(/[^\d-]/g, ''));
    if (!discordId || !Number.isFinite(stamp) || !Number.isFinite(streak)) continue;
    if (stamp < seasonStart) continue; // so a temporada atual conta

    if (!logsByPlayer.has(discordId)) logsByPlayer.set(discordId, []);
    logsByPlayer.get(discordId).push({ timestamp: stamp, mode: String(fields.Modo || '?'), streak });
  }

  const statsData = await dataService.loadPlayerStats();
  let changed = 0;
  for (const player of Object.values(statsData.players || {})) {
    const currentCount = Number(player.infernalCount || 0);
    if (currentCount <= 0) continue;

    const entries = (logsByPlayer.get(player.discordId) || []).sort((a, b) => a.timestamp - b.timestamp);

    // Marcos por modo (streak e independente por modo): conta cada entrada com streak % 5 == 0.
    const milestones = entries.filter((e) => e.streak > 0 && e.streak % 5 === 0);
    const lastMilestone = milestones.length > 0 ? milestones[milestones.length - 1].streak : 0;

    // Validade do selo: proxima 08h SP apos o ultimo marco; se ja passou, o selo esta vencido.
    let inferredExpiresAt = null;
    if (milestones.length > 0) {
      const lastStamp = milestones[milestones.length - 1].timestamp;
      const expiry = new Date(lastStamp);
      // 08h SP = 11:00Z
      expiry.setUTCHours(11, 0, 0, 0);
      if (expiry.getTime() <= lastStamp) expiry.setUTCDate(expiry.getUTCDate() + 1);
      inferredExpiresAt = expiry.toISOString();
    }

    const newCount = milestones.length;
    if (newCount === currentCount && (player.infernalLastMilestone || 0) === lastMilestone) {
      console.log(`  = ${player.registeredNickname || player.nickname}: ${currentCount}x (ja correto)`);
      continue;
    }

    console.log(
      `  ~ ${player.registeredNickname || player.nickname} (${player.discordId}): ${currentCount}x -> ${newCount}x` +
      ` | streaks marco: [${milestones.map((m) => `${m.mode} ${m.streak}`).join(', ')}]` +
      ` | ultimo marco: ${lastMilestone} | selo: ${inferredExpiresAt}`
    );

    if (APPLY) {
      player.infernalCount = newCount;
      player.infernalLastMilestone = lastMilestone;
      if (inferredExpiresAt) player.infernalExpiresAt = inferredExpiresAt;
      else delete player.infernalExpiresAt;
      changed += 1;
    }
  }

  if (APPLY) {
    await dataService.savePlayerStats(statsData);
    console.log(`[INFERNAL-FIX] ${changed} jogador(es) corrigido(s).`);
    const { announceTopOneChanges } = require('../utils/lobbyUtils');
    await announceTopOneChanges(guild);
    console.log('[INFERNAL-FIX] TOP 1 re-sincronizado no #conquistas.');
  } else {
    console.log('[INFERNAL-FIX] DRY-RUN concluido. Rode com --aplicar para gravar.');
  }

  process.exit(0);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('[INFERNAL-FIX] Falha no login:', error.message);
  process.exit(1);
});

main().catch((error) => {
  console.error('[INFERNAL-FIX] ERRO:', error);
  process.exit(1);
});
