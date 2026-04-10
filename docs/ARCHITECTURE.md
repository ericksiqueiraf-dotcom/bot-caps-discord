# Arquitetura do BOT CAPS DISCORD

## Objetivo desta estrutura

Esta pasta documenta a modularizacao em andamento do projeto para reduzir acoplamento,
facilitar manutencao e preparar o bot para futuras extracoes de workers e APIs separadas.

## Estado atual

Hoje o projeto ainda roda como monolito Node.js, mas ja esta sendo reorganizado em camadas:

- `domain/`: regras puras de negocio, constantes e resolucao de modos/formatos
- `application/`: casos de uso que orquestram o dominio e a persistencia
- `commands/handlers/`: handlers menores para desacoplar o arquivo legado
- `services/`: persistencia, Riot API e balanceamento
- `commands/`: adaptador de comandos do Discord
- `utils/`: helpers legados ainda em processo de extracao
- `workers/`: ponto de entrada para jobs assincronos futuros
- `docs/`: documentacao tecnica e contexto do projeto

## Direcao alvo

### 1. Domain

Responsavel por:

- definicoes de modo e formato
- regras de ranking
- resolucao de buckets de streak
- politicas de temporada
- validacoes de fluxo de lobby e match

Regra:

- nao deve depender de Discord
- nao deve depender diretamente de Mongo

### 2. Adapters

Responsavel por:

- Discord (`commands/`, parte de `index.js`)
- Riot API (`services/riotService.js`)
- persistencia (`services/dataService.js`)

Regra:

- converte eventos externos em chamadas de dominio
- evita concentrar regra de negocio aqui

### 2.1. Application / Use Cases

Responsavel por:

- orquestrar `entrar`, `start` e `vitoria`
- concentrar fluxos de negocio reutilizaveis
- preparar extracao futura para API ou workers

Modulos criados nesta fase:

- `application/use-cases/enterQueue.js`
- `application/use-cases/startMatch.js`
- `application/use-cases/registerVictory.js`
- `application/use-cases/resetSystem.js`
- `application/use-cases/cancelActiveMatch.js`
- `application/use-cases/castVictoryVote.js`
- `commands/handlers/matchCommandHandlers.js`
- `commands/handlers/queueCommandHandlers.js`
- `commands/handlers/victoryCommandHandlers.js`

### 3. Workers

Responsavel por:

- fila de atualizacao com Riot API
- retries e backoff
- tarefas lentas ou agendadas
- sincronizacoes nao bloqueantes

Hoje ainda nao existe worker rodando em separado, mas a pasta foi reservada para isso.

## Primeira modularizacao aplicada

Nesta etapa foram extraidos:

- `domain/constants/queueModes.js`
- `domain/constants/queueFormats.js`
- `domain/queue/selection.js`
- `domain/ranking/playerStats.js`
- `application/use-cases/enterQueue.js`
- `application/use-cases/startMatch.js`
- `application/use-cases/registerVictory.js`
- `application/use-cases/resetSystem.js`
- `application/use-cases/cancelActiveMatch.js`
- `application/use-cases/castVictoryVote.js`

Esses modulos centralizam:

- modos validos
- formatos validos de ARAM
- agrupamento de top streak
- parse de modo/formato a partir dos argumentos do usuario
- normalizacao de modos por jogador
- calculo de ranking geral e top streak
- orquestracao limpa dos fluxos de `!entrar`, `!start`, `!votar` e `!vitoria`

## Proximas extracoes recomendadas

1. Mover regras de temporada para `domain/season/`
2. Criar um `application/` ou `use-cases/` para `entrar`, `start`, `vitoria`, `reset`
3. Isolar os adapters do Discord em handlers menores por comando
4. Introduzir fila de jobs para Riot API em `workers/`
5. Separar os builders de embed em uma camada de apresentacao propria
