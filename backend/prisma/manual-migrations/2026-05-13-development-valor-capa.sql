-- 2026-05-13 · Valores únicos por empreendimento na capa do card
-- À vista / A prazo / Permuta — todos opcionais.
-- Idempotente: pode rodar mais de uma vez.

ALTER TABLE "Development"
  ADD COLUMN IF NOT EXISTS "valorAvista"   MONEY,
  ADD COLUMN IF NOT EXISTS "valorAPrazo"   MONEY,
  ADD COLUMN IF NOT EXISTS "valorPermuta"  MONEY;
