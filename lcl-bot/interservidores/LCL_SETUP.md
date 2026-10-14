# 🤖 Bot LCL — Liga Clandestina de LoL

Bot dedicado ao modo inter-servidores (N x J na CAPS ARENA). Mesmo código do CAPS BOT,
rodando como aplicativo/processo separado, com token e banco próprios.

## 1. Criar o aplicativo (no Portal do Discord)

1. Acesse https://discord.com/developers/applications → **New Application** → nome: `LCL - Liga Clandestina de LoL`.
2. **Bot** → Reset Token → copie o token (guarde no `.env`, nunca commite).
3. **Privileged Intents:** ligue `Server Members`, `Message Content` e `Presence` (se pedida).
4. **OAuth2 → URL Generator:** scopes `bot` + `applications.commands`; permissões:
   Gerenciar Canais, Criar Convite, Mover Membros, Enviar Mensagens, Inserir Links,
   Gerenciar Mensagens, Ler Histórico, Conectar, Falar em voz.
5. Autorize o bot nos 3 servidores (N, J e ARENA) com conta que tenha Gerenciar Servidor.

## 2. Instalar o código (padrão do projeto: 1 pasta por ambiente)

```powershell
# copiar a pasta do bot (sem node_modules/.git/.env)
Copy-Item "CAPS BOT TESTRE" "LCL BOT" -Recurse -Exclude node_modules,.git
cd "LCL BOT"
npm install
```

## 3. Configurar o `.env` do LCL

```
DISCORD_TOKEN=cole_o_token_do_LCL_aqui
RIOT_API_KEY=mesma_ou_nova_key
MONGODB_DB=lcl-bot
ADMIN_PORT=3031
```

Banco próprio (`lcl-bot`) = ranking inter e buscas isolados dos outros bots.

## 4. Rodar o setup padrão LCL + conferir o `config.json`

```powershell
node setup-servidor.js <GUILD_ID> --dry-run   # sempre primeiro: só mostra o plano
node setup-servidor.js <GUILD_ID>              # cria: categoria 🔥・LCL + 4 textos + voz clandestina na FILA
pm2 restart lcl-bot --update-env
```

O setup (fonte: `server-pattern.json` v1) cria de forma idempotente:
- Voz `🔥・lobby-clandestino LCL` (limite 5, só Jogador/Capitão/Staff) na categoria **FILA** — mesma dos bots CAPS; reusa se já existir ( inclusive pelo nome antigo `Lobby Clandestino`).
- Textos separados na categoria **🔥・LCL**: `🔥・fila-lcl`, `⚔️・partidas-lcl`, `📋・resultados-lcl`, `🥇・ranking-lcl`.
- Grava no `config.json` (com backup): voz + textos + `inter.inviteChannelId`/`announceChannelId` (partidas-lcl) + `inter.rankChannelId` (ranking-lcl). **`inter.arenaGuildId` NÃO é alterado** — confira manualmente.

Ajustes ainda manuais no `config.json` do LCL:
- `allowedGuildIds`: IDs de N, J e ARENA.
- `inter.arenaGuildId`: ID da CAPS ARENA.
- `roles.captainRoleId`: cargo Capitão da liga (o setup já grava se o cargo existir).
- Demais IDs (voz/texto internos) podem apontar para canais da ARENA ou ficar vazios
  (o inter cria as salas na hora; a fila interna não será usada no LCL).

## 5. Subir no PM2 (processo separado)

```powershell
pm2 start index.js --name lcl-bot
pm2 save
```

Regra de ouro: **1 processo por token**. Nunca rode `node index.js` solto junto do PM2.

## 6. Criar o admin do painel

```powershell
node admin/create-admin.js <usuario> admin
npm run admin:start
```

## 7. Testar

1. `/desafiar` ou `!desafiar TimeN MD1 @j1 @j2 @j3 @j4 @j5` em N.
2. `!desafiar TimeJ MD1 @k1 @k2 @k3 @k4 @k5` em J.
3. Match na ARENA + convite por DM → `!resultado-inter 1 AZUL` → `!inter-ranking`.
