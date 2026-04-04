require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const config = require('./config.json');
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
  QUEUE_MODES
} = require('./services/dataService');

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
    new SlashCommandBuilder().setName('sair').setDescription('Remove voce da fila.'),
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
            { name: 'ARAM', value: 'aram' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('formato')
          .setDescription('Formato do ARAM')
          .setRequired(false)
          .addChoices({ name: '1x1', value: '1x1' })
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
            { name: 'ARAM', value: 'aram' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('formato')
          .setDescription('Formato do ARAM')
          .setRequired(false)
          .addChoices({ name: '1x1', value: '1x1' })
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
    new SlashCommandBuilder().setName('limparsalas').setDescription('Limpa salas automaticas orfas.'),
    new SlashCommandBuilder().setName('reset').setDescription('Limpa todas as filas e partidas ativas.'),
    new SlashCommandBuilder().setName('resetgeral').setDescription('Arquiva a fase atual e inicia uma nova.'),
    new SlashCommandBuilder().setName('sincronizar-cargos').setDescription('Força a atualização dos cargos de todos os jogadores.'),
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
          .addChoices({ name: '1x1', value: '1x1' })
      )
  ].map((command) => command.toJSON());
}

async function registerSlashCommands() {
  const commands = buildSlashCommands();

  for (const guild of client.guilds.cache.values()) {
    await guild.commands.set(commands).catch((error) => {
      console.error(`[SLASH] Nao foi possivel registrar os comandos na guild ${guild.id}:`, error);
    });
  }
}

const riotService = createRiotService(RIOT_API_KEY, config.region);

global.discordClient = client;
global.riotService = riotService;

const {
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
  createInteractionContext
} = require('./utils/lobbyUtils');


const handlers = require('./commands/legacyCommands');


client.once('ready', async () => {
  await ensureDataFiles();
  console.log(`Bot conectado como ${client.user.tag} | ${BOT_VERSION}`);
  await registerSlashCommands();
  startDailyRankScheduler();
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
      case 'placar':
        await handlers.handleLeaderboardCommand(message, args);
        break;
      case 'top10':
        await handlers.handleTopTenCommand(message, args);
        break;
      case 'topstreak':
        await handlers.handleTopStreakCommand(message, args);
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
        await handlers.handleOfficialSeasonStartCommand(message);
        break;
      case 'sair':
        await handlers.handleLeaveCommand(message);
        break;
      case 'remover':
        await handlers.handleRemoveCommand(message);
        break;
      case 'reset':
        await handlers.handleResetCommand(message);
        break;
      case 'limparsalas':
        await handlers.handleCleanupRoomsCommand(message);
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
      case 'cadastrar':
        await handlers.handleRegisterCommand(message, args);
        break;
      case 'nick':
        await handlers.handleNickUpdateCommand(message, args);
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
        await handlers.handleSyncAllRolesCommand(message);
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
  if (!interaction.isChatInputCommand() || !interaction.guild) {
    return;
  }

  // Defer early to avoid "The app did not respond" error due to 3s timeout
  await interaction.deferReply().catch(() => null);

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
      case 'sair':
        await handlers.handleLeaveCommand(context);
        break;
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
      case 'perfil':
      case 'ficha':
        await handlers.handlePlayerCardCommand(context, targetUser);
        break;
      case 'remover':
        await handlers.handleRemoveCommand(context, targetUser);
        break;
      case 'limpar':
        await handlers.handleClearCommand(context, [String(interaction.options.getInteger('quantidade'))]);
        break;
      case 'onboarding':
        await handlers.handleOnboardingCommand(context);
        break;
      case 'limparsalas':
        await handlers.handleCleanupRoomsCommand(context);
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

client.on('guildMemberAdd', async (member) => {
  const channelId = config.textChannels?.welcomeChannelId;
  if (!channelId) return;

  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`🏠 Bem-vindo à Arena Caps, ${member.user.username}!`)
    .setDescription(`Prepare-se para subir de elo nas nossas partidas personalizadas balanceadas! Aqui está o seu guia rápido para começar.`)
    .addFields(
      { name: '📜 Regras', value: 'Primeiro de tudo, leia as nossas regras no canal <#📜┃regras> (ou equivalente) para evitar punições.', inline: false },
      { name: '🎮 Como Jogar', value: '1. Entre em um canal de voz de **Lobby**.\n2. Use o comando `!entrar SeuNick#TAG`.\n3. Aguarde o preenchimento da fila.', inline: false },
      { name: '🕹️ Comandos Úteis', value: '`!perfil` • Veja seu MMR e elo\n`!ajuda` • Lista completa de comandos', inline: false }
    )
    .setColor(THEME ? THEME.PRIMARY : '#0099ff')
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `${FOOTER_PREFIX || 'Caps Bot'} • Arena de Personalizadas` })
    .setTimestamp();

  await channel.send({ content: `Seja bem-vindo, ${member}!`, embeds: [welcomeEmbed] }).catch((err) => console.error('[BOAS-VINDAS] Erro ao enviar mensagem:', err));
});

client.login(DISCORD_TOKEN);

