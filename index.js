require('dotenv').config();

const fs = require('fs');
const path = require('path');
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
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');

const config = require('./config.json');
const { createVipPixPayment, getClubeTierConfig, recordPendingPayment, startVipPaymentPoller } = require('./services/clubePaymentsService');
const { createRiotService } = require('./services/riotService');
const { startSextaScheduler, startLclScheduler } = require('./services/eventoService');
const { handleTempVoiceStateUpdate } = require('./services/tempVoiceService');
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
  NON_PLAYER: 'onboarding_non_player',
  QUICK_START: 'onboarding_quick_start'
};
const ONBOARDING_MODAL_ID = 'onboarding_lol_registration';
const ONBOARDING_MODAL_FIELD_ID = 'riot_nickname';
const CLUBE_BUY_PREFIX = 'clube:buy:';
const CLUBE_EMAIL_MODAL_PREFIX = 'clube:email:';
const CLUBE_EMAIL_FIELD_ID = 'clube_email';

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
    new SlashCommandBuilder().setName('salahub').setDescription('Lista as salas temporárias ativas.'),
    new SlashCommandBuilder().setName('sala').setDescription('Mostra ou renomeia sua sala temporária.')
      .addStringOption((option) => option.setName('nome').setDescription('Novo nome da sala').setRequired(false)),
    new SlashCommandBuilder().setName('convidar').setDescription('Convida alguém para sua sala temporária.')
      .addUserOption((option) => option.setName('usuario').setDescription('Usuário a convidar').setRequired(true)),
    new SlashCommandBuilder().setName('limparvoz').setDescription('Apaga sua sala temporária (use dentro dela).'),
    new SlashCommandBuilder().setName('salalock').setDescription('Tranca/destranca sua sala temporária.')
      .addStringOption((option) => option.setName('acao').setDescription('Trancar ou destrancar').setRequired(false)
        .addChoices({ name: 'Trancar', value: 'trancar' }, { name: 'Destrancar', value: 'destrancar' })),
    new SlashCommandBuilder().setName('salalimit').setDescription('Limite de usuários da sua sala (0 = sem limite).')
      .addIntegerOption((option) => option.setName('limite').setDescription('0 a 99').setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder().setName('salaexpulsar').setDescription('Remove alguém da sua sala temporária.')
      .addUserOption((option) => option.setName('usuario').setDescription('Usuário a remover').setRequired(true)),
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
      .setName('toprankinfernal')
      .setDescription('Quem mais conquistou o INFERNAL na temporada.'),
    new SlashCommandBuilder().setName('clube').setDescription('Mostra o clube VIP: tiers, benefícios e membros.'),
    new SlashCommandBuilder().setName('clubeadmin').setDescription('Lista assinaturas ativas do clube (staff).'),
    new SlashCommandBuilder().setName('convite').setDescription('Seu link pessoal de convite + recompensas.'),
    new SlashCommandBuilder().setName('topconvites').setDescription('Ranking de quem mais trouxe gente.'),
    new SlashCommandBuilder().setName('tempo').setDescription('Seu tempo em call (geral, semana, mês).'),
    new SlashCommandBuilder().setName('topvoz').setDescription('Ranking de tempo em call do mês.'),
    new SlashCommandBuilder().setName('torneio').setDescription('Torneio CAPS ARENA: entrar, ver lista, status e regras.')
      .addStringOption((option) => option.setName('acao').setDescription('O que fazer').setRequired(true)
        .addChoices(
          { name: 'Entrar', value: 'entrar' },
          { name: 'Sair', value: 'sair' },
          { name: 'Lista', value: 'lista' },
          { name: 'Status', value: 'status' },
          { name: 'Regras', value: 'info' }
        )),
    new SlashCommandBuilder().setName('clubefixar').setDescription('Posta e fixa os benefícios no #clube-vip (staff).'),
    new SlashCommandBuilder().setName('querolive').setDescription('Entra/sai do ping 🔴 Ao Vivo.'),
    new SlashCommandBuilder()
      .setName('live')
      .setDescription('Divulga sua live (só 👑 Lendário, 1x a cada 6h).')
      .addStringOption((option) => option.setName('link').setDescription('Link da Twitch, YouTube ou Kick').setRequired(true)),
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
  isGuildAllowed,
  isMemberInQueueVoiceChannel,
  isMemberInTierSVoiceChannel,
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
  updateQueueDashboard,
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
  parseQueueJoinButtonId,
  startDailyRankScheduler,
  startClubePromoScheduler,
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
  THEME,
  FOOTER_PREFIX,
  VIP_TIERS,
  isRecentVipSubscription
} = require('./utils/lobbyUtils');


