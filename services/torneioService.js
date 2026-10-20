// Torneio CAPS ARENA — mata-mata com sorteio por rodada.
// - Inscrição individual; mínimo 20, sempre múltiplo de 10.
// - Cada rodada: grupos de 10 sorteados por MMR + times 5x5 balanceados.
// - Vencedores avançam; se não fechar 10, repescagem dos melhores perdedores
//   (maior baseMmr da rodada).
// - Final com 10: 1 sorteio, mesmos times, MD3.
// - Estado em systemMeta.torneio (vale p/ Mongo e JSON). Puro e testável;
//   Discord (cargos/anúncios) fica nos handlers.
const MIN_PLAYERS = 20;
const TEAM_SIZE = 5;
const FINAL_SIZE = 10;
const TORNEIO_CARGO_NOME = '🏆 Campeão CAPS';
const INSCRICOES_DIAS_DEFAULT = 7;
const DIA_MS = 24 * 60 * 60 * 1000;
// Ausência: checagem em 3 tempos — aviso em T+5min, substituição em T+10min,
// W.O. automático em T+20min QUANDO não há reserva na fila (perde o lado do ausente).
// Na FINAL não há W.O. automático — a staff registra o resultado (evita coroar sem conferir).
const AUSENCIA_AVISO_MIN = 5;
const AUSENCIA_SUBSTITUICAO_MIN = 10;
const AUSENCIA_WO_MIN = 20;
// Rodada/final aberta: resultado em até RODADA_TIMEOUT_MIN min — senão a staff
// recebe aviso (a cada ciclo após cruzar o limite) e pode `prorrogar`.
const RODADA_TIMEOUT_MIN = 90;

const TORNEIO_INFO =
  '🏆 **TORNEIO CAPS ARENA** — mata-mata com sorteio por rodada.\n' +
  '• Inscrição individual: `!torneio entrar` (mínimo 20, múltiplo de 10)\n' +
  '• A cada rodada o bot monta partidas **5x5 balanceadas**; quem perde sai, quem ganha avança\n' +
  '• Se os vencedores não fecharem 10, entra a **repescagem** (melhores perdedores da rodada)\n' +
  '• Ao sortear, o bot move os 10 de cada jogo para o **lobby de voz** da rodada\n' +
  '• **Presença**: só o lobby da rodada vale. Falta aos **5 min** = aviso; aos **10 min** = entra a **reserva** (sem reserva: **reforço** das rodadas anteriores); aos **20 min** sem alternativa = **W.O.** (lado do ausente perde — na final, a staff registra)\n' +
  '• Reserva assume a vaga de desistente/ausente e o jogo é **re-balanceado** (`!torneio desistencia @user` registra desistência)\n' +
  '• **Final**: 1 sorteio, mesmos times, **MD3** (melhor de 3) — 🚫 **FEARLESS**: proibido pickar campeão usado na partida anterior da série\n' +
  '• Lados na final: **J1 sorteado pelo bot** • **J2 lados invertidos** • **J3 quem venceu o J1 escolhe o lado**\n' +
  '• Rodada/final aberta precisa de resultado em **90 min** — a staff é avisada e pode `prorrogar` ou **adiar⏸/retomar▶️** (pausa sem punir)\n' +
  '• Campeões ganham o cargo 🏆; premiação extra anunciada pela staff a cada edição\n' +
  '• A staff abre/fecha o torneio com `!torneioon` / `!torneiooff`';

function newTournament(edition = 1, options = {}) {
  return {
    active: true,
    inscricoes: true,
    inscricoesAte: options.inscricoesAte || null,
    origem: options.origem || null,
    reservas: [],
    agenda: null,
    edition,
    players: [],
    rounds: [],
    final: null,
    champion: null,
    canais: null,
    createdAt: new Date().toISOString()
  };
}

function addDias(nowMs, dias = INSCRICOES_DIAS_DEFAULT) {
  const n = Number(dias) > 0 ? Math.floor(Number(dias)) : INSCRICOES_DIAS_DEFAULT;
  return new Date(Number(nowMs) + n * DIA_MS).toISOString();
}

// Cria a próxima edição (ou reaproveita a edição caso ainda esteja vazia).
function novaEdicao(prev, { origem = 'manual', dias = INSCRICOES_DIAS_DEFAULT, nowMs = Date.now() } = {}) {
  const edition = prev && prev.active && !prev.champion
    ? (Number(prev.edition) || 1)
    : Math.max(1, Number(prev?.edition || 0) + 1);
  const t = newTournament(edition, { origem, inscricoesAte: addDias(nowMs, dias) });
  if (prev?.agenda) t.agenda = prev.agenda;
  return t;
}

function renovarInscricoes(t, dias = INSCRICOES_DIAS_DEFAULT, nowMs = Date.now()) {
  t.active = true;
  t.inscricoes = true;
  t.inscricoesAte = addDias(nowMs, dias);
  return t;
}

