const DEFAULT_CONTENT_TEMPLATES = {
  welcome: {
    titleTemplate: 'COMECE AQUI',
    description: 'Use este comando para liberar seu acesso.',
    rulesTitle: '',
    rulesText: '',
    unlockTitle: 'COPIE ESTE COMANDO',
    unlockText: '```bash\n!cadastrar Nick#TAG\n```\nCole no chat e envie agora.',
    howToPlayTitle: '',
    howToPlayText: '',
    commandsTitle: '',
    commandsText: '',
    footerText: 'Caps Bot - Arena de Personalizadas'
  },
  onboarding: {
    title: 'Arena Caps - Guia de Inicio Rapido',
    description: 'Partidas personalizadas com fila persistente, times balanceados por MMR interno e historico completo de resultados.\n\n**Fluxo rapido: cadastrar, entrar na call, jogar, votar e acompanhar sua evolucao.**',
    registrationTitle: 'PASSO 1 - Cadastre sua conta (uma unica vez)',
    registrationText: 'Vincule seu Nick da Riot ao seu Discord:\n```\n!cadastrar SeuNick#TAG\n```\nApos isso, voce nunca mais precisara digitar seu nick.\n> Se trocar de nick na Riot: `!nick NovoNick#TAG`',
    queueTitle: 'PASSO 2 - Entre na fila',
    queueText: 'Entre em um canal de voz de Lobby e use:\n```\n!entrar              -> Classic 5x5\n!entrar aram         -> ARAM 5x5\n!entrar aram 1x1     -> ARAM 1x1\n!entrar aram 2x2     -> ARAM 2x2\n```\nQuando a sala completa, o bot anuncia, cria os times e move a galera automaticamente.',
    voteTitle: 'PASSO 3 - Vote no vencedor',
    voteText: 'Ao terminar a partida, vote no time que ganhou:\n```\n!votar 1   -> Voto no Time 1\n!votar 2   -> Voto no Time 2\n```\n> 3 votos confirmam o resultado automaticamente.\n> Staff pode registrar com `!vitoria 1` ou `!vitoria 2` a qualquer momento.',
    progressTitle: 'Acompanhe sua evolucao',
    progressText: '`!perfil` - Seu card com MMR e historico\n`!placar` - Ranking geral por modo\n`!top10` - Top 10 por MMR\n`!topstreak` - Maiores sequencias de vitoria ativas\n`!temporadas` - Periodos arquivados',
    channelsTitle: 'Canais Importantes',
    channelsText: '',
    commandsTitle: 'Outros Comandos Uteis',
    commandsText: '`!lista` - Mostra filas e lobbies ativos\n`!sair` - Sair da fila\n`!cancelarstart` - Cancela auto-start de lobby cheio\n`!start` / `!vitoria` - Controle manual da staff\n`!ajuda` - Lista completa de comandos',
    fairPlayTitle: 'Regras e Fair Play',
    fairPlayText: 'Mantenha o respeito dentro e fora das partidas.\nAtitudes toxicas resultam em banimento do sistema de elo.\n*Bom jogo e que venca o melhor!*',
    footerText: 'Caps Bot - Guia Atualizado'
  }
};

function mergeSection(defaults, overrides) {
  return { ...defaults, ...(overrides || {}) };
}

function getResolvedContentTemplates(storedTemplates = {}) {
  return {
    welcome: mergeSection(DEFAULT_CONTENT_TEMPLATES.welcome, storedTemplates.welcome),
    onboarding: mergeSection(DEFAULT_CONTENT_TEMPLATES.onboarding, storedTemplates.onboarding)
  };
}

function renderTemplate(template, variables = {}) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => String(variables[key] ?? ''));
}

module.exports = {
  DEFAULT_CONTENT_TEMPLATES,
  getResolvedContentTemplates,
  renderTemplate
};
