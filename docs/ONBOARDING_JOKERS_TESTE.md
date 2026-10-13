# Onboarding estilo Joker's no CAPS BOT TESTE — plano de montagem

> Referência: prints do servidor Joker's House (questionário de entrada, Guia do Servidor, #bem-vindos, #bate-papo, #nicks-lol).
> Servidor alvo: `CAPS BOT TESTE` (guild `1558217291123138561` — confere o ID antes de rodar).

## O que dá para automatizar (script) x o que é manual (Discord)

| Recurso do print | Dá para automatizar? | Como fazer |
|---|---|---|
| Cargos (elos, Jogador Ativo, lanes Top/Mid/Adc/Suporte/Jungle/Autofill) | ✅ Sim | `setup-servidor.js --extra jokers` |
| Canais (#bem-vindos, #bate-papo, #nicks-lol, lobbies, fila etc.) | ✅ Sim | `setup-servidor.js --extra jokers` |
| Mensagem de boas-vindas com botões (equivale à Pergunta 1) | ✅ Já existe | `guildMemberAdd` no `index.js` (embed + botões **Jogo LoL / Não jogo LoL**) |
| **Questionário nativo ("Pergunta 1 de 3")** | ❌ Manual | Configurações do servidor → **Onboarding** (sem API do Discord) |
| **Guia do Servidor ("Comece agora")** | ❌ Manual | Configurações → **Visão geral / Guia do Servidor** (sem API) |
| Cartão de boas-vindas com imagem (estilo Koya APP) | ⚠️ Bot externo | Convidar Koya APP **ou** usar o embed do nosso bot (texto, sem imagem gerada) |

## Comandos seguros (NÃO tocam na produção)

```bash
# 1. Prévia (só leitura + mostra o plano, não cria nada)
node setup-servidor.js 1558217291123138561 --dry-run --extra jokers

# 2. Execução real gravando IDs em arquivo SEPARADO (produção intacta)
node setup-servidor.js 1558217291123138561 --extra jokers --config-out config.teste.json
```

Pré-requisitos: bot no servidor TESTE com **Administrador**. Testei o acesso agora e o bot **não está** na guild `1558217291123138561` (retornou "Servidor não encontrado") — passo 0 é convidar o bot pelo link OAuth2 com `bot` + `applications.commands` + permissão Administrador. Sem `--config-out`, o `config.json` de produção seria sobrescrito — por isso o comando acima é obrigatório.

## Guia de comandos em canal só-leitura (novo)

O "Guia do Servidor" do print virou o canal **`📘・guia-de-comandos`** (categoria 🤖・BOT):
- Criado pelo `setup-servidor.js` com trava de permissão: `@everyone` **lê**, só `👑 Admin`, `🛠️ Moderador` e `👑 Capitão de Customs` **escrevem**.
- O script **fixa automaticamente** os embeds do `!regras` (jogadores) e `!staff` (equipe) — mesmo conteúdo dos comandos.
- Quando os comandos mudarem, um Admin roda **`!onboarding` dentro do canal** para republicar (o comando já publica guia + regras + staff no canal atual). Apague os fixados antigos depois.

## Perguntas do Onboarding (configuração manual — texto pronto para colar)

**Configurar em:** Configurações do servidor → Onboarding → Ativar perguntas.

**Pergunta 1 — "O que você deseja?" (obrigatória, múltipla escolha única)**
- `💬 Interagir com os membros` → libera `#bate-papo` (+ Sala Geral de voz)
- `👑 Jogar Personalizada com a galera` → libera `#nicks-lol` + cargo `Jogador Ativo`*
- (*Equivalente Joker: `#nicks-lol` + cargo `@-CriaPX-`. No CAPS, o acesso total às filas vem do `!cadastrar`, que dá o cargo sozinho.)

**Pergunta 2 — "Qual sua lane?" (obrigatória)**
- `Top` / `Mid` / `Adc` / `Suporte` / `Jungle` / `Autofill` → cargos cosméticos de lane (criados pelo script com `--extra jokers`). O bot ignora esses cargos — são só identidade, como no Joker's.

**Pergunta 3 (opcional, sugestão CAPS) — "Seu elo na ranked?"**
- `Ferro–Ouro` / `Platina–Diamante` / `Esmeralda+` → sem cargo automático (o `!cadastrar`/`!sincronizarelo` aplica o cargo de elo real). Serve só de perfil.
- (No Joker's a P2 é "Sexualidade" — trocamos por algo útil ao jogo; adapte como quiser.)

## Guia do Servidor (configuração manual — "Comece agora")

**Configurar em:** Configurações → Guia do Servidor → adicionar ações:
1. `💬 Interaja com a Galera` → canal `#bate-papo`
2. `⌨️ Chat para usar comandos` → canal `#comandos`
3. `📝 Registre seu nick e sua lane` → canal `#nicks-lol`
4. `📜 Leia as regras` → canal `#regras`

## Avisos importantes

- **Não rode o bot de produção no TESTE com o mesmo banco**: filas/espera são globais por modo (`queue.waitingLists`), então teste com 1–2 pessoas e dê `!reset` ao final. Ideal: segunda instância com banco separado (fora do escopo deste guia).
- **Cargos de lane são cosméticos**: `syncMemberRankRole` remove apenas cargos reconhecidos como de elo (`isRankRole`) — lanes nunca são removidas nem usadas no balanceamento.
- **Cartão de boas-vindas com imagem**: se quiser igual ao Koya APP do print, convide o Koya no TESTE; o embed do nosso bot (`welcomeChannelId`) continua funcionando junto.
