# HANDOFF TÉCNICO — CRM Calebe Imóveis

> Documento de transferência técnica. Leia este primeiro. Gerado em 2026-07-02 durante auditoria de handoff.

## Resumo executivo

CRM imobiliário em **produção** (`https://app.calebe.tech`) que conecta **leads de imóveis** (litoral de SC — Itapema/Porto Belo) a **~500 corretores associados** via **WhatsApp oficial (Meta Cloud API)**. ~620 usuários, ~17.000 leads, ~74-118 corretores ativos/dia, 15+ números de WhatsApp em rodízio.

**Este sistema opera dinheiro real em tempo real.** Corretores dependem dele diariamente. Qualquer mudança em envio de WhatsApp, distribuição de leads ou autenticação afeta a operação imediatamente.

## Organização

| Componente | Onde | Repositório |
|---|---|---|
| Backend API (Node/Express/Prisma) | `/root/vaidavenda-calebe/backend` | `calebe-investimentos-imobiliarios/calebe-backend` |
| Frontend (React/Vite/TS) | `/root/calebe-frontend-src` | `calebe-investimentos-imobiliarios/calebe-frontend` |
| Frontend publicado (build) | `/root/vaidavenda-calebe/public` | (artefato — nginx serve daqui) |
| Postgres (Docker) | localhost:5432 | — |
| Sistema SDR (SEPARADO) | `/root/calebe/app-calebe` (Next.js :3000, SQLite) + auth-service :3002 | outro sistema — NÃO misturar |

- **Processo:** PM2 cluster `calebe-api` × 4 workers.
- **Deploy:** manual (sem CI/CD). Ver `DEPLOY.md`.
- **Docs:** todos em `docs/` deste repositório.

## O que NÃO pode ser quebrado (leia REGRAS_DE_NEGOCIO.md)

1. **131049 NUNCA blacklista lead** — é throttle por-pessoa da Meta, não condição do lead. Esse bug já foi reintroduzido 2× (13/06 e 30/06) e causou incidente base-wide as duas vezes.
2. **Janela de 24h**: `Conversation.lastInboundAt` é a fonte autoritativa. Mensagem livre só dentro da janela; fora, template aprovado.
3. **Transferir lead entre corretores exige senha operacional** (obter com o gestor) + registro em `LeadTransferLog`. Atribuir lead LIVRE não exige.
4. **`hiddenAt` em mensagens é INTENCIONAL** — não "corrigir".
5. **Números de suporte (IDs `1143966188797246`, `1155522184305211`) NUNCA enviam para lead** — defesa em 5 camadas em `whatsappCloud.js`.
6. **Resposta a lead sai pelo MESMO número em que ele falou** (`Conversation.inboundPhoneId`); lead novo via round-robin GREEN.
7. **Scripts que reatribuem conversa TÊM que resetar `accepted:false, acceptedAt:null`** — senão o lead "some" da aba Pendente do novo corretor.
8. **Telefone real do lead é protegido** — só visível com `phoneReleased`/`autoReleasePhone`/admin (LGPD).

## Como funciona o essencial

- **Auth:** JWT access 7d + refresh 30d com rotação (`src/auth/jwt.js`). Magic links (`/api/auth/magic`). Roles: ADMIN / ASSOCIATE (+DEV bypass), flags `commercialSupportAccess`, `commercialOnly`.
- **Leads:** entram por webhook (`/api/webhooks/leads` — HOJE SEM PRODUTOR ATIVO), captação LP via WhatsApp oficial (`#CRECI` credita corretor), import de planilha, manual. Distribuição: `loginLeadDrop.js` (30/dia no login, teto 60) + engine com janela 07:30–19:00 BRT.
- **WhatsApp:** `services/whatsappCloud.js` é o coração (envio, templates, qualidade, rodízio). Webhook `routes/whatsappCloudWebhook.js` processa inbound + status de entrega.
- **Campanhas:** módulo novo (07/2026) — `routes/campaigns.js` + `services/campaignRunner.js` + tela `/admin/campanhas`. Roleta de resposta = Fase 2 (não implementada).

## Como testar / publicar

- Testes automatizados: **NÃO EXISTEM**. Use `TEST_CHECKLIST.md` (manual) antes de publicar.
- Backend: editar → `node --check` → commit → push → `pm2 restart calebe-api --update-env`.
- Frontend: editar → commit → push → `bash /root/deploy-frontend.sh` (builda, publica, purga source maps). **Corretores precisam de F5** para pegar bundle novo.

## Pendências conhecidas (em ordem de importância)

1. **Entrada de leads parada** — o webhook de tráfego pago (`leads_external`) recebeu 1 POST na vida (16/05). A base não se reabastece sozinha. Ligar Meta Lead Ads → `POST /api/webhooks/leads` (HMAC `WEBHOOK_LEADS_SECRET`).
2. **Roleta de campanhas (Fase 2)** — cliente que responde disparo → corretor online, repasse em 5min.
3. **Regra de firewall não persiste no reboot** — ver `SEGURANCA.md` §Ações.
4. Bucket `corretor_nao_respondeu` do funil retorna 0 (cálculo precisa da lógica de "última msg foi do cliente").
5. Bloqueio fora-de-horário é só aviso (pedido: bloqueio duro).
6. UX: exigência constante de F5 (implementar version-check/auto-reload).
7. Dados: corrigir nome "Magda Rothmann"; e-mail Clayton `...gmail.comc` → `.com`.

## Riscos técnicos para o novo time

- Sem testes automatizados + sem staging → toda mudança é validada em produção. Comece pelo `TEST_CHECKLIST.md`.
- `prisma db push` (sem pasta migrations) → mudanças de schema são aplicadas por SQL aditivo controlado (padrão da casa). NÃO rode `db push` sem revisar drift.
- Multi-worker PM2: estado em memória não é compartilhado (caches por worker; runner de campanha usa claim atômico SQL por isso).
- O sistema SDR (`/root/calebe`) é OUTRO produto no mesmo servidor. Cron do servidor mistura os dois — leia `crontab -l` com atenção.

## Recomendações

1. Criar ambiente de staging + suite mínima de testes E2E dos fluxos do `TEST_CHECKLIST.md`.
2. Migrar segredos para um cofre; rotacionar os listados em `SEGURANCA.md`.
3. Adotar migrations Prisma versionadas.
4. CI simples (build + node --check em PR).
5. Ler `MAPA_GERAL_DO_SISTEMA.md` → `FLUXOS_CRITICOS.md` → `REGRAS_DE_NEGOCIO.md` nesta ordem.