function inscricoesVencidas(t, nowMs = Date.now()) {
  if (!t?.active || t.inscricoes === false) return false;
  const at = Date.parse(t.inscricoesAte || '');
  if (!Number.isFinite(at)) return false;
  return Number(nowMs) >= at;
}

// Fecha as inscrições. Se o total não for múltiplo de 10, mantém os primeiros
// (ordem de inscrição) e o excedente vira reserva.
function fecharInscricoes(t) {
  const players = t.players || [];
  if (players.length < MIN_PLAYERS) {
    return { ok: false, message: `Menos de ${MIN_PLAYERS} inscritos — inscrições seguem abertas.` };
  }
  const keep = Math.floor(players.length / FINAL_SIZE) * FINAL_SIZE;
  t.reservas = players.slice(keep);
  t.players = players.slice(0, keep);
  t.inscricoes = false;
  return { ok: true, kept: t.players.length, reservas: t.reservas };
}

// Há um torneio em andamento (com gente ou rodada sorteada) que não pode ser
// sobrescrito pela agenda.
function torneioEmAndamento(t) {
  return Boolean(
    t?.active && !t.champion &&
    ((t.players || []).length > 0 || (t.rounds || []).length > 0 || t.final)
  );
}

function joinTournament(t, userId) {
  const id = String(userId || '');
  if (!t?.active) return { ok: false, message: 'Nenhum torneio aberto. Aguarde o próximo!' };
  if (t.inscricoes === false) return { ok: false, message: 'Inscrições fechadas para este torneio.' };
  if (!id) return { ok: false, message: 'Usuário inválido.' };
  if (t.players.includes(id)) return { ok: false, message: 'Você já está inscrito no torneio!' };
  if (t.rounds.length > 0) return { ok: false, message: 'O torneio já começou — inscrições encerradas.' };
  t.players.push(id);
  return { ok: true, count: t.players.length };
}

function leaveTournament(t, userId) {
  const id = String(userId || '');
  const idx = (t.players || []).indexOf(id);
  if (idx < 0) return { ok: false, message: 'Você não está inscrito.' };
  if (t.rounds.length > 0) return { ok: false, message: 'O torneio já começou — não dá mais para sair.' };
  t.players.splice(idx, 1);
  return { ok: true, count: t.players.length };
}

function startRequirement(t) {
  const n = (t.players || []).length;
  if (n < MIN_PLAYERS) return { ok: false, message: `Faltam ${MIN_PLAYERS - n} inscritos (mínimo ${MIN_PLAYERS}, múltiplo de 10).` };
  if (n % FINAL_SIZE !== 0) return { ok: false, message: `São ${n} inscritos — precisa ser múltiplo de 10.` };
  return { ok: true };
}

function slimPlayer(p) {
  return { discordId: String(p.discordId), nickname: p.nickname || p.discordId, baseMmr: Number(p.baseMmr || 0) };
}
function slimPlayers(list) { return (list || []).map(slimPlayer); }

// ─── Nomes estáveis de time (Etapa 1) ──────────────────────────────────────
// Time nasce com nome no sorteio ("R1 TIME A", "R1 TIME B", ...) e mantém até o fim.
// A sequência de letras é exclusiva por edição (t.timeSeq) — nunca repete.
const LETRAS_TIME = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function nomeLetraTime(i) {
  const ciclos = Math.floor(i / 26);
  const letra = LETRAS_TIME[i % 26];
  return ciclos === 0 ? letra : `${letra}${ciclos + 1}`;
}

// Atribui nomes aos times criados neste sorteio (muta os player slims com p.timeNome,
// que é como o advanceTournament reconhece o time vencedor na formação da final).
function atribuirNomesTimes(t, games) {
  t.timeSeq ||= 0;
  for (const g of games) {
    const rodada = String(g.id || '').split('-')[0] || 'TIME';
    g.nomeTimeA = `${rodada} TIME ${nomeLetraTime(t.timeSeq++)}`;
    g.nomeTimeB = `${rodada} TIME ${nomeLetraTime(t.timeSeq++)}`;
    for (const p of g.teamOne) p.timeNome = g.nomeTimeA;
    for (const p of g.teamTwo) p.timeNome = g.nomeTimeB;
  }
  return games;
}

// pool: [{ discordId, nickname, baseMmr }]. balanceFn: (grupoDe10) => { teamOne, teamTwo }.
function drawGames(pool, balanceFn, roundLabel) {
  const sorted = [...pool].sort((a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0));
  const ng = sorted.length / FINAL_SIZE;
  const groups = Array.from({ length: ng }, () => []);
  sorted.forEach((p, idx) => {
    const round = Math.floor(idx / ng);
    const g = round % 2 === 0 ? idx % ng : ng - 1 - (idx % ng);
    groups[g].push(p);
  });
  return groups.map((group, gi) => {
    const teams = balanceFn(group);
    return { id: `${roundLabel}-J${gi + 1}`, teamOne: slimPlayers(teams.teamOne), teamTwo: slimPlayers(teams.teamTwo), winner: null };
  });
}

