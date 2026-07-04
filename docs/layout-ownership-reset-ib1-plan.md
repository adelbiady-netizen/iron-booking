# Layout Ownership Reset — IB-1 Plan (Iron Booking side)

**Status:** Plan only. **No code written.**
**Scope:** Iron Booking backend only. Companion to ATLAS's
`docs/architecture/layout-ownership-reset*.md` (approved). ATLAS C1 is already live
(ATLAS no longer pulls layout).

**Goal of IB-1:** stop Iron Booking from **pushing** restaurant-layout changes to
IRON POS / ATLAS. After IB-1, structural table/zone edits in Iron Booking no longer
emit `layout.changed`, no longer bump `layoutVersion`, and no manual directory push
remains. Hospitality (reservations/visits/seating) and table identity are untouched.

---

## 1. Exact code that pushes layout today (verified)

### A. `layout.changed` event emission
- **`backend/src/modules/pos/dispatcher.ts:96-129`** — `queueLayoutChanged(restaurantId, layoutVersion)`.
  Writes a `layout.changed` envelope (`type: 'layout.changed'`, line 109; payload
  `{ layout_id, layout_version }`, line 118) into `pos_outbox` for delivery to ATLAS.
  **Sole caller:** `bumpLayoutVersion()`.

### B. `layoutVersion` bumps
- **`backend/src/modules/pos/layout.ts:20-27`** — `bumpLayoutVersion(restaurantId)`.
  Increments `Restaurant.layoutVersion` + sets `layoutUpdatedAt` (line 23), then calls
  `queueLayoutChanged` (line 26). Imports `queueLayoutChanged` at line 14.
- **Callers — `backend/src/modules/tables/router.ts`** (import at line 8):
  - `:220` upsertSection · `:229` updateSection · `:239` deleteSection
  - `:257` createTable · `:317` updateTable · `:326` deleteTable

### C. `resync-tables` push (manual directory push)
- **`backend/src/modules/pos/router.ts:371-~452`** — `POST /api/v1/pos/admin/resync-tables`.
  Admin-triggered; emits a `system.table_directory_sync` envelope (`type` at line 404)
  carrying every table's `name`, `zone`, `capacity`, `active`, `combined_table_ids` to
  ATLAS.

### D. POS layout **export** (pull, NOT push — out of IB-1 scope)
- **`backend/src/modules/pos/router.ts:65`** `GET /pos/layout/version`,
  **`:74`** `GET /pos/layout`, backed by `buildVersionPayload` / `buildLayoutPayload`
  (`layout.ts:29,45`). These are **pull** endpoints ATLAS used to call; dormant since
  ATLAS C1. **Left in place in IB-1; removed in IB-2.** Listed here only so it is not
  confused with the push paths above.

---

## 2. What IB-1 must NOT touch (guardrails, verified independent)

- **`queueVisitEvent`** (`dispatcher.ts:48`) and all `visit.*` events
  (`reservation_created`, `guest_arrived`, `table_assigned`, `reservation_cancelled`,
  `no_show`) — the hospitality/seating contract. Independent of the layout functions.
- **`Table.atlasTableId`** and identity provisioning: `POST /pos/admin/attach` (`router.ts:85`),
  `POST /pos/admin/populate-atlas-table-ids` (`:709`), `POST /pos/admin/resync-visits` (`:648`).
- **`POST /events/ingest`** (`router.ts:42`) — inbound POS→IB order/payment state.
- **Internal SSE:** `eventBus.emit('floor_updated', …)` in `tables/router.ts:230,240` is
  Iron Booking's **own** host-UI refresh — **keep it**. It is not an ATLAS push.
- **Prisma schema:** `Restaurant.layoutVersion` / `layoutUpdatedAt` columns stay for now
  (they simply go stale). No migration in IB-1; dropped later in IB-2/schema cleanup.

---

## 3. Commit split (IB-1)

Two small, independently revertible commits. `npx tsc --noEmit` must pass clean before
each commit (repo rule). Remove every now-unused import as part of the same commit.

### IB1-a — Stop the automatic push (version bump + `layout.changed`)

- **`tables/router.ts`:** delete the 6 `await bumpLayoutVersion(req.auth.restaurantId);`
  calls (lines 220, 229, 239, 257, 317, 326) and remove the now-unused import at line 8.
  **Keep** the two `eventBus.emit('floor_updated', …)` lines (host-UI SSE).
- **`layout.ts`:** delete `bumpLayoutVersion()` (20-27) and remove its now-unused
  `queueLayoutChanged` import (line 14). **Keep** `buildLayoutPayload` / `buildVersionPayload`
  (used by the pull endpoints; removed in IB-2).
- **`dispatcher.ts`:** delete `queueLayoutChanged()` (96-129). **Keep** `queueVisitEvent`.
  No import cleanup needed: `createHash` (line 14) is still used by `queueVisitEvent`
  (line 59) and `prisma` by `queueVisitEvent` — both stay satisfied.

**Result:** no structural edit bumps `layoutVersion` or queues `layout.changed`.

**Optional (recommended) drain:** mark any still-`pending` `layout.changed` rows in
`pos_outbox` as delivered (or dead) so the dispatcher stops retrying them. Not required —
ATLAS C1 already accepts-and-ignores `layout.changed`, so undrained rows are harmless.

### IB1-b — Disable the manual `resync-tables` push

- **`pos/router.ts`:** make `POST /pos/admin/resync-tables` (371-~452) a no-op that
  returns a clear deprecation response (e.g. `410 Gone` / `{ deprecated: true, reason:
  "IRON POS owns the restaurant layout; table-directory push is disabled." }`) instead of
  building and emitting the `system.table_directory_sync` envelope. **Keep the route**
  (full removal is IB-2), and leave `resync-visits`, `populate-atlas-table-ids`, `attach`
  untouched.

**Result:** no manual layout/directory push path remains.

> IB1-a and IB1-b are independent; either order is fine. They can be squashed into one
> commit if preferred, but two keeps the version-bump removal and the admin-endpoint
> change separately revertible.

---

## 4. Deployment (per repo rule)

- Backend-only change. Run `npx tsc --noEmit` clean, then deploy per the Iron Booking
  dual-Vercel rule (root `iron-booking` project + `frontend/`). Frontend is unchanged, but
  deploy both so `www.ironbooking.com` and the frontend project do not diverge.
- **Do not** run any Prisma migration in IB-1.

---

## 5. Verification (after deploy)

1. Edit a table and a zone in Iron Booking. Confirm **no new `layout.changed` row** appears
   in `pos_outbox` (`GET /pos/admin/outbox`) and `Restaurant.layoutVersion` **does not
   increment**.
2. Call `POST /pos/admin/resync-tables` → confirm it returns the deprecation response and
   emits **no** `system.table_directory_sync`.
3. Create + seat a reservation → confirm `visit.reservation_created` / `visit.table_assigned`
   **still queue** with `atlas_table_id` (hospitality path unaffected).
4. Confirm the host floor map still updates (internal `floor_updated` SSE intact).

---

## 6. Rollback

Both commits revert by redeploy (no schema change to undo). Undrained/optional-drained
`pos_outbox` rows are inert either way.

---

## 7. Sequencing note

IB-1 is the checkpoint that unblocks ATLAS **C2**. After IB-1 is live and verified, ATLAS
proceeds to remove its layout ingest handlers/routes (keeping `ExportTableDirectory`
slimmed to identity-only). IB-2 (remove `GET /pos/layout*`, drop `layoutVersion` columns)
comes later, after ATLAS C4.
