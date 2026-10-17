// Paridade CAPS × LCL nos módulos "núcleo" espelhados.
//
// Os dois bots mantêm cópias próprias desses arquivos (não há pacote
// compartilhado). Isso já gerou drift silencioso — hoje os 5 services espelhados
// divergem. Este teste não exige que sejam idênticos (ainda não são), mas trava
// a SUPERFÍCIE DE API: se o CAPS passa a exportar algo que o LCL não tem (ou
// vice-versa) e isso não estiver declarado em KNOWN_EXPORT_GAPS, o teste falha.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { exportedNames } = require('./lib/module-exports');

const ROOT = path.join(__dirname, '..');

// Módulos que deveriam ser idênticos entre os dois bots (mas hoje divergem).
const MIRRORED = [
  'services/balanceService.js',
  'services/contentTextService.js',
  'services/dataService.js',
  'services/riotService.js',
  'services/tempVoiceService.js',
  'utils/lobbyUtils.js'
];

// Diferenças de API CONHECIDAS e aceitas (revisar sempre que mexer num espelhado).
// caps = exportado só no CAPS · lcl = exportado só no LCL.
//
// Meta: ESTA LISTA SÓ DIMINUI. Se você adicionar um export de um lado só, o
// teste falha de propósito — ou espelhe no outro bot, ou declare aqui embaixo.
const KNOWN_EXPORT_GAPS = {
  'services/balanceService.js': {
    caps: ['PDL_LOSS_CAP', 'PDL_WIN_FLOOR', 'calculateExpectedScore', 'calculateTeamPdlDelta', 'getKFactor'],
    lcl: []
  },
  'services/contentTextService.js': { caps: [], lcl: [] },
  'services/dataService.js': {
    caps: ['loadVipSubscriptions', 'saveVipSubscriptions'],
    lcl: [
      'DEFAULT_GUILD_SETTINGS', 'getGuildSetting', 'loadAdminUsers', 'loadDashboardMeta',
      'loadGuildSettings', 'loadInterBusca', 'loadInterMatches', 'loadInterRanking', 'loadLclQueue',
      'saveAdminUsers', 'saveDashboardMeta', 'saveGuildSettings', 'saveInterBusca', 'saveInterMatches',
      'saveInterRanking', 'saveLclQueue'
    ]
  },
  'services/riotService.js': { caps: [], lcl: [] },
  // tempVoiceService NÃO é o mesmo módulo: são duas implementações diferentes
  // (CAPS expõe deleteTempRoom/inviteToTempRoom/...; LCL expõe handleHubCommand/...).
  'services/tempVoiceService.js': {
    caps: [
      'canCreateTempVoice', 'deleteTempRoom', 'getAllTempRooms', 'getTempRoomOwner', 'getUserTempRoom',
      'handleTempVoiceStateUpdate', 'inviteToTempRoom', 'isManagedTempVoiceChannel', 'isTempRoomOwner',
      'kickFromTempRoom', 'listTempRooms', 'renameTempRoom', 'setTempRoomLimit', 'setTempRoomLock'
    ],
    lcl: [
      'TEMP_ROOM_PREFIX', 'TEMP_TOPIC_PREFIX', 'buildTempRoomName', 'findOwnedTempRoom', 'getAllowedRoleIds',
      'getAllowedRoleNames', 'getDeleteDelayMs', 'getHubChannelId', 'getManagerRoleNames',
      'getTempRoomOwnerId', 'getTempVoiceConfig', 'getUserLimit', 'handleCleanupCommand', 'handleHubCommand',
      'handleInviteCommand', 'handleLimitCommand', 'handleLockCommand', 'handleRenameCommand',
      'handleVoiceStateUpdate', 'isTempRoom', 'isTempVoiceEnabled', 'looksLikeTempRoom',
      'memberCanCreateTempRoom', 'memberCanManageTempVoice', 'memberHasAllowedRole', 'memberIsStaff',
      'pruneTempRooms', 'resolveCreatorRoleIds', 'sanitizeChannelName'
    ]
  },
  'utils/lobbyUtils.js': {
    caps: [
      'AO_VIVO_ROLE_NAME', 'CLUBE_PROMO_HOURS', 'LIVE_COOLDOWN_MS', 'ONBOARDING_SECTIONS',
      'QUEUE_JOIN_BUTTON_IDS', 'VIP_TIERS', 'buildClubeDetalEmbed', 'buildClubeEmbed', 'buildClubePromoEmbed',
      'buildLiveEmbed', 'buildOnboardingGuideEmbed', 'buildQueueFeedText', 'buildQueueJoinActionRow',
      'buildVipTierResolver', 'ensureAoVivoRole', 'findPromoChannel', 'findRankRole',
      'formatCooldownRemaining', 'getConfiguredRankRoleId', 'getLiveCooldownRemainingMs', 'getMemberVipTier',
      'getQueueFeedChannelId', 'getRankTierFromRoleName', 'getVipSeal', 'isRankRole',
      'isRecentVipSubscription', 'parseLiveLink', 'parseQueueJoinButtonId', 'postQueueFeedMessage',
      'runClubePromoTick', 'shouldPostClubePromo', 'startClubePromoScheduler'
    ],
    lcl: [
      'DESAFIO_RULES_SECTIONS', 'LCL_QUEUE_BUTTON_IDS', 'LCL_TEAM_SIZE', 'addLclPresence',
      'announceMatchStartShared', 'buildDesafioRulesEmbed', 'buildLclQueueActionRow', 'buildLclQueueEmbed',
      'getClandestinoChannelId', 'getLclGuildPresence', 'isMemberInClandestinoChannel',
      'parseLclQueueButtonId', 'removeLclPresence', 'updateLclQueueDashboard', 'updateSharedDashboards'
    ]
  }
};

describe('paridade CAPS × LCL (módulos espelhados)', () => {
  it('a lista de espelhados existe nos dois bots', () => {
    for (const rel of MIRRORED) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `falta no CAPS: ${rel}`);
      assert.ok(fs.existsSync(path.join(ROOT, 'lcl-bot', rel)), `falta no LCL: ${rel}`);
    }
  });

  for (const rel of MIRRORED) {
    it(`superfície de API: ${rel}`, () => {
      const caps = exportedNames(path.join(ROOT, rel));
      const lcl = exportedNames(path.join(ROOT, 'lcl-bot', rel));
      assert.ok(caps.size > 0 && lcl.size > 0, `${rel}: não consegui ler os exports`);

      const known = KNOWN_EXPORT_GAPS[rel] || { caps: [], lcl: [] };
      const onlyCaps = [...caps].filter((n) => !lcl.has(n) && !known.caps.includes(n)).sort();
      const onlyLcl = [...lcl].filter((n) => !caps.has(n) && !known.lcl.includes(n)).sort();

      assert.deepEqual(
        onlyCaps, [],
        `${rel}: exportado só no CAPS — espelhe no LCL ou declare em KNOWN_EXPORT_GAPS.caps`
      );
      assert.deepEqual(
        onlyLcl, [],
        `${rel}: exportado só no LCL — espelhe no CAPS ou declare em KNOWN_EXPORT_GAPS.lcl`
      );
    });
  }
});
