# MEMORY — BOT CAPS DISCORD

> Arquivo de memória persistente para sessões com IA.
> Atualizar ao início e ao fim de cada sessão de trabalho.

---

## 🗓️ Última Sessão

- **Data:** 2026-10-17
- **Foco:** Gate de cargos do `!desafiar` + padrão `🛠️ Staff` / `👑 Capitão LCL` + novo `!ajudalcl`/`/ajudalcl` + escopo por categoria (fim do "Comando desconhecido" cruzado)
- **Status:** ✅ LCL 108/108 e CAPS 92/92; `lcl-bot` + `caps-bot` online. Cargos NÃO alterados no servidor (por decisão).

---

## 📍 Ponto de Parada Atual

### Onde paramos:
Banco no Docker local `caps-mongo` (232 jogadores; o log diz "Atlas" mas é o label fixo da linha de conexão). Pós-`!vitoria` move todos para a **Sala de Espera**. **Lobby TIER S** (gate Esmeralda IV+ por elo/cargo, sem bypass de `!entrar` p/ staff). **Top10/placar tiers** (mesmo PDL, filtro `baseMmr >= 2000`). Cargo **INFERNAL** automático (5+ winstreak, vale até 08h SP mesmo com derrota; prioridade posição 5 na `!espera` + imunidade na roleta). **`!roleta N A`** instantânea (1 comando, anti-duplo por `matchId`, anúncio no canal fila) + **`!roletasair A`** (opt-out). **`!regras`** (jogadores) + **`!staff`** (restrito). Alias `!iniciarseason`. **Temporada Oficial #1 ativa** (aberta em 2026-10-05, `phase: official`). Suite em **60/60** (15 suites). **Cópia TESTRE vinculada à guild CAPS BOT TESTE** (`1558217291123138561`): `config.json` remapeado p/ a estrutura atual (`1558440...` + Sala de Espera `1558446935797399623` criada agora), `allowedGuildIds` trava o bot só nessa guild, banco próprio `caps-bot-teste` (`MONGODB_DB` no `.env`, mesma instância Docker, dados isolados da produção). Cargos de elo base criados na teste (Ferro, 🥉Bronze, 🥈Prata, 🥇Ouro, 🔷Platina). Hierarquia bot > INFERNAL verificada via API nas 3 guilds + 0 membros com INFERNAL (caso maggot resolvido). Extração do `legacyCommands.js` segue pendente. **Voz temporária no ar**: hub `➕ Criar sala` (`1558535974772936749`, categoria `🎙️・FILAS`) criado via `!salahub`; entrar no hub cria `🎧 Sala de <nome>` privada (limite 10) e move; dono gerencia com `!convidar` (libera + DM), `!limite`, `!lock`/`!unlock`, `!sala`; sala vazia apaga em 60s; `!limparvoz` (Admin/Moderadores/VIP/Lendário) limpa órfãs; `pruneTempRooms` limpa na inicialização. Criam sala: `Capitão`, `Staff`, `⭐ VIP`, `👑 Lendário` (Apoiador removido a pedido). Docs novos: `IMPLEMENTACAO_BOT.md`, `DIVULGACAO_BOT.md`. `.gitignore` agora ignora `.env`, `.env.bak*`, `*.bak*`.

### Próximo passo imediato:
- **TESTE FUNCIONAL (produção fora da guild teste):** `!limparvoz` (apagar as ~7 órfãs acumuladas) → roteiro: `!cadastrar` → `!entrar` (no Lobby) → `!start`/`!votar` → painel de botões → MVP → `!roleta` → `!placar`/`!top10` → hub: entrar → `!convidar` → sair e conferir auto-exclusão em 60s → conferir canais `🎮・fila`, `⚔️・partidas`, `📋┃resultados`, `🔥┃destaques`
- **ISOLAMENTO (feito, manter):** bot de teste expulso? NÃO — o de PRODUÇÃO (`CAPS BOT LOL#6241`) foi expulso da guild teste; cada guild tem só o seu bot; tokens diferentes (hashes divergem); PM2 `caps-bot` (prod, `BOT CAPS DISCORD`) + `caps-bot-teste` (TESTRE) online simultâneos sem conflito
- **PRODUÇÃO (verificado 10/10 15h):** `config.json` da pasta PROD está com IDs de produção (`1487...`, sem `allowedGuildIds`; modificado 13:11) — o alerta antigo de rewrite p/ IDs de teste não se confirma; obs: `rankRoleIds.Prata` aponta p/ `1552...` (conferir se é da guild certa)
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
- [x] `tests/` com `node:test` nativo (`npm test`): `helpers.js` + `victory-selector` (7) + `register-victory` (3) + `balance` (3) + `rematch` (5) + `cancel-start` (4) + `cleanup-rooms` (6) + `tiers-roulette` + `rules` + `pdl` (3) + `result-vote-panel` (6) = 49/49 verdes (13 suites)
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

