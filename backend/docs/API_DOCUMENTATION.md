# API — CRM Calebe (Express, prefixo `/api`)

> ~50 mounts. Auth: `Authorization: Bearer <JWT>`, salvo webhooks/públicos. Abaixo: mount → arquivo → função → auth. Detalhe fino: ler o arquivo da rota (todos usam zod na entrada).

## Núcleo

| Mount | Arquivo | Função | Auth |
|---|---|---|---|
| `/api/auth` (+`/auth/magic`) | auth.js, magic.js | login, refresh (rotação), me, logout, magic link | público/refresh |
| `/api/leads` | leads.js | CRUD, `PATCH /:id/status`, manual, **transferência (senha operacional)**, voice-call | ASSOC/ADMIN |
| `/api/conversations` | conversations.js | lista (unread, ordem por atividade), mensagens (**POST /:id/messages** = envio livre), accept, pin | dono/ADMIN |
| `/api/whatsapp` | whatsappCloud.js | `GET /templates` (allowlist; `?expose=1` admin), **`POST /conversations/:id/send-template`**, números | ASSOC/ADMIN |
| `/api/webhooks/whatsapp-cloud` | whatsappCloudWebhook.js | inbound + status Meta (verify+assinatura) | Meta |
| `/api/webhooks` | webhooks.js | `POST /leads` (HMAC — tráfego pago), `POST /vai` (legado) | HMAC |
| `/api/campaigns` | campaigns.js | `GET /pool` `GET /overview` `GET /options` `POST /` `POST /:id/start|pause` `GET /:id` `GET /:id/responses` `POST /import` | ADMIN |
| `/api/stream` | stream.js | SSE tempo-real (mensagens, status, notificações) | JWT |

## Operação

| Mount | Função |
|---|---|
| `/api/distribution` | regras por categoria, fila, distribuir hoje/extra, histórico |
| `/api/associates` | aprovação, categorias, bloqueio com motivo |
| `/api/phone-release` | pedido/aprovação de liberação de telefone |
| `/api/commercial-support` | Ajuda Comercial (gated `commercialSupportAccess`) |
| `/api/chat-history` | histórico de conversas p/ admin (`/:conversationId?limit=`) |
| `/api/dashboards`, `/api/_metrics` | analítico, TV, ranking, métricas |
| `/api/imports` | importação de planilhas |
| `/api/hygiene` | ações em lote na base (⚠️ ver MAPA §Higiene) |
| `/api/suporte` | IA de suporte (identify/reset-access/get-info/escalate) — Bearer `SUPPORT_WEBHOOK_TOKEN` |
| `/api/properties`, `/api/developments`, `/api/permutas` | imóveis/empreendimentos/permutas |
| `/api/sales`, `/api/commissions`, `/api/contracts`(agreement) | vendas, comissões, contratos |
| `/api/visits`, `/api/structure`, `/api/legal` | visitas, estrutura premium, jurídico |
| `/api/notifications`, `/api/push`, `/api/announcements` | notificações, push FCM/VAPID, avisos |
| `/api/voice` | Twilio bridge + gravações |
| `/api/upload`, `/api/audio-mp3`, `/api/audio-mp4`, `/api/profile-photo` | mídia (MinIO) |
| `/api/settings`, `/api/tracking`, `/api/welcome-video` (`lpVideo`) | config chave-valor, pixels, vídeos |
| `/api/assistant`, `/api/coach`, `/api/ia` | IA Anthropic |
| `/api/vai` | integração VAI legada |
| `/api/dev`, `/api/feedback`, `/api/assists`, `/api/wf` | dev tools, feedback, assistências, workflows |

## Estáticos servidos pelo Express

`/avisos`, `/documentos`, `/documentos-juridicos`, `/midias`, `/pagamentos-comissoes` — arquivos operacionais.

## Convenções de erro que o front conhece

- 401 → refresh/relogin · 403 `forbidden` (papel) · 409 `template_bloqueado` (recarregar app) · 422 `lead_invalid_number` / `lead_opted_out` · 5xx `send_failed` com `code` Meta (frontend `errMsg()` traduz).
