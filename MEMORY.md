# MEMORY — BOT CAPS DISCORD

> Arquivo de memória persistente para sessões com IA.
> Atualizar ao início e ao fim de cada sessão de trabalho.

---

## 🗓️ Última Sessão

- **Data:** 2026-10-14 (manhã)
- **Foco:** Clube VIP com PIX validado de ponta a ponta (TESTE) + runbook de deploy na ARENA oficial
- **Status:** ✅ Validado com pagamento real (cargo automático + DM + anúncio); deploy prod documentado e pendente

---

## 📍 Ponto de Parada Atual

### Onde paramos:
Banco no MongoDB Atlas. Pós-`!vitoria` move todos para a Sala de Espera (normal ou Tier S separada). **Painel `!votar` com botões** ativo (`commands/handlers/resultVotePanel.js`: maioria 6/10, lembrete 2min, expira 5min, auto-registro sem staff). **Botões de queue do CAPS BOT no canal `fila`** ativos em painel fixo por sala, não no feed: `updateQueueDashboard()` cria/edita um embed para Sala A e só cria outro quando existir Sala B/C/D; IDs ficam em `systemMeta.queueDashboardMessageIds`; mensagens de feed (`postQueueFeedMessage`) voltaram a ser texto puro. Botões: **Entrar Queue CAPS** (`queue:classic:join` → `!entrar`) e **Entrar Queue ARAM** (`queue:aram:join` → `!entrar aram`); Tier S continua decidido pela call/gate existente. `index.js` atualiza o painel fixo no boot via `updateQueueDashboard()`, então após restart/deploy o botão volta sozinho. **Trava 3min no `!entrar`** pós-vitória por fila até sair a `!roleta` (`enterQueue.js: getPendingRouletteEntries`). **Espera Tier S própria** (`!esperatiers`, chave `classic:5x5:s`) + **Sala de Espera Tier S** (`getPostMatchVoiceChannelId(mode,tier)`). **`!pdl @jogador ±valor`** (Admin, ±500, `application/use-cases/adjustPdl.js`, sem tocar W/L) + slash `/pdl`. **`!toprankinfernal`** (ranking por `infernalCount`, zerado por temporada). **Setup multi-servidor:** `setup-servidor.js` fix `msg.pins()` → `msg.pin()` + `fetchPinned()` → `fetchPins()`; rodado em `CAPS TESTE (1558218740875796560)` e `CAPS BOT TESTRE (1558217291123138561)`; `config.json` atual aponta p/ TESTRE (backups `config.json.bak-*`). **Limite 5x5 corrigido:** `getVoteThreshold` 5 → 6 (maioria real dos 10). Suite em **63/63**. Commit salvo: `3687829 feat: add vote panel, pdl and server setup`. Bot `CAPS BOT LOL#6241` (`1487258474810183711`), invite com `permissions=8`. Extração do `legacyCommands.js` segue pendente.

### Próximo passo imediato:
- **Modelo salvo:** layout oficial do CAPS ARENA em `docs/SERVER_LAYOUT_CAPS_ARENA.md` (6 categorias, 13 TXT + 9 VOZ mapeados p/ `config.json`, hierarquia de cargos) — pronto p/ replicar no TESTRE
- **Deploy teste × prod (2026-10-10):** TESTRE = pasta `CAPS BOT TESTRE` → guild `CAPS BOT TESTE (1558217291123138561)` → banco `caps-bot-teste` (`MONGODB_DB`) → PM2 `caps-bot-teste` (online, cwd correto); PROD = pasta `BOT CAPS DISCORD` → guild `CAPS ARENA (1273653944169660427)` → banco `caps-bot` (default) → PM2 `caps-bot` (online); tokens diferentes (hashes distintos); `dataService.js` usa `process.env.MONGODB_DB || 'caps-bot'` nas duas pastas; `.gitignore` prod com `.env.bak*` + `*.bak*`; NUNCA dois processos com o mesmo token
- **Roteiro de teste:** `!cadastrar` → botão **Entrar Queue CAPS** ou `!entrar` → `!votar` (botões) → MVP → `!roleta` → `!placar`; conferir `🎮・fila`, `⚔️・partidas`, `📋┃resultados`, `🔥┃destaques`
- Testar em TESTRE: `!cadastrar Nick#TAG` → `!entrar` → `!votar 1` (botões) → `!roleta N A` → `!esperatiers` → `!pdl`
- Continuar extração de lógica de negócio do `legacyCommands.js`

---

## ✅ O que já foi feito

### Modularização
- [x] `commands/handlers/matchCommandHandlers.js` — extraído
- [x] `commands/handlers/queueCommandHandlers.js` — extraído
- [x] `commands/handlers/victoryCommandHandlers.js` — extraído
- [x] `application/use-cases/enterQueue.js`
- [x] `application/use-cases/startMatch.js`
- [x] `application/use-cases/registerVictory.js`
- [x] `application/use-cases/resetSystem.js`
- [x] `application/use-cases/cancelActiveMatch.js`
- [x] `application/use-cases/castVictoryVote.js`

### Domínio
- [x] `domain/constants/queueModes.js`
- [x] `domain/constants/queueFormats.js`
- [x] `domain/queue/selection.js`
- [x] `domain/ranking/playerStats.js`

### Infraestrutura
- [x] MongoDB local via Docker (`caps-mongo`, `mongodb://localhost:27017/caps-bot`) como banco principal
- [x] Fallback JSON local em `database/` (sincronizado com o Mongo)
- [x] `services/dataService.js` com lock em memória
- [x] `services/riotService.js` com cache em memória (1h)
- [x] `services/balanceService.js`: balanceamento só pelo elo LoL (`getBalanceWeight` = `baseMmr`); pontos custom `1000 + W/L` só visuais
- [x] `workers/` pasta criada (sem worker ativo ainda)
- [x] `Ativar Bot.bat` com `restart --update-env` (reinicia mesmo se já ativo e recarrega o `.env`)
- [x] Backups em `backups/` (ZIP do código + export JSON do Mongo) — ver "Backup e recuperação"