const handlers = require('./commands/legacyCommands');


client.once('ready', async () => {
  await ensureDataFiles();
  console.log(`Bot conectado como ${client.user.tag} | ${BOT_VERSION}`);
  await registerSlashCommands();
  startDailyRankScheduler();
  startVipPaymentPoller({ config });
  startClubePromoScheduler();
  startSextaScheduler();
  startLclScheduler();
  startVoiceTimeScheduler();

  // Snapshot de convites p/ atribuir quem convidou cada novo membro.
  try {
    for (const guild of client.guilds.cache.values()) {
      await snapshotGuildInvites(guild);
    }
  } catch (err) {
    console.error('[RESTART] Erro ao fotografar convites:', err);
  }

  // Reabre sessões de tempo em call p/ quem já está em voz (sem retroativo).
  try {
    const { ensureVoiceStore } = require('./services/voiceTimeService');
    const { loadSystemMeta, saveSystemMeta } = require('./services/dataService');
    const systemMeta = await loadSystemMeta();
    const store = ensureVoiceStore(systemMeta);
    const now = Date.now();
    for (const guild of client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (!channel?.isVoiceBased?.()) continue;
        for (const [, member] of channel.members) {
          if (member.user?.bot) continue;
          if (isVoiceTimeCountable({ channel, mute: member.voice?.mute, deaf: member.voice?.deaf, selfMute: member.voice?.selfMute, selfDeaf: member.voice?.selfDeaf, suppress: member.voice?.suppress }, guild)) {
            store.sessions[`${guild.id}:${member.id}`] = { since: now, channelId: channel.id };
          }
        }
      }
    }
    await saveSystemMeta(systemMeta);
  } catch (err) {
    console.error('[RESTART] Erro ao reabrir sessões de call:', err);
  }

  // Retoma votacoes de MVP pendentes (se o bot reiniciou no meio de uma votacao)
  try {
    await resumePendingMvpVotes();
  } catch (err) {
    console.error('[RESTART] Erro ao retomar votacoes de MVP:', err);
  }

  // Expira cargos INFERNAL vencidos (08h) logo na inicializacao + reconcilia orfaos
  try {
    const { reconcileInfernalRoles } = require('./utils/lobbyUtils');
    for (const guild of client.guilds.cache.values()) {
      await expireInfernalRolesIfDue(guild);
      await reconcileInfernalRoles(guild).catch(() => null);
    }
  } catch (err) {
    console.error('[RESTART] Erro ao expirar cargos INFERNAL:', err);
  }

  // Garante que o painel fixo do canal #fila volte com os botoes apos restart/deploy.
  try {
    for (const guild of client.guilds.cache.values()) {
      await updateQueueDashboard(guild);
    }
  } catch (err) {
    console.error('[RESTART] Erro ao atualizar painel de fila:', err);
  }

  // Item 3: Recuperar auto-starts pendentes (se a sala estiver cheia no BD e reiniciou)
  try {
    const queueData = await loadQueue();
    for (const guild of client.guilds.cache.values()) {
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
});

client.on('guildCreate', async (guild) => {
  const commands = buildSlashCommands();
  await guild.commands.set(commands).catch((error) => {
    console.error(`[SLASH] Nao foi possivel registrar os comandos na nova guild ${guild.id}:`, error);
  });
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  await handleTempVoiceStateUpdate(oldState, newState).catch((error) => {
    console.error('[TEMP VOICE] Erro no evento de voz:', error.message);
  });
  await handleVoiceTimeUpdate(oldState, newState).catch((error) => {
    console.error('[VOICE TIME] Erro no evento de voz:', error.message);
  });
});

function isVoiceTimeCountable(voiceState, guild) {
  const channel = voiceState.channel;
  if (!channel) return false;
  if (guild?.afkChannelId && channel.id === guild.afkChannelId) return false;
  if (voiceState.mute || voiceState.deaf || voiceState.selfMute || voiceState.selfDeaf || voiceState.suppress) return false;
  return true;
}

async function handleVoiceTimeUpdate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) return;
  const { ensureVoiceStore, closeSession } = require('./services/voiceTimeService');
  const { loadSystemMeta, saveSystemMeta } = require('./services/dataService');
  const now = Date.now();
  const systemMeta = await loadSystemMeta();
  const store = ensureVoiceStore(systemMeta);
  closeSession(store, member.guild.id, member.id, now);
  if (isVoiceTimeCountable(newState, member.guild)) {
    store.sessions[`${member.guild.id}:${member.id}`] = { since: now, channelId: newState.channel.id };
  }
  await saveSystemMeta(systemMeta);
}

