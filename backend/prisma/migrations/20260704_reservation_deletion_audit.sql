-- Durable audit trail for permanent (hard) reservation deletions (P0 fix #2).
-- NOTE: this repo applies schema via `prisma db push` on deploy, which creates this
-- table from schema.prisma automatically. This file documents the change for review
-- and manual application if needed.
--
-- The table intentionally has NO foreign key to "reservations": the reservation row
-- (and its cascaded activity log) is gone after deletion, so the audit must survive
-- independently. `snapshot` holds the full reservation JSON captured before deletion.

CREATE TABLE IF NOT EXISTS "reservation_deletion_audit" (
  "id"              TEXT NOT NULL,
  "restaurantId"    TEXT NOT NULL,
  "reservationId"   TEXT NOT NULL,
  "deletedByUserId" TEXT,
  "deletedByName"   TEXT NOT NULL,
  "deletedByRole"   TEXT,
  "reason"          TEXT,
  "snapshot"        JSONB NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservation_deletion_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reservation_deletion_audit_restaurantId_createdAt_idx"
  ON "reservation_deletion_audit" ("restaurantId", "createdAt");
CREATE INDEX IF NOT EXISTS "reservation_deletion_audit_reservationId_idx"
  ON "reservation_deletion_audit" ("reservationId");