### Comandos com fluxo isolado em handlers/use-cases
- [x] `!entrar`
- [x] `!start`
- [x] `!vitoria`
- [x] `!votar`
- [x] `!reset`
- [x] `!cancelarstart`
- [x] `!rematch` (consertado em 2026-09-30: lia `recentVictory.match` que nunca era salvo; agora `!vitoria` salva `teamOne/teamTwo` e o rematch recria a sala com pesos de balance)
- [x] `!rematch <letra>` (2026-09-30: `!rematch A/B/C` mira a sala certa via `recentVictories` (últimas 5, janela 2 min); sem letra mantém último resultado; helper `findRecentVictoryByLetter` exportado e testado)
- [x] `!rematch` = rebalance rápido (2026-09-30: NÃO é revanche fixa; os 10 voltam pra fila e, se completar, os times são remontados por elo e a partida inicia na hora, sem contagem; se faltar gente, avisa quantos faltam)
- [x] `!cancelarstart <letra>` (2026-09-30: `!cancelarstart A/B/C` cancela a contagem de auto-start do lobby cheio (jogadores ficam na fila); sem letra só resolve com pendente único; sem pendente cai no cancelamento de partida ativa + limpa timer residual; helper `findPendingAutoStartLobby` exportado e testado)

### Testes automatizados
- [x] `tests/` com `node:test` nativo (`npm test`): 63/63 verdes (suite 2026-10-13: botões de queue + `result-vote-panel` + `pdl` + anteriores)
- [x] `tests/result-vote-panel.test.js` — painel `!votar`: maioria 6/10, parse `votewin:<matchId>:<time>`, faltantes, payload dentro de 1024 chars, contagem
- [x] `tests/pdl.test.js` — `!pdl`: aplica ± sem tocar W/L, piso zero, teto 500, jogador inexistente falha
- [x] `!limparsalas A/B/C` (2026-09-30: filtra a sala pela letra; move ocupantes pra Sala de Espera antes de apagar; mutação sob lock; recusa com partida ativa; sem letra limpa tudo como antes; helper `resolveCleanupTargets` exportado e testado)
- [x] `!ajuda` atualizado (2026-09-30: documenta `!rematch [sala]`, `!cancelarstart [sala]`, `!limparsalas [sala]`, votação de MVP e cargo INFERNAL)
- [x] Mocks em memória com semântica fiel ao banco (load = clone, save = sobrescreve)

### Anúncios pós-partida
- [x] `postInfernalAnnouncement`: embed 🔥 no canal do MVP quando alguém conquista o INFERNAL (5+ streak, validade até 08h); `syncInfernalRolesAfterMatch` retorna os recém-premiados

### Fila de espera
- [x] `!espera` e `/espera` inscrevem jogadores na espera da próxima partida e mostram a ordem de entrada (`joinedAt`)
- [x] `!espera ver` consulta a ordem sem se inscrever; `!espera sair` ou `!sair` removem o jogador da espera
- [x] A espera é persistida separadamente das salas de `!entrar`, por modo e formato, com filtros como `!fila aram 2x2`
- [x] Jogadores são removidos da espera ao entrar em uma sala normal; os resets administrativos também limpam a espera
- [x] `!entrar` respeita a ordem: enquanto houver espera, somente o primeiro jogador pode ocupar a próxima vaga
- [x] `!fila` preservado como consulta dos jogadores que usaram `!entrar`
- [x] Registro do comando slash e ajuda atualizados

### Pontuação e balanceamento
- [x] Seed inicial: `1000 + MMR do elo Solo/Duo cadastrado` (`calculateSeedRating`); pontos puros começam em **1000** para todos (`customScore = internalRating - baseMmr`)
- [x] Snake draft usa **só o elo do LoL** (`baseMmr` via `getBalanceWeight`); pontos custom NÃO influenciam os times
- [x] Vitória/derrota altera `internalRating` via Elo (pontuação visual); mudança de elo LoL ajusta a parte de ranked sem mexer no `customScore` (soma espelhada em `internalRating` + `baseMmr`)
- [x] Stats antigas (seed 1000 sem LoL) migram com `ratingVersion: 2`
- [x] `!perfil`: Elo LoL e Pontos Custom separados; custom começa em **1000** (sobe/desce com as personalizadas)
- [x] Embed "Times Balanceados" mostra "Elo total / Diferenca de Elo"
- [x] TOP RANK CLASSIC (2026-10-01, `domain/ranking/playerStats.js`): `getPureCustomScore()` + `customScore` no ranking; **só CLASSIC** ordena por `pontos puros → winrate → total de jogos → vitórias`; ARAM e demais mantêm `vitórias → derrotas → MMR`. `!placar` / `!top10` no CLASSIC exibem os pontos puros. Nenhum comando novo criado; `!ajuda` atualizado só no texto (`!placar`/`!top10` CLASSIC = pontos custom, desempate winrate)

### Lobby TIER S e rankings filtrados (2026-10-05)
- [x] Canal `Lobby TIER S` (`1556124976359415919`) com gate Esmeralda IV+ (elo Riot ou cargo); Classic normal segue aberto; Tier S joga nos dois
- [x] `!top10 tiers` / `!placar tiers` (mesmo PDL, filtro `baseMmr >= 2000`) + opções `CLASSIC TIER S` nos slash
- [x] `!entrar` exige canal de voz Lobby (Classic/TIER S/ARAM); Sala de Espera não vale

### INFERNAL com validade até 08h + prioridades (2026-10-05)
- [x] Derrota não tira na hora; expira às 08h (scheduler + boot + `!sync infernal`); reconciliação com `members.fetch()` e alerta de hierarquia
- [x] `!espera` com INFERNAL na posição 5 (🔥); `!entrar` libera INFERNAL no top5; `!remover` protege INFERNAL (só Admin tira)

### Roleta + docs (2026-10-05)
- [x] `!roleta N A` instantânea (anti-duplo por partida, anúncio no canal fila) + `!roletasair A` (opt-out, inclui winners)
- [x] `!regras` (jogadores) + `!staff` (restrito) + alias `!iniciarseason`; regulamento e JSON da imagem em `ALTERAÇÕES BOT.txt`
- [x] Testes 40/40 (`tiers-roulette`, `rules`); Temporada Oficial #1 aberta (`!resetgeral` → `!iniciartemporada`)

