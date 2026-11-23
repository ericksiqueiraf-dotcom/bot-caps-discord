const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickCommonMatchId, rankCommonMatchIds, countPlayerGroupsPresent } = require('../services/riotService');
const { computeCapsGrade, buildMatchStatsEmbed } = require('../utils/lobbyUtils');
const {
  isClassicFiveVersusFive,
  collectKnownPlayers
} = require('../application/use-cases/publishMatchStats');
const { splitRiotIdInput, isValidRiotIdFormat } = require('../domain/accounts/riotIdInput');

function makeParticipant(overrides = {}) {
  return {
    puuid: 'p1',
    riotIdGameName: 'Teste',
    riotIdTagline: 'BR1',
    championName: 'Ahri',
    teamId: 1,
    teamPosition: 'MIDDLE',
    kills: 10,
    deaths: 2,
    assists: 8,
    totalMinionsKilled: 200,
    neutralMinionsKilled: 10,
    goldEarned: 14000,
    totalDamageDealtToChampions: 28000,
    visionScore: 25,
    timePlayed: 1920,
    ...overrides
  };
}

describe('busca da custom por puuid', () => {
  it('escolhe o matchId presente na maioria dos puuids', () => {
    const lists = [
      ['BR1_1', 'BR1_2'],
      ['BR1_1', 'BR1_3'],
      ['BR1_1', 'BR1_4'],
      ['BR1_1'],
      ['BR1_2', 'BR1_1']
    ];
    const picked = pickCommonMatchId(lists);
    assert.equal(picked.matchId, 'BR1_1');
    assert.equal(picked.votes, 5);
  });

  it('exige maioria: 2 de 10 nao basta', () => {
    const lists = [
      ['BR1_1'], ['BR1_1'], ['BR1_9'], ['BR1_8'], ['BR1_7'],
      ['BR1_6'], ['BR1_5'], ['BR1_4'], ['BR1_3'], ['BR1_2']
    ];
    assert.equal(pickCommonMatchId(lists), null);
  });

  it('aceita exatamente o minimo de votos (metade)', () => {
    const lists = [
      ['BR1_1'], ['BR1_1'], ['BR1_1'], ['BR1_1'], ['BR1_1'],
      ['BR1_2'], ['BR1_3'], ['BR1_4'], ['BR1_5'], ['BR1_6']
    ];
    const picked = pickCommonMatchId(lists);
    assert.equal(picked.matchId, 'BR1_1');
    assert.equal(picked.required, 5);
  });

  it('com poucas listas o minimo e 3', () => {
    assert.equal(pickCommonMatchId([['A'], ['A']]), null);
    assert.equal(pickCommonMatchId([['A'], ['A'], ['A']]).matchId, 'A');
  });

  it('rankCommonMatchIds ordena por votos', () => {
    const ranked = rankCommonMatchIds([['A', 'B'], ['B'], ['B', 'A']]);
    assert.deepEqual(ranked, [
      { matchId: 'B', votes: 3 },
      { matchId: 'A', votes: 2 }
    ]);
  });
});

