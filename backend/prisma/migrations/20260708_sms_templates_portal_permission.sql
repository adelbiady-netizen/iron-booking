-- Per-restaurant SMS template editing from the restaurant portal, HQ-granted.
-- Applied via `prisma db push` on deploy; this file documents the change.
-- Deny-by-default: HQ enables canManageSmsTemplates per restaurant.

ALTER TABLE "restaurant_portal_permissions"
  ADD COLUMN IF NOT EXISTS "canManageSmsTemplates" BOOLEAN NOT NULL DEFAULT false;