### Votação com botões + trava + Tier S separado + PDL + setup (2026-10-09/10)
- [x] `commands/handlers/resultVotePanel.js` (novo): `!votar 1/2` publica painel com botões Time 1 / Time 2 no matchOngoing, menciona quem falta; placar atualiza por voto; lembrete 2min; expira 5min; maioria (6 no 5x5) registra sozinha via `onThresholdReached`; `!votar` sem número reabre; só participantes votam
- [x] `index.js` + `legacyCommands.js`: handler `votewin:<matchId>:<time>`; `createVotePanelDeps()`; `getVoteThreshold` 5x5 corrigido 5 → 6
- [x] Trava 3min no `!entrar` (`enterQueue.js`): mesma mode/format/tier com `recentVictories` sem `roletaHistory` retorna `roulette_pending`
- [x] `!esperatiers` (+ slash): espera Tier S (`classic:5x5:s`); sair sai de qualquer lista; Sala de Espera Tier S separada (`getPostMatchVoiceChannelId(mode,tier)`)
- [x] `!pdl @jogador ±valor` + `/pdl` (Admin, ±500, `adjustPdl.js`): sem tocar W/L, auditoria no log; documentado em `!regras`/`!staff`
- [x] `!toprankinfernal`: top 10 por `infernalCount` (só nova conquista conta; reset por temporada zera)
- [x] Comunicado votação com botões + fluxo `!votar` em `ALTERAÇÕES BOT.txt`
- [x] `setup-servidor.js` (novo, idempotente): 8 cargos + 6 categorias + 14 textos + 6 vozes; fix `msg.pin()`/`fetchPins()`; aplicado em CAPS TESTE e CAPS BOT TESTRE; `config.json` atual = TESTRE

### Backup e recuperação
- [x] Pasta `backups/` na raiz do projeto
- [x] `backups/codigo-2026-09-30-1215.zip` (4,48 MB, 80 arquivos: código + `.env` + `database/` + `MEMORY.md`, sem `node_modules`/`.git`)
- [x] `backups/mongo-data-2026-09-30-1515.json` (export da collection `data`: 135 jogadores, 1 partida ativa, 3 temporadas)
- [x] `backups/codigo-2026-09-30-1328.zip` + `backups/mongo-data-2026-09-30-1628.json` (pós testes/INFERNAL/rematch: 135 jogadores, 0 partidas ativas, 3 temporadas)
- [x] `backups/codigo-2026-09-30-1456.zip` + `backups/mongo-data-2026-09-30-1756.json` (pós `!rematch <letra>`: 139 jogadores, 2 partidas ativas, 3 temporadas)
- [x] `backups/codigo-2026-09-30-1500.zip` + `backups/mongo-data-2026-09-30-1800.json` (pós `!cancelarstart <letra>`: 139 jogadores, 2 partidas ativas, 3 temporadas)
- [x] `backups/codigo-2026-09-30-1504.zip` + `backups/mongo-data-2026-09-30-1804.json` (pós `!rematch` rebalance: 139 jogadores, 2 partidas ativas, 3 temporadas)
- [x] `backups/codigo-2026-09-30-1512.zip` + `backups/mongo-data-2026-09-30-1812.json` (pós `!limparsalas` por letra: 140 jogadores, 1 lobby, 1 partida ativa, 3 temporadas)
- [x] `backups/codigo-2026-09-30-1516.zip` + `backups/mongo-data-2026-09-30-1816.json` (pós `!ajuda` atualizado: 140 jogadores, 1 lobby, 1 partida ativa, 3 temporadas)
- [x] `database/playerStats.backup-2026-09-30.json` (pré-migração `nickname` → `registeredNickname`)
- [x] Como restaurar o banco: `node migrateToMongo.js` (sobe `database/` p/ o Mongo) com `caps-mongo` rodando; como restaurar o código: extrair o ZIP por cima
- [x] `mongodump` não instalado — export via script Node (`backup-mongo-temp.js`, removido após uso); refazer quando precisar

### Alerta de smurf
- [x] Bot **não detecta conta main** automaticamente. Smurf = staff (`!nick` da main ou Base MMR no admin)
- [x] Após `!vitoria`, alerta se Ferro/Bronze/Prata (`baseMmr < 1200`), **5+ jogos** e **WR ≥ 70%**
- [x] Cooldown **6 horas** por jogador/modo; `postSmurfAlerts` em `utils/lobbyUtils.js`
- [x] Canal: `config.textChannels.smurfAlertChannelId` (se vazio, usa season log)
- [x] Recurso ativo no PM2 (`caps-bot` reiniciado em 2026-09-29)

### Cargos de elo no Discord
- [x] `!sincronizarelo @jogador` atualiza Riot + cargo e **responde se o cargo falhou** (hierarquia, cargo inexistente, etc.)
- [x] `!sync` / `/sincronizar-cargos` só aplica cargos com o elo **já salvo** (não chama a Riot)
- [x] `!sincronizartodos` / `!sync todos` / `/sincronizartodos` atualiza elo Riot + cargo de todos (delay 2,5s, Admin)
- [x] Aliases: `!sicronizartodos`, `!sincronizatodos`, `!atualizartodos`, `!atualizarelos`
- [x] Sync não é mais silencioso; remove cargos de elo com nome parecido (ex. `Ouro` vs `🥇Ouro`)
- [x] Mapa atual: Esmeralda → `Esmeralda`; Mestre → `Mestre`; Grão-Mestre → `Grão Mestre`
- [x] Cargo do bot precisa ficar **acima** dos cargos de elo

---

## 🔲 O que ainda falta fazer

### Alta prioridade
- [ ] Terminar extração do `legacyCommands.js` — ainda está grande e mistura responsabilidades
- [ ] Separar `lobbyUtils.js` em módulos menores (embed, domínio, canais, ranking, histórico)
- [ ] Mapear quais comandos ainda vivem só no `legacyCommands.js` (ex: `!lista`, `!placar`, `!top10`, `!topstreak`, `!perfil`, `!sync`, `!onboarding`, `!resetgeral`)

### Médio prazo
- [ ] Implementar lock distribuído (Redis ou Mongo-based lease) — atualmente só funciona com 1 instância
- [ ] Mover `pendingAutoStarts` (Map em memória) para persistência durável
- [ ] Criar worker separado para jobs lentos (auto-start, limpeza, ranking)

### Riot API
- [ ] Rate limiter real
- [ ] Fila de requisições
- [ ] Retry com backoff exponencial
- [ ] Circuit breaker para indisponibilidade da Riot API

### Qualidade
- [ ] Testes automatizados para: ranking, streak, auto-start, vitória concorrente, parse de comandos
- [ ] Logging estruturado por comando e por match
- [ ] IDs de correlação por partida/lobby

### Infraestrutura futura (médio/longo prazo)
- [ ] `bot-gateway` separado
- [ ] `matchmaking-api` separado
- [ ] `riot-worker` separado
- [ ] Redis para locks e debounce

---

## 🐛 Problemas Conhecidos / Débitos Técnicos

| Problema | Arquivo | Impacto |
|---|---|---|
| `withQueueOperationLock` usa Map em memória | `services/dataService.js` | Não funciona com múltiplas instâncias |
| `pendingAutoStarts` em memória | `commands/legacyCommands.js` | Perde estado ao reiniciar |
| `legacyCommands.js` muito grande | `commands/legacyCommands.js` | Dificulta manutenção |
| `lobbyUtils.js` concentra muita lógica | `utils/lobbyUtils.js` | Acoplamento alto |
| Sem rate limit real na Riot API | `services/riotService.js` | Vulnerável a 429 em picos |

