# Plano de Implementação: ranking-enhancements

## Visão Geral

Implementação incremental das melhorias de ranking no bot-caps-discord. As mudanças são aditivas e se concentram em `utils/lobbyUtils.js`, `commands/legacyCommands.js`, `index.js` e `config.json`.

## Tasks

- [x] 1. Adicionar campos de canal de log ao config.json
  - Adicionar `playerLogChannelId` e `seasonLogChannelId` dentro de `textChannels` em `config.json` com valores vazios (`""`)
  - _Requirements: 4.3, 5.3_

- [x] 2. Implementar helpers de streak e decoração de embeds em lobbyUtils.js
  - [x] 2.1 Implementar `getRankedPlayersByStreak(statsData, mode, format)`
    - Filtrar jogadores com `winStreak >= 1` do resultado de `getRankedPlayersByMode`
    - Ordenar por `winStreak` desc, `customWins` desc; retornar no máximo 10 entradas
    - _Requirements: 3.1, 3.4, 3.6_

  - [ ]* 2.2 Escrever teste de propriedade para `getRankedPlayersByStreak`
    - **Property 4: Top Streak ordenado e filtrado corretamente**
    - **Validates: Requirements 3.1, 3.4, 3.6**

  - [x] 2.3 Implementar `decorateWithLeaderIcons(entries, rankedPlayers)`
    - Identificar `maxStreak` entre os jogadores; se `>= 1`, adicionar `🔥` a todos com `winStreak === maxStreak`
    - Adicionar `👑` ao jogador na posição 0
    - Retornar `{ decoratedEntries, streakFooter }` onde `streakFooter` segue o formato `🔥 Maior Streak Ativa: <nickname> (<N> vitórias seguidas)` ou `null`
    - _Requirements: 1.1, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 2.4 Escrever teste de propriedade para `decorateWithLeaderIcons` — Property 1
    - **Property 1: Rank Leader sempre recebe 👑**
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 2.5 Escrever teste de propriedade para `decorateWithLeaderIcons` — Property 2
    - **Property 2: Streak Leader(s) recebem 🔥 e campo de rodapé**
    - **Validates: Requirements 2.1, 2.2, 2.4**

  - [ ]* 2.6 Escrever teste de propriedade para `decorateWithLeaderIcons` — Property 3
    - **Property 3: Ícones combinados quando Rank Leader = Streak Leader**
    - **Validates: Requirements 2.5**

- [x] 3. Integrar `decorateWithLeaderIcons` nos embeds existentes
  - [x] 3.1 Modificar `buildTopTenEmbed` para chamar `decorateWithLeaderIcons` antes de montar os fields e adicionar `streakFooter` como field extra quando não-nulo
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Modificar `buildLeaderboardEmbed` da mesma forma
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 4. Checkpoint — Garantir que os embeds de ranking estão corretos
  - Garantir que todos os testes passam, tirar dúvidas com o usuário se necessário.

- [x] 5. Implementar `buildTopStreakEmbed` e handler `handleTopStreakCommand`
  - [x] 5.1 Implementar `buildTopStreakEmbed(statsData, mode, format)` em `lobbyUtils.js`
    - Chamar `getRankedPlayersByStreak`; se vazio, retornar embed com mensagem "Não há sequências ativas no momento."
    - Para cada jogador exibir: posição, `<@discordId>`, nickname, `winStreak`, total W/D no modo
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 5.2 Implementar `handleTopStreakCommand(message, args)` em `legacyCommands.js`
    - Parsear args para modo (classic/aram) e formato (1x1)
    - Chamar `buildTopStreakEmbed` e enviar via `sendToMessageChannel`
    - Exportar a função no módulo
    - _Requirements: 3.1, 3.2_

  - [x] 5.3 Registrar slash command `/topstreak` em `index.js`
    - Adicionar `SlashCommandBuilder` com opções `modo` e `formato` (igual ao `/top10`)
    - Adicionar case `'topstreak'` no switch de `interactionCreate`
    - Adicionar case `'topstreak'` no switch de `processCommand`
    - _Requirements: 3.1, 3.2_

