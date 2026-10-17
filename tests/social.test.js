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