describe('Nota CAPS (estimativa)', () => {
  it('carry com KDA alto e muito dano tira S', () => {
    const grade = computeCapsGrade(makeParticipant({
      kills: 12, deaths: 2, assists: 10,
      totalDamageDealtToChampions: 30000,
      totalMinionsKilled: 220
    }), { gameDurationMinutes: 32, teamKills: 30, teamDamage: 70000 });

    assert.ok(grade.score >= 8, `esperava >= 8, veio ${grade.score}`);
    assert.ok(['S', 'S+'].includes(grade.grade));
  });

  it('jogador que feeda tira nota baixa', () => {
    const grade = computeCapsGrade(makeParticipant({
      kills: 0, deaths: 12, assists: 1,
      totalDamageDealtToChampions: 6000,
      totalMinionsKilled: 80,
      visionScore: 8
    }), { gameDurationMinutes: 32, teamKills: 30, teamDamage: 70000 });

    assert.ok(grade.score < 5, `esperava < 5, veio ${grade.score}`);
    assert.equal(grade.grade, 'D');
  });

  it('suporte e avaliado com baselines proprios (CS baixo nao pune)', () => {
    const grade = computeCapsGrade(makeParticipant({
      teamPosition: 'UTILITY',
      kills: 2, deaths: 4, assists: 20,
      totalMinionsKilled: 30,
      neutralMinionsKilled: 0,
      totalDamageDealtToChampions: 10000,
      visionScore: 60
    }), { gameDurationMinutes: 32, teamKills: 30, teamDamage: 70000 });

    assert.ok(grade.score >= 7, `esperava >= 7, veio ${grade.score}`);
  });

  it('a nota fica sempre entre 0 e 10', () => {
    const absurd = computeCapsGrade(makeParticipant({
      kills: 99, deaths: 0, assists: 99,
      totalDamageDealtToChampions: 999999,
      visionScore: 999
    }), { gameDurationMinutes: 5, teamKills: 1, teamDamage: 1 });
    const broken = computeCapsGrade({}, {});
    assert.ok(absurd.score <= 10 && absurd.score >= 0);
    assert.ok(broken.score <= 10 && broken.score >= 0);
  });
});

describe('embed de estatisticas da partida', () => {
  const match = {
    info: {
      gameDuration: 1925,
      queueId: 0,
      participants: [
        makeParticipant({ puuid: 'p1', teamId: 1, kills: 12, deaths: 2, assists: 10 }),
        makeParticipant({ puuid: 'p2', teamId: 1, riotIdGameName: 'Dois', championName: 'Lee Sin', teamPosition: 'JUNGLE' }),
        makeParticipant({ puuid: 'p3', teamId: 2, riotIdGameName: 'Tres', championName: 'Darius', teamPosition: 'TOP', kills: 2, deaths: 9, assists: 3 })
      ],
      teams: [
        { teamId: 1, objectives: { dragon: { kills: 3 }, baron: { kills: 1 }, tower: { kills: 8 } } },
        { teamId: 2, objectives: { dragon: { kills: 1 }, baron: { kills: 0 }, tower: { kills: 2 } } }
      ]
    }
  };

  it('monta titulo, duracao, objetivos e destaques', () => {
    const embed = buildMatchStatsEmbed({
      match,
      winningTeam: '1',
      letter: 'A',
      modeLabel: 'CLASSIC',
      formatLabel: '5x5',
      playersByPuuid: { p1: { discordId: '111', nickname: 'Um' } }
    });

    const json = embed.toJSON();
    assert.match(json.title, /Estatísticas — Lobby A \(CLASSIC 5x5\)/);
    assert.match(json.description, /Duração:\*\* `32:05`/);
    assert.match(json.description, /3 dragões/);
    assert.ok(json.fields.some((field) => field.name === '🏆 Destaques'));
    assert.match(json.footer.text, /estimativa própria/);
  });

  it('menciona o Discord de quem tem puuid vinculado', () => {
    const embed = buildMatchStatsEmbed({
      match,
      winningTeam: '1',
      playersByPuuid: { p1: { discordId: '111' } }
    });
    const text = embed.toJSON().fields.map((field) => field.value).join('\n');
    assert.match(text, /<@111>/);
    assert.doesNotMatch(text, /<@undefined>/);
  });

  it('respeita o limite de 1024 caracteres por campo', () => {
    const bigMatch = {
      info: {
        ...match.info,
        participants: Array.from({ length: 10 }, (_, index) => makeParticipant({
          puuid: `p${index}`,
          riotIdGameName: `JogadorComNomeBemGrande${index}`,
          riotIdTagline: 'BR1'
        }))
      }
    };
    const embed = buildMatchStatsEmbed({ match: bigMatch, winningTeam: '1' });
    for (const field of embed.toJSON().fields) {
      assert.ok(field.value.length <= 1024, `campo "${field.name}" tem ${field.value.length} chars`);
    }
  });
});