---

## 🏗️ Arquitetura Resumida

```
index.js                     ← entrada, Discord client, eventos
commands/
  legacyCommands.js          ← ainda grande, em refatoração
  handlers/                  ← handlers limpos já extraídos
application/use-cases/       ← orquestração de casos de uso
domain/                      ← constantes, regras puras
services/                    ← persistência, Riot API, balanço
utils/lobbyUtils.js          ← utilitários (refatoração pendente)
workers/                     ← vazio — espaço reservado para jobs futuros
database/                    ← fallback JSON local
```

---

## 📝 Notas de Sessão

### 2026-09-24
- Arquivo MEMORY.md criado para rastreamento de progresso
- Contexto inicial carregado do `PROJECT_CONTEXT.md`
- Projeto em Node.js + discord.js + MongoDB Atlas
- Stack: `discord.js`, `axios`, `dotenv`, `mongodb`, `express`, `ejs`
- Bot para custom games de LoL: Classic + ARAM (1x1 até 5x5)
- **Calibração de pesos MMR** em `services/balanceService.js`:
  - Fator de compressão: `0.25` → `0.30`
  - Teto de seed rating: `1400` → `1700`
  - Motivo: Diamante / Mestre / Grão-Mestre / Challenger recebiam o mesmo MMR inicial (1400). Com o novo calibre, Mestre começa em ≈1540, Grão-Mestre ≈1660 e Challenger ≈1700.
  - Impacto: o Snake Draft agora reconhece a diferença real de nível e distribui os jogadores com mais equidade quando há 1 high-elo isolado na sala.

### 2026-09-24 — Fila de espera
- `!fila` foi preservado como consulta da fila de jogo. O novo comando de espera é `!espera` e `/espera`.
- `!espera` inscreve o jogador em uma lista de espera independente para a próxima partida; `!espera ver` consulta a ordem sem alterar a posição e `!espera sair` remove o jogador. A ordem usa `joinedAt`, portanto o primeiro a entrar aparece primeiro.
- A lista fica em `queue.waitingLists`, é separada das salas de `!entrar` e é removida automaticamente quando o jogador entra em uma sala normal.
- A prioridade é aplicada na entrada: com jogadores aguardando, `!entrar` bloqueia quem não estiver na primeira posição da lista.
- Arquivos alterados: `commands/legacyCommands.js`, `services/dataService.js`, `application/use-cases/enterQueue.js`, `application/use-cases/startMatch.js`, `application/use-cases/resetSystem.js` e `index.js`.
- Validação: checagem de sintaxe e teste isolado da prioridade da posição 2; bot reiniciado no PM2 e ficou online.

### 2026-09-25 — Ativação manual
- Criado `Ativar Bot.bat` na raiz do projeto para iniciar o `caps-bot` pelo PM2 ao receber dois cliques.

### 2026-09-30 — Pós-partida, INFERNAL e MVP
- **`commands/handlers/victoryCommandHandlers.js`**: pós-`!vitoria` agora move winners+losers para `getPostMatchVoiceChannelId()` = Sala de Espera `1490385246775017572` (antes: lobby base da fila). Chama `syncInfernalRolesAfterMatch(guild, winners, losers)` e `startMvpVote(guild, match, winners, losers)`; MVP automático por rating removido do fluxo.
- **`utils/lobbyUtils.js`**: `finalizeMvpVote` ganhou fallback `pickAutomaticMvp()` (maior `ratingDelta` do time vencedor) quando ninguém vota; embed do resultado diferencia voto x automático.
- **`index.js`**: handler de `StringSelectMenu` `mvpvote:*` → `handleMvpVoteInteraction`; `ready` agora chama `resumePendingMvpVotes()` + `expireInfernalRolesIfDue()` por guild.
- **INFERNAL**: `INFERNAL_STREAK = 5`, expira às 08h SP (`getNextEightAmSaoPauloIso`), sai na derrota, expiração diária no scheduler 08h + na inicialização. Cargo criado automaticamente se não existir (`ensureInfernalRole`). `config.roles.infernalRoleName = "INFERNAL"`.
- **MVP**: votação 2 min (`MVP_VOTE_DURATION_MS`), só participantes votam, 1 voto por pessoa (pode trocar), empate desempatado por rating. Canal: `mvpAnnouncementsChannelId` (fallback match history). Cargo `MVP player` ao vencedor.
- **Banco**: Docker `caps-mongo` religado; migrados 52 jogadores no Mongo + 63 no JSON (`nickname` → `registeredNickname`); 134/134 no Mongo. `.env` de volta pra `localhost`. Fallback local sincronizado com o Mongo. Correção de código com fallback `registeredNickname || nickname` em `enterQueue.js` + `legacyCommands.js` (sincronizarelo, espera, sync todos).
- **`Ativar Bot.bat`**: agora faz `restart --update-env` (reinicia mesmo se já ativo e recarrega o `.env`).
- Bot reiniciado no PM2, online como `CAPS BOT LOL#6241 v1.8.0`, `[DB] Conectado`.
- **Balanceamento só pelo elo LoL (2026-09-30):** `services/balanceService.js` ganhou `getBalanceWeight()` = `baseMmr`; `createBalancedTeams` ordena e soma por elo, ignorando pontos custom. Embed de times mostra "Elo total / Diferenca de Elo". Pontos custom seguem só visuais (`!perfil`, `!placar`, `!top10`, `!topstreak`, dashboard, "Pontos" nos embeds). Teste: 10 jogadores mock com elo x custom invertidos → elo 6900x6900 dif 0.
- **Partidas simultâneas (2026-09-30):** teste com 2 partidas ativas (A e B) provou que `!vitoria 1 A` mira só a A (seletor por letra; sem letra e com 2 ativas não resolve sozinho = seguro). Achado e corrigido: vitórias REALMENTE simultâneas se apagavam (lock era por partida, saves do doc inteiro colidiam) → lock do `registerVictory` virou por guild (`${guildId}:victory`). `!votar` também registra o voto sob o mesmo lock e a vitória automática agora repassa a letra (`[time, letra]`) pra mirar a partida certa. 13/13 testes passaram.
- **Backup de segurança (2026-09-30):** `backups/codigo-2026-09-30-1215.zip` (código completo para restore) + `backups/mongo-data-2026-09-30-1515.json` (135 jogadores, 1 partida ativa, 3 temporadas). Bot segue online no PM2 (`caps-bot`, `CAPS BOT LOL#6241 v1.8.0`).
- **Testes + INFERNAL + rematch (2026-09-30):** criados `tests/helpers.js`, `victory-selector.test.js`, `register-victory.test.js`, `balance.test.js`, `rematch.test.js` + script `npm test` (15/15 verdes, `node:test` nativo, sem deps novas). `syncInfernalRolesAfterMatch` retorna recém-premiados; `postInfernalAnnouncement` posta 🔥 no canal do MVP; `!vitoria` chama ambos com try/catch. `!rematch` consertado: `recentVictory` agora salva `teamOne/teamTwo`, rematch cria a sala se não houver, enriquece os 10 com `baseMmr/mmr` do cadastro e roda sob lock da fila. Bot reiniciado e online.

