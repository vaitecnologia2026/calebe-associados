# CRM Calebe Associados · Backend

API REST de produção para o CRM Calebe Associados — Express 5 + PostgreSQL 16 + Prisma + NextAuth (JWT) + MinIO + integração VAI (WhatsApp).

Este backend **não substitui o frontend** (`demo-funcionalidades.html`) — ele expõe endpoints REST que o frontend consome, substituindo os dados mock por dados reais.

---

## 1 · Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express 4.21 |
| ORM | Prisma 5.22 |
| DB | PostgreSQL 16 (extensões `pgcrypto`, `citext`) |
| Auth | JWT (access curto + refresh rotativo em cookie httpOnly) |
| Criptografia | AES-256-GCM (telefones, dados de cliente, tokens) |
| Upload | MinIO (S3-compatível) |
| Logging | Pino (JSON prod · pretty dev) |
| Validação | Zod |
| Deploy | Docker Swarm (stack file incluído) |

---

## 2 · Setup local (3 comandos)

```bash
cd backend
cp .env.example .env            # edite os segredos abaixo
docker compose up --build       # sobe Postgres + MinIO + API
```

A API fica disponível em `http://localhost:4000`.
Health: `GET /api/health` → `{ ok: true }`.

### Gerar segredos (obrigatório)

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
openssl rand -hex    32   # WEBHOOK_LEADS_SECRET / VAI_WEBHOOK_SECRET
```

### Rodar sem Docker

```bash
npm install
npx prisma migrate dev          # cria tabelas
npx prisma db seed              # cria 4 usuários oficiais + regras
npm run dev                     # hot-reload
```

### Credenciais do seed (senha em `SEED_DEFAULT_PASSWORD`)

| E-mail | Role | Acesso |
|---|---|---|
| `adm@calebe.com.br` | ADMIN | tudo |
| `corretor@calebe.com.br` | ASSOCIATE | área do associado |
| `juridico@calebe.com.br` | LEGAL | kanban jurídico |
| `secretaria@calebe.com.br` | SECRETARY | estrutura e visitas |

---

## 3 · Endpoints

Documentação completa em **[docs/API.md](./docs/API.md)**.
Módulos:

| Grupo | Prefix |
|---|---|
| Auth | `/api/auth/*` |
| Associados | `/api/associates/*` |
| Leads | `/api/leads/*` |
| Distribuição | `/api/distribution/*` |
| Importação | `/api/imports/*` |
| Conversas | `/api/conversations/*` |
| Imóveis | `/api/properties/*` |
| Visitas | `/api/visits/*` |
| Vendas | `/api/sales/*` |
| Jurídico | `/api/legal/*` |
| Comissões | `/api/commissions/*` |
| Estrutura | `/api/structure/*` |
| Notificações | `/api/notifications/*` |
| Avisos | `/api/announcements/*` |
| Settings | `/api/settings/*` |
| Dashboards / TV | `/api/dashboards/*` |
| Webhooks | `/api/webhooks/*` |
| Upload | `/api/upload/*` |

---

## 4 · Regras de negócio principais

### Associados
- Categorias: **BRONZE · SILVER · GOLD · DIAMOND**
- Admin altera categoria/segmento via `PATCH /api/associates/:id/category|segment`
- Só **APPROVED** recebe leads

### Telefone de lead · bloqueio inviolável
- Sempre armazenado **AES-256-GCM** em `Lead.phoneEncrypted`
- Respostas normais retornam `phoneMasked` (`(47) 9****-**34`)
- **Admin** pode buscar tel real via `GET /api/leads/:id/phone` · **gera AuditEvent**
- Associado só vê tel real se: (a) lead `origin = MANUAL` ou (b) conversa com `phoneReleased = true`

### Lead manual
- `POST /api/leads/manual` (associado autenticado) cria lead com `origin = MANUAL`
- Telefone **liberado imediatamente** · conversa criada com `manualFree = true`
- `firstContactAt` preenchido no momento · **nunca entra na fila de redistribuição**

### Distribuição híbrida (prioridade + cotas + percentuais)
- **Prioridade:** DIAMOND → GOLD → SILVER → BRONZE
- **Cotas diárias:** configuráveis por categoria (default 1/2/3/5)
- **Mix percentual:** configurável (default 40/30/20/10) · valida soma = 100%
- **Match por segmento:** mesmo segmento primeiro
- Config em `DistributionRule` (tabela) · ajustada via `/api/distribution/rules/:category`

### Fila com agendamento automático
- Excedente do dia vai para `DistributionEntry` com `scheduledFor` = próximo dia disponível
- Exemplo: 1000 leads · capacidade 300 → dia 1: 300 · dia 2: 300 · dia 3: 300 · dia 4: 100 + novos
- Processado a cada 2 min pelo `leadQueueWorker`

### Redistribuição por inatividade
- Configurações em `SystemSetting`: `inactivity.minutes` (default 20) · `inactivity.maxRedistributions` (default 3) · `inactivity.active`
- Job `inactivityRedistributionWorker` roda a cada 60s
- Regras invioláveis:
  - Não redistribui `origin = MANUAL`
  - Não redistribui se `firstContactAt` preenchido (já teve resposta)
  - Limita tentativas em `maxRedistributions`
- Cada redistribuição grava `RedistributionLog` + `AuditEvent`
- Primeira mensagem do associado em `/api/conversations/:id/messages` **marca** `firstContactAt` automaticamente

### Importação de planilha
- `POST /api/imports/leads` (multipart · campo `file`) · aceita `.csv`, `.xlsx`, `.xls`
- Processa em background com status: `RECEIVED → PROCESSING → DISTRIBUTED/ERROR`
- Validação: nome obrigatório · telefone obrigatório · dedup por `phoneHash` (SHA-256)
- Cada lead válido é enfileirado em `DistributionEntry` (respeita agendamento)

### Webhooks (inbound)
- `POST /api/webhooks/leads` · HMAC-SHA256 no header `X-Webhook-Signature`
- `POST /api/webhooks/vai` · HMAC-SHA256 no header `x-vai-signature`
- Dedup por `idempotencyKey` (hash do payload)
- Todos os eventos (válidos ou rejeitados) gravam `WebhookInboundLog`

### Painel TV
- `GET /api/dashboards/tv` · retorna métricas agregadas
- Cache in-memory de 9s · job `dashboardMetricsWorker` aquece a cada 10s
- Polling recomendado: **10 segundos** no cliente

---

## 5 · Segurança

- ✅ **bcrypt 12 rounds** para senhas
- ✅ **JWT access** curto (15m) + **refresh rotativo** em cookie httpOnly com family tracking (detecta reuso)
- ✅ **AES-256-GCM** para dados sensíveis
- ✅ **HMAC timingSafeEqual** nos webhooks
- ✅ **CORS restrito** · origens vindas de `CORS_ORIGIN`
- ✅ **Rate limit** global em `/api`
- ✅ **AuditEvent imutável** (triggers Postgres recomendados em produção)
- ✅ **Pino redaction** de `Authorization` e `Cookie`
- ✅ **Usuário não-root** no container

---

## 6 · Deploy em produção (Docker Swarm)

```bash
# 1. Cria secrets (uma vez)
echo "SuaSenhaPostgresFORTE" | docker secret create postgres_password -
echo "SenhaMinIOFORTE"        | docker secret create minio_password -

# 2. Build e push
docker build -t calebe/crm-backend:latest backend
docker tag calebe/crm-backend:latest registry.seudominio.com/calebe/crm-backend:latest
docker push registry.seudominio.com/calebe/crm-backend:latest

# 3. Deploy
cd backend
cp .env.example .env
# ... edite .env com segredos de produção ...
docker stack deploy -c docker-stack.yml calebe
```

Rolling update zero-downtime · 3 réplicas da API · healthcheck a cada 30s.

---

## 7 · Jobs em background

Rodam dentro do processo Node (stateless · cada réplica executa seu próprio ciclo).

| Job | Intervalo | Função |
|---|---|---|
| `leadQueueWorker` | 2 min | Distribui leads PENDING/SCHEDULED do dia |
| `inactivityRedistributionWorker` | 60 s | Varre leads inativos e redistribui |
| `dashboardMetricsWorker` | 10 s | Aquece cache de métricas TV |

---

## 8 · Documentação complementar

- **[docs/API.md](./docs/API.md)** — todos os endpoints com exemplos
- **[docs/VAI_INTEGRATION.md](./docs/VAI_INTEGRATION.md)** — integração WhatsApp via VAI
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — diagramas e fluxos internos
- **[prisma/schema.prisma](./prisma/schema.prisma)** — schema completo comentado

---

**Versão:** 1.0.0
**Stack:** Node 20 · Express 4.21 · Prisma 5.22 · PostgreSQL 16
**Mantenedor:** Equipe Calebe Investimentos Imobiliários
