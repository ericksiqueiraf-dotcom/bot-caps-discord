const { drawRoulette } = require('../../application/use-cases/drawRoulette');

// Roleta instantânea: 1 comando sorteia na hora, sem confirmações.
// `!roleta 3 A` = sorteia 3 entre os perdedores da sala A (menos INFERNAL).
const ROULETTE_LOOKUP_MS = 15 * 60 * 1000; // janela p/ achar a partida de origem (pos-MVP)

function parseRouletteArgs(args = []) {
  const tokens = args.map((arg) => String(arg || ''));
  const lower = tokens.map((t) => t.toLowerCase());
  let count = null;
  let letter = null;
  let sub = null;
  for (const t of lower) {
    if (['sortear', 'fechar', 'forcar', 'forçar'].includes(t)) sub = 'sortear';
    else if (['sair', 'desistir', 'remover'].includes(t)) sub = 'sair';
    else if (['ver', 'status', 'info'].includes(t)) sub = sub || 'ver';
  }
  const numeric = tokens.map((t) => Number(t)).find((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  if (numeric != null) count = numeric;
  const letterTok = tokens.map((t) => t.replace(/[<@!>]/g, '')).find((t) => /^[a-zA-Z]$/.test(t));
  if (letterTok) letter = letterTok.toUpperCase();
  return { count, letter, sub };
}

function findRouletteOrigin(systemMeta, guildId, letter) {
  const entries = Array.isArray(systemMeta?.recentVictories) ? systemMeta.recentVictories : [];
  const now = Date.now();
  const byLetter = letter
    ? entries.filter((e) => e && e.guildId === guildId && String(e.letter || '').toUpperCase() === String(letter).toUpperCase())
    : entries.filter((e) => e && e.guildId === guildId);
  for (const entry of byLetter) {
    if (!entry?.finishedAt) continue;
    const ms = new Date(entry.finishedAt).getTime();
    if (Number.isNaN(ms) || now - ms > ROULETTE_LOOKUP_MS) continue;
    return entry;
  }
  const single = Array.isArray(systemMeta?.recentVictory) ? null : systemMeta?.recentVictory;
  if (single && single.guildId === guildId && (!letter || String(single.letter || '').toUpperCase() === String(letter).toUpperCase())) {
    const ms = new Date(single.finishedAt).getTime();
    if (!Number.isNaN(ms) && now - ms <= ROULETTE_LOOKUP_MS) return single;
  }
  return byLetter[0] || null;
}

function getLosersWinners(origin) {
  if (!origin) return { losers: [], winners: [] };
  const t1 = origin.teamOne || [];
  const t2 = origin.teamTwo || [];
  const winners = origin.winnerTeam === '1' ? t1 : t2;
  const losers = origin.winnerTeam === '1' ? t2 : t1;
  return { losers, winners };
}

function hasStaffPower(member) {
  if (!member) return false;
  if (member.permissions?.has('ManageMessages') || member.permissions?.has('Administrator')) return true;
  const captainRoleId = require('../../config.json').roles?.captainRoleId;
  try {
    return Boolean(captainRoleId && member.roles?.cache?.has(captainRoleId));
  } catch {
    return false;
  }
}

async function buildLobbyPlayer(deps, stored, mode, format) {
  const { getModeStats, calculateHybridMmr } = deps;
  const modeStats = getModeStats(stored, mode, format);
  const leagueMmr = Number(stored.baseMmr || modeStats.baseMmr || 1200);
  return {
    discordId: stored.discordId,
    discordUsername: stored.discordUsername || stored.registeredNickname || stored.nickname,
    nickname: stored.registeredNickname || stored.nickname,
    tier: stored.tier || 'GOLD',
    rank: stored.rank || 'IV',
    leaguePoints: stored.leaguePoints || 0,
    isFallbackUnranked: Boolean(stored.isFallbackUnranked),
    baseMmr: leagueMmr,
    customWins: modeStats.customWins || 0,
    customLosses: modeStats.customLosses || 0,
    mmr: calculateHybridMmr(leagueMmr, modeStats.customWins, modeStats.customLosses, modeStats.internalRating),
    internalRating: modeStats.internalRating,
    ratingVersion: modeStats.ratingVersion,
    puuid: stored.puuid || null,
    summonerId: stored.summonerId || null,
    mode,
    format,
    joinedAt: new Date().toISOString()
  };
}

function alreadyDrawn(systemMeta, matchIdOrOrigin) {
  const history = Array.isArray(systemMeta?.roletaHistory) ? systemMeta.roletaHistory : [];
  // O matchId e o ID do lobby (ex: classic-5x5-a) e se repete a cada jogo da sala.
  // Quando recebe a partida de origem, o sorteio so vale se foi feito DEPOIS dela terminar;
  // registro mais antigo que o fim da partida e de um jogo anterior e e ignorado.
  const origin = matchIdOrOrigin && typeof matchIdOrOrigin === 'object' ? matchIdOrOrigin : null;
  const matchId = origin ? origin.matchId : matchIdOrOrigin;
  const finishedMs = origin && origin.finishedAt ? new Date(origin.finishedAt).getTime() : NaN;
  return history.some((entry) => {
    if (!entry || entry.matchId !== matchId) return false;
    if (origin && !Number.isNaN(finishedMs) && entry.at) {
      const drawnMs = new Date(entry.at).getTime();
      if (!Number.isNaN(drawnMs) && drawnMs < finishedMs) return false;
    }
    return true;
  });
}

// Opt-outs: jogador que não quer a próxima (fora do sorteio e da subida ao lobby).
// Chave por sala; amarra no matchId p/ não vazar para a próxima partida da mesma letra.
const rouletteOptOuts = new Map(); // `${guildId}:${LETTER}` -> { matchId, ids: Set }

function getOptOutKey(guildId, letter) {
  return `${guildId}:${String(letter || '').toUpperCase()}`;
}

function applyOptOuts(list = [], optOutIds = []) {
  const out = new Set((optOutIds || []).map(String));
  return (list || []).filter((p) => p && !out.has(String(p.discordId)));
}

function getOptOutIds(guildId, letter, matchId) {
  const entry = rouletteOptOuts.get(getOptOutKey(guildId, letter));
  if (!entry || entry.matchId !== matchId) return [];
  return [...entry.ids];
}

function addOptOut(guildId, letter, matchId, discordId) {
  const key = getOptOutKey(guildId, letter);
  let entry = rouletteOptOuts.get(key);
  if (!entry || entry.matchId !== matchId) {
    entry = { matchId, ids: new Set() };
    rouletteOptOuts.set(key, entry);
  }
  const before = entry.ids.size;
  entry.ids.add(String(discordId));
  return entry.ids.size > before;
}

function clearOptOuts(guildId, letter) {
  rouletteOptOuts.delete(getOptOutKey(guildId, letter));
}

async function executeRouletteDraw({ guild, origin, pool, count, winners, deps }) {
  const {
    withQueueOperationLock,
    loadQueue,
    loadPlayerStats,
    saveQueue,
    getOpenLobby,
    createLobbyChannels,
    getNextLobbyLetter,
    getRequiredPlayersByModeAndFormat,
    getStoredPlayerStats,
    movePlayersToVoiceChannel,
    updateQueueDashboard,
    postRouletteAnnouncement,
    getLobbyTier
  } = deps;

  const mode = origin.mode || 'classic';
  const format = origin.format || '5x5';
  const originTier = origin.tier || null;

  // INFERNAL nunca cai: filtra antes do sorteio (override staff inclui com flag)
  const sortable = pool.filter((p) => p.allowInfernal || !p.isInfernal);
  const drawN = Math.min(Number(count || 0), sortable.length);
  const { leaving, staying } = drawRoulette(sortable, drawN);

  return withQueueOperationLock(`${guild.id}:global:queue`, async () => {
    // Guarda anti-duplo DENTRO do lock (2 comandos juntos não sorteiam 2x)
    const freshMeta = await deps.loadSystemMeta();
    if (alreadyDrawn(freshMeta, origin)) {
      throw new Error(`A sala **${origin.letter || '?'}** já foi roletada.`);
    }

    const queueData = await loadQueue();
    const currentMatchData = await deps.loadCurrentMatch();
    const playerStats = await loadPlayerStats();

    // Lobby destino: mesmo modo/formato/tier onde jogaram
    const wantTier = originTier === 'S' ? 'S' : 'normal';
    let lobby = null;
    if (getOpenLobby.length >= 4) {
      lobby = getOpenLobby(queueData, mode, format, wantTier);
    } else {
      lobby = getOpenLobby(queueData, mode, format);
      if (lobby && getLobbyTier && getLobbyTier(lobby) !== wantTier && mode === 'classic') lobby = null;
    }
    if (!lobby) {
      const letter = getNextLobbyLetter(queueData, currentMatchData, mode, format);
      const created = await createLobbyChannels(guild, mode, format, letter, originTier === 'S' ? 'S' : null);
      lobby = {
        id: `${mode}-${format}-${originTier === 'S' ? 's-' : ''}${letter.toLowerCase()}`,
        mode,
        format,
        tier: originTier === 'S' ? 'S' : 'normal',
        letter,
        waitingChannelId: created.waitingChannelId,
        parentId: created.parentId,
        requiredPlayers: getRequiredPlayersByModeAndFormat(mode, format),
        players: [],
        status: 'waiting'
      };
      queueData.lobbies[lobby.id] = lobby;
    }

    const addUnique = async (discordId, nickname) => {
      if (!discordId || lobby.players.some((p) => p.discordId === discordId)) return;
      const stored = getStoredPlayerStats(playerStats, { discordId, nickname });
      lobby.players.push(await buildLobbyPlayer(deps, stored, mode, format));
    };

    // Winners movem juntos + staying (não-sorteados)
    for (const w of winners) await addUnique(w.discordId, w.nickname);
    for (const s of staying) await addUnique(s.discordId, s.nickname);

    await saveQueue(queueData);

    const toMove = [...winners, ...staying].filter((p) => p?.discordId);
    await movePlayersToVoiceChannel(guild, toMove, lobby.waitingChannelId);
    await updateQueueDashboard(guild).catch(() => null);

    const vacancies = Math.max(0, (lobby.requiredPlayers || 10) - lobby.players.length);
    const destLabel = mode === 'classic' && (originTier === 'S' || (getLobbyTier && getLobbyTier(lobby) === 'S'))
      ? `Lobby TIER S ${lobby.letter}` : `Lobby CLASSIC ${lobby.letter}`;
    await postRouletteAnnouncement(guild, {
      letter: origin.letter,
      leaving,
      staying,
      winners,
      vacancies,
      destinationLabel: destLabel
    }).catch(() => null);

    const history = Array.isArray(freshMeta.roletaHistory) ? freshMeta.roletaHistory : [];
    history.unshift({
      guildId: guild.id,
      matchId: origin.matchId || null,
      letter: origin.letter || null,
      at: new Date().toISOString(),
      leaving: leaving.map((p) => p.discordId),
      staying: staying.map((p) => p.discordId)
    });
    await deps.saveSystemMeta({ ...freshMeta, roletaHistory: history.slice(0, 5) });

    return { leaving, staying, lobby, vacancies };
  });
}

async function handleRouletteCommandFlow({ message, args, deps }) {
  const { loadSystemMeta, replyToMessage, hasInfernalPriority } = deps;

  const { count, letter } = parseRouletteArgs(args);
  const staff = hasStaffPower(message.member);

  if (count == null) {
    await replyToMessage(message, 'Use `!roleta N A` (N = quantos saem, 1–5, + letra da sala). Ex: `!roleta 3 A`.');
    return;
  }

  const systemMeta = await loadSystemMeta();
  let targetLetter = letter;
  let origin = null;
  if (!targetLetter) {
    origin = findRouletteOrigin(systemMeta, message.guild.id, null);
    if (!origin) {
      await replyToMessage(message, 'Informe a sala: `!roleta 3 A`. Com A e B ativas a letra é obrigatória.');
      return;
    }
    targetLetter = String(origin.letter || 'A').toUpperCase();
  }
  origin = origin || findRouletteOrigin(systemMeta, message.guild.id, targetLetter);
  if (!origin) {
    await replyToMessage(message, `Nenhuma partida recente da sala **${targetLetter}** para roletar.`);
    return;
  }

  if (alreadyDrawn(systemMeta, origin)) {
    await replyToMessage(message, `A sala **${origin.letter || targetLetter}** já foi roletada. Vagas restantes: \`!espera\`.`);
    return;
  }

  const { losers, winners } = getLosersWinners(origin);
  const authorIsLoser = losers.some((p) => p.discordId === message.author.id);
  if (!authorIsLoser && !staff) {
    await replyToMessage(message, 'Apenas quem perdeu essa partida ou a staff pode roletar.');
    return;
  }

  // Pool = TODOS os perdedores (menos INFERNAL e menos quem deu !roletasair).
  // Sem confirmações: 1 comando sorteia na hora.
  const allowInfernal = staff && args.some((a) => String(a).toLowerCase() === '--com-infernal');
  const optOutIds = getOptOutIds(message.guild.id, origin.letter || targetLetter, origin.matchId);
  const pool = [];
  for (const loser of applyOptOuts(losers, optOutIds)) {
    const infernal = await hasInfernalPriority(message.guild, loser.discordId).catch(() => false);
    if (infernal && !allowInfernal) continue;
    pool.push({ discordId: loser.discordId, nickname: loser.nickname, isInfernal: Boolean(infernal), allowInfernal: Boolean(allowInfernal) });
  }
  if (pool.length === 0) {
    await replyToMessage(message, `Ninguém para roletar na sala **${origin.letter}** (só INFERNAL 🔥 ou fora com \`!roletasair\`).`);
    return;
  }

  try {
    const result = await executeRouletteDraw({ guild: message.guild, origin, pool, count, winners: applyOptOuts(winners, optOutIds), deps });
    clearOptOuts(message.guild.id, origin.letter || targetLetter);
    await replyToMessage(
      message,
      `🎯 Roleta **${origin.letter}** sorteada! ❌ Saem: ${result.leaving.map((p) => `<@${p.discordId}>`).join(' ') || '—'} • ✅ Ficam: ${result.staying.map((p) => `<@${p.discordId}>`).join(' ') || '—'} • Vagas: **${result.vacancies}** (\`!espera\`)`
    );
  } catch (err) {
    await replyToMessage(message, `❌ ${err.message}`);
  }
}

async function handleRouletteOptOutFlow({ message, args, deps }) {
  const { loadSystemMeta, replyToMessage } = deps;
  const { letter } = parseRouletteArgs(args);
  const mentioned = message.mentions?.users?.first() || null;
  const staff = hasStaffPower(message.member);

  const systemMeta = await loadSystemMeta();
  let targetLetter = letter;
  let origin = null;
  if (!targetLetter) {
    origin = findRouletteOrigin(systemMeta, message.guild.id, null);
    if (!origin) {
      await replyToMessage(message, 'Informe a sala: `!roletasair A`.');
      return;
    }
    targetLetter = String(origin.letter || 'A').toUpperCase();
  }
  origin = origin || findRouletteOrigin(systemMeta, message.guild.id, targetLetter);
  if (!origin) {
    await replyToMessage(message, `Nenhuma partida recente da sala **${targetLetter}**.`);
    return;
  }

  if (alreadyDrawn(systemMeta, origin)) {
    await replyToMessage(message, `A sala **${origin.letter}** já foi roletada. Para sair da próxima, use \`!sair\`.`);
    return;
  }

  const { losers, winners } = getLosersWinners(origin);
  const participants = [...losers, ...winners];

  let targetId = message.author.id;
  let targetLabel = `<@${message.author.id}>`;
  if (mentioned) {
    if (!staff) {
      await replyToMessage(message, 'Apenas staff pode tirar outro jogador (`!roletasair @jogador A`).');
      return;
    }
    targetId = mentioned.id;
    targetLabel = `<@${mentioned.id}>`;
  }
  if (!participants.some((p) => String(p.discordId) === String(targetId))) {
    await replyToMessage(message, `${targetLabel} não jogou a partida da sala **${origin.letter}**.`);
    return;
  }

  const added = addOptOut(message.guild.id, origin.letter || targetLetter, origin.matchId, targetId);
  await replyToMessage(
    message,
    added
      ? `👋 ${targetLabel} fora da próxima (sala **${origin.letter}**): não entra no sorteio nem sobe ao lobby.`
      : `${targetLabel} já estava fora da próxima (sala **${origin.letter}**).`
  );
}

module.exports = {
  handleRouletteCommandFlow,
  handleRouletteOptOutFlow,
  parseRouletteArgs,
  applyOptOuts
};