### 2026-10-05 — TIER S + roleta instantânea + regras/staff + Temporada Oficial #1
- **Lobby TIER S:** `config.voiceChannels.classicTierSQueueChannelId = 1556124976359415919` + `config.tierS` (min 2000); gate por elo/cargo em `enterQueue.js` (staff organiza mas NÃO joga sem elo); salas `Lobby TIER S X`; `getOpenLobby` filtra por tier.
- **Top10/placar tiers:** `parseModeAndFormatArgs` aceita `tiers`; `getRankedPlayersByMode(..., {tierSOnly})` filtra `baseMmr >= 2000` (mesmo PDL); slash `/top10` e `/placar` ganharam opção `CLASSIC TIER S`. Causa do "não funciona": bot rodava código antigo no PM2 (2 dias uptime) — restart resolveu.
- **INFERNAL até 08h:** derrota não remove mais (`syncInfernalRolesAfterMatch` só registra); expira via scheduler/boot/`!sync infernal`; `reconcileInfernalRoles` com `guild.members.fetch()` + aviso de hierarquia. **Achado (caso maggot):** bot (pos 25) abaixo do INFERNAL (pos 29) → Discord recusa remover; banco zerado + cargo órfão. Pendente: admin subir o cargo do bot.
- **Prioridades:** `!espera` insere INFERNAL na posição 5 (`splice(4,0)`, marca 🔥); `!entrar` libera INFERNAL no top5; `!remover` recusa INFERNAL sem Admin.
- **Roleta:** `drawRoulette.js` (crypto) + `rouletteCommandHandlers.js`; `!roleta N A` (alias `!roletar`) sorteia na hora entre losers − INFERNAL − `!roletasair`; anti-duplo por `matchId` em `roletaHistory`; staying + winners movidos ao lobby de origem; anúncio no canal fila. `!roletasair A` (opt-out, vale p/ winners também).
- **Docs:** `!regras` (+`/regras`, aliases) e `!staff` (restrito) via `buildRulesEmbed`/`buildStaffEmbed`; regulamento + JSON da imagem de divulgação em `ALTERAÇÕES BOT.txt`.
- Validação: `npm test` 40/40 (`tiers-roulette` + `rules` novos); bot reiniciado ~13x no PM2 e online.
- `!rematch` mantido como rebalance (decisão do dono).

### 2026-10-10 — !votar com botões + trava 3min + Tier S separado + !pdl + setup teste
- **!votar com botões:** `resultVotePanel.js` novo; `!votar 1/2` abre painel em `partidas-em-andamento` marcando os 10; clique ou texto vota; placar ao vivo; lembrete 2min; expira 5min; 6 votos registram sozinho; `!votar` sem número reabre; threshold 5x5 corrigido 5 → 6
- **Trava 3min:** `enterQueue.js` bloqueia `!entrar` na mesma fila até sair a `!roleta` (`roulette_pending` com letras + segundos); por fila (Classic/ARAM/Tier S independentes)
- **Tier S separado:** `!esperatiers` + Sala de Espera Tier S própria; `getPostMatchVoiceChannelId(mode,tier)`; `!sair`/`!remover` devolvem ao lobby certo
- **!pdl + toprankinfernal:** `adjustPdl.js` (Admin, ±500, sem W/L); `infernalCount` só em nova conquista; `!toprankinfernal`
- **Setup teste:** fix `msg.pin()`/`fetchPins()` em `setup-servidor.js`; setup rodado em CAPS TESTE e CAPS BOT TESTRE; `config.json` = TESTRE (backups `.bak-*`); bot precisa de restart + hierarquia acima dos cargos
- **Layout ARENA replicado no TESTRE (2026-10-10):** modelo em `docs/SERVER_LAYOUT_CAPS_ARENA.md`; `setup-servidor.js` com planta ARENA (6 cats, 19 TXT, 11 VOZ, 11 cargos); aplicado em `CAPS BOT TESTE (1558217291123138561)`; `config.json` remapeado (fila/partidas/resultados/destaques/logs/ranking/cadastro + 3 lobbies com limite 10/10/30)
- Validação: `npm test` 49/49, 13 suites

### 2026-10-15 — Texto do !clube mais atrativo
- `buildClubeEmbed` com copy de divulgação (TESTRE + prod): chamada "Apoie a Arena, suba de nível...", tiers como "primeiro passo" / "queridinho da galera" / "topo da Arena", `!live` como "divulgar sua stream", renovação -10% no "Como aderir". Preços continuam dinâmicos do config.
- Testes do clube/regras/embeds verdes (17/17); ambos bots reiniciados e online.
- Nota: mensagem antiga fixada no `#clube-vip` não atualiza sozinha — rodar `!clube`, apagar a antiga e fixar a nova.

### 2026-10-15 — Bugs reais corrigidos + sala 2.0 (ordem 1→3→2→4)
- **1) Gate `allowedGuildIds`:** `isGuildAllowed()` novo em `utils/lobbyUtils.js` (exportado); `messageCreate` + `interactionCreate` ignoram guilds fora da lista (lista vazia = libera tudo, como antes). `tests/guild-filter.test.js` reescrito p/ a função real (4/4).
- **3) Trava level 30:** `riotService.getPlayerRankProfile` agora expõe `summonerLevel`; `getSummonerLevelGate()` (exportado) bloqueia `< config.cadastro.minSummonerLevel` no `!cadastrar` e `!nick`, com fail-open p/ level desconhecido. `tests/cadastro-main.test.js` atualizado (2/2). TESTRE + prod.
- **2) Embed do `#como-jogar`:** `buildOnboardingGuideEmbed()` + `ONBOARDING_SECTIONS` criados e exportados (TESTRE + prod); setup passa a postar o embed fixo em vez de pular. Teste restaurado p/ intenção original (título + campos + limites + nome do servidor).
- **4) Sala 2.0 (dono):** `!salalock [abrir]` (tranca Connect dos cargos, dono sempre entra; flag `locked` no registro + 🔒 no `!salahub`), `!salalimit <0-99>`, `!salaexpulsar @u` (só quem está na sala; não expulsa a si/bots). Prefixo + slash (`/salalock`, `/salalimit`, `/salaexpulsar`) + `!ajuda`. TESTRE + prod.
- Validação: suíte **146/146**; `node --check` nos 8 arquivos; ambos bots reiniciados e online.

