# Requirements Document

## Introduction

Este documento descreve as melhorias no sistema de ranking do bot de Discord de League of Legends (bot-caps-discord). As funcionalidades incluem: destaque visual para o líder e para o jogador com maior winStreak ativa no ranking, um novo ranking Top 10 de maiores sequências de vitórias, um canal dedicado a logs individuais por jogador e um canal dedicado a logs de campeonato/temporada.

O bot já possui: sistema de `winStreak` por modo salvo no MongoDB, comandos `!top10` e `!placar`, canal de `matchHistory`, canal de `mvpAnnouncements` e sistema de temporadas com `archiveCurrentSeason`.

## Glossary

- **Bot**: O bot de Discord bot-caps-discord.
- **Ranking_Embed**: O embed Discord gerado pelos comandos `!top10` e `!placar`.
- **WinStreak**: Sequência de vitórias consecutivas ativas de um jogador em um determinado modo de jogo, armazenada no campo `winStreak` dentro do objeto `modes` do jogador.
- **Streak_Leader**: O jogador com o maior valor de `winStreak` ativa entre todos os jogadores ranqueados no modo consultado.
- **Rank_Leader**: O jogador na primeira posição do ranking por MMR interno no modo consultado.
- **Top10_Streak_Embed**: Embed Discord que exibe os 10 jogadores com maiores sequências de vitórias consecutivas ativas.
- **Player_Log_Channel**: Canal de texto do Discord dedicado ao histórico individual de partidas por jogador.
- **Season_Log_Channel**: Canal de texto do Discord dedicado a resumos de temporada e resultados gerais de campeonato.
- **Match_History_Log**: Registro de uma partida finalizada postado em canal de texto.
- **Season_Archive**: Snapshot dos dados de uma temporada encerrada, gerado pela função `archiveCurrentSeason`.
- **Staff**: Membro do Discord com permissão `ManageMessages` ou superior.
- **Admin**: Membro do Discord com permissão `Administrator`.

---

## Requirements

### Requirement 1: Destaque do Líder de Ranking (Rank Leader)

**User Story:** Como jogador, quero que o primeiro colocado do ranking tenha um ícone de destaque visual, para que seja fácil identificar quem está no topo.

#### Acceptance Criteria

1. WHEN o Ranking_Embed é gerado pelos comandos `!top10` ou `!placar`, THE Bot SHALL exibir um ícone de coroa (`👑`) ao lado do nome do jogador na primeira posição do ranking.
2. WHEN o Ranking_Embed é gerado e há menos de 1 jogador ranqueado no modo consultado, THE Bot SHALL exibir a mensagem de ranking vazio sem ícone de coroa.
3. THE Ranking_Embed SHALL manter os ícones de medalha existentes (`🥇`, `🥈`, `🥉`) para as posições 1, 2 e 3, adicionando o ícone de coroa exclusivamente ao primeiro colocado.

---

### Requirement 2: Destaque do MVP de WinStreak no Ranking

**User Story:** Como jogador, quero ver quem tem a maior sequência de vitórias ativa no ranking, para que eu possa identificar o jogador em melhor momento de forma.

#### Acceptance Criteria

1. WHEN o Ranking_Embed é gerado e existe pelo menos um jogador com `winStreak >= 1`, THE Bot SHALL identificar o Streak_Leader e exibir um ícone de chama (`🔥`) ao lado do nome desse jogador no embed.
2. WHEN o Ranking_Embed é gerado e múltiplos jogadores compartilham o mesmo valor máximo de `winStreak`, THE Bot SHALL exibir o ícone de chama (`🔥`) em todos os jogadores empatados na maior sequência.
3. WHEN o Ranking_Embed é gerado e nenhum jogador possui `winStreak >= 1`, THE Bot SHALL não exibir o ícone de chama em nenhum jogador.
4. THE Ranking_Embed SHALL exibir o valor numérico da `winStreak` do Streak_Leader em um campo separado no rodapé do embed, no formato `🔥 Maior Streak Ativa: <nickname> (<N> vitórias seguidas)`.
5. WHEN o Rank_Leader e o Streak_Leader são o mesmo jogador, THE Bot SHALL exibir ambos os ícones (`👑🔥`) ao lado do nome desse jogador.

