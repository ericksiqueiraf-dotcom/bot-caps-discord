// Testes de HANDLER (não só de service): exercitam o fluxo real do
// `!torneio` — gate de staff, ativação, inscrição, agenda e sorteio — sem
// Discord e sem banco, via tests/handlers.harness.js.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { mkMember, mkGuild, mkMessage, loadLegacyWithStubs, textOf } = require('./handlers.harness');

const DIA_MS = 24 * 60 * 60 * 1000;

// O harness carrega o legacyCommands UMA vez; os stubs leem o estado atual,
// que cada teste troca via setup().
let current = null;
const legacy = loadLegacyWithStubs({
  loadSystemMeta: async () => current.meta,
  saveSystemMeta: async () => {},
  loadPlayerStats: async () => current.stats,
  loadVipSubscriptions: async () => ({ subscriptions: [] })
});

function setup(meta = {}) {
  current = {
    meta: { torneio: null, torneioHabilitado: false, ...meta },
    stats: { players: {} }
  };
  return current;
}

const ROLE_STAFF = { roleNames: ['🛠️ Staff'] };
const ROLE_MOD = { roleNames: ['Moderador'] };
const ROLE_CAPITAO = { roleNames: ['👑 Capitão LCL'] };
const ROLE_JOGADOR = { roleNames: ['Jogador'] };

async function run(args, member = ROLE_JOGADOR, guild) {
  const message = mkMessage({ member: mkMember(member), guild: guild || mkGuild() });
  await legacy.handleTorneioCommand(message, args);
  return message.replies.map(textOf).join('\n');
}

function torneioAberto(playerIds) {
  return {
    active: true,
    inscricoes: true,
    inscricoesAte: new Date(Date.now() + 7 * DIA_MS).toISOString(),
    origem: 'manual',
    reservas: [],
    agenda: null,
    edition: 4,
    players: [...playerIds],
    rounds: [],
    final: null,
    champion: null
  };
}