### 2026-10-15 — Botão Esperar Fila no #fila
- 5º botão (azul): entra na espera Classic (`!espera`), com resposta privada de posição. TESTRE + prod.
- Testes atualizados (21/21); ambos bots reiniciados e online — painel do `#fila` reconstruído com os 5 botões.

### 2026-10-15 — Botão Entrar Queue TIERS no #fila
- 4º botão (cinza): exige estar no `Lobby TIER S` (avisa se não estiver); com o canal certo, chama o fluxo `!entrar` que resolve tier S sozinho (inclui gate Esmeralda IV+). TESTRE + prod.
- Testes atualizados (20/20); ambos bots reiniciados e online — painel do `#fila` reconstruído com os 4 botões.

### 2026-10-15 — Botão Sair da Fila no #fila
- `QUEUE_JOIN_BUTTON_IDS.LEAVE` (`queue:leave`) + botão vermelho "Sair da Fila" no `buildQueueJoinActionRow()`; roteado no `interactionCreate` p/ `handleLeaveCommand` (TESTRE + prod). Painel do `#fila` é reconstruído no boot, então o botão aparece sozinho após restart.
- Testes atualizados (`queue-buttons`, `queue-feed`: 20/20); ambos bots reiniciados e online.

### 2026-10-15 — !clubefixar: benefícios detalhados fixados no #clube-vip
- `buildClubeDetalEmbed()` novo em `utils/lobbyUtils.js` (TESTRE + prod): embed "benefícios detalhados" com preços dinâmicos do config + comandos de cada tier + PIX e renovação -10%.
- `!clubefixar` (só staff, prefixo + `/clubefixar`): posta no `#🔰clube-vip`, apaga fixada anterior igual e fixa a nova. `!staff` documenta o comando.
- Testes: caso novo no `clube-vip.test.js` (título, 4 campos, preços, limites); ambos bots reiniciados e online.

### 2026-10-15 — !ajuda enxuto, !staff completo
- **`!ajuda` agora é só jogador:** seções `🛠️ Staff`, `⚙️ Partida (Staff)` e `📊 Temporada` viraram 1 linha apontando p/ `!staff`. Mantidas: cadastro, fila/voto, ranking, clube VIP, salas temporárias.
- **`!staff` (`STAFF_SECTIONS`) ganhou:** `!salahub` na seção de limpeza + nova seção `💎 Clube VIP — assinaturas` (`!clubeadmin` + `!clube`). Testes usam `STAFF_SECTIONS.length` dinâmico — seguem verdes (`rules`, `info-embeds`, `clube-vip`: 15/15).
- TESTRE + prod; ambos bots reiniciados e online.

### 2026-10-15 — Sugestões aplicadas (ordem 1→4)
- **1) `!ajuda`:** nova seção `🔊 Salas temporárias` (`!salahub`/`!sala`/`!convidar`/`!limparvoz`) + `!clubeadmin` na seção Staff. TESTRE + prod.
- **2) Registro sem lixo:** auto-delete agora dá `unregisterTempRoom` (apagou ou sumiu); listener novo `channelDelete` limpa o registro quando a sala é apagada manualmente. TESTRE + prod.
- **3) Slash da sala:** `/salahub`, `/sala [nome]`, `/convidar @usuário` (obrigatório), `/limparvoz` + `/clubeadmin` registrados no `buildSlashCommands` e no `interactionCreate` (TESTRE + prod). `handleConvidarCommand` aceita `targetUserOverride` (padrão do `/remover`).
- **4) Suíte verde 140/140** (era 110/138): `temp-voice.test.js` reescrito p/ API real (hub, prefixo, permissões, registro, rename/delete/invite/list, auto-delete com unregister); outras 6 suites adaptadas à API real via subagentes (`queue-buttons`→`parseQueueJoinButtonId`, `guild-filter`, `cadastro-main`, `onboarding`, `info-embeds`→`buildStaffEmbed`, `rank-roles` com ID fake injetado).
- **Bugs reais achados pelos testes (NÃO corrigidos, fora do escopo):** `allowedGuildIds` do config não é aplicado em lugar nenhum (bot responde em qualquer guild); `cadastro.minSummonerLevel=30` é dead config (`riotService` descarta `summonerLevel`); `setup-servidor.js` importa `buildOnboardingGuideEmbed` inexistente (protegido por `typeof`, só pula o embed do `#como-jogar`).
- **5) `!clubeadmin` (só staff, prefixo + slash):** embed com assinaturas ativas por tier (`Lendário/VIP/Apoiador`), cada linha `<@user> — vence em N dias / amanhã / hoje`, ordenado por vencimento. TESTRE + prod.
- Validação: suíte 140/140; `node --check` nos 6 arquivos; ambos bots reiniciados e online.

