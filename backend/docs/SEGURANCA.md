# SEGURANÇA — Auditoria defensiva (2026-07-02)

> Sem dados reais/segredos neste documento. Gravidade: 🔴 crítica · 🟠 alta · 🟡 média · 🟢 baixa.

## Incidente encontrado E CORRIGIDO na auditoria (02/07)

| Risco | Local | Gravidade | Ação tomada |
|---|---|---|---|
| **Prisma Studio exposto à internet** (porta 5555, sem autenticação = leitura/escrita TOTAL do banco de produção) | processo `prisma studio --port 5555` no servidor | 🔴 | **Processo morto 02/07.** Porta fechada, API intacta (4 workers). NUNCA rodar Studio em produção sem túnel SSH. |
| **Postgres 5432/5433 abertos à internet** (Docker publica em 0.0.0.0; senha do banco é fraca) | docker-proxy | 🔴 | **Bloqueado 02/07** via `iptables -I DOCKER-USER -p tcp -m multiport --dports 5432,5433 ! -s 127.0.0.1 -j DROP`. Evidência de segurança: só havia conexões loopback. Verificado: bloqueado por fora, API→DB ok. |

✅ **RESOLVIDO 02/07 (noite):** persistência via `calebe-firewall.service` (systemd, roda após o Docker; evita o conflito clássico iptables-persistent × Docker). Script idempotente em `/usr/local/sbin/calebe-firewall.sh`.

## Riscos abertos (por prioridade)

| # | Risco | Local | Grav. | Correção recomendada |
|---|---|---|---|---|
| 1 | Firewall do host INATIVO (ufw); portas expostas: 3000 (SDR), **3002 (SDR — NÃO FECHAR: referenciada no bundle do browser; evidência 02/07)**, 5678 (n8n?) | host | 🟠 | ufw allow 22/80/443/3000/3002 antes de enable; longo prazo: proxy nginx p/ SDR e fechar diretas |
| 2 | Senha do Postgres fraca e presente em `.env` plaintext | `.env` | 🟠 | Rotacionar senha forte + atualizar DATABASE_URL/CHAT_DATABASE_URL; considerar cofre de segredos |
| 3 | JWT secrets com fallback de dev (`dev_access`/`dev_refresh` se env ausente) | `src/auth/jwt.js` | 🟠 | Falhar no boot se `JWT_*_SECRET` ausente (hoje env existe, mas o fallback é uma armadilha) |
| 4 | Tokens vivos em `.env` (WhatsApp Cloud, Twilio, Anthropic, DWV, Imobisec, MinIO, VAPID/FCM) + backups `.env.bak-*` no servidor | servidor | 🟠 | Inventariar e rotacionar periodicamente; apagar backups `.env.bak-*` após conferência (revisão humana) |
| 5 | `commercialOnly` é trava de UI; papel técnico segue ADMIN (chamadas diretas a outras APIs admin passariam) | auth/middleware | 🟡 | Criar papel dedicado (ex.: COMMERCIAL) com gate no backend |
| 6 | Captação LP: `#CRECI` na mensagem é auto-declarado — qualquer um pode se creditar a um corretor | webhook captação | 🟢 | Aceitável (só define o dono do lead); se abusar, assinar o código na URL da LP |
| 7 | Porta interna da API e serviços auxiliares escutando em 0.0.0.0 (mitigado se firewall ativo) | host | 🟡 | Bind 127.0.0.1 onde só o nginx consome |
| 8 | Rate-limit de auth | `server.js` | 🟢 | **Resolvido 02/07:** global 240/min já cobre todo `/api` (inclui auth) + limiter ESTRITO de 40/10min só no `/api/auth/login` (anti brute-force). Ver nota abaixo. |

### Nota · rate-limit e PM2 cluster (02/07)