function findGame(t, gameId) {
  for (const round of t.rounds || []) {
    const game = (round.games || []).find((g) => g.id === String(gameId).toUpperCase());
    if (game) return { game, round };
  }
  return {};
}

function recordGameResult(t, gameId, winner) {
  const w = String(winner);
  if (!['1', '2'].includes(w)) return { ok: false, message: 'Use `!torneio resultado <jogo> <1|2>` (ex: `!torneio resultado R1-J1 2`).' };
  const { game } = findGame(t, gameId);
  if (!game) return { ok: false, message: `Jogo ${String(gameId).toUpperCase()} não encontrado.` };
  if (game.winner) return { ok: false, message: `Jogo ${game.id} já teve resultado (time ${game.winner}).` };
  game.winner = w;
  return { ok: true, game };
}

function roundGames(t, roundN) {
  const round = (t.rounds || []).find((r) => r.n === roundN);
  return round ? round.games : [];
}

function roundComplete(t, roundN) {
  const games = roundGames(t, roundN);
  return games.length > 0 && games.every((g) => g.winner);
}

function roundWinners(t, roundN) {
  const out = [];
  for (const g of roundGames(t, roundN)) {
    if (!g.winner) continue;
    out.push(...(g.winner === '1' ? g.teamOne : g.teamTwo));
  }
  return out;
}

function roundLosers(t, roundN) {
  const out = [];
  for (const g of roundGames(t, roundN)) {
    if (!g.winner) continue;
    out.push(...(g.winner === '1' ? g.teamTwo : g.teamOne));
  }
  return out.sort((a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0));
}

// ─── Times como unidade (nome estável) ─────────────────────────────────────
// A partir da R2 o time avança COMO SEU TIME: os 5 mantêm o nome até o fim.
// Só os jogadores mudam, por substituição de reserva (desistência/ausência).
function somaMmrTime(list) {
  return (list || []).reduce((s, p) => s + Number(p.baseMmr || 0), 0);
}

function timeLado(game, lado) {
  const players = lado === '1' ? game.teamOne : game.teamTwo;
  return {
    nome: lado === '1' ? (game.nomeTimeA || 'Time 1') : (game.nomeTimeB || 'Time 2'),
    players: [...players],
    mmr: somaMmrTime(players)
  };
}

// Times vencedores da rodada (um por jogo fechado).
function timesVencedores(t, roundN) {
  return roundGames(t, roundN).filter((g) => g.winner).map((g) => timeLado(g, g.winner));
}

// Times perdedores, melhor elo primeiro (repescagem usa o afinado inteiro).
function timesPerdedores(t, roundN) {
  return roundGames(t, roundN)
    .filter((g) => g.winner)
    .map((g) => timeLado(g, g.winner === '1' ? '2' : '1'))
    .sort((a, b) => b.mmr - a.mmr);
}

// Emparelha times confronto a confronto (serpentina por elo: 1º vs último...,
// força similar por jogo e times mais fortes separados).
function pairTeamsEmJogos(teams, roundLabel) {
  const sorted = [...teams].sort((a, b) => b.mmr - a.mmr);
  const total = sorted.length;
  const games = [];
  for (let i = 0; i < total / 2; i++) {
    const A = sorted[i];
    const B = sorted[total - 1 - i];
    games.push({
      id: `${roundLabel}-J${i + 1}`,
      nomeTimeA: A.nome, teamOne: [...A.players],
      nomeTimeB: B.nome, teamTwo: [...B.players],
      winner: null
    });
  }
  return games;
}

