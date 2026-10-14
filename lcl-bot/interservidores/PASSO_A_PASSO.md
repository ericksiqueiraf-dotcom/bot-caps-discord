# ⚔️ INTERSERVIDORES — Passo a passo completo

Do zero ao teste: implementação, instalação nos servidores, configuração, permissões e roteiro de teste.

## ETAPA 1 — Implementação (já pronta ✅)

O módulo já está implementado nesta pasta do bot:

1. **Regras** em `domain/inter/series.js` (MD1/MD3, 5 fixos, lados, pontos, W.O.).
2. **Casos de uso** em `application/use-cases/inter/` (busca FIFO, resultado, ranking separado).
3. **Invites** em `services/inviteService.js` (criados só no match pronto).
4. **Comandos** texto + slash em `commands/handlers/interCommandHandlers.js`, `commands/legacyCommands.js`, `index.js`.
5. **Banco** com docs `interBusca/interMatches/interRanking` em `services/dataService.js`.
6. **Testes:** `npm test` → 80/80 (20 do inter).

Para atualizar o bot rodando: `pm2 restart caps-bot-teste` (teste) ou `pm2 restart caps-bot` (produção). Nunca dois processos no mesmo token.

## ETAPA 2 — Instalar o bot nos 3 servidores

1. Acesse o Discord Developer Portal → seu aplicativo → **OAuth2 → URL Generator**.
2. Marque os scopes **`bot`** e **`applications.commands`**.
3. Marque as permissões do bot: **Gerenciar Canais**, **Criar Convite**, **Mover Membros**, **Enviar Mensagens**, **Inserir Links**, **Gerenciar Mensagens**, **Ler Histórico**, **Conectar/Falar em voz**.
4. Abra a URL gerada e autorize o **mesmo bot** nos 3 servidores: **N**, **J** e **CAPS ARENA** (quem autoriza precisa ter permissão Gerenciar Servidor em cada um).
5. Confira: bot online nos 3 + comandos `/desafiar`, `/resultado-inter`, `/wo-inter`, `/inter-ranking` visíveis (registrados ao ligar; se a guild já tinha o bot, reinicie o processo).
6. Dê ao bot um cargo acima dos cargos de time/jogador se for mover membros na ARENA.

> Não crie outro token, outro processo nem outro banco para N/J: é **um bot, um banco** que enxerga os dois lados.

## ETAPA 3 — Configurar (`config.json → inter`)

```json
"inter": {
  "arenaGuildId": "<ID da CAPS ARENA>",
  "inviteChannelId": "<canal de texto da ARENA p/ criar convites>",
  "announceChannelId": "<canal de anúncio da ARENA>",
  "buscaExpiryMinutes": 30,
  "woTimeoutMinutes": 15,
  "md1WinPoints": 3,
  "md3SeriesPoints": 5,
  "md3GamePoint": 1
}
```

- `allowedGuildIds` precisa conter os IDs de **N, J e ARENA** (ou lista vazia = todas).
- Reinicie o bot após editar o `config.json`.

## ETAPA 4 — Preparar os times

1. Cada time define **nome** (ex. `TimeN`) e **5 jogadores fixos**.
2. Cada servidor dá o cargo **Capitão** (ou Staff) a quem vai operar (`config.roles.captainRoleId`).
3. Opcional: os 5 entram na mesma call de voz — aí o `!desafiar` dispensa menções.

## Dashboard admin v1 (`npm run admin:start`, porta 3030)

- Login local: crie o usuário **no servidor** com `node admin/create-admin.js <usuario> [admin|viewer]` (só hash é gravado).
- Temas claro/escuro no topo; leitura: filas, partidas, buscas inter, séries, ranking inter, guilds com shared.
- Ação: cancelar busca inter (só `admin`; `viewer` só lê).

## ETAPA 5 — Criar a partida (roteiro MD1)

1. **No servidor N**, o capitão: `!desafiar MD1 TimeN @p2 @p3 @p4 @p5` → resposta: busca posição 1.
2. **No servidor J**, o capitão: `!desafiar MD1 TimeJ @p6 @p7 @p8 @p9` → resposta: **MATCH FORMADO**.
3. O bot cria na ARENA: categoria `⚔️ INTER TimeN vs TimeJ`, texto do confronto e vozes `🔵 TimeN` / `🔴 TimeJ`.
4. O bot envia o **convite por DM aos 10** e anuncia nos servidores (DM fechada → link na menção pública).
5. Times entram na ARENA e jogam a personalizada no LoL.
6. Capitão (de N, J ou ARENA): `!resultado-inter 1 AZUL` → série fechada, ranking atualizado, salas apagadas.
7. Confira: `!inter-ranking` e `!inter-historico`.

## ETAPA 6 — Testar MD3 e W.O.

1. Repita a busca com `MD3`: Jogo 1 no lado sorteado → `!resultado-inter 1 AZUL`.
2. Jogo 2 com lados **invertidos** → `!resultado-inter 2 VERM` (exemplo).
3. Se 1-1: o bot libera o Jogo 3 com **lados sorteados** → `!resultado-inter 3 AZUL`.
4. W.O.: com série aberta, `!wo` (ausente = outro time) → fecha para o presente.
5. Erros comuns: jogador em fila/partida (`!sair` antes), call com ≠5 pessoas, autor fora da call, DM fechada (usar o link público).

## Solução de problemas

| Sintoma | Causa provável | Ação |
|---|---|---|
| Comando ignorado no servidor | guild fora de `allowedGuildIds` | incluir o ID e reiniciar |
| Slash não aparece | registro falhou | ver log PM2 (`pm2 logs`), reiniciar |
| "Não consegui gerar o convite" | sem permissão Criar Convite | liberar no canal da ARENA |
| "está em partida/fila" | jogador ocupado | `!sair` / `!desafiar-cancelar` |
| Salas órfãs na ARENA | falha no meio da criação | apagar manual + buscas voltam sozinhas |
| Busca sumiu | expirou (30 min) | desafiar de novo |
