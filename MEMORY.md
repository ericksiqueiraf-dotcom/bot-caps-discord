# MEMORY — BOT CAPS DISCORD

> Arquivo de memória persistente para sessões com IA.
> Atualizar ao início e ao fim de cada sessão de trabalho.

---

## 🗓️ Última Sessão

- **Data:** 2026-10-05
- **Foco:** Lobby TIER S (Esmeralda+) + `!top10`/`!placar tiers` + INFERNAL até 08h com prioridade + `!roleta` instantânea + `!roletasair` + `!regras` + `!staff` + abertura da Temporada Oficial #1
- **Status:** ✅ Concluído

---

## 📍 Ponto de Parada Atual

### Onde paramos:
Banco no MongoDB Atlas (185 jogadores). Pós-`!vitoria` move todos para a **Sala de Espera (1490385246775017572)**. **Lobby TIER S** (`1556124976359415919`, gate Esmeralda IV+ por elo/cargo, sem bypass de `!entrar` p/ staff). **Top10/placar tiers** (mesmo PDL, filtro `baseMmr >= 2000`). Cargo **INFERNAL** automático (5+ winstreak, vale até 08h SP mesmo com derrota; prioridade posição 5 na `!espera` + imunidade na roleta). **`!roleta N A`** instantânea (1 comando, anti-duplo por `matchId`, anúncio no canal fila `1489237001013297182`) + **`!roletasair A`** (opt-out). **`!regras`** (jogadores) + **`!staff`** (restrito). Alias `!iniciarseason`. **Temporada Oficial #1 ativa** (`!resetgeral` → `!iniciartemporada` em 2026-10-05). Suite em **40/40**. Bot online no PM2 (`caps-bot`, `CAPS BOT LOL#6241 v1.8.0`, `[DB] Conectado`). Extração do `legacyCommands.js` segue pendente.

### Próximo passo imediato:
- **Pendente do admin no Discord:** subir `CAPS BOT LOL` acima do `INFERNAL` (hierarquia) + remover o INFERNAL órfão do maggot 1x
- Testar em produção: `!entrar` Tier S, `!top10 tiers`, `!roleta 2 A`, `!regras`, `!staff`
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
- [x] `tests/` com `node:test` nativo (`npm test`): `helpers.js` + `victory-selector` (7) + `register-victory` (3) + `balance` (3) + `rematch` (5) + `cancel-start` (4) + `cleanup-rooms` (6) = 28/28 verdes
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
