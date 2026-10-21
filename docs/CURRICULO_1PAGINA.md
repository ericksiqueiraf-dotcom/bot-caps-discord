# CURRÍCULO — 1 PÁGINA (base para PDF de vagas júnior/estágio)

> Como usar: preencha os [CAMPOS], exporte para PDF (formato A4, UMA página SEM EXCEÇÃO).
> Fonte limpa (Inter/Calibri 10-11pt). NÃO usar foto, NÃO usar template colorido de site genérico.

---

## [SEU NOME COMPLETO]
Desenvolvedor Backend / Node.js (júnior) · Prestador de serviços TI (MEI)

[CIDADE] - [UF] · [telefone] · [e-mail] · linkedin.com/in/[seu-perfil] · github.com/[seu-user]

### RESUMO (2 linhas — o que o RH lê primeiro)
Desenvolvedor Node.js com sistema próprio em produção há [X] meses (bot de comunidade com pagamentos, ranking e torneios, 24/7), foco em backend, automação e confiabilidade (309 testes automatizados). Inglês técnico para leitura/escrita.

### PROJETO EM DESTAQUE — Bot CAPS (Discord + Node.js + MongoDB) · desde abr. 2026
Sistemas de gerenciamento de comunidade de jogos no Discord, desenvolvido e operado individualmente, rodando 24/7 em produção (PM2 + MongoDB Atlas, 2 ambientes).

- **Arquitetura**: gateway Discord (discord.js v14), camada de serviços de domínio, painel administrativo Express, banco MongoDB como fonte única de verdade;
- **Funcionalidades**: matchmaking com balanceamento por elo (Riot API), ranking persistente com temporadas, torneios automáticos completos (inscrição → fase de pontos → final), assinaturas pagas integradas ao Mercado Pago (checkout + webhook assinado);
- **Confiabilidade**: 309 testes automatizados (53 suítes) incluindo testes de paridade entre bots espelhados e limites de API; estado crítico 100% persistido — restarts de deploy não perdem dados;
- **Problema técnico resolvido**: eliminei corridas de escrita concorrente no estado compartilhado (mensagens duplicadas e estado revertido em produção) implementando fila de escrita única com lock global e scheduler sequencial — zero ocorrências desde a correção.

### EXPERIÊNCIA PROFISSIONAL

**Prestador de serviços de TI — MEI** (desde [ANO])
- Desenvolvimento de bots/automações sob medida (Discord, integrações web, rotinas);
- Atendimento, escopo, proposta, implantação e suporte direto com clientes.

**[EMPREGO ANTERIOR — mesmo FORA de TI vale colocar]** ([CIDADE]) · [mês/ano a mês/ano]
- [1 linha do que fez, focando em responsabilidade/problemas resolvidos];

**[SE NÃO TIVER OUTRO EMPREGO]: não force — a seção MEI + projeto em destaque já carregam o currículo.**

### STACK
- **Linguagens/frameworks**: JavaScript (Node.js, 7+ meses em produção), discord.js v14, Express;
- **Banco/Infra**: MongoDB (Atlas, modelagem e migração), PM2, Git/GitHub;
- **Integrações**: Riot Games API, Mercado Pago (webhooks assinados), Discord REST/gateway;
- **Qualidade**: testes automatizados com node:test (sem framework), CI planejado (GitHub Actions — em estudo).

### FORMAÇÃO
- [Nome da faculdade EAD] — [Curso] (cursando, início [mês/ano])  <!-- matricule-se ANTES de enviar isso -->
- Ensino Médio completo ([ano])

### FORMAÇÃO COMPLEMENTAR
- [Curso/treinamento que já fez — Alura, freeCodeCamp, documentação oficial etc.] ([ano])
<!-- Se não tiver curso listado: os testes (>300) + produção 24/7 deste projeto já provam estudo autodidata — verde honesto. -->

### IDIOMAS
- Inglês: técnico (leitura e escrita de documentação — doc oficial, GitHub issues); conversação em desenvolvimento.

---

# REGRAS DE OURO (não vão no PDF)

1. **NÃO descreva o projeto como "hobby"** — é "sistema próprio em produção", com métricas (309 testes, 24/7, 7+ meses). Os NÚMEROS vendem.
2. **Máximo 1 página** — corte experiência antiga antes de cortar o projeto em destaque.
3. **Sem parágrafo genérico de "objetivo: crescer profissionalmente"** — o RESUMO de 2 linhas já cobre isso.
4. **Cada vaga = 1 ajuste**: leia a vaga e coloque 1-2 termos DELA no resumo (ex.: se pede "API REST", destaque os webhooks do Mercado Pago).
5. **GitHub atualizado no dia do envio**: README forte + projeto com atividade recente (idealmente commit dos últimos 15 dias).
6. **Sem foto, sem idade, sem estado civil** (vagas no Brasil não exigem; só atravancam).
