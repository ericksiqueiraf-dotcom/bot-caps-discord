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
    const soloQueue = await getSoloQueueRank({
      puuid: summoner.puuid,
      summonerId: summoner.summonerId
    });
    const mmr = convertRankToMmr(soloQueue);

    return {
      puuid: summoner.puuid,
      summonerId: summoner.summonerId,
      nickname: summoner.displayName,
      tier: soloQueue.tier,
      rank: soloQueue.rank,
      leaguePoints: soloQueue.leaguePoints,
      wins: soloQueue.wins,
      losses: soloQueue.losses,
      mmr,
      isFallbackUnranked: Boolean(soloQueue.isFallbackUnranked)
    };
  }

  return {
    getPlayerRankProfile,
    convertRankToMmr
  };
}

module.exports = {
  createRiotService
};
