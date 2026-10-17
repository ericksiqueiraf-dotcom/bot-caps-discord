// Harness para testar HANDLERS de comando sem Discord nem banco.
//
// Os handlers recebem uma "message" e respondem via `replyToMessage`, que só
// chama `message.reply(payload)`. Aqui montamos uma message falsa que grava as
// respostas, e carregamos `commands/legacyCommands` com o `dataService` trocado
// por stubs (as funções são capturadas no require, por isso o require.cache).
const { Collection } = require('discord.js');

function mkMember({ id = 'u1', roleNames = [], perms = [] } = {}) {
  return {
    id,
    permissions: { has: (p) => perms.includes(p) },
    roles: { cache: new Collection(roleNames.map((n, i) => [String(i), { name: n }])) }
  };
}

function mkGuild(overrides = {}) {
  return {
    id: 'g1',
    roles: { cache: new Collection() },
    members: { fetch: async (id) => ({ id, displayName: String(id) }) },
    ...overrides
  };
}

function mkMessage({ authorId = 'u1', member, guild } = {}) {
  const replies = [];
  return {
    author: { id: authorId, tag: `${authorId}#0001` },
    member: member || mkMember({ id: authorId }),
    guild: guild || mkGuild(),
    channel: { id: 'c1' },
    channelId: 'c1',
    client: { channels: { fetch: async () => null } },
    deletable: false,
    reply: async (payload) => { replies.push(payload); return { id: `m${replies.length}` }; },
    replies
  };
}

// Carrega commands/legacyCommands com stubs do dataService.
// Restaura o cache depois: o módulo já guardou as referências dos stubs.
function loadLegacyWithStubs(stubs = {}) {
  const dataPath = require.resolve('../services/dataService');
  const cached = require.cache[dataPath];
  const dataService = cached ? cached.exports : require('../services/dataService');

  require.cache[dataPath] = {
    id: dataPath,
    filename: dataPath,
    loaded: true,
    exports: { ...dataService, ...stubs }
  };
  try {
    const legacyPath = require.resolve('../commands/legacyCommands');
    delete require.cache[legacyPath];
    return require('../commands/legacyCommands');
  } finally {
    if (cached) require.cache[dataPath] = cached;
    else delete require.cache[dataPath];
  }
}

function textOf(reply) {
  if (reply == null) return '';
  if (typeof reply === 'string') return reply;
  return String(reply.content || '');
}

module.exports = { mkMember, mkGuild, mkMessage, loadLegacyWithStubs, textOf };
