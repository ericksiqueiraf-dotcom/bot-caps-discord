// One-off: backfill dos anuncios de TOP 1 + cargos dinamicos no canal de conquistas.
// Uso: node scripts/backfill-conquistas.js
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { announceTopOneChanges } = require('../utils/lobbyUtils');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('clientReady', async () => {
  try {
    for (const guild of client.guilds.cache.values()) {
      console.log(`[BACKFILL] Guild: ${guild.name}`);
      await guild.members.fetch().catch(() => null);
      await announceTopOneChanges(guild);
      console.log('[BACKFILL] Concluido.');
    }
  } catch (error) {
    console.error('[BACKFILL] ERRO:', error.message);
  } finally {
    await client.destroy().catch(() => null);
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('[BACKFILL] Falha no login:', error.message);
  process.exit(1);
});