// Avança: vencedores (+ repescagem dos melhores perdedores) são RE-BALANCEADOS
// na próxima rodada (formato do torneio) — até sobrarem 10, que vão para a
// final MD3 CONGELADA: os dois times vencedores jogam a MD3 intocados, nomes mantidos.
function advanceTournament(t, balanceFn) {
  const lastN = (t.rounds || []).length;
  if (lastN === 0) return { ok: false, message: 'Nenhuma rodada sorteada ainda.' };
  if (!roundComplete(t, lastN)) return { ok: false, message: `Rodada ${lastN} ainda tem jogos sem resultado.` };
  if (t.final) return { ok: false, message: 'A final já está rolando.' };
  const winners = roundWinners(t, lastN);
  if (winners.length === FINAL_SIZE) {
    // 10 vencedores = os 2 times vencedores: final MD3 com os MESMOS times (sem re-split).
    const winTeams = timesVencedores(t, lastN);
    let teamOne, teamTwo, nomeTime1, nomeTime2;
    if (winTeams.length === 2) {
      teamOne = winTeams[0].players; teamTwo = winTeams[1].players;
      nomeTime1 = winTeams[0].nome; nomeTime2 = winTeams[1].nome;
    } else {
      const teams = balanceFn(winners);
      teamOne = teams.teamOne; teamTwo = teams.teamTwo;
      nomeTime1 = 'Time 1'; nomeTime2 = 'Time 2';
    }
    t.final = {
      teamOne, teamTwo, nomeTime1, nomeTime2,
      // Lado azul do J1 é sorteado (J2 inverte; no J3 o vencedor do J1 escolhe).
      sides: { j1: Math.random() < 0.5 ? '1' : '2' },
      games: [], wins1: 0, wins2: 0, ausencia: null,
      iniciadoEm: new Date().toISOString()
    };
    return { ok: true, type: 'final', final: t.final };
  }
  const need = Math.ceil(winners.length / FINAL_SIZE) * FINAL_SIZE - winners.length;
  const repescados = roundLosers(t, lastN).slice(0, need);
  if (repescados.length < need) return { ok: false, message: 'Repescagem impossível: perdedores insuficientes.' };
  const pool = [...winners, ...repescados];
  const games = drawGames(pool, balanceFn, `R${lastN + 1}`);
  atribuirNomesTimes(t, games); // re-balance: times novos, letras continuam (R2 TIME E, F...)
  t.rounds.push({
    n: lastN + 1, games, ausencia: null,
    iniciadoEm: new Date().toISOString(),
    repechage: repescados.map((p) => p.discordId)
  });
  return { ok: true, type: 'round', round: lastN + 1, games, repechage: repescados };
}

function recordFinalGame(t, winner) {
  const w = String(winner);
  if (!t.final) return { ok: false, message: 'Ainda não há final.' };
  if (t.champion) return { ok: false, message: 'Torneio já encerrado.' };
  if (!['1', '2'].includes(w)) return { ok: false, message: 'Use `!torneio resultado FINAL <1|2>`.' };
  t.final.games.push(w);
  if (w === '1') t.final.wins1 += 1;
  else t.final.wins2 += 1;
  if (t.final.wins1 >= 2 || t.final.wins2 >= 2) {
    const champs = t.final.wins1 >= 2 ? t.final.teamOne : t.final.teamTwo;
    t.champion = { team: champs.map((p) => p.discordId), at: new Date().toISOString(), placar: `${t.final.wins1}x${t.final.wins2}` };
    return { ok: true, champion: true, final: t.final };
  }
  return { ok: true, champion: false, final: t.final };
}

// ─── Reservas: fila e substituição por desistência/ausência ─────────────────
// Mantém a fila sem IDs de quem já virou jogador/participante (defensivo).
function normalizarReservas(t) {
  t.reservas ||= [];
  const ativos = new Set(t.players || []);
  for (const round of t.rounds || []) {
    for (const g of round.games || []) [...g.teamOne, ...g.teamTwo].forEach((p) => ativos.add(p.discordId));
  }
  if (t.final) [...t.final.teamOne, ...t.final.teamTwo].forEach((p) => ativos.add(p.discordId));
  t.reservas = t.reservas.filter((id) => !ativos.has(String(id)));
  return t.reservas;
}

// Espia o 1º da fila (ordem de inscrição) sem consumir.
function peakReserva(t) {
  return normalizarReservas(t)[0] || null;
}

// Saída da fila (consumo explícito).
function promoverReserva(t) {
  return normalizarReservas(t).shift() || null;
}

// Re-balanceia os 10 de um jogo já sorteado (entrada de reserva etc.).
function rebalanceGame(game, balanceFn) {
  const pool = [...game.teamOne, ...game.teamTwo];
  const teams = balanceFn(pool);
  game.teamOne = slimPlayers(teams.teamOne);
  game.teamTwo = slimPlayers(teams.teamTwo);
  return game;
}

