-- =============================================================================
-- Migração manual · adicionar campos do Cloud API ao modelo Message
-- Criada: 2026-05-11
-- Ricardo · Calebe Associados
--
-- POR QUE MANUAL: prisma/migrations/ está vazio (a baseline nunca foi gerada).
-- Rodar `prisma migrate dev` agora geraria uma migration "from-scratch" que
-- entraria em conflito com a estrutura viva. Esta migração é 100% ADITIVA
-- (só ADD COLUMN/INDEX com IF NOT EXISTS), segura para rodar em produção.
--
-- Como aplicar:
--   sudo -u root psql "$DATABASE_URL" -f \
--     /root/vaidavenda-calebe/backend/prisma/manual-migrations/2026-05-11-add-cloud-message-fields.sql
--
-- Rollback (se necessário, antes de qualquer dado novo entrar):
--   ALTER TABLE "Message"
--     DROP COLUMN IF EXISTS "provider",
--     DROP COLUMN IF EXISTS "templateName",
--     DROP COLUMN IF EXISTS "whatsappMessageId",
--     DROP COLUMN IF EXISTS "messageStatus",
--     DROP COLUMN IF EXISTS "failedAt",
--     DROP COLUMN IF EXISTS "errorReason";
--   DROP INDEX IF EXISTS "Message_whatsappMessageId_idx";
-- =============================================================================

BEGIN;

-- Novas colunas (todas opcionais — nullable safe para rows existentes)
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "provider"          TEXT DEFAULT 'vai',
  ADD COLUMN IF NOT EXISTS "templateName"      TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "messageStatus"     TEXT,
  ADD COLUMN IF NOT EXISTS "failedAt"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "errorReason"       TEXT;

-- Índice para match rápido com status callbacks (webhook Cloud API)
CREATE INDEX IF NOT EXISTS "Message_whatsappMessageId_idx"
  ON "Message"("whatsappMessageId");

-- Sanity check — não deveria afetar nada porque DEFAULT cobre, mas garante
-- que rows existentes têm provider='vai' (não NULL) pra simplificar queries.
UPDATE "Message" SET "provider" = 'vai' WHERE "provider" IS NULL;

COMMIT;

-- =============================================================================
-- Verificação pós-migração (rodar separado, fora da transação):
--
-- \d "Message"
-- SELECT COUNT(*) AS total, COUNT(provider) AS with_provider FROM "Message";
-- =============================================================================
