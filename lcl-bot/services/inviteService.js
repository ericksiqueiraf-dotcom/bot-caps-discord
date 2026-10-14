// Convites do Discord para o modo inter-servidores.
// Centraliza createInvite + entrega (DM com fallback), com erros mapeados.
// O bot NAO tinha nenhum fluxo de Invite antes (verificado em codigo).

const DEFAULT_INVITE_OPTS = {
  maxAge: 3600, // 1h
  maxUses: 14, // 10 jogadores + sobra p/ staff
  unique: true
};

// Cria um invite num canal. Retorna {ok, invite:{code,url,expiresAt}} ou {ok:false, reason}.
async function createMatchInvite(channel, opts = {}) {
  if (!channel || typeof channel.createInvite !== 'function') {
    return { ok: false, reason: 'invalid_channel' };
  }
  try {
    const invite = await channel.createInvite({
      maxAge: opts.maxAge ?? DEFAULT_INVITE_OPTS.maxAge,
      maxUses: opts.maxUses ?? DEFAULT_INVITE_OPTS.maxUses,
      unique: opts.unique ?? DEFAULT_INVITE_OPTS.unique,
      reason: opts.reason || 'Inter-servidores: partida na CAPS ARENA'
    });
    const expiresAt = invite.expiresAt
      ? new Date(invite.expiresAt).toISOString()
      : new Date(Date.now() + (opts.maxAge ?? DEFAULT_INVITE_OPTS.maxAge) * 1000).toISOString();
    return { ok: true, invite: { code: invite.code, url: invite.url || `https://discord.gg/${invite.code}`, expiresAt } };
  } catch (err) {
    // 50013 = Missing Permissions, 50001 = Missing Access, 10003 = Unknown Channel
    if (err?.code === 50013) return { ok: false, reason: 'missing_permissions', error: err.message };
    if (err?.code === 50001) return { ok: false, reason: 'missing_access', error: err.message };
    if (err?.code === 10003) return { ok: false, reason: 'unknown_channel', error: err.message };
    return { ok: false, reason: 'discord_error', error: err?.message || String(err) };
  }
}

function buildInterInviteMessage({ teamName, opponentName, serie, inviteUrl, arenaName }) {
  return (
    `⚔️ **INTER-SERVIDORES — ${teamName} vs ${opponentName}** (${serie})\n` +
    `Sua partida foi marcada na **${arenaName}** (servidor neutro).\n` +
    `Entre pelo convite: ${inviteUrl}\n` +
    `O convite expira em ~1h e vale para o time todo. Boa partida!`
  );
}

// Envia o invite por DM para cada discordId. fetchMember injeta busca de membro/user.
// Retorna {sent: [], dmFailed: []}. Nunca joga excecao.
async function sendInterInvites(fetchUser, discordIds, text) {
  const sent = [];
  const dmFailed = [];
  for (const id of discordIds || []) {
    try {
      const user = await fetchUser(id);
      if (!user || typeof user.send !== 'function') {
        dmFailed.push(String(id));
        continue;
      }
      await user.send(text);
      sent.push(String(id));
    } catch {
      dmFailed.push(String(id));
    }
  }
  return { sent, dmFailed };
}

module.exports = {
  DEFAULT_INVITE_OPTS,
  createMatchInvite,
  buildInterInviteMessage,
  sendInterInvites
};
