-- Table-map layout versioning (ATLAS POS sync contract).
-- Adds a monotonic per-restaurant layout version + last-change timestamp.
-- Column names are camelCase (no @map on the model fields), matching the
-- existing convention for unmapped Restaurant columns.

ALTER TABLE "restaurants"
    ADD COLUMN IF NOT EXISTS "layoutVersion"   INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "layoutUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
