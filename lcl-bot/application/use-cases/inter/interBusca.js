// Casos de uso da busca de times (fila de TIMES, nao de avulsos).
// Times de 5 fixos; match FIFO entre buscas compativeis de times diferentes.

const {
  TEAM_SIZE,
  SERIES_MD1,
  SERIES_MD3,
  parseSerieArg,
  teamKey,
  sanitizeTeamName,
  validateRoster,
  drawSides
} = require('../../../domain/inter/series');

const INTER_BUSCA_LOCK = 'inter:global:busca';

// Sequencial p/ unicidade de IDs mesmo com mesmo now()+rand().
let interIdSeq = 0;
function nextInterId(prefix, now, rand) {
  interIdSeq = (interIdSeq + 1) % 1296;
  return `${prefix}-${now().toString(36)}-${Math.floor(rand() * 1e6).toString(36)}-${interIdSeq.toString(36)}`;
}

function pruneExpiredBuscas(buscaData, now = Date.now()) {
  const before = (buscaData.buscas || []).length;
  buscaData.buscas = (buscaData.buscas || []).filter((b) => {
    if (!b || b.status !== 'waiting') return true;
    return new Date(b.expiresAt).getTime() > now;
  });
  return before - buscaData.buscas.length;
}

function playerInInterMatch(interMatches, discordId) {
  const id = String(discordId);
  return Object.values(interMatches?.matches || {}).some((m) => {
    if (!m || m.status !== 'open') return false;
    const all = [...(m.teamA?.jogadores || []), ...(m.teamB?.jogadores || [])].map(String);
    return all.includes(id);
  });
}

function playerInInternalMatch(currentMatchData, discordId) {
  const id = String(discordId);
  return Object.values(currentMatchData?.matches || {}).some((entry) => {
    if (!entry?.active || !entry.match) return false;
    const all = [...(entry.match.teamOne || []), ...(entry.match.teamTwo || [])].map((p) => String(p.discordId));
    return all.includes(id);
  });
}

// Registra a busca de um time e tenta formar match (FIFO).
// input: {teamName, originGuildId, originGuildName, capitaoId, jogadores[5], serie}
async function buscarTime({ input, config, deps, rand = Math.random, now = Date.now }) {
  const {
    loadInterBusca, saveInterBusca, loadInterMatches,
    loadQueue, loadCurrentMatch,
    findLobbyByPlayer, withQueueOperationLock
  } = deps;

  const serie = parseSerieArg(input?.serie) || SERIES_MD1;
  const name = sanitizeTeamName(input?.teamName);
  const jogadores = (input?.jogadores || []).map(String);
  const originGuildId = String(input?.originGuildId || '');

  if (!name) return { status: 'missing_team_name' };
  if (!originGuildId) return { status: 'missing_guild' };
  const roster = validateRoster(jogadores);
  if (!roster.ok) return { status: roster.reason };
  if (!jogadores.includes(String(input?.capitaoId))) return { status: 'capitao_not_in_roster' };

  const key = teamKey(originGuildId, name);
  const expiryMs = Number(config?.buscaExpiryMinutes ?? 30) * 60 * 1000;

  return withQueueOperationLock(INTER_BUSCA_LOCK, async () => {
    const buscaData = await loadInterBusca();
    const interMatches = await loadInterMatches();
    const queueData = typeof loadQueue === 'function' ? await loadQueue() : { lobbies: {} };
    const currentMatchData = typeof loadCurrentMatch === 'function' ? await loadCurrentMatch() : { matches: {} };

    pruneExpiredBuscas(buscaData, now());

    const mine = (buscaData.buscas || []).find((b) => b.key === key && b.status === 'waiting');
    if (mine) return { status: 'already_waiting', busca: mine };

    // Ninguem do elenco pode estar ocupado em outra busca/match/fila.
    for (const id of jogadores) {
      const busyBusca = (buscaData.buscas || []).some((b) =>
        b.status === 'waiting' && (b.jogadores || []).map(String).includes(id));
      if (busyBusca) return { status: 'player_busy_busca', discordId: id };
      if (playerInInterMatch(interMatches, id)) return { status: 'player_busy_match', discordId: id };
      if (playerInInternalMatch(currentMatchData, id)) return { status: 'player_busy_match', discordId: id };
      if (typeof findLobbyByPlayer === 'function' && findLobbyByPlayer(queueData, id)) {
        return { status: 'player_busy_queue', discordId: id };
      }
    }

    const busca = {
      id: nextInterId('busca', now, rand),
      key,
      teamName: name,
      originGuildId,
      originGuildName: String(input?.originGuildName || ''),
      capitaoId: String(input?.capitaoId),
      jogadores,
      serie,
      status: 'waiting',
      createdAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + expiryMs).toISOString()
    };
    buscaData.buscas.push(busca);

    // FIFO: adversario compativel mais antigo, de OUTRO time, mesma serie.
    const opponent = (buscaData.buscas || [])
      .filter((b) => b.status === 'waiting' && b.id !== busca.id && b.key !== key && b.serie === serie)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

    if (!opponent) {
      await saveInterBusca(buscaData);
      const position = buscaData.buscas.filter((b) => b.status === 'waiting' && b.serie === serie).length;
      return { status: 'waiting', busca, position };
    }

    busca.status = 'matched';
    opponent.status = 'matched';
    await saveInterBusca(buscaData);

    const matchDraft = {
      id: nextInterId('inter', now, rand),
      serie,
      teamA: {
        name: opponent.teamName, originGuildId: opponent.originGuildId,
        originGuildName: opponent.originGuildName, jogadores: opponent.jogadores
      },
      teamB: {
        name: busca.teamName, originGuildId: busca.originGuildId,
        originGuildName: busca.originGuildName, jogadores: busca.jogadores
      },
      firstAzul: drawSides(rand).azul,
      createdAt: new Date(now()).toISOString()
    };
    return { status: 'matched', busca, opponent, matchDraft };
  });
}

// Cancela a busca em espera de um time (handler ja validou permissao).
async function cancelarBusca({ key, deps }) {  const { loadInterBusca, saveInterBusca, withQueueOperationLock } = deps;
  return withQueueOperationLock(INTER_BUSCA_LOCK, async () => {
    const buscaData = await loadInterBusca();
    const idx = (buscaData.buscas || []).findIndex((b) => b.key === key && b.status === 'waiting');
    if (idx === -1) return { status: 'not_found' };
    const [removed] = buscaData.buscas.splice(idx, 1);
    await saveInterBusca(buscaData);
    return { status: 'cancelled', busca: removed };
  });
}

module.exports = {
  INTER_BUSCA_LOCK,
  buscarTime,
  cancelarBusca,
  restaurarBuscas,
  pruneExpiredBuscas,
  playerInInterMatch
};

// Devolve duas buscas marcadas como matched para waiting (rollback de match
// que falhou ao criar canais/invite). Nunca joga excecao para o handler.
async function restaurarBuscas({ buscaId, opponentId, deps }) {
  const { loadInterBusca, saveInterBusca, withQueueOperationLock } = deps;
  try {
    return await withQueueOperationLock(INTER_BUSCA_LOCK, async () => {
      const buscaData = await loadInterBusca();
      for (const b of buscaData.buscas || []) {
        if ((b.id === buscaId || b.id === opponentId) && b.status === 'matched') {
          b.status = 'waiting';
        }
      }
      await saveInterBusca(buscaData);
      return { status: 'restored' };
    });
  } catch {
    return { status: 'restore_failed' };
  }
}
