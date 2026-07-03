# CHANGELOG — CRM Calebe

## 2026-07-03 · campaignRunner: template calebe_interesse_empreendimento (2 vars)
- buildParams agora reconhece EMPREENDIMENTO_TEMPLATES: {{1}}=nome do lead, {{2}}=empreendimento (extraido do campaignName do lead via empreendimentoDoCampaign; ex.: "Costa do Marfim R$799k · Meta Ads jun/26" -> "Costa do Marfim"). Lead select passou a incluir campaignName.
- Pronto pra disparar o template calebe_interesse_empreendimento (id 2120252548840344, PENDING Meta) pros 82 leads Meta Ads quando aprovar. Ja respeita a janela 09-19h. Backup: campaignRunner.js.pre-empreend.

## 2026-07-03 · Desativado template calebe_novidade_litoral + denylist de template
- calebe_novidade_litoral (marketing "Temos novidades no litoral catarinense... gostaria de ver as opcoes?") = ~81% de falha, dominado por 131049. Corretores mandavam pelo dropdown quando a janela 24h fechava ("nao entregue").
- NOVO mecanismo WHATSAPP_TEMPLATE_DENYLIST: bloqueia o template no sendTemplate (antes de chamar a Meta, whatsappCloud.js service) + esconde do dropdown (route). Vale pra dropdown/campanha/automatico; facil adicionar mais nomes.
- .env (servidor, nao versionado): removido do ALLOWLIST + WHATSAPP_TEMPLATE_DENYLIST=calebe_novidade_litoral. Backup .env.pre-denylist + fontes .pre-denylist.
- Nenhuma campanha usava (ultima 01/07/2026).
- CONTEXTO IMPORTANTE: 17 templates de marketing TODOS falhando 50-85% (131049 sistemico). A raiz e VOLUME de marketing (nao codigo/versao). Desativar 1 template alivia, nao resolve o sistemico.

## 2026-07-03 · Anti-fantasma: lead descartado que responde volta a aparecer
Bug real (suporte): cliente respondia no WhatsApp, corretor recebia "seu lead respondeu, atenda", mas o lead NAO aparecia na lista dele. Causa: desync Lead<->Conversa - lead descartado/sem dono (assignedToId NULL, discardedAt set), mas a Conversa ainda apontava pro corretor; notificacao usava conv.associateId, lista filtra assignedToId + discardedAt null. 44 casos historicos, 16 em 7d.
- whatsappCloudWebhook.js (inbound): antes de notificar, RECONCILIA o lead - cliente que responde sai do descarte (LOST->QUALIFYING) e, se orfao, o dono da conversa assume a carteira; notifica o dono RECONCILIADO (nao mais conv.associateId cego). Respeita opted_out. Loga desync lead!=conv para revisao.
- Backfill: 16 leads presos (respostas dos ultimos 7d) reconectados ao dono da conversa que recebeu o inbound. Backup: dump 2026-07-03 09:44 (validado) + src/routes/whatsappCloudWebhook.js.pre-antifantasma.
- Caso urgente: lead "Cicinho do Cavaco" devolvido ao corretor Johnny Cardoso (QUALIFYING).
- Verificado: boot 4 workers + health 200; 16/16 com dono e fora do descarte.
- NAO feito: os outros 28 casos (>7d) e a duplicidade de leads (2x mesmo nome) ficam para decisao.

## 2026-07-03 · Falhas WhatsApp (131049): janela de envio + desarmar bloqueio de lead
Diagnostico: ~59% dos outbound falham hoje, 99% = 131049 (cap de marketing POR USUARIO da Meta, global/agressivo em 2026). NAO e versao (Graph v25.0 ativa). 100% das falhas de hoje foram de madrugada (00h-05h BRT).
- campaignRunner.js: disparo de campanha agora respeita JANELA 09h-19h BRT (envs CAMPAIGN_SEND_START_HOUR/END_HOUR). Fora da janela o worker pausa 5min e retoma sozinho — nao cancela a campanha. Corta o 131049 de madrugada.
- conversations.js: DESARMADO o bloqueio de lead por 131049 (blacklistReason 131049_temp* deixa de retornar HTTP 422). Alinha com a REGRA (131049 e throttle do NUMERO, nunca do lead). invalid_number/opted_out seguem bloqueando. 0 leads estavam nesse estado (writer ja morto via _is131049=false).
- Verificado: boot 4 workers + health 200; funcao de janela retorna correto (00h BRT = fora); nenhuma campanha ativa afetada.
- Backups locais: src/services/campaignRunner.js.pre-janela, src/routes/conversations.js.pre-131049.
- NAO feito (aguarda decisao): rotacao de numero no 131049 (staging); revisar 1942 leads invalid_number.

