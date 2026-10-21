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
  '🏆 **TORNEIO CAPS ARENA** — fase de pontos + final MD3.\n' +
  '• Inscrição individual: `!torneio entrar` (mínimo 20, múltiplo de 10)\n' +
  '• No início o bot sorteia **4 times de 5** (balanceados por elo) — times **FIXOS** até a final\n' +
  '• Staff: `!torneio start` inicia manualmente com os inscritos; fecha no múltiplo de 10 e envia excedentes para reservas\n' +
  '• **Fase 1**: todos contra todos — **3 rodadas** x 2 confrontos (todo time encara os 3 rivais)\n' +
  '• Cada confronto é **MD2** (2 mapas): 1º mapa com lado sorteado, 2º mapa com lados invertidos, MESMO time\n' +
  '• **Pontos**: 2x0 = **3 pts** • 1x1 = **1 pt** pra cada\n' +
  '• **Ausência** (por mapa): aviso em **5 min**; **10 min** = entra **reserva** (sem fila: **reforço** = perdedor de mapa concluído); **20 min** sem alternativa = **W.O. técnico** (o mapa conta pro lado presente)\n' +
  '• Rodada em aberto: **90 min** de resultado — a staff pode `prorrogar` ou **adiar⏸/retomar▶️**\n' +
  '• Classificação: **pontos → saldo de mapas → confronto direto** (empate do 2º lugar entre 3 iguais: staff decide)\n' +
  '• Os **2 melhores** somando pontos fazem a **FINAL MD3** com os **mesmos times**\n' +
  '• Lados na final: **1º colocado escolhe o lado do J1** (`!torneio lado 1|2`) • **J2 inverte** • **J3** (em 1x1): o time que venceu o **J1** escolhe\n' +
  '• 🚫 **FEARLESS na final**: proibido pickar campeão usado na partida anterior da série\n' +
  '• **Pause**: cada time tem direito a **1 pause de até 5 min por jogo** — aciona pelo `/pause` dentro do jogo (personalizada); quem pausou não precisa avisar para despausar\n' +
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
      if (ehF1(t)) {
        // Fase de pontos: times são FIXOS — a reserva entra NA VAGA do ausente,
        // no mesmo lado (sem re-balance). O swap vale pra TODOS os mapas em
        // aberto da rodada e nos times canônicos (senão consome 2 reservas).
        const rodada = t.rounds[t.rounds.length - 1];
        const fatia = { ...reserva, discordId: reservaId, timeNome: null };
        for (const g of rodada.games || []) {
          if (g.winner) continue;
          for (const key of ['teamOne', 'teamTwo']) {
            const idx = (g[key] || []).findIndex((p) => p.discordId === alvo);
            if (idx >= 0) {
              fatia.timeNome = g[key][idx]?.timeNome || (key === 'teamOne' ? g.nomeTimeA : g.nomeTimeB);
              g[key][idx] = { ...fatia };
            }
          }
        }
        for (const time of t.times || []) {
          const idx = (time.players || []).findIndex((p) => String(p.discordId) === alvo);
          if (idx >= 0) time.players[idx] = { ...fatia };
        }
        return { ok: true, modo: 'jogo-f1', jogo: gameAberto.id, alvo, reserva: reservaId, rebalanceado: false };
      }
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
      if (ehF1(t)) {
        for (const time of t.times || []) {
          const i = (time.players || []).findIndex((p) => String(p.discordId) === alvo);
          if (i >= 0) time.players[i] = { ...reserva, discordId: reservaId, timeNome: slot?.timeNome };
        }
      }
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
  const sortMmr = (a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0);
  if (ehF1(t)) {
    // F1: reforço = perdedor de mapa CONCLUÍDO (qualquer rodada, a corrente
    // inclui) que NÃO esteja escalado em jogo em aberto (dele ou da final).
    const emAberto = new Set();
    for (let n = 1; n <= lastN; n++) {
      for (const g of roundGames(t, n)) {
        if (g.winner) continue;
        for (const p of [...g.teamOne, ...g.teamTwo]) emAberto.add(p.discordId);
      }
    }
    if (t.final && !t.champion) {
      for (const p of [...t.final.teamOne, ...t.final.teamTwo]) emAberto.add(p.discordId);
    }
    const seen = new Set();
    const mortos = [];
    for (let n = 1; n <= lastN; n++) {
      for (const p of roundLosers(t, n)) {
        if (seen.has(p.discordId) || emAberto.has(p.discordId)) continue;
        seen.add(p.discordId);
        mortos.push(p);
      }
    }
    return mortos.sort(sortMmr);
  }
  // Mata-mata (legado): vivos = TODOS escalados da última rodada + final.
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
  return mortos.sort(sortMmr);
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
// ─── FASE DE PONTOS v1 (formato 'F1') ──────────────────────────────────────
// Times de 5 sorteados UMA VEZ (fixos até a final). Cada rodada: confrontos
// MD2 = 2 mapas (lados invertidos), 2x0=3pts, 1x1=1pt. Top 2 na soma → final
// MD3 com os MESMOS times, 1º colocado escolhe o lado do J1.
// ROLLBACK: se a staff/quem quiser voltar ao mata-mata v1 (repescagem), troque
// para 'legado' — o motor antigo segue intacto (estado novo adota o default).
const TORNEIO_FORMATO_DEFAULT = 'F1';

