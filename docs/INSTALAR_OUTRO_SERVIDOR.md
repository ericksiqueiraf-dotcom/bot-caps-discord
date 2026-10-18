# Instalar o CAPS ARENA / LCL BOT em outro Discord (1 clique)

**Arquivo:** `INSTALAR.bat` (na raiz desta pasta) → **duplo clique**.

Ele faz o trabalho todo, em ordem, e pode ser rodado quantas vezes quiser (é idempotente — não apaga nada que já existe).

## O que ele faz

| Etapa | O que acontece |
|---|---|
| 1/4 | `npm install` no CAPS e, se for o caso, no `lcl-bot` |
| 2/4 | Confere o `.env`. Se faltar o `DISCORD_TOKEN`, **pede para você colar** e grava (sem apagar as outras variáveis) |
| 3/4 | **Para o bot no PM2** — obrigatório: o setup entra no Discord com o mesmo token do bot, e dois logins com o mesmo token brigam entre si |
| 4/4 | Roda `instalar.js` → aplica o `server-pattern.json`: **cargos, categorias, canais, permissões e painéis fixados** |
| + | Pergunta se pode **subir o bot no PM2** (`caps-bot` / `lcl-bot`) e faz `pm2 save` |

## Passo a passo

1. **Crie a aplicação do bot** (só se for um bot novo): [discord.com/developers/applications](https://discord.com/developers/applications) → *New Application* → aba **Bot** → *Reset Token* → **copie o token**. Ative os *Privileged Gateway Intents*: **Server Members** e **Message Content**.
2. **Duplo clique** em `INSTALAR.bat`.
3. Escolha o bot: `1` CAPS · `2` LCL · `3` **AMBOS** (recomendado quando os dois vão no mesmo servidor).
4. Cole o **ID do servidor** (Discord → Configurações → Avançado → *Modo desenvolvedor* ligado → botão direito no servidor → *Copiar ID do servidor*).
5. Quando o script mostrar o **link de convite**, abra, escolha o servidor novo e **marque Administrador**. Sem Administrador o setup não consegue criar cargos/canais.
6. Cole o token, se pedir. No fim, responda `S` para subir no PM2.

## Links de convite (permissions=8 = Administrador)

- **CAPS ARENA:** https://discord.com/oauth2/authorize?client_id=1487258474810183711&permissions=8&scope=bot%20applications.commands
- **LCL BOT:** https://discord.com/oauth2/authorize?client_id=1558697998924513441&permissions=8&scope=bot%20applications.commands

## Depois de instalar

1. Dê o cargo de **🛠️ Staff** para a equipe (e **👑 Capitão LCL**, se usar).
2. Rode `!onboarding` e `!clubefixar` / `!ajudafixar` / `!regras` uma vez nos canais para fixar os painéis (ou só deixe — o setup já fixa os avisos do `server-pattern.json`).
3. **CAPS:** `!torneioon` abre o torneio. O **pôster do torneio é postado sozinho** às **10h, 16h e 21h** (SP) em `📢┃comunicados` e `💬・geral-leagueoflegends` — configurável em `config.json → social.poster`.
4. **LCL:** `!ajudalcl` lista os comandos.
5. Teste: `/ping`, depois `!cadastrar Nick#TAG` → `!entrar` numa sala de voz da categoria `FILA`.

## O que o instalador NÃO faz

- **Não cria a aplicação** no Discord Developer Portal, nem pega o token por você.
- **Não copia o banco** de jogadores de um servidor para outro (o `MONGODB_DB` é o mesmo do `.env`; para separar, troque `MONGODB_DB` no `.env` antes de subir).
- **Não apaga** canais/cargos existentes: ele reusa, renomeia e move o que já existe.

## Alternativas

```bat
REM sem o .bat (modo direto):
node instalar.js <GUILD_ID> caps
node instalar.js <GUILD_ID> lcl --dry-run      REM só mostra o plano
node instalar.js <GUILD_ID> ambos

REM subir/derrubar o bot:
pm2 start index.js --name caps-bot        REM ou: duplo clique em "Ativar Bot.bat"
cd lcl-bot && pm2 start index.js --name lcl-bot
```
