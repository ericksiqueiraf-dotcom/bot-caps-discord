# 🚀 Deploy do clube VIP (PIX) na CAPS ARENA oficial

> Guild: CAPS ARENA (`1273653944169660427`) · Processos prod: `caps-bot` + `caps-admin`
> Pré-requisito: fluxo validado na TESTE em 2026-10-14 (pagamento real R$ 9,99 → cargo automático).

## Checklist pré-deploy

- [ ] Cargos existem na ARENA: `💜 Apoiador`, `⭐ VIP`, `👑 Lendário` (confirmado via API em 2026-10-14)
- [ ] `MP_ACCESS_TOKEN` de **produção** (`APP_USR-`) em mãos
- [ ] URL pública **fixa** apontando para o painel prod (VPS ou túnel fixo — o `trycloudflare.com` rotativo **não serve** para produção)
- [ ] Canal `📢┃comunicados` existe na ARENA (anúncios de adesão)

## Passo a passo

### 1. `.env` do CAPS (`BOT CAPS DISCORD/.env`, nunca commitar)
```ini
MP_ACCESS_TOKEN=APP_USR-...
MP_WEBHOOK_SECRET=... (opcional, recomendado)
PUBLIC_BASE_URL=https://sua-url-fixa
```
Porta do `caps-admin` prod: `3030` (não mexer — a :3031 é do `lcl-admin`).

### 2. `config.json` (já vem com a seção; só conferir)
```json
"clubePagamentos": {
  "apoiador": { "preco": 9.99, "dias": 30 },
  "vip": { "preco": 19.99, "dias": 30 },
  "lendario": { "preco": 29.99, "dias": 30 }
}
```

### 3. Restart dos processos prod (nessa ordem)
```powershell
npx pm2 restart caps-admin --update-env
npx pm2 restart caps-bot --update-env
```
Conferir no log: `Bot conectado como CAPS BOT LOL#6241` e painel em `http://localhost:3030`.

### 4. Validar webhook pela URL pública
```powershell
curl.exe -X POST "https://sua-url-fixa/webhooks/mercadopago?topic=payment" -H "Content-Type: application/json" --data "{}"
```
Esperado: `OK` (200). Sem `data.id` ele só confirma que a rota está viva.

### 5. Compra real de validação (R$ 9,99)
1. Na ARENA: `!clube` → **Assinar Apoiador** → e-mail → QR
2. Pagar no banco → ✅ cargo `💜 Apoiador` + DM + anúncio no `📢┃comunicados`
3. `!clube` mostra `1 membro`; `!perfil @comprador` mostra `💎 Clube VIP`
4. Reembolsar em MP → Vendas → Devolver (assinatura continua ativa 30 dias; remover o cargo manual se quiser limpar o teste)

### 6. Anunciar (sugestão)
Postar em `📢┃comunicados` + `!clube` fixado: tiers, preços, "sem vantagem competitiva".

## Como funciona (para manutenção)

```
!clube → botões → modal e-mail → POST /v1/payments (pix)
  → QR + copia-e-cola (30 min) → MP chama notification_url
  → POST /webhooks/mercadopago → consulta pagamento na API
  → approved + external_reference=caps-vip:* → cargo via Discord REST
  → DM + anúncio + grava assinatura (30 dias)
Scheduler 08h: expireVipSubscriptionsForGuild() remove vencidos + avisa DM.
Anti-duplo: paymentId já processado é ignorado. Pagamentos do SnapFlow
(external_reference=sess_*) são ignorados pelo webhook.
```

## Rollback

- Desligar vendas: remover `MP_ACCESS_TOKEN` do `.env` + restart → `!clube` volta a mostrar "em configuração" (sem botões). Nenhum cargo existente é afetado.
- Código: `git revert` dos commits do clube; restart dos processos.

## Erros comuns

| Sintoma | Causa / ação |
|---|---|
| `!clube` sem botões | `MP_ACCESS_TOKEN` vazio no processo → restart com `--update-env` |
| Pagou e cargo não entrou | webhook não alcançou o painel (URL/túnel) → testar passo 4; ver log `[WEBHOOK MP]` no `caps-admin` |
| Porta em uso no admin-teste | :3031 = `lcl-admin`, :3030 = `caps-admin`; teste usa :3032 |
| Cargo errado/não achado | nomes exatos: `💜 Apoiador`, `⭐ VIP`, `👑 Lendário` |
