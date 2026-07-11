-- Password reset (temporary password) + user hard-delete support.
-- NOTE: this repo applies schema via `prisma db push` on deploy, which adds the
-- column from schema.prisma automatically. This file documents the change.
--
-- mustChangePassword: set true when a SUPER_ADMIN issues a temporary password
-- via POST /admin/users/:id/reset-password. Cleared when the user sets their own
-- password at the next login via POST /auth/change-password.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