- `trust proxy = 1` (server.js) → `req.ip` é o IP real do cliente atrás do nginx (senão o limiter trataria todos como 127.0.0.1). **Não remover.**
- `/api` inteiro: 240 req/min por IP (`RATE_LIMIT_MAX`). `/api/auth/login`: 40 tentativas/10min por IP (`RATE_LIMIT_AUTH_MAX`/`RATE_LIMIT_AUTH_WINDOW_MS`). Provado via headers `RateLimit-Limit` (40 no login vs 240 no resto).
- ⚠️ **Nuance:** o store é em memória e roda em cluster de 4 workers → o limite efetivo por IP é até 4× o configurado (login ~40–160/10min; global ~240–960/min). Ainda assim corta brute-force (que precisa de milhares). Já é uma melhora de ~60× no login vs. só o global.
- 🔵 **Hardening futuro opcional (não urgente):** usar store Redis compartilhado (o Redis já existe no projeto, usado por `services/sseHub.js`) via `rate-limit-redis` para o número passar a ser exato entre workers. Exige **fail-open** (se o Redis cair, liberar em vez de bloquear login) — fazer com teste em staging.

## O que JÁ está bem (manter)

- Telefones de clientes cifrados (AES `DATA_ENCRYPTION_KEY`) + hash sha256 para match + máscara na UI; revelação gated por fluxo de liberação (LGPD).
- Webhooks com HMAC (`/leads`, `/vai`) e verify-token + assinatura (WhatsApp).
- Refresh token com rotação e hash; bcrypt(12) nas senhas.
- Source maps NÃO publicados (deploy purga `.map`; nginx devolve SPA shell).
- Templates enganosos bloqueados no servidor (409), allowlist de templates.
- Transferência de lead protegida por senha operacional + auditoria (`LeadTransferLog`, `AuditEvent`).
- Auditoria de ações administrativas em `AuditEvent` (com IP/user-agent).

## Checklist de rotação (fazer na entrada do novo time)

1. Senha do Postgres; 2. `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (invalida sessões — avisar operação); 3. `WHATSAPP_CLOUD_TOKEN` (System User Meta); 4. Twilio; 5. Anthropic; 6. MinIO; 7. `WEBHOOK_LEADS_SECRET`/`SUPPORT_WEBHOOK_TOKEN`; 8. senha operacional de transferência; 9. chaves SSH do servidor (remover chaves antigas de `authorized_keys`).


## Backup (criado 02/07)

- Diário 03:30 (`backup-postgres-calebe.sh`), bancos calebe+chat, validado com restore real em banco temporário. Retenção 14d em `/root/backups/postgres/`. **Pendente: cópia off-site** (decidir destino com o gestor).

## Dependências (npm audit · auditoria 02/07)

**Corrigido com segurança (sem --force, só package-lock):**
- ✅ `form-data` 2.5.5→2.5.6 — HIGH CRLF injection (GHSA-hmw2-7cc7-3qxx). Validado: boot ok + API 200.

**NÃO corrigido (exige decisão humana / staging — REGRA MÁXIMA):**
| Pacote | Sev | Por que não corrigi agora |
|---|---|---|
| `path-to-regexp <0.1.13` (ReDoS) | HIGH | fix só via `--force` = bump MAJOR do Express/router → risco de quebrar TODAS as rotas. Fazer em staging. |
| `xlsx` (SheetJS) | HIGH | **sem fix no npm** (prototype pollution/ReDoS). Opções: migrar p/ versão CDN do SheetJS OU trocar de lib. Usado no import de planilha. |
| `esbuild` (FRONT) | MOD | **só afeta o DEV SERVER** (não a produção — prod é estático no nginx). Sem ação necessária em prod. |
| `@remix-run/router` (FRONT) | HIGH | transitivo do react-router 6.28; fix só via `--force` = bump major do react-router → risco de quebrar navegação. Staging. |
| cookie / qs / body-parser / uuid / fast-xml-parser (transitivos) | MOD | resolvem junto com o bump do Express — ver linha path-to-regexp. |

**Recomendação:** subir Express p/ 5.x + react-router p/ 7.x em STAGING com o TEST_CHECKLIST completo antes de produção. Backup do package-lock pré-fix em `/root/_archives/package-lock.pre-audit-20260702.json`.