---

### Requirement 3: Ranking Top 10 de WinStreak

**User Story:** Como jogador, quero ver um ranking dos 10 jogadores com maiores sequências de vitórias consecutivas ativas, para que eu possa acompanhar quem está em melhor sequência no campeonato.

#### Acceptance Criteria

1. WHEN o comando `!topstreak` é executado, THE Bot SHALL responder com o Top10_Streak_Embed contendo os 10 jogadores com maior `winStreak` ativa no modo consultado.
2. WHEN o comando `!topstreak aram` é executado, THE Bot SHALL filtrar os jogadores pelo modo ARAM ao construir o Top10_Streak_Embed.
3. THE Top10_Streak_Embed SHALL exibir para cada jogador: posição, menção Discord, nickname, valor de `winStreak` e total de vitórias/derrotas no modo.
4. THE Top10_Streak_Embed SHALL ordenar os jogadores em ordem decrescente de `winStreak`; em caso de empate, o critério de desempate SHALL ser o maior número de vitórias totais no modo.
5. WHEN o comando `!topstreak` é executado e nenhum jogador possui `winStreak >= 1`, THE Bot SHALL responder com mensagem informando que não há sequências ativas no momento.
6. WHEN o comando `!topstreak` é executado, THE Bot SHALL incluir apenas jogadores com `winStreak >= 1` no Top10_Streak_Embed.

---

### Requirement 4: Canal de Logs Individuais por Jogador (Player Log Channel)

**User Story:** Como jogador, quero ter um canal dedicado ao meu histórico de partidas individuais, para que eu possa acompanhar minha evolução partida a partida.

#### Acceptance Criteria

1. WHEN uma partida é finalizada via comando `!vitoria`, THE Bot SHALL postar um Match_History_Log no Player_Log_Channel para cada jogador participante da partida.
2. THE Match_History_Log de cada jogador SHALL conter: menção Discord, nickname, modo de jogo, resultado (vitória/derrota), variação de MMR (antes e depois), recorde W/L atualizado e `winStreak` atual após a partida.
3. THE Bot SHALL utilizar o `playerLogChannelId` definido em `config.json` como identificador do Player_Log_Channel.
4. IF o `playerLogChannelId` não estiver configurado em `config.json`, THEN THE Bot SHALL omitir o envio dos logs individuais sem lançar erro.
5. WHEN o Match_History_Log é postado no Player_Log_Channel, THE Bot SHALL incluir o timestamp da partida no formato `dd/MM/yyyy HH:mm` no fuso horário de São Paulo.

---

### Requirement 5: Canal de Logs de Campeonato/Temporada (Season Log Channel)

**User Story:** Como administrador, quero ter um canal dedicado a resumos de temporada e resultados gerais, para que o histórico do campeonato fique organizado e acessível.

#### Acceptance Criteria

1. WHEN uma temporada é encerrada via comando `!resetgeral`, THE Bot SHALL postar um resumo da Season_Archive no Season_Log_Channel.
2. THE resumo de temporada postado no Season_Log_Channel SHALL conter: número/label da temporada, data de início, data de encerramento, Top 5 jogadores por MMR em cada modo (Classic, ARAM, ARAM 1x1) e total de partidas jogadas na temporada.
3. THE Bot SHALL utilizar o `seasonLogChannelId` definido em `config.json` como identificador do Season_Log_Channel.
4. IF o `seasonLogChannelId` não estiver configurado em `config.json`, THEN THE Bot SHALL omitir o envio do resumo de temporada sem lançar erro.
5. WHEN uma partida é finalizada via comando `!vitoria`, THE Bot SHALL postar um resumo geral da partida no Season_Log_Channel contendo: modo, lobby, times, vencedor e variação média de MMR dos times.
6. THE resumo de partida no Season_Log_Channel SHALL ser distinto do log detalhado por jogador do Player_Log_Channel, contendo apenas dados agregados da partida.