### 2026-10-15 — Comandos de sala temporária + hub no VIP + preços do clube + anti-duplicação
- **Comandos novos (`!salahub`, `!sala`, `!convidar`, `!limparvoz`):** `services/tempVoiceService.js` ganhou registro persistente (`database/tempVoiceRooms.json`: dono por sala, sobrevive restart) + `inviteToTempRoom`/`renameTempRoom`/`deleteTempRoom`/`listTempRooms`; handlers em `commands/legacyCommands.js`, cases no `index.js`. Portado p/ produção (`BOT CAPS DISCORD`) + restart `caps-bot`/`caps-bot-teste`.
- **Bug que travava tudo:** export `handleRoletaSairCommand` vs definição `handleRouletteSairCommand` — ReferenceError em loop (92 restarts no teste, "Comando desconhecido" p/ tudo). Renomeado p/ `handleRoletaSairCommand`; boot limpo nos 2 bots.
- **Hub padrão no VIP:** `server-pattern.json` (TESTRE + prod): HUB `FILA` → `💎・CLUBE VIP`. Salas temporárias nascem na categoria do hub (`parent: hubChannel.parentId`); hub arrastado manualmente + padrão garantem as próximas no VIP. Setup é idempotente e move sozinho numa próxima rodada.
- **Preços do clube:** VIP 19,99→16,90, Lendário 29,99→21,90, Apoiador 9,99 (30 dias). `config.json` nos 2 ambientes (na prod a seção `clubePagamentos` nem existia — usava defaults e o embed não mostrava preço). `!clube` (`buildClubeEmbed`) agora mostra preço + benefícios detalhados por tier, lidos do config.
- **Anti-duplicação do anúncio do clube:** `guildMemberUpdate` dispara 2x p/ mesma mudança de cargo (Apoiador duplicado no #parceiros). Dedupe em memória 5min por `servidor:usuário:tier` nos 2 `index.js`.
- Validação: `clube-vip` 10/10, PIX/config/setup-blueprint passando; suíte geral 110/138 — 28 falhas pré-existentes em suites que referenciam APIs não implementadas (`temp-voice`, `queue-buttons`, `guild-filter`, `cadastro-main`, `onboarding`, `info-embeds`, `rank-roles`), sem relação com a sessão. Ambos bots online (`CAPS BOT LOL#6241`, `CAPS BOT TESTE#6332`).

### 2026-10-14 — Deploy clube VIP na ARENA oficial
- `MP_ACCESS_TOKEN` (prod, mesmo validado na TESTE) copiado para `.env` do CAPS; `clubePagamentos` já estava no `config.json`.
- Restart `caps-admin` + `caps-bot` (`--update-env`); boot limpo, `CAPS BOT LOL#6241` online e estável. Sem URL pública (poller de 3 min assume).
- Validação pendente: primeira compra real na ARENA (`!clube` → botões devem aparecer).
- **Incidente pós-deploy:** `caps-admin` entrou em loop (200+ restarts) — estava com script path apontando para `TESTRE/admin/app.js` (:3032), brigando pela porta com `caps-admin-teste`. Recriado no path certo (repo, :3030, HTTP 200). Mapa oficial: `caps-admin`=:3030 (repo), `caps-admin-teste`=:3032 (TESTRE), `lcl-admin`=:3031. Regra: após qualquer `pm2 start/restart`, conferir `pm2 describe` (script path + cwd).
- Fluxo completo validado com R$ 9,99 real na TESTE: `!clube` → botão → modal e-mail → QR → pagamento → cargo `💜 Apoiador` automático + DM + anúncio (`docs/DEPLOY_ARENA_OFICIAL.md` tem o passo a passo da produção).
- Infra de teste: `caps-admin-teste` na :3032 (a :3031 é do `lcl-admin`), túnel `cloudflared` → `PUBLIC_BASE_URL`, `MP_ACCESS_TOKEN` (teste e depois produção) no `.env` da TESTRE.
- Pendente: reembolso dos R$ 9,99 no MP; deploy prod (token prod no `.env` do CAPS + URL fixa + restart `caps-bot`/`caps-admin`).

### 2026-10-14 — Clube VIP com PIX (fase 1, TESTE)
- `services/clubePaymentsService.js` (novo): cria PIX no MP (`/v1/payments`, `external_reference=caps-vip:<guild>:<user>:<tier>`), webhook com anti-duplo e ignorando `sess_*` do SnapFlow, cargo via Discord REST, DM + anúncio, expiração de 30 dias (`expireVipSubscriptionsForGuild` no scheduler das 08h).
- `!clube` com botões por tier → modal de e-mail → QR PNG + copia-e-cola (efêmero); sem `MP_ACCESS_TOKEN`, mostra "em configuração".
- `admin/app.js`: `POST /webhooks/mercadopago` (com `express.json()`); `config.json`: `clubePagamentos` 9,99/19,99/29,99.
- Testes `clube-payments.test.js` (7 casos); suíte 74/74. Sync TESTRE (preservando `.env`/`config.json`/`database/`); `caps-bot-teste` + novo `caps-admin-teste` (:3032 — :3031 é do `lcl-admin`) reiniciados e online; webhook responde OK.
- Pendente p/ validar de ponta a ponta: `MP_ACCESS_TOKEN` (+`PUBLIC_BASE_URL` do túnel) no `.env` da TESTRE + `cloudflared` apontando p/ :3032.

### 2026-10-14 — LCL migrado para dentro do repo (`lcl-bot/`)
- Pasta externa `Documents/LCL BOT` movida para `lcl-bot/` no repo (125 arquivos; `node_modules` reinstalado via `npm ci`, `.bak` descartados, `.env` preservado e ignorado).
- `instalar.js` e `organize-official-discord.js` apontam p/ `lcl-bot/` (fallback p/ pasta antiga mantido).
- PM2 `lcl-bot`/`lcl-admin` recadastrados no novo path (ids 6/7), `pm2 save`, login confirmado no log. Pasta antiga removida.
- Validação: LCL 108/108 no novo path.

### 2026-10-14 — Instalador unificado + cargos padronizados com emoticons
- **`instalar.js` (novo):** `node instalar.js` interativo (pede GUILD_ID + `caps|lcl|ambos`) ou direto `node instalar.js <GUILD_ID> <bot> [--dry-run]`; `ambos` roda `organize-official-discord.js` e é o recomendado p/ servidor compartilhado (evita drift de `captainRoleId`/`visitanteRoleId` entre os 2 configs).
- **Padrão = servidor real:** `Capitão` → `👑 Capitão de Customs`, `INFERNAL` → `🔥 INFERNAL`, `MVP player` → `⭐ MVP` (nomes confirmados via API na CAPS ARENA, 37 cargos); `Staff`/`Jogador`/VIPs já coincidiam e foram mantidos. `Visitante` removido do pattern CAPS (nem CAPS nem LCL criam mais; o existente é preservado).
- **Código acompanhando:** refs `roles['👑 Capitão de Customs']` nos 3 setups; `allowedRoleNames` nos 2 configs + default do `tempVoiceService` LCL; `INFERNAL_ROLE_NAME`/`MVP_ROLE_NAMES` + fallbacks nos 2 `lobbyUtils`; `infernalRoleName`/`mvpPlayerRoleName` nos 2 configs; aviso de legados mira os nomes simples antigos (`Capitão`, `MVP player`, `INFERNAL`, `Jogador Ativo` — este com 2 membros na ARENA, migração manual pendente).
- **Bug real achado no dry-run:** `buildOnboardingGuideEmbed is not a function` quebrava o `setup-servidor.js` no meio (import sem export no `lobbyUtils`); agora pula com aviso. Dry-run na CAPS ARENA: 8/8 cargos "já existe", 0 duplicação, canais/vozes resolvidos.
- **LCL:** textos `🔥・LCL` com `talk: false` explícito (leitura p/ Jogador, operação p/ Capitão/Staff — por botão/voz); setup LCL não cria mais `Visitante`.
- Validação: CAPS 63/63, LCL 108/108; restart `caps-bot` + `lcl-bot` + `caps-bot-teste` (`--update-env`), os 3 com `Bot conectado como` no log.

### 2026-10-13 — Commit geral + botões de queue no canal fila- Commit criado: `3687829 feat: add vote panel, pdl and server setup` (pacote grande com votação por botões, PDL, setup de servidor, docs e imagens organizadas em `IMAGENS/`).
- **Botões de queue:** `utils/lobbyUtils.js` ganhou `QUEUE_JOIN_BUTTON_IDS`, `parseQueueJoinButtonId()` e `buildQueueJoinActionRow()`; `updateQueueDashboard()` envia botões **Entrar Queue CAPS** e **Entrar Queue ARAM** em painéis fixos por sala; `postQueueFeedMessage()` voltou a enviar só texto para não poluir o canal.
- **Roteamento dos botões:** `index.js` usa `parseQueueJoinButtonId()` no `interactionCreate`; `queue:classic:join` chama `handleEnterCommand(..., [])`; `queue:aram:join` chama `handleEnterCommand(..., ['aram'])`; respostas seguem ephemeral via `createInteractionContext()`.
- **Regra preservada:** o botão não burla voz/gate; `handleEnterCommandFlow()` ainda exige o canal correto (`Lobby Classic`, `Lobby TIER S` ou `Lobby ARAM`) e o gate de Tier S.
- **Testes:** `tests/queue-feed.test.js` cobre mapeamento dos botões e serialização da action row; validação `npm test` = 63/63, 15 suites.
- **+ Criar sala:** corrigido em 2026-10-13; faltava `services/tempVoiceService.js` e o listener `voiceStateUpdate` no `index.js`. Agora entrar no hub `➕・criar-sala` cria sala temporária `➕・Nome`, move o usuário, limita por `config.tempVoice.userLimit`, apaga após ficar vazia (`deleteDelaySeconds`) e respeita `allowedRoleIds/allowedRoleNames` (Capitão, Staff, VIP, Lendário/Admin). Bot reiniciado no PM2 e testes 63/63.

### 2026-10-01 — Reativação + ranking CLASSIC puro + !ajuda
- Bot estava fora do PM2 (`caps-bot doesn't exist`); religado com `pm2 start index.js --name caps-bot` + `pm2 save`. Docker `caps-mongo` subiu depois do bot e o `dataService` travou em modo local (`storageMode = 'local'` não tenta de novo); `pm2 restart caps-bot` resolveu → `[DB] Conectado ao MongoDB Atlas` + `Bot conectado como CAPS BOT LOL#6241 | v1.8.0`.
- **Ranking CLASSIC em 2 passos:** (1) pontos custom (`adjustedMmr`) + winrate, só CLASSIC; (2) correção pedida: estava usando pontos com elo LoL embutido → trocado para **pontos puros base 1000** (`getPureCustomScore = internalRating - baseMmr`, mesma conta do `getCustomDisplayScore` da ficha). Arquivos: `domain/ranking/playerStats.js` (`customScore` no entry + sort CLASSIC), `utils/lobbyUtils.js` (`buildLeaderboardEmbed`/`buildTopTenEmbed` exibem `customScore` no CLASSIC).
- Nenhum comando novo; `!ajuda` (`commands/legacyCommands.js:handleHelpCommand`) atualizado só no texto: `!perfil` = Pontos Custom + Elo, `!placar` = geral (CLASSIC = pontos custom), `!top10` = Top 10 CLASSIC por pontos custom com desempate por winrate.
- Validação: `npm test` 28/28 + script temporário (removido após uso) com empate puro 1100: `80% WR > 60% WR` na frente e elo alto (2000) com pura 1050 atrás de elo baixo (500) com pura 1100. Bot reiniciado no PM2 e online.

### 2026-09-29 — Pontuação 1000 + elo LoL
- Seed: `calculateSeedRating(baseMmr) = 1000 + MMR Solo/Duo` (Gold IV unranked continua 1200 de elo → 2200 pontos).
- O snake draft usa `player.mmr` = pontuação interna (elo + 1000 + deltas de custom), não mais só o MMR da Riot.
- Vitórias/derrotas seguem Elo (`calculateEloDelta`) em cima dessa pontuação.
- Cadastro/`!sincronizarelo`/`!entrar` aplicam mudança de elo LoL: 0 jogos reseeda; com jogos soma a diferença de `baseMmr`.
- Migração `ratingVersion: 2`: ratings antigos que começavam em 1000 ganham o `baseMmr` do LoL.
- Bot iniciado no PM2 (`caps-bot`, CAPS BOT LOL#6241).
- `!resetgeral` é o reset de temporada/pontos; **não** apaga cadastro. Melhor equilíbrio: manter cadastros + sync de elo, não limpar o banco.
- `!sincronizarelo` gravava elo mas o cargo falhava em silêncio; agora reporta o motivo. Não atribuir cargos de elo manualmente.
- Cargos acrescentados no Discord: **Mestre**, **Esmeralda**, **Grão Mestre** (não é um cargo único "Mestre Esmeralda"). Mapeados em `utils/lobbyUtils.js` (`RANK_ROLES_MAP` / `findRankRole`).
- `!sincronizartodos` falhou na 1ª tentativa porque foi digitado `!sicronizartodos`; aliases e `!sync todos` foram adicionados.
- **Como o balanço funciona:** cada jogador tem **1000 pontos custom** + MMR do Solo/Duo. Quando a sala completa, o snake draft iguala a soma dos dois times. Vitória/derrota na custom mexe só nos 1000; o elo de LoL continua separado no perfil.
- `!perfil`: campo **Elo LoL** (ranked + pts Riot) e **Pontos Custom** (base 1000). Sem texto "Ganhos/perdas nas personalizadas".
- Alerta de possível smurf pós-`!vitoria` (elo baixo + WR alto). Staff confirma main ou ajusta Base MMR. Canal opcional `smurfAlertChannelId`. Bot reiniciado para ativar.

---

## 🔄 Como usar este arquivo

1. **Ao início de cada sessão:** Leia este arquivo para saber onde paramos
2. **Durante a sessão:** Marque itens concluídos e adicione notas
3. **Ao fim de cada sessão:** Atualize "Última Sessão", "Ponto de Parada" e mova itens para ✅

---

*Arquivo gerado automaticamente pela IA em 2026-09-24. Manter atualizado a cada sessão.*