// Substituição por desistência/ausência — decide o modo pelo estado:
// • pré-1º-sorteio (inscrições fechadas): troca direta na lista de players;
// • jogo em aberto na rodada: reserva entra nos 10 e o jogo é re-balanceado;
// • jogo já registrado e o desistente venceu: reserva assume a vaga para a próxima;
// • desistente eliminado (perdeu): segue eliminado — reserva permanece na fila;
// • final em andamento: troca no time congelado.
// reservaPlayer: { discordId, nickname, baseMmr } (stats buscadas pelo chamador).
function substituirDesistente(t, alvoId, reservaPlayer, balanceFn) {
  const alvo = String(alvoId || '');
  if (!t?.active) return { ok: false, message: 'Nenhum torneio ativo.' };
  if (!alvo) return { ok: false, message: 'Informe o jogador desistente.' };
  const reserva = slimPlayer(reservaPlayer || {});
  normalizarReservas(t);
  if (!reserva.discordId) return { ok: false, message: 'Não há reservas na fila (jogador inválido).' };
  // ID do substituto: consome a fila; sem fila, entra o REFORÇO (reserva.discordId
  // já vem do pool morto — perdedor de rodadas anterior, escolhido pelo chamador).
  const pegarReservaId = () => (t.reservas.length ? t.reservas.shift() : reserva.discordId);

  // 1) Pré-sorteio.
  if ((t.rounds || []).length === 0 && !t.final) {
    const idx = (t.players || []).indexOf(alvo);
    if (idx < 0) return { ok: false, message: 'Jogador não está inscrito no torneio.' };
    if (!t.reservas.length) return { ok: false, message: 'Não há reservas na fila.' };
    const reservaId = t.reservas.shift();
    t.players[idx] = reservaId;
    return { ok: true, modo: 'pre-sorteio', alvo, reserva: reservaId, players: t.players.length };
  }

  // 2) Final em andamento: troca no time congelado.
  if (t.final && !t.champion) {
    if (![...t.final.teamOne, ...t.final.teamTwo].some((p) => p.discordId === alvo)) {
      return { ok: false, message: 'O jogador não está na final.' };
    }
    const reservaId = pegarReservaId();
    for (const key of ['teamOne', 'teamTwo']) {
      const idx = t.final[key].findIndex((p) => p.discordId === alvo);
      if (idx >= 0) t.final[key][idx] = { ...reserva, discordId: reservaId };
    }
    return { ok: true, modo: 'final', alvo, reserva: reservaId };
  }

  // 3) Rodadas.
  if ((t.rounds || []).length > 0) {
    const rodada = t.rounds[t.rounds.length - 1];
    const gameAberto = (rodada.games || []).find((g) => !g.winner &&
      [...g.teamOne, ...g.teamTwo].some((p) => p.discordId === alvo));
    if (gameAberto) {
      const reservaId = pegarReservaId();
      const pool = [...gameAberto.teamOne, ...gameAberto.teamTwo]
        .map((p) => (p.discordId === alvo ? { ...reserva, discordId: reservaId } : p));
      const teams = balanceFn(pool);
      gameAberto.teamOne = slimPlayers(teams.teamOne);
      gameAberto.teamTwo = slimPlayers(teams.teamTwo);
      // Re-stamp: o re-balance muda jogadores, nunca o NOME do time.
      for (const p of gameAberto.teamOne) p.timeNome = gameAberto.nomeTimeA || p.timeNome;
      for (const p of gameAberto.teamTwo) p.timeNome = gameAberto.nomeTimeB || p.timeNome;
      return { ok: true, modo: 'jogo', jogo: gameAberto.id, alvo, reserva: reservaId, rebalanceado: true };
    }
    const gameFechado = (rodada.games || []).find((g) => g.winner &&
      (g.winner === '1' ? g.teamOne : g.teamTwo).some((p) => p.discordId === alvo));
    if (gameFechado) {
      const reservaId = pegarReservaId();
      const lista = gameFechado.winner === '1' ? 'teamOne' : 'teamTwo';
      const idx = gameFechado[lista].findIndex((p) => p.discordId === alvo);
      const slot = gameFechado[lista][idx];
      gameFechado[lista][idx] = { ...reserva, discordId: reservaId, timeNome: slot?.timeNome };
      return { ok: true, modo: 'proxima-rodada', jogo: gameFechado.id, alvo, reserva: reservaId };
    }
    return { ok: false, message: 'O desistente já está eliminado — a reserva permanece na fila.' };
  }

  return { ok: false, message: 'Não há vaga aberta para substituição neste momento.' };
}

