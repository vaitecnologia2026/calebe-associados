# DATABASE — CRM Calebe (Postgres via Prisma)

> 35 modelos + 13 enums em `prisma/schema.prisma`. **Sem pasta `migrations/`** — o padrão da casa é SQL aditivo controlado + `prisma generate`. NÃO rode `prisma db push` sem revisar drift. Conexões: `DATABASE_URL` (app) e `CHAT_DATABASE_URL` (espelho de chat).

## Núcleo (CRÍTICO — não alterar sem plano)

| Tabela | Finalidade | Campos-chave | Usada por |
|---|---|---|---|
| **User** | contas (roles ADMIN/ASSOCIATE/…) | role, commercialSupportAccess, commercialOnly, lastLoginAt | auth, tudo |
| **Associate** | corretor associado | userId(1:1), category BRONZE..DIAMOND, status, creci, lastActiveAt, lastBulkDropAt, autoReleasePhone, isInternalSupport, welcome* | distribuição, chat, aprovação |
| **Lead** | lead imobiliário | **phoneEncrypted (AES) + phoneHash (match) + phoneMasked**, status(NEW..LOST), assignedToId, firstContactAt, discardedAt/discardReason, **noWhatsApp/blacklistReason** (só invalid_number/opted_out são permanentes), origin(WEBHOOK/IMPORT/MANUAL), redistributionCount | todo o sistema |
| **Conversation** | 1 conversa por lead×corretor | leadId, associateId(NOT NULL), **lastInboundAt (fonte da janela 24h)**, lastMessageAt, accepted/acceptedAt, **inboundPhoneId (número de resposta)**, **phoneReleased**, manualFree, pinned | chat, webhook, envio |
| **Message** | mensagens | direction, fromRole, text, contentType, fileUrl, provider, whatsappMessageId, **messageStatus/errorReason**, templateName, **hiddenAt (INTENCIONAL)**, deliveredAt/readAt | chat, webhook, métricas |
| **RefreshToken** | sessões (hash, rotação) | userId, tokenHash, expiresAt | auth |

## Distribuição

- **DistributionRule** (cota/percentual/prioridade por categoria), **DistributionEntry** (fila; recusa lead com dono), **RedistributionLog** (leadId, previousAssociateId, newAssociateId, reason, attempt — trilha de "quem tirou lead de quem"), **LeadImport**.

## WhatsApp / Campanhas

- **WebhookInboundLog** — TODO POST externo logado (source: whatsapp_cloud ~400k, vai_flow, leads_external, planilha-*). Ótimo para perícia.
- **Campaign** / **CampaignRecipient** (07/2026) — disparos; recipient.status: queued→sending→sent→responded | failed | no_whatsapp. Claim atômico no runner.

## Imóveis / Vendas

- **Development**, **Property** (value, priceList, **priceCash** = à vista com desconto; visibilidade por campo em `_meta`), **PropertyMedia**, **Permuta**, **Visit**, **Sale**, **SaleDocument**, **Commission**, **StructureRequest**.

## Suporte / Comunicação

- **ConversationAssist(+Note)** (Ajuda Comercial; kind COMMERCIAL), **PhoneReleaseRequest**, **Notification**, **Announcement(+Read)**, **PushSubscription**, **FcmToken**, **PushNotificationSetting**, **CallRecording** (Twilio), **SystemSetting** (config chave-valor: tracking, LP vídeo…), **AuditEvent** (auditoria geral — inclui LEAD_TRANSFER, CAMPAIGN_*, COMMERCIAL_SUPPORT_*), **AssociateApplication**, **Agreement/contratos** conforme rotas.

## Dados sensíveis (LGPD)

- Telefones de LEADS: cifrados + mascarados; nunca logar/expor em docs. Nomes/e-mails de corretores: pessoais. `CallRecording`: áudio de chamadas — tratar como sensível.

## Integridade & riscos

1. **`discardedAt` ≠ apagado** — leads descartados continuam contando em relatórios de base total; lote de higiene 18/06 descartou 8.218 (parcialmente recuperado 02/07). Cuidado com scripts de higiene em massa.
2. **phoneHash com variantes** (9º dígito BR) — SEMPRE usar `phoneHashVariants()` para buscar por telefone, nunca hash direto.
3. **Money via `@db.Money`** em Property — atenção a locale/parse no front.
4. **Sem FK Lead.assignedToId → cascade** — reatribuições são UPDATE simples; a consistência Conversation.associateId × Lead.assignedToId é mantida por código (scripts precisam atualizar as duas).
5. Índices existem nos hot paths (status, lastActiveAt, campaignId+status, leadId…) — conferir `EXPLAIN` antes de novas queries pesadas em Message (maior tabela).
6. **Backup**: verificar rotina de backup do Postgres em Docker (não localizada na auditoria — REVISÃO HUMANA NECESSÁRIA; item #1 de infra).

## Convenção para mudanças de schema

1. Editar `schema.prisma`; 2. Aplicar via SQL aditivo idempotente (CREATE TABLE IF NOT EXISTS / ALTER ADD COLUMN IF NOT EXISTS); 3. `npx prisma generate`; 4. `pm2 restart calebe-api --update-env`; 5. Registrar no CHANGELOG.
