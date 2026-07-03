# API Reference · CRM Calebe Associados

Base URL: `http://localhost:4000/api`
Autenticação: `Authorization: Bearer <accessToken>` (exceto rotas públicas e webhooks).

---

## Auth

### `POST /auth/login`
**Body:** `{ email, password }`
**Resposta 200:** `{ accessToken, user }` · envia `rt` em cookie httpOnly

### `POST /auth/refresh`
Lê cookie `rt` · **Resposta 200:** novo `accessToken` + novo `rt` rotacionado

### `POST /auth/logout`
Revoga refresh · limpa cookie

### `GET /auth/me`
Dados do usuário autenticado

---

## Associados

### `GET /associates?status=APPROVED&category=GOLD&limit=50&offset=0`  (ADMIN)
### `GET /associates/:id`  (ADMIN)

### `POST /associates/applications`  (público)
**Body:** `{ name, email, phone, cpf, creci, creciUf, city, ... }`

### `GET /associates/applications?status=PENDING`  (ADMIN)

### `PATCH /associates/:id/approve`  (ADMIN)
**Body:** `{ category?: "GOLD", segment?: "Alto padrão", tempPassword?: "..." }`

### `PATCH /associates/:id/deny`  (ADMIN)
**Body:** `{ reason: "Documentação inválida" }`

### `PATCH /associates/:id/category`  (ADMIN)
**Body:** `{ category: "DIAMOND" }`

### `PATCH /associates/:id/segment`  (ADMIN)
**Body:** `{ segment: "Alto padrão" }`

### `PATCH /associates/:id/creci`  (ADMIN)
### `PATCH /associates/:id/status`  (ADMIN) · `APPROVED | INACTIVE | DENIED`

---

## Leads

### `GET /leads?status=NEW&segment=Alto padrão&assignedToId=...&limit=50`  (ADMIN)
### `GET /leads/my`  (ASSOCIATE)  · vê os leads atribuídos
### `GET /leads/:id`  · mascarado por padrão
### `GET /leads/:id/phone`  (ADMIN)  · retorna tel real · **auditado**
### `POST /leads/manual`  (ASSOCIATE)  · cria lead próprio com tel liberado
  **Body:** `{ name, phone, segment?, source?, city?, notes? }`
### `POST /leads/:id/assign`  (ADMIN)  · `{ associateId }`
### `PATCH /leads/:id/status`  · `{ status: "QUALIFYING", reason?: "..." }`

---

## Distribuição

### `GET /distribution/rules`
### `PATCH /distribution/rules/:category`  (ADMIN)
  **Body:** `{ dailyQuota?, percentage?, priority? }`
### `PATCH /distribution/percentages`  (ADMIN)
  **Body:** `{ DIAMOND: 40, GOLD: 30, SILVER: 20, BRONZE: 10 }` · soma = 100
### `PATCH /distribution/inactivity-settings`  (ADMIN)
  **Body:** `{ minutes?, maxRedistributions?, active? }`
### `GET /distribution/queue`  (ADMIN) · fila agendada por dia
### `GET /distribution/history?days=30`  (ADMIN)
### `POST /distribution/run`  (ADMIN) · força processamento agora
### `POST /distribution/rebalance`  (ADMIN) · força varredura de inatividade

---

## Importação

### `POST /imports/leads`  (ADMIN, multipart)
  Campo `file` com CSV/XLSX · colunas: `nome, telefone, segmento, fonte, cidade`
  **Resposta 202:** `{ id, status }` · processa em background
### `GET /imports`  (ADMIN)
### `GET /imports/:id`  (ADMIN)

---

## Conversas

### `GET /conversations`
### `GET /conversations/:id/messages`
### `POST /conversations/:id/messages`  · `{ text }`
  - Dispara envio via VAI
  - Marca `firstContactAt` do lead na primeira mensagem (evita redistribuição)

---

## Imóveis

### `GET /properties?status=AVAILABLE&city=Itapema&special=true`
### `GET /properties/:id`
### `POST /properties`  (ADMIN)
### `PATCH /properties/:id`  (ADMIN)
### `POST /properties/:id/media`  (ADMIN) · `{ url, mediaType, order }`
### `DELETE /properties/:propertyId/media/:mediaId`  (ADMIN)

---

## Visitas

