## Checklist de acesso no Discord

Use este checklist para fazer o servidor obedecer o fluxo novo:

1. `@everyone`
   Deixe acesso apenas aos canais e salas abertas.

2. Cargo de jogador cadastrado
   Configure o cargo em `config.json` -> `roles.registeredPlayerRoleId`.

3. Canais privados de texto
   Remova `View Channel` de `@everyone` e libere apenas para o cargo de jogador cadastrado.

4. Canais privados de voz
   Remova `View Channel` e `Connect` de `@everyone` e libere apenas para o cargo de jogador cadastrado.

5. Canais abertos
   Mantenha `View Channel` liberado para `@everyone` nas áreas que devem continuar públicas para quem não joga LoL.

6. Fluxo esperado
   Quem clicar em `Jogo LoL` precisa usar `!cadastrar Nick#TAG` para ganhar o cargo e liberar o acesso completo.
   Quem clicar em `Nao jogo LoL` continua sem cargo e fica apenas com as áreas abertas.

7. Fila protegida
   Mesmo que alguém tente usar `!entrar`, o bot agora exige cadastro prévio antes de aceitar entrada em fila.
