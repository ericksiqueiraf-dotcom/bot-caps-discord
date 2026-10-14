# Workers

Esta pasta foi criada para preparar a separacao de tarefas assincronas do processo principal do bot.

## Alvos futuros

- fila de requisicoes para a Riot API
- retry com backoff para erros temporarios
- jobs de sincronizacao de ranking
- processamentos de historico e temporada fora do ciclo do comando

## Estado atual

Ainda nao existe worker dedicado em producao.

O projeto continua processando tudo no processo principal do bot, mas esta pasta serve como
ponto de entrada para a proxima fase de escalabilidade.
