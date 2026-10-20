// Pause de partida (regra da casa): cada time tem 1 pause de até 5 min por
// partida. Quem pediu pode retomar na hora (sem aviso prévio); o outro time
// aguarda a retomada automática. Puro — Discord (anúncios/timer) fica no handler.
//
// Estado vive em currentMatch.matches[lobbyId] (por guild/doc, sem cruzar bots):
//   entry.pause    = { lado: '1'|'2', porId, iniciadoEm, fim } | null
//   entry.pauseUsos = { 1: 0, 2: 0 }  (pausas CONSUMIDAS por lado)

const PAUSE_DURACAO_MIN = 5;
const PAUSE_MAX_POR_TIME = 1;

// Lado ('1'|'2') em que o jogador está na partida, ou null.
function ladoDoPlayer(match, userId) {
  const id = String(userId);
  if ((match?.teamOne || []).some((p) => p.discordId === id)) return '1';
  if ((match?.teamTwo || []).some((p) => p.discordId === id)) return '2';
  return null;
}

// Partida ativa em que o jogador participa (filtro opcional pela letra da sala).
function partidaDoPlayer(matches, userId, letra = null) {
  for (const [lobbyId, entry] of Object.entries(matches || {})) {
    if (!entry?.active || !entry?.match) continue;
    if (letra && String(entry.match.letter || '').toUpperCase() !== String(letra).toUpperCase()) continue;
    const lado = ladoDoPlayer(entry.match, userId);
    if (lado) return { lobbyId, entry, lado };
  }
  return null;
}

// Pause vencido: resolve (muta) e devolve o encerramento p/ o chamador anunciar.
function expirarSeVencido(entry, nowMs = Date.now()) {
  const p = entry?.pause;
  if (!p?.fim) return null;
  if (nowMs < Date.parse(p.fim)) return null;
  const duracaoMin = Math.round((Date.parse(p.fim) - Date.parse(p.iniciadoEm)) / 60000 * 10) / 10;
  entry.pause = null;
  return { lado: p.lado, porId: p.porId, duracaoMin, automatica: true };
}

// Decide e aplica o pause p/ o pedido do jogador. Muta `entry` e devolve:
//   { acao: 'pausar' } — pausa iniciada (fim = +5min)
//   { acao: 'retomar' } — o próprio time retomou (sem aviso prévio)
//   { acao: 'aguardar' } — pause é do OUTRO time (não pode retomar)
//   { acao: 'esgotado' } — o time já usou o(s) pause(s) da partida
//   { acao: 'sem-partida' | 'nao-participante' }
function alternarPause(entry, userId, nowMs = Date.now()) {
  if (!entry?.active || !entry?.match) return { acao: 'sem-partida' };
  const lado = ladoDoPlayer(entry.match, userId);
  if (!lado) return { acao: 'nao-participante' };

  // Pause vencido (ex.: bot reiniciou no meio): fecha e segue o fluxo normal.
  expirarSeVencido(entry, nowMs);

  const pausa = entry.pause;
  if (pausa) {
    if (pausa.lado !== lado) {
      const restamMin = Math.max(0, Math.ceil((Date.parse(pausa.fim) - nowMs) / 60000));
      return { acao: 'aguardar', lado, ladoPausa: pausa.lado, porId: pausa.porId, restamMin };
    }
    const duracaoMin = Math.max(0, Math.round((nowMs - Date.parse(pausa.iniciadoEm)) / 60000 * 10) / 10);
    entry.pause = null;
    return { acao: 'retomar', lado, porId: userId, duracaoMin };
  }

  const usos = entry.pauseUsos && typeof entry.pauseUsos === 'object' ? entry.pauseUsos : {};
  if ((Number(usos[lado]) || 0) >= PAUSE_MAX_POR_TIME) return { acao: 'esgotado', lado };

  entry.pause = {
    lado,
    porId: String(userId),
    iniciadoEm: new Date(nowMs).toISOString(),
    fim: new Date(nowMs + PAUSE_DURACAO_MIN * 60000).toISOString()
  };
  entry.pauseUsos = { ...usos, [lado]: (Number(usos[lado]) || 0) + 1 };
  return { acao: 'pausar', lado, porId: String(userId), fim: entry.pause.fim, duracaoMin: PAUSE_DURACAO_MIN };
}

// Varre todas as partidas resolvendo pausas vencidas (p/ uso no boot/tick).
// Retorna [{ lobbyId, encerramento }] das que expiraram.
function varrerPausasVencidas(matches, nowMs = Date.now()) {
  const encerradas = [];
  for (const [lobbyId, entry] of Object.entries(matches || {})) {
    const r = expirarSeVencido(entry, nowMs);
    if (r) encerradas.push({ lobbyId, encerramento: r });
  }
  return encerradas;
}

module.exports = {
  PAUSE_DURACAO_MIN,
  PAUSE_MAX_POR_TIME,
  ladoDoPlayer,
  partidaDoPlayer,
  expirarSeVencido,
  alternarPause,
  varrerPausasVencidas
};