### Pós-05/10: !pdl + painel de voto + trava roleta + servidor novo (2026-10-10)
- [x] `!pdl @jogador ±valor motivo` (Admin, Classic, inteiro ≠0, limite ±500, piso 0, sem tocar W/L; lock `guildId:victory`; `application/use-cases/adjustPdl.js` + `tests/pdl.test.js` com 3 casos)
- [x] Painel de votação de resultado com botões (`commands/handlers/resultVotePanel.js`): `votewin:<matchId>:<time>`, maioria simples (6/10 5x5), menciona faltantes, lembrete 2min, expira 5min (texto `!votar` segue valendo); `index.js` trata o clique; `tests/result-vote-panel.test.js` com 6 casos
- [x] Trava pós-vitória no `!entrar` (`ENTER_ROULETTE_BLOCK_MS` = 3min): mesma mode/format/tier com roleta pendente retorna `roulette_pending` (não mistura lobby antes do sorteio; roleta feita libera via `roletaHistory`); espera Tier S separada (`classic:5x5:s`)
- [x] Migração de servidor: `config.json` com IDs novos (`1558...`, cargos/voz/texto), `postMatchTierSWaitingChannelId` (Sala de Espera Tier S separada, `lobbyUtils.js` move Tier S p/ lá); `setup-servidor.js` cria a estrutura do zero; `IMAGENS/` centraliza os assets (raiz limpa)
- [x] Suite em 49/49 (13 suites); `!ajuda`/`!staff` documentam `!pdl`; `rules.test.js` exige `!pdl` no guia da staff

### Ambiente de teste vinculado à guild CAPS BOT TESTE (2026-10-10)
- [x] `config.json` da TESTRE remapeado p/ a estrutura atual da guild `1558217291123138561` (voz `1558440...`, texto: `🎮・fila`, `⚔️・partidas`, `📋┃resultados`, `🔥┃destaques`, `🥇┃ranking`, `🧍┃logs-jogadores`, `⚔️┃logs-temporada`, `🤖・comandos`, `boas-vindas`; backup em `config.json.bak-testremap-20261010`)
- [x] Criados na guild de teste: voz `⏳ Sala de Espera` (`1558446935797399623`) + cargos Ferro/🥉Bronze/🥈Prata/🥇Ouro/🔷Platina (padrão da principal)
- [x] `allowedGuildIds` no config + `isGuildAllowed()` (`utils/lobbyUtils.js`, testado em `tests/guild-filter.test.js`): bot de teste ignora as outras guilds (comandos, botões, slash, scheduler, reconciliação INFERNAL); lista vazia = comportamento da produção (sem mudança lá)
- [x] Banco próprio: `services/dataService.js` usa `process.env.MONGODB_DB || 'caps-bot'`; TESTRE com `MONGODB_DB=caps-bot-teste` (mesmo Docker, dados isolados; `.env` com backup `.env.bak-testredb-20261010`); log de conexão agora mostra o nome do banco
- [x] Mensagens automáticas são 100% dirigidas pelo `config.json` (sem mudança de lógica): início de partida → `⚔️・partidas`, painel de voto (botões) → idem, histórico → `📋┃resultados`, MVP → `🔥┃destaques`, dashboard/roleta → `🎮・fila`, ranking diário → `🥇┃ranking`
- [x] Suite em 52/52 (14 suites); verificação via API: todos os 18 IDs do config resolvem na guild de teste
- [ ] Teste funcional com o bot ligado (roteiro no "Próximo passo imediato")

