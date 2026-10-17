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

  it('30 inscritos: repescagem completa 20', () => {
    const t = T.newTournament(2);
    const players = pool(30);
    for (const p of players) T.joinTournament(t, p.discordId);
    const games = T.drawGames(players, balance, 'R1');
    assert.equal(games.length, 3);
    t.rounds.push({ n: 1, games });
    for (const g of games) T.recordGameResult(t, g.id, '1');
    const adv = T.advanceTournament(t, balance);
    assert.equal(adv.ok, true);
    assert.equal(adv.type, 'round');
    assert.equal(adv.round, 2);
    assert.equal(adv.games.length, 2);
    assert.equal(adv.repechage.length, 5);
    // Repescados sao os 5 perdedores de maior elo.
    const r1losers = T.roundLosers(t, 1).map((p) => p.discordId);
    assert.deepEqual(adv.repechage.map((p) => p.discordId).sort(), r1losers.slice(0, 5).sort());
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
    assert.equal(legacy.isTournamentStaff(mkMember(['🛠️ Staff'])), true);
    assert.equal(legacy.isTournamentStaff(mkMember(['Staff'])), true);
    assert.equal(legacy.isTournamentStaff(mkMember(['🛠️ Moderador'])), true);
    assert.equal(legacy.isTournamentStaff(mkMember(['👑 Capitão LCL'])), false);
    assert.equal(legacy.isTournamentStaff(mkMember(['👑 Capitão de Customs'])), false);
    assert.equal(legacy.isTournamentStaff(mkMember([], ['ManageMessages'])), true);
    assert.equal(legacy.isTournamentStaff(null), false);
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
});