- [x] 6. Implementar Player Log Channel
  - [x] 6.1 Implementar `buildPlayerMatchLogEmbed(player, delta, match)` em `lobbyUtils.js`
    - Embed com: menção Discord, nickname, modo, resultado (vitória/derrota), MMR antes/depois, W/D atualizado, `winStreak` atual e timestamp `dd/MM/yyyy HH:mm` no fuso de São Paulo
    - _Requirements: 4.2, 4.5_

  - [ ]* 6.2 Escrever teste de propriedade para `buildPlayerMatchLogEmbed`
    - **Property 5: Player Log contém todos os campos obrigatórios**
    - **Validates: Requirements 4.2, 4.5**

  - [x] 6.3 Implementar `postPlayerLogs(guild, matchResult, statsData)` em `lobbyUtils.js`
    - Ler `config.textChannels.playerLogChannelId`; retornar silenciosamente se ausente ou canal não encontrado
    - Para cada jogador em `matchResult.playerDeltas`, chamar `buildPlayerMatchLogEmbed` e postar no canal com `.catch(() => null)`
    - _Requirements: 4.1, 4.3, 4.4_

- [x] 7. Implementar Season Log Channel
  - [x] 7.1 Implementar `postMatchSummaryToSeasonLog(guild, matchResult)` em `lobbyUtils.js`
    - Ler `config.textChannels.seasonLogChannelId`; retornar silenciosamente se ausente ou canal não encontrado
    - Embed com: modo, lobby (letra), Time 1, Time 2, vencedor e variação média de MMR de cada time
    - Não incluir variação individual por jogador
    - _Requirements: 5.5, 5.6_

  - [ ]* 7.2 Escrever teste de propriedade para `postMatchSummaryToSeasonLog`
    - **Property 6: Season Log de partida contém todos os campos obrigatórios**
    - **Validates: Requirements 5.5**

  - [x] 7.3 Implementar `postSeasonSummaryToSeasonLog(guild, archivedSeason)` em `lobbyUtils.js`
    - Ler `config.textChannels.seasonLogChannelId`; retornar silenciosamente se ausente ou canal não encontrado
    - Embed com: número/label da temporada, data de início, data de encerramento, Top 5 por MMR em cada modo (Classic, ARAM, ARAM 1x1) e total de partidas jogadas
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 7.4 Escrever teste de propriedade para `postSeasonSummaryToSeasonLog`
    - **Property 7: Season Log de temporada contém todos os campos obrigatórios**
    - **Validates: Requirements 5.2**

- [x] 8. Integrar chamadas de log em `handleVictoryCommand` e `handleSeasonResetCommand`
  - [x] 8.1 Modificar `handleVictoryCommand` em `legacyCommands.js`
    - Construir o objeto `matchResult` com `playerDeltas` (mmrBefore, mmrAfter, result, winStreak), `teamOneAvgDelta` e `teamTwoAvgDelta` após salvar as stats
    - Chamar `postPlayerLogs(guild, matchResult, statsData)` e `postMatchSummaryToSeasonLog(guild, matchResult)` em paralelo com `Promise.all`
    - _Requirements: 4.1, 4.2, 5.5_

  - [x] 8.2 Modificar `handleSeasonResetCommand` em `legacyCommands.js`
    - Após `archiveCurrentSeason`, chamar `postSeasonSummaryToSeasonLog(guild, archivedSeason)`
    - _Requirements: 5.1, 5.2_

- [x] 9. Exportar novas funções de `lobbyUtils.js` e `legacyCommands.js`
  - Adicionar ao `module.exports` de `lobbyUtils.js`: `getRankedPlayersByStreak`, `decorateWithLeaderIcons`, `buildTopStreakEmbed`, `buildPlayerMatchLogEmbed`, `postPlayerLogs`, `postMatchSummaryToSeasonLog`, `postSeasonSummaryToSeasonLog`
  - Adicionar ao `module.exports` de `legacyCommands.js`: `handleTopStreakCommand`
  - _Requirements: 3.1, 4.1, 5.1_

- [ ] 10. Checkpoint final — Garantir que todos os testes passam
  - Garantir que todos os testes passam, tirar dúvidas com o usuário se necessário.

## Notas

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia os requisitos específicos para rastreabilidade
- Os testes de propriedade usam **fast-check** com mínimo de 100 iterações
- Cada teste de propriedade deve incluir o comentário: `// Feature: ranking-enhancements, Property <N>: <texto>`
- Todas as funções de postagem de log devem falhar silenciosamente (`.catch(() => null)`) para não impactar o fluxo principal