async function runVoiceTimeMonthlyTick(nowMs = Date.now()) {
  const vt = require('./services/voiceTimeService');
  const { loadSystemMeta, saveSystemMeta } = require('./services/dataService');
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(nowMs)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]);
  const obj = Object.fromEntries(parts);
  if (obj.day !== '01') return;
  const thisMonth = `${obj.year}-${obj.month}`;
  const systemMeta = await loadSystemMeta();
  const store = vt.ensureVoiceStore(systemMeta);
  if (store.lastRewardMonth === thisMonth) return;
  const prev = new Date(Date.UTC(Number(obj.year), Number(obj.month) - 1, 1) - 24 * 3600 * 1000);
  const prevMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
  const { earners, vozDoMes, top } = vt.computeMonthlyRewards(store, prevMonth);
  for (const guild of client.guilds.cache.values()) {
    try {
      const findOrCreateRole = async (name) => {
        let role = guild.roles.cache.find((r) => r.name === name);
        if (!role) role = await guild.roles.create({ name, reason: 'Tempo em call' }).catch(() => null);
        return role;
      };
      // Cargos de escada (permanentes): garante o maior e tira os menores.
      const ladder = ['🎙️ Ativo', '🎙️ Frequente', '🎙️ Viciado em Call'];
      for (const [userId, rankName] of [
        ...earners.viciado.map((id) => [id, '🎙️ Viciado em Call']),
        ...earners.frequente.filter((id) => !earners.viciado.includes(id)).map((id) => [id, '🎙️ Frequente']),
        ...earners.ativo.filter((id) => !earners.frequente.includes(id) && !earners.viciado.includes(id)).map((id) => [id, '🎙️ Ativo'])
      ]) {
        const m = await guild.members.fetch(userId).catch(() => null);
        if (!m) continue;
        for (const rName of ladder) {
          const role = rName === rankName ? await findOrCreateRole(rName) : guild.roles.cache.find((r) => r.name === rName);
          if (!role) continue;
          if (rName === rankName) await m.roles.add(role, 'Tempo em call').catch(() => null);
          else if (m.roles.cache.has(role.id)) await m.roles.remove(role, 'Subiu de cargo de call').catch(() => null);
        }
      }
      // Lounge VIP do mês: quem fez 15h+ entra; quem tinha sai.
      const lounge = guild.channels.cache.find((c) => c.name === '👑 Lounge VIP');
      if (lounge) {
        const prevList = Object.entries(store.loungeAccess || {}).filter(([, m]) => m !== thisMonth).map(([id]) => id);
        for (const id of prevList) {
          await lounge.permissionOverwrites.delete(id, 'Fim do acesso mensal').catch(() => null);
          delete store.loungeAccess[id];
        }
        const granted = [...new Set([...earners.frequente, ...earners.viciado])];
        for (const id of granted) {
          await lounge.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true, Speak: true }).catch(() => null);
          store.loungeAccess[id] = thisMonth;
        }
      }
      // Voz do Mês rotativo + anúncio.
      if (vozDoMes) {
        const role = await findOrCreateRole(vt.VOZ_DO_MES_ROLE);
        if (role) {
          for (const [, m] of role.members) await m.roles.remove(role, 'Nova voz do mês').catch(() => null);
          const champ = await guild.members.fetch(vozDoMes).catch(() => null);
          if (champ) await champ.roles.add(role, 'Voz do mês').catch(() => null);
        }
      }
      const news = guild.channels.cache.find((c) => c.name === '📢┃comunicados' && c.isTextBased?.());
      if (news?.isTextBased?.()) {
        const lines = top.slice(0, 3).map((t, i) => `**${i + 1}º** <@${t.userId}> — ${vt.formatTempo(t.ms)}`);
        await news.send(
          `🎙️ **Apuração do tempo em call — ${prevMonth.slice(5)}/${prevMonth.slice(0, 4)}**\n` +
          (lines.length ? lines.join('\n') + '\n' : 'Sem destaques.\n') +
          (vozDoMes ? `\n👑 **Voz do Mês: <@${vozDoMes}>** (Lounge VIP liberado + cargo)!` : '')
        ).catch(() => null);
      }
    } catch (error) {
      console.error('[VOICE TIME] Erro na apuração mensal:', error.message);
    }
  }
  store.lastRewardMonth = thisMonth;
  await saveSystemMeta(systemMeta);
}

