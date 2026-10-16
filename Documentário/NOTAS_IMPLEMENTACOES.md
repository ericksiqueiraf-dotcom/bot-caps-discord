# Bloco de Notas — Implementações do CAPS BOT

Documento vivo: cada implementação feita no bot, com descrição detalhada,
comandos, regras e arquivos envolvidos. Tudo aplicado em TESTRE
(`CAPS BOT TESTRE`, git) e espelhado na produção (`BOT CAPS DISCORD`).

Última atualização: 2026-10-16.

---

## 1. Comandos de sala temporária (hub `➕・criar-sala`)

**O que é:** quem entra no canal `➕・criar-sala` ganha uma sala de voz própria
(criada e movida automaticamente). O dono gerencia a sala por comandos.

| Comando | Uso | Quem pode |
|---|---|---|
| `!salahub` (+ `/salahub`) | Lista salas ativas (nome, dono, ocupação; 🔒 se trancada) | qualquer um |
| `!sala` (+ `/sala`) | Mostra sua sala atual | dono |
| `!sala <nome>` (+ `/sala nome:`) | Renomeia sua sala | dono ou Admin |
| `!convidar @usuário` (+ `/convidar`) | Move quem está em voz p/ sua sala; manda DM p/ quem está fora | dono ou Admin |
| `!limparvoz` (+ `/limparvoz`) | Apaga sua sala (usar dentro dela) | dono ou Admin |
| `!salalock` (+ `/salalock`) | Tranca a sala (ninguém novo entra); `!salalock abrir` destranca | dono ou Admin |
| `!salalimit <0-99>` (+ `/salalimit`) | Limite de usuários (0 = sem limite) | dono ou Admin |
| `!salaexpulsar @usuário` (+ `/salaexpulsar`) | Remove alguém da sala (não expulsa a si/bots; só quem está na sala) | dono ou Admin |

**Regras:**
- Dono = quem criou a sala (registro persistente em `database/tempVoiceRooms.json`, sobrevive restart).
- Sala vazia é apagada sozinha após `tempVoice.deleteDelaySeconds` (60s padrão) e o registro é limpo junto (auto-delete + evento `channelDelete`).
- Trancar = tira `Connect` dos cargos permitidos; o dono sempre entra.
- Quem pode criar sala: cargos em `config.tempVoice.allowedRoleNames/allowedRoleIds` (Capitão, Staff/Moderador, VIP, Lendário) + Administradores.
- Salas novas nascem na **mesma categoria do hub** (hoje: `💎・CLUBE VIP`, padrão no `server-pattern.json`).

**Arquivos:** `services/tempVoiceService.js`, `commands/legacyCommands.js`, `index.js` (prefixo + slash + listeners `voiceStateUpdate`/`channelDelete`), `server-pattern.json` (HUB em CLUBE VIP), `database/tempVoiceRooms.json`.

---

## 2. Clube VIP (assinatura PIX)

**Tiers e preços** (`config.clubePagamentos`, 30 dias cada):

| Tier | Preço | Benefícios |
|---|---|---|
| 💜 Apoiador R$ 9,99 | 9,99 | Lounge VIP, selo no perfil/ranking, boas-vindas |
| ⭐ VIP R$ 16,90 | 16,90 | Tudo do Apoiador + criar sala temporária e comandos de dono (`!sala`, `!convidar`, `!salalock`, `!salalimit`, `!salaexpulsar`, `!limparvoz`) |
| 👑 Lendário R$ 21,90 | 21,90 | Tudo do VIP + `!live` (divulgar stream c/ ping, cooldown por tier) + destaque + topo da lista |

**Regra de ouro (no embed):** o clube NÃO dá vantagem em fila, sorteio, PDL ou vitória.

**Fluxo:** `!clube` → botão Assinar → modal de e-mail → QR PIX + copia-e-cola (30 min) → webhook aprova → cargo automático + DM + anúncio. Renovação com **-10%**. Expiração e lembretes rodam no scheduler diário.

**Comandos de gestão (staff):**
- `!clubeadmin` (+ `/clubeadmin`) — assinaturas ativas por tier com vencimento de cada uma.
- `!clubefixar` (+ `/clubefixar`) — posta e fixa o embed de benefícios detalhados no `#clube-vip` (apaga fixada anterior igual).

**Arquivos:** `services/clubePaymentsService.js`, `commands/legacyCommands.js`, `utils/lobbyUtils.js` (`buildClubeEmbed`, `buildClubeDetalEmbed`), `index.js`.

---

## 3. `!live` por tier

Divulgar stream (Twitch/YouTube/Kick) com ping no cargo 🔴 Ao Vivo:

| Tier | Cooldown |
|---|---|
| 👑 Lendário | 6h |
| ⭐ VIP | 12h |
| 💜 Apoiador | 24h |
| Sem clube | bloqueado |

**Comandos:** `!live <link>` • `!querolive` (entrar/sair do ping). Tabela em `LIVE_COOLDOWN_BY_TIER_MS`.

---

## 4. Eventos automáticos

### 4a. SEXTA CAPS ARENA (toda sexta, 08h–23h59 SP)
- Às 08h o bot anuncia nos canais de partidas/fila; até 23h59 as **vitórias valem PDL em dobro** (derrota perde normal).
- Às 23h59 posta **top 3 da noite + melhor da noite**.
- Implementação: `services/eventoService.js` (janela por fuso SP, multiplicador via hook opcional no `registerVictory`, ranking da noite em `systemMeta.sextaRank`, scheduler de 30s com flags anti-duplo).

