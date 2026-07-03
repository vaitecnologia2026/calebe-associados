# PERMISSÕES — CRM Calebe

## Papéis (User.role)

| Papel | Quem é | Acesso |
|---|---|---|
| **ADMIN** | gestão Calebe | tudo: `/admin/*`, todas as APIs, vê telefone real, aprova corretor/imóvel/liberação |
| **ASSOCIATE** | corretor associado | `/corretor/*`: seus leads/conversas, imóveis, vendas, financeiro próprio |
| **DEV** | técnico | bypass em middlewares gated (ver `requireCommercialSupport`) + `/dev` |
| público | visitante | Landing, `/c/:slug` (LP corretor), `/imovel/:codigo`, `/cadastro` |

## Flags (User)

| Flag | Efeito |
|---|---|
| `commercialSupportAccess` | habilita painel Ajuda Comercial (gate de API `requireCommercialSupport` = ADMIN + flag; DEV bypassa) |
| `commercialOnly` | trava a UI SÓ no painel Ajuda Comercial (menu reduzido + redirect). ⚠️ é trava de UI — papel técnico segue ADMIN (ver SEGURANCA #5). Usuários: `ajudacomercial@…`, Eder A. Toledo |

## Flags (Associate)

| Campo | Efeito |
|---|---|
| `status` APPROVED/INACTIVE | INACTIVE = bloqueado (com blockReason; dispara template de aviso) |
| `category` BRONZE..DIAMOND | mix de distribuição (DistributionRule) |
| `autoReleasePhone` | todo lead novo do corretor já vem com telefone revelado |
| `isInternalSupport` | corretor interno de apoio (recebe ConversationAssist) |

## Gates de código (backend)

- `requireAuth` → JWT válido (Bearer).
- `requireRole("ADMIN")` → papel exato.
- `requireCommercialSupport` → ADMIN + commercialSupportAccess (DEV bypassa).
- Dono da conversa: rotas de chat validam `conversation.associate.userId === req.user.id` (ou admin).
- Telefone real: admin ∥ assistente ∥ `LEADS_PHONE_ALLOWLIST` ∥ `phoneReleased` (ver `conversations.js` L392).
- Webhooks: HMAC (`/leads`, `/vai`), verify-token+assinatura (whatsapp-cloud), Bearer (`/suporte`).

## Regras operacionais de permissão

1. Mudou role/flag no banco → usuário precisa **re-login** (claims vão no JWT).
2. Transferência de lead atribuído: além de ADMIN, exige **senha operacional** no corpo — não é bypassável por instrução; logada em `LeadTransferLog`.
3. Front esconde menu, backend nega — a regra que vale é sempre a do backend; nunca confiar só na UI.
