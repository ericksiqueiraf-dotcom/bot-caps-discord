// Divulgação das redes oficiais: embed, horários (3x/dia), canal e anti-duplicação.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const S = require('../services/socialService');

// Horário de SP = UTC-3. `sp(11)` = 11:00 em SP no dia 17/10/2026.
function sp(hora, minuto = 0, dia = 17) {
  return Date.UTC(2026, 9, dia, hora + 3, minuto, 0);
}

function makeCanal(nome, id = nome, { texto = true } = {}) {
  const sent = [];
  return {
    id: String(id),
    name: nome,
    sent,
    isTextBased: () => texto,
    send: async (payload) => { sent.push(payload); return { id: 'm1' }; }
  };
}

function makeGuild(canais = []) {
  const mapa = new Map(canais.map((c) => [String(c.id), c]));
  return {
    channels: { cache: { get: (id) => mapa.get(String(id)), values: () => mapa.values() } }
  };
}

const CFG = {
  social: {
    divulgacaoChannelId: '',
    horas: [10, 16, 21],
    links: {
      instagram: 'https://www.instagram.com/capsarenatv/',
      twitch: 'https://www.twitch.tv/capsarenatv',
      tiktok: '',
      youtube: ''
    }
  }
};

function makeDeps(guilds = [], meta = {}, cfg = CFG) {
  const salvos = [];
  return {
    meta,
    salvos,
    deps: {
      loadSystemMeta: async () => meta,
      saveSystemMeta: async (m) => { salvos.push({ ...m }); },
      guilds,
      cfg
    }
  };
}

describe('social: embed', () => {
  it('lista as 4 redes; sem link vira "em breve"', () => {
    const texto = S.buildSocialEmbed(CFG).toJSON().description;
    assert.match(texto, /instagram\.com\/capsarenatv/);
    assert.match(texto, /twitch\.tv\/capsarenatv/);
    assert.match(texto, /TikTok\*\* — em breve/);
    assert.match(texto, /YouTube\*\* — em breve/);
  });

  it('usa os links quando configurados (TikTok/YouTube)', () => {
    const cfg = S.buildSocialEmbed({
      social: { ...CFG.social, links: { ...CFG.social.links, tiktok: 'https://www.tiktok.com/@capsarenatv', youtube: 'https://youtube.com/@capsarenatv' } }
    }).toJSON().description;
    assert.match(cfg, /tiktok\.com\/@capsarenatv/);
    assert.match(cfg, /youtube\.com\/@capsarenatv/);
    assert.doesNotMatch(cfg, /em breve/);
  });

  it('link inválido/vazio é tratado como "em breve"', () => {
    assert.equal(S.linkDaRede('twitch', { social: { links: { twitch: 'capsarenatv' } } }), null);
    assert.equal(S.linkDaRede('twitch', { social: { links: { twitch: '' } } }), null);
    assert.equal(S.linkDaRede('twitch', {}), null);
  });
});

describe('social: horários', () => {
  it('padrão 3x/dia (10, 16, 21) — espaçado da promo do clube (12h/19h)', () => {
    assert.deepEqual(S.getHoras({}), [10, 16, 21]);
  });

  it('lê da config: ordena, remove duplicados e descarta inválidos', () => {
    assert.deepEqual(S.getHoras({ social: { horas: [21, 9, '9', 25, -1, 'x', 19] } }), [9, 19, 21]);
  });

  it('config sem hora válida volta ao padrão', () => {
    assert.deepEqual(S.getHoras({ social: { horas: [99, 'a'] } }), [10, 16, 21]);
  });

  it('slot: marca o horário dentro da hora cheia e ignora fora', () => {
    assert.equal(S.socialSlot(sp(10), CFG), '2026-10-17#10');
    assert.equal(S.socialSlot(sp(10, 59), CFG), '2026-10-17#10', 'vale a hora toda');
    assert.equal(S.socialSlot(sp(15), CFG), null, '15h não é horário de divulgar');
    assert.equal(S.socialSlot(sp(16, 5), CFG), '2026-10-17#16');
    assert.equal(S.socialSlot(sp(10, 0, 18), CFG), '2026-10-18#10', 'slot muda de dia');
  });
});

