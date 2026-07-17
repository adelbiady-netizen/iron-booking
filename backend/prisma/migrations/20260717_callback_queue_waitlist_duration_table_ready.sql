-- Host workflow batch (2026-07-17). Applied via `prisma db push` on deploy;
-- this file documents the change. All statements are additive and nullable —
-- safe against the running deploy (old clients never select/write these).

-- 1) Callback queue on call_logs (separate lifecycle from provider `status`)
DO $$ BEGIN
  CREATE TYPE "CallbackStatus" AS ENUM
    ('PENDING_CALLBACK', 'CALLBACK_IN_PROGRESS', 'CALLBACK_COMPLETED', 'CALLBACK_CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "call_logs"
  ADD COLUMN IF NOT EXISTS "queueStatus"         "CallbackStatus",
  ADD COLUMN IF NOT EXISTS "callbackNote"        TEXT,
  ADD COLUMN IF NOT EXISTS "handledBy"           TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "callbackCompletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "call_logs_restaurantId_queueStatus_createdAt_idx"
  ON "call_logs" ("restaurantId", "queueStatus", "createdAt");

-- 2) Waitlist: host-chosen seating duration + table-ready duplicate-send guard
ALTER TABLE "waitlist_entries"
  ADD COLUMN IF NOT EXISTS "durationMinutes"  INTEGER,
  ADD COLUMN IF NOT EXISTS "tableReadySentAt" TIMESTAMP(3);

-- 3) Message log: link waitlist-context sends (e.g. TABLE_READY) to their entry.
-- Table-ready reuses the existing InforU SMS pipeline — no new provider/channel.
ALTER TABLE "message_logs"
  ADD COLUMN IF NOT EXISTS "waitlistEntryId" TEXT;

CREATE INDEX IF NOT EXISTS "message_logs_waitlistEntryId_idx"
  ON "message_logs" ("waitlistEntryId");
