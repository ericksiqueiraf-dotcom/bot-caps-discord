const { QUEUE_MODES } = require('../constants/queueModes');
const { KNOWN_ARAM_FORMATS, isGroupedAramStreakFormat } = require('../constants/queueFormats');

function parseModeAndFormatArgs(args = []) {
  const normalizedArgs = args.map((arg) => String(arg || '').toLowerCase());
  const detectedFormat = normalizedArgs.find((arg) => KNOWN_ARAM_FORMATS.includes(arg)) || null;
  const mode = normalizedArgs.includes(QUEUE_MODES.ARAM) || Boolean(detectedFormat)
    ? QUEUE_MODES.ARAM
    : QUEUE_MODES.CLASSIC;

  return {
    mode,
    format: mode === QUEUE_MODES.ARAM ? detectedFormat : null
  };
}

function shouldMirrorAramGroupedStats(mode, format) {
  return mode === QUEUE_MODES.ARAM && isGroupedAramStreakFormat(format);
}

module.exports = {
  parseModeAndFormatArgs,
  shouldMirrorAramGroupedStats
};
