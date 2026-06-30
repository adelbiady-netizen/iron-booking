-- ATLAS POS ↔ Iron Booking integration — Priority 1 schema
-- Apply with: psql $DATABASE_URL -f prisma/migrations/20260630_pos_integration.sql

-- 1. Idempotency log for incoming POS events
CREATE TABLE IF NOT EXISTS pos_event_log (
    event_id    TEXT        PRIMARY KEY,
    event_type  TEXT        NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload     JSONB       NOT NULL
);

-- 2. Walk-in / unmatched POS orders (no reservation at order.opened time)
CREATE TABLE IF NOT EXISTS pos_visits (
    visit_id        TEXT           PRIMARY KEY,   -- = ATLAS order.id
    restaurant_id   UUID           NOT NULL,
    atlas_table_id  TEXT           NOT NULL,      -- ATLAS table_id UUID (raw, no FK)
    cover_count     INT,
    opened_at       TIMESTAMPTZ    NOT NULL,
    paid_amount     NUMERIC(10, 2),
    closed_at       TIMESTAMPTZ,
    status          TEXT           NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS pos_visits_restaurant_id ON pos_visits (restaurant_id);

-- 3. Per-restaurant ATLAS connection config
CREATE TABLE IF NOT EXISTS pos_config (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID        NOT NULL UNIQUE,
    atlas_location_id   TEXT        UNIQUE,
    atlas_brand_id      TEXT,
    pos_api_base        TEXT        NOT NULL,
    pos_secret          TEXT        NOT NULL,          -- POS uses this Bearer token to call us
    hospitality_secret  TEXT        NOT NULL,          -- we use this Bearer token to call POS
    attached_at         TIMESTAMPTZ,
    ack_received_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Link ATLAS table_id to Iron Booking table rows (populated by setup-pos-attach script)
ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS atlas_table_id TEXT UNIQUE;

-- 5. Bind POS order.id to a reservation (set by order.opened table-time lookup)
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS pos_visit_id TEXT UNIQUE;