## 2026-07-02 · Rate-limit estrito no login (anti brute-force)
- `server.js`: adicionado `authLoginLimiter` (40 tentativas/10min por IP, envs `RATE_LIMIT_AUTH_MAX`/`RATE_LIMIT_AUTH_WINDOW_MS`) aplicado só a `/api/auth/login`. Global (240/min em todo `/api`) mantido.
- Provado via headers `RateLimit-Limit` (40 no login vs 240 no resto). `trust proxy=1` garante IP real.
- Nuance documentada (SEGURANCA.md): store em memória × 4 workers PM2 → efetivo até 4× o configurado; ainda corta brute-force. Store Redis = hardening futuro opcional (fail-open, staging).
- Backup do arquivo original: `src/server.js.pre-authlimit`.

> A partir de 2026-07-02, TODA mudança entra aqui: data · arquivo · o quê · porquê · risco · como testou.

## 2026-07-02 — Auditoria de handoff (Orion/orquestração)

- **SEGURANÇA:** morto Prisma Studio exposto na :5555 (acesso total ao banco sem auth, aberto à internet). Risco eliminado; API intacta. Teste: porta fechada externamente + PM2 4/4.
- **SEGURANÇA:** bloqueado acesso externo ao Postgres 5432/5433 (iptables DOCKER-USER; evidência: só conexões loopback ativas). Teste: `nc` externo falha; `db.user.count()` interno ok (620). ⚠️ regra não persiste a reboot — PLANO A4.
- **LIMPEZA:** removidos 131 `.bak` do backend + 28 do frontend (arquivo: `/root/_archives/calebe-*-baks-20260702.tar.gz`). Prova de não-uso: sem imports; `readdir` só em pastas de upload. Teste: `node --check`, PM2 4/4, `vite build` ok. Commits `6bacf6b` / `3c10c1e`.
- **DOCS:** criado pacote completo de handoff em `docs/` (18 documentos).

## 2026-07-01/02 — features e correções (sessões anteriores, para contexto)

- Central de Campanhas (novo módulo): tabelas Campaign/CampaignRecipient, runner com claim atômico, funil, dashboard, respostas+drawer, qualidade oficial Meta por número. (`255a642`…`065cd35`, front `173d175`…`3c10c1e`)
- Captação por LP: webhook cria lead de número desconhecido + `#CRECI` credita corretor; LP usa número oficial (554792293685) e não expõe mais telefone do corretor. (`7531aab`, front `1e030a8`)
- Imóveis: valor à vista com desconto (form + detalhe) + card de anúncio PNG. (front `ad57cb8`, `c4f2fb9`)
- **Incidente 131049 (reintroduzido 30/06, revertido 01/07):** removido bloqueio de template e auto-blacklist por 131049; 2.181 leads desbloqueados. (`1b0050e`) — regra permanente em REGRAS_DE_NEGOCIO #1.
- sendText: retry de rate-limit no mesmo número (2,5s/7s). (`db42bcf`)
- Templates `calebe_reabordagem_v1/v2` criados e aprovados; allowlist + auto-fill.
- Distribuições manuais: 319 leads (01/07) + 115 + 770 (02/07, com recuperação de 435 leads quentes + 740 da limpeza_meta).
- Acessos: Eder A. Toledo → supervisor comercial (commercialOnly). Vandique: 164 conversas com telefone liberado.
- Deploy frontend blindado: purga automática de source maps.

## Como registrar (modelo)

```
## AAAA-MM-DD — <resumo>
- <arquivo>: <o que mudou> · Porquê: <motivo> · Risco: <baixo/médio/alto> · Teste: <o que foi validado> · Commit: <hash>
```

