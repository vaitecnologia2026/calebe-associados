# ARQUITETURA — CRM Calebe

```
                    Internet
                       │
                 nginx (443, TLS)
        ┌──────────────┼─────────────────┐
        │              │                 │
  /root/vaidavenda-  /api/*         push nativo
  calebe/public      proxy → API    proxy → :4000
  (SPA React build)     │
                        ▼
              PM2 cluster ×4 "calebe-api"
              Node 22 ESM + Express
        ┌───────┬───────┼────────┬──────────┐
        ▼       ▼       ▼        ▼          ▼
    Postgres  MinIO   Meta     Twilio   Anthropic
    (Docker,  mídia   WhatsApp voice    assistente
    5432 —            Cloud    bridge
    bloqueado         API v25
    externo)          (envio+webhook)
```

## Camadas do backend

- `src/server.js` — bootstrap: middlewares, ~50 mounts, workers.
- `src/routes/*` (48) — HTTP fino: zod → serviço/Prisma → resposta. Auditoria via `utils/audit.js`.
- `src/services/*` (24) — regra de negócio: `whatsappCloud.js` (envio/rodízio/qualidade — CORAÇÃO), `whatsappWindow.js` (janela 24h), `loginLeadDrop.js`, `distributionEngine.js`/`redistributionEngine.js`/`queueScheduler.js`, `campaignRunner.js`, `sseHub.js`, `fcmPush.js`, `voiceBridge.js`, `importProcessor.js`…
- `src/jobs/*` (5) — workers in-process (métricas, fila, reativação, VAI polling, inatividade OFF).
- `src/auth/*` — JWT + middleware de papéis.
- `prisma/schema.prisma` — 35 modelos (ver DATABASE.md).
- `scripts/*.mjs` — operacionais (cron + one-off). ⚠️ classificar antes de rodar.

## Frontend

- Vite + React Router: `router/index.tsx` monta áreas por papel — `/admin` (AdminLayout, menu por role/flag), `/corretor`, públicas (`/`, `/c/:slug`, `/imovel/:codigo`), `/dev`, `/juridico`.
- Estado: zustand (`store/ui`) + fetch wrapper `lib/api.ts` (refresh automático, base URL).
- Tempo real: SSE (`lib/sse.ts`) + polls de segurança (25s lista, 12s conversa, 4s campanha ativa).
- Tela mais crítica: `features/corretor/chat-v2/ChatV2.tsx` + `chat-v2-api.ts` (janela, templates, envio, áudio).
- Build content-hash → **F5 obrigatório pós-deploy** (pendência: version-check).

## Decisões arquiteturais relevantes (o porquê)

1. **Meta Cloud API direto** (não BSP/VAI) para envio — VAI ficou como fallback/notificações (05/2026).
2. **PM2 cluster** → nada de estado importante em memória de worker; concorrência via SQL (`FOR UPDATE SKIP LOCKED`).
3. **SSE em vez de WebSocket** — suficiente para o padrão de tráfego (push de eventos + poll de segurança).
4. **`prisma db push`-style sem migrations** — mudanças por SQL aditivo idempotente (trade-off consciente; ver PLANO C4).
5. **Espelho de chat** (`CHAT_DATABASE_URL`, `chatDb`) — camada de leitura para históricos/monitoramento.
6. **Telefone cifrado + hash + máscara** — LGPD by-design; revelação é fluxo de negócio.
7. **Dois sistemas no mesmo host** — CRM (este) e SDR (`/root/calebe`, Next+SQLite). NÃO compartilham banco; só o cron os aproxima.