describe('social: canal', () => {
  it('canal do config tem prioridade', () => {
    const alvo = makeCanal('💬・geral-leagueoflegends', '999');
    const outro = makeCanal('💬・geral-leagueoflegends', '111');
    const cfg = { social: { divulgacaoChannelId: '999' } };
    assert.equal(S.findSocialChannel(makeGuild([outro, alvo]), cfg), alvo);
  });

  it('acha pelo nome exato e por nome parcial', () => {
    const geral = makeCanal('💬・geral-leagueoflegends');
    assert.equal(S.findSocialChannel(makeGuild([makeCanal('🤖・comandos'), geral]), CFG), geral);
    const parcial = makeCanal('💬・geral-leagueoflegends-2');
    assert.equal(S.findSocialChannel(makeGuild([parcial]), CFG), parcial);
  });

  it('cai no canal de avisos quando não existe o geral', () => {
    const avisos = makeCanal('📢┃comunicados');
    assert.equal(S.findSocialChannel(makeGuild([avisos]), CFG), avisos);
  });

  it('ignora canal que não é de texto e devolve null se não houver nada', () => {
    assert.equal(S.findSocialChannel(makeGuild([makeCanal('💬・geral-leagueoflegends', 'x', { texto: false })]), CFG), null);
    assert.equal(S.findSocialChannel(makeGuild([]), CFG), null);
    assert.equal(S.findSocialChannel(null, CFG), null);
  });
});

describe('social: tick automático', () => {
  it('fora de horário não posta nem marca o slot', async () => {
    const canal = makeCanal('💬・geral-leagueoflegends');
    const { deps, salvos } = makeDeps([makeGuild([canal])]);
    const r = await S.runSocialTick(sp(15), deps);
    assert.equal(r.posted, 0);
    assert.equal(canal.sent.length, 0);
    assert.equal(salvos.length, 0);
  });

  it('posta 1x no horário e grava o slot', async () => {
    const canal = makeCanal('💬・geral-leagueoflegends');
    const { deps, meta, salvos } = makeDeps([makeGuild([canal])]);
    const r = await S.runSocialTick(sp(10), deps);
    assert.equal(r.posted, 1);
    assert.equal(canal.sent.length, 1);
    assert.equal(canal.sent[0].embeds.length, 1);
    assert.equal(meta.socialUltimoSlot, '2026-10-17#10');
    assert.equal(salvos.length, 1);
  });

  it('não duplica no mesmo horário (mesmo com tick repetido)', async () => {
    const canal = makeCanal('💬・geral-leagueoflegends');
    const { deps } = makeDeps([makeGuild([canal])]);
    await S.runSocialTick(sp(10), deps);
    const r = await S.runSocialTick(sp(10, 30), deps);
    assert.equal(r.posted, 0);
    assert.equal(canal.sent.length, 1, 'só a primeira postagem');
  });

  it('posta de novo no horário seguinte (3x no dia)', async () => {
    const canal = makeCanal('💬・geral-leagueoflegends');
    const { deps } = makeDeps([makeGuild([canal])]);
    await S.runSocialTick(sp(10), deps);
    await S.runSocialTick(sp(16), deps);
    await S.runSocialTick(sp(21), deps);
    assert.equal(canal.sent.length, 3);
  });

  it('sem canal não posta e não grava o slot (tenta de novo depois)', async () => {
    const { deps, meta, salvos } = makeDeps([makeGuild([])]);
    const r = await S.runSocialTick(sp(10), deps);
    assert.equal(r.posted, 0);
    assert.equal(meta.socialUltimoSlot, undefined);
    assert.equal(salvos.length, 0);
  });

  it('posta em todas as guilds que tiverem o canal', async () => {
    const a = makeCanal('💬・geral-leagueoflegends', 'a');
    const b = makeCanal('📢┃comunicados', 'b');
    const { deps } = makeDeps([makeGuild([a]), makeGuild([b]), makeGuild([])]);
    const r = await S.runSocialTick(sp(21), deps);
    assert.equal(r.posted, 2);
    assert.equal(a.sent.length, 1);
    assert.equal(b.sent.length, 1);
  });
});

// ---------------------------------------------------------------- pôster
const CFG_POSTER = {
  social: {
    ...CFG.social,
    poster: {
      ativo: true,
      arquivo: 'IMAGENS/TORNEIO CAPS ARENA.png',
      canais: ['📢┃comunicados', '💬・geral-leagueoflegends'],
      horas: [10, 16, 21]
    }
  }
};

function makeDepsPoster(guilds = [], meta = {}, cfg = CFG_POSTER) {
  const salvos = [];
  return {
    meta,
    salvos,
    deps: {
      loadSystemMeta: async () => meta,
      saveSystemMeta: async (m) => { salvos.push({ ...m }); },
      guilds,
      cfg,
      anexoFactory: (arquivo) => ({ attachment: arquivo, name: S.POSTER_ANEXO_NOME })
    }
  };
}

