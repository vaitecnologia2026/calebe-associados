# FLUXOS CRÍTICOS — CRM Calebe

> Fluxos que não podem quebrar. Para cada um: início → etapas → arquivos → tabelas → falhas conhecidas. Status em 2026-07-02.

## 1. Login / Sessão
- **Início:** POST `/api/auth/login` (ou magic link `/api/auth/magic`).
- **Etapas:** valida credenciais (bcrypt) → JWT access 7d + refresh 30d (rotação, hash em `RefreshToken`) → front guarda auth → `dropLeadsOnLogin()` dispara em background → `Associate.lastActiveAt` atualiza.
- **Arquivos:** `routes/auth.js`, `auth/jwt.js`, `auth/middleware.js`, `services/loginLeadDrop.js`.
- **Tabelas:** User, RefreshToken, Associate, Lead.
- **Falhas conhecidas:** mudança de role/flag exige RE-LOGIN (vai no token). PWA iOS >7d podia perder cookie (motivou access 7d).
- **Status:** 🟢

## 2. Entrada de lead
- **Caminhos:** (a) `POST /api/webhooks/leads` HMAC — **SEM PRODUTOR ATIVO** (1 POST na vida, 16/05); (b) **Captação LP**: cliente manda WhatsApp pro número oficial → webhook cria lead (+`#CRECI` credita corretor); (c) Import planilha (`/admin/ingestao`); (d) Manual; (e) Import da tela Campanhas.
- **Arquivos:** `routes/webhooks.js`, `whatsappCloudWebhook.js` (branch `if(!lead)`), `importProcessor.js`, `campaigns.js /import`.
- **Tabelas:** Lead (phoneEncrypted AES + phoneHash sha256 + phoneMasked), WebhookInboundLog, LeadImport.
- **Duplicados:** match por `phoneHashVariants` (com/sem 9º dígito BR).
- **Status:** 🟡 — funcional, mas (a) parado; base não se reabastece.

## 3. Distribuição de leads
- **Automática:** login → `loginLeadDrop` (30/dia, teto 60, claim atômico anti-duplo-login). Engine/fila com mix por categoria (BRONZE..DIAMOND) e janela 07:30–19h. Robô de inatividade DESLIGADO (decisão do admin).
- **Massiva/pontual:** scripts `_distribuir_*.mjs` (root). REGRA: resetar `accepted` ao reatribuir.
- **Tabelas:** Lead(assignedToId, assignedAt), Conversation(associateId, accepted), DistributionRule/Entry, RedistributionLog.
- **Falhas históricas:** lote "baixo esforço" puxou lead trabalhado (critério não excluía falha por throttle) — cuidado ao repetir.
- **Status:** 🟢 (pool depende do fluxo 2)

## 4. Envio WhatsApp — mensagem livre
- **Início:** POST `/api/conversations/:id/messages`.
- **Etapas:** cria Message → `cloudSendText` pelo `inboundPhoneId` → retry rate-limit no mesmo número (2,5s/7s) → fallback VAI (legado) → webhook traz delivered/read/failed → SSE atualiza UI.
- **Regra de ouro:** dentro da janela 24h NUNCA falha por 131049 (só template marketing sofre).
- **Status:** 🟢

## 5. Envio WhatsApp — template
- **Início:** POST `/api/whatsapp/conversations/:id/send-template` (corretor via dropdown allowlist) ou campanha/scripts.
- **Etapas:** checa blacklist permanente (invalid_number/opted_out → 422) → templates proibidos → 409 → `sendTemplate` (params auto) → persiste com texto renderizado.
- **Falha esperada:** 131049 assíncrono em base fria (~500-760/dia) — NÃO é bug; ver REGRAS #1.
- **Status:** 🟢

## 6. Webhook WhatsApp (inbound + status)
- **Início:** POST `/api/webhooks/whatsapp-cloud` (verify token + assinatura).
- **Inbound:** acha lead por phoneHash → (novo? captação LP) → cria Message → `lastInboundAt`+`manualFree`+`inboundPhoneId` → cancela blacklist temp → marca resposta de campanha → espelha chatDb → SSE + notifica corretor.
- **Status:** atualiza `messageStatus/errorReason` → blacklist permanente se 131026/131050 (131049 NÃO) → SSE ticks.
- **Status:** 🟢 — arquivo mais sensível do sistema junto com whatsappCloud.js.

## 7. Campanhas WhatsApp
- Criar (snapshot do bolsão em CampaignRecipient) → start → runner paceado (claim atômico, GREEN/round-robin, params por template, marca sent/failed/no_whatsapp) → webhook marca responded → tela ao vivo (funil, histórico, drawer de conversa).
- **Fase 2 pendente:** roleta (respondeu → corretor online → repasse 5min).
- **Status:** 🟢

## 8. Resposta do lead → atendimento
- Inbound abre janela → conversa sobe na lista do corretor (unread badge) → corretor aceita (`accepted`, topo) → chat livre 24h → estágios (Novo/Qualificando/Negociação/Fechamento/Ganho/Perdido → `PATCH /api/leads/:id/status`).
- **Falha conhecida (corrigida 16/06):** composer travava com `win` velho — fix OR de fontes + reload no foco.
- **Status:** 🟢

## 9. Liberação de telefone
- Corretor pede (justificativa) → admin aprova/nega (`/admin/liberacao-telefone`) → `Conversation.phoneReleased=true` → número real visível. `autoReleasePhone` por corretor automatiza.
- **Status:** 🟢 (LGPD-crítico)

## 10. Ajuda Comercial
- Corretor pede apoio → painel gated (`commercialSupportAccess`; `commercialOnly` trava supervisor) → ciclo SOLICITADO→EM_ANALISE→ATUANDO→FINALIZADO → botões wa.me cliente/corretor.
- **Status:** 🟢

## 11. Push / Notificações
- FCM (app nativo) + VAPID (web) + serviço :4000 (nginx proxy). Notifica lead novo/resposta na janela 07:30–19h.
- **Status:** 🟢

## 12. Voice (Twilio)
- `POST /api/leads/:id/voice-call` → bridge mascarado (liga pro corretor, conecta lead) + gravação (CallRecording).
- **Status:** 🟢

## 13. Imóveis / anúncio
- Submissão do corretor → aprovação admin (pública/privada) → catálogo. Card de anúncio (PNG via html2canvas) com valor + à vista com desconto.
- **Status:** 🟢

## 14. Relatórios / Dashboards
- `/admin/analitico` (auto-refresh 30s), TV, ranking, relatórios diários via cron (scripts `_relatorio_*.mjs`).
- **Status:** 🟢 (bucket `corretor_nao_respondeu`=0 — pendência)

## 15. Deploy
- Ver `DEPLOY.md`. Sem CI/CD; validação manual via TEST_CHECKLIST.
- **Status:** 🟡 (manual, sem staging)

## Sem implementação (não quebrar expectativa)
- Recuperação de senha self-service (reset é via suporte/admin/magic link).
- Kanban de estágios no chat do corretor (só chips de estágio; redesign ChatMonitorV2 tem spec).
- Testes automatizados.
