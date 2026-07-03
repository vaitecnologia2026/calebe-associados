# Calebe Associados — Monorepo

Fonte única do CRM **Calebe Associados**.

## Estrutura
- **`frontend/`** — app React + Vite + TypeScript + Tailwind (corretor + admin).
  Deploy: `npm run build` → bundle estático servido por nginx em `app.calebe.tech`.
- **`backend/`** — API Node.js (Express + Prisma + PostgreSQL). WhatsApp Cloud,
  push nativo FCM/APNs (Firebase Admin), auth JWT com refresh.

## Segredos
Os arquivos `.env` **reais NÃO estão versionados** (ver `.gitignore`).
Use `backend/.env.example` como referência para criar o seu `.env`.

## Histórico
Snapshot inicial consolidado em **2026-07-03**: reúne o trabalho de push
iOS/Android + auto-login, o redesign do header do ChatV2 e as features do
Elison (Ajuda Comercial, campanhas, pin de conversa etc.) — antes espalhados
entre o local e o `server-src`, agora numa fonte única.
