# PLANO DE REFATORAÇÃO SEGURA

> Regra máxima: nada é removido sem prova (sem uso real + substituído + sem impacto em fluxo crítico + validado). Na dúvida → REVISÃO HUMANA. Sistema em produção sem testes automatizados: toda mudança passa pelo `TEST_CHECKLIST.md`.

## ✅ Já executado nesta auditoria (baixo risco, com prova)

1. Remoção dos 159 `.bak` (arquivados; validação: node --check + PM2 + vite build). 
2. Fechamento do Prisma Studio e bloqueio externo do Postgres (evidência: só conexões loopback).

## Fase A — Baixo risco (executar já, 1 PR cada)

| Ação | Validação |
|---|---|
| A1. `scripts/README.md` classificando os ~40 scripts (cron / one-off / PERIGOSO) | revisão de texto |
| A2. Corrigir bucket `corretor_nao_respondeu` (`/pool`) | comparar contra amostra manual de 10 conversas |
| A3. JWT: falhar no boot sem `JWT_*_SECRET` | boot em máquina de teste sem env |
| A4. Persistir regra iptables (netfilter-persistent) | reboot em janela de manutenção + re-teste externo |
| A5. Consolidar backups soltos do servidor em `/root/_archives` (SEM apagar `.env.bak*` — só mover) | conferência visual |
| A6. Dados: corrigir nome Magda; e-mail Clayton `.comc→.com` | SELECT antes/depois |

## Fase B — Médio risco (planejar, executar com checklist)

| Ação | Pré-condição |
|---|---|
| B1. Instrumentar contagem de acesso nas rotas suspeitas de legado (chat-legado, dashboards v1, ChatMonitor v1) por 14 dias | log leve por rota |
| B2. Bloqueio duro fora-de-horário no envio do corretor (hoje é só aviso) | aprovação do gestor (mudança de comportamento) |
| B3. Roleta de campanhas (Fase 2) | spec já definida (respondeu → corretor online → repasse 5min) |
| B4. Version-check no front (auto-reload em bundle novo — mata o "precisa dar F5") | testar com corretores-piloto |
| B5. `npx depcheck` + `npm audit fix` seletivo | build + checklist completo |
| B6. Papel COMMERCIAL dedicado (tirar supervisores do role ADMIN) | mapear endpoints que usam |

## Fase C — Alto risco (só com staging OU janela + rollback ensaiado)

| Ação | Racional |
|---|---|
| C1. Aposentar rotas/telas legadas comprovadamente sem acesso (após B1 mostrar 0 hits em 14 dias) | reduzir superfície |
| C2. Desligar stack VAI (fallback de envio) | exige simular falha do Cloud e ver comportamento |
| C3. Republicar Postgres em 127.0.0.1 (fix definitivo vs iptables) | restart de container do banco |
| C4. Migrar para migrations Prisma versionadas | disciplina de schema |
| C5. Rotação de segredos em bloco (invalida sessões) | comunicar operação |

## ⛔ Não mexer sem aprovação explícita do gestor

- Regras de negócio CRÍTICAS (REGRAS_DE_NEGOCIO.md) — em especial 131049, janela 24h, senha de transferência, hiddenAt, números de suporte.
- Robô de redistribuição por inatividade (desligado por decisão de negócio).
- Reestruturação de pastas (imports/rotas/build — alto risco de regressão silenciosa; ganho baixo agora).
- Qualquer coisa que envie mensagem em massa a clientes.

## Ordem canônica de qualquer mudança

editar → `node --check`/`vite build` → commit descritivo → push → deploy (`pm2 restart` / `deploy-frontend.sh`) → validar fluxo afetado no `TEST_CHECKLIST.md` → registrar no `CHANGELOG.md`.
