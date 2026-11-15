const axios = require('axios');

const DEFAULT_REGION = 'br1';
const REGIONAL_ROUTING = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  oc1: 'sea',
  jp1: 'asia',
  kr: 'asia',
  eun1: 'europe',
  euw1: 'europe',
  tr1: 'europe',
  ru: 'europe'
};

const TIER_BASE_MMR = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 3200,
  CHALLENGER: 3600
};

const RANK_STEP = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300
};

// Cache em memória: { [puuid]: { data, expiresAt } }
const rankProfileCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

function getCachedProfile(puuid) {
  const entry = rankProfileCache.get(puuid);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rankProfileCache.delete(puuid);
    return null;
  }
  return entry.data;
}

function setCachedProfile(puuid, data) {
  rankProfileCache.set(puuid, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ===== Insights de partidas (dados usados no !perfil) =====
const matchInsightsCache = new Map();
const MATCH_INSIGHTS_TTL_MS = 30 * 60 * 1000; // 30 minutos
const MATCH_INSIGHTS_COUNT = 10; // partidas analisadas por consulta
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const LANE_LABELS = {
  TOP: 'Top',
  JUNGLE: 'Selva',
  MIDDLE: 'Meio',
  BOTTOM: 'Bot',
  UTILITY: 'Suporte'
};

const STYLE_BY_TAG = {
  Fighter: 'duelo no 1x1 e pressão individual',
  Assassin: 'jogadas agressivas e caça ao carry adversário',
  Marksman: 'dano à distância e posicionamento cuidadoso',
  Mage: 'controle de área e dano em lista',
  Tank: 'linha de frente e engajamento de lutas',
  Support: 'proteção de aliados e visão de mapa',
  Slayer: 'caça ao alvo isolado'
};

let championCatalogCache = null;
let championCatalogExpiresAt = 0;

async function getChampionCatalog() {
  if (championCatalogCache && Date.now() < championCatalogExpiresAt) {
    return championCatalogCache;
  }

  const versionsResponse = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json', { timeout: 10000 });
  const latestVersion = versionsResponse.data[0];
  const championsResponse = await axios.get(
    `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/pt_BR/champion.json`,
    { timeout: 10000 }
  );

  const catalog = {};
  for (const champion of Object.values(championsResponse.data.data || {})) {
    catalog[String(champion.key)] = { name: champion.name, tags: champion.tags || [] };
  }

  championCatalogCache = catalog;
  championCatalogExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  return catalog;
}

function buildStyleText(tags) {
  const items = (tags || []).map((tag) => STYLE_BY_TAG[tag]).filter(Boolean);
  return items.length ? items.join(' + ') : 'estilo versátil';
}

function getCachedInsights(puuid) {
  const entry = matchInsightsCache.get(puuid);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    matchInsightsCache.delete(puuid);
    return null;
  }
  return entry.data;
}

function setCachedInsights(puuid, data) {
  matchInsightsCache.set(puuid, { data, expiresAt: Date.now() + MATCH_INSIGHTS_TTL_MS });
}

function summarizeChampionStats(entry, games) {
  return {
    name: entry.name,
    games,
    winRate: Math.round((entry.wins / games) * 100)
  };
}

function buildInsightsFromMatches(matches, puuid, championCatalog) {
  let wins = 0;
  let losses = 0;
  const laneCounts = {};
  const champStats = {};
  const now = Date.now();

  for (const match of matches) {
    const info = match?.info;
    // gameMode vem como CLASSIC/ARAM/CHERRY... (v5). Exclui apenas modos sem partida ranqueada normal.
    const gameMode = String(info?.gameMode || '').toUpperCase();
    if (!info || ['CHERRY', 'TUTORIAL', 'ULTBOOK', 'ODIN'].includes(gameMode)) continue;

    const participant = (info.participants || []).find((p) => p.puuid === puuid);
    if (!participant) continue;

    if (participant.win) wins += 1; else losses += 1;

    if (LANE_LABELS[participant.individualPosition]) {
      laneCounts[participant.individualPosition] = (laneCounts[participant.individualPosition] || 0) + 1;
    }

    const champId = String(participant.championId);
    const champMeta = championCatalog[champId] || { name: `Campeão ${champId}`, tags: [] };
    if (!champStats[champId]) {
      champStats[champId] = { name: champMeta.name, tags: champMeta.tags, wins: 0, games: 0, lastPlayedAt: 0 };
    }
    champStats[champId].games += 1;
    if (participant.win) champStats[champId].wins += 1;
    const playedAt = Number(info.gameEndTimestamp || 0);
    if (playedAt > champStats[champId].lastPlayedAt) champStats[champId].lastPlayedAt = playedAt;
  }

  const totalGames = wins + losses;
  if (totalGames === 0) return null;

  const mainLaneKey = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const mainLane = mainLaneKey ? LANE_LABELS[mainLaneKey] : null;

  const championsAllTime = Object.values(champStats)
    .map((entry) => ({ entry, games: entry.games }))
    .sort((a, b) => b.games - a.games);

  const topChampAllTime = championsAllTime[0]
    ? summarizeChampionStats(championsAllTime[0].entry, championsAllTime[0].games)
    : null;

  const recentChampionEntry = championsAllTime.find((item) => item.entry.lastPlayedAt >= now - SEVEN_DAYS_MS);
  const recentChampion = recentChampionEntry
    ? summarizeChampionStats(recentChampionEntry.entry, recentChampionEntry.games)
    : null;

  const styleSource = championsAllTime[0]?.entry || null;
  const styleText = styleSource ? buildStyleText(styleSource.tags) : null;

  let attentionText = null;
  const focusChampion = recentChampion || topChampAllTime;
  if (focusChampion && ((focusChampion.games >= 3 && focusChampion.winRate >= 60) || focusChampion.games >= 6)) {
    attentionText = `é um jogador muito identificado com ${focusChampion.name}; vale considerar banimento ou roubo do campeão.`;
  }

  return {
    totalGames,
    wins,
    losses,
    winRate: Math.round((wins / totalGames) * 100),
    mainLane,
    topChampion: topChampAllTime,
    recentChampion,
    styleText,
    attentionText,
    generatedAt: new Date().toISOString()
  };
}

function createRiotService(apiKey, region = DEFAULT_REGION) {
  if (!apiKey) {
    throw new Error('RIOT_API_KEY nao foi configurada no arquivo .env.');
  }

  const normalizedRegion = region.toLowerCase();
  const regionalRouting = REGIONAL_ROUTING[normalizedRegion];

  if (!regionalRouting) {
    throw new Error(`Regiao invalida: ${region}`);
  }

  const platformClient = axios.create({
    baseURL: `https://${normalizedRegion}.api.riotgames.com`,
    headers: { 'X-Riot-Token': apiKey },
    timeout: 10000
  });

  const regionalClient = axios.create({
    baseURL: `https://${regionalRouting}.api.riotgames.com`,
    headers: { 'X-Riot-Token': apiKey },
    timeout: 10000
  });

  function normalizeRiotId(input) {
    const cleaned = input.trim().replace(/\s*#\s*/g, '#');

    if (!cleaned.includes('#')) {
      return null;
    }

    const [gameName, tagLine] = cleaned.split('#');

    if (!gameName || !tagLine) {
      return null;
    }

    return {
      gameName: gameName.trim(),
      tagLine: tagLine.trim()
    };
  }

  async function request(handler, context = '') {
    try {
      return await handler();
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Jogador nao encontrado na Riot API${context ? ` (${context})` : ''}. Verifique se o Nick#TAG esta correto.`);
      }

      if (error.response?.status === 403) {
        throw new Error('A chave da Riot API esta invalida ou expirou. Contate o administrador.');
      }

      if (error.response?.status === 429) {
        throw new Error('Limite de requisicoes atingido. Tente novamente em 2 minutos.');
      }

      const riotMessage = error.response?.data?.status?.message;
      throw new Error(riotMessage || 'Falha de comunicacao com a Riot API.');
    }
  }

  async function getSummonerByInput(playerInput) {
    const riotId = normalizeRiotId(playerInput);

    if (riotId) {
      const accountLookup = await request(() =>
        regionalClient.get(
          `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId.gameName)}/${encodeURIComponent(riotId.tagLine)}`
        ), 
        `Conta: ${riotId.gameName}#${riotId.tagLine}`
      );

      const summonerLookup = await request(() =>
        platformClient.get(`/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(accountLookup.data.puuid)}`),
        `Perfil LOL: ${riotId.gameName}#${riotId.tagLine}`
      );

      return {
        puuid: summonerLookup.data.puuid,
        summonerId: summonerLookup.data.id || null,
        summonerLevel: summonerLookup.data.summonerLevel ?? null,
        displayName: `${riotId.gameName}#${riotId.tagLine}`
      };
    }

    throw new Error('Formato invalido! Use Nome#TAG (ex: Faker#BR1).');
  }

  async function getSoloQueueRank({ puuid, summonerId }) {
    let response;

    if (puuid) {
      response = await request(() =>
        platformClient.get(`/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`)
      );
    } else if (summonerId) {
      response = await request(() =>
        platformClient.get(`/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`)
      );
    } else {
      throw new Error('Nao foi possivel identificar o jogador para consultar o rank.');
    }

    const soloQueue = response.data.find((entry) => entry.queueType === 'RANKED_SOLO_5x5');

    if (!soloQueue) {
      return {
        tier: 'GOLD',
        rank: 'IV',
        leaguePoints: 0,
        wins: 0,
        losses: 0,
        queueType: 'RANKED_SOLO_5x5',
        isFallbackUnranked: true
      };
    }

    return soloQueue;
  }

  function convertRankToMmr(rankData) {
    const tier = String(rankData.tier || '').toUpperCase();
    const rank = String(rankData.rank || '').toUpperCase();
    const lp = Number(rankData.leaguePoints || 0);

    if (!(tier in TIER_BASE_MMR)) {
      throw new Error('Nao foi possivel converter o elo do jogador para MMR.');
    }

    const baseMmr = TIER_BASE_MMR[tier];
    const rankStep = RANK_STEP[rank] ?? 0;

    if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) {
      return baseMmr + lp;
    }

    return baseMmr + rankStep + Math.min(lp, 100);
  }

  async function getPlayerRankProfile(playerInput) {
    const summoner = await getSummonerByInput(playerInput);

    // Verifica cache primeiro (evita chamada extra à API)
    const cached = getCachedProfile(summoner.puuid);
    if (cached) return cached;

    const soloQueue = await getSoloQueueRank({
      puuid: summoner.puuid,
      summonerId: summoner.summonerId
    });
    const mmr = convertRankToMmr(soloQueue);

    const profile = {
      puuid: summoner.puuid,
      summonerId: summoner.summonerId,
      summonerLevel: summoner.summonerLevel ?? null,
      nickname: summoner.displayName,
      tier: soloQueue.tier,
      rank: soloQueue.rank,
      leaguePoints: soloQueue.leaguePoints,
      wins: soloQueue.wins,
      losses: soloQueue.losses,
      mmr,
      isFallbackUnranked: Boolean(soloQueue.isFallbackUnranked)
    };

    setCachedProfile(summoner.puuid, profile);
    return profile;
  }

  async function getMatchInsights(puuid) {
    if (!puuid) return null;

    const cached = getCachedInsights(puuid);
    if (cached) return cached;

    const championCatalog = await getChampionCatalog();

    const matchIdsResponse = await request(() =>
      regionalClient.get(`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`, {
        params: { start: 0, count: MATCH_INSIGHTS_COUNT }
      }),
      'Historico de partidas'
    );

    const matchIds = Array.isArray(matchIdsResponse.data) ? matchIdsResponse.data : [];
    const matchResponses = await Promise.all(
      matchIds.map((matchId) =>
        request(() => regionalClient.get(`/lol/match/v5/matches/${matchId}`), `Partida ${matchId}`)
          .then((response) => response.data)
          .catch(() => null)
      )
    );

    const insights = buildInsightsFromMatches(matchResponses, puuid, championCatalog);
    if (!insights) return null;

    setCachedInsights(puuid, insights);
    return insights;
  }

  function invalidateCache(puuid) {
    rankProfileCache.delete(puuid);
    matchInsightsCache.delete(puuid);
  }

  return {
    getPlayerRankProfile,
    getMatchInsights,
    convertRankToMmr,
    invalidateCache
  };
}

module.exports = {
  createRiotService
};