function ehF1(t) {
  return t?.formato === 'F1';
}

// Sorteia os times fixos: agrupa por elo (serpentina em metades) e balanceia
// cada grupo de 10 com balanceFn → 4 times de 5 com força pareada.
function drawFixedTeams(t, pool, balanceFn, nTimes = 4) {
  const sorted = [...(pool || [])].sort((a, b) => Number(b.baseMmr || 0) - Number(a.baseMmr || 0));
  const gruposDe10 = Math.max(1, Math.floor(nTimes / 2));
  const groups = Array.from({ length: gruposDe10 }, () => []);
  sorted.forEach((p, idx) => {
    const volta = Math.floor(idx / gruposDe10);
    const g = volta % 2 === 0 ? idx % gruposDe10 : gruposDe10 - 1 - (idx % gruposDe10);
    groups[g].push(p);
  });
  t.timeSeq ||= 0;
  const times = [];
  for (const group of groups) {
    const duo = balanceFn(group);
    times.push(duo.teamOne, duo.teamTwo);
  }
  return times.slice(0, nTimes).map((players, i) => {
    const nome = `TIME ${nomeLetraTime(t.timeSeq++)}`;
    for (const p of players) p.timeNome = nome;
    return {
      id: String(i + 1),
      nome,
      players: slimPlayers(players).map((p) => ({ ...p, timeNome: nome })),
      pontos: 0, mapasV: 0, mapasP: 0
    };
  });
}

// Grade round-robin clássica (círculo): n par → n-1 rodadas, n/2 confrontos.
// Retorna [[{ timeA: id, timeB: id }]] por rodada.
function gerarGradeRoundRobin(ids = []) {
  if (!ids || ids.length < 2 || ids.length % 2 !== 0) return [];
  const lista = [...ids];
  const fixo = lista[0];
  const rot = lista.slice(1);
  const rodadas = [];
  for (let r = 0; r < lista.length - 1; r++) {
    const confrontos = [{ timeA: fixo, timeB: rot[rot.length - 1] }];
    for (let i = 0; i < Math.floor(rot.length / 2); i++) {
      confrontos.push({ timeA: rot[i], timeB: rot[rot.length - 2 - i] });
    }
    rodadas.push(confrontos);
    rot.unshift(rot.pop());
  }
  return rodadas;
}

const F1_PTS_VITORIA = 3;
const F1_PTS_EMPATE = 1;

// Cria a próxima rodada da fase 1 (mapas dos confrontos) — os rosters vêm dos
// times FIXOS; o 1º mapa do confronto tem lado aleatório, o 2º inverte (cosmético
// — rosts ficam teamOne/timeA fixos pra identidade).
function gerarJogosFase1(t, numRodada) {
  const gradeRodada = t.fase1?.grade?.[numRodada - 1] || [];
  let seq = 0;
  const games = [];
  const confrontos = gradeRodada.map((par, ci) => {
    const idC = `R${numRodada}-C${ci + 1}`;
    const timeA = (t.times || []).find((x) => x.id === String(par.timeA));
    const timeB = (t.times || []).find((x) => x.id === String(par.timeB));
    if (!timeA || !timeB) throw new Error(`Time ausente na grade: ${par.timeA}/${par.timeB}`);
    const jogos = [1, 2].map((k) => {
      seq += 1;
      const id = `R${numRodada}-J${seq}`;
      const g = {
        id, confronto: idC, mapa: k,
        nomeTimeA: timeA.nome, nomeTimeB: timeB.nome,
        teamOne: slimPlayers(timeA.players), teamTwo: slimPlayers(timeB.players),
        winner: null
      };
      for (const p of g.teamOne) p.timeNome = timeA.nome;
      for (const p of g.teamTwo) p.timeNome = timeB.nome;
      return g;
    });
    games.push(...jogos);
    return { id: idC, timeA: timeA.id, timeB: timeB.id, jogo1: jogos[0].id, jogo2: jogos[1].id, resultado: null };
  });
  return { games, confrontos };
}

