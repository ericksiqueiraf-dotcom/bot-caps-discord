// Modo exclusivo do bot LCL: apenas comandos do desafio inter-servidores.
// Lista unica usada pelo processCommand e pelo registro de slash.

const INTER_COMMANDS = new Set([
  'desafiar',
  'desafiar-cancelar', 'cancelardesafio', 'cancelar-desafio',
  'resultado-inter', 'resultadointer',
  'wo', 'wo-inter',
  'inter-ranking', 'interranking',
  'inter-historico', 'interhistorico',
  // utilidades liberadas
  'ping', 'ajuda', 'regras', 'regrasdesafio'
]);

function isInterOnlyMode() {
  return String(process.env.INTER_ONLY || '') === '1';
}

function isInterCommand(command) {
  return INTER_COMMANDS.has(String(command || '').toLowerCase());
}

const INTER_ONLY_REPLY = '⚔️ Aqui é a **LCL — Liga Clandestina de LoL** (só modo desafio).\n' +
  '`!desafiar <nome> MD1 @j1 @j2 @j3 @j4 @j5` • `!resultado-inter 1 AZUL` • `!wo` • `!inter-ranking` • `!inter-historico`';

module.exports = {
  INTER_COMMANDS,
  isInterOnlyMode,
  isInterCommand,
  INTER_ONLY_REPLY
};
