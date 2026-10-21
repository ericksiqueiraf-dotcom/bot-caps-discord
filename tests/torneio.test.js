const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const T = require('../services/torneioService');
const { createBalancedTeams } = require('../services/balanceService');
const { getSPParts, runTorneioTick } = require('../services/eventoService');
const legacy = require('../commands/legacyCommands');
const { Collection } = require('discord.js');

function pool(n, base = 2000) {
  return Array.from({ length: n }, (_, i) => ({ discordId: `u${i + 1}`, nickname: `P${i + 1}`, baseMmr: base - i * 50 }));
}

function balance(group) {
  return createBalancedTeams(group);
}

// Menor diferença de elo possível para um grupo (força bruta, C(n, n/2)).
function bruteMinDiff(group) {
  const weight = (p) => Number(p.baseMmr || 0);
  const total = group.reduce((s, p) => s + weight(p), 0);
  const half = group.length / 2;
  let best = Number.POSITIVE_INFINITY;
  (function rec(start, cur) {
    if (cur.length === half) {
      const s1 = cur.reduce((s, p) => s + weight(p), 0);
      best = Math.min(best, Math.abs(s1 - (total - s1)));
      return;
    }
    for (let i = start; i < group.length; i++) {
      cur.push(group[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  })(0, []);
  return best;
}

describe('torneio CAPS ARENA', () => {
  it('inscricao: entra, nao duplica, sai, trava apos inicio', () => {
    const t = T.newTournament(1);
    assert.equal(T.joinTournament(t, 'u1').count, 1);
    assert.equal(T.joinTournament(t, 'u1').ok, false);
    assert.equal(T.leaveTournament(t, 'u2').ok, false);
    assert.equal(T.leaveTournament(t, 'u1').count, 0);
  });

  it('exige minimo 20 e multiplo de 10', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 19; i++) T.joinTournament(t, `u${i}`);
    assert.equal(T.startRequirement(t).ok, false);
    T.joinTournament(t, 'u20');
    T.joinTournament(t, 'u21');
    assert.equal(T.startRequirement(t).ok, false);
    for (let i = 22; i <= 30; i++) T.joinTournament(t, `u${i}`);
    assert.equal(T.startRequirement(t).ok, true);
  });

  it('20 inscritos: 2 jogos -> 10 vencedores -> final MD3', () => {
    const t = T.newTournament(1);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    assert.equal(T.startRequirement(t).ok, true);
    const games = T.drawGames(players, balance, 'R1');
    assert.equal(games.length, 2);
    t.rounds.push({ n: 1, games });
    for (const g of games) assert.equal(T.recordGameResult(t, g.id, '1').ok, true);
    assert.equal(T.roundComplete(t, 1), true);
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.ok, true);
    assert.equal(adv.type, 'final');
    assert.equal(t.final.teamOne.length, 5);
    let r = T.recordFinalGame(t, '1');
    assert.equal(r.champion, false);
    r = T.recordFinalGame(t, '2');
    assert.equal(r.champion, false);
    r = T.recordFinalGame(t, '1');
    assert.equal(r.champion, true);
    assert.equal(t.champion.team.length, 5);
    assert.equal(t.champion.placar, '2x1');
  });

  it('30 inscritos: repescagem completa 20 (re-balance do torneio, letras continuam)', () => {
    const t = T.newTournament(2);
    const players = pool(30);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    T.atribuirNomesTimes(t, games);
    assert.equal(games.length, 3);
    t.rounds.push({ n: 1, games });
    for (const g of games) T.recordGameResult(t, g.id, '1');
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.ok, true);
    assert.equal(adv.type, 'round');
    assert.equal(adv.round, 2);
    assert.equal(adv.games.length, 2);
    assert.equal(adv.repechage.length, 5);
    // Repescados sao os 5 perdedores de maior elo (individual).
    const r1losers = T.roundLosers(t, 1).map((p) => p.discordId);
    assert.deepEqual(adv.repechage.map((p) => p.discordId).sort(), r1losers.slice(0, 5).sort());
    // Re-balance cria times novos com letras em sequência (R1 gastou A..F → R2 G..J).
    for (const g of adv.games) {
      assert.match(g.nomeTimeA, /^R2 TIME [G-J]$/);
      assert.match(g.nomeTimeB, /^R2 TIME [G-J]$/);
    }
    for (const g of adv.games) {
      for (const p of [...g.teamOne, ...g.teamTwo]) assert.equal(p.timeNome.startsWith('R2 TIME'), true);
    }
  });

  it('times nascem com nome estavel (R1 TIME A...) e levam ate a final sem re-sort', () => {
    const t = T.newTournament(2);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    T.atribuirNomesTimes(t, games);
    t.rounds.push({ n: 1, games });
    assert.equal(games[0].nomeTimeA, 'R1 TIME A');
    assert.equal(games[0].nomeTimeB, 'R1 TIME B');
    assert.equal(games[1].nomeTimeA, 'R1 TIME C');
    assert.equal(games[1].nomeTimeB, 'R1 TIME D');
    for (const p of games[0].teamOne) assert.equal(p.timeNome, 'R1 TIME A');
    // Vence o TIME A (J1) e o TIME C (J2): final é A 🆚 C com os mesmos 5 de cada.
    T.recordGameResult(t, 'R1-J1', '1');
    T.recordGameResult(t, 'R1-J2', '1');
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.type, 'final');
    assert.equal(t.final.nomeTime1, 'R1 TIME A');
    assert.equal(t.final.nomeTime2, 'R1 TIME C');
    assert.deepEqual(
      t.final.teamOne.map((p) => p.discordId).sort(),
      games[0].teamOne.map((p) => p.discordId).sort()
    );
  });

  it('substituicao em jogo aberto mantem o NOME do time muda so os jogadores', () => {
    const t = T.newTournament(2);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    T.atribuirNomesTimes(t, games);
    t.rounds.push({ n: 1, games });
    t.reservas = ['u25'];
    const alvo = games[1].teamTwo[0].discordId;
    const r = T.substituirDesistente(t, alvo, { discordId: 'u25', nickname: 'u25', baseMmr: 5000 }, balance);
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'jogo');
    const g = t.rounds[0].games.find((x) => x.id === games[1].id);
    assert.equal(g.nomeTimeA, games[1].nomeTimeA);
    assert.equal(g.nomeTimeB, games[1].nomeTimeB);
    for (const p of g.teamOne) assert.equal(p.timeNome, g.nomeTimeA);
    for (const p of g.teamTwo) assert.equal(p.timeNome, g.nomeTimeB);
    assert.ok([...g.teamOne, ...g.teamTwo].some((p) => p.discordId === 'u25'));
  });

  it('resultado invalido e jogo inexistente falham', () => {
    const t = T.newTournament(3);
    assert.equal(T.recordGameResult(t, 'R1-J1', '1').ok, false);
    assert.equal(T.recordGameResult(t, 'R1-J1', '3').ok, false);
    assert.equal(T.getStatus({}).active, false);
  });

  it('sorteio monta times balanceados pelo elo (diferenca otima)', () => {
    const players = pool(20);
    const games = T.drawGames(players, balance, 'R1');
    assert.equal(games.length, 2);
    for (const g of games) {
      const group = [...g.teamOne, ...g.teamTwo];
      const diff = Math.abs(
        g.teamOne.reduce((s, p) => s + p.baseMmr, 0) - g.teamTwo.reduce((s, p) => s + p.baseMmr, 0)
      );
      assert.equal(diff, bruteMinDiff(group));
    }
  });

  it('fechamento com 23: mantem os 20 primeiros e reserva os 3 ultimos', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 23; i++) T.joinTournament(t, `u${i}`);
    const r = T.fecharInscricoes(t);
    assert.equal(r.ok, true);
    assert.equal(r.kept, 20);
    assert.deepEqual(t.reservas, ['u21', 'u22', 'u23']);
    assert.equal(t.inscricoes, false);
    assert.equal(T.startRequirement(t).ok, true);
  });

  it('menos de 20 no prazo: nao fecha as inscricoes', () => {
    const t = T.novaEdicao(null, { dias: 7, nowMs: Date.UTC(2026, 0, 1) });
    for (let i = 1; i <= 15; i++) T.joinTournament(t, `u${i}`);
    assert.equal(T.fecharInscricoes(t).ok, false);
    assert.equal(t.inscricoes, true);
  });

  it('janela de inscricao: vence no prazo e renova', () => {
    const now = Date.UTC(2026, 9, 17, 22, 0);
    const t = T.novaEdicao(null, { origem: 'manual', dias: 7, nowMs: now });
    assert.equal(t.origem, 'manual');
    assert.equal(t.edition, 1);
    assert.equal(T.inscricoesVencidas(t, now + 6 * 86400000), false);
    assert.equal(T.inscricoesVencidas(t, now + 7 * 86400000), true);
    T.renovarInscricoes(t, 3, now);
    assert.equal(T.inscricoesVencidas(t, now + 2 * 86400000), false);
    assert.equal(T.inscricoesVencidas(t, now + 3 * 86400000), true);
  });

  it('agenda: abre no dia/hora, nao duplica o manual e respeita torneio em andamento', () => {
    const now = Date.UTC(2026, 9, 17, 22, 0); // sábado, 19:00 em São Paulo
    const parts = getSPParts(now);
    assert.equal(T.weekdayIndex(parts.weekday), 6);

    const t = T.newTournament(1);
    assert.equal(T.setAgenda(t, 'sab', '19:00', 5).ok, true);
    assert.equal(t.agenda.diasInscricao, 5);
    assert.match(T.formatAgenda(t.agenda), /abre 19:00 • inscrições 5 dia/);

    assert.deepEqual(T.autoTorneioAction(t, now, {}), { action: 'abrir', dateKey: parts.key });
    assert.equal(T.autoTorneioAction(t, now, { abertoEm: parts.key }), null);
    assert.equal(T.autoTorneioAction(t, Date.UTC(2026, 9, 17, 20, 0), {}), null); // antes da hora

    t.players.push('u1');
    assert.equal(T.autoTorneioAction(t, now, {}), null); // não sobrescreve torneio em andamento
  });

  it('nova edicao preserva a agenda e numera depois do campeao', () => {
    const base = T.newTournament(4);
    T.setAgenda(base, 'sex', '20:00', 7);
    base.champion = { team: ['a'], at: new Date().toISOString(), placar: '2x0' };
    const next = T.novaEdicao(base, { origem: 'agenda', dias: 7, nowMs: Date.now() });
    assert.equal(next.edition, 5);
    assert.equal(next.origem, 'agenda');
    assert.deepEqual(next.agenda, base.agenda);
    assert.equal(T.torneioEmAndamento(next), false);
  });

  it('tick: fecha as inscricoes vencidas com reservas', async () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 23; i++) T.joinTournament(t, `u${i}`);
    t.inscricoesAte = new Date(0).toISOString();
    const meta = { torneio: t, torneioHabilitado: true };
    const posts = [];
    await runTorneioTick(Date.now(), {
      loadSystemMeta: async () => meta,
      saveSystemMeta: async () => {},
      withQueueOperationLock: async (_k, fn) => fn(),
      post: async (txt) => posts.push(txt)
    });
    assert.equal(meta.torneio.inscricoes, false);
    assert.equal(meta.torneio.players.length, 20);
    assert.deepEqual(meta.torneio.reservas, ['u21', 'u22', 'u23']);
    assert.match(posts[0], /encerradas/i);
  });

  it('tick: com menos de 20 estende e avisa', async () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 12; i++) T.joinTournament(t, `u${i}`);
    t.inscricoesAte = new Date(0).toISOString();
    const meta = { torneio: t, torneioHabilitado: true };
    const posts = [];
    await runTorneioTick(Date.now(), {
      loadSystemMeta: async () => meta,
      saveSystemMeta: async () => {},
      withQueueOperationLock: async (_k, fn) => fn(),
      post: async (txt) => posts.push(txt)
    });
    assert.equal(meta.torneio.inscricoes, true);
    assert.match(posts[0], /faltam/i);
    assert.match(posts[0], /8/);
  });

  it('comandos de torneio: Staff entra, Capitao nao', () => {
    const mkMember = (roleNames, perms = []) => ({
      permissions: { has: (p) => perms.includes(p) },
      roles: { cache: new Collection(roleNames.map((n, i) => [String(i), { name: n }])) }
    });
    assert.equal(legacy.isStaffOnly(mkMember(['🛠️ Staff'])), true);
    assert.equal(legacy.isStaffOnly(mkMember(['Staff'])), true);
    assert.equal(legacy.isStaffOnly(mkMember(['🛠️ Moderador'])), true);
    assert.equal(legacy.isStaffOnly(mkMember(['👑 Capitão LCL'])), false);
    assert.equal(legacy.isStaffOnly(mkMember(['👑 Capitão de Customs'])), false);
    assert.equal(legacy.isStaffOnly(mkMember([], ['ManageMessages'])), true);
    assert.equal(legacy.isStaffOnly(mkMember([], ['Administrator'])), true);
    assert.equal(legacy.isStaffOnly(mkMember([], ['SendMessages'])), false);
    assert.equal(legacy.isStaffOnly(null), false);
    // alias histórico
    assert.equal(legacy.isTournamentStaff, legacy.isStaffOnly);
  });

  it('tick: agenda abre sozinha quando o dia chega (e nao duplica)', async () => {
    const now = Date.UTC(2026, 9, 17, 22, 0); // sábado 19:00 SP
    const parts = getSPParts(now);
    const t = T.newTournament(0);
    t.active = false;
    t.inscricoes = false;
    T.setAgenda(t, 'sab', '19:00', 5);
    const meta = { torneio: t, torneioHabilitado: false };
    const posts = [];
    const deps = {
      loadSystemMeta: async () => meta,
      saveSystemMeta: async () => {},
      withQueueOperationLock: async (_k, fn) => fn(),
      post: async (txt) => posts.push(txt)
    };
    await runTorneioTick(now, deps);
    assert.equal(meta.torneioAbertoEm, parts.key);
    assert.equal(meta.torneioHabilitado, true);
    assert.equal(meta.torneio.edition, 1);
    assert.equal(meta.torneio.inscricoes, true);
    assert.equal(meta.torneio.agenda.diasInscricao, 5);
    assert.match(posts[0], /inscri/i);
    // Segunda passada no mesmo dia: nada muda.
    const before = JSON.stringify(meta.torneio);
    await runTorneioTick(now, deps);
    assert.equal(JSON.stringify(meta.torneio), before);
  });

  it('substituicao pre-sorteio: reserva assume direto na lista de players', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 23; i++) T.joinTournament(t, `u${i}`);
    T.fecharInscricoes(t);
    assert.equal(T.peakReserva(t), 'u21');
    const r = T.substituirDesistente(t, 'u1', { discordId: 'u21', nickname: 'u21', baseMmr: 1500 }, (g) => balance(g));
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'pre-sorteio');
    assert.deepEqual(t.players.slice(0, 1), ['u21']);
    assert.deepEqual(t.reservas, ['u22', 'u23']);
  });

  it('substituicao em jogo aberto: reserva entra e o jogo e re-balanceado', () => {
    const t = T.newTournament(1);
    const players = pool(24); // 20 titulares + 4 reservas
    for (const p of players) T.joinTournament(t, p.discordId);
    T.fecharInscricoes(t);
    const games = T.drawGames(t.players.map((id) => ({ discordId: id, nickname: id, baseMmr: 1000 + +id.slice(1) })), balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    const antes = games[0].teamOne.some((p) => p.discordId === 'u1') ? games[0] : games.find((g) => [...g.teamOne, ...g.teamTwo].some((p) => p.discordId === 'u1'));
    const r = T.substituirDesistente(t, 'u1', { discordId: 'u21', nickname: 'u21', baseMmr: 1000 }, (g) => balance(g));
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'jogo');
    assert.equal(r.rebalanceado, true);
    const depois = t.rounds[0].games.find((g) => g.id === r.jogo);
    const grupo = [...depois.teamOne, ...depois.teamTwo];
    assert.equal(grupo.length, 10);
    assert.equal(grupo.some((p) => p.discordId === 'u21'), true);
    assert.equal(grupo.some((p) => p.discordId === 'u1'), false);
    assert.deepEqual(t.reservas, ['u22', 'u23', 'u24']);
  });

  it('substituicao apos resultado: reserva assume a vaga do vencedor (proxima rodada)', () => {
    const t = T.newTournament(1);
    const players = pool(24);
    for (const p of players) T.joinTournament(t, p.discordId);
    T.fecharInscricoes(t);
    const games = T.drawGames(t.players.map((id) => ({ discordId: id, nickname: id, baseMmr: 1000 })), balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    const jogo = games[0];
    jogo.winner = '1';
    const idVencedor = jogo.teamOne[0].discordId;
    const r = T.substituirDesistente(t, idVencedor, { discordId: 'u21', nickname: 'u21', baseMmr: 1000 }, balance);
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'proxima-rodada');
    assert.equal(jogo.teamOne.some((p) => p.discordId === 'u21'), true);
    assert.equal(jogo.teamOne.some((p) => p.discordId === idVencedor), false);
    assert.deepEqual(t.reservas, ['u22', 'u23', 'u24']);
  });

  it('substituicao: desistente eliminado nao consome a reserva', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 23; i++) T.joinTournament(t, `u${i}`);
    T.fecharInscricoes(t);
    const games = T.drawGames(t.players.map((id) => ({ discordId: id, nickname: id, baseMmr: 1000 })), balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    games[0].winner = '1';
    const perdedor = games[0].teamTwo[0].discordId;
    const r = T.substituirDesistente(t, perdedor, { discordId: 'u21', nickname: 'u21', baseMmr: 1000 }, balance);
    assert.equal(r.ok, false);
    assert.match(r.message, /eliminado/i);
    assert.deepEqual(t.reservas, ['u21', 'u22', 'u23']);
  });

  it('substituicao na final: troca o slot do desistente nos times congelados', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 23; i++) T.joinTournament(t, `u${i}`);
    T.fecharInscricoes(t);
    t.final = {
      teamOne: slim5('u1'), teamTwo: slim5('u6'),
      sides: { j1: '1' }, games: [], wins1: 0, wins2: 0, ausencia: null
    };
    const alvo = t.final.teamOne[0].discordId; // u10
    const r = T.substituirDesistente(t, alvo, { discordId: 'u21', nickname: 'u21', baseMmr: 1000 }, balance);
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'final');
    assert.equal(t.final.teamOne.some((p) => p.discordId === 'u21'), true);
    assert.deepEqual(t.reservas, ['u22', 'u23']);
  });

  it('ausencia: aviso em T+5, substituicao em T+10, limpar sem ausentes', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 23; i++) T.joinTournament(t, `u${i}`);
    T.fecharInscricoes(t);
    const games = T.drawGames(t.players.map((id) => ({ discordId: id, nickname: id, baseMmr: 1000 })), balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    const criado = Date.UTC(2026, 9, 19, 12, 0);
    t.rounds[0].ausencia = { criadoEm: new Date(criado).toISOString(), avisoEm: null, aplicadoEm: null };
    const jogos = t.rounds[0].games.filter((g) => !g.winner).length;
    const presente = {};
    for (const g of games) presente[g.id] = [...g.teamOne.slice(0, 4), ...g.teamTwo.slice(0, 4)].map((p) => p.discordId); // 2 ausentes por jogo

    // antes de 5 min: nada
    assert.equal(T.avaliarAusencia(t, criado + 4 * 60000, presente).fase, null);
    // T+5: aviso, lista quem falta
    const aviso = T.avaliarAusencia(t, criado + 5 * 60000, presente);
    assert.equal(aviso.fase, 'aviso');
    assert.equal(aviso.alvos.length, 2);
    assert.equal(aviso.alvos[0].ids.length, 2);
    // marca aviso, T+10 (5 depois do aviso) com todos presentes: limpar
    t.rounds[0].ausencia.avisoEm = new Date(criado + 5 * 60000).toISOString();
    const presenteTudo = {};
    for (const g of games) presenteTudo[g.id] = [...g.teamOne, ...g.teamTwo].map((p) => p.discordId);
    assert.equal(T.avaliarAusencia(t, criado + 10 * 60000, presenteTudo).fase, 'limpar');
    // T+10 com ausentes: substituir
    const subst = T.avaliarAusencia(t, criado + 10 * 60000, presente);
    assert.equal(subst.fase, 'substituir');
    // aplicado: para de checar
    t.rounds[0].ausencia.aplicadoEm = new Date(criado + 10 * 60000).toISOString();
    assert.equal(T.avaliarAusencia(t, criado + 11 * 60000, presente).fase, null);
  });

  it('reforco: sem reserva, pool morto de rodadas anteriores substitui (sem punir os 4)', () => {
    const t = T.newTournament(2);
    const players = pool(30);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    T.atribuirNomesTimes(t, games);
    t.rounds.push({ n: 1, games });
    for (const g of games) T.recordGameResult(t, g.id, '1');
    const adv = T.advanceTournament(t, balance); // R2: 2 jogos (repescagem levou 5)
    assert.equal(adv.type, 'round');
    assert.equal(t.reservas.length, 0);
    // Pool morto = 10 perdedores NÃO repescados, melhor elo primeiro.
    const mortos = T.poolMortos(t);
    assert.equal(mortos.length, 10);
    const melhor = mortos[0].discordId;
    // Candito da cadeia (sem reserva): reforço.
    const cand = T.escolherSubstituto(t);
    assert.equal(cand.tipo, 'reforco');
    assert.equal(cand.id, melhor);
    // Ausente em jogo aberto da R2 → reforço assume, re-balance mantém nome do time.
    const gAberto = adv.games[0];
    const alvo = gAberto.teamTwo[0].discordId;
    const agora = Date.now();
    t.rounds[1].ausencia = { criadoEm: new Date(agora - 10 * 60000).toISOString(), avisoEm: new Date(agora - 5 * 60000).toISOString(), aplicadoEm: null };
    const presente = {};
    for (const g of adv.games) presente[g.id] = [...g.teamOne, ...g.teamTwo].map((p) => p.discordId);
    presente[gAberto.id] = presente[gAberto.id].filter((id) => id !== alvo);
    const aval = T.avaliarAusencia(t, agora, presente);
    assert.equal(aval.fase, 'substituir');
    assert.equal(aval.substituto.tipo, 'reforco');
    const r = T.substituirDesistente(t, alvo, { ...mortos[0] }, balance);
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'jogo');
    const g = t.rounds[1].games.find((x) => x.id === gAberto.id);
    assert.ok([...g.teamOne, ...g.teamTwo].some((p) => p.discordId === melhor));
    assert.ok(g.nomeTimeA && g.nomeTimeB);
    for (const p of g.teamOne) assert.equal(p.timeNome, g.nomeTimeA);
    for (const p of g.teamTwo) assert.equal(p.timeNome, g.nomeTimeB);
    // Reforçado saiu do pool morto (agora é vivo).
    assert.equal(T.poolMortos(t).some((p) => p.discordId === melhor), false);
  });

  it('wo: T+20 sem reserva nem reforco — lado do ausente perde; ambos os lados va pra staff', () => {
    const t = T.newTournament(1);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    T.atribuirNomesTimes(t, games);
    t.rounds.push({ n: 1, games, ausencia: null });
    const agora = Date.now();
    t.rounds[0].ausencia = { criadoEm: new Date(agora - 20 * 60000).toISOString(), avisoEm: new Date(agora - 15 * 60000).toISOString(), aplicadoEm: null };
    // J1: ausente só do time 2 → fase wo, lado '2'.
    const game1 = games[0];
    const presente = {};
    presente[game1.id] = [...game1.teamOne.map((p) => p.discordId), ...game1.teamTwo.slice(1).map((p) => p.discordId)];
    // J2: todos presentes (fechar o outro jogo p/provar que o W.O. é por jogo).
    const game2 = games[1];
    presente[game2.id] = [...game2.teamOne, ...game2.teamTwo].map((p) => p.discordId);
    const aval = T.avaliarAusencia(t, agora, presente);
    assert.equal(aval.fase, 'wo');
    assert.equal(aval.substituto, null);
    assert.equal(aval.alvos.length, 1);
    assert.equal(aval.alvos[0].lado, '2');
    const out = T.aplicarWalkover(t, aval.alvos, agora);
    assert.equal(out.aplicados.length, 1);
    assert.equal(out.aplicados[0].vencedor, '1');
    assert.equal(game1.winner, '1');
    // Ambos os lados ausentes: lado null → staff decide, jogo permanece em aberto.
    const t2 = T.newTournament(1);
    const players2 = pool(20);
    for (const p of players2) T.joinTournament(t2, p.discordId);
    const games2 = T.drawGames(players2, balance, 'R1');
    T.atribuirNomesTimes(t2, games2);
    t2.rounds.push({ n: 1, games: games2, ausencia: null });
    const presente2 = {};
    presente2[games2[0].id] = [...games2[0].teamOne.slice(0, 4), ...games2[0].teamTwo.slice(0, 4)].map((p) => p.discordId);
    // J2 inteiramente presente (senão todo o jogo entra como ausente).
    presente2[games2[1].id] = [...games2[1].teamOne, ...games2[1].teamTwo].map((p) => p.discordId);
    const agora2 = Date.now();
    t2.rounds[0].ausencia = { criadoEm: new Date(agora2 - 21 * 60000).toISOString(), avisoEm: new Date(agora2 - 16 * 60000).toISOString(), aplicadoEm: null };
    const aval2 = T.avaliarAusencia(t2, agora2, presente2);
    assert.equal(aval2.alvos.length, 1);
    assert.equal(aval2.alvos[0].lado, null);
    const out2 = T.aplicarWalkover(t2, aval2.alvos, agora2);
    assert.equal(out2.aplicados.length, 0);
    assert.equal(out2.ambiguos.length, 1);
    assert.equal(games2[0].winner, null);
  });

  it('adiar/retomar: pausa avaliacao e renova janelas na volta', () => {
    const t = T.newTournament(1);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    const agora = Date.now();
    t.rounds[0].ausencia = { criadoEm: new Date(agora - 30 * 60000).toISOString(), avisoEm: new Date(agora - 25 * 60000).toISOString(), aplicadoEm: null };
    const presente = {};
    for (const g of games) presente[g.id] = [...g.teamOne.slice(0, 4)].map((p) => p.discordId);
    // Adiado: nenhum fase (nem timeout).
    assert.equal(T.adiarTorneio(t, agora).ok, true);
    assert.equal(T.avaliarAusencia(t, agora, presente).fase, null);
    assert.equal(T.avaliarTimeoutRodada(t, agora).atrasada, false);
    // Retomar: limpa, renova timeout e reinicia a janela de ausência.
    const r = T.retomarTorneio(t, agora + 60000);
    assert.equal(r.ok, true);
    assert.equal(t.adiado, null);
    assert.ok(new Date(t.rounds[0].ausencia.criadoEm).getTime() >= agora);
    assert.ok(new Date(t.rounds[0].iniciadoEm).getTime() >= agora);
    const novoPresente = {};
    for (const g of games) novoPresente[g.id] = [...g.teamOne, ...g.teamTwo].map((p) => p.discordId);
    assert.equal(T.avaliarAusencia(t, agora + 60000, novoPresente).fase, null);
  });

  it('ausencia na final: usa o lobby FINAL e os times congelados', () => {
    const t = T.newTournament(1);
    t.final = {
      teamOne: slim5('u1'), teamTwo: slim5('u6'),
      sides: { j1: '2' }, games: [], wins1: 0, wins2: 0,
      ausencia: { criadoEm: new Date(Date.UTC(2026, 9, 19, 12, 0)).toISOString(), avisoEm: null, aplicadoEm: null }
    };
    const criado = Date.parse(t.final.ausencia.criadoEm);
    const quaseAlguem = {};
    quaseAlguem.FINAL = [...t.final.teamOne.slice(0, 4), ...t.final.teamTwo.slice(0, 4)].map((p) => p.discordId);
    const aviso = T.avaliarAusencia(t, criado + 5 * 60000, quaseAlguem);
    assert.equal(aviso.fase, 'aviso');
    assert.deepEqual(aviso.alvos, [{ gameId: 'FINAL', ids: ['u14', 'u64'], lado: null, final: true }]);
    // FINAL nunca fecha por automação: T+20 entra em fase 'wo' SÓ para avisar a staff.
    t.final.ausencia.avisoEm = new Date(criado + 5 * 60000).toISOString();
    const t20 = T.avaliarAusencia(t, criado + 20 * 60000, quaseAlguem);
    assert.equal(t20.fase, 'wo');
    assert.equal(t20.wo.length, 1);
    assert.equal(t20.wo[0].lado, null);
    const out = T.aplicarWalkover(t, t20.alvos, criado + 20 * 60000);
    assert.equal(out.aplicados.length, 0);
    assert.equal(out.ambiguos.length, 1);
    assert.equal(t.final.games.length, 0);
  });

  it('final: lado azul do J1 sorteado e ficha do J3 aponta o vencedor do J1', () => {
    const t = T.newTournament(1);
    for (let i = 1; i <= 20; i++) T.joinTournament(t, `u${i}`);
    const games = T.drawGames(t.players.map((id) => ({ discordId: id, nickname: id, baseMmr: 1000 })), balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    for (const g of games) T.recordGameResult(t, g.id, '1');
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.ok, true);
    assert.equal(adv.type, 'final');
    assert.ok(['1', '2'].includes(t.final.sides.j1));
    T.recordFinalGame(t, '1');
    // Com 1 jogo recorded (Time 1 venceu); J3 (se existir) seria dinheiro do vencedor do J1.
    assert.equal(t.final.games[0], '1');
  });

  it('podeEncerrar: livre antes do 1o sorteio, recusado em andamento, valido com campeao', () => {
    const t = T.newTournament(1);
    assert.equal(T.podeEncerrar(t).ok, true);
    const games = T.drawGames(t.players.map((id) => ({ discordId: id, nickname: id, baseMmr: 1000 })).concat(pool(20 - t.players.length)), balance, 'R1');
    t.rounds.push({ n: 1, games, ausencia: null });
    const recusa = T.podeEncerrar(t);
    assert.equal(recusa.ok, false);
    assert.match(recusa.message, /campe/i);
    t.champion = { team: ['a'], at: new Date().toISOString(), placar: '2x0' };
    assert.equal(T.podeEncerrar(t).ok, true);
  });

  it('timeout de rodada: avisa apos 90min, prorrogar renova, guard do off acompanha o ciclo', () => {
    const agora = Date.now();
    const t = T.newTournament(2);
    // Sem inscritos: off livre (encerrar é para abortar antes do 1º sorteio).
    assert.equal(T.podeDesativar(t).ok, true);
    const players = pool(20);
    for (const p of players) T.joinTournament(t, p.discordId);
    // Com inscritos, PRÉ-sorteio: off segue livre (não apaga nada — handlers.test cobre).
    assert.equal(T.podeDesativar(t).ok, true);
    const games = T.drawGames(players, balance, 'R1');
    T.atribuirNomesTimes(t, games);
    const avisoMs = agora - (T.RODADA_TIMEOUT_MIN + 5) * 60000;
    t.rounds.push({ n: 1, games, ausencia: null, iniciadoEm: new Date(avisoMs).toISOString() });
    let tor = T.avaliarTimeoutRodada(t, agora);
    assert.equal(tor.atrasada, true);
    assert.equal(tor.alvo, 'R1');
    assert.ok(tor.minutos >= T.RODADA_TIMEOUT_MIN);
    assert.equal(T.podeDesativar(t).ok, false);
    // Prorroga: janela renova e aviso fica limpo.
    const r = T.prorrogarRodada(t, agora);
    assert.equal(r.ok, true);
    assert.equal(r.alvo, 'R1');
    tor = T.avaliarTimeoutRodada(t, agora);
    assert.equal(tor.atrasada, false);
    // Rodada fechada: sem alvo de timeout, mas off segue bloqueado (sem campeao).
    for (const g of games) T.recordGameResult(t, g.id, '1');
    assert.equal(T.avaliarTimeoutRodada(t, agora).atrasada, false);
    assert.equal(T.podeDesativar(t).ok, false);
    // Final em aberto: alvo FINAL, minutos 0; coroacao libera o off.
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.type, 'final');
    assert.ok(t.final.iniciadoEm);
    tor = T.avaliarTimeoutRodada(t, agora);
    assert.equal(tor.atrasada, false);
    assert.equal(tor.alvo, 'FINAL');
    assert.equal(T.podeDesativar(t).ok, false);
    T.recordFinalGame(t, '1');
    T.recordFinalGame(t, '1');
    assert.ok(t.champion);
    assert.equal(T.podeDesativar(t).ok, true);
  });
});

