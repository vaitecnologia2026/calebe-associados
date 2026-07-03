# AUDITORIA DE CÓDIGO — 2026-07-02

> Formato: problema · local · risco · recomendação · **corrigir agora?** · **revisão humana?**

## Corrigidos NESTA auditoria (com evidência e validação)

| Problema | Local | Ação | Validação |
|---|---|---|---|
| 159 arquivos `.bak`/backup poluindo o source (131 backend + 28 frontend; só 26 estavam no git) | `src/**` ambos os repos | Removidos 02/07; **arquivados** em `/root/_archives/calebe-{backend,frontend}-baks-20260702.tar.gz` | Prova de não-uso: nenhum import referencia `.bak`; `readdir*` no código lê apenas diretórios de upload. `node --check` ok, PM2 4/4 online, `vite build` ok. Commits `6bacf6b` (be) e `3c10c1e` (fe). |
| Prisma Studio + Postgres expostos à internet | servidor | ver `SEGURANCA.md` | porta 5555 fechada; 5432/5433 bloqueadas; API→DB ok |

## Aberto — pode corrigir com baixo risco (sim/sim = fazer já na próxima janela)

| # | Problema | Local | Risco | Corrigir agora? | Rev. humana? |
|---|---|---|---|---|---|
| 1 | Bucket `corretor_nao_respondeu` do funil sempre 0 (condição `lastInboundAt >= lastMessageAt` nunca verdadeira — lastMessageAt inclui o próprio inbound) | `routes/campaigns.js` /pool | métrica enganosa | sim | não |
| 2 | JWT fallback `dev_access`/`dev_refresh` quando env ausente | `auth/jwt.js` | armadilha de segurança | sim (falhar no boot) | não |
| 3 | Backups de servidor `_public-bak.*`, `public.bak.*`, `_pre-cutover-*` (~9 pastas) e `.env.bak-*` acumulando | `/root/vaidavenda-calebe/` | disco/confusão; .env.bak contém segredos | consolidar em `/root/_archives` | **sim** (conferir antes de apagar .env.bak) |
| 4 | Scripts one-off antigos misturados com scripts de cron em `scripts/` (~40 arquivos, sem README) | `backend/scripts/` | operador roda script errado | criar `scripts/README.md` (cron vs one-off vs PERIGOSO) | sim (classificação) |

## Aberto — precisa evidência antes de mexer (👁 REVISÃO HUMANA)

| # | Item | Observação |
|---|---|---|
| 5 | **Rotas legadas duplicadas**: ChatMonitor v1 × v2, Dashboard × DashboardV2 (admin e corretor), chat-legado × chat v2 | Uso real desconhecido — instrumentar acesso (log de rota) por 2 semanas antes de aposentar. NÃO remover sem métrica. |
| 6 | **Stack VAI legado** (`routes/vai.js`, `vaiClient.js`, `vaiPollingWorker.js`, fallback de envio) | vai_flow parado desde 19/05; fallback ainda é acionável no envio livre. Desligar exige teste do caminho de erro do Cloud. |
| 7 | Dependências backend não auditadas individualmente | rodar `npx depcheck` + `npm audit` na entrada do novo time (runtime CVEs de multer já tratados 06/2026). |
| 8 | `routes/dev.js`, `magic.js`, `tracking.js`, `lpVideo.js`, `welcome-video.js`, `audioMp4.js` | superfícies pequenas; revisar exposição/uso antes de qualquer decisão. |
| 9 | Duplicação de preview/erros entre chat v2 e legado | consolidar SÓ quando o legado for aposentado (item 5). |
| 10 | PM2 com contador de restart alto (100) | maioria são restarts manuais de deploy — verificar `pm2 logs` por crash real recorrente; considerar `pm2 install pm2-logrotate` (já presente) + alerta. |

## Padrões positivos encontrados (manter)

- Comentários datados com "porquê" nas decisões (excelente para arqueologia).
- Zod na borda das rotas; audit trail consistente; SSE para tempo-real.
- Claim atômico (`FOR UPDATE SKIP LOCKED`) nos pontos de concorrência (drop de leads, campanhas).
- Front minimalista em dependências (6 deps).

## Anti-padrões a NÃO repetir

- Editar direto em produção sem commit (histórico de 24 commits à frente do remoto — já sincronizado).
- Criar `.bak` manual em vez de confiar no git (origem dos 159 arquivos).
- Rodar ferramentas de dev (Prisma Studio) no servidor de produção.
