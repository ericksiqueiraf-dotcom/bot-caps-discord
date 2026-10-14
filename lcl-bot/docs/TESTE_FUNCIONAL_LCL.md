# 🧪 Roteiro visual — Teste funcional do LCL BOT

> Tempo estimado: 20–30 min com 2 times de 5 (dá p/ simular com menos gente usando menções).
> Prefixo: `!` (slash `/` equivalentes existem: `/desafiar`, `/resultado-inter`, `/wo-inter`, `/inter-ranking`, `/inter-historico`).

## 0. Pré-requisitos (checklist)

- [ ] `lcl-bot` online no PM2 (`Bot conectado como LCL - LIGA CLANDESTINA DE LOL#8184`)
- [ ] Você com cargo **👑 Capitão de Customs** ou **Staff** (só eles operam `!desafiar`, `!resultado-inter`, `!wo`)
- [ ] Canais existem: `🔥・fila-lcl` · `⚔️・partidas-lcl` · `📋・resultados-lcl` · `🥇・ranking-lcl` + voz `🔥・lobby-clandestino LCL`
- [ ] 5 pessoas na call clandestina (ou use menções `@` p/ simular o elenco)

```
 Servidor
 ├── 🔥・LCL (categoria texto — só leitura p/ Jogador)
 │    ├── 🔥・fila-lcl        ← presença X/5 + botões Entrar/Sair Queue
 │    ├── ⚔️・partidas-lcl     ← convites, resultados, W.O.
 │    ├── 📋・resultados-lcl   ← séries fechadas
 │    └── 🥇・ranking-lcl      ← pontos MD1/MD3
 └── FILA (categoria voz)
      └── 🔥・lobby-clandestino LCL (limite 5) ← o time se reúne aqui
```

## 1. Saúde do bot (1 min)

| Onde | Comando | O que deve aparecer ✅ |
|---|---|---|
| qualquer canal | `!ping` | resposta do bot (latência) |
| qualquer canal | `!regrasdesafio` | embed com desafio, pontos, WO e comandos |

## 2. Fila clandestina — presença 5/5 (5 min)

1. Entre na call **`🔥・lobby-clandestino LCL`**.
2. No `🔥・fila-lcl`, clique em **Entrar Queue LCL**.
3. ✅ Embed mostra `1/5` com seu nome. Repita (ou peça p/ outros entrarem) até `5/5`.
4. ✅ Em `5/5`: embed marca **time fechado** e chama o Capitão p/ `!desafiar`.
5. Teste o botão **Sair Queue LCL** → ✅ contador volta (`4/5`).

## 3. Desafio MD1 — dois times se buscam (5 min)

```
 Time A (5 na call)              Time B (5 na call)
      │                               │
      │  !desafiar FENIX MD1          │  !desafiar LOBOS MD1
      ▼                               ▼
              🔥・fila-lcl: MATCH! (FIFO, mesma série)
                      │
                      ▼
        ⚔️・partidas-lcl: convite + lados
        Jogo 1: FENIX de AZUL × LOBOS de VERMELHO
```

| Onde | Comando | O que deve aparecer ✅ |
|---|---|---|
| call A | `!desafiar FENIX MD1` | `Time FENIX aguardando adversário` (waiting) |
| call B | `!desafiar LOBOS MD1` | `MATCH formado!` + embed em `⚔️・partidas-lcl` com Jogo 1 e lados AZUL/VERMELHO |
| — | `!desafiar LOBOS MD1` de novo | ❌ rejeitado (time já em busca/match) |

Variações que valem testar: `!desafiar FENIX MD1 @j1 @j2 @j3 @j4 @j5` (sem estar em call) e `!desafiar-cancelar` (sai da busca antes do match).

## 4. Resultado e placar (5 min)

| Onde | Comando | O que deve aparecer ✅ |
|---|---|---|
| `⚔️・partidas-lcl` | `!resultado-inter 1 AZUL` | Jogo 1 decidido; MD1 **fecha a série** (1 jogo basta) |
| `📋・resultados-lcl` | (automático) | embed da série fechada FENIX × LOBOS |
| `🥇・ranking-lcl` | `!inter-ranking` | vencedor com **+2 pts** (MD1); perdedor zerado |
| qualquer canal | `!inter-historico` | série aparece no histórico |

## 5. MD3 + W.O. (10 min, opcional)

```
 MD3: precisa de 2 vitórias
 Jogo 1 → !resultado-inter 1 AZUL     (1×0)
 Jogo 2 → !resultado-inter 2 VERM     (1×1)
 Jogo 3 → lados SORTEADOS, só libera após o 1×1
        → !resultado-inter 3 AZUL     (2×1 → +4 pts | 2×0 → +5 pts)
```

- ✅ Jogo 3 **travado antes do 1–1** (bot recusa).
- ✅ Pontuação: `2×0 = +5`, `2×1 = +4` (só vencedor pontua).
- `!wo` (ou `/wo-inter`): ✅ fecha a série em `1–0` (MD1) ou `2–0` (MD3) com marca de W.O. no ranking.

## 6. Permissões negativas (2 min, importante)

| Teste | Resultado esperado ✅ |
|---|---|
| Jogador comum roda `!desafiar` | ❌ `Só Capitão/Staff pode buscar partida` |
| `!resultado-inter 9 AZUL` (jogo inexistente) | ❌ `Jogo inválido ou já decidido` |
| `!resultado-inter 1 AMARELO` | ❌ `Use AZUL ou VERM` |
| Time com 4 na call + `!desafiar` | ❌ `O time precisa de 5 fixos` |

## 🆘 Troubleshooting rápido

| Sintoma | Causa provável |
|---|---|
| Bot não responde | `npx pm2 list` — `lcl-bot` offline? `pm2 restart lcl-bot --update-env` |
| `Só Capitão/Staff` p/ quem é capitão | cargo `captainRoleId` desatualizado no `lcl-bot/config.json` — rode `node instalar.js <GUILD_ID> lcl` |
| Call não vale p/ `!desafiar` | tem que ser a call `🔥・lobby-clandestino LCL` (ID em `voiceChannels.clandestinoQueueChannelId`) ou usar menções |
| Ranking não mexeu | ranking inter é **separado** do interno (`!placar` não muda) — confira `!inter-ranking` |
| Série não fecha no J3 | MD3 exige 1–1 antes do Jogo 3 (lados sorteados) |
