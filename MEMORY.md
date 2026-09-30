# MEMORY — BOT CAPS DISCORD

> Arquivo de memória persistente para sessões com IA.
> Atualizar ao início e ao fim de cada sessão de trabalho.

---

## 🗓️ Última Sessão

- **Data:** 2026-09-29
- **Foco:** Balanço 1000+elo, perfil separado, alerta de smurf
- **Status:** ✅ Concluído

---

## 📍 Ponto de Parada Atual

### Onde paramos:
Balanço: **1000 (custom) + elo LoL + W/L**. Perfil mostra Elo LoL e Pontos Custom (base 1000) separados. Alerta de smurf ativo no PM2. Cargos: **Mestre**, **Esmeralda**, **Grão Mestre**. Sync: `!sync todos`. Extração do `legacyCommands.js` segue pendente.

### Próximo passo imediato:
- Continuar extração de lógica de negócio do `legacyCommands.js`
- Identificar quais comandos ainda não foram movidos para handlers

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
- [x] MongoDB Atlas como banco principal
- [x] Fallback JSON local em `database/`
- [x] `services/dataService.js` com lock em memória
- [x] `services/riotService.js` com cache em memória (1h)
- [x] `services/balanceService.js` com pontuação `1000 + elo LoL + W/L`
- [x] `workers/` pasta criada (sem worker ativo ainda)
- [x] `Ativar Bot.bat` inicia manualmente o `caps-bot` pelo PM2 com dois cliques

### Comandos com fluxo isolado em handlers/use-cases
- [x] `!entrar`
- [x] `!start`
- [x] `!vitoria`
- [x] `!votar`
- [x] `!reset`
- [x] `!cancelarstart`

### Fila de espera
- [x] `!espera` e `/espera` inscrevem jogadores na espera da próxima partida e mostram a ordem de entrada (`joinedAt`)
- [x] `!espera ver` consulta a ordem sem se inscrever; `!espera sair` ou `!sair` removem o jogador da espera
- [x] A espera é persistida separadamente das salas de `!entrar`, por modo e formato, com filtros como `!fila aram 2x2`
- [x] Jogadores são removidos da espera ao entrar em uma sala normal; os resets administrativos também limpam a espera
- [x] `!entrar` respeita a ordem: enquanto houver espera, somente o primeiro jogador pode ocupar a próxima vaga
- [x] `!fila` preservado como consulta dos jogadores que usaram `!entrar`
- [x] Registro do comando slash e ajuda atualizados

### Pontuação e balanceamento
- [x] Seed inicial: `1000 + MMR do elo Solo/Duo cadastrado`
- [x] Snake draft usa essa pontuação (não só o elo da Riot)
- [x] Vitória/derrota altera `internalRating` via Elo; mudança de elo LoL ajusta a parte de ranked
- [x] Stats antigas (seed 1000 sem LoL) migram com `ratingVersion: 2`
- [x] `!perfil`: Elo LoL e Pontos Custom separados; custom começa em **1000** (sobe/desce com as personalizadas)

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
