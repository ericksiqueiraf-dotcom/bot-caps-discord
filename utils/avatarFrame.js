const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');

// Molduras do avatar no !perfil, por status no Discord.
// Cores: ouro p/ Lendário, fogo p/ INFERNAL, roxo suave p/ Apoiador.
const FRAME_STYLES = {
  lendario: { colors: ['#FFD700', '#FF9D00', '#FFD700'] },
  infernal: { colors: ['#FF3D00', '#FFB300', '#FF3D00'] },
  apoiador: { colors: ['#A98BE0', '#8A6CC8', '#A98BE0'] },
  default: { colors: ['#5865F2', '#3C45A5', '#5865F2'] }
};

// Cache em memória: a imagem só muda quando o usuário troca de avatar,
// e a URL já contém o hash do avatar, então a chave é estável.
const bufferCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCachedBuffer(key) {
  const entry = bufferCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    bufferCache.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCachedBuffer(key, buffer) {
  bufferCache.set(key, { buffer, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Gera um PNG circular (256x256) com o avatar do usuário dentro de uma
 * moldura colorida conforme o cargo. Retorna Buffer ou null em falha.
 */
async function buildFramedAvatarBuffer(avatarUrl, frameType = null) {
  if (!avatarUrl) return null;

  const style = FRAME_STYLES[frameType] || FRAME_STYLES.default;
  const cacheKey = `${avatarUrl}|${frameType || 'default'}`;
  const cached = getCachedBuffer(cacheKey);
  if (cached) return cached;

  const response = await axios.get(avatarUrl, { responseType: 'arraybuffer', timeout: 10000 });
  const avatarImage = await loadImage(Buffer.from(response.data));

  const size = 256;
  const center = size / 2;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Fundo escuro de respiro atrás da moldura
  ctx.fillStyle = '#0b0e14';
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.fill();

  // Avatar recortado em círculo
  const inset = 24;
  const innerRadius = center - inset;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const minSide = Math.min(avatarImage.width, avatarImage.height);
  const sx = (avatarImage.width - minSide) / 2;
  const sy = (avatarImage.height - minSide) / 2;
  ctx.drawImage(avatarImage, sx, sy, minSide, minSide, inset, inset, innerRadius * 2, innerRadius * 2);
  ctx.restore();

  // Anel externo com gradiente do cargo
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  style.colors.forEach((color, index) => {
    gradient.addColorStop(index / (style.colors.length - 1), color);
  });
  ctx.lineWidth = 13;
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  ctx.arc(center, center, center - 7, 0, Math.PI * 2);
  ctx.stroke();

  // Anel interno fino (brilho sutil entre moldura e avatar)
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.colors[1];
  ctx.beginPath();
  ctx.arc(center, center, innerRadius + 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const buffer = canvas.encode('png');
  setCachedBuffer(cacheKey, buffer);
  return buffer;
}

module.exports = {
  buildFramedAvatarBuffer,
  FRAME_STYLES
};
