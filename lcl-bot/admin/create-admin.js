// Cria usuario do dashboard admin. Rode NO SERVIDOR do bot:
//   node admin/create-admin.js <usuario> [admin|viewer]
// A senha e pedida no terminal (nao passa por argumento, nao vai p/ log).
// Nunca commite credenciais: aqui grava-se apenas o hash scrypt.
const readline = require('readline');
const { createUser } = require('./auth');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const username = process.argv[2];
  const role = process.argv[3] === 'admin' ? 'admin' : 'viewer';
  if (!username) {
    console.error('Uso: node admin/create-admin.js <usuario> [admin|viewer]');
    process.exit(1);
  }
  const password = await ask('Senha (min. 8 caracteres): ');
  const confirm = await ask('Confirme a senha: ');
  if (password !== confirm) {
    console.error('Senhas diferentes. Abortado.');
    process.exit(1);
  }
  try {
    const created = await createUser(username, password, role);
    console.log(`OK: usuario "${created.username}" (${created.role}) criado.`);
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  }
}

main();
