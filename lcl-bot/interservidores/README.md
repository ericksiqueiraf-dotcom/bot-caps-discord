# ⚔️ INTERSERVIDORES CAPS ARENA

Partidas personalizadas de League of Legends entre times de servidores Discord diferentes (N x J), hospedadas sempre na **CAPS ARENA** (servidor neutro).

## Como funciona (resumo)

1. O capitão de cada time registra a busca **no próprio servidor** (`!desafiar`).
2. Quando dois times se encontram, o bot cria categoria + texto + 2 vozes **na ARENA**, com os nomes de origem de cada time.
3. **Só então** o bot gera o convite da ARENA e manda por DM para os 10 jogadores.
4. Os times entram na ARENA, jogam, e o capitão lança o resultado (`!resultado-inter`).
5. Série **MD1** (1 jogo) ou **MD3** (melhor de 3, J1/J2 alternam lados, J3 só no 1-1 com sorteio).
6. Ranking inter **separado** do ranking interno. Ausência = **W.O.** (`!wo`).

## Pastas e arquivos do módulo

| Arquivo | Papel |
|---|---|
| `domain/inter/series.js` | Regras puras (lados, pontos, W.O.) |
| `application/use-cases/inter/interBusca.js` | Busca de times (FIFO), cancelamento, rollback |
| `application/use-cases/inter/interMatch.js` | Formação, resultado por jogo, W.O., ranking |
| `services/inviteService.js` | Criação de convite + DM com fallback |
| `commands/handlers/interCommandHandlers.js` | Discord: canais, invites, anúncios |
| `tests/inter.test.js` | 20 testes automatizados |
| `config.json → inter` | `arenaGuildId`, canais, timeouts, pontos |

## Documentos desta pasta

- `PASSO_A_PASSO.md` — do zero ao teste: instalação, configuração, permissões e roteiro de teste.
- `COMANDOS.md` — referência de todos os comandos (texto + slash).
- `INTERSERVIDORES-passo-a-passo.pdf` — este passo a passo em PDF.
