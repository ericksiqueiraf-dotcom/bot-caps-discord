// 🧪 Publica uma PRÉVIA dos embeds do Torneio CAPS ARENA num canal do Discord.
// Usa só REST API (fetch) — NÃO abre sessão de gateway, então não conflita com
// o caps-bot rodando no pm2. Uso:
//   node scripts/test-torneio-embeds.js --list                       (lista guilds/canais candidatos)
//   node scripts/test-torneio-embeds.js --guild <id|nome> --canal <id|nome>
// Sem --guild/--canal: 1ª guild com "teste" no nome e 1º canal com "teste"; senão
// cai para welcomeChannelId do config.json e exige --canal explícito.
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { EmbedBuilder } = require('discord.js');
const T = require('../services/torneioService');
const Canais = require('../services/torneioChannelsService');

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_TOKEN;

async function rest(route, init = {}) {
  const res = await fetch(`${API}${route}`, {
    ...init,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${corpo.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

function embeds(t) {
  const regras = Canais.buildRegrasEmbed(t, true).setColor(0xFFD700);
  const bracket = Canais.buildIntroducaoBracketEmbed().setColor(0xFFD700);
  return [regras, bracket];
}

function nomeCanal(c) {
  return c.type === 0 || c.type === 5 ? `${c.name} (${c.id})` : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (!TOKEN) throw new Error('DISCORD_TOKEN ausente no .env');
  const flag = (nome) => {
    const i = args.indexOf(`--${nome}`);
    return i >= 0 ? (args[i + 1] || '') : null;
  };
  const apenaListar = args.includes('--list');
  const bannerPath = args.includes('--sem-banner') ? null : path.join(__dirname, '..', 'assets', 'torneio-banner.png');

  const guilds = await rest('/users/@me/guilds');
  const nome1 = (g) => `${g.name} (${g.id})`;

  // Guild: arg exato > 1ª com "teste" no nome > escreve o erro.
  const alvoGuild = (flag('guild') && guilds.find((g) => g.id === flag('guild') || g.name.toLowerCase().includes(flag('guild').toLowerCase())))
    || guilds.find((g) => /teste/i.test(g.name))
    || null;
  if (apenaListar) {
    console.log('GUILDS:');
    for (const g of guilds) console.log(`  ${nome1(g)}`);
    if (alvoGuild) {
      const canais = await rest(`/guilds/${alvoGuild.id}/channels`);
      console.log(`CANAIS DE TEXTO em ${alvoGuild.name}:`);
      for (const c of canais) { const n = nomeCanal(c); if (n) console.log(`  #${n}`); }
    }
    return;
  }
  if (!alvoGuild) throw new Error(`Guild não encontrada. Use --guild. Disponíveis: ${guilds.map(nome1).join('; ')}`);

  // Canal: arg > 1º texto com "teste" no nome > welcomeChannelId do config.
  const canais = await rest(`/guilds/${alvoGuild.id}/channels`);
  const textos = canais.filter((c) => c.type === 0 || c.type === 5);
  const alvoCanal = (flag('canal') && textos.find((c) => c.id === flag('canal') || c.name.toLowerCase().includes(flag('canal').toLowerCase())))
    || textos.find((c) => /teste/i.test(c.name))
    || null;
  if (!apenaListar && !flag('canal') && !alvoCanal) {
    throw new Error(`Sem canal de teste em ${alvoGuild.name}. Use --canal <id|nome>. Textos: ${textos.map(nomeCanal).join('; ')}`);
  }
  console.log(`Publicando prévia em #${alvoCanal.name} (${alvoGuild.name})...`);

  const torneioDemo = T.newTournament(1); // embedding demo só p/ o título do regras (edição nº 1)
  const formData = new FormData();
  const anexos = [];
  if (bannerPath && fs.existsSync(bannerPath)) {
    const blob = new Blob([fs.readFileSync(bannerPath)], { type: 'image/png' });
    formData.append('files[0]', blob, 'torneio-banner.png');
    anexos.push({ id: 0, filename: 'torneio-banner.png' });
  }
  const msg = { embeds: embeds(torneioDemo).map((e) => e.toJSON()), attachments: anexos,
    content: '🧪 **Prévia (teste)** — embeds do Torneio atualizados: cadeia de ausência (5\'/10\'/20\'), reforço de rodadas anteriores, `adiar`/`retomar` e banner novo.' };
  formData.append('payload_json', JSON.stringify(msg));
  await rest(`/channels/${alvoCanal.id}/messages`, { method: 'POST', body: formData });
  console.log('✅ Prévia publicada.');
}

main().catch((err) => { console.error('❌', err.message); process.exitCode = 1; });