### Voz temporária — hub "➕ Criar sala" (2026-10-10, suite 60/60)
- [x] `services/tempVoiceService.js` (novo): entrar no hub cria `🎧 Sala de <nome>` privada (limite 10, só dono + staff enxergam) e move; dono com `!convidar @...` (libera + DM), `!limite N`, `!lock`/`!unlock`, `!sala <nome>`; sala vazia apaga em 60s (`deleteDelaySeconds`); órfãs saem no boot (`pruneTempRooms`, chamado no `ready` do `index.js`) e via `!limparvoz`
- [x] Podem criar: `Capitão`, `Staff`, `⭐ VIP`, `👑 Lendário` (`allowedRoleNames` + `allowedRoleIds`; Apoiador foi liberado e depois removido a pedido); `!limparvoz` liberado p/ Admin/Moderadores/VIP/Lendário (`memberCanManageTempVoice`, `managerRoleNames`)
- [x] `index.js`: listener `voiceStateUpdate` + comandos `salahub/lock/unlock/limite/convidar/sala/limparvoz` (com trava `isGuildAllowed`); `!salahub` (staff) cria o hub e persiste `tempVoice.hubChannelId` no `config.json`; `!ajuda` com campo 🎧
- [x] `config.json`: seção `tempVoice` (`hubChannelId 1558535974772936749`, `userLimit 10`, `deleteDelaySeconds 60`); `setup-servidor.js` cria o hub em `🎙️・FILAS` e grava `allowedRoleIds` (Capitão+Staff+VIPs)
- [x] Registro persistente em `database/tempVoiceRooms.json` (não usa mais `topic`: o Discord rejeitou `caps-temp:*` com `CHANNEL_TOPIC_INVALID`); testes usam `TEMPVOICE_REGISTRY_PATH` isolado (um `npm test` apagou o registro real — causa das 7 órfãs que não sumiam)
- [x] `tests/temp-voice.test.js` com 8 casos (hub, topic/registro, criação por cargo, gerência, nome, prune)
- [x] Bug corrigido: entrar no hub vindo de uma sala não recolhia a sala antiga (checagem do canal antigo movida p/ antes do branch do hub)

### Isolamento teste × produção (2026-10-10)
- [x] App de teste próprio (`CAPS BOT TESTE`, client `1558453010005368832`); `.env` da TESTRE tinha Client Secret no `DISCORD_TOKEN` (76 hex, sem pontos) → trocado pelo Bot Token (72, 3 partes); `RIOT_API_KEY` restaurada do `.env.bak-testredb-20261010`
- [x] Portal: 3 Privileged Intents ligadas; app privado → Instalação = Nenhum (erro de validação resolvido); convite pelo link manual `permissions=8&scope=bot+applications.commands` (caixas de permissão da página Bot não salvam com link Nenhum — irrelevante)
- [x] Produção (`CAPS BOT LOL#6241`) estava DENTRO da guild teste (mandou o boas-vindas) → expulsa; cada guild com só o seu bot; hashes dos tokens divergem; bancos `caps-bot` × `caps-bot-teste`; sem overlap de IDs
- [x] PM2: `caps-bot` (prod) + `caps-bot-teste` (TESTRE, criado via `pm2 start index.js --name caps-bot-teste` + `pm2 save`) online simultâneos; NUNCA dois processos no mesmo token (um `node index.js` solto + PM2 derrubam a sessão um do outro)
- [x] `.gitignore`: `.env`, `.env.bak*`, `*.bak*` (antes os `.bak` vazavam no `git status`)
- [x] Docs: `IMPLEMENTACAO_BOT.md` (fluxo de instalação p/ novos Discords) + `DIVULGACAO_BOT.md` (textos curto/médio/longo p/ venda)

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

## ⚔️ Inter-servidores N x J — CAPS ARENA neutra (aprovado 2026-10-10, em implementação)

- **Conceito:** times de 5 fixos de servidores diferentes se desafiam; a partida acontece sempre na **CAPS ARENA** (servidor neutro), com salas nomeadas pela origem de cada time. Série **MD1** (desafio 1x, pontuação menor) ou **MD3** (melhor de 3, pontuação maior).
- **Regras fechadas:** 5 fixos (sem completar); J1/J2 com lados alternados azul/vermelho; J3 só se 1-1, com lados **sorteados**; ranking inter **separado** do interno; ausência = **W.O.**; só **Capitão/Staff** opera (`!desafiar`, `!resultado-inter`, `!wo`).
- **Técnico:** módulo novo `domain/inter/series.js` (regras puras) + `application/use-cases/inter/` + `services/inviteService.js` (bot hoje NÃO cria invites — verificado) + docs `interBusca/interMatches/interRanking` em `services/dataService.js`; fluxo interno (`enterQueue/startMatch`) intacto; invites gerados **só no match pronto**, nunca na busca.
- **Especificação completa:** pasta do projeto `interservidores/` (`README.md`, `PASSO_A_PASSO.md`, `COMANDOS.md`, `PLANO.md` + PDFs: `INTERSERVIDORES-passo-a-passo.pdf`, `PLANO.pdf`, `inter-servidores-especificacao.pdf`, `matchmaking-compartilhado-analise.pdf`).
- **Ativação:** seção `inter` no `config.json` (`arenaGuildId`, canais de invite/anúncio, timeouts, pontos). Na TESTRE, a arena é a própria guild de teste.
- **Status:** ✅ MVP do plano aplicado em 2026-10-11: `guildSettings` + `!shared on|off|status` (+`/shared`), pool shared por modo/formato com destino eleito e invite só no match pronto, dashboards por guild, dashboard admin v1 (login local, temas claro/escuro, leitura + cancelar busca), suite **92/92**. Pendente: teste funcional na TESTRE + grupos explícitos/lock distribuído (pós-MVP).

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

