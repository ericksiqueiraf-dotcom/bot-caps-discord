// Instalador unificado CAPS / LCL.
// Pede o ID do servidor (Guild ID) + qual bot instalar e aplica o padrão
// correspondente de forma idempotente (pode rodar de novo sem medo).
//
// USO INTERATIVO (recomendado):
//   node instalar.js
//
// USO DIRETO:
//   node instalar.js <GUILD_ID> <caps|lcl|ambos> [--dry-run] [--skip-config] [--keep-perms]
//
// Exemplos:
//   node instalar.js 1273653944169660427 caps
//   node instalar.js 1273653944169660427 lcl --dry-run
//   node instalar.js 1273653944169660427 ambos
//
// PRÉ-REQUISITOS:
//   - O bot escolhido já convidado no servidor COM permissão de Administrador.
//   - .env com DISCORD_TOKEN válido na pasta do bot escolhido:
//       CAPS -> BOT CAPS DISCORD/.env
//       LCL  -> LCL BOT/.env
//       AMBOS -> usa o token do CAPS (organize-official-discord.js)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CAPS_DIR = __dirname;
const LCL_DIR = resolveLclDir();

const BOTS = {
  caps: {
    label: 'CAPS (Arena classic/tier S/aram)',
    script: path.join(CAPS_DIR, 'setup-servidor.js'),
    cwd: CAPS_DIR,
    extraFlags: ['--keep-perms']
  },
  lcl: {
    label: 'LCL (Liga Clandestina / inter)',
    script: () => path.join(LCL_DIR, 'setup-servidor.js'),
    cwd: () => LCL_DIR,
    extraFlags: []
  },
  ambos: {
    label: 'AMBOS (CAPS + LCL no mesmo servidor) — recomendado p/ servidor compartilhado',
    script: path.join(CAPS_DIR, 'organize-official-discord.js'),
    cwd: CAPS_DIR,
    extraFlags: []
  }
};

function resolveLclDir() {
  const candidates = [
    process.env.LCL_BOT_DIR,
    path.join(CAPS_DIR, '..', 'LCL BOT'),
    'C:\\Users\\ErickSiqueira\\Documents\\LCL BOT'
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'setup-servidor.js'))) return dir;
    } catch { /* ignora */ }
  }
  return path.join(CAPS_DIR, '..', 'LCL BOT');
}

function printHelp() {
  console.log([
    '',
    'Instalador CAPS / LCL — aplica o padrão de salas no Discord escolhido.',
    '',
    'Uso:',
    '  node instalar.js                              -> modo interativo',
    '  node instalar.js <GUILD_ID> <caps|lcl|ambos> [--dry-run] [--skip-config] [--keep-perms]',
    '',
    '  GUILD_ID    ID numérico do servidor (15-25 dígitos). Clique dir. no servidor',
    '              com ID de desenvolvedor ativado, ou use o link do convite/ID.',
    '  caps        Aplica server-pattern.json do CAPS (categorias ARENA/FILA/VIP...)',
    '  lcl         Aplica server-pattern.json do LCL (FILA + categoria LCL)',
    '  ambos       Aplica CAPS + LCL juntos (organize-official-discord.js)',
    '',
    '  --dry-run     Só mostra o plano, não cria nada no Discord.',
    '  --skip-config Não altera config.json (só mexe no Discord).',
    '  --keep-perms  (só CAPS) Não reescreve permissões de canais existentes.',
    '',
    'Exemplos:',
    '  node instalar.js 1273653944169660427 caps',
    '  node instalar.js 1273653944169660427 lcl --dry-run',
    ''
  ].join('\n'));
}

function isValidGuildId(value) {
  return /^\d{15,25}$/.test(String(value || '').trim());
}

function normalizeBotChoice(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['1', 'caps', 'cap', 'arena'].includes(v)) return 'caps';
  if (['2', 'lcl', 'clandestino', 'liga'].includes(v)) return 'lcl';
  if (['3', 'ambos', 'both', 'caps+lcl', 'tudo'].includes(v)) return 'ambos';
  return null;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function askGuildId(initial) {
  let value = String(initial || '').trim();
  while (!isValidGuildId(value)) {
    if (value) console.log('❌ ID inválido. Use só números (15-25 dígitos). Ex.: 1273653944169660427');
    value = String(await ask('1) Digite o ID do servidor Discord (GUILD_ID): ')).trim();
  }
  return value;
}

async function askBot(initial) {
  let choice = normalizeBotChoice(initial);
  while (!choice) {
    console.log('\n2) Qual bot instalar?');
    console.log('   [1] caps  - CAPS Arena (classic / tier S / aram)');
    console.log('   [2] lcl   - LCL Liga Clandestina (inter)');
    console.log('   [3] ambos - CAPS + LCL no mesmo servidor (recomendado p/ servidor compartilhado)');
    const answer = await ask('   Escolha (1/2/3 ou caps/lcl/ambos): ');
    choice = normalizeBotChoice(answer);
    if (!choice) console.log('❌ Opção inválida. Digite 1, 2, 3, caps, lcl ou ambos.');
  }
  return choice;
}

