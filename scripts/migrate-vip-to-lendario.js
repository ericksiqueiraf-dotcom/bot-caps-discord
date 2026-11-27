// Migra o antigo tier ⭐ VIP para 👑 Lendário (unificação dos cargos VIP).
//
// - Assinaturas com tierKey "vip" passam para "lendario".
// - Quem tem o cargo ⭐ VIP recebe 👑 Lendário (se ainda não tiver).
// - Por último, o cargo ⭐ VIP é apagado do servidor.
//
// Uso:
//   node scripts/migrate-vip-to-lendario.js            (dry-run, não altera nada)
//   node scripts/migrate-vip-to-lendario.js --apply    (aplica de verdade)
//   node scripts/migrate-vip-to-lendario.js --apply --guild=123
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadVipSubscriptions, saveVipSubscriptions } = require('../services/dataService');

const DEFAULT_GUILD_ID = '1273653944169660427';
const GUILD_ID = (process.argv.find((arg) => arg.startsWith('--guild=')) || '').split('=')[1] || DEFAULT_GUILD_ID;
const APPLY = process.argv.includes('--apply');
const VIP_ROLE = '⭐ VIP';
const LENDARIO_ROLE = '👑 Lendário';

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    method,
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Discord ${res.status} ${method} ${pathname}: ${data?.message || ''}`);
  return data;
}

// Mantém só a assinatura ativa de maior validade por usuário/tier.
function dedupeActive(list) {
  const out = [];
  const best = new Map();
  for (const sub of list) {
    if (sub?.status !== 'active') {
      out.push(sub);
      continue;
    }
    const key = `${sub.guildId}:${sub.discordId}:${sub.tierKey}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, sub);
      out.push(sub);
      continue;
    }
    if (new Date(sub.expiresAt || 0).getTime() > new Date(current.expiresAt || 0).getTime()) {
      const index = out.indexOf(current);
      if (index >= 0) out.splice(index, 1);
      best.set(key, sub);
      out.push(sub);
    }
  }
  return out;
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APLICAR' : 'dry-run'} | guild: ${GUILD_ID}`);

  const { subscriptions } = await loadVipSubscriptions();
  const migrated = subscriptions.map((sub) => (
    sub?.tierKey === 'vip'
      ? { ...sub, tierKey: 'lendario', migratedFromVipAt: new Date().toISOString() }
      : sub
  ));
  const converted = migrated.filter((sub, index) => sub.tierKey !== subscriptions[index].tierKey).length;
  const deduped = dedupeActive(migrated);
  console.log(`Assinaturas: ${subscriptions.length} | vip->lendario: ${converted} | duplicadas ativas removidas: ${migrated.length - deduped.length}`);
  if (APPLY && (converted > 0 || deduped.length !== subscriptions.length)) {
    await saveVipSubscriptions({ subscriptions: deduped });
    console.log('Assinaturas salvas.');
  }

  const roles = await api(`/guilds/${GUILD_ID}/roles`);
  const vipRole = roles.find((role) => role.name === VIP_ROLE);
  const lendarioRole = roles.find((role) => role.name === LENDARIO_ROLE);
  if (!vipRole) {
    console.log(`Cargo ${VIP_ROLE} não existe mais. Nada a migrar no Discord.`);
    process.exit(0);
  }
  if (!lendarioRole) throw new Error(`Cargo ${LENDARIO_ROLE} não encontrado no servidor.`);

  const membersWithVip = [];
  let after = '0';
  for (;;) {
    const batch = await api(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const member of batch) {
      if (member.roles.includes(vipRole.id)) membersWithVip.push(member);
    }
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) break;
  }

  console.log(`Membros com ${VIP_ROLE}: ${membersWithVip.length}`);
  for (const member of membersWithVip) {
    const alreadyLendario = member.roles.includes(lendarioRole.id);
    console.log(`- ${member.user.username} (${member.user.id}) ${alreadyLendario ? 'já tem Lendário' : 'recebe Lendário'}`);
    if (APPLY && !alreadyLendario) {
      await api(`/guilds/${GUILD_ID}/members/${member.user.id}/roles/${lendarioRole.id}`, { method: 'PUT' });
    }
  }

  if (APPLY) {
    await api(`/guilds/${GUILD_ID}/roles/${vipRole.id}`, { method: 'DELETE' });
    console.log(`Cargo ${VIP_ROLE} apagado.`);
  } else {
    console.log(`(dry-run) apagaria o cargo ${VIP_ROLE}.`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
