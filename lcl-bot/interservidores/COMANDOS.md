# ⚔️ INTERSERVIDORES — Referência de comandos

Todos exigem cargo **Capitão** ou Staff, exceto consulta.

> Guia rápido no Discord: `!ajudalcl` ou `/ajudalcl`.

## Compartilhado da fila interna (Admin)

```
!shared on|off|status
```

- `on`: o servidor entra no pool shared por modo/formato (destino eleito por maioria, convite só no match pronto).
- `off` (padrão): fila local, comportamento de sempre.
- Slash: `/shared modo:<on|off|status>`

## Buscar partida inter (ARENA)

```
!desafiar [MD1|MD3] <nome do time> [@p2 @p3 @p4 @p5]
```

- **Com menções:** você + 4 marcados = 5 fixos. Ex.: `!desafiar MD1 TimeN @ana @bia @cao @dan`
- **Pela call de voz:** junte os 5 na mesma call e rode `!desafiar MD1 TimeN` (a sala vira o time).
- `MD1` = desafio único (padrão se omitido). `MD3` = melhor de 3.
- Resposta: `na busca, posição N` (aguardando adversário) ou `MATCH FORMADO` (achou par).

Slash: `/desafiar nome:<nome> jogador2..5:<@> serie:<MD1|MD3>`

## Cancelar busca

```
!desafiar-cancelar
```

Sai da busca em espera (só antes de formar match).

## Lançar resultado

```
!resultado-inter [jogo] AZUL|VERM
```

- Ex.: `!resultado-inter 1 AZUL` — time do lado azul venceu o jogo 1.
- Sem número, vale o próximo jogo em aberto.
- MD3: Jogo 2 usa lados invertidos; Jogo 3 só em 1-1 (lados sorteados na hora).
- Série fechada: anuncia campeão, pontua, apaga as salas.

Slash: `/resultado-inter vencedor:<AZUL|VERMELHO> jogo:<1-3>`

## W.O.

```
!wo [A|B]
```

- Sem letra: o ausente é o time que **não** contém quem digitou.
- Fecha a série para o presente (1-0 MD1, 2-0 MD3) e apaga as salas.

Slash: `/wo-inter ausente:<Time A|Time B>`

## Consultas (todos podem usar)

```
!inter-ranking    → top 10 (pontos, MD1 V/D, MD3 V/D, jogos, WOs)
!inter-historico  → últimas 8 séries fechadas
```

Slash: `/inter-ranking`, `/inter-historico`

## Pontuação (configurável em `config.json → inter`)

- MD1 vencida: **3 pts** (`md1WinPoints`)
- MD3 vencida: **5 pts** (`md3SeriesPoints`) + **1 pt por jogo vencido** (`md3GamePoint`, vale para os dois lados)
- W.O. conta como série vencida (sem ponto extra de jogo)
