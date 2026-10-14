const path = require('path');
// .env sempre da pasta do bot (nao depende de onde o terminal foi aberto).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const config = require('./config.json');
const { isInterOnlyMode, isInterCommand, INTER_ONLY_REPLY } = require('./commands/interOnly');
const INTER_ONLY_SLASH = new Set([
  'desafiar', 'desafiar-cancelar', 'resultado-inter', 'wo-inter',
  'inter-ranking', 'inter-historico', 'ajuda', 'regras', 'regrasdesafio', 'ping'
]);
const { createRiotService } = require('./services/riotService');
const {
  createBalancedTeams,
  calculateHybridMmr,
  calculateSeedRating,
  calculateEloDelta
} = require('./services/balanceService');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const BOT_VERSION = 'v1.8.0';
const ONBOARDING_BUTTON_IDS = {
  LOL_PLAYER: 'onboarding_lol_player',
  NON_PLAYER: 'onboarding_non_player'
};
const ONBOARDING_MODAL_ID = 'onboarding_lol_registration';
const ONBOARDING_MODAL_FIELD_ID = 'riot_nickname';

const {
  ensureDataFiles,
  withQueueOperationLock,
  loadQueue,
  saveQueue,
  loadPlayerStats,
  savePlayerStats,
  loadCurrentMatch,
  saveCurrentMatch,
  loadSeasonMeta,
  saveSeasonMeta,
  loadSeasonHistory,
  saveSeasonHistory,
  loadContentTemplates,
  loadLclQueue,
  saveLclQueue,
  QUEUE_MODES
} = require('./services/dataService');
const { getResolvedContentTemplates, renderTemplate } = require('./services/contentTextService');