// Sortear/avançar: nova rodada OU (fase concluída) a FINAL. `forcarSegundo`
// destrava empate no 2º lugar: a staff indica o time classificado por letra.
function sortearFase1(t, { forcarSegundo = null } = {}, nowMs = Date.now()) {
  if (!ehF1(t)) return { ok: false, message: 'Este torneio não é do formato de fase de pontos.' };
  if (!t.fase1?.grade?.length) return { ok: false, message: 'Nenhum torneio sorteado ainda.' };
  if (t.final) return { ok: false, message: 'A final já está rolando.' };

  const rodadasFeitas = (t.rounds || []).length;
  if (rodadasFeitas > 0) {
    // Auto-consistência: confrontos com os 2 mapas fechados ganham resultado
    // (o comando `!torneio resultado` já faz isso; aqui cobre estados manuais).
    fecharConfrontosRodada(t);
    const atual = t.rounds[rodadasFeitas - 1];
    if (!(atual.confrontos || []).every((c) => c.resultado)) {
      return { ok: false, message: `A rodada ${rodadasFeitas} ainda tem confrontos em aberto — registre com \`!torneio resultado\`.` };
    }
  }
  if (rodadasFeitas >= t.fase1.grade.length) {
    return concluirFase1(t, { forcarSegundo }, nowMs);
  }
  const { games, confrontos } = gerarJogosFase1(t, rodadasFeitas + 1);
  t.rounds.push({
    n: rodadasFeitas + 1, games, confrontos, ausencia: null,
    iniciadoEm: new Date(nowMs).toISOString()
  });
  return { ok: true, type: 'round', round: rodadasFeitas + 1, games };
}

// Fecha confrontos (de todas as rodadas, ou da rodada `roundN`) cujos 2 mapas
// já têm vencedor → calcula os pontos.
function fecharConfrontosRodada(t, roundN = null) {
  const rounds = roundN ? (t.rounds || []).filter((r) => r.n === roundN) : (t.rounds || []);
  const novos = [];
  for (const round of rounds) {
    const jogosDe = (id) => (round.games || []).find((g) => g.id === id);
    for (const c of round.confrontos || []) {
      if (c.resultado) continue;
      const j1 = jogosDe(c.jogo1);
      const j2 = jogosDe(c.jogo2);
      if (!j1?.winner || !j2?.winner) continue;
      const wa = (j1.winner === '1' ? 1 : 0) + (j2.winner === '1' ? 1 : 0);
      const wb = 2 - wa;
      const ptsde = (w) => (w === 2 ? F1_PTS_VITORIA : w === 1 ? F1_PTS_EMPATE : 0);
      c.resultado = { wa, wb, ptsA: ptsde(wa), ptsB: ptsde(wb) };
      novos.push({ confronto: c, wa, wb, ptsA: c.resultado.ptsA, ptsB: c.resultado.ptsB });
    }
  }
  return novos;
}

function confrontoEntre(t, idA, idB) {
  for (const round of t.rounds || []) {
    for (const c of round.confrontos || []) {
      if ((c.timeA === String(idA) && c.timeB === String(idB)) ||
          (c.timeA === String(idB) && c.timeB === String(idA))) return c;
    }
  }
  return null;
}

// Classificação: pontos → saldo de mapas → confronto direto → ordem estável.
function calcClassificacao(t) {
  const base = (t.times || []).map((time, idx) => ({
    id: time.id, nome: time.nome, pontos: 0, mapasV: 0, mapasP: 0, idx
  }));
  for (const round of t.rounds || []) {
    for (const c of round.confrontos || []) {
      if (!c.resultado) continue;
      const A = base.find((b) => b.id === c.timeA);
      const B = base.find((b) => b.id === c.timeB);
      if (A) { A.pontos += c.resultado.ptsA; A.mapasV += c.resultado.wa; A.mapasP += c.resultado.wb; }
      if (B) { B.pontos += c.resultado.ptsB; B.mapasV += c.resultado.wb; B.mapasP += c.resultado.wa; }
    }
  }
  base.sort((x, y) => {
    if (y.pontos !== x.pontos) return y.pontos - x.pontos;
    const sx = x.mapasV - x.mapasP;
    const sy = y.mapasV - y.mapasP;
    if (sy !== sx) return sy - sx;
    const c = confrontoEntre(t, x.id, y.id);
    if (c?.resultado) {
      const dx = x.id === c.timeA ? c.resultado.ptsA - c.resultado.ptsB : c.resultado.ptsB - c.resultado.ptsA;
      if (dx) return dx;
    }
    return x.idx - y.idx;
  });
  return base;
}