// ─── Ausência: avaliação pura (Discord fica no chamador) ────────────────────
// presenteMap: { [gameId]: [...discordId conectados no lobby] }.
// Retorna { fase: 'aviso'|'substituir'|'wo'|'limpar'|null, alvos, wo, substituto }.
// fases: 'aviso' (T+5min), 'substituir' (T+10min — COM reserva/reforço disponível),
// 'wo' (T+20min — SEM nenhum substituto: lado do ausente perde), 'limpar'.
// `wo` (informativo) = alvos sem substituto pós-aviso, p/ o tick avisar o W.O.
// pendente. Na FINAL lado vem null (W.O. não é automático — staff registra).
// Alvo com ausentes nos DOIS lados: lado null (staff decide).
function avaliarAusencia(t, nowMs = Date.now(), presenteMap = {}) {
  const out = { fase: null, alvos: [], wo: [], substituto: null };
  if (!t?.active || t.champion || t.adiado?.em) return out;
  const AVISO_MS = AUSENCIA_AVISO_MIN * 60000;

  // Fonte única: última rodada OU a final (também movida p/ lobby).
  let marcador = null;
  const jogos = [];
  const lastN = (t.rounds || []).length;
  if (lastN) {
    marcador = t.rounds[lastN - 1].ausencia || null;
    for (const g of t.rounds[lastN - 1].games || []) {
      jogos.push({
        id: g.id, winner: g.winner,
        t1: (g.teamOne || []).map((p) => p.discordId),
        t2: (g.teamTwo || []).map((p) => p.discordId),
        final: false
      });
    }
  } else if (t.final && !t.champion) {
    marcador = t.final.ausencia || null;
    jogos.push({
      id: 'FINAL', winner: null, final: true,
      t1: (t.final.teamOne || []).map((p) => p.discordId),
      t2: (t.final.teamTwo || []).map((p) => p.discordId)
    });
  }
  if (!marcador?.criadoEm || marcador.aplicadoEm) return out;
  const desdeCriacaoMs = nowMs - Date.parse(marcador.criadoEm);
  if (!Number.isFinite(desdeCriacaoMs) || desdeCriacaoMs < 0) return out;

  const alvos = jogos
    .filter((g) => !g.winner)
    .map((g) => {
      const presentes = new Set(presenteMap[g.id] || []);
      const ids = [...g.t1, ...g.t2].filter((id) => !presentes.has(id));
      const lado = ids.length && ids.every((id) => g.t1.includes(id)) ? '1'
        : ids.length && ids.every((id) => g.t2.includes(id)) ? '2' : null;
      return { gameId: g.id, ids, lado, final: Boolean(g.final) };
    })
    .filter((a) => a.ids.length > 0);

  if (!marcador.avisoEm) {
    if (desdeCriacaoMs >= AVISO_MS && alvos.length) {
      out.fase = 'aviso';
      out.alvos = alvos;
    }
    return out;
  }
  const desdeAvisoMs = nowMs - Date.parse(marcador.avisoEm);
  if (!Number.isFinite(desdeAvisoMs) || desdeAvisoMs < 0) return out;

  // Cadeia T+10: reserva da fila → reforço do pool morto (rodadas anteriores).
  const candidato = escolherSubstituto(t);
  out.substituto = candidato; // { tipo: 'reserva'|'reforco', id } | null
  // Alvos SEM nenhum substituto — futuros W.O. (na final, lado null).
  out.wo = candidato ? [] : alvos.filter((a) => desdeAvisoMs >= AVISO_MS);
  if (desdeAvisoMs >= AVISO_MS) {
    if (candidato) {
      out.fase = alvos.length ? 'substituir' : 'limpar';
      out.alvos = alvos;
    } else if (desdeCriacaoMs >= AUSENCIA_WO_MIN * 60000) {
      out.fase = alvos.length ? 'wo' : 'limpar';
      out.alvos = alvos;
    }
  }
  return out;
}

// ─── Reforço: pool morto (perdedores NÃO repescados de rodadas anteriores) ──
// Vivem na fila da cadeia: reserva da fila > reforço melhor elo. Exclui quem
// já está em jogo (rodada corrente ou final). Em R1 não existe pool (não há
// rodada anterior) — aí só reserva resolve; sem nada, o tick escala p/ W.O.
function poolMortos(t) {
  const lastN = (t.rounds || []).length;
  if (!lastN) return [];
  const vivos = new Set();
  for (const g of t.rounds[lastN - 1].games || []) {
    for (const p of [...g.teamOne, ...g.teamTwo]) vivos.add(p.discordId);
  }
  if (t.final && !t.champion) {
    for (const p of [...t.final.teamOne, ...t.final.teamTwo]) vivos.add(p.discordId);
  }
  const mortos = [];
  const seen = new Set();
  for (let n = 1; n < lastN; n++) {
    for (const p of roundLosers(t, n)) {
      if (seen.has(p.discordId) || vivos.has(p.discordId)) continue;
      seen.add(p.discordId);
      mortos.push(p);
    }
  }
  return mortos.sort((a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0));
}

// Próximo substituto disponível na cadeia (reserva da fila → reforço do pool).
function escolherSubstituto(t) {
  if (!t?.active || t.champion) return null;
  const resId = peakReserva(t);
  if (resId) return { tipo: 'reserva', id: resId };
  const reforco = poolMortos(t)[0] || null;
  if (reforco) return { tipo: 'reforco', id: reforco.discordId };
  return null;
}

// Jogo em aberto (não registrado) da última rodada com o jogador — p/ W.O. manual.
function jogoAbertoDePlayer(t, id) {
  const lastN = (t.rounds || []).length;
  if (!lastN) return null;
  for (const g of t.rounds[lastN - 1].games || []) {
    if (g.winner) continue;
    if ((g.teamOne || []).some((p) => p.discordId === id)) return { gameId: g.id, lado: '1' };
    if ((g.teamTwo || []).some((p) => p.discordId === id)) return { gameId: g.id, lado: '2' };
  }
  return null;
}

// W.O. automático: lado do ausente perde (na FINAL e com lado ambíguo → staff).
function aplicarWalkover(t, alvos, nowMs = Date.now()) {
  const out = { aplicados: [], ambiguos: [] };
  for (const a of alvos || []) {
    if (a.final || !a.lado) { out.ambiguos.push(a); continue; }
    const r = recordGameResult(t, a.gameId, a.lado === '1' ? '2' : '1');
    if (r.ok) out.aplicados.push({ gameId: a.gameId, vencedor: a.lado === '1' ? '2' : '1', alvos: a.ids });
    else out.ambiguos.push(a);
  }
  return out;
}