function slim5(base) {
  return Array.from({ length: 5 }, (_, i) => ({ discordId: `${base}${i}`, nickname: `${base}${i}`, baseMmr: 1000 }));
}

// ─── Fase de Pontos v1 (formato 'F1') ─────────────────────────────────────────
describe('torneio F1: gerarGradeRoundRobin', () => {
  it('4 times = 3 rodadas, todos encaram todos, 6 confrontos únicos', () => {
    const grade = T.gerarGradeRoundRobin(['A', 'B', 'C', 'D']);
    assert.equal(grade.length, 3);
    grade.forEach((r) => assert.equal(r.length, 2));
    const pares = grade.flat().map((c) => [c.timeA, c.timeB].sort().join(''));
    assert.equal(new Set(pares).size, 6, 'C(4,2) sem repetição');
  });

  it('quantidade ímpar ou insuficiente → grade vazia', () => {
    assert.deepEqual(T.gerarGradeRoundRobin(['A']), []);
    assert.deepEqual(T.gerarGradeRoundRobin(['A', 'B', 'C']), []);
  });
});

describe('torneio F1: fluxo completo (20 inscritos → final)', () => {
  // Monta um torneio F1 com times sorteados (pool de 20 por elo decrescente).
  function torneioF1() {
    const t = T.newTournament(1);
    const times = T.drawFixedTeams(t, pool(20), balance, 4);
    t.formato = 'F1';
    t.times = times;
    t.fase1 = { grade: T.gerarGradeRoundRobin(times.map((x) => x.id)) };
    return t;
  }

  it('drawFixedTeams: 4 times de 5, jogadores únicos, nomes sequenciais', () => {
    const t = T.newTournament(1);
    const times = T.drawFixedTeams(t, pool(20), balance, 4);
    assert.equal(times.length, 4);
    const ids = times.flatMap((x) => x.players.map((p) => p.discordId));
    assert.equal(new Set(ids).size, 20);
    times.forEach((x) => assert.equal(x.players.length, 5));
    assert.match(times[0].nome, /TIME/);
  });

  it('sortearFase1: cria rodada 1 com 4 mapas e confrontos R1-C1/C2', () => {
    const t = torneioF1();
    const r = T.sortearFase1(t);
    assert.equal(r.ok, true);
    assert.equal(r.type, 'round');
    assert.equal(t.rounds.length, 1);
    assert.equal(t.rounds[0].games.length, 4);
    assert.equal(t.rounds[0].confrontos.length, 2);
    assert.ok(t.rounds[0].confrontos[0].jogo1 !== t.rounds[0].confrontos[0].jogo2);
  });

  it('2x0 = 3 pts; 1x1 = 1 pt pra cada; rosters não mudam entre mapas', () => {
    const t = torneioF1();
    T.sortearFase1(t);
    const r1 = t.rounds[0];
    const c1 = r1.confrontos[0];
    const g1 = r1.games.find((g) => g.id === c1.jogo1);
    const g2 = r1.games.find((g) => g.id === c1.jogo2);
    assert.deepEqual(g1.teamOne.map((p) => p.discordId), g2.teamOne.map((p) => p.discordId), 'mesmo time nos 2 mapas');
    const idVencedor = g1.teamOne[0].discordId;
    T.recordGameResult(t, c1.jogo1, '1');
    T.recordGameResult(t, c1.jogo2, '1');
    const [fechado] = T.fecharConfrontosRodada(t, 1);
    assert.equal(fechado.wa, 2);
    assert.equal(fechado.ptsA, 3, '2x0 = 3 pts');
    assert.equal(fechado.ptsB, 0);
  });

  it('1x1 dá 1 ponto a cada time', () => {
    const t = torneioF1();
    T.sortearFase1(t);
    const r1 = t.rounds[0];
    const c = r1.confrontos[0];
    T.recordGameResult(t, c.jogo1, '1');
    T.recordGameResult(t, c.jogo2, '2');
    const [fechado] = T.fecharConfrontosRodada(t, 1);
    assert.equal(fechado.ptsA, 1);
    assert.equal(fechado.ptsB, 1);
  });

  it('classificação: pontos > saldo > confronto direto', () => {
    const t = torneioF1();
    T.sortearFase1(t);
    const [c1, c2] = t.rounds[0].confrontos;
    // C1: time A 2x0 time B (3 pts, saldo +2)
    T.recordGameResult(t, c1.jogo1, '1');
    T.recordGameResult(t, c1.jogo2, '1');
    // C2: 1x1 (1 pt cada)
    T.recordGameResult(t, c2.jogo1, '1');
    T.recordGameResult(t, c2.jogo2, '2');
    T.fecharConfrontosRodada(t, 1);
    const cls = T.calcClassificacao(t);
    assert.equal(cls.length, 4);
    const time1 = cls.find((c) => c.id === c1.timeA);
    assert.equal(time1.pontos, 3);
    assert.equal(time1.mapasV, 2);
    assert.equal(time1.mapasP, 0);
    const segundoEmpate = cls[1].pontos;
    assert.ok(segundoEmpate <= 1, 'ninguém mais passou de 1 pt na R1');
  });

  it('phases: rodada em aberto trava o sortear', () => {
    const t = torneioF1();
    T.sortearFase1(t);
    const r = T.sortearFase1(t);
    assert.equal(r.ok, false);
    assert.match(r.message, /em aberto/);
  });

  it('fase completa → sortear gera a FINAL com top2 e mesmos times; lado do J1 pendente', () => {
    const t = torneioF1();
    // Fecha as 3 rodadas na ordem ( todas 2x0 pro lado A do confronto ).
    for (let n = 0; n < 3; n++) {
      const r = T.sortearFase1(t);
      assert.equal(r.ok, true, `rodada ${n + 1} criada`);
      const round = t.rounds[t.rounds.length - 1];
      for (const c of round.confrontos) {
        T.recordGameResult(t, c.jogo1, '1');
        T.recordGameResult(t, c.jogo2, '1');
      }
    }
    assert.equal(t.rounds.length, 3);
    T.fecharConfrontosRodada(t);
    assert.equal(T.fase1Concluida(t), true);
    const cls = T.calcClassificacao(t);
    assert.equal(cls[0].pontos, 9, '1º colocado venceu os 3 confrontos 2x0');
    assert.equal(cls[0].mapasV, 6);
    const r = T.sortearFase1(t);
    assert.equal(r.type, 'final', 'fase fechada + rodadas esgotadas → final');
    assert.equal(t.final.teamOne.length, 5);
    assert.equal(t.final.teamTwo.length, 5);
    const nomes = new Set([t.final.nomeTime1, t.final.nomeTime2]);
    assert.ok(nomes.has(cls[0].nome) && nomes.has(cls[1].nome), 'final entre os 2 melhores');
    assert.equal(t.final.sides.j1, null, '1º colocado ainda não escolheu o lado');
    // Escolha do lado: J1 antes de qualquer resultado.
    const lado = T.definirLadoFinal(t, '2');
    assert.equal(lado.ok, true);
    assert.equal(t.final.sides.j1, '2');
    assert.equal(T.definirLadoFinal(t, '1', 'j3').ok, false, 'j3 só em 1x1');
  });

  it('forcarSegundo destrava empate no 2º lugar', () => {
    const t = torneioF1();
    // Empate total: todas as rodadas em 1-1 → todos com 3 pts e saldo 0.
    for (let n = 0; n < 3; n++) {
      const r = T.sortearFase1(t);
      assert.equal(r.ok, true);
      const round = t.rounds[t.rounds.length - 1];
      for (const c of round.confrontos) {
        T.recordGameResult(t, c.jogo1, '1');
        T.recordGameResult(t, c.jogo2, '2');
      }
    }
    T.fecharConfrontosRodada(t);
    const cls = T.calcClassificacao(t);
    assert.ok(new Set(cls.map((c) => c.pontos)).size === 1, 'todos empatados');
    const r = T.sortearFase1(t);
    assert.equal(r.ok, false, 'empate no 2º exige staff');
    assert.ok(r.classificacao, 'classificação apresentada ao staff');
    assert.ok(r.exemplo, 'exemplo de comando p/ destravar');
    const alvo = r.classificacao[1]; // staff classifica o segundo listado
    const letra = alvo.nome.replace('TIME ', '');
    const r2 = T.sortearFase1(t, { forcarSegundo: alvo.id });
    assert.equal(r2.type, 'final', `staff: !torneio sortear ${letra}`);
    assert.equal(t.final.nomeTime2, alvo.nome);
  });

  it('poolMortos F1: perdedor de mapa concluído disponível como reforço', () => {
    const t = torneioF1();
    T.sortearFase1(t);
    const r1 = t.rounds[0];
    const [c1, c2] = r1.confrontos;
    // Fecha só o confronto C2 (os perdedores dele viram recurso); C1 segue aberto.
    T.recordGameResult(t, c2.jogo1, '1');
    T.recordGameResult(t, c2.jogo2, '1');
    T.fecharConfrontosRodada(t, 1);
    const pool = T.poolMortos(t);
    assert.equal(pool.length, 5, 'os 5 perdedores do confronto fechado');
    const perdedorId = r1.games[2].teamTwo[0].discordId;
    assert.ok(pool.some((p) => p.discordId === perdedorId));
  });

  it('substituirDesistente F1: entra na vaga do próprio time em todos os mapas abertos', () => {
    const t = torneioF1();
    T.sortearFase1(t);
    const r1 = t.rounds[0];
    const c1 = r1.confrontos[0];
    const jogo1 = r1.games.find((g) => g.id === c1.jogo1);
    const jogo2 = r1.games.find((g) => g.id === c1.jogo2);
    const alvo = jogo1.teamOne[0];
    const timeNome = alvo.timeNome;
    const reserva = { discordId: 'reserva-x', nickname: 'Reserva X', baseMmr: 1000 };
    const r = T.substituirDesistente(t, alvo.discordId, reserva, balance);
    assert.equal(r.ok, true);
    assert.equal(r.modo, 'jogo-f1');
    assert.equal(r.rebalanceado, false);
    // Os 2 mapas do CONFRONTO dele têm o substituto no lugar do ausente.
    for (const g of [jogo1, jogo2]) {
      const membros = [...g.teamOne, ...g.teamTwo].map((p) => p.discordId);
      assert.ok(membros.includes('reserva-x'), `${g.id} tem o reserva`);
      assert.ok(!membros.includes(alvo.discordId), `${g.id} sem o ausente`);
    }
    // Confrontos paralelos não são tocados.
    const outros = [...r1.games.filter((g) => g.confronto !== c1.id)].flatMap((g) => [...g.teamOne, ...g.teamTwo].map((p) => p.discordId));
    assert.ok(!outros.includes('reserva-x'), 'outros confrontos intocados');
    // Time canônico atualizado (próximas rodadas herdam o reserva).
    const timeCanonico = t.times.find((x) => x.nome === timeNome);
    assert.ok(timeCanonico.players.some((p) => p.discordId === 'reserva-x'));
  });
});
