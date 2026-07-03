# DEPLOY — CRM Calebe

> Produção única (`app.calebe.tech`), sem CI/CD, sem staging. Deploy é manual e simples — a disciplina é o processo.

## Backend

```bash
ssh root@app.calebe.tech
cd /root/vaidavenda-calebe/backend
git pull --ff-only origin main       # (edições devem vir por git; não editar direto em prod)
node --check src/server.js
npx prisma generate                  # só se schema mudou
pm2 restart calebe-api --update-env  # --update-env é OBRIGATÓRIO se .env mudou
pm2 list | grep calebe-api           # esperar 4× online
pm2 logs calebe-api --lines 20 --nostream   # conferir boot sem erro
```

- Processo: PM2 cluster ×4 (`calebe-api`). Config de boot: `pm2 save` após mudanças de processo.
- Mudança de schema: SQL aditivo idempotente ANTES do restart (ver DATABASE.md §Convenção).

## Frontend

```bash
ssh root@app.calebe.tech
bash /root/deploy-frontend.sh
```

O script: `git pull --ff-only` em `/root/calebe-frontend-src` → `npm ci` se package mudou → `vite build` → `rsync --delete --exclude='*.map' dist/ → /root/vaidavenda-calebe/public/` → **purga `*.map`** (segurança — não remover essa etapa).

- **Usuários precisam de F5** para pegar bundle novo (pendência: version-check/auto-reload).
- nginx serve `public/` com try_files → SPA; NUNCA publicar source maps.

## Rollback

- Backend: `git log --oneline` → `git checkout <hash> -- <arquivo>` ou `git revert` → restart. (.env tem backups datados no servidor.)
- Frontend: re-rodar deploy a partir do commit anterior (`git reset --hard <hash>` no src + deploy) — o build é determinístico.

## Cron do servidor (ATENÇÃO: mistura Calebe e SDR)

`crontab -l` tem ~24 entradas. As do CRM Calebe relevantes: `_ia_saude_numeros.mjs` (qualidade/rodízio dos números WhatsApp — alimenta `data/healthy_phones.json`), relatórios diários (`_relatorio_*.mjs`), distribuição diária. As de `/root/calebe/...` (meta-ads-report, sdr-keepalive, handoff-sla, morning_audit) são do sistema SDR — **outro produto**.

## Serviços vizinhos no mesmo servidor (não confundir)

| Porta | Serviço | Sistema |
|---|---|---|
| 443/80 | nginx (SPA + APIs) | Calebe |
| interna (PORT no .env) | calebe-api (PM2) | Calebe |
| 4000 | push nativo (proxy nginx) | Calebe |
| 3000 | Next.js SDR | SDR (`/root/calebe/app-calebe`, SQLite próprio) |
| 3002 | auth-service SDR | SDR |
| 5432/5433 | Postgres (Docker) — bloqueado externamente 02/07 | Calebe |
| 5678 | docker-proxy (provável n8n) | verificar |

## Checklist pós-deploy (mínimo)

1. PM2 4× online, logs sem erro; 2. login admin ok; 3. abrir uma conversa no chat do corretor; 4. enviar 1 mensagem livre em janela aberta; 5. `/admin/campanhas` carrega funil. Checklist completo: `TEST_CHECKLIST.md`.

## Backup do banco (criado 02/07/2026)

- **Automático:** cron 03:30 → `/usr/local/sbin/backup-postgres-calebe.sh` (calebe + chat, formato -Fc, retenção 14d, log `/root/backups/postgres/backup.log`).
- **Manual antes de mudança arriscada:** `bash /usr/local/sbin/backup-postgres-calebe.sh`.
- **Restore:** ver cabeçalho do script. SEMPRE restaurar primeiro num banco temporário (`restore_test`) e conferir contagens antes de qualquer restore sobre produção.
- **Firewall:** regra anti-exposição do Postgres persiste via `calebe-firewall.service` (systemd).
