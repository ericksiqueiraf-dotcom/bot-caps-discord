// Rollback das vitorias registradas por engano (bug da sala A obsoleta em 17/11).
// Le o #historico-partidas + #meu-log, reconstrui o estado anterior de cada jogador
// afetado (MMR, W/L, streak) e desfaz os creditos.
//
// Uso:
//   node scripts/rollback-vitoria-errada.js              -> DRY-RUN (so mostra o plano)
//   node scripts/rollback-vitoria-errada.js --aplicar    -> grava no banco e re-sincroniza TOP 1
//
// Cutoff: tudo registrado no Lobby A (classic) DEPOIS do inicio da partida real
// (2026-11-17T21:23:01.839Z) e falso, pois a partida real nunca foi resolvida.
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config.json');
const dataService = require('../services/dataService');

const REAL_MATCH_STARTED_AT = '2026-11-17T21:23:01.839Z';
const CUTOFF_MS = Date.parse(REAL_MATCH_STARTED_AT);
const APPLY = process.argv.includes('--aplicar');

const ENTRY_REGEX = /<@(\d+)> \| `([^`]+)`[\s\S]*?Antes: `(-?\d+)` \| Depois: `(-?\d+)`[\s\S]*?Antes W\/L: `(\d+)V \/ (\d+)D` \| Depois W\/L: `(\d+)V \/ (\d+)D`[\s\S]*?Resultado: `(Vitoria|Derrota)`/g;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function parseHistoryMessage(message) {
  const summary = message.embeds?.[0];
  const detail = message.embeds?.[1];
  if (!summary || !detail) return null;
  if (!String(summary.title || '').includes('Histórico de Partida')) return null;

  const description = String(summary.description || '');
  if (!description.includes('Lobby **A**') || !description.toUpperCase().includes('CLASSIC')) return null;

  const timestamp = Date.parse(summary.timestamp || message.createdTimestamp);
  if (!Number.isFinite(timestamp) || timestamp < CUTOFF_MS) return null;

  const winnerTeam = (description.match(/Vencedor: \*\*Equipe (\d)\*\*/) || [])[1] || '?';
  const entries = [];
  for (const field of detail.fields || []) {
    const isWinnerField = /Vencedores/.test(field.name);
    let match;
    ENTRY_REGEX.lastIndex = 0;
    while ((match = ENTRY_REGEX.exec(field.value)) !== null) {
      entries.push({
        discordId: match[1],
        nickname: match[2],
        beforeRank: Number(match[3]),
        afterRank: Number(match[4]),
        beforeWins: Number(match[5]),
        beforeLosses: Number(match[6]),
        afterWins: Number(match[7]),
        afterLosses: Number(match[8]),
        result: match[9] === 'Vitoria' ? 'win' : 'loss',
        isWinnerField,
        timestamp,
        messageId: message.id
      });
    }
  }

  return { messageId: message.id, timestamp, winnerTeam, entries };
}

function parsePlayerLogMessage(message) {
  const embed = message.embeds?.[0];
  if (!embed || !String(embed.title || '').includes('Log de Partida')) return null;
  const fields = Object.fromEntries((embed.fields || []).map((f) => [f.name, f.value]));
  if (!/`A`/.test(fields.Lobby || '')) return null;
  if (!String(fields.Modo || '').toUpperCase().includes('CLASSIC')) return null;

  const stamp = Date.parse(embed.timestamp || message.createdTimestamp);
  const idMatch = String(embed.description || '').match(/<@(\d+)>/);
  if (!Number.isFinite(stamp) || !idMatch) return null;

  return {
    discordId: idMatch[1],
    timestamp: stamp,
    streak: Number(String(fields['🔥 Streak'] || '').replace(/[^\d-]/g, '')) || 0,
    afterWins: Number(String(fields['Recorde W/D'] || '').match(/(\d+)V/)?.[1]),
    afterLosses: Number(String(fields['Recorde W/D'] || '').match(/(\d+)D/)?.[1]),
    beforeMmr: Number(fields['MMR Antes']),
    afterMmr: Number(fields['MMR Depois'])
  };
}

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

function buildPlan(historyEntries, playerLogs) {
  const byPlayer = new Map();
  for (const entry of historyEntries) {
    if (!byPlayer.has(entry.discordId)) byPlayer.set(entry.discordId, []);
    byPlayer.get(entry.discordId).push(entry);
  }

  const plan = [];
  for (const [discordId, entries] of byPlayer) {
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const first = entries[0]; // estado "Antes" do primeiro registro falso = estado verdadeiro
    const last = entries[entries.length - 1];

    // Streak verdadeira: ultimo log legitimo do jogador ANTES do cutoff.
    const lastLegitLog = playerLogs
      .filter((log) => log.discordId === discordId && log.timestamp < CUTOFF_MS)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const restoredStreak = lastLegitLog ? lastLegitLog.streak : 0;

    // Detecta atividade externa suspeita entre os registros falsos (buracos na cadeia Antes/Depois).
    let chainBreaks = 0;
    for (let i = 1; i < entries.length; i += 1) {
      const prev = entries[i - 1];
      const cur = entries[i];
      if (prev.afterRank !== cur.beforeRank || prev.afterWins !== cur.beforeWins || prev.afterLosses !== cur.beforeLosses) {
        chainBreaks += 1;
      }
    }

    plan.push({
      discordId,
      nickname: first.nickname,
      registrations: entries.length,
      results: entries.map((e) => e.result).join('+'),
      current: { rank: last.afterRank, wins: last.afterWins, losses: last.afterLosses },
      target: { rank: first.beforeRank, wins: first.beforeWins, losses: first.beforeLosses, streak: restoredStreak },
      chainBreaks,
      firstMessageId: first.messageId,
      lastTimestamp: last.timestamp
    });
  }

  return plan;
}

async function main() {
  console.log(`[ROLLBACK] Modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (use --aplicar para gravar)'}`);
  await new Promise((resolve) => client.once('clientReady', resolve));

  const guild = client.guilds.cache.first();
  if (!guild) throw new Error('Guild nao encontrada.');

  const historyChannel = await guild.channels.fetch(config.textChannels.matchHistoryChannelId).catch(() => null);
  const playerLogChannel = await guild.channels.fetch(config.textChannels.playerLogChannelId).catch(() => null);
  if (!historyChannel) throw new Error('Canal de historico nao encontrado.');

  const historyMessages = await fetchAllMessages(historyChannel);
  const bogusMatches = historyMessages
    .map(parseHistoryMessage)
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[ROLLBACK] Registros falsos encontrados no Lobby A (classic): ${bogusMatches.length}`);
  for (const match of bogusMatches) {
    console.log(`  - msg ${match.messageId} | ${new Date(match.timestamp).toISOString()} | vencedor: Equipe ${match.winnerTeam} | ${match.entries.length} jogadores`);
  }

  const playerLogs = playerLogChannel
    ? (await fetchAllMessages(playerLogChannel)).map(parsePlayerLogMessage).filter(Boolean)
    : [];

  const allEntries = bogusMatches.flatMap((match) => match.entries);
  if (allEntries.length === 0) {
    console.log('[ROLLBACK] Nada a fazer.');
    process.exit(0);
  }

  const plan = buildPlan(allEntries, playerLogs);

  console.log('\n[ROLLBACK] Plano por jogador:');
  for (const item of plan) {
    console.log(
      `  ${item.nickname} (${item.discordId})\n` +
      `    ${item.registrations} registro(s) falso(s) [${item.results}]` +
      `${item.chainBreaks ? ` | ⚠️ ${item.chainBreaks} quebra(s) na cadeia Antes/Depois (atividade externa?)` : ''}\n` +
      `    MMR: ${item.current.rank} -> ${item.target.rank} | W/L: ${item.current.wins}V/${item.current.losses}D -> ${item.target.wins}V/${item.target.losses}D | Streak -> ${item.target.streak}`
    );
  }

  if (!APPLY) {
    console.log('\n[ROLLBACK] DRY-RUN concluido. Revise o plano acima e rode com --aplicar para gravar.');
    process.exit(0);
  }

  const statsData = await dataService.loadPlayerStats();
  let applied = 0;
  for (const item of plan) {
    const stored = Object.values(statsData.players || {}).find((entry) => entry.discordId === item.discordId);
    if (!stored) {
      console.warn(`  ⚠️ ${item.nickname}: sem stats no banco, pulando.`);
      continue;
    }
    stored.modes = stored.modes || {};
    stored.modes.classic = stored.modes.classic || {};
    stored.modes.classic.internalRating = item.target.rank;
    stored.modes.classic.customWins = item.target.wins;
    stored.modes.classic.customLosses = item.target.losses;
    stored.modes.classic.winStreak = item.target.streak;
    // Espelha campos legados no topo (mesma semantica do upsertPlayerStats)
    stored.customWins = item.target.wins;
    stored.customLosses = item.target.losses;
    stored.internalRating = item.target.rank;
    applied += 1;
    console.log(`  ✔ ${item.nickname}: restaurado.`);
  }

  await dataService.savePlayerStats(statsData);
  console.log(`\n[ROLLBACK] ${applied}/${plan.length} jogadores restaurados no banco.`);

  // Re-sincroniza cargos TOP 1 (streaks/leaders mudaram com o rollback).
  const { announceTopOneChanges } = require('../utils/lobbyUtils');
  await announceTopOneChanges(guild);
  console.log('[ROLLBACK] TOP 1 re-sincronizado no #conquistas.');

  process.exit(0);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('[ROLLBACK] Falha no login:', error.message);
  process.exit(1);
});

main().catch((error) => {
  console.error('[ROLLBACK] ERRO:', error);
  process.exit(1);
});