## 2026-07-02 (noite) — Backup + firewall persistente (Fase A do plano)

- **BACKUP DO POSTGRES CRIADO** (`/usr/local/sbin/backup-postgres-calebe.sh` + cron 03:30): dump diário -Fc dos bancos calebe (79M) e chat (11M) + globals, validação automática com `pg_restore --list`, retenção 14d, log em `/root/backups/postgres/backup.log`. **Teste de restore REAL executado**: dump restaurado em banco temporário → 620 users / 16.966 leads / 81.462 messages conferidos → banco de teste dropado. Antes desta data NÃO EXISTIA backup.
- **Firewall persistente**: `calebe-firewall.service` (systemd, After=docker) reaplica a regra DOCKER-USER que bloqueia 5432/5433 externamente em todo boot. Idempotente (testado 2× → 1 regra). Resolve o item A4 do PLANO.
- **Evidência :3002**: porta é referenciada no bundle de browser do SDR → NÃO fechar (quebraria login do SDR). Correção correta futura: proxy nginx + bind local (revisão humana).
- Pendência que segue aberta: cópia OFF-SITE do backup (precisa de destino: S3/Backblaze/outro VPS — decidir com gestor).

## 2026-07-02 (noite 2) — Fim do "dá F5" (front `b5ff24f`, bundle index-DssvM6Lc)

- **Causa raiz encontrada:** o app registrava `/sw.js` que NÃO EXISTIA no deploy → dispositivos com o service worker do monólito antigo ficavam com um SW ZUMBI servindo cache velho indefinidamente (origem do "corretor roda app antigo").
- **sw.js kill-switch publicado** (`public/sw.js`): skipWaiting + clients.claim + apaga TODOS os caches + sem handler de fetch (rede sempre) + handlers de web push (VAPID) preservados. Substitui o zumbi na próxima checagem do navegador.
- **Version-check** (`src/lib/versionCheck.ts`, ligado no main.tsx): compara bundle carregado × publicado (index.html no-cache) a cada 4min + ao voltar foco/visibilidade; deploy novo → banner fixo "✨ Nova versão do app disponível [Atualizar]" (sem auto-reload — não perde mensagem digitada). QA: `window.__vchkTest()` no console força o banner.
- Verificado ao vivo: /sw.js serve JS (content-type correto), bundle novo publicado, código do checker presente no bundle.
- Efeito prático: este é o ÚLTIMO deploy que exige F5 manual — dos próximos em diante o app avisa sozinho.

## 2026-07-02 (noite 3) — ROLETA DE CAMPANHA (Fase 2) NO AR

- **Worker `src/jobs/campaignRoletaWorker.js`** (só instância 0 do PM2, tick 60s, janela 07:30–19h BRT): cliente que responde disparo de campanha → se o dono está ONLINE (lastSeenAt<5min) ganha 5min pra atender ("holding"); senão vai na hora pro corretor online com MENOS carga; sem atendimento em 5min → repassa pro próximo (máx 6 tentativas, depois "exhausted" com o último). "Atendeu" = aceitou a conversa OU mandou mensagem. Reassign reseta `accepted` (regra crítica) + loga `RedistributionLog reason=roleta_campanha` + notifica o corretor. **Conta "Apple Review" excluída** (validação pegou antes de ir pro ar). Config: `ROLETA_HOLD_MINUTES`, `ROLETA_MAX_ATTEMPTS`, `CAMPAIGN_ROLETA_ENABLED=false` desliga.
- Colunas novas em `CampaignRecipient`: roletaStatus/HolderId/AssignedAt/Attempts/Tried (SQL aditivo + prisma generate).
- Webhook: resposta de campanha agora seta `roletaStatus=pending`.
- `/api/campaigns/:id/responses` expõe estado da roleta; tela Campanhas mostra chips (🎡 na roleta/aguardando/repassado · ✓ atendido). Front `1ae33c4`.
- Validado: boot correto (1 executor + 3 standby), queries testadas com dados reais (pickOnline retornou corretores online reais; attended validado no caso Leo Garcia), 0 entradas na roleta no rollout (só entra resposta NOVA de campanha — zero impacto retroativo).

## 2026-07-02 (noite 4) — Ajustes de código Fase A (baixo risco, com prova)

