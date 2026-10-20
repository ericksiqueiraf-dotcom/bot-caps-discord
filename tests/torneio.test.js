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
    assert.deepEqual(aviso.alvos, [{ gameId: 'FINAL', ids: ['u14', 'u64'] }]);
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
});

function slim5(base) {
  return Array.from({ length: 5 }, (_, i) => ({ discordId: `${base}${i}`, nickname: `${base}${i}`, baseMmr: 1000 }));
}