### 2026-10-17 — Cargos operadores do inter: padrão `🛠️ Staff` / `👑 Capitão LCL`
- **Padrão novo (com emoticon):** `🛠️ Staff` e `👑 Capitão LCL`. Variações sem emoji continuam valendo: `Staff`, `Capitão`, `Capitão LCL`. Legado `👑 Capitão de Customs` mantido por compatibilidade.
- **Bug do `!desafiar` (causa raiz):** `captainRoleId` estava órfão (`1559621160478445609` não existe no CAPS ARENA) e o fallback por nome do gate só aceitava `"capitão lcl"` (inexistente). Corrigido: `isCapitaoOuStaff` normaliza o nome (sem acento/emoji) e aceita `staff`/`capitaolcl`/`capitao`/`capitaodecustoms`; `config.json` (LCL e CAPS) aponta p/ `1487819172783325255` (cargo real `👑 Capitão LCL`/`👑 Capitão de Customs`).
- **Arquivos:** `server-pattern.json` (LCL + CAPS), `setup-servidor.js` (LCL + CAPS), `organize-official-discord.js` (lia `roles.Capitão`, chave inexistente → `roles['👑 Capitão LCL']`), `config.json` (`allowedRoleNames` com padrão + variações + legado), `interCommandHandlers.js`, `services/tempVoiceService.js` LCL, `tests/inter-only.test.js`.
- **NÃO aplicado no servidor:** cargos do CAPS ARENA não foram criados/renomeados (decisão do usuário). Rodando `setup-servidor.js`/`organize-official-discord.js` depois, cria `🛠️ Staff`/`👑 Capitão LCL` e reponta o `captainRoleId`.
- **Novo guia `!ajudalcl` / `/ajudalcl`:** `buildAjudaLclEmbed` + `handleAjudaLclCommand` em `commands/legacyCommands.js` (desafiar, cancelar, resultado/W.O., consultas, regras rápidas e pontuação lida de `config.inter`); adicionado a `INTER_COMMANDS`/`INTER_ONLY_SLASH`, citado no `INTER_ONLY_REPLY`, coberto em `tests/inter-only.test.js` e em `interservidores/COMANDOS.md`.
- **Escopo por categoria (fim do "Comando desconhecido" cruzado):** os 2 bots convivem na CAPS ARENA e escutam `!`; o CAPS respondia "Comando desconhecido" no canal do LCL. Agora `config.json → commandCategoryIds: ["1559621163120984158"]` (categoria 🔥・LCL) + guarda em `index.js` `messageCreate`: o LCL só responde dentro de 🔥・LCL (com `INTER_ONLY=1`). No CAPS, `ignoredCategoryIds` espelhado (ver MEMORY raiz).
- **Cargos de call:** `🎙️ Ativo`/`🎙️ Frequente`/`🎙️ Viciado em Call` são apurados/atribuídos pelo bot CAPS **só no tick mensal (dia 1º)**; o ✅ do `!tempo` é apenas o rank ao vivo do mês corrente (não significa cargo atribuído).
- Validação: LCL `npm test` 108/108 (31 suites) e CAPS 92/92 (o `handleHelpCommand is not defined` foi resolvido — ver MEMORY raiz).

### 2026-10-14 — Cargos com emoticons + setup LCL
- **Pattern LCL:** `Capitão` → `👑 Capitão de Customs` (igual CAPS ARENA, confirmado via API); LCL segue com 3 cargos (`Staff`, `👑 Capitão de Customs`, `Jogador`) — `Visitante`/`INFERNAL`/`MVP` são do CAPS e não são criados aqui; textos `🔥・LCL` com `talk: false` explícito (Jogador lê, Capitão/Staff operam).
- **`setup-servidor.js` LCL:** refs `get('👑 Capitão de Customs')`, aviso de legados (`Jogador Ativo`, `Capitão` simples), `userLimit: 5` da clandestina mantido; `config.json`: `infernalRoleName` → `🔥 INFERNAL`, `mvpPlayerRoleName` → `⭐ MVP`, `allowedRoleNames` com `👑 Capitão de Customs`.
- **`utils/lobbyUtils.js` + `services/tempVoiceService.js`:** defaults de `INFERNAL_ROLE_NAME`/`MVP_ROLE_NAMES`/`getAllowedRoleNames` nos nomes com emoticon (aliases simples mantidos p/ compat).
- Validação: `npm test` 108/108 (31 suites); restart `lcl-bot --update-env` com `Bot conectado como LCL - LIGA CLANDESTINA DE LOL#8184 | v1.8.0` no log.

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

