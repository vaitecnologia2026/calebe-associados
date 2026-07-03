-- =============================================================================
-- Migração manual · campos de Magic Link pra primeiro acesso de corretor
-- Criada: 2026-05-11
--
-- Como aplicar:
--   sudo -u root psql "$DATABASE_URL" -f \
--     /root/vaidavenda-calebe/backend/prisma/manual-migrations/2026-05-11-magic-token.sql
--
-- Rollback (antes de qualquer uso):
--   ALTER TABLE "User"
--     DROP COLUMN IF EXISTS "magicTokenHash",
--     DROP COLUMN IF EXISTS "magicExpiresAt",
--     DROP COLUMN IF EXISTS "magicUsedAt";
--   DROP INDEX IF EXISTS "User_magicTokenHash_key";
-- =============================================================================

BEGIN;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "magicTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "magicExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "magicUsedAt"    TIMESTAMP(3);

-- Unique partial index · só um magic ativo por user, mas múltiplos NULL OK
CREATE UNIQUE INDEX IF NOT EXISTS "User_magicTokenHash_key"
  ON "User"("magicTokenHash")
  WHERE "magicTokenHash" IS NOT NULL;

COMMIT;
