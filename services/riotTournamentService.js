const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const {
  loadSystemMeta,
  saveSystemMeta,
  loadRiotTournamentCallbacks,
  saveRiotTournamentCallbacks,
  loadRiotTournamentMatches,
  saveRiotTournamentMatches,
  withQueueOperationLock
} = require('./dataService');

const PLATFORM_REGION = { br1: 'BR', la1: 'LAN', la2: 'LAS', na1: 'NA', euw1: 'EUW', eun1: 'EUNE', kr: 'KR', jp1: 'JP', oc1: 'OCE', tr1: 'TR', ru: 'RU' };
const REGIONAL_ROUTE = { br1: 'americas', la1: 'americas', la2: 'americas', na1: 'americas', euw1: 'europe', eun1: 'europe', kr: 'asia', jp1: 'asia', oc1: 'sea', tr1: 'europe', ru: 'europe' };

function createRiotTournamentService({ apiKey, region = 'br1', publicBaseUrl } = {}) {
  const platform = String(region || 'br1').toLowerCase();
  const tournamentRegion = PLATFORM_REGION[platform];
  const regionalRoute = REGIONAL_ROUTE[platform];
  const baseUrl = String(publicBaseUrl || '').replace(/\/+$/, '');
  const enabled = Boolean(apiKey && tournamentRegion && regionalRoute && /^https:\/\//i.test(baseUrl));
  const tournamentApi = axios.create({
    baseURL: `https://${platform}.api.riotgames.com`,
    headers: { 'X-Riot-Token': apiKey || '' },
    timeout: 12000
  });
  const matchApi = axios.create({
    baseURL: `https://${regionalRoute || 'americas'}.api.riotgames.com`,
    headers: { 'X-Riot-Token': apiKey || '' },
    timeout: 12000
  });

  async function ensureTournament() {
    return withQueueOperationLock('riot:tournament-meta', async () => {
      const meta = await loadSystemMeta();
      meta.riotTournament ||= {};
      const tournament = meta.riotTournament;
      if (tournament.providerId && tournament.tournamentId) return tournament;

      if (!tournament.providerId) {
        const provider = await tournamentApi.post('/lol/tournament/v5/providers', {
          region: tournamentRegion,
          url: `${baseUrl}/webhooks/riot-tournament`
        });
        tournament.providerId = Number(provider.data);
        meta.riotTournament = tournament;
        await saveSystemMeta(meta);
      }

      if (!tournament.tournamentId) {
        const created = await tournamentApi.post('/lol/tournament/v5/tournaments', {
          name: `CAPS ARENA Classic ${new Date().toISOString().slice(0, 10)}`,
          providerId: tournament.providerId
        });
        tournament.tournamentId = Number(created.data);
      }

      tournament.region = platform;
      tournament.updatedAt = new Date().toISOString();
      meta.riotTournament = tournament;
      await saveSystemMeta(meta);
      return tournament;
    });
  }

  async function createTournamentCode({ guildId, lobbyId }) {
    if (!enabled) return { ok: false, reason: 'setup_incompleto' };
    try {
      const tournament = await ensureTournament();
      const callbackToken = require('crypto').randomBytes(16).toString('hex');
      const metadata = JSON.stringify({ g: guildId, l: lobbyId, t: callbackToken });
      const response = await tournamentApi.post('/lol/tournament/v5/codes', {
        mapType: 'SUMMONERS_RIFT',
        metadata,
        pickType: 'TOURNAMENT_DRAFT',
        spectatorType: 'ALL',
        teamSize: 5
      }, { params: { count: 1, tournamentId: tournament.tournamentId } });
      const result = Array.isArray(response.data) ? response.data[0] : null;
      const code = typeof result === 'string' ? result : result?.code;
      if (!code) return { ok: false, reason: 'codigo_ausente' };
      return { ok: true, code, callbackToken, metadata, tournamentCodeInfo: result };
    } catch (error) {
      console.error('[RIOT TOURNAMENT] Não foi possível criar código:', error.response?.data || error.message);
      return { ok: false, reason: error.response?.status === 403 ? 'sem_acesso' : 'erro_api' };
    }
  }

  async function acceptCallback(payload) {
    if (!payload || !payload.metaData || !payload.gameId || !payload.region) return { accepted: false, status: 400 };
    let metadata;
    try { metadata = JSON.parse(payload.metaData); } catch { return { accepted: false, status: 400 }; }
    if (!metadata.t || !metadata.g || !metadata.l) return { accepted: false, status: 400 };
    const savedMatches = await loadRiotTournamentMatches();
    const entry = savedMatches.matches.find((item) => item.lobbyId === metadata.l && item.guildId === metadata.g);
    if (!entry || entry.callbackToken !== metadata.t) {
      return { accepted: false, status: 401 };
    }

    return withQueueOperationLock('riot:tournament-callbacks', async () => {
      const queue = await loadRiotTournamentCallbacks();
      const id = `${payload.region}_${payload.gameId}`;
      if (!queue.callbacks.some((item) => item.id === id)) {
        queue.callbacks.push({
          id,
          gameId: String(payload.gameId),
          region: String(payload.region).toLowerCase(),
          guildId: metadata.g,
          lobbyId: metadata.l,
          callbackReceivedAt: new Date().toISOString(),
          status: 'pending',
          attempts: 0
        });
        await saveRiotTournamentCallbacks(queue);
      }
      return { accepted: true, status: 200 };
    });
  }

  function participantRows(game, match) {
    const consent = game.consent || {};
    const participants = match.info?.participants || [];
    return participants.filter((p) => p.puuid && consent[p.puuid]).map((p) => ({
      discordId: consent[p.puuid].discordId,
      riotId: p.riotIdGameName && p.riotIdTagline ? `${p.riotIdGameName}#${p.riotIdTagline}` : p.summonerName || 'Jogador',
      champion: p.championName || '—',
      kills: Number(p.kills || 0),
      deaths: Number(p.deaths || 0),
      assists: Number(p.assists || 0),
      cs: Number(p.totalMinionsKilled || 0) + Number(p.neutralMinionsKilled || 0),
      gold: Number(p.goldEarned || 0),
      win: Boolean(p.win)
    }));
  }

  async function postStats(client, callback, game, match) {
    const rows = participantRows(game, match);
    if (!rows.length) return true;
    const guild = await client.guilds.fetch(callback.guildId).catch(() => null);
    const channelId = require('../config.json').textChannels?.matchHistoryChannelId;
    const channel = guild && channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased?.()) return false;

    const info = match.info || {};
    const teams = info.teams || [];
    const optedInCount = Object.keys(game.consent || {}).length;
    const allPlayersConsented = optedInCount === 10;
    const objectiveSummary = allPlayersConsented ? teams.map((team, index) => {
      const obj = team.objectives || {};
      const count = (key) => Number(obj[key]?.kills || 0);
      return `**Time ${index + 1}:** ${count('dragon')} dragões • ${count('baron')} barões • ${count('tower')} torres`;
    }).join('\n') : '';
    const embed = new EmbedBuilder()
      .setColor('#c99a2e')
      .setTitle('📊 Estatísticas Classic compartilhadas')
      .setDescription(`${objectiveSummary ? `${objectiveSummary}\n\n` : ''}MVP continua sendo definido pela votação no Discord.`)
      .setFooter({ text: 'Aparecem somente jogadores que ativaram o compartilhamento.' })
      .setTimestamp(new Date(callback.callbackReceivedAt));
    const chunks = [];
    for (let i = 0; i < rows.length; i += 5) chunks.push(rows.slice(i, i + 5));
    chunks.forEach((chunk, index) => embed.addFields({
      name: index === 0 ? 'Jogadores com compartilhamento ativo' : 'Jogadores (continuação)',
      value: chunk.map((p) => `**${p.riotId}**${p.discordId ? ` (<@${p.discordId}>)` : ''} • ${p.champion}\n${p.kills}/${p.deaths}/${p.assists} K/D/A • ${p.cs} CS • ${p.gold.toLocaleString('pt-BR')} ouro`).join('\n\n'),
      inline: false
    }));
    await channel.send({ embeds: [embed] });
    return true;
  }

  async function processCallbacks(client) {
    if (!apiKey) return;
    return withQueueOperationLock('riot:tournament-callbacks', async () => {
      const queue = await loadRiotTournamentCallbacks();
      let dirty = false;
      for (const callback of queue.callbacks.filter((item) => item.status === 'pending').slice(0, 3)) {
        const tournamentMatches = await loadRiotTournamentMatches();
        const matchEntry = tournamentMatches.matches.find((item) => item.lobbyId === callback.lobbyId && item.guildId === callback.guildId);
        if (!matchEntry) {
          callback.status = 'unavailable';
          callback.finishedAt = new Date().toISOString();
          dirty = true;
          continue;
        }
        const allPlayers = [...(matchEntry.teamOne || []), ...(matchEntry.teamTwo || [])];
        const consentMeta = await loadSystemMeta();
        const optedIn = consentMeta.riotStatsConsent || {};
        const consent = {};
        for (const player of allPlayers) {
          if (player.puuid && optedIn[player.discordId]) consent[player.puuid] = { discordId: player.discordId };
        }
        try {
          const matchId = `${callback.region.toUpperCase()}_${callback.gameId}`;
          const response = await matchApi.get(`/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
          await postStats(client, { ...callback, consent }, matchEntry, response.data);
          callback.status = 'reported';
          callback.reportedAt = new Date().toISOString();
          tournamentMatches.matches = tournamentMatches.matches.filter((item) => item.lobbyId !== callback.lobbyId);
          await saveRiotTournamentMatches(tournamentMatches);
          dirty = true;
        } catch (error) {
          callback.attempts = Number(callback.attempts || 0) + 1;
          callback.lastErrorStatus = error.response?.status || null;
          callback.lastAttemptAt = new Date().toISOString();
          if (Date.now() - new Date(callback.callbackReceivedAt).getTime() > 30 * 60 * 1000 || callback.attempts >= 8) {
            callback.status = 'unavailable';
            const guild = await client.guilds.fetch(callback.guildId).catch(() => null);
            const channelId = require('../config.json').textChannels?.matchHistoryChannelId;
            const channel = guild && channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
            if (channel?.isTextBased?.()) await channel.send(`⚠️ A Riot não disponibilizou as estatísticas da partida \`${callback.id}\`. A votação de vitória e MVP continua normal.`).catch(() => null);
            const tournamentMatches = await loadRiotTournamentMatches();
            tournamentMatches.matches = tournamentMatches.matches.filter((item) => item.lobbyId !== callback.lobbyId);
            await saveRiotTournamentMatches(tournamentMatches);
          }
          dirty = true;
          // 404 pode ser indisponibilidade temporária; não repetir rapidamente.
          break;
        }
      }
      if (dirty) {
        queue.callbacks = queue.callbacks.slice(-200);
        await saveRiotTournamentCallbacks(queue);
      }
    });
  }

  return { enabled, createTournamentCode, acceptCallback, processCallbacks };
}

module.exports = { createRiotTournamentService };