// ⏸ Adiar: pausa ausência/timeout/substituições sem punir ninguém. Categoria e
// lobbies ficam como estão; `!torneio retomar` religa e RENOVA as janelas.
function adiarTorneio(t, nowMs = Date.now()) {
  if (!t?.active) return { ok: false, message: 'Nenhum torneio ativo.' };
  if (t.adiado?.em) return { ok: false, message: 'O torneio já está adiado — use `!torneio retomar`.' };
  t.adiado = { em: new Date(nowMs).toISOString() };
  return { ok: true };
}

// ▶️ Retomar: limpa o adiado, renova o timeout da rodada/final e REINICIA a
// janela de ausência (evita W.O. instantâneo injusto logo após a volta).
function retomarTorneio(t, nowMs = Date.now()) {
  if (!t?.active) return { ok: false, message: 'Nenhum torneio ativo.' };
  if (!t.adiado) return { ok: false, message: 'O torneio não está adiado.' };
  t.adiado = null;
  prorrogarRodada(t, nowMs);
  const alvo = alvoTimeout(t);
  if (alvo?.ausencia) {
    alvo.ausencia = { criadoEm: new Date(nowMs).toISOString(), avisoEm: null, aplicadoEm: null };
  }
  if (alvo) alvo.woAvisadoEm = null;
  return { ok: true, janela: RODADA_TIMEOUT_MIN };
}

// `!torneio encerrar` só aborta antes do 1º sorteio (ou com o torneio já campeão).
function podeEncerrar(t) {
  if (!t?.active) return { ok: false, message: 'Nenhum torneio ativo.' };
  if ((t.rounds || []).length > 0 && !t.champion) {
    return { ok: false, message: 'O torneio já começou — só termina com **campeão**.' };
  }
  return { ok: true };
}

// ─── Timeout de rodada/final + guard do !torneiooff ─────────────────────────
// Alvo do timeout: última rodada em aberto OU a final (se aberta).
function alvoTimeout(t) {
  if (!t) return null;
  const roundN = (t.rounds || []).length;
  if (t.final && !t.champion) return t.final;
  const rodada = roundN ? t.rounds[roundN - 1] : null;
  if (rodada && !roundComplete(t, roundN)) return rodada;
  return null;
}

// { atrasada, minutos, alvo: 'R2'|'FINAL' } para o rodada/final em aberto.
function avaliarTimeoutRodada(t, nowMs) {
  const alvo = alvoTimeout(t);
  if (!alvo?.iniciadoEm) return { atrasada: false, minutos: 0, alvo: null };
  const roundN = (t.rounds || []).length;
  const titulo = (t.final && !t.champion) ? 'FINAL' : `R${roundN}`;
  const minutos = Math.floor((nowMs - new Date(alvo.iniciadoEm).getTime()) / 60000);
  return { atrasada: minutos >= RODADA_TIMEOUT_MIN, minutos, alvo: titulo };
}

// Renova a janela do timeout (staff: `!torneio prorrogar`) e limpa o aviso pendente.
function prorrogarRodada(t, nowMs) {
  const alvo = alvoTimeout(t);
  if (!alvo) return { ok: false, message: 'Nenhuma rodada ou final em aberto para prorrogar.' };
  alvo.iniciadoEm = new Date(nowMs).toISOString();
  alvo.timeoutAvisadoEm = null;
  const roundN = (t.rounds || []).length;
  return { ok: true, alvo: (t.final && !t.champion) ? 'FINAL' : `R${roundN}` };
}

// !torneiooff não passa por cima de torneio JÁ SORTEADO — ele só termina com campeão.
// Antes do 1º sorteio, off segue livre (fecha inscrições; `!torneio encerrar` aborta).
function podeDesativar(t) {
  if (t && !t.champion && (t.rounds || []).length > 0) {
    return { ok: false, message: 'Torneio já sorteado — só termina com **campeão**. Registre os resultados com `!torneio resultado` (rodada em aberto).' };
  }
  return { ok: true };
}

const DIAS_PT = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, 'terça': 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6, 'sábado': 6 };
function parseDiasArg(raw) {
  const parts = String(raw || '').split(/[,\s/]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const dias = [];
  for (const part of parts) {
    if (/^[0-6]$/.test(part)) {
      if (!dias.includes(Number(part))) dias.push(Number(part));
      continue;
    }
    const key = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (DIAS_PT[key] !== undefined && !dias.includes(DIAS_PT[key])) dias.push(DIAS_PT[key]);
  }
  return dias.sort();
}

function parseHoraArg(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})(?::|h)?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatAgenda(agenda) {
  if (!agenda?.dias?.length) return 'sem agendamento';
  const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const dias = agenda.dias.map((d) => nomes[d]).join(', ');
  const hora = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const insc = Number(agenda.diasInscricao) > 0 ? Math.floor(Number(agenda.diasInscricao)) : INSCRICOES_DIAS_DEFAULT;
  return `${dias} • abre ${hora(agenda.abrirMin)} • inscrições ${insc} dia(s)`;
}