function checkPrereqs(bot) {
  const problems = [];
  const scriptPath = typeof BOTS[bot].script === 'function' ? BOTS[bot].script() : BOTS[bot].script;
  const cwd = typeof BOTS[bot].cwd === 'function' ? BOTS[bot].cwd() : BOTS[bot].cwd;

  if (!fs.existsSync(scriptPath)) {
    problems.push(`Script não encontrado: ${scriptPath}` + (bot !== 'caps' ? ` (LCL_DIR resolvido como: ${LCL_DIR})` : ''));
  }
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) {
    problems.push(`Arquivo .env não encontrado em: ${envPath}`);
  } else {
    const envContent = fs.readFileSync(envPath, 'utf8');
    if (!/^DISCORD_TOKEN=.+/m.test(envContent)) problems.push(`DISCORD_TOKEN ausente no .env (${envPath})`);
  }
  if (bot === 'ambos' && !fs.existsSync(path.join(LCL_DIR, 'server-pattern.json'))) {
    problems.push(`Padrão LCL não encontrado em: ${path.join(LCL_DIR, 'server-pattern.json')}`);
  }
  return { scriptPath, cwd, problems };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    return;
  }

  const flags = rawArgs.filter((a) => a.startsWith('--'));
  const positionals = rawArgs.filter((a) => !a.startsWith('--'));

  let [guildIdArg, botArg] = positionals;
  // Aceita "node instalar.js --dry-run" sem posição (vai p/ interativo mantendo flags).
  if (guildIdArg && !isValidGuildId(guildIdArg) && normalizeBotChoice(guildIdArg)) {
    botArg = guildIdArg;
    guildIdArg = null;
  }

  const dryRun = flags.includes('--dry-run');
  const skipConfig = flags.includes('--skip-config');
  const keepPerms = flags.includes('--keep-perms');

  const guildId = await askGuildId(guildIdArg);
  const bot = await askBot(botArg);

  const { scriptPath, cwd, problems } = checkPrereqs(bot);
  if (problems.length) {
    console.error('\n❌ Pré-requisito pendente:');
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\nConfira o bot convidado no servidor (com Administrador) e o .env antes de repetir.');
    process.exit(1);
  }

  const allowedFlags = new Set(['--dry-run', '--skip-config', ...(BOTS[bot].extraFlags || [])]);
  const passthrough = flags.filter((f) => allowedFlags.has(f));
  if (keepPerms && bot !== 'caps') console.log('⚠ --keep-perms só se aplica ao CAPS; ignorado.');
  if (skipConfig && bot === 'ambos') console.log('ℹ organize-official-discord.js sempre atualiza os configs (sem --skip-config).');
  const childArgs = [scriptPath, guildId, ...passthrough];
  // organize-official-discord.js não tem --skip-config/--keep-perms; passa só --dry-run.
  const finalArgs = bot === 'ambos' ? [scriptPath, guildId, ...(dryRun ? ['--dry-run'] : [])] : childArgs;

  console.log('\n============================================');
  console.log(` Instalando: ${bot.toUpperCase()}  (${BOTS[bot].label})`);
  console.log(` Servidor:   ${guildId}`);
  console.log(` Padrão:    ${bot === 'caps' ? 'server-pattern.json do CAPS' : bot === 'lcl' ? 'server-pattern.json do LCL' : 'CAPS + LCL combinados'}`);
  console.log(` Comando:   node ${path.basename(finalArgs[0])} ${finalArgs.slice(1).join(' ')}`);
  console.log(` Pasta:      ${cwd}`);
  console.log('============================================\n');

  const result = spawnSync(process.execPath, finalArgs, { cwd, stdio: 'inherit' });
  if (result.error) {
    console.error(`\n❌ Falha ao executar: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n❌ Instalação terminou com erro (código ${result.status}). Nada foi reiniciado.`);
    process.exit(result.status || 1);
  }

  console.log('\n✅ Padrão aplicado! Próximos passos:');
  if (bot !== 'ambos') console.log('   ⚠ Servidor compartilhado? Rode "ambos" em seguida para não dessincronizar o config do outro bot.');
  if (bot === 'caps' || bot === 'ambos') console.log('   pm2 restart caps-bot --update-env   (ou caps-bot-teste)');
  if (bot === 'lcl' || bot === 'ambos') console.log('   pm2 restart lcl-bot --update-env');
  console.log('   Teste no servidor: /ping, !fila, !entrar (CAPS) / !desafiar (LCL)');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Falha no instalador:', err.message);
    process.exit(1);
  });
}

module.exports = { isValidGuildId, normalizeBotChoice, resolveLclDir };
