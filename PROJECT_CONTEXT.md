# BOT CAPS DISCORD - Contexto do Projeto

## Objetivo Central

Bot de Discord para organizar partidas personalizadas de League of Legends com:

- filas por modo e formato
- balanceamento automático de times
- ranking interno por modo
- streaks de vitória
- histórico de partidas
- logs de temporada e de jogadores
- integração com a Riot API para validar e seedar jogadores via `Nick#TAG`

O foco atual do projeto é operação de comunidades de custom games no Discord, com suporte principal a:

- `Classic` (Summoner's Rift)
- `ARAM 1x1`
- `ARAM 2x2`
- `ARAM 3x3`
- `ARAM 4x4`
- `ARAM 5x5` sem pontuação

## Stack e Tecnologias

- Runtime: Node.js
- Bot: `discord.js`
- HTTP client: `axios`
- Banco principal: MongoDB Atlas
- Fallback local: arquivos JSON em `database/`
- Configuração: `.env` + `config.json`

Dependências principais em `package.json`:

- `discord.js`
- `axios`
- `dotenv`
- `mongodb`

## Arquitetura Atual

### 1. Camada de entrada

Arquivo principal: [index.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/index.js)

Responsável por:

- iniciar o cliente Discord
- registrar slash commands
- ouvir `messageCreate`
- ouvir `interactionCreate`
- encaminhar execução para os handlers

### 2. Camada de comandos

Arquivo principal: [commands/legacyCommands.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/commands/legacyCommands.js)

Responsável por:

- `!entrar`, `!sair`, `!lista`
- `!start`, `!cancelarstart`, `!vitoria`, `!votar`
- `!placar`, `!top10`, `!topstreak`, `!perfil`
- `!reset`, `!resetgeral`, `!sync`, `!onboarding`

Essa é hoje a camada com maior concentração de regra de negócio.

Pastas auxiliares em criação:

- `commands/handlers/`

Objetivo:

- mover handlers limpos para fora do arquivo legado
- reduzir o tamanho do `legacyCommands.js`
- preparar eventual divisão por domínio de comando

### 2.1. Camada de casos de uso

Pastas:

- `application/use-cases/`

Responsável por:

- orquestrar entrada em fila
- iniciar partidas
- registrar vitórias
- resetar filas e partidas
- cancelar partidas ativas
- registrar votos de vitória

Essa camada foi criada para tirar fluxo de negócio dos comandos e preparar reaproveitamento futuro por API, worker ou painel web.

### 3. Camada de utilidades e regra de domínio

Arquivo principal: [utils/lobbyUtils.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/utils/lobbyUtils.js)

Responsável por:

- resolução de modos e formatos
- construção de embeds
- ranking e streak
- canais dinâmicos
- histórico, temporada, logs
- helpers de estado de lobby e partida

Essa camada concentra muita regra de domínio e também parte da integração com Discord.

### 3.1. Núcleo de domínio em extração

Pastas:

- `domain/constants/`
- `domain/queue/`
- `domain/ranking/`

Responsável por:

- modos e formatos oficiais do bot
- parse de seleção de fila
- regras de agrupamento de streak no ARAM
- normalização de estatísticas por modo
- cálculo de ranking e top streak

Essa é a base da modularização iniciada para reduzir acoplamento entre comandos, Discord e regra de negócio.

### 4. Camada de persistência

Arquivo principal: [services/dataService.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/services/dataService.js)

Responsável por:

- leitura e escrita de `queue`
- `playerStats`
- `currentMatch`
- `seasonMeta`
- `seasonHistory`
- `systemMeta`

Persistência atual:

- preferencialmente MongoDB Atlas
- fallback para JSON local se Mongo falhar

### 5. Integração Riot API

Arquivo principal: [services/riotService.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/services/riotService.js)

Responsável por:

- validar `Nick#TAG`
- resolver `puuid`
- buscar rank solo
- converter rank da Riot em `baseMmr`
- manter cache em memória por 1 hora

### 6. Balanceamento

Arquivo principal: [services/balanceService.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/services/balanceService.js)

Responsável por:

- seed rating
- MMR híbrido
- delta de Elo interno
- criação de times balanceados

## Estrutura de Arquivos

Arquivos e pastas centrais:

```text
index.js
config.json
package.json
migrateToMongo.js
commands/
  legacyCommands.js
  handlers/
    matchCommandHandlers.js
    queueCommandHandlers.js
    victoryCommandHandlers.js
application/
  use-cases/
    enterQueue.js
    startMatch.js
    registerVictory.js
    resetSystem.js
    cancelActiveMatch.js
    castVictoryVote.js
domain/
  constants/
    queueModes.js
    queueFormats.js
  queue/
    selection.js
  ranking/
    playerStats.js
docs/
  ARCHITECTURE.md
services/
  balanceService.js
  dataService.js
  riotService.js
utils/
  lobbyUtils.js
workers/
  README.md
database/
  queue.json
  playerStats.json
  currentMatch.json
  seasonMeta.json
  seasonHistory.json
  systemMeta.json
```

## Fluxo Principal de Processamento

### Entrada em fila

1. Usuário entra no canal de voz correto
2. Usa `!entrar` ou `/entrar`
3. O bot resolve modo e formato
4. Consulta cadastro local ou chama Riot API
5. Calcula MMR híbrido do modo
6. Encontra ou cria lobby
7. Salva estado
8. Atualiza dashboard
9. Se a sala completa, agenda auto-start

### Início de partida

1. Auto-start ou `!start`
2. Carrega lobby
3. Balanceia times
4. Cria canais de time
5. Move jogadores
6. Salva `currentMatch`
7. Anuncia embed da partida

### Finalização de partida

1. Staff usa `!vitoria` ou jogadores votam com `!votar`
2. O bot localiza a partida ativa
3. Calcula delta de rating
4. Atualiza `wins`, `losses`, `winStreak`
5. Salva ranking e match state
6. Atualiza cargos
7. Move jogadores de volta
8. Apaga canais temporários
9. Publica histórico, logs e MVP

## Regras de Ranking Atuais

### Rankings principais

- `Classic` tem ranking separado
- `ARAM` tem ranking por formato quando consultado com formato
- `ARAM 5x5` não deve pontuar

### Top streak

`topstreak` foi consolidado em 3 blocos:

- `Classic`
- `ARAM 1x1`
- `ARAM 2x2/3x3/4x4` agrupados

O top streak mostra os 5 melhores com streak ativa.

## Avaliação de Modularidade

### Pontos positivos

- separação básica entre entrada, persistência, Riot API e balanceamento
- funções utilitárias reutilizáveis
- persistência abstraída em um serviço
- suporte a fallback local

### Pontos fracos

- `legacyCommands.js` está grande e mistura várias responsabilidades
- `lobbyUtils.js` também concentra lógica demais: embed, domínio, canais, ranking e histórico
- o projeto ainda é fortemente acoplado ao Discord
- não existe separação formal entre:
  - domínio de matchmaking
  - domínio de ranking
  - domínio de temporada
  - adapters de Discord
  - adapters de Riot API

## Avaliação de Escalabilidade

## Situação atual

O projeto é viável para:

- uma comunidade pequena ou média
- um único processo do bot
- volume moderado de comandos
- poucas partidas simultâneas por guild

O projeto **não está otimizado para múltiplas instâncias rodando em paralelo**.

### Por que não escala bem horizontalmente hoje

1. `withQueueOperationLock` usa `Map` em memória local
   Arquivo: [services/dataService.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/services/dataService.js)

   Isso protege apenas dentro do mesmo processo.
   Se rodar local + Railway, ou múltiplas réplicas, os locks não se enxergam.

2. `pendingAutoStarts` também é em memória
   Arquivo: [commands/legacyCommands.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/commands/legacyCommands.js)

   Se o processo reinicia, esse estado some.
   Em múltiplas instâncias, cada uma pode agendar seu próprio auto-start.

3. Não existe fila distribuída nem coordenador de jobs

   Não há Redis, BullMQ, RabbitMQ, SQS, NATS ou equivalente.

4. O processamento é síncrono no fluxo do comando

   O mesmo processo lida com:

- eventos do Discord
- chamadas à Riot API
- gravação no banco
- criação e deleção de canais
- atualização de ranking

### Conclusão sobre partidas simultâneas

Com **uma única instância**, o bot consegue lidar com partidas simultâneas em múltiplos lobbies com razoável segurança, porque o estado é persistido e existem locks por chave.

Com **múltiplas instâncias**, o projeto hoje fica vulnerável a:

- duplicação de respostas
- auto-start duplicado
- `!vitoria` concorrente
- inconsistência de fila e dashboard
- respostas fantasmas de instâncias diferentes

## Worker dedicado e sistema de fila

### Worker dedicado

Hoje **não existe worker dedicado**.

Não há processo separado para:

- Riot API
- cálculo de ranking
- auto-start
- jobs de limpeza
- agendamento diário

Tudo roda no mesmo processo do bot.

Foi criada a pasta `workers/` como ponto de entrada da futura extração de jobs assíncronos.

### Sistema de fila/prioridade

Hoje **não existe fila formal de jobs**.

Também não existe:

- prioridade de tarefas
- retry estruturado
- backoff
- isolamento de jobs lentos
- limitação centralizada de chamadas à Riot

## Estado da Riot API

O serviço atual em [services/riotService.js](C:/Users/ErickSiqueira/Documents/BOT%20CAPS%20DISCORD/services/riotService.js):

- usa `axios`
- tem timeout de 10s
- trata erro `429`
- tem cache em memória por `puuid`

### O que falta

- rate limiter real
- fila de requisições
- retry com backoff exponencial
- circuito de proteção para indisponibilidade da Riot API
- observabilidade por endpoint/latência

## O projeto precisa virar múltiplas APIs?

### Curto prazo

Não obrigatoriamente.

Ainda é possível evoluir bastante mantendo um monólito, desde que ele seja modularizado internamente.

### Médio prazo

Se o projeto crescer, o ideal é separar em pelo menos 3 blocos lógicos:

1. `bot-gateway`
   Responsável por Discord, slash commands e resposta ao usuário.

2. `matchmaking-api`
   Responsável por filas, lobbies, partidas, ranking e temporada.

3. `riot-worker`
   Responsável por chamadas à Riot API com fila, cache, retry e rate limiting.

### Melhor arquitetura futura

- Discord bot fino
- API central de domínio
- fila de jobs distribuída
- Redis para locks e debounce
- MongoDB para estado
- worker para integrações externas e tarefas assíncronas

## Parecer de Viabilidade

### O projeto é viável?

Sim, é viável.

### O projeto está otimizado para simultaneidade e escala horizontal?

Ainda não.

### Estado atual recomendado

- manter apenas uma instância ativa do bot
- usar Railway ou local, nunca ambos ao mesmo tempo
- evitar múltiplas réplicas até haver lock distribuído

## Recomendações Prioritárias

1. Extrair domínio de partida/ranking de `legacyCommands.js`
2. Introduzir lock distribuído com Redis ou Mongo-based lease
3. Criar fila de jobs para Riot API
4. Criar worker separado para jobs lentos
5. Adicionar testes automatizados para:
   - ranking
   - streak
   - auto-start
   - vitória concorrente
   - parse de comandos
6. Adicionar logging estruturado por comando e por match
7. Criar IDs de correlação por partida/lobby

## Estado Atual do Repositório

O repositório pode continuar sendo usado como base do projeto.

Este arquivo existe para servir como documento de contexto persistente para futuras interações com IA, revisão humana e onboarding técnico.

## Atualização de modularização

Handlers já extraídos para fora do fluxo principal de `legacyCommands.js`:

- `commands/handlers/matchCommandHandlers.js`
- `commands/handlers/queueCommandHandlers.js`
- `commands/handlers/victoryCommandHandlers.js`

Fluxos ativos já isolados em handlers/use-cases:

- `!entrar`
- `!start`
- `!vitoria`
- `!votar`
- `!reset`
- `!cancelarstart`