// Agenda: dias + hora de abrir (+ dias de inscrição, padrão 7).
function setAgenda(t, diasRaw, abrirRaw, diasInscricaoRaw) {
  const dias = parseDiasArg(diasRaw);
  const abrirMin = parseHoraArg(abrirRaw);
  if (dias.length === 0) return { ok: false, message: 'Dias inválidos. Ex: `sex,sab` ou `5,6`.' };
  if (abrirMin === null) return { ok: false, message: 'Horário inválido. Ex: `19:00`.' };
  const diasInscricao = Number(diasInscricaoRaw) > 0 ? Math.floor(Number(diasInscricaoRaw)) : INSCRICOES_DIAS_DEFAULT;
  t.agenda = { dias, abrirMin, diasInscricao };
  return { ok: true, agenda: t.agenda };
}

// Decide se deve abrir automaticamente agora (ou null). Abre 1x/dia no dia/hora
// agendados e nunca sobrescreve um torneio em andamento — o que evita duplicar
// com a ativação manual (`!torneioon` grava torneioAbertoEm = hoje).
function autoTorneioAction(t, nowMs = Date.now(), flags = {}) {
  const agenda = t?.agenda;
  if (!agenda?.dias?.length) return null;
  const { getSPParts } = require('./eventoService');
  const parts = getSPParts(nowMs);
  const wd = weekdayIndex(parts.weekday);
  if (wd < 0 || !agenda.dias.includes(wd)) return null;
  if (parts.minutes < agenda.abrirMin) return null;
  if (flags.abertoEm === parts.key) return null;
  if (torneioEmAndamento(t)) return null;
  return { action: 'abrir', dateKey: parts.key };
}

function dateKeySP(nowMs = Date.now()) {
  const { getSPParts } = require('./eventoService');
  return getSPParts(nowMs).key;
}

function weekdayIndex(weekdayStr) {
  const map = { dom: 0, sun: 0, seg: 1, mon: 1, ter: 2, tue: 2, qua: 3, wed: 3, qui: 4, thu: 4, sex: 5, fri: 5, sab: 6, sat: 6 };
  const wd = String(weekdayStr || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  return map[wd] ?? -1;
}
function getStatus(t) {
  if (!t?.active) return { active: false };
  const lastN = (t.rounds || []).length;
  const pending = lastN ? roundGames(t, lastN).filter((g) => !g.winner).map((g) => g.id) : [];
  normalizarReservas(t);
  return {
    active: true,
    edition: t.edition,
    inscritos: (t.players || []).length,
    inscricoes: t.inscricoes !== false,
    inscricoesAte: t.inscricoesAte || null,
    reservas: (t.reservas || []).length,
    reservasLista: [...(t.reservas || [])],
    origem: t.origem || null,
    rodada: lastN,
    jogosPendentes: pending,
    final: Boolean(t.final),
    placarFinal: t.final ? `${t.final.wins1}x${t.final.wins2}` : null,
    champion: t.champion
  };
}

module.exports = {
  MIN_PLAYERS,
  TEAM_SIZE,
  FINAL_SIZE,
  TORNEIO_CARGO_NOME,
  TORNEIO_INFO,
  INSCRICOES_DIAS_DEFAULT,
  AUSENCIA_AVISO_MIN,
  AUSENCIA_SUBSTITUICAO_MIN,
  addDias,
  newTournament,
  novaEdicao,
  renovarInscricoes,
  inscricoesVencidas,
  fecharInscricoes,
  torneioEmAndamento,
  joinTournament,
  leaveTournament,
  startRequirement,
  drawGames,
  findGame,
  recordGameResult,
  roundGames,
  roundComplete,
  roundWinners,
  roundLosers,
  advanceTournament,
  recordFinalGame,
  getStatus,
  parseDiasArg,
  parseHoraArg,
  formatAgenda,
  setAgenda,
  weekdayIndex,
  dateKeySP,
  autoTorneioAction,
  normalizarReservas,
  peakReserva,
  promoverReserva,
  rebalanceGame,
  substituirDesistente,
  avaliarAusencia,
  podeEncerrar,
  nomeLetraTime,
  atribuirNomesTimes,
  timesVencedores,
  timesPerdedores,
  pairTeamsEmJogos,
  RODADA_TIMEOUT_MIN,
  avaliarTimeoutRodada,
  prorrogarRodada,
  podeDesativar,
  AUSENCIA_WO_MIN,
  poolMortos,
  escolherSubstituto,
  jogoAbertoDePlayer,
  aplicarWalkover,
  adiarTorneio,
  retomarTorneio
};