- **A6 dados:** e-mail do Clayton Edvino corrigido `claytongoncalves926@gmail.comc`→`.com` (com trava anti-duplicado). "Magda Rothmann" NÃO existe no banco → revisão humana (qual Magda?).
- **A3 segurança:** `auth/jwt.js` fail-fast — removido o fallback silencioso `"dev_access"`/`"dev_refresh"` (gerava tokens forjáveis se .env incompleto); boot ABORTA se JWT_*_SECRET ausente/<16ch. Segredos confirmados reais (64ch). Validado: 4 workers online + assina/verifica token ok.
- **A5 limpeza+segurança:** 18 `.env.bak` (com segredos) movidos p/ `/root/_archives/env-backups/` (dir 700, arquivos 600, fora do dir da app, NÃO apagados). ~145MB de builds antigos (`_public-bak.*`, `public.bak.*`, `_pre-cutover*`) arquivados em `/root/_archives/calebe-public-oldbuilds-20260702.tar.gz` e removidos. `public/` (nginx) intacto.
- **A1 docs:** `scripts/README.md` classifica os ~40 scripts (⛔não-rodar / 🔴perigoso-reatribui / 🟠saúde-envio / 🟢leitura / 🔵one-off).
- **A2:** bucket `corretor_nao_respondeu` — já não existia (removido na redesign do /pool). Nada a fazer.

### 🔴 ACHADO OPERACIONAL (revisão humana)
Todo o **cron do backend está OFF desde 30/06** (linhas `# [OFF]`). Impactos vivos: `_ia_saude_numeros.mjs` off → qualidade/rodízio de números (`healthy_phones.json`) CONGELADO desde 30/06; `_distribuir_500_diario` off → distribuição automática parada. `_ia_blacklist_131049` off = CORRETO (manter). Decidir com o gestor o que religar.

## 2026-07-02 (noite 5) — Religado cron de saúde dos números

- **`_ia_saude_numeros.mjs` RELIGADO** (cron `0 * * * *`, log `/var/log/calebe/ia_saude_numeros.log`). Estava OFF desde 30/06 → `healthy_phones.json` 57h desatualizado (rodízio de envio usando qualidade velha). Rodado 1× à mão: atualizou pra 8 números GREEN ativos + 7 capados (>150 msg/24h). As outras 16 linhas de cron do backend seguem OFF (distribuição, blacklist 131049, reclaims — só religar com aprovação; blacklist 131049 NÃO religar). Efeito colateral do run manual: 1 alerta interno "lista mudou" pro WhatsApp do Ricardo (comportamento normal do script; suprimir via WHATSAPP_CLOUD_ENABLED=false não pegou por nuance do dotenv -r).

## 2026-07-02 (noite 6) — Instrumentação de uso de telas (Fase B1)

- Tabela `RouteHit(path, day, role, count)` + `POST /api/_metrics/route-view` (requireAuth, upsert incremental, fire-and-forget). Front: `lib/trackRoute.ts` (dedupe 60s, normaliza ids dinâmicos p/ :id) ligado em `AdminLayout` e `CorretorLayout` via useEffect em location.pathname. Zero impacto no usuário — só conta quem abre o quê.
- Relatório: `scripts/_uso_telas.mjs` (🟢 leitura) — ranking + comparativo legado×moderno com veredito (APOSENTAR/quase-morto/ainda-usado). **Rodar após ~14 dias** pra aposentar telas legadas COM PROVA (chat-monitor v1, dashboards legados, chat-legado). Testado: endpoint grava e incrementa (3 POSTs→count=3); linha de teste removida.

## 2026-07-02 (noite 7) — Correções baseadas em evidência

- **Logs de produção:** varredura de ~5k linhas → ZERO erro/exceção recorrente (sistema roda limpo).
- **Deps HIGH corrigível com segurança:** `form-data` 2.5.5→2.5.6 (CRLF injection). Só package-lock, boot ok, API 200 (funil 16.966). Commit 88d6619.
- **Deps NÃO corrigidas** (path-to-regexp, xlsx, esbuild dev-only, @remix-run/router) documentadas em SEGURANCA.md com risco e recomendação de staging. esbuild NÃO afeta prod (só dev server).