function startVoiceTimeScheduler() {
  setInterval(() => {
    runVoiceTimeMonthlyTick(Date.now()).catch((err) => console.error('[VOICE TIME] Erro no tick:', err.message));
  }, 5 * 60 * 1000).unref?.();
}

client.on('channelDelete', async (channel) => {
  try {
    const { unregisterTempRoom } = require('./services/tempVoiceService');
    if (channel?.id && channel?.guild?.id) unregisterTempRoom(channel.id, channel.guild.id);
  } catch (error) {
    console.error('[TEMP VOICE] Erro ao limpar registro da sala apagada:', error.message);
  }
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
      case 'clube':
        await handlers.handleClubeCommand(message);
        break;
      case 'clubeadmin':
        await handlers.handleClubeAdminCommand(message);
        break;
      case 'convite':
        await handlers.handleConviteCommand(message);
        break;
      case 'topconvites':
        await handlers.handleTopConvitesCommand(message);
        break;
      case 'tempo':
        await handlers.handleTempoCommand(message);
        break;
      case 'topvoz':
        await handlers.handleTopVozCommand(message);
        break;
      case 'torneio':
        await handlers.handleTorneioCommand(message, args);
        break;
      case 'clubefixar':
        await handlers.handleClubeFixarCommand(message);
        break;
      case 'querolive':
      case 'quero-live':
      case 'queroaovivo':
        await handlers.handleQueroLiveCommand(message);
        break;
      case 'live':
        await handlers.handleLiveCommand(message, args);
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
      case 'remover':
        await handlers.handleRemoveCommand(message);
        break;
      case 'reset':
        await handlers.handleResetCommand(message);
        break;
      case 'limparsalas':
        await handlers.handleCleanupRoomsCommand(message, args);
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
      case 'salahub':
        await handlers.handleSalaHubCommand(message, args);
        break;
      case 'convidar':
        await handlers.handleConvidarCommand(message, args);
        break;
      case 'limparvoz':
        await handlers.handleLimparVozCommand(message, args);
        break;
      case 'sala':
        await handlers.handleSalaCommand(message, args);
        break;
      case 'salalock':
        await handlers.handleSalaLockCommand(message, args);
        break;
      case 'salalimit':
        await handlers.handleSalaLimitCommand(message, args);
        break;
      case 'salaexpulsar':
        await handlers.handleSalaExpulsarCommand(message, args);
        break;
      case 'pdl':
        await handlers.handlePdlCommand(message, args);
        break;
      case 'regras':
      case 'regra':
      case 'rules':
        await handlers.handleRulesCommand(message);
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
      if (interaction.customId === ONBOARDING_BUTTON_IDS.LOL_PLAYER || interaction.customId === ONBOARDING_BUTTON_IDS.QUICK_START) {
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

      if (String(interaction.customId || '').startsWith(CLUBE_BUY_PREFIX)) {
        const buyParts = String(interaction.customId).split(':');
        const tierKey = buyParts[2] || '';
        const isRenewal = buyParts[3] === 'renew';
        const tier = getClubeTierConfig(config, tierKey);
        if (!tier) {
          await interaction.reply({ content: 'Tier inválido.', ephemeral: true }).catch(() => null);
          return;
        }
        if (!process.env.MP_ACCESS_TOKEN) {
          await interaction.reply({ content: '💳 Assinaturas PIX em configuração — fale com a Staff.', ephemeral: true }).catch(() => null);
          return;
        }
        const { getRenewalPrice } = require('./services/clubePaymentsService');
        const amount = isRenewal ? getRenewalPrice(tier.preco) : tier.preco;
        const modal = new ModalBuilder()
          .setCustomId(`${CLUBE_EMAIL_MODAL_PREFIX}${tierKey}${isRenewal ? ':renew' : ''}`)
          .setTitle(`${isRenewal ? 'Renovar' : 'Assinar'} ${tier.roleName} — R$ ${amount.toFixed(2).replace('.', ',')}`);
        const emailInput = new TextInputBuilder()
          .setCustomId(CLUBE_EMAIL_FIELD_ID)
          .setLabel('Seu e-mail (para o PIX)')
          .setPlaceholder('voce@email.com')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(emailInput));
        await interaction.showModal(modal);
        return;
      }

      const queueJoin = parseQueueJoinButtonId(interaction.customId);
      if (queueJoin) {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (queueJoin.mode === 'leave') {
          const context = createInteractionContext(interaction, {
            content: '!sair'
          });
          await handlers.handleLeaveCommand(context);
          return;
        }
        if (queueJoin.mode === 'espera') {
          const context = createInteractionContext(interaction, {
            content: '!espera'
          });
          await handlers.handleWaitingListCommand(context, []);
          return;
        }
        if (queueJoin.mode === 'tiers' && !isMemberInTierSVoiceChannel(interaction.member)) {
          const context = createInteractionContext(interaction, {
            content: '!entrar'
          });
          await replyToMessage(context, 'Voce precisa estar no canal de voz `Lobby TIER S` para entrar nessa fila (só Esmeralda IV+).');
          return;
        }
        const context = createInteractionContext(interaction, {
          content: ['!entrar', ...queueJoin.args].join(' ')
        });
        await handlers.handleEnterCommand(context, queueJoin.args);
        return;
      }

      // Painel de votação de resultado: votewin:<matchId>:<time>
      if (String(interaction.customId || '').startsWith('votewin:')) {
        await handlers.handleResultVoteButton(interaction);
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
      if (String(interaction.customId || '').startsWith(CLUBE_EMAIL_MODAL_PREFIX)) {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const emailParts = String(interaction.customId).slice(CLUBE_EMAIL_MODAL_PREFIX.length).split(':');
        const tierKey = emailParts[0] || '';
        const isRenewal = emailParts[1] === 'renew';
        const email = interaction.fields.getTextInputValue(CLUBE_EMAIL_FIELD_ID)?.trim();
        try {
          const payment = await createVipPixPayment({
            tierKey,
            email,
            isRenewal,
            discordId: interaction.user.id,
            guildId: interaction.guildId,
            config
          });
          const files = [];
          if (payment.qrCodeBase64) {
            files.push({
              attachment: Buffer.from(payment.qrCodeBase64, 'base64'),
              name: 'pix-qrcode.png'
            });
          }
          const embed = new EmbedBuilder()
            .setTitle(`💎 ${payment.tier.roleName} — R$ ${payment.amount.toFixed(2).replace('.', ',')}${payment.isRenewal ? ' (renovação -10%)' : ''}`)
            .setDescription(`Pague no app do seu banco (vale por ${30} min). Assim que o PIX for confirmado, o cargo entra **sozinho**.\n${payment.ticketUrl ? `[Abrir no Mercado Pago](${payment.ticketUrl})` : ''}`)
            .setColor('#00C851');
          if (payment.qrCodeBase64) embed.setImage('attachment://pix-qrcode.png');
          const payload = { embeds: [embed] };
          if (files.length) payload.files = files;
          if (payment.qrCode) payload.content = `PIX copia e cola:\n\`\`\`\n${payment.qrCode}\n\`\`\``;
          await interaction.editReply(payload).catch(() => null);
          try {
            await recordPendingPayment({
              paymentId: payment.paymentId,
              guildId: interaction.guildId,
              discordId: interaction.user.id,
              tierKey,
              pixExpiresAt: payment.expiresAt
            });
          } catch (err) {
            console.error('[CLUBE] Falha ao registrar pendência:', err.message);
          }
        } catch (err) {
          await interaction.editReply({ content: `❌ Não consegui gerar o PIX: ${err.message}` }).catch(() => null);
        }
        return;
      }
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
      case 'clube':
        await handlers.handleClubeCommand(context);
        break;
      case 'clubeadmin':
        await handlers.handleClubeAdminCommand(context);
        break;
      case 'convite':
        await handlers.handleConviteCommand(context);
        break;
      case 'topconvites':
        await handlers.handleTopConvitesCommand(context);
        break;
      case 'tempo':
        await handlers.handleTempoCommand(context);
        break;
      case 'topvoz':
        await handlers.handleTopVozCommand(context);
        break;
      case 'torneio': {
        const acao = interaction.options.getString('acao');
        await handlers.handleTorneioCommand(context, acao ? [acao] : []);
        break;
      }
      case 'clubefixar':
        await handlers.handleClubeFixarCommand(context);
        break;
      case 'querolive':
        await handlers.handleQueroLiveCommand(context);
        break;
      case 'live': {
        const liveLink = interaction.options.getString('link');
        await handlers.handleLiveCommand(context, liveLink ? [liveLink] : []);
        break;
      }
      case 'perfil':
      case 'ficha':
        await handlers.handlePlayerCardCommand(context, targetUser);
        break;
      case 'remover':
        await handlers.handleRemoveCommand(context, targetUser);
        break;
      case 'salahub':
        await handlers.handleSalaHubCommand(context);
        break;
      case 'sala': {
        const salaNome = interaction.options.getString('nome');
        await handlers.handleSalaCommand(context, salaNome ? [salaNome] : []);
        break;
      }
      case 'convidar':
        await handlers.handleConvidarCommand(context, [], targetUser);
        break;
      case 'limparvoz':
        await handlers.handleLimparVozCommand(context);
        break;
      case 'salalock': {
        const acao = interaction.options.getString('acao');
        await handlers.handleSalaLockCommand(context, acao ? [acao] : []);
        break;
      }
      case 'salalimit':
        await handlers.handleSalaLimitCommand(context, [String(interaction.options.getInteger('limite'))]);
        break;
      case 'salaexpulsar':
        await handlers.handleSalaExpulsarCommand(context, [], targetUser);
        break;
      case 'regras':
        await handlers.handleRulesCommand(context);
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

client.on('guildMemberAdd', async (member) => {
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
      .setCustomId(ONBOARDING_BUTTON_IDS.QUICK_START)
      .setLabel('⚡ Quero jogar agora')
      .setStyle(ButtonStyle.Success),
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

// ─── Convites com recompensa: snapshot de usos p/ atribuir quem convidou ─────
const inviteUseCache = new Map(); // guildId -> Map(code, uses)

async function snapshotGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;
    const map = new Map();
    for (const inv of invites.values()) map.set(inv.code, inv.uses || 0);
    inviteUseCache.set(guild.id, map);
  } catch (error) {
    console.error('[CONVITE] Erro ao fotografar convites:', error.message);
  }
}

client.on('inviteCreate', (invite) => {
  const map = inviteUseCache.get(invite.guild?.id) || new Map();
  map.set(invite.code, invite.uses || 0);
  if (invite.guild?.id) inviteUseCache.set(invite.guild.id, map);
});

client.on('inviteDelete', (invite) => {
  inviteUseCache.get(invite.guild?.id)?.delete(invite.code);
});

async function grantRecruitRewards(guild, inviterId, lifetime, unlocked) {
  try {
    const inviter = await guild.members.fetch(inviterId).catch(() => null);
    if (!inviter) return;
    const findOrCreateRole = async (name) => {
      let role = guild.roles.cache.find((r) => r.name === name);
      if (!role) role = await guild.roles.create({ name, reason: 'Recompensa de convites' }).catch(() => null);
      return role;
    };
    if (unlocked.includes(3)) {
      const role = await findOrCreateRole('🌱 Recrutador');
      if (role) await inviter.roles.add(role, 'Meta de 3 convites').catch(() => null);
    }
    if (unlocked.includes(5)) {
      const destaque = await findOrCreateRole('⭐ Destaque');
      if (destaque) {
        for (const [, m] of destaque.members) await m.roles.remove(destaque, 'Novo destaque de recrutamento').catch(() => null);
        await inviter.roles.add(destaque, 'Meta de 5 convites').catch(() => null);
      }
      const news = guild.channels.cache.find((c) => c.name === '📢┃comunicados' && c.isTextBased?.())
        || (config.textChannels?.welcomeChannelId ? await guild.channels.fetch(config.textChannels.welcomeChannelId).catch(() => null) : null);
      if (news?.isTextBased?.()) {
        await news.send(`🌟 ${inviter} é o novo **destaque de recrutamento** com **${lifetime} convites**! Traga gente com \`!convite\` e tome o lugar.`).catch(() => null);
      }
    }
    if (unlocked.includes(10)) {
      const vipRole = guild.roles.cache.find((r) => r.name === '⭐ VIP');
      if (vipRole) await inviter.roles.add(vipRole, 'Meta de 10 convites: 7 dias de VIP').catch(() => null);
      const { loadVipSubscriptions, saveVipSubscriptions } = require('./services/dataService');
      const { subscriptions } = await loadVipSubscriptions();
      const now = Date.now();
      subscriptions.push({
        paymentId: `free-recruta:${guild.id}:${inviterId}:${now}`,
        guildId: guild.id,
        discordId: inviterId,
        tierKey: 'vip',
        status: 'active',
        startedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
        free: true
      });
      await saveVipSubscriptions({ subscriptions });
    }
    const festa = unlocked.includes(10)
      ? '\n🏆 **7 dias de ⭐ VIP ativos!** Aproveite!'
      : unlocked.includes(5)
        ? `\n🌟 Você é o **DESTAQUE** da Arena! Faltam **${10 - lifetime}** para os 7 dias de VIP.`
        : unlocked.includes(3)
          ? `\n🌱 Cargo **Recrutador** garantido! Faltam **${5 - lifetime}** para o destaque.`
          : '';
    await inviter.send(
      `🔗 **Recrutamento CAPS Arena**\nVocê já trouxe **${lifetime} pessoa(s)**! Metas: 3 = 🌱 Recrutador • 5 = destaque • 10 = 7 dias de ⭐ VIP grátis.${festa}`
    ).catch(() => null);
  } catch (error) {
    console.error('[CONVITE] Erro nas recompensas:', error.message);
  }
}

client.on('guildMemberAdd', async (member) => {
  try {
    const { ensureInvitesStore, recordInviteUse, checkThresholdRewards } = require('./services/convitesService');
    const { loadSystemMeta, saveSystemMeta } = require('./services/dataService');
    const guild = member.guild;
    let before = inviteUseCache.get(guild.id);
    if (!before) {
      await snapshotGuildInvites(guild);
      before = inviteUseCache.get(guild.id) || new Map();
    }
    const after = await guild.invites.fetch().catch(() => null);
    let usedCode = null;
    let inviterId = null;
    if (after) {
      const afterMap = new Map();
      for (const inv of after.values()) {
        afterMap.set(inv.code, inv.uses || 0);
        if ((inv.uses || 0) > (before.get(inv.code) || 0) && !usedCode) {
          usedCode = inv.code;
          inviterId = inv.inviterId || inv.inviter?.id || null;
        }
      }
      inviteUseCache.set(guild.id, afterMap);
    }
    if (!inviterId) return;
    const systemMeta = await loadSystemMeta();
    const store = ensureInvitesStore(systemMeta);
    const result = recordInviteUse(store, {
      code: usedCode,
      inviterId,
      newMemberId: member.id,
      memberCreatedAtMs: member.user?.createdAt,
      nowMs: Date.now()
    });
    if (!result.counted) {
      await saveSystemMeta(systemMeta).catch(() => null);
      return;
    }
    const { lifetime, unlocked } = checkThresholdRewards(store, inviterId);
    await saveSystemMeta(systemMeta);
    await grantRecruitRewards(guild, inviterId, lifetime, unlocked);
  } catch (error) {
    console.error('[CONVITE] Erro ao atribuir convite:', error.message);
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    const { ensureInvitesStore, handleMemberLeave } = require('./services/convitesService');
    const { loadSystemMeta, saveSystemMeta } = require('./services/dataService');
    const systemMeta = await loadSystemMeta();
    const store = ensureInvitesStore(systemMeta);
    const { reverted } = handleMemberLeave(store, { newMemberId: member.id, nowMs: Date.now() });
    if (reverted.length > 0) await saveSystemMeta(systemMeta);
  } catch (error) {
    console.error('[CONVITE] Erro ao estornar convite:', error.message);
  }
});

// Anti-duplicação do anúncio de entrada no clube: o Discord pode emitir
// guildMemberUpdate mais de uma vez para a mesma mudança de cargo.
const recentClubeAnnouncements = new Map();
const CLUBE_ANNOUNCE_DEDUPE_MS = 5 * 60 * 1000;

function alreadyAnnouncedClubeJoin(guildId, userId, tierName) {
  const key = `${guildId}:${userId}:${tierName}`;
  const now = Date.now();
  const last = recentClubeAnnouncements.get(key) || 0;
  if (now - last < CLUBE_ANNOUNCE_DEDUPE_MS) return true;
  recentClubeAnnouncements.set(key, now);
  if (recentClubeAnnouncements.size > 500) {
    for (const [k, ts] of recentClubeAnnouncements) {
      if (now - ts > CLUBE_ANNOUNCE_DEDUPE_MS) recentClubeAnnouncements.delete(k);
      if (recentClubeAnnouncements.size <= 300) break;
    }
  }
  return false;
}

// Anúncio de entrada no clube VIP: quando um membro GANHA um tier, posta em
// #comunicados (ou boas-vindas). Puro status — sem vantagem competitiva.
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const gained = (VIP_TIERS || []).map((t) => t.name).find((name) => {
      const had = oldMember.roles.cache.some((role) => role.name === name);
      const has = newMember.roles.cache.some((role) => role.name === name);
      return !had && has;
    });
    if (!gained) return;

    // Mesmo ganho anunciado há pouco (evento duplicado): ignora.
    if (alreadyAnnouncedClubeJoin(newMember.guild?.id, newMember.id, gained)) return;

    // Assinatura recém-criada pelo webhook (que já anunciou): não duplicar.
    try {
      const { loadVipSubscriptions } = require('./services/dataService');
      const { subscriptions } = await loadVipSubscriptions();
      if (isRecentVipSubscription(subscriptions, newMember.guild?.id, newMember.id)) return;
    } catch { /* sem store, anuncia normal */ }

    const guild = newMember.guild;
    const target = guild.channels.cache.find((c) => c.name === '👑┃parceiros' && c.isTextBased?.())
      || (config.textChannels?.welcomeChannelId ? await guild.channels.fetch(config.textChannels.welcomeChannelId).catch(() => null) : null);
    if (!target || !target.isTextBased?.()) return;

    await target.send(`🎉 ${newMember} agora faz parte do **${gained}**! Bem-vindo(a) ao clube 💎`).catch(() => null);
  } catch (err) {
    console.error('[CLUBE] Erro no anúncio de boas-vindas:', err.message);
  }
});

client.login(DISCORD_TOKEN);