### 2026-10-10 — Voz temporária + isolamento total teste × produção
- **Hub (opção B):** `➕ Criar sala` criado via `!salahub` na guild teste; entrar com cargo permitido cria `🎧 Sala de <nome>` privada e move. Pedidos do dono no caminho: VIP incluído → Apoiador removido → `!convidar` passou a mandar DM → comandos no `!ajuda` → `!limparvoz` liberado p/ Admin/Moderadores/VIP/Lendário.
- **Achados:** (1) `topic caps-temp:*` rejeitado pelo Discord (`CHANNEL_TOPIC_INVALID`) → registro em `database/tempVoiceRooms.json`; (2) entrar no hub vindo de sala não recolhia a antiga → checagem do canal antigo antes do branch do hub; (3) um `npm test` apagou o registro real (agora isolado por `TEMPVOICE_REGISTRY_PATH`) → `!limparvoz` + `pruneTempRooms` p/ órfãs; (4) processo `node` solto morre ao fechar o shell (job object) → bot de teste fixado no PM2 (`caps-bot-teste`); (5) produção dentro da guild teste → expulsa; (6) alerta antigo de `config.json` da PROD com IDs de teste não se confirma (verificado: IDs `1487...` de produção).
- Validação: `npm test` 60/60 (15 suites); PM2 com `caps-bot` + `caps-bot-teste` online; log mostra ciclo completo criar → remover (vazia).

### 2026-10-10 — TESTRE vinculada à guild CAPS BOT TESTE
- **Porquê:** mesmo token e mesmo Mongo nas duas pastas → sem isolamento, o teste derruba a produção (sessão do gateway) e polui o ranking real. Isolamento em 2 eixos: `allowedGuildIds` (comandos/mensagens) + `MONGODB_DB=caps-bot-teste` (dados).
- **Achados:** TESTRE apontava p/ estrutura apagada (12/13 canais inexistentes); guild de teste tinha 2 setups sobrepostos + nomes próprios nos canais (mapeados manualmente, sem criar duplicatas); `.env` das duas pastas aponta p/ `localhost:27017` (Docker `caps-mongo`, 8 dias up; o "Atlas" do log era label fixo — corrigido p/ mostrar o banco real); pasta PROD é clone git atrás do origin (`ce1ea4b`, behind 1) com `config.json` local reescrito p/ IDs de teste (restauração pendente antes do próximo restart).
- Validação: `npm test` 52/52; script de verificação via API (todos os IDs resolvem); hierarquia bot > INFERNAL + 0 portadores confirmada nas 3 guilds.

### 2026-10-10 — !pdl + painel de voto + trava roleta + servidor novo
- **`!pdl`:** `application/use-cases/adjustPdl.js` (lock `victory`, valida inteiro ≠0, teto 500, piso 0, mexe só no `internalRating` Classic); `legacyCommands.js` expõe `!pdl @jogador -50 motivo` (Admin, com auditoria no log); `!ajuda`/`!staff`/`!entrar` (texto) citam a punição p/ rage quit.
- **Painel de voto:** `commands/handlers/resultVotePanel.js` (payload puro e testável + timers `reminder 2min`/`expire 5min` com `unref`); `index.js` roteia `votewin:*` p/ `handleResultVoteButton` (só participante, lock `victory`, maioria registra sozinho via `onThresholdReached`); `closeResultVotePanel` desativa botões ao registrar/expirar.
- **Trava roleta:** `enterQueue.js` exporta `ENTER_ROULETTE_BLOCK_MS`/`getPendingRouletteEntries`/`getWaitingListKey`; `queueCommandHandlers.js` responde o bloqueio (`roulette_pending` com letras + segundos restantes).
- **Servidor novo:** `config.json` inteiro remapeado (voz/texto/cargos `1558...`); Tier S pós-partida vai p/ `postMatchTierSWaitingChannelId`; `setup-servidor.js` automatiza a criação; `IMAGENS/` recebe os assets (deletados da raiz); `config.json.bak-*` locais NÃO commitados.
- Validação: `npm test` 49/49; commit + push em `main`.

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