### `GET /visits`
### `POST /visits` · `{ leadName, propertyId, scheduledAt, notes? }`
### `PATCH /visits/:id/confirm`
### `PATCH /visits/:id/status` · `PENDING|CONFIRMED|DONE|CANCELLED|RESCHEDULED`

---

## Vendas

### `GET /sales?status=SUBMITTED`
### `GET /sales/:id`
### `POST /sales` · `{ propertyId, clientName, clientData: {...}, finalValue, paymentConditions? }`
  - `clientData` é criptografado com AES-256-GCM antes de gravar
### `POST /sales/:id/submit` · envia ao jurídico
### `POST /sales/:id/documents` · `{ docType, fileKey }`

---

## Jurídico  (LEGAL | ADMIN)

### `GET /legal?status=SUBMITTED`
### `PATCH /legal/:id/status` · `{ status: "APPROVED"|"DENIED"|..., reason? }`

---

## Comissões

### `GET /commissions?status=pending`
### `PATCH /commissions/:id/status`  (ADMIN) · `{ status: "pending"|"approved"|"paid" }`

---

## Estrutura Premium (avião · carro · apt · visita)

### `GET /structure?status=PENDING&type=PLANE`
### `POST /structure` · `{ structureType, requestedDate, urgency, motive, ... }`
### `PATCH /structure/:id/respond`  (ADMIN | SECRETARY)
  `{ status: "APPROVED"|"DENIED"|"RESCHEDULED", notes?, newDate? }`

---

## Notificações

### `GET /notifications` · retorna do usuário logado
### `PATCH /notifications/:id/read`
### `POST /notifications/read-all`

---

## Avisos

### `GET /announcements`
### `POST /announcements`  (ADMIN) · `{ title, body, target, targetSegment?, targetUserId?, showOnLogin? }`
### `PATCH /announcements/:id`  (ADMIN)
### `DELETE /announcements/:id`  (ADMIN)
### `POST /announcements/:id/read`  · marca como lido

---

## Settings

### `GET /settings`
### `PATCH /settings/:key`  (ADMIN) · `{ value: ... }`
  Chaves comuns:
  - `inactivity.minutes`
  - `inactivity.maxRedistributions`
  - `inactivity.active`
  - `dashboard.tvRefreshSeconds`
  - `notifications.juridicoPhone` / `notifications.reservasPhone`

---

## Dashboards

### `GET /dashboards/tv`
Retorna:
```json
{
  "totalAssociates": 47,
  "leadsDistributedToday": 142,
  "leadsInQueue": 24,
  "activeConversations": 87,
  "salesToday": 3,
  "topAssociates": [{ "name": "...", "category": "GOLD", "sales": 11 }],
  "associatesByCategory": { "DIAMOND": 3, "GOLD": 12, "SILVER": 18, "BRONZE": 14 },
  "refreshedAt": "2026-04-20T14:22:00.000Z"
}
```

### `GET /dashboards/summary`  (ADMIN)
Mesmo TV + contagens de pendências (`applPending`, `salesPending`, `commissionsPending`, `structurePending`).

---

## Webhooks

### `POST /webhooks/leads`  (HMAC)
Header: `X-Webhook-Signature: sha256=<hmac_hex>`
**Body:** `{ source, external_id?, name, phone, city?, segment?, notes? }`

### `POST /webhooks/vai`  (HMAC)
Header: `x-vai-signature: <hmac_hex>`
**Body:** evento VAI (`message.received`, `message.status`, etc.)

---

## Upload (MinIO)

### `POST /upload/creci`  (multipart · `file`)
### `POST /upload/sale-document`
Ambos retornam `{ key, url (presigned 7d), size, mimetype }`

---

## Códigos de erro padronizados

| HTTP | `error` | Significado |
|---|---|---|
| 400 | `file_required`, `invalid_json` | payload malformado |
| 401 | `unauthenticated`, `invalid_credentials`, `invalid_token`, `invalid_refresh` | auth |
| 403 | `forbidden`, `need: [roles]` | sem permissão |
| 404 | `not_found` | recurso inexistente |
| 409 | `duplicate`, `phone_already_exists`, `already_reviewed` | conflito de estado |
| 422 | `validation`, `issues: [...]` | zod validation fail |
| 429 | — | rate limit |
| 503 | `webhook_disabled`, `vai_webhook_disabled` | dependência não configurada |
| 500 | `internal_error` | bug · logar e abrir issue |
