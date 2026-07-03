# Arquitetura · Fluxos e decisões

## 1 · Visão geral

```
┌─────────────────────────────┐        ┌────────────────────────┐
│   Frontend                  │        │   VAI (WhatsApp)        │
│   demo-funcionalidades.html │        │   api.vaicrm.com.br     │
└────────────┬────────────────┘        └──────────┬─────────────┘
             │ fetch (Bearer JWT)                 │ outbound VAI
             ▼                                    │ inbound webhook (HMAC)
┌──────────────────────────────────────────────────────────────┐
│  Express API · :4000                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Middlewares: cors · cookie · pinoHttp · rate-limit       │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ Routes: auth · associates · leads · distribution · ...   │ │
│  │ Services: distributionEngine · redistributionEngine · ...│ │
│  │ Jobs: leadQueueWorker · inactivity · dashboard           │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────┬───────────────────────────────┬──────────────────┘
            │ Prisma 5                      │ MinIO (S3)
            ▼                               ▼
┌────────────────────────┐        ┌────────────────────────┐
│   PostgreSQL 16        │        │   MinIO (uploads)       │
│   pgcrypto · citext    │        │   bucket: calebe-docs   │
└────────────────────────┘        └────────────────────────┘
```

---

## 2 · Fluxo de distribuição de leads

### 2.1 · Entrada do lead

```
Webhook ────┐
            ├──▶  createLead()  ──▶  enqueueLead()  ──▶  DistributionEntry
Importação ─┤                                              state = PENDING
Manual ─────┘                                              scheduledFor = dia com espaço
```

### 2.2 · Processamento (a cada 2 min)

```
leadQueueWorker ──▶ distributeToday()
   │
   ├─ computeTargetMix()  → alvo por categoria (ratio % × capacidade)
   ├─ para cada entry com scheduledFor ≤ hoje:
   │    ├─ pickNextAssociate()  (mesmo segmento · cota não estourada · categoria alvo)
   │    ├─ se encontra: atualiza Lead + DistributionEntry (DISTRIBUTED)
   │    └─ se não: reagenda para amanhã (SCHEDULED)
   └─ registra AuditEvent "LEAD_DISTRIBUTED"
```

### 2.3 · Excedente (exemplo · 1000 leads · capacidade 300/dia)

```
Day 0 (hoje):   Distribui 300  → PENDING processado
Day 1:          300 já agendados · leadQueueWorker atribui
Day 2:          300 agendados
Day 3:          100 agendados + novos leads entrantes
```

---

## 3 · Redistribuição por inatividade

```
inactivityRedistributionWorker  (60s)
   │
   ▼
sweepInactivity()
   │
   ├─ busca Lead com: origin != MANUAL · firstContactAt IS NULL · assignedAt < agora - inactivity.minutes
   │
   └─ para cada candidato:
         redistributeLead(leadId, reason)
            ├─ se origin = MANUAL          → reject
            ├─ se firstContactAt preenchido → reject
            ├─ se redistributionCount >= max → reject
            ├─ pickRedistributionTarget()  (prioridade + segmento + cota)
            ├─ Lead.assignedToId = novo · firstContactAt = null · count++
            ├─ RedistributionLog.create()
            └─ AuditEvent "LEAD_REDISTRIBUTED"
```

**Liberação do lead da fila de redistribuição:** acontece automaticamente quando a primeira mensagem do associado é enviada via `POST /api/conversations/:id/messages` — o endpoint marca `Lead.firstContactAt` em transação.

---

## 4 · Segurança · camadas

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Transport: HTTPS (Swarm/ingress)                          │
├─────────────────────────────────────────────────────────────┤
│ 2. CORS restrito por origem                                  │
├─────────────────────────────────────────────────────────────┤
│ 3. Rate limit global (240 req/min)                          │
├─────────────────────────────────────────────────────────────┤
│ 4. JWT access token (15m · stateless)                       │
│    + Refresh token rotativo (cookie httpOnly · family track) │
├─────────────────────────────────────────────────────────────┤
│ 5. RBAC: ADMIN · ASSOCIATE · LEGAL · SECRETARY               │
├─────────────────────────────────────────────────────────────┤
│ 6. AES-256-GCM · phoneEncrypted · clientDataEncrypted        │
│    DATA_ENCRYPTION_KEY rotacionável via re-encrypt migration │
├─────────────────────────────────────────────────────────────┤
│ 7. HMAC (timingSafeEqual) em webhooks                        │
├─────────────────────────────────────────────────────────────┤
│ 8. AuditEvent append-only · triggers Postgres recomendados   │
└─────────────────────────────────────────────────────────────┘
```

### Rotação de tokens · family tracking
Cada refresh gera novo token na **mesma family**. Se um token revogado for reapresentado → família inteira é revogada (detecção de reuso/roubo).

---

## 5 · Painel TV · performance

Polling do cliente é a cada **10 segundos** → stress no DB.
Solução: cache in-memory de 9s em `metricsService.getTvMetrics()`.
O `dashboardMetricsWorker` re-aquece o cache a cada 10s em background.

Resultado: **todos** os polls do cliente servem do cache → 0 queries extras.

---

## 6 · Escalabilidade para 2000+ associados

- Stateless: N réplicas da API atrás de load balancer (Swarm ingress)
- Todos os jobs são idempotentes (múltiplas réplicas rodando workers não corrompem dados — transações Prisma garantem exclusividade)
- Paginação obrigatória em todos os GET em lista
- Índices compostos em campos críticos:
  - `Lead(status, assignedToId)` · `Lead(segment)` · `Lead(origin, createdAt)` · `Lead(assignedToId, firstContactAt)` (chave de redistribuição)
  - `DistributionEntry(state, scheduledFor)` · `(associateId)`
  - `AuditEvent(userId, createdAt)` · `(action, createdAt)`
- Queries `_count` agregadas no `metricsService` (sem N+1)
- `WebhookInboundLog` particionável por mês em produção

---

## 7 · Integração com frontend existente

O frontend (`demo-funcionalidades.html`) usa arrays in-memory. Para integrar:

1. Substituir as constantes `const leads = [...]` por `fetch("/api/leads/my")` no boot
2. Envio de mensagem → `fetch("/api/conversations/:id/messages", { method: "POST" })`
3. Criar lead manual → `fetch("/api/leads/manual", { method: "POST" })`
4. Configurações de distribuição → `fetch("/api/distribution/percentages", { method: "PATCH" })`
5. Painel TV → polling `setInterval(() => fetch("/api/dashboards/tv"), 10000)`

**Importante:** o contrato da API já está alinhado com os campos esperados pelo frontend (ex: `phoneMasked`, `status`, `segment`, `origin`). Migração direta sem reestruturar UI.