### 4b. Fim de semana LCL (sex 08h → dom 23h59 SP)
- Sexta 08h: abre a fila LCL ARENA, **liga o processo `lcl-bot`** e anuncia.
- Sex–dom: partidas interservidores no canal `🔥・lobby-clandestino`.
- Domingo 23h59: posta o **ranking do fim de semana** (séries inter fechadas na janela, lidas do banco LCL) e **desliga o `lcl-bot`**. Se o bot estava fora, fecha tardio na segunda, 1x só.
- Fora da janela o LCL BOT fica parado (economia + fila fechada).

---

## 5. Torneio CAPS ARENA (`!torneio` + `/torneio`)

Mata-mata com sorteio por rodada, inscrição **individual**:

- `!torneio entrar/sair/lista/info/status` (jogadores).
- Staff: `!torneio novo [edição]`, `sortear`, `resultado <jogo> <1|2>` / `resultado FINAL <1|2>`, `encerrar`.
- **Regras:** mínimo 20 inscritos, múltiplo de 10; cada rodada monta 5x5 balanceados; perdedores saem, vencedores avançam; se não fechar 10, **repescagem** dos melhores perdedores (maior elo); **final = 1 sorteio, mesmos times, MD3**; campeões ganham o cargo 🏆 (rotativo) + anúncio. Premiação extra a decidir.
- Estado em `systemMeta.torneio`; serviço puro em `services/torneioService.js`.

---

## 6. Captação de membros

- **`!convite` + `!topconvites`** (+ slash): link pessoal por membro; atribuição por diff de usos; anti-fraude (conta <7 dias não conta, saída em 24h estorna, 1 ponto por membro). Metas: **3** = cargo 🌱 Recrutador, **5** = destaque na Arena, **10** = 7 dias de ⭐ VIP grátis (expira sozinho). Ranking mensal (zera dia 1º).
- **Boas-vindas que vendem:** texto de conversão ("sua vaga está esperando", 2 minutos) + botão verde **⚡ Quero jogar agora** (abre o cadastro direto).

---

## 7. Fila: botões e balance

- Painel do `#fila` (reconstruído no boot): **Entrar Queue CAPS / ARAM / TIERS / Esperar Fila / Sair da Fila**.
  - TIERS exige estar no `Lobby TIER S` (avisa se não estiver; elo Esmeralda IV+ validado no fluxo).
  - Esperar Fila = `!espera` (mostra posição em privado).
- **Balance exaustivo:** times 5x5 com diferença mínima garantida (testa as 126 divisões). Equilibra a **soma dos elos** — com lobby misto, algum time sempre fica com o elo alto + elos baixos; o PDL compensa (ganhar de time mais forte vale mais).

---

## 8. Regras e guias

- `!ajuda` = só jogador (fila, ranking, clube, salas, torneio). Comandos de staff ficam só no **`!staff`** (partida, roleta, limpeza, PDL, elos, temporada, clube, LCL).
- `!regras` (regulamento), `!onboarding` (guia fixo do `#como-jogar`, admin).
- **INFERNAL 🔥:** 5 wins seguidas, vale até 08h do dia seguinte; posição 5 da `!espera`; imune à roleta.
- **MVP:** votação de 2 min no canal de destaques após cada partida.
- **Temporada oficial:** `!resetgeral` + `!iniciartemporada` (Admin, antes dos primeiros jogos); 10 jogos p/ aparecer no ranking; atualização diária 08h no `#ranking`.
- **Trava level 30:** `!cadastrar`/`!nick` barram conta abaixo de `config.cadastro.minSummonerLevel` (fail-open se o level vier desconhecido).
- **AFK:** canal `🥱Ausente`, timeout 5 min (nativo do Discord; registrado no padrão com `preserve`).
- **Filtro de servidor:** `config.allowedGuildIds` — lista vazia = responde em todo servidor; preenchida = só neles.

---

## 9. Infra e padrões (não esquecer)

- **2 ambientes, mesmo código:** TESTRE (`CAPS BOT TESTRE`, git) espelhado na produção (`BOT CAPS DISCORD`). Produção NÃO está no git — mudanças vão por cópia + restart.
- **PM2:** `caps-bot` (oficial), `caps-bot-teste`, `lcl-bot` (só fds), `caps-admin`/`caps-admin-teste`/lcl-admin. Restart sempre com `--update-env`.
- **Banco:** Mongo local (Docker `caps-mongo`) com fallback p/ JSON em `database/`. Se o Docker cair, o bot usa JSON — **não misturar**: partidas criadas no fallback precisam ser migradas (`currentMatch`) quando o Mongo voltar.
- **NUNCA rodar `setup-servidor.js` completo no oficial sem `--dry-run`**: ele reescreve permissões e apagaria customizações locais (canais da COMUNIDADE, categoria `👩‍👩‍👦‍👦 FILA`, canal LCL). Correções de permissão = cirúrgicas via API.
- **Testes:** `npm test` na TESTRE (suíte verde; cobre filas, roleta, clube, eventos, torneio, convites, balance).
- **Divulgação:** `!clubefixar` (benefícios), `!clube` (assinatura), JSONs de imagem seguem o padrão 1080x1350 (cabeçalho dourado + blocos + rodapé).