// Fase 1 acabou quando todo confronto de toda rodada tem resultado.
function fase1Concluida(t) {
  const rodadas = t?.rounds || [];
  return rodadas.length >= (t?.fase1?.grade?.length || 0) &&
    rodadas.every((r) => (r.confrontos || []).every((c) => c.resultado));
}

// Fim da fase: top 2 → FINAL congelada. `forcarSegundo` (id do time) resolve
// empate no 2º lugar que os critérios não desempataram.
function concluirFase1(t, { forcarSegundo = null } = {}, nowMs = Date.now()) {
  if (t.final) return { ok: false, message: 'A final já está rolando.' };
  if (!fase1Concluida(t)) return { ok: false, message: 'A fase 1 ainda não terminou — confrontos em aberto.' };
  const cls = calcClassificacao(t);
  const primeiro = cls[0];
  let segundo = cls[1];
  if (forcarSegundo) {
    segundo = cls.find((c) => c.id === String(forcarSegundo));
    if (!segundo) return { ok: false, message: `Time "${forcarSegundo}" não existe na classificação.` };
    if (segundo.id === primeiro.id) return { ok: false, message: 'O 2º classificado não pode ser o próprio 1º.' };
  } else if (cls[2] && segundo.pontos === cls[2].pontos &&
      (segundo.mapasV - segundo.mapasP) === (cls[2].mapasV - cls[2].mapasP)) {
    // empate no corte: confronto direto já foi critério; sem desempate automático
    const c = confrontoEntre(t, segundo.id, cls[2].id);
    if (!c?.resultado || c.resultado.ptsA === c.resultado.ptsB) {
      return {
        ok: false, message: 'Empate no 2º lugar sem desempate automático — staff decide:',
        classificacao: cls,
        exemplo: `\`!torneio sortear ${segundo.nome.replace('TIME ', '')}\` classifica o ${segundo.nome}`
      };
    }
  }
  const time1 = (t.times || []).find((x) => x.id === primeiro.id);
  const time2 = (t.times || []).find((x) => x.id === segundo.id);
  t.final = {
    teamOne: slimPlayers(time1.players),
    teamTwo: slimPlayers(time2.players),
    nomeTime1: time1.nome, nomeTime2: time2.nome,
    // 1º colocado escolhe o lado do J1 (staff: `!torneio lado 1|2`).
    sides: { j1: null },
    games: [], wins1: 0, wins2: 0, ausencia: null,
    iniciadoEm: new Date(nowMs).toISOString()
  };
  t.fase1.concluidaEm = new Date(nowMs).toISOString();
  return { ok: true, type: 'final', final: t.final, classificacao: cls };
}

// Lado da final: `lado` ('1'|'2') = qual time fica AZUL no mapa.
// j1 = escolha do 1º colocado; j3 = escolha do vencedor do J1 (só em 1x1).
function definirLadoFinal(t, lado, mapa = 'j1') {
  if (!t?.final || t.champion) return { ok: false, message: 'Não há final em andamento.' };
  const v = String(lado);
  if (!['1', '2'].includes(v)) {
    return { ok: false, message: 'Use `!torneio lado <1|2>` [j3] — 1 = 1º colocado/time 1 no azul e 2 = o lado fica com o time 2.' };
  }
  if (mapa === 'j3') {
    if (!(t.final.wins1 === 1 && t.final.wins2 === 1)) {
      return { ok: false, message: 'O J3 só acontece em 1x1 — registre o resultado antes.' };
    }
  } else if (t.final.games.length > 0) {
    return { ok: false, message: 'O lado do J1 já está definido (o J1 já teve resultado).' };
  }
  t.final.sides[mapa] = v;
  return { ok: true, mapa, lado: v };
}

function getStatus(t) {
  if (!t?.active) return { active: false };
  const lastN = (t.rounds || []).length;
  const pending = lastN ? roundGames(t, lastN).filter((g) => !g.winner).map((g) => g.id) : [];
  normalizarReservas(t);
  return {
    active: true,
    formato: t.formato || 'F1',
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
    finalEscolhaLado: Boolean(t.final && !t.champion && t.final.sides?.j1 == null),
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
  retomarTorneio,
  // Fase de Pontos v1 (formato 'F1')
  ehF1,
  drawFixedTeams,
  gerarGradeRoundRobin,
  sortearFase1,
  fecharConfrontosRodada,
  calcClassificacao,
  fase1Concluida,
  concluirFase1,
  definirLadoFinal,
  TORNEIO_FORMATO_DEFAULT,
  F1_PTS_VITORIA,
  F1_PTS_EMPATE
};
