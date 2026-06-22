-- Migration: add_unsubscribe_tokens
-- Adds one-click unsubscribe token infrastructure.
-- Safe to run multiple times (IF NOT EXISTS guards).
-- Apply: psql $DATABASE_URL -f this_file.sql

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "unsubscribe_tokens" (
    "id"           TEXT        NOT NULL,
    "tokenHash"    TEXT        NOT NULL,
    "restaurantId" TEXT        NOT NULL,
    "guestId"      TEXT        NOT NULL,
    "clubMemberId" TEXT,
    "phone"        TEXT        NOT NULL,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "usedAt"       TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unsubscribe_tokens_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "unsubscribe_tokens_tokenHash_key"
    ON "unsubscribe_tokens"("tokenHash");

CREATE INDEX IF NOT EXISTS "unsubscribe_tokens_restaurantId_guestId_idx"
    ON "unsubscribe_tokens"("restaurantId", "guestId");

CREATE INDEX IF NOT EXISTS "unsubscribe_tokens_expiresAt_idx"
    ON "unsubscribe_tokens"("expiresAt");

-- ── Foreign Keys ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "guests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "unsubscribe_tokens"
    ADD CONSTRAINT "unsubscribe_tokens_clubMemberId_fkey"
    FOREIGN KEY ("clubMemberId") REFERENCES "club_members"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
