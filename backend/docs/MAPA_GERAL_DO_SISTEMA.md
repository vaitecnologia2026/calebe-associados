# MAPA GERAL DO SISTEMA — CRM Calebe

> Inventário de 2026-07-02. Backend: 48 rotas, 24 serviços, 5 jobs, 35 tabelas, 75 variáveis de ambiente. Frontend: 7 áreas, ~60 rotas.

## Stack

- **Backend:** Node 22 (ESM), Express, Prisma 5.22, PostgreSQL (Docker), PM2 cluster ×4, pino (logs), zod (validação).
- **Frontend:** React 18.3, Vite 5, TypeScript, Tailwind, zustand, react-router 6, lucide-react, html2canvas. (Só 6 dependências — enxuto.)
- **Infra:** nginx (TLS, serve `public/`, proxy push :4000), MinIO (mídia), Docker (Postgres, n8n), cron (24 entradas — mistura Calebe e SDR).
- **Integrações:** Meta WhatsApp Cloud API v25 (envio/webhook/templates/qualidade), Twilio (voice bridge), Firebase FCM + VAPID (push), Anthropic API (assistente/coach), DWV e Imobisec (imóveis), Meta CAPI (pixel), VAI (legado, fallback).

## Módulos (status: 🟢 saudável · 🟡 precisa ajuste · 🔴 crítico · 👁 revisão humana)

| Módulo | Código | O que faz | Tabelas | Perfis | Status |
|---|---|---|---|---|---|
| Autenticação | `routes/auth.js`, `auth/jwt.js`, `middleware.js`, `magic.js` | Login, refresh com rotação, magic links | User, RefreshToken | todos | 🟢 (ver SEGURANCA §JWT fallback) |
| Leads | `routes/leads.js` | CRUD, status, transferência (senha), manual | Lead | ADMIN/ASSOCIATE | 🟢 |
| Distribuição | `routes/distribution.js`, `services/distributionEngine.js`, `queueScheduler.js`, `redistributionEngine.js`, `loginLeadDrop.js` | Regras por categoria, fila, drop no login (30/dia), janela 07:30–19h | DistributionRule, DistributionEntry, RedistributionLog | ADMIN | 🟢 (robô de inatividade DESLIGADO de propósito) |
| Conversas/Chat | `routes/conversations.js`, `chatHistory.js`, `stream.js` (SSE), `services/sseHub.js`, `whatsappWindow.js` | Chat corretor↔lead, janela 24h, aceitar, fixar, unread | Conversation, Message | ASSOCIATE/ADMIN | 🟢 |
| WhatsApp Cloud | `routes/whatsappCloud.js`, `whatsappCloudWebhook.js`, `services/whatsappCloud.js` | Envio (texto/template/mídia), rodízio GREEN, qualidade Meta, webhook inbound+status, captação LP | Message, Lead, WebhookInboundLog | sistema | 🟢 — **coração do sistema; máxima cautela** |
| Campanhas | `routes/campaigns.js`, `services/campaignRunner.js` | Bolsão, funil, disparo paceado, resultado, respostas | Campaign, CampaignRecipient | ADMIN | 🟢 (roleta = Fase 2 pendente) |
| Imóveis | `routes/properties.js`, `developments.js`, `permutas.js` | Catálogo, empreendimentos, submissão/aprovação, card de anúncio | Property, PropertyMedia, Development, Permuta | todos | 🟢 |
| Vendas/Comissões | `routes/sales.js`, `commissions.js`, `contracts.js`, `services/commissionService.js` | Ciclo venda, documentos, comissões | Sale, SaleDocument, Commission | ADMIN/ASSOCIATE | 🟢 |
| Corretores | `routes/associates.js` | Aprovação, categorias (BRONZE→DIAMOND), bloqueio | Associate, AssociateApplication | ADMIN | 🟢 |
| Liberação de telefone | `routes/phoneRelease.js`, `services/leadPhoneAccess.js` | Corretor pede → admin aprova → revela número | PhoneReleaseRequest, Conversation | ambos | 🟢 (LGPD-crítico) |
| Ajuda Comercial | `routes/commercialSupport.js` | Time Calebe apoia negociação; supervisores `commercialOnly` | ConversationAssist(+Note) | ADMIN gated | 🟢 |
| Suporte IA | `routes/suporte.js`, `ia.js`, `assistant.js`, `coach.js` | IA de suporte via VAI (CRECI/reset/escala), assistente Anthropic | — | webhook/token | 🟢 |
| Push/Notificações | `routes/push.js`, `notifications.js`, `services/fcmPush.js`, `push.js` | FCM nativo + VAPID web + serviço :4000 | Notification, FcmToken, PushSubscription, PushNotificationSetting | todos | 🟢 |
| Voice | `routes/voice.js`, `services/voiceBridge.js` | Ligação mascarada Twilio corretor↔lead + gravação | CallRecording | ASSOCIATE | 🟢 |
| Imports | `routes/imports.js`, `services/importProcessor.js` | Planilhas de leads | LeadImport | ADMIN | 🟢 |
| Webhooks externos | `routes/webhooks.js` | `/leads` (HMAC — SEM PRODUTOR), `/vai` (legado, parado 19/05) | WebhookInboundLog | externo | 🟡 sem produtor ativo |
| Dashboards | `routes/dashboards.js`, `metrics.js`, `services/metricsService.js`, jobs | Analítico, TV, ranking, relatórios | agregações | ADMIN | 🟢 |
| Jurídico/Estrutura/Visitas/Financeiro | rotas homônimas | módulos operacionais | StructureRequest, Visit etc. | conforme | 🟢 |
| Higiene | `routes/hygiene.js` | ações em lote sobre base | Lead | ADMIN | 👁 usar com cuidado (histórico de lote 18/06 descartou 8.218) |
| Jobs | `src/jobs/*` | métricas, fila de leads, reativação, VAI polling, inatividade (OFF) | várias | sistema | 🟢 |
| VAI (legado) | `routes/vai.js`, `services/vaiClient.js`, `vaiPollingWorker.js` | fallback de envio + notificações internas | — | sistema | 🟡 legado; avaliar aposentadoria (👁) |
| Scripts operacionais | `scripts/*.mjs` (~40) | relatórios, distribuições pontuais, saúde de números (cron), blasts | várias | root/cron | 🟡 documentar quais são cron vs one-off (👁) |

## Frontend (áreas)

- `features/admin` — 30 telas (Dashboard, Aprovação, Corretores, Leads, Distribuição, Ingestão, TV, ChatMonitor v1/v2, Histórico, Analítico, **Campanhas**, WhatsAppNumeros, Ajuda Comercial, Imóveis, Financeiro, Config, Logs…).
- `features/corretor` — 16 telas (Dashboard, **Chat v2** `chat-v2/ChatV2.tsx` — tela mais crítica, Imóveis, Vendas, Financeiro, Suporte…).
- `features/public` — Landing, **LpAfiliado** (`/c/:slug` — LP do corretor, número oficial Meta + `#CRECI`), cadastro, imóvel público.
- `features/auth`, `dev`, `juridico`, `reservas`.

## Ambientes

- **Produção única** (sem staging). Servidor Ubuntu, nginx TLS, `app.calebe.tech`.
- Cron do servidor tem 24 entradas — parte é do SDR (`/root/calebe`). Ver `DEPLOY.md`.
