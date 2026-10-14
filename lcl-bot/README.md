# LCL BOT — Liga Clandestina de LoL

Bot dedicado ao modo inter-servidores: times de 5 fixos de servidores diferentes se desafiam na **CAPS ARENA** (servidor neutro). Série **MD1** ou **MD3**, ranking inter separado, W.O. para ausência.

## Comandos (só Capitão/Staff opera)

- `!desafiar <nome> MD1 @j1 @j2 @j3 @j4` — busca adversário (sem menções, usa os 5 da call clandestina)
- `!desafiar-cancelar` — sai da busca
- `!resultado-inter 1 AZUL` — lança o vencedor do jogo
- `!wo` — aplica W.O.
- `!inter-ranking` / `!inter-historico` — consultas (todos)

## Fila clandestina

Entre na call `🔥・lobby-clandestino LCL` e clique em **Entrar Queue LCL** na `🔥・fila-lcl`. Com 5/5, o Capitão roda o `!desafiar`.

## Configuração

1. `.env` com `DISCORD_TOKEN`, `MONGODB_DB=lcl-bot` (e `ADMIN_PORT=3031` p/ o painel)
2. `node setup-servidor.js <GUILD_ID> --dry-run` primeiro, depois sem a flag (cria padrão `server-pattern.json` v1 + grava `inter.*` no `config.json`)
3. `npm install` + `pm2 start index.js --name lcl-bot`

Detalhes: `interservidores/` (`README.md`, `COMANDOS.md`, `PASSO_A_PASSO.md`, `LCL_SETUP.md`, `PLANO.md`).

## Execução

```bash
npm install
npm test
pm2 start index.js --name lcl-bot
```
