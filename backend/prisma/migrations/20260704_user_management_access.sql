-- Per-user Management Center access grant (Product Architecture v1).
-- NOTE: this repo applies schema via `prisma db push` on deploy, which adds the
-- column from schema.prisma automatically. This file documents the change and
-- carries the one-time backfill so existing owner-tier users keep access. Run the
-- UPDATE once against production after the column exists.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managementAccess" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing Owner / Admin / Restaurant-Admin keep Management Center access.
UPDATE "users" SET "managementAccess" = true WHERE "role" IN ('OWNER', 'ADMIN', 'RESTAURANT_ADMIN');
