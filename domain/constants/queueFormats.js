const KNOWN_ARAM_FORMATS = ['1x1', '2x2', '3x3', '4x4', '5x5'];
const GROUPED_ARAM_STREAK_FORMATS = new Set(['2x2', '3x3', '4x4']);

function normalizeQueueFormat(format) {
  return String(format || '').trim().toLowerCase();
}

function isKnownAramFormat(format) {
  return KNOWN_ARAM_FORMATS.includes(normalizeQueueFormat(format));
}

function isGroupedAramStreakFormat(format) {
  return GROUPED_ARAM_STREAK_FORMATS.has(normalizeQueueFormat(format));
}

module.exports = {
  KNOWN_ARAM_FORMATS,
  GROUPED_ARAM_STREAK_FORMATS,
  normalizeQueueFormat,
  isKnownAramFormat,
  isGroupedAramStreakFormat
};
