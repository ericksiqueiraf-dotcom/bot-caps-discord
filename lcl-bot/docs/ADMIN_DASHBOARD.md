# Dashboard Admin Local

Painel local para revisar e ajustar o estado persistido do bot antes de publicar alteracoes no Railway.

## Como abrir

```bash
npm run admin:start
```

O painel sobe por padrao em `http://localhost:3030`.

Se quiser outra porta:

```bash
ADMIN_PORT=4040 npm run admin:start
```

No PowerShell:

```powershell
$env:ADMIN_PORT=4040
npm run admin:start
```

## O que a V1 permite

- visualizar panorama de jogadores, lobbies, partidas e temporada
- editar textos de onboarding e boas-vindas
- editar dados manuais de jogador
- recalcular seed do MMR interno
- remover jogador de lobby salvo
- excluir lobby salvo
- registrar resultado manual de partida no banco
- excluir partida ativa do estado salvo

## Escopo desta primeira versao

O dashboard trabalha no estado persistido do projeto.

Ele nao executa efeitos de Discord em tempo real, como:

- mover membros entre canais de voz
- apagar canais dinamicos no servidor
- sincronizar cargos
- publicar embeds e logs no Discord

Para esse tipo de operacao online, o ideal numa proxima etapa e acoplar o dashboard ao processo vivo do bot ou expor uma camada administrativa compartilhada.