if (!DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN nao foi configurado no arquivo .env.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

function addModeAndLobbyOptions(builder, includeWinner = false) {
  if (includeWinner) {
    builder.addIntegerOption((option) =>
      option
        .setName('equipe')
        .setDescription('Equipe vencedora')
        .setRequired(true)
        .addChoices(
          { name: 'Equipe 1', value: 1 },
          { name: 'Equipe 2', value: 2 }
        )
    );
  }

  builder
    .addStringOption((option) =>
      option
        .setName('modo')
        .setDescription('Modo da sala')
        .setRequired(false)
        .addChoices(
          { name: 'CLASSIC', value: 'classic' },
          { name: 'ARAM', value: 'aram' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('formato')
        .setDescription('Formato da sala, usado no ARAM')
        .setRequired(false)
        .addChoices(
          { name: '1x1', value: '1x1' },
          { name: '2x2', value: '2x2' },
          { name: '3x3', value: '3x3' },
          { name: '4x4', value: '4x4' },
          { name: '5x5', value: '5x5' }
        )
    )
    .addStringOption((option) =>
      option.setName('sala').setDescription('Letra da sala, ex.: A').setRequired(false)
    );

  return builder;
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName('ping').setDescription('Verifica se o bot esta online.'),
    new SlashCommandBuilder().setName('ajuda').setDescription('Mostra a lista de comandos.'),
    new SlashCommandBuilder().setName('regras').setDescription('Mostra o regulamento da CAPS Arena.'),
    new SlashCommandBuilder().setName('regrasdesafio').setDescription('Mostra as regras do desafio LCL.'),
    new SlashCommandBuilder().setName('staff').setDescription('Guia de comandos da staff.'),
    new SlashCommandBuilder().setName('roletasair').setDescription('Fica fora da próxima partida (sem sorteio nem subida).')
      .addStringOption((option) => option.setName('sala').setDescription('Letra da sala, ex.: A').setRequired(false)),
    new SlashCommandBuilder().setName('pdl').setDescription('Ajuste de PDL Classic (staff).')
      .addUserOption((option) => option.setName('jogador').setDescription('Jogador').setRequired(true))
      .addIntegerOption((option) => option.setName('valor').setDescription('Ex: -50').setRequired(true).setMinValue(-500).setMaxValue(500))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo').setRequired(false)),
    new SlashCommandBuilder()
      .setName('entrar')
      .setDescription('Entra na fila CLASSIC ou ARAM.')
      .addStringOption((option) => option.setName('nick').setDescription('Nickname Riot, ex.: Nome#TAG').setRequired(true))
      .addStringOption((option) =>
        option
          .setName('modo')
          .setDescription('Modo desejado')
          .setRequired(false)
          .addChoices(
            { name: 'CLASSIC', value: 'classic' },
            { name: 'ARAM', value: 'aram' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('formato')
          .setDescription('Formato do ARAM')
          .setRequired(false)
          .addChoices(
            { name: '1x1', value: '1x1' },
            { name: '2x2', value: '2x2' },
            { name: '3x3', value: '3x3' },
            { name: '4x4', value: '4x4' },
            { name: '5x5', value: '5x5' }
          )
      ),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('lista').setDescription('Mostra a fila atual.')),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('fila').setDescription('Mostra a fila atual.')),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('espera').setDescription('Entra na fila de espera.')),
    new SlashCommandBuilder().setName('esperatiers').setDescription('Entra na fila de espera TIER S (Esmeralda+).'),
    new SlashCommandBuilder().setName('limparespera').setDescription('Limpa todas as filas de espera.'),
    new SlashCommandBuilder().setName('sair').setDescription('Remove voce da fila.'),
    new SlashCommandBuilder()
      .setName('shared')
      .setDescription('Ativa/desativa o matchmaking compartilhado (Admin).')
      .addStringOption((option) =>
        option.setName('modo').setDescription('on, off ou status').setRequired(false)
          .addChoices(
            { name: 'on', value: 'on' },
            { name: 'off', value: 'off' },
            { name: 'status', value: 'status' }
          )
      ),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('start').setDescription('Inicia a partida da sala.')),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('cancelarstart').setDescription('Cancela a partida ativa.')),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('vitoria').setDescription('Registra a equipe vencedora.'), true),
    new SlashCommandBuilder()
      .setName('placar')
      .setDescription('Mostra o ranking do modo escolhido.')
      .addStringOption((option) =>
        option
          .setName('modo')
          .setDescription('Modo desejado')
          .setRequired(false)
          .addChoices(
            { name: 'CLASSIC', value: 'classic' },
            { name: 'CLASSIC TIER S', value: 'tiers' },
            { name: 'ARAM', value: 'aram' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('formato')
          .setDescription('Formato do ARAM')
          .setRequired(false)
          .addChoices(
            { name: '1x1', value: '1x1' },
            { name: '2x2', value: '2x2' },
            { name: '3x3', value: '3x3' },
            { name: '4x4', value: '4x4' }
          )
      ),
    new SlashCommandBuilder()
      .setName('top10')
      .setDescription('Mostra o top 10 do modo escolhido.')
      .addStringOption((option) =>
        option
          .setName('modo')
          .setDescription('Modo desejado')
          .setRequired(false)
          .addChoices(
            { name: 'CLASSIC', value: 'classic' },
            { name: 'CLASSIC TIER S', value: 'tiers' },
            { name: 'ARAM', value: 'aram' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('formato')
          .setDescription('Formato do ARAM')
          .setRequired(false)
          .addChoices(
            { name: '1x1', value: '1x1' },
            { name: '2x2', value: '2x2' },
            { name: '3x3', value: '3x3' },
            { name: '4x4', value: '4x4' }
          )
      ),
    new SlashCommandBuilder()
      .setName('ficha')
      .setDescription('Mostra a ficha de um jogador.')
      .addUserOption((option) => option.setName('usuario').setDescription('Usuario desejado').setRequired(true)),
    new SlashCommandBuilder()
      .setName('perfil')
      .setDescription('Mostra o seu perfil de jogador.')
      .addUserOption((option) => option.setName('usuario').setDescription('Usuario desejado (opcional)').setRequired(false)),
    new SlashCommandBuilder()
      .setName('remover')
      .setDescription('Remove um usuario da fila.')
      .addUserOption((option) => option.setName('usuario').setDescription('Usuario a remover').setRequired(true)),
    addModeAndLobbyOptions(new SlashCommandBuilder().setName('limparsalas').setDescription('Limpa salas automaticas ou uma sala especifica.')),
    new SlashCommandBuilder().setName('roleta').setDescription('Participa da roleta de quem sai (losers).')
      .addIntegerOption((option) => option.setName('quantidade').setDescription('Quantos saem (1-5)').setRequired(false))
      .addStringOption((option) => option.setName('sala').setDescription('Letra da sala, ex.: A').setRequired(false))
      .addUserOption((option) => option.setName('jogador').setDescription('Staff: inscreve o loser (AFK/dificuldade)').setRequired(false)),
    new SlashCommandBuilder().setName('reset').setDescription('Limpa todas as filas e partidas ativas.'),
    new SlashCommandBuilder().setName('resetgeral').setDescription('Arquiva a fase atual e inicia uma nova.'),
    new SlashCommandBuilder().setName('sincronizar-cargos').setDescription('Força a atualização dos cargos de todos os jogadores.'),
    new SlashCommandBuilder().setName('sincronizartodos').setDescription('Atualiza o elo Riot e o cargo de todos os jogadores cadastrados.'),
    new SlashCommandBuilder()
      .setName('sincronizarelo')
      .setDescription('Atualiza o elo Riot e o cargo de um jogador.')
      .addUserOption((option) => option.setName('usuario').setDescription('Jogador a sincronizar').setRequired(true)),
    new SlashCommandBuilder().setName('onboarding').setDescription('Gera a mensagem de boas-vindas e guia do servidor.'),
    new SlashCommandBuilder()
      .setName('limpar')
      .setDescription('Limpa mensagens do canal.')
      .addIntegerOption((option) => option.setName('quantidade').setDescription('Quantidade de mensagens a limpar').setRequired(true)),
    new SlashCommandBuilder().setName('desfazerresettemporada').setDescription('Restaura o ultimo periodo arquivado com dados.'),
    new SlashCommandBuilder()
      .setName('restaurarperiodo')
      .setDescription('Restaura um periodo arquivado especifico.')
      .addIntegerOption((option) => option.setName('numero').setDescription('Numero do periodo').setRequired(true)),
    new SlashCommandBuilder().setName('iniciartemporada').setDescription('Inicia a temporada oficial.'),
    new SlashCommandBuilder().setName('temporadas').setDescription('Lista os periodos arquivados.'),
    new SlashCommandBuilder()
      .setName('temporada')
      .setDescription('Mostra o resumo de um periodo arquivado.')
      .addIntegerOption((option) => option.setName('numero').setDescription('Numero da temporada').setRequired(true)),
    new SlashCommandBuilder()
      .setName('cadastrar')
      .setDescription('Vincula sua conta Riot ao Discord (feito uma unica vez).')
      .addStringOption((option) => option.setName('nick').setDescription('Seu Nick#TAG da Riot, ex: FakerBR#BR1').setRequired(true)),
    new SlashCommandBuilder()
      .setName('nick')
      .setDescription('Atualiza seu nick da Riot cadastrado.')
      .addStringOption((option) => option.setName('nick').setDescription('Novo Nick#TAG, ex: FakerBR#BR2').setRequired(true)),
    new SlashCommandBuilder()
      .setName('votar')
      .setDescription('Vota no time vencedor da sua partida ativa.')
      .addIntegerOption((option) =>
        option.setName('time').setDescription('Time vencedor').setRequired(true)
          .addChoices({ name: 'Time 1', value: 1 }, { name: 'Time 2', value: 2 })
      ),
    new SlashCommandBuilder()
      .setName('topstreak')
      .setDescription('Mostra o top 10 de maiores sequências de vitórias ativas.')
      .addStringOption((option) =>
        option
          .setName('modo')
          .setDescription('Modo desejado')
          .setRequired(false)
          .addChoices(
            { name: 'CLASSIC', value: 'classic' },
            { name: 'ARAM', value: 'aram' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('formato')
          .setDescription('Formato do ARAM')
          .setRequired(false)
          .addChoices(
            { name: '1x1', value: '1x1' },
            { name: '2x2', value: '2x2' },
            { name: '3x3', value: '3x3' },
            { name: '4x4', value: '4x4' }
          )
      ),
    new SlashCommandBuilder()
      .setName('desafiar')
      .setDescription('Busca um time adversário inter-servidores (Capitão/Staff, 5 fixos).')
      .addStringOption((option) => option.setName('nome').setDescription('Nome do seu time').setRequired(true))
      .addUserOption((option) => option.setName('jogador2').setDescription('2º jogador').setRequired(true))
      .addUserOption((option) => option.setName('jogador3').setDescription('3º jogador').setRequired(true))
      .addUserOption((option) => option.setName('jogador4').setDescription('4º jogador').setRequired(true))
      .addUserOption((option) => option.setName('jogador5').setDescription('5º jogador').setRequired(true))
      .addStringOption((option) =>
        option.setName('serie').setDescription('MD1 = 1 jogo, MD3 = melhor de 3').setRequired(false)
          .addChoices({ name: 'MD1', value: 'MD1' }, { name: 'MD3', value: 'MD3' })
      ),
    new SlashCommandBuilder().setName('desafiar-cancelar').setDescription('Sai da busca inter-servidores.'),
    new SlashCommandBuilder()
      .setName('resultado-inter')
      .setDescription('Lança o vencedor de um jogo da série inter (Capitão/Staff).')
      .addStringOption((option) =>
        option.setName('vencedor').setDescription('Lado vencedor').setRequired(true)
          .addChoices({ name: 'AZUL', value: 'AZUL' }, { name: 'VERMELHO', value: 'VERM' })
      )
      .addIntegerOption((option) => option.setName('jogo').setDescription('Número do jogo (1-3)').setRequired(false)),
    new SlashCommandBuilder()
      .setName('wo-inter')
      .setDescription('Aplica W.O. na série inter (Capitão/Staff).')
      .addStringOption((option) =>
        option.setName('ausente').setDescription('Time ausente (padrão: o outro time)').setRequired(false)
          .addChoices({ name: 'Time A', value: 'A' }, { name: 'Time B', value: 'B' })
      ),
    new SlashCommandBuilder().setName('inter-ranking').setDescription('Mostra o ranking inter-servidores.'),
    new SlashCommandBuilder().setName('inter-historico').setDescription('Mostra as últimas séries inter.'),
    new SlashCommandBuilder()
      .setName('toprankinfernal')
      .setDescription('Quem mais conquistou o INFERNAL na temporada.'),
  ].map((command) => command.toJSON()).filter((command) => {
    // Bot LCL (INTER_ONLY=1): registra apenas slash do desafio + ajuda.
    if (!isInterOnlyMode()) return true;
    return INTER_ONLY_SLASH.has(command.name);
  });
}

async function registerSlashCommands() {
  const commands = buildSlashCommands();

  for (const guild of client.guilds.cache.values()) {
    if (!isGuildAllowed(guild.id)) continue;
    await guild.commands.set(commands).catch((error) => {
      console.error(`[SLASH] Nao foi possivel registrar os comandos na guild ${guild.id}:`, error);
    });
  }
}

const riotService = createRiotService(RIOT_API_KEY, config.region);

global.discordClient = client;
global.riotService = riotService;

const {
  isGuildAllowed,
  getSeasonDisplayLabel,
  formatDateTimeForHistory,
  getArchivedSeasonLabel,
  getQueueChannel,
  isMemberInQueueVoiceChannel,
  formatRank,
  formatQueueMode,
  getStatsBucketKey,
  getStatsBucketLabel,
  getAramFormatLabel,
  getAramWeightByTeamSize,
  getRequiredPlayersLabel,
  isValidQueueSize,
  getRequiredPlayersByModeAndFormat,
  getFormatFromArgs,
  getNicknameArgs,
  numberToLobbyLetter,
  getNextLobbyLetter,
  getBaseQueueChannelIdByMode,
  getOpenLobby,
  findLobbyByChannelId,
  findLobbyByPlayer,
  findActiveMatchByChannelId,
  normalizeLobbySelectorArgs,
  findLobbyBySelector,
  findActiveMatchBySelector,
  createLobbyChannels,
  createTeamChannelsForLobby,
  formatCustomRecord,
  createEmptyModeStats,
  normalizePlayerModes,
  getModeStats,
  getPlayerStatsKey,
  getStoredPlayerStats,
  upsertPlayerStats,
  buildQueueEmbed,
  splitEmbedFieldChunks,
  buildTeamsEmbed,
  buildLeaderboardEmbed,
  buildModeLeaderboardEmbed,
  getRankedPlayersByMode,
  buildTopTenEmbed,
  buildSeasonHistoryEmbed,
  resetStatsForNewSeason,
  deepClone,
  hasArchivedSeasonData,
  buildRestoredStatsFromArchive,
  inferSeasonMetaFromArchive,
  archiveCurrentSeason,
  buildPlayerCardEmbed,
  getSaoPauloDateParts,
  postDailyRankUpdates,
  postMatchHistoryLog,
  handleMvpVoteInteraction,
  resumePendingMvpVotes,
  expireInfernalRolesIfDue,
  startDailyRankScheduler,
  movePlayersToTeamChannels,
  movePlayersToVoiceChannel,
  deleteVoiceChannelIfExists,
  isManagedDynamicChannel,
  getExpectedWaitingRoomName,
  getExpectedTeamRoomNames,
  deleteManagedChannelsForLobby,
  deleteChannelsByNames,
  findReusableWaitingLobby,
  getActiveMatchEntry,
  buildLobbyFromMatch,
  resolveMessageChannel,
  sendToMessageChannel,
  replyToMessage,
  normalizeDiscordPayload,
  createInteractionContext,
  parseLclQueueButtonId,
  updateLclQueueDashboard,
  addLclPresence,
  removeLclPresence,
  getLclGuildPresence,
  LCL_TEAM_SIZE,
  isMemberInClandestinoChannel,
  THEME,
  FOOTER_PREFIX
} = require('./utils/lobbyUtils');


const handlers = require('./commands/legacyCommands');
const tempVoice = require('./services/tempVoiceService');


client.once('ready', async () => {
  await ensureDataFiles();
  console.log(`Bot conectado como ${client.user.tag} | ${BOT_VERSION}`);
  await registerSlashCommands();
  // Bot LCL (INTER_ONLY): sem ranking diario interno, sem MVP, sem INFERNAL.
  // O LCL atualiza SOMENTE o ranking inter-servidores (via !resultado-inter).
  if (!isInterOnlyMode()) {
    startDailyRankScheduler();
  } else {
    // Rotina propria: publica o ranking inter na arena, 1x ao dia.
    try {
      const { startInterRankingScheduler, getInterConfig } = require('./commands/handlers/interCommandHandlers');
      const { loadInterRanking } = require('./services/dataService');
      startInterRankingScheduler(client, getInterConfig(config), { loadInterRanking, config });
    } catch (err) {
      console.error('[RESTART] Erro ao iniciar agendador inter:', err.message);
    }
  }

  // Retoma votacoes de MVP pendentes (se o bot reiniciou no meio de uma votacao)
  // Bot LCL nao tem partida interna: pula.
  if (!isInterOnlyMode()) {
    try {
      await resumePendingMvpVotes();
    } catch (err) {
      console.error('[RESTART] Erro ao retomar votacoes de MVP:', err);
    }
  }

  // Expira cargos INFERNAL vencidos (08h) logo na inicializacao + reconcilia orfaos
  // Bot LCL nao gerencia cargos internos: pula.
  if (!isInterOnlyMode()) {
    try {
      const { reconcileInfernalRoles } = require('./utils/lobbyUtils');
      for (const guild of client.guilds.cache.values()) {
        if (!isGuildAllowed(guild.id)) continue;
        await expireInfernalRolesIfDue(guild);
        await reconcileInfernalRoles(guild).catch(() => null);
      }
    } catch (err) {
      console.error('[RESTART] Erro ao expirar cargos INFERNAL:', err);
    }
  }

  // Remove salas de voz temporárias vazias que ficaram órfãs
  // (bot LCL nao gerencia salas temporarias: pula).
  try {
    if (!isInterOnlyMode()) {
      for (const guild of client.guilds.cache.values()) {
        if (!isGuildAllowed(guild.id)) continue;
        await tempVoice.pruneTempRooms(guild).catch(() => null);
      }
    }
  } catch (err) {
    console.error('[RESTART] Erro ao limpar salas temporarias:', err.message);
  }

  // Painel da fila clandestina (#🔥・fila-lcl): posta na inicialização se ainda
  // não existir (depois só edita a mensagem rastreada — sem spam a cada boot).
  try {
    for (const guild of client.guilds.cache.values()) {
      if (!isGuildAllowed(guild.id)) continue;
      await updateLclQueueDashboard(guild).catch(() => null);
    }
  } catch (err) {
    console.error('[RESTART] Erro ao publicar painel LCL:', err.message);
  }

  // Item 3: Recuperar auto-starts pendentes (se a sala estiver cheia no BD e reiniciou)
  // Bot LCL nao tem fila interna: pula.
  if (!isInterOnlyMode()) {
    try {
      const queueData = await loadQueue();
      for (const guild of client.guilds.cache.values()) {
        if (!isGuildAllowed(guild.id)) continue;
        for (const [lobbyId, lobby] of Object.entries(queueData.lobbies || {})) {
          if (lobby.players && lobby.players.length >= lobby.requiredPlayers) {
            console.log(`[RESTART] Retomando auto-start pendente para lobby ${lobbyId}`);
            handlers.triggerAutoStart(guild, lobbyId);
          }
        }
      }
    } catch (err) {
      console.error('[RESTART] Erro ao recuperar auto-starts:', err);
    }
  }
});

client.on('guildCreate', async (guild) => {
  const commands = buildSlashCommands();
  await guild.commands.set(commands).catch((error) => {
    console.error(`[SLASH] Nao foi possivel registrar os comandos na nova guild ${guild.id}:`, error);
  });
});

async function processCommand(message, rawContent) {
  const [commandName, ...args] = rawContent.slice(config.prefix.length).trim().split(/\s+/);
  const command = commandName?.toLowerCase();

  console.log(`[COMANDO] ${message.author.tag}: ${rawContent}`);

  // Bot LCL: apenas modo desafio (+ utilidades). Demais comandos sao
  // ignorados em silencio para nao poluir o chat (!ajuda explica o modo).
  if (isInterOnlyMode() && !isInterCommand(command)) {
    return;
  }

  try {
    switch (command) {
      case 'ping':
        await handlers.handlePingCommand(message);
        break;
      case 'ajuda':
        await handlers.handleHelpCommand(message);
        break;
      case 'entrar':
      case 'entra':
        await handlers.handleEnterCommand(message, args);
        break;
      case 'lista':
        await handlers.handleListCommand(message, args);
        break;
      case 'fila':
        await handlers.handleListCommand(message, args);
        break;
      case 'espera':
        await handlers.handleWaitingListCommand(message, args);
        break;
      case 'esperatiers':
      case 'esperatier':
        await handlers.handleTierSWaitingListCommand(message, args);
        break;
      case 'limparespera':
        await handlers.handleClearWaitingListsCommand(message);
        break;
      case 'placar':
        await handlers.handleLeaderboardCommand(message, args);
        break;
      case 'top10':
        await handlers.handleTopTenCommand(message, args);
        break;
      case 'topstreak':
        await handlers.handleTopStreakCommand(message, args);
        break;
      case 'toprankinfernal':
        await handlers.handleTopInfernalCommand(message);
        break;
      case 'ficha':
      case 'perfil':
      case 'p':
        await handlers.handlePlayerCardCommand(message);
        break;
      case 'onboarding':
      case 'inicio':
      case 'setup':
        await handlers.handleOnboardingCommand(message);
        break;
      case 'limpar':
      case 'clear':
        await handlers.handleClearCommand(message, args);
        break;
      case 'temporadas':
        await handlers.handleSeasonHistoryCommand(message, []);
        break;
      case 'temporada':
        await handlers.handleSeasonHistoryCommand(message, args);
        break;
      case 'iniciartemporada':
      case 'iniciarseason':
        await handlers.handleOfficialSeasonStartCommand(message);
        break;
      case 'sair':
        await handlers.handleLeaveCommand(message);
        break;
      case 'shared':
        await handlers.handleSharedCommand(message, args);
        break;
      case 'remover':
        await handlers.handleRemoveCommand(message);
        break;
      case 'reset':
        await handlers.handleResetCommand(message);
        break;
      case 'limparsalas':
        await handlers.handleCleanupRoomsCommand(message, args);
        break;
      case 'limparvoz':
        await tempVoice.handleCleanupCommand(message);
        break;
      case 'salahub':
        await tempVoice.handleHubCommand(message);
        break;
      case 'lock':
        await tempVoice.handleLockCommand(message, true);
        break;
      case 'unlock':
        await tempVoice.handleLockCommand(message, false);
        break;
      case 'limite':
        await tempVoice.handleLimitCommand(message, args);
        break;
      case 'convidar':
        await tempVoice.handleInviteCommand(message);
        break;
      case 'desafiar':
        await handlers.handleDesafiarCommand(message, args);
        break;
      case 'desafiar-cancelar':
      case 'cancelardesafio':
      case 'cancelar-desafio':
        await handlers.handleDesafiarCancelarCommand(message);
        break;
      case 'resultado-inter':
      case 'resultadointer':
        await handlers.handleResultadoInterCommand(message, args);
        break;
      case 'wo':
      case 'wo-inter':
      case 'winter':
        await handlers.handleWOCommand(message, args);
        break;
      case 'inter-ranking':
      case 'interranking':
        await handlers.handleInterRankingCommand(message);
        break;
      case 'inter-historico':
      case 'interhistorico':
        await handlers.handleInterHistoricoCommand(message);
        break;
      case 'sala':
        await tempVoice.handleRenameCommand(message, args);
        break;
      case 'resetgeral':
        await handlers.handleSeasonResetCommand(message);
        break;
      case 'desfazerresettemporada':
        await handlers.handleUndoSeasonResetCommand(message);
        break;
      case 'restaurarperiodo':
        await handlers.handleRestoreArchivedPeriodCommand(message, args);
        break;
      case 'cancelarstart':
      case 'cancelar': {
        const { pendingAutoStarts } = handlers;
        for (const [lobbyId, timeoutId] of pendingAutoStarts.entries()) {
          if (args.length === 0 || lobbyId.includes(args.join('-').toLowerCase())) {
            clearTimeout(timeoutId);
            pendingAutoStarts.delete(lobbyId);
          }
        }
        await handlers.handleCancelStartCommand(message, args);
        break;
      }
      case 'start':
        await handlers.handleStartCommand(message, args);
        break;
      case 'rematch':
        await handlers.handleRematchCommand(message, args);
        break;
      case 'roleta':
      case 'roletar':
        await handlers.handleRouletteCommand(message, args);
        break;
      case 'roletasair':
        await handlers.handleRoletaSairCommand(message, args);
        break;
      case 'pdl':
        await handlers.handlePdlCommand(message, args);
        break;
      case 'regras':
      case 'regra':
      case 'rules':
        await handlers.handleRulesCommand(message);
        break;
      case 'regrasdesafio':
      case 'regras-desafio':
      case 'regralcl':
        await handlers.handleDesafioRulesCommand(message);
        break;
      case 'staff':
      case 'staffhelp':
        await handlers.handleStaffCommand(message);
        break;
      case 'cadastrar':
        await handlers.handleRegisterCommand(message, args);
        break;
      case 'nick':
        await handlers.handleNickUpdateCommand(message, args);
        break;
      case 'stats':
      case 'estatisticas':
        await handlers.handleStatsCommand(message);
        break;
      case 'votar':
        await handlers.handleVoteCommand(message, args);
        break;
      case 'vitoria':
      case 'resultado':
        await handlers.handleVictoryCommand(message, args);
        break;
      case 'sincronizar-cargos':
      case 'sync':
        if (['elo', 'todos', 'riot'].includes(String(args[0] || '').toLowerCase())) {
          await handlers.handleSyncAllPlayersEloCommand(message);
        } else {
          await handlers.handleSyncAllRolesCommand(message);
        }
        break;
      case 'sincronizartodos':
      case 'sicronizartodos':
      case 'sincronizatodos':
      case 'atualizartodos':
      case 'atualizarelos':
        await handlers.handleSyncAllPlayersEloCommand(message);
        break;
      case 'sincronizarelo':
        await handlers.handleSyncPlayerRankCommand(message);
        break;
      default:
        await replyToMessage(message, `Comando desconhecido: \`${rawContent}\`. Use \`!ajuda\` para ver os comandos.`);
        break;
    }
  } catch (error) {
    console.error(`[ERRO] Comando '${rawContent}':`, error);
    await replyToMessage(message, `❌ Ocorreu um erro inesperado: \`${error.name}: ${error.message}\`. Por favor, relate ao desenvolvedor.`);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) {
    return;
  }
  if (!isGuildAllowed(message.guild.id)) {
    return;
  }

  const lines = message.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(config.prefix));

  if (lines.length === 0) {
    return;
  }

  for (const line of lines) {
    await processCommand(message, line);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) {
    return;
  }
  if (!isGuildAllowed(interaction.guild.id)) {
    return;
  }

  if (interaction.isButton()) {
    try {
      if (interaction.customId === ONBOARDING_BUTTON_IDS.LOL_PLAYER) {
        const modal = new ModalBuilder()
          .setCustomId(ONBOARDING_MODAL_ID)
          .setTitle('Cadastro LoL');
        const nicknameInput = new TextInputBuilder()
          .setCustomId(ONBOARDING_MODAL_FIELD_ID)
          .setLabel('Nick do LoL#TAG')
          .setPlaceholder('Ex.: MeuNick#BR1')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nicknameInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === ONBOARDING_BUTTON_IDS.NON_PLAYER) {
        await interaction.reply({
          content:
          'Perfeito. Voce ficara somente com acesso aos canais e salas abertas do servidor, sem receber cargo de jogador.',
          ephemeral: true
        });
        return;
      }

      // Painel de votação de resultado: votewin:<matchId>:<time>
      if (String(interaction.customId || '').startsWith('votewin:')) {
        await handlers.handleResultVoteButton(interaction);
        return;
      }

      // Painel da fila clandestina: lclqueue:join / lclqueue:leave.
      // Mesmo padrão do lobby classic: só vale dentro da call clandestina.
      const lclAction = parseLclQueueButtonId(interaction.customId);
      if (lclAction) {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        // Preserva o voice state: o fetch pode vir sem voz no cache e causar
        // falso "precisa estar no canal de voz".
        let freshMember = interaction.member;
        try {
          const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          if (fetched && (fetched.voice?.channel || !interaction.member?.voice?.channel)) {
            freshMember = fetched;
          }
        } catch {
          freshMember = interaction.member;
        }
        if (!isMemberInClandestinoChannel(freshMember)) {
          await interaction.editReply({
            content: 'Voce precisa estar no canal de voz `🔥・lobby-clandestino LCL` para entrar nessa fila.'
          }).catch(() => null);
          return;
        }
        try {
          const result = await withQueueOperationLock(`${interaction.guild.id}:lclqueue`, async () => {
            const { players } = await loadLclQueue();
            if (lclAction.action === 'join') {
              const { players: next, already } = addLclPresence(players, {
                discordId: interaction.user.id,
                username: interaction.user.username,
                guildId: interaction.guild.id
              });
              if (!already) await saveLclQueue({ players: next });
              return { action: 'join', already };
            }
            const { players: next, removed } = removeLclPresence(players, interaction.user.id, interaction.guild.id);
            if (removed) await saveLclQueue({ players: next });
            return { action: 'leave', removed };
          });
          await updateLclQueueDashboard(interaction.guild).catch(() => null);
          if (result.action === 'join') {
            const { players } = await loadLclQueue().catch(() => ({ players: [] }));
            const count = getLclGuildPresence(players, interaction.guild.id).length;
            await interaction.editReply({
              content: result.already
                ? `Voce ja esta na fila clandestina (\`${count}/${LCL_TEAM_SIZE}\`).`
                : `✅ Presença marcada! Fila clandestina em \`${count}/${LCL_TEAM_SIZE}\`.` +
                  (count >= LCL_TEAM_SIZE ? ' Time fechado — Capitão, rode `!desafiar <nome> MD1`!' : '')
            }).catch(() => null);
          } else {
            await interaction.editReply({
              content: result.removed ? 'Voce saiu da fila clandestina.' : 'Voce nao estava na fila clandestina.'
            }).catch(() => null);
          }
        } catch (err) {
          console.error('[BUTTON] Erro na fila LCL:', err?.message || err);
          await interaction.editReply({ content: '❌ Erro ao processar o botão. Tente de novo.' }).catch(() => null);
        }
        return;
      }
    } catch (error) {
      console.error('[BUTTON] Erro ao responder onboarding:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Nao consegui processar essa escolha agora.', ephemeral: true }).catch(() => null);
      }
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId === ONBOARDING_MODAL_ID) {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const nickname = interaction.fields.getTextInputValue(ONBOARDING_MODAL_FIELD_ID)?.trim();
        const context = createInteractionContext(interaction, {
          content: `!cadastrar ${nickname}`
        });

        await handlers.handleRegisterCommand(context, [nickname]);
        return;
      }
    } catch (error) {
      console.error('[MODAL] Erro ao processar cadastro inicial:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Nao consegui concluir o cadastro agora.', ephemeral: true }).catch(() => null);
      } else {
        await interaction.editReply({ content: 'Nao consegui concluir o cadastro agora.' }).catch(() => null);
      }
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    try {
      if (String(interaction.customId || '').startsWith('mvpvote:')) {
        await handleMvpVoteInteraction(interaction);
        return;
      }
    } catch (error) {
      console.error('[MVP] Erro ao processar voto:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Nao consegui registrar seu voto agora.', ephemeral: true }).catch(() => null);
      }
      return;
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  // Defer early to avoid "The app did not respond" error due to 3s timeout
  await interaction.deferReply().catch(() => null);

  // Bot LCL: apenas modo desafio (+ utilidades).
  if (isInterOnlyMode() && !isInterCommand(interaction.commandName)) {
    await interaction.editReply({ content: INTER_ONLY_REPLY }).catch(() => null);
    return;
  }

  const mode = interaction.options.getString('modo');
  const format = interaction.options.getString('formato');
  const room = interaction.options.getString('sala');
  const nick = interaction.options.getString('nick');
  const team = interaction.options.getInteger('equipe');
  const targetUser = interaction.options.getUser('usuario');
  const seasonNumber = interaction.options.getInteger('numero');
  const selectorArgs = [mode, format, room].filter(Boolean);
  const contextContent = `/${interaction.commandName} ${selectorArgs.join(' ')}`.trim();
  const context = createInteractionContext(interaction, { content: contextContent, targetUser });

  try {
    switch (interaction.commandName) {
      case 'ping':
        await handlers.handlePingCommand(context);
        break;
      case 'ajuda':
        await handlers.handleHelpCommand(context);
        break;
      case 'entrar': {
        const selectedMode = interaction.options.getString('modo') || QUEUE_MODES.CLASSIC;
        const selectedFormat = interaction.options.getString('formato');
        const nickname = interaction.options.getString('nick');
        
        const args = [];
        // Se for ARAM, incluímos o modo e o formato para que a lógica saiba interpretar
        if (selectedMode === QUEUE_MODES.ARAM) {
          args.push(QUEUE_MODES.ARAM);
          if (selectedFormat) args.push(selectedFormat);
        }
        // O último argumento é sempre o nick (ou o nick completo se for classic)
        args.push(nickname);

        await handlers.handleEnterCommand(context, args);
        break;
      }
      case 'lista':
        await handlers.handleListCommand(context, selectorArgs);
        break;
      case 'fila':
        await handlers.handleListCommand(context, selectorArgs);
        break;
      case 'espera':
        await handlers.handleWaitingListCommand(context, selectorArgs);
        break;
      case 'esperatiers':
        await handlers.handleTierSWaitingListCommand(context, selectorArgs);
        break;
      case 'sair':
        await handlers.handleLeaveCommand(context);
        break;
      case 'shared': {
        const sub = interaction.options.getString('modo');
        await handlers.handleSharedCommand(context, sub ? [sub] : []);
        break;
      }
      case 'start':
        await handlers.handleStartCommand(context, selectorArgs);
        break;
      case 'cancelarstart':
        await handlers.handleCancelStartCommand(context, selectorArgs);
        break;
      case 'vitoria':
        await handlers.handleVictoryCommand(context, [...selectorArgs, String(team)]);
        break;
      case 'placar':
        await handlers.handleLeaderboardCommand(context, [mode, format].filter(Boolean));
        break;
      case 'top10':
        await handlers.handleTopTenCommand(context, [mode, format].filter(Boolean));
        break;
      case 'topstreak':
        await handlers.handleTopStreakCommand(context, [mode, format].filter(Boolean));
        break;
      case 'toprankinfernal':
        await handlers.handleTopInfernalCommand(context);
        break;
      case 'perfil':
      case 'ficha':
        await handlers.handlePlayerCardCommand(context, targetUser);
        break;
      case 'remover':
        await handlers.handleRemoveCommand(context, targetUser);
        break;
      case 'regras':
        await handlers.handleRulesCommand(context);
        break;
      case 'regrasdesafio':
        await handlers.handleDesafioRulesCommand(context);
        break;
      case 'staff':
        await handlers.handleStaffCommand(context);
        break;
      case 'roletasair': {
        const salaSair = interaction.options.getString('sala');
        await handlers.handleRoletaSairCommand(context, salaSair ? [salaSair] : []);
        break;
      }
      case 'pdl': {
        const pdlUser = interaction.options.getUser('jogador');
        const pdlValor = interaction.options.getInteger('valor');
        const pdlMotivo = interaction.options.getString('motivo');
        await handlers.handlePdlCommand(context, [String(pdlValor), ...(pdlMotivo ? [pdlMotivo] : [])], pdlUser || null);
        break;
      }
      case 'roleta': {
        const qtd = interaction.options.getInteger('quantidade');
        const sala = interaction.options.getString('sala');
        const rJogador = interaction.options.getUser('jogador');
        const rArgs = [...(qtd != null ? [String(qtd)] : []), ...(sala ? [sala] : [])];
        await handlers.handleRouletteCommand(context, rArgs, rJogador || null);
        break;
      }
      case 'desafiar': {
        const dSerie = interaction.options.getString('serie');
        const dNome = interaction.options.getString('nome');
        const dJogadores = ['jogador2', 'jogador3', 'jogador4', 'jogador5']
          .map((n) => interaction.options.getUser(n))
          .filter(Boolean);
        context._slashDesafiar = { serie: dSerie, nome: dNome, jogadores: dJogadores.map((u) => u.id) };
        await handlers.handleDesafiarCommand(context, [...(dSerie ? [dSerie] : []), ...(dNome ? [dNome] : [])]);
        break;
      }
      case 'desafiar-cancelar':
        await handlers.handleDesafiarCancelarCommand(context);
        break;
      case 'resultado-inter': {
        const rJogo = interaction.options.getInteger('jogo');
        const rVenc = interaction.options.getString('vencedor');
        await handlers.handleResultadoInterCommand(context, [...(rJogo != null ? [String(rJogo)] : []), ...(rVenc ? [rVenc] : [])]);
        break;
      }
      case 'wo-inter': {
        const wAus = interaction.options.getString('ausente');
        await handlers.handleWOCommand(context, wAus ? [wAus] : []);
        break;
      }
      case 'inter-ranking':
        await handlers.handleInterRankingCommand(context);
        break;
      case 'inter-historico':
        await handlers.handleInterHistoricoCommand(context);
        break;
      case 'limparespera':
        await handlers.handleClearWaitingListsCommand(context);
        break;
      case 'limpar':
        await handlers.handleClearCommand(context, [String(interaction.options.getInteger('quantidade'))]);
        break;
      case 'onboarding':
        await handlers.handleOnboardingCommand(context);
        break;
      case 'limparsalas':
        await handlers.handleCleanupRoomsCommand(context, selectorArgs);
        break;
      case 'reset':
        await handlers.handleResetCommand(context);
        break;
      case 'resetgeral':
        await handlers.handleSeasonResetCommand(context);
        break;
      case 'sincronizar-cargos':
        await handlers.handleSyncAllRolesCommand(context);
        break;
      case 'sincronizartodos':
        await handlers.handleSyncAllPlayersEloCommand(context);
        break;
      case 'sincronizarelo':
        await handlers.handleSyncPlayerRankCommand(context, targetUser);
        break;
      case 'desfazerresettemporada':
        await handlers.handleUndoSeasonResetCommand(context);
        break;
      case 'restaurarperiodo':
        await handlers.handleRestoreArchivedPeriodCommand(context, [String(seasonNumber)]);
        break;
      case 'iniciartemporada':
        await handlers.handleOfficialSeasonStartCommand(context);
        break;
      case 'temporadas':
        await handlers.handleSeasonHistoryCommand(context, []);
        break;
      case 'temporada':
        await handlers.handleSeasonHistoryCommand(context, [String(seasonNumber)]);
        break;
      case 'votar': {
        const voteTeam = interaction.options.getInteger('time');
        await handlers.handleVoteCommand(context, [String(voteTeam)]);
        break;
      }
      case 'cadastrar': {
        const cadastrarNick = interaction.options.getString('nick');
        await handlers.handleRegisterCommand(context, [cadastrarNick]);
        break;
      }
      case 'nick': {
        const updateNick = interaction.options.getString('nick');
        await handlers.handleNickUpdateCommand(context, [updateNick]);
        break;
      }
      default:
        await interaction.editReply({ content: 'Comando slash nao reconhecido.' }).catch(() => null);
        break;
    }

    // Trava de seguranca: se o comando terminou e ainda esta "pensando", encerramos a interacao.
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: '✅ Comando processado.' }).catch(() => null);
    }
  } catch (error) {
    console.error(`[SLASH] Erro no comando '${interaction.commandName}':`, error);

    const errorMessage = `❌ Ocorreu um erro inesperado: \`${error.name}: ${error.message}\`. Por favor, relate ao desenvolvedor.`;

    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => null);
      return;
    }

    // Se já foi adiado ou respondido, atualizamos a resposta original para tirar o "pensando"
    await interaction.editReply({ content: errorMessage }).catch(() => interaction.followUp({ content: errorMessage })).catch(() => null);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  // Bot LCL (INTER_ONLY): sem salas temporarias — evita duplicar com o CAPS.
  if (isInterOnlyMode()) return;
  try {
    await tempVoice.handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error('[TEMPVOZ] Erro no voiceStateUpdate:', err.message);
  }
});