describe('disparo pos-vitoria', () => {
  it('so dispara em classic 5x5', () => {
    assert.equal(isClassicFiveVersusFive({ mode: 'classic', format: '5x5' }), true);
    assert.equal(isClassicFiveVersusFive({ mode: 'classic' }), true);
    assert.equal(isClassicFiveVersusFive({ mode: 'aram', format: '5x5' }), false);
    assert.equal(isClassicFiveVersusFive({ mode: 'classic', format: '3x3' }), false);
  });

  it('coleta e deduplica puuids, ignorando quem nao tem', () => {
    const result = collectKnownPlayers({
      teamOne: [
        { discordId: '1', puuid: 'aaa' },
        { discordId: '2', puuid: 'bbb' },
        { discordId: '3' }
      ],
      teamTwo: [
        { discordId: '4', puuid: 'aaa' },
        { discordId: '5', puuid: 'ccc' }
      ]
    });

    assert.deepEqual(result.puuids.sort(), ['aaa', 'bbb', 'ccc']);
    assert.equal(Object.keys(result.byPuuid).length, 3);
    assert.equal(result.groups.length, 4);
  });

  it('inclui a conta secundaria (smurf) do cadastro no grupo do jogador', () => {
    const result = collectKnownPlayers(
      {
        teamOne: [{ discordId: '1', puuid: 'main1' }],
        teamTwo: [{ discordId: '2', puuid: 'main2' }]
      },
      {
        players: {
          k1: { discordId: '1', puuid: 'main1', altPuuids: ['smurf1'] },
          k2: { discordId: '2', puuid: 'main2' }
        }
      }
    );

    assert.deepEqual(result.groups[0].puuids.sort(), ['main1', 'smurf1']);
    assert.deepEqual(result.groups[1].puuids, ['main2']);
    assert.equal(result.byPuuid.smurf1.discordId, '1');
    assert.deepEqual(result.puuids.sort(), ['main1', 'main2', 'smurf1']);
  });
});

describe('parser de contas no !cadastrar', () => {
  it('uma conta simples', () => {
    assert.deepEqual(splitRiotIdInput('Nick#TAG'), ['Nick#TAG']);
  });

  it('nome com espacos continua inteiro', () => {
    assert.deepEqual(splitRiotIdInput('PAYASUO ASSASINO#SHACO'), ['PAYASUO ASSASINO#SHACO']);
  });

  it('duas contas separadas por espaco', () => {
    assert.deepEqual(splitRiotIdInput('Nick1#TAG Nick2#TAG'), ['Nick1#TAG', 'Nick2#TAG']);
  });

  it('duas contas com nomes longos e virgula', () => {
    assert.deepEqual(
      splitRiotIdInput('Nome Com Espaco#BR1, Outro Nome#BR2'),
      ['Nome Com Espaco#BR1', 'Outro Nome#BR2']
    );
  });

  it('texto sem # fica invalido para o handler rejeitar', () => {
    assert.deepEqual(splitRiotIdInput('so um texto'), ['so um texto']);
    assert.equal(isValidRiotIdFormat('so um texto'), false);
    assert.equal(isValidRiotIdFormat('Nick#TAG'), true);
    assert.equal(isValidRiotIdFormat('Nick#'), false);
    assert.equal(isValidRiotIdFormat('#TAG'), false);
    assert.equal(isValidRiotIdFormat('Nick#TAG#extra'), false);
  });
});

describe('validacao por grupos de contas (principal + smurf)', () => {
  const participants = [
    { puuid: 'smurf1' },
    { puuid: 'main2' },
    { puuid: 'desconhecido' }
  ];

  it('conta o jogador pela smurf quando a principal nao jogou', () => {
    const groups = [
      { puuids: ['main1', 'smurf1'] },
      { puuids: ['main2', 'smurf2'] }
    ];
    assert.equal(countPlayerGroupsPresent(participants, groups), 2);
  });

  it('nao conta duas vezes o mesmo jogador', () => {
    const groups = [{ puuids: ['smurf1', 'main1'] }];
    assert.equal(countPlayerGroupsPresent([{ puuid: 'smurf1' }, { puuid: 'main1' }], groups), 1);
  });

  it('lista vazia devolve 0', () => {
    assert.equal(countPlayerGroupsPresent([], [{ puuids: ['x'] }]), 0);
    assert.equal(countPlayerGroupsPresent(participants, []), 0);
  });
});
