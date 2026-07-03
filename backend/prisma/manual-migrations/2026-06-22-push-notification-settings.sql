-- 2026-06-22 · PushNotificationSetting
-- Controle admin sobre quais eventos do sistema disparam push (FCM/APNs + Web Push).
-- Cada linha = 1 evento (key única). isActive=false bloqueia o disparo no sendPushToUser.
-- Idempotente: pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS "PushNotificationSetting" (
  "key"         TEXT        PRIMARY KEY,
  "label"       TEXT        NOT NULL,
  "description" TEXT        NOT NULL,
  "category"    TEXT        NOT NULL,
  "isActive"    BOOLEAN     NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PushNotificationSetting_category_idx"
  ON "PushNotificationSetting" ("category");