describe('pôster agendado: config e canais', () => {
  it('defaults: comunicados + geral, nos horários da divulgação', () => {
    const p = S.getPosterCfg({});
    assert.equal(p.ativo, true);
    assert.deepEqual(p.canais, S.POSTER_CANAIS_DEFAULT);
    assert.deepEqual(p.canais, ['📢┃comunicados', '💬・geral-leagueoflegends']);
    assert.equal(p.arquivo, S.POSTER_ARQUIVO_DEFAULT);
    assert.deepEqual(p.horas, [10, 16, 21]);
  });

  it('lê canais/arquivo/horas da config e respeita ativo=false', () => {
    const p = S.getPosterCfg({ social: { poster: { ativo: false, arquivo: 'x.png', canais: ['só-esse'], horas: [21, 7] } } });
    assert.equal(p.ativo, false);
    assert.equal(p.arquivo, 'x.png');
    assert.deepEqual(p.canais, ['só-esse']);
    assert.deepEqual(p.horas, [7, 21], 'ordena as horas');
  });

  it('findCanaisPorNomes: exato nos dois, sem duplicar, e parcial quando não há exato', () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const comun = makeCanal('📢┃comunicados', 'c');
    const outros = makeCanal('🤖・comandos', 'x');
    const achados = S.findCanaisPorNomes(makeGuild([outros, geral, comun]), ['📢┃comunicados', '💬・geral-leagueoflegends']);
    assert.deepEqual(achados.map((c) => c.id), ['c', 'g']);
    const parcial = makeCanal('📢┃comunicados-avisos', 'p');
    assert.deepEqual(S.findCanaisPorNomes(makeGuild([parcial]), ['📢┃comunicados']).map((c) => c.id), ['p']);
  });

  it('findCanaisPorNomes: aceita ID (à prova de renomeação)', () => {
    const idComun = '1487953358407860235';
    const comun = makeCanal('📢┃comunicados', idComun);
    const outro = makeCanal('📢┃comunicados-v2', '1487953358407860236');
    assert.deepEqual(S.findCanaisPorNomes(makeGuild([outro, comun]), [idComun]).map((c) => c.id), [idComun]);
    assert.deepEqual(S.findCanaisPorNomes(makeGuild([comun]), ['999999999999999999']), [], 'id inexistente');
  });

  it('poster aceita os 2 canais por ID na config', () => {
    const cfg = {
      social: {
        poster: {
          canais: ['1487953358407860235', '1544297359918506004']
        }
      }
    };
    const comun = makeCanal('📢┃comunicados', '1487953358407860235');
    const geral = makeCanal('💬・geral-leagueoflegends', '1544297359918506004');
    assert.deepEqual(S.findPosterChannels(makeGuild([geral, comun]), cfg).map((c) => c.id),
      ['1487953358407860235', '1544297359918506004']);
  });

  it('findPosterChannels: acha os 2 canais; sem eles cai no canal da divulgação; ignora não-texto', () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const comun = makeCanal('📢┃comunicados', 'c');
    assert.deepEqual(S.findPosterChannels(makeGuild([geral, comun]), CFG_POSTER).map((x) => x.id), ['c', 'g']);

    const soGeral = makeCanal('💬・geral-leagueoflegends', 'g');
    assert.deepEqual(S.findPosterChannels(makeGuild([soGeral]), CFG_POSTER).map((x) => x.id), ['g']);

    assert.deepEqual(S.findPosterChannels(makeGuild([]), CFG_POSTER), []);
    assert.deepEqual(
      S.findPosterChannels(makeGuild([makeCanal('📢┃comunicados', 'c', { texto: false })]), CFG_POSTER),
      [],
      'canal de voz não conta'
    );
  });

  it('posterSlot: 10/16/21 valem a hora toda; fora disso é null; vira o dia', () => {
    assert.equal(S.posterSlot(sp(10), CFG_POSTER), '2026-10-17#10');
    assert.equal(S.posterSlot(sp(10, 59), CFG_POSTER), '2026-10-17#10');
    assert.equal(S.posterSlot(sp(16, 5), CFG_POSTER), '2026-10-17#16');
    assert.equal(S.posterSlot(sp(15), CFG_POSTER), null);
    assert.equal(S.posterSlot(sp(10, 0, 18), CFG_POSTER), '2026-10-18#10');
  });

  it('embed do pôster: título do torneio + imagem do anexo', () => {
    const e = S.buildPosterEmbed(CFG_POSTER).toJSON();
    assert.match(e.title, /TORNEIO CAPS ARENA/);
    assert.equal(e.image.url, `attachment://${S.POSTER_ANEXO_NOME}`);
    assert.match(e.description, /!torneio entrar/);
    assert.match(e.description, /MD3/);
  });
});

