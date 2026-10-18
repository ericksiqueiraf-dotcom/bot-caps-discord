// ─── Views de ranking da CAPS ARENA ──────────────────────────────────────────
// O menu de ranking tem apenas estas 5 views:
//   duelo    -> Top 10 do !duelo (1v1 de PDL)
//   classic  -> CLASSIC (Summoner's Rift 5x5)
//   tiers    -> CLASSIC filtrado para Tier S (Esmeralda+)
//   infernal -> Top INFERNAL da temporada
//   tt3x3    -> TWISTED TREELINE 3X3 (formato 3x3)
//
// Os formatos ARAM 1x1 / 2x2 / 4x4 / 5x5 saíram do MENU DE RANKING:
//   - 1x1  -> virou o rank do !duelo (o alias `1x1` continua aceito e cai em duelo)
//   - 2x2, 4x4, 5x5 -> aposentados (mensagem explicativa)
// Importante: as FILAS desses formatos seguem intactas (!entrar aram 2x2 etc.).
// Aqui só se decide o que aparece/clareia no ranking.

const RANKING_VIEWS = Object.freeze(['duelo', 'classic', 'tiers', 'infernal', 'tt3x3']);

const VIEW_LABELS = Object.freeze({
  duelo: 'DUELO',
  classic: 'CLASSIC',
  tiers: 'CLASSIC TIER S',
  infernal: 'INFERNAL',
  tt3x3: 'TWISTED TREELINE 3X3'
});

const VIEW_ALIASES = new Map([
  ['duelo', 'duelo'],
  ['duelos', 'duelo'],
  ['duel', 'duelo'],
  ['1x1', 'duelo'],          // o antigo rank 1x1 virou o rank do duelo
  ['classic', 'classic'],
  ['classico', 'classic'],
  ['clássico', 'classic'],
  ['tiers', 'tiers'],
  ['tier', 'tiers'],
  ['tier-s', 'tiers'],
  ['tierss', 'tiers'],
  ['tier s', 'tiers'],
  ['s', 'tiers'],
  ['infernal', 'infernal'],
  ['infernais', 'infernal'],
  ['inf', 'infernal'],
  ['tt', 'tt3x3'],
  ['tt3x3', 'tt3x3'],
  ['3x3', 'tt3x3'],
  ['twisted', 'tt3x3'],
  ['treeline', 'tt3x3'],
  ['twistedtreeline', 'tt3x3'],
  ['twisted treeline', 'tt3x3']
]);

// Modos que existiam no ranking e foram retirados (para dar uma resposta clara).
const RETIRED_VIEWS = new Map([
  ['2x2', 'ARAM 2x2'],
  ['4x4', 'ARAM 4x4'],
  ['5x5', 'ARAM 5x5'],
  ['aram', 'ARAM 5x5']
]);

function labelsFor(views) {
  return views.map((view) => VIEW_LABELS[view] || view).join(', ');
}

function buildRetiredMessage(retiredLabel, allowed) {
  const prefix = retiredLabel ? `🚫 O ranking **${retiredLabel}** foi retirado.` : '🚫 Ranking indisponível.';
  return `${prefix}\nRankings ativos: ${labelsFor(allowed)}.`;
}

function buildUnknownMessage(token, allowed) {
  return `🚫 Ranking desconhecido: \`${token}\`.\nRankings ativos: ${labelsFor(allowed)}.`;
}

/**
 * Interpreta os argumentos de `!placar` / `!top10` / `!topstreak`.
 * @param {string[]} args
 * @param {{ allowed?: string[] }} [options]
 * @returns {{ ok: boolean, view: string|null, label: string|null, message?: string }}
 */
function parseRankingView(args = [], options = {}) {
  const allowed = Array.isArray(options.allowed) && options.allowed.length > 0
    ? options.allowed.filter((view) => RANKING_VIEWS.includes(view))
    : RANKING_VIEWS;

  const tokens = (Array.isArray(args) ? args : [args])
    .map((arg) => String(arg || '').trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) {
    const view = allowed.includes('classic') ? 'classic' : allowed[0];
    return { ok: true, view, label: VIEW_LABELS[view] };
  }

  for (const token of tokens) {
    const view = VIEW_ALIASES.get(token);
    if (!view) continue;

    if (!allowed.includes(view)) {
      return {
        ok: false,
        view: null,
        label: VIEW_LABELS[view],
        message: `🚫 **${VIEW_LABELS[view]}** não tem ranking neste comando.\nRankings ativos: ${labelsFor(allowed)}.`
      };
    }

    return { ok: true, view, label: VIEW_LABELS[view] };
  }

  const retired = RETIRED_VIEWS.get(tokens[0]);
  return {
    ok: false,
    view: null,
    label: null,
    message: retired ? buildRetiredMessage(retired, allowed) : buildUnknownMessage(tokens[0], allowed)
  };
}

module.exports = {
  RANKING_VIEWS,
  VIEW_LABELS,
  VIEW_ALIASES,
  RETIRED_VIEWS,
  parseRankingView
};
