# CRM Calebe Imóveis — Backend

CRM imobiliário em produção (`https://app.calebe.tech`): conecta leads a ~500 corretores associados via WhatsApp oficial (Meta Cloud API), com distribuição automática, campanhas, imóveis, vendas/comissões e painéis de gestão.

> **Novo no projeto? Leia nesta ordem:** [`docs/HANDOFF_TECNICO.md`](docs/HANDOFF_TECNICO.md) → [`docs/MAPA_GERAL_DO_SISTEMA.md`](docs/MAPA_GERAL_DO_SISTEMA.md) → [`docs/FLUXOS_CRITICOS.md`](docs/FLUXOS_CRITICOS.md) → [`docs/REGRAS_DE_NEGOCIO.md`](docs/REGRAS_DE_NEGOCIO.md)

## Stack

Node 22 (ESM) · Express · Prisma 5.22 · PostgreSQL · PM2 cluster ×4 · nginx · MinIO · Meta WhatsApp Cloud API v25 · Twilio · FCM/VAPID · Anthropic. Frontend (repo `calebe-frontend`): React 18 + Vite + TS + Tailwind.

## Rodar

- **Local:** ver [`docs/SETUP.md`](docs/SETUP.md) (essencial: `WHATSAPP_CLOUD_ENABLED=false` em dev).
- **Produção/deploy:** ver [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Testes:** não há suite automatizada — usar [`docs/TEST_CHECKLIST.md`](docs/TEST_CHECKLIST.md) (P0 em todo deploy).

## Estrutura

```
src/
  server.js      # bootstrap + ~50 mounts
  routes/        # 48 rotas HTTP (zod na borda)
  services/      # regra de negócio (whatsappCloud.js = coração)
  jobs/          # workers in-process
  auth/          # JWT + middleware de papéis
prisma/schema.prisma   # 35 modelos (docs/DATABASE.md)
scripts/               # operacionais (cron + one-off) — ler classificação antes de rodar
docs/                  # TODA a documentação de handoff
```

## Documentação

| Doc | Conteúdo |
|---|---|
| [HANDOFF_TECNICO](docs/HANDOFF_TECNICO.md) | leia primeiro — visão executiva + o que não quebrar |
| [MAPA_GERAL_DO_SISTEMA](docs/MAPA_GERAL_DO_SISTEMA.md) | inventário de módulos com status |
| [FLUXOS_CRITICOS](docs/FLUXOS_CRITICOS.md) / [REGRAS_DE_NEGOCIO](docs/REGRAS_DE_NEGOCIO.md) | os 15 fluxos vitais / 28 regras classificadas |
| [ARCHITECTURE](docs/ARCHITECTURE.md) / [DATABASE](docs/DATABASE.md) / [API_DOCUMENTATION](docs/API_DOCUMENTATION.md) / [PERMISSOES](docs/PERMISSOES.md) | referência técnica |
| [SEGURANCA](docs/SEGURANCA.md) | auditoria defensiva + rotação de segredos |
| [AUDITORIA_CODIGO](docs/AUDITORIA_CODIGO.md) / [PLANO_REFATORACAO_SEGURA](docs/PLANO_REFATORACAO_SEGURA.md) | dívida técnica + plano por risco |
| [SETUP](docs/SETUP.md) / [DEPLOY](docs/DEPLOY.md) / [ENV_EXAMPLE](docs/ENV_EXAMPLE.md) | operação |
| [TEST_CHECKLIST](docs/TEST_CHECKLIST.md) / [UX_FUNCIONALIDADE](docs/UX_FUNCIONALIDADE.md) / [CHANGELOG](docs/CHANGELOG.md) | qualidade |

## Contribuição

1. Nunca editar direto em produção — commit → push → deploy. 2. Toda mudança registra no `docs/CHANGELOG.md`. 3. Mudanças em WhatsApp/distribuição/auth: rodar P1 do checklist. 4. Regras CRÍTICAS (`docs/REGRAS_DE_NEGOCIO.md`) não se alteram sem aprovação do gestor.
