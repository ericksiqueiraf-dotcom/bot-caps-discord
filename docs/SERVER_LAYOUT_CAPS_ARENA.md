# Layout oficial — CAPS ARENA (modelo para CAPS BOT TESTRE)

> Fonte: guild `CAPS ARENA (1273653944169660427)` lida via API em 2026-10-10.
> Objetivo: replicar 1:1 no `CAPS BOT TESTRE (1558217291123138561)`.
> Convenção: `┃` nos canais de INFORMAÇÕES/COMPETITIVO, `・` nos demais.

## Categorias e canais

### 📢・INFORMAÇÕES
- TXT `👊┃cadastro` → `welcomeChannelId` (onboarding Jogo LoL / Não jogo LoL)
- TXT `👑┃parceiros`
- TXT `📘┃como-jogar`
- TXT `📜┃regras`
- TXT `📢┃comunicados`
- TXT `💡┃infos-lol`

### 💬・COMUNIDADE
- TXT `💬・geral-leagueoflegends`
- TXT `📋-sugestões`
- TXT `🎵・música`
- TXT `📳・grupo-whatsapp-caps`
- VOZ `Conversa` (sem limite)
- VOZ `⚒️ FLEX` (sem limite)
- VOZ `☠️ SoloQ` (sem limite)

### 🏆・COMPETITIVO
- TXT `🥇┃ranking` → `rankUpdatesChannelId`
- TXT `📋┃resultados` → `matchHistoryChannelId`
- TXT `🔥┃destaques` → `mvpAnnouncementsChannelId`
- TXT `🧍┃logs-jogadores` → `playerLogChannelId`
- TXT `⚔️┃logs-temporada` → `seasonLogChannelId`

### 🤖・BOT
- TXT `🤖・comandos`
- TXT `🧪・testes-bot`

### 🎮・JOGO
- TXT `⚔️・partidas` → `matchOngoingChannelId` (painel !votar com botões)
- TXT `🎮・fila` → `queueStatusChannelId` (roleta + status)
- VOZ `😶‍🌫️ Sala Classic` → `postMatchWaitingChannelId` (espera pós-jogo normal)
- VOZ `😶‍🌫️ Sala de espera - tier S` → `postMatchTierSWaitingChannelId`
- VOZ `🤼 Outros jogos`
- VOZ `☠️ TFT`
- VOZ `OFK`

### 🔊・VOZ (lobbies de entrada — só aqui vale `!entrar`)
- VOZ `🎮・lobby-classic` (limite 10) → `classicQueueChannelId`
- VOZ `🎮・lobby-tier S` (limite 10) → `classicTierSQueueChannelId`
- VOZ `🎮・lobby-aram` (limite 30) → `aramQueueChannelId`

## Cargos (ordem hierárquica, topo → base)
1. `👑 Admin`
2. `CAPS BOT LOL` (bot — precisa ficar acima de todos os cargos que ele gerencia)
3. `INFERNAL`
4. `🛠️ Moderador`
5. `🥇 Campeão Mensal`
6. `👑 Capitão de Customs` → `captainRoleId`
7. `⭐ MVP`
8. Elos: `Desafiante`, `Grão Mestre`, `Mestre`, `💎Diamante`, `Esmeralda`, `🔷Platina`, `🥇Ouro`, `🥈Prata`, `🥉Bronze`, `Ferro`
9. `TOP 10 CLASSIC`, `TOP 10 ARAM`
10. `Jogador Ativo` → `registeredPlayerRoleId`
11. Bots extras: `Zoe`, `KenaBot`, `Jockie Music`, etc.

## Regras de implementação no TESTRE
- `setup-servidor.js` deve usar ESSA planta (não a antiga 📥・ENTRADA / 📊・ARENA / 💎・CLUBE VIP).
- Canais de leitura do bot (`config.json`):
  - `queueStatusChannelId` = `🎮・fila`
  - `matchOngoingChannelId` = `⚔️・partidas`
  - `matchHistoryChannelId` = `📋┃resultados`
  - `mvpAnnouncementsChannelId` = `🔥┃destaques`
  - `playerLogChannelId` = `🧍┃logs-jogadores`
  - `seasonLogChannelId` = `⚔️┃logs-temporada`
  - `rankUpdatesChannelId` = `🥇┃ranking`
  - `welcomeChannelId` = `👊┃cadastro`
- Lobbies com `userLimit`: classic 10, tier S 10, aram 30.
- Bot acima de `Jogador Ativo` + `INFERNAL` + elos (Manage Roles + hierarquia).
- Script idempotente (procurar-ou-criar); categorias antigas do TESTRE ficam órfãs — limpar manualmente ou via script depois.
