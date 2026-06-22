-- Migration: add_consent_audit
-- Adds immutable ConsentAudit ledger + supporting enums.
-- Safe to run multiple times (IF NOT EXISTS guards).
-- Apply to production: psql $DATABASE_URL -f this_file.sql

-- ── Enums ──────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ConsentType" AS ENUM (
    'SMS_MARKETING',
    'BIRTHDAY_SMS',
    'ANNIVERSARY_SMS',
    'SURVEY',
    'CLUB_MEMBERSHIP',
    'EMAIL_MARKETING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ConsentAction" AS ENUM (
    'GRANTED',
    'REVOKED',
    'UPDATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ConsentSource" AS ENUM (
    'BOOKING_FLOW',
    'CLUB_JOIN_FORM',
    'FEEDBACK_FORM',
    'HOST_MANUAL',
    'IMPORT',
    'API',
    'UNSUBSCRIBE_LINK'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "consent_audits" (
    "id"                 TEXT        NOT NULL,
    "restaurantId"       TEXT        NOT NULL,
    "guestId"            TEXT        NOT NULL,
    "clubMemberId"       TEXT,
    "consentType"        "ConsentType"   NOT NULL,
    "action"             "ConsentAction" NOT NULL,
    "source"             "ConsentSource" NOT NULL,
    "smsConsent"         BOOLEAN,
    "marketingConsent"   BOOLEAN,
    "emailConsent"       BOOLEAN,
    "consentTextVersion" TEXT,
    "ipAddress"          TEXT,
    "userAgent"          TEXT,
    "actorId"            TEXT,
    "notes"              TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_audits_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "consent_audits_restaurantId_idx"
    ON "consent_audits"("restaurantId");

CREATE INDEX IF NOT EXISTS "consent_audits_guestId_idx"
    ON "consent_audits"("guestId");

CREATE INDEX IF NOT EXISTS "consent_audits_clubMemberId_idx"
    ON "consent_audits"("clubMemberId");

CREATE INDEX IF NOT EXISTS "consent_audits_restaurantId_createdAt_idx"
    ON "consent_audits"("restaurantId", "createdAt");

-- ── Foreign Keys ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "consent_audits"
    ADD CONSTRAINT "consent_audits_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consent_audits"
    ADD CONSTRAINT "consent_audits_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "guests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "consent_audits"
    ADD CONSTRAINT "consent_audits_clubMemberId_fkey"
    FOREIGN KEY ("clubMemberId") REFERENCES "club_members"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
