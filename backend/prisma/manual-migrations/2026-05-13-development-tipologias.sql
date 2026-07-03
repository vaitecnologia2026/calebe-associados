-- 2026-05-13 · Reformula capa do empreendimento
-- Substitui valorAvista/valorAPrazo/valorPermuta por:
--   tipologias            (JSONB) → [{ "suites": 2, "valorAvista": 749000 }, ...]
--   valorPermutaParcelado (MONEY) → valor único pra permuta+parcelado
-- Idempotente.

ALTER TABLE "Development"
  DROP COLUMN IF EXISTS "valorAvista",
  DROP COLUMN IF EXISTS "valorAPrazo",
  DROP COLUMN IF EXISTS "valorPermuta";

ALTER TABLE "Development"
  ADD COLUMN IF NOT EXISTS "tipologias"            JSONB,
  ADD COLUMN IF NOT EXISTS "valorPermutaParcelado" MONEY;