client.on('guildMemberAdd', async (member) => {
  // Bot LCL (INTER_ONLY): sem onboarding/cadastro interno.
  if (isInterOnlyMode()) return;
  const channelId = config.textChannels?.welcomeChannelId;
  if (!channelId) return;

  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const storedTemplates = await loadContentTemplates();
  const welcomeContent = getResolvedContentTemplates(storedTemplates).welcome;

  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`🏠 Bem-vindo à CAPS Arena, ${member.user.username}!`)
    .setDescription('Escolha abaixo como você vai usar o servidor. Jogadores de LoL precisam concluir o cadastro para liberar o acesso completo.')
    .addFields(
      { name: 'Como funciona o acesso', value: 'Quem joga LoL precisa usar `!cadastrar Nick#TAG` para receber o cargo de jogador e liberar os canais privados.\nQuem não joga LoL permanece apenas com as salas abertas.', inline: false },
      { name: 'Se você joga LoL', value: 'Clique em **Jogo LoL** e depois envie `!cadastrar Nick#TAG` no chat.\nApós o cadastro, o bot libera seu acesso automaticamente.', inline: false },
      { name: 'Se você não joga LoL', value: 'Clique em **Não jogo LoL** para permanecer apenas com os canais abertos, sem receber cargo de jogador.', inline: false },
      { name: 'Comandos importantes', value: '`!cadastrar Nick#TAG` • libera o acesso completo\n`!nick Nick#TAG` • atualiza o cadastro\n`!ajuda` • lista completa de comandos', inline: false }
    )
    .setColor(THEME?.INFO ?? '#0099ff')
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `${FOOTER_PREFIX || 'Caps Bot'} • Arena de Personalizadas` })
    .setTimestamp();

  welcomeEmbed
    .setTitle(renderTemplate(welcomeContent.titleTemplate, { username: member.user.username, serverName: member.guild.name }))
    .setDescription(welcomeContent.description)
    .setFields(
      [
        { name: welcomeContent.rulesTitle, value: welcomeContent.rulesText, inline: false },
        { name: welcomeContent.unlockTitle, value: welcomeContent.unlockText, inline: false },
        { name: welcomeContent.howToPlayTitle, value: welcomeContent.howToPlayText, inline: false },
        { name: welcomeContent.commandsTitle, value: welcomeContent.commandsText, inline: false }
      ].filter((field) => String(field.name || '').trim() && String(field.value || '').trim())
    )
    .setFooter({ text: welcomeContent.footerText || `${FOOTER_PREFIX || 'Caps Bot'} • Arena de Personalizadas` });

  const onboardingActions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ONBOARDING_BUTTON_IDS.LOL_PLAYER)
      .setLabel('Jogo LoL')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(ONBOARDING_BUTTON_IDS.NON_PLAYER)
      .setLabel('Nao jogo LoL')
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: `Seja bem-vindo, ${member}! Escolha abaixo como voce vai usar o servidor:`,
    embeds: [welcomeEmbed],
    components: [onboardingActions]
  }).catch((err) => console.error('[BOAS-VINDAS] Erro ao enviar mensagem:', err));
});

client.login(DISCORD_TOKEN);