describe('handler !torneio: info/entrar', () => {
  it('info mostra o regulamento mesmo com o torneio desativado', async () => {
    setup({ torneioHabilitado: false });
    const out = await run(['info']);
    assert.match(out, /desativado/i);
    assert.match(out, /MÚLTIPLO DE 10|Inscri|torneio/i);
  });

  it('membro NÃO consegue entrar quando o torneio está desativado', async () => {
    setup({ torneioHabilitado: false });
    const out = await run(['entrar']);
    assert.match(out, /desativado/i);
    assert.match(out, /torneioon/);
  });

  it('membro entra quando há torneio aberto e registra o inscrito', async () => {
    const state = setup({ torneioHabilitado: true, torneio: torneioAberto([]) });
    const out = await run(['entrar']);
    assert.match(out, /Inscrito no \*\*Torneio #4\*\*/);
    assert.deepEqual(state.meta.torneio.players, ['u1']);
  });
});

describe('handler !torneio: gate de Staff (Capitão não entra)', () => {
  it('Capitão é bloqueado nos subcomandos de staff', async () => {
    for (const sub of [['on'], ['off'], ['agenda', 'sex', '19:00'], ['sortear'], ['encerrar']]) {
      const state = setup({ torneioHabilitado: true, torneio: torneioAberto(['x']) });
      const out = await run(sub, ROLE_CAPITAO);
      assert.match(out, /restrito à \*\*Staff\*\*|restrito à Staff/i, `subcomando ${sub[0]}`);
      assert.equal(state.meta.torneioHabilitado, true, `subcomando ${sub[0]} não devia mudar o estado`);
    }
  });

  it('Staff passa pelo gate (por cargo ou por permissão)', async () => {
    setup({ torneioHabilitado: false });
    assert.match(await run(['on'], ROLE_STAFF), /Torneio #\d+ aberto/);

    setup({ torneioHabilitado: false });
    assert.match(await run(['on'], ROLE_MOD), /Torneio #\d+ aberto/);

    setup({ torneioHabilitado: false });
    const porPermissao = { roleNames: ['Jogador'], perms: ['ManageMessages'] };
    assert.match(await run(['on'], porPermissao), /Torneio #\d+ aberto/);
  });
});

describe('handler !torneio: on/off', () => {
  it('on ativa o torneio com a janela de 7 dias e registra a data do open', async () => {
    const state = setup({ torneioHabilitado: false });
    const out = await run(['on'], ROLE_STAFF);

    assert.match(out, /Torneio #1 aberto/);
    assert.match(out, /7 dia\(s\)/);
    assert.equal(state.meta.torneioHabilitado, true);
    assert.equal(state.meta.torneio.active, true);
    assert.equal(state.meta.torneio.origem, 'manual');
    assert.ok(state.meta.torneioAbertoEm, 'precisa marcar torneioAbertoEm (dedup da agenda)');

    const dias = (Date.parse(state.meta.torneio.inscricoesAte) - Date.now()) / DIA_MS;
    assert.ok(dias > 6.9 && dias < 7.1, `esperava ~7 dias, veio ${dias}`);
  });

  it('on aceita o número de dias de inscrição', async () => {
    const state = setup({ torneioHabilitado: false });
    const out = await run(['on', '3'], ROLE_STAFF);
    assert.match(out, /3 dia\(s\)/);
    const dias = (Date.parse(state.meta.torneio.inscricoesAte) - Date.now()) / DIA_MS;
    assert.ok(dias > 2.9 && dias < 3.1, `esperava ~3 dias, veio ${dias}`);
  });

  it('off só desativa — não apaga a edição nem as inscrições', async () => {
    const state = setup({ torneioHabilitado: true, torneio: torneioAberto(['a', 'b']) });
    const out = await run(['off'], ROLE_STAFF);

    assert.match(out, /Torneio desativado/);
    assert.equal(state.meta.torneioHabilitado, false);
    assert.equal(state.meta.torneio.inscricoes, false);
    assert.deepEqual(state.meta.torneio.players, ['a', 'b'], 'os inscritos devem ser preservados');
  });
});

describe('handler !torneio: agenda', () => {
  it('grava os dias/hora e o tempo de inscrição', async () => {
    const state = setup({ torneioHabilitado: false });
    const out = await run(['agenda', 'sex,sab', '19:00', '3'], ROLE_STAFF);

    assert.match(out, /Agenda do torneio/);
    assert.deepEqual(state.meta.torneio.agenda.dias, [5, 6]);
    assert.equal(state.meta.torneio.agenda.abrirMin, 19 * 60);
    assert.equal(state.meta.torneio.agenda.diasInscricao, 3);
  });

  it('off limpa a agenda', async () => {
    const state = setup({
      torneioHabilitado: false,
      torneio: { ...torneioAberto([]), active: false, agenda: { dias: [6], hora: '15:00', diasInscricao: 7 } }
    });
    const out = await run(['agenda', 'off'], ROLE_STAFF);
    assert.match(out, /removido/i);
    assert.equal(state.meta.torneio.agenda, null);
  });
});

describe('handler !torneio: sortear', () => {
  it('sorteia a rodada 1 com times balanceados (múltiplo de 10)', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
    const state = setup({ torneioHabilitado: true, torneio: torneioAberto(ids) });

    const out = await run(['sortear'], ROLE_STAFF);

    assert.match(out, /Rodada 1 sorteada/);
    assert.match(out, /Δ MMR/);
    assert.equal(state.meta.torneio.rounds.length, 1);
    assert.equal(state.meta.torneio.rounds[0].games.length, 2, '20 jogadores = 2 jogos de 5v5');
    assert.equal(state.meta.torneio.reservas.length, 0);
  });

  it('com menos de 20 inscritos não sorteia (segue aguardando)', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    const state = setup({ torneioHabilitado: true, torneio: torneioAberto(ids) });

    const out = await run(['sortear'], ROLE_STAFF);

    assert.match(out, /Faltam 8 inscritos/);
    assert.equal(state.meta.torneio.rounds.length, 0);
  });

  it('com 23 inscritos fecha com os 20 primeiros e guarda 3 reservas', async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `p${i + 1}`);
    const state = setup({ torneioHabilitado: true, torneio: torneioAberto(ids) });

    const out = await run(['sortear'], ROLE_STAFF);
    const sorteaveis = state.meta.torneio.rounds[0].games
      .flatMap((g) => [...g.teamOne, ...g.teamTwo].map((p) => p.discordId));

    assert.match(out, /Rodada 1 sorteada/);
    assert.equal(sorteaveis.length, 20);
    assert.deepEqual([...state.meta.torneio.reservas].sort(), ['p21', 'p22', 'p23']);
    assert.ok(sorteaveis.every((id) => !state.meta.torneio.reservas.includes(id)), 'reserva não pode jogar');
  });
});

describe('handler: comandos só de Staff (Capitão fora, Admin/Administrador entra)', () => {
  const CASES = [
    { name: '!clubefixar', run: (m) => legacy.handleClubeFixarCommand(m), passou: /Canal #clube-vip não encontrado/ },
    { name: '!ajudafixar', run: (m) => legacy.handleAjudaFixarCommand(m), passou: /Canal #infos-lol não encontrado/ },
    { name: '!clubeadmin', run: (m) => legacy.handleClubeAdminCommand(m), passou: /Nenhuma assinatura ativa/ }
  ];

  async function exec(command, member) {
    setup({});
    const message = mkMessage({ member: mkMember(member) });
    await command.run(message);
    return message.replies.map(textOf).join('\n');
  }

  for (const command of CASES) {
    it(`${command.name}: Capitão é bloqueado`, async () => {
      assert.match(await exec(command, ROLE_CAPITAO), /Restrito à staff/);
    });

    it(`${command.name}: Staff (cargo) passa`, async () => {
      assert.match(await exec(command, ROLE_STAFF), command.passou);
    });

    it(`${command.name}: Moderador passa`, async () => {
      assert.match(await exec(command, ROLE_MOD), command.passou);
    });

    it(`${command.name}: Administrador passa`, async () => {
      const admin = { roleNames: ['Jogador'], perms: ['Administrator'] };
      assert.match(await exec(command, admin), command.passou);
    });

    it(`${command.name}: ManageMessages passa`, async () => {
      const mod = { roleNames: ['Jogador'], perms: ['ManageMessages'] };
      assert.match(await exec(command, mod), command.passou);
    });

    it(`${command.name}: jogador comum é bloqueado`, async () => {
      assert.match(await exec(command, ROLE_JOGADOR), /Restrito à staff/);
    });
  }
});

describe('handler !staff: guia restrito à Staff', () => {
  async function runStaff(member) {
    setup({});
    const message = mkMessage({ member: mkMember(member) });
    const sent = [];
    message.channel = { id: 'c1', isTextBased: () => true, send: async (p) => { sent.push(p); } };
    await legacy.handleStaffCommand(message);
    return { replies: message.replies.map(textOf).join('\n'), sent };
  }

  it('Capitão é bloqueado', async () => {
    const { replies, sent } = await runStaff(ROLE_CAPITAO);
    assert.match(replies, /Guia restrito à staff/);
    assert.equal(sent.length, 0, 'não pode receber o guia');
  });

  it('jogador comum é bloqueado', async () => {
    const { replies, sent } = await runStaff(ROLE_JOGADOR);
    assert.match(replies, /Guia restrito à staff/);
    assert.equal(sent.length, 0);
  });

  it('Staff recebe o guia no canal', async () => {
    const { replies, sent } = await runStaff(ROLE_STAFF);
    assert.doesNotMatch(replies, /restrito/i);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].embeds?.length, 1);
  });

  it('Administrador recebe o guia mesmo sem cargo de Staff', async () => {
    const { sent } = await runStaff({ roleNames: ['Jogador'], perms: ['Administrator'] });
    assert.equal(sent.length, 1);
  });
});