describe('pôster agendado: tick automático', () => {
  it('posta nos 2 canais no horário e grava o slot por canal', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const comun = makeCanal('📢┃comunicados', 'c');
    const { deps, meta, salvos } = makeDepsPoster([makeGuild([geral, comun])]);
    const r = await S.runPosterTick(sp(10), deps);
    assert.equal(r.posted, 2);
    assert.equal(geral.sent.length, 1);
    assert.equal(comun.sent.length, 1);
    assert.equal(geral.sent[0].embeds.length, 1);
    assert.equal(geral.sent[0].files.length, 1, 'vai o pôster anexado');
    assert.deepEqual(meta.posterSlots, { c: '2026-10-17#10', g: '2026-10-17#10' });
    assert.equal(meta.posterUltimoSlot, '2026-10-17#10');
    assert.equal(salvos.length, 1);
  });

  it('não duplica no mesmo slot (tick repetido)', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const { deps } = makeDepsPoster([makeGuild([geral])]);
    await S.runPosterTick(sp(10), deps);
    const r = await S.runPosterTick(sp(10, 30), deps);
    assert.equal(r.posted, 0);
    assert.equal(geral.sent.length, 1);
  });

  it('canal que já recebeu no slot não recebe de novo; o outro sim', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const comun = makeCanal('📢┃comunicados', 'c');
    const meta = { posterSlots: { g: '2026-10-17#10' } };
    const { deps } = makeDepsPoster([makeGuild([geral, comun])], meta);
    const r = await S.runPosterTick(sp(10), deps);
    assert.equal(r.posted, 1);
    assert.equal(geral.sent.length, 0);
    assert.equal(comun.sent.length, 1);
  });

  it('posta de novo no horário seguinte', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const { deps } = makeDepsPoster([makeGuild([geral])]);
    await S.runPosterTick(sp(10), deps);
    await S.runPosterTick(sp(16), deps);
    assert.equal(geral.sent.length, 2);
  });

  it('fora de horário não posta nem grava slot', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const { deps, meta, salvos } = makeDepsPoster([makeGuild([geral])]);
    const r = await S.runPosterTick(sp(15), deps);
    assert.equal(r.posted, 0);
    assert.equal(geral.sent.length, 0);
    assert.equal(meta.posterSlots, undefined);
    assert.equal(salvos.length, 0);
  });

  it('pôster ausente no disco: não posta e não marca o slot', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const cfg = { social: { ...CFG_POSTER.social, poster: { ...CFG_POSTER.social.poster, arquivo: 'imagens/nao-existe.png' } } };
    const { deps, meta } = makeDepsPoster([makeGuild([geral])], {}, cfg);
    const r = await S.runPosterTick(sp(10), deps);
    assert.equal(r.posted, 0);
    assert.match(r.reason, /ausente/);
    assert.equal(geral.sent.length, 0);
    assert.equal(meta.posterSlots, undefined);
  });

  it('ativo=false desliga o pôster sem mexer na divulgação', async () => {
    const geral = makeCanal('💬・geral-leagueoflegends', 'g');
    const cfg = { social: { ...CFG_POSTER.social, poster: { ...CFG_POSTER.social.poster, ativo: false } } };
    const { deps } = makeDepsPoster([makeGuild([geral])], {}, cfg);
    const r = await S.runPosterTick(sp(10), deps);
    assert.equal(r.posted, 0);
    assert.equal(geral.sent.length, 0);
  });

  it('sem canal: não posta e não grava', async () => {
    const { deps, meta } = makeDepsPoster([makeGuild([])]);
    const r = await S.runPosterTick(sp(10), deps);
    assert.equal(r.posted, 0);
    assert.equal(meta.posterSlots, undefined);
  });

  it('multi-guild: posta nos 2 canais de cada guild', async () => {
    const g1 = makeGuild([makeCanal('💬・geral-leagueoflegends', 'g1a'), makeCanal('📢┃comunicados', 'g1b')]);
    const g2 = makeGuild([makeCanal('💬・geral-leagueoflegends', 'g2a'), makeCanal('📢┃comunicados', 'g2b')]);
    const { deps } = makeDepsPoster([g1, g2]);
    const r = await S.runPosterTick(sp(21), deps);
    assert.equal(r.posted, 4);
  });
});
