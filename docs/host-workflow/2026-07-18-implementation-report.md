# Host Workflow Batch — Implementation Report (2026-07-18)

Companion to [2026-07-17-implementation-audit.md](2026-07-17-implementation-audit.md) (pre-code audit)
and [manual-verification-checklist.md](manual-verification-checklist.md).

## 1. Callback queue

- **Model:** extended `CallLog` (no new entity — the record already carries caller/guest/routing data
  and the code anticipated queue fields). New columns: `queueStatus` (enum `CallbackStatus`:
  `PENDING_CALLBACK / CALLBACK_IN_PROGRESS / CALLBACK_COMPLETED / CALLBACK_CANCELLED`),
  `callbackNote`, `handledBy`, `claimedAt`, `callbackCompletedAt`; composite index
  `(restaurantId, queueStatus, createdAt)`.
- **Enqueue:** in the Link webhook (`processCallWebhook`): a routed non-answered call becomes
  `PENDING_CALLBACK`, unless (a) an open callback already exists for that phone (one queue item per
  phone — a repeat missed call keeps the original FIFO position), or (b) the same `callid` was already
  answered (ring→answered event pairs). An **answered** inbound call auto-completes any open callback
  for that phone (the restaurant has spoken to the guest). Best-effort — failures never break ingestion.
- **FIFO:** server `createdAt` ascending; positions are computed server-side. Stable across refresh,
  devices, and reconnects.
- **Endpoints** (`/api/call-logs`): `GET /callbacks` (active FIFO + last 20 closed),
  `POST /:id/callback/start|complete|cancel|release`, `PATCH /:id/callback/note`.
  **Claiming is atomic**: `updateMany({where: {id, queueStatus: 'PENDING_CALLBACK'}})` — a losing host
  gets `409` with the current holder in `error.details.callback` (shown, never silently blocked;
  complete/cancel remain possible on an in-progress item so an abandoned claim can't deadlock the queue).
- **Realtime:** new SSE event `callback_updated` via the existing `eventBus` → `events.router.ts` relay
  (restaurant-scoped). HostDashboard bumps a refresh key; the queue view refetches. Known limitation
  (pre-existing): the bus is per-process — cross-instance sync rides the existing polling fallback.
- **UI:** `CallLogPanel` gained a view toggle — **חזרה ללקוחות** (default) / **יומן**. Queue rows show
  position, status chip (incl. "בטיפול — <host>"), guest name, tappable `tel:` phone, relative wait,
  note editor, and actions (התחל / טופל / הסר / שחרר + הזמנה חדשה / חפש אורח).

## 2. Timeline auto-return to Live

- **Mechanism:** generalized the existing table-pick snapshot pattern. `liveRestoreRef` snapshots
  `{date, time, liveMode}` the **first** time a *system-driven* mover jumps the board
  (`handlePanelSelect`, `openReservationDetails`, `handleReorganizeSelect`, `handleChooseTable`).
  All eight *host-driven* movers (date/time change, ±day, ±30, drawer date change, Now) **clear** the
  snapshot — manual navigation always wins. A single central effect fires when every workflow surface
  is closed (`selectedRes`, `createMode`, `tablePickMode` all null) and restores: to Live-now if the
  board was Live when the system moved it, else to the host's own planning position. The snapshot is
  consumed exactly once → no jump loops. Decision logic extracted to pure
  `frontend/src/utils/liveRestore.ts` (unit-tested).
- **Workflows audited → now auto-return:** open reservation from list ✓, open details from context
  menu/timeline quick actions (seat/move paths) ✓, reorganize select ✓, choose-table/assign ✓,
  seating completion (drawer closes) ✓, create-drawer close ✓, table-pick done/cancel ✓ (pre-existing
  restore retained, now backstopped by the central effect).
- **Workflows that never moved the board (nothing to fix, verified):** waitlist actions, gap/available
  clicks, remove-from-floor, quick-panel open/close, live-alert paths (which intentionally bypass jumps).

## 3. ממתינים → מזדמנים

Context-aware rename in the Hebrew host UI (`strings-he.ts`, manage dashboard):

- **Renamed (feature/queue/host-category):** tab `tabWaitlist` → 'מזדמנים'; 'הוסף למזדמנים';
  '+ הוסף מזדמן'; 'אין מזדמנים כרגע'; 'אין מזדמנים'; '`N` מזדמנים'; 'שבץ מזדמן'; context action
  'מזדמנים'; table badge 'מזדמנים · N דק׳ ממתין'; toast 'הוסר מהמזדמנים'; manage-dashboard pulse card
  'מזדמנים', 'רשימת המזדמנים מתמלאת', attention card 'מזדמנים — N ממתינים'.
- **Kept (literal "currently waiting" grammar):** 'ממתין N דק׳', 'N דק׳ המתנה', 'הגיעו — ממתינים
  בכניסה', urgency 'המתנה ארוכה'.
- **Kept (unrelated domains):** reservation status PENDING 'ממתין', SMS-approval queues, rewards,
  callback queue copy, guest-facing public texts (רשימת המתנה in the online flow and WhatsApp
  waitlist acknowledgment are customer-facing, out of the host-facing scope).

## 4. Custom seating duration for מזדמנים

- **Storage:** `WaitlistEntry.durationMinutes Int?` (null = restaurant rules apply). Validated
  30–480 min (rejects 0/negative; ceiling matches the existing reservation editor).
- **Flows:** add form (quick picks 60/90/120 + free 30–480 + live expected-end-time preview, default
  follows party size until the host chooses), inline edit in the entry details, seat-time override
  (`POST /waitlist/:id/seat` accepts `durationMinutes`), CreateDrawer walk-in tab (already existed)
  and its add-to-waitlist buttons now forward the chosen duration.
- **Seat-time precedence:** explicit seat request → stored entry value →
  `resolveTurnTime(restaurantId, partySize, baselineTurnMinutes(partySize))`. This also **fixes a
  pre-existing bug**: the waitlist seat path used a flat `defaultTurnMinutes ?? 90` and ignored party
  size and per-restaurant turn rules.
- **Timeline/conflicts:** the value lands on `Reservation.duration`, which is the single input to the
  timeline blocks and the availability/conflict engine — verified end-to-end (integration test seats
  with 75 min and asserts `reservation.duration === 75`).
- **Restaurant-aware UI defaults:** `GET /tables/op-settings` now returns active `turnTimeRules` +
  `defaultTurnMinutes`; `resolveDefaultDuration()` (frontend) uses them in CreateDrawer and
  WaitlistPanel, replacing the hardcoded ≤2→90 mirror.

## 5. Najma

- **Identifier:** production restaurant **slug `njma`**, id `4ee783e4-f642-4bbf-a04f-b361e903e38b`,
  name "Najma". (Local/dev copies use slug `najma` — the fix script accepts both, defaulting to prod's.)
- **Root cause (confirmed against the production DB):** the customer message is composed as
  *default main + per-restaurant addon*. Najma's DB addon (settings.smsTemplates[…].addon) says
  **"השולחן יעמוד לרשותכם למשך שעתיים"**, while the main's duration line interpolates the
  reservation's stored `duration` — which was **90** for parties ≤2 (frontend hardcoded 90-min preset
  overriding Najma's own 120-min TurnTimeRule) → "כשעה וחצי" at the top, "שעתיים" lower in the same
  message. Exactly the reported contradiction.
- **Fix (source of truth, Najma only)** — `backend/scripts/najma-two-hour-turn.mjs`, executed
  2026-07-18 against production (`--apply`, dry-run first):
  - TurnTimeRule already 1–20 → 120 (verified, unchanged).
  - `settings.defaultTurnMinutes` 90 → **120** (waitlist-path fallback).
  - **5** future PENDING/CONFIRMED reservations with duration 90 → **120** (5 updated, 0 failed) so
    reminders/confirmations already booked also say שעתיים.
  - Frontend hardcoded-90 preset replaced by rule-aware defaults (§4) so newly host-created Najma
    reservations default to 120.
  - The addon text (owner wording) was not modified; message content is now internally consistent.
- **Other restaurants:** untouched — turn rules and addons are per-restaurant; unit test asserts the
  Najma addon does not leak into a no-addon compose.

## 6. Table-ready message

- **Action:** `POST /waitlist/:id/table-ready` + WaitlistPanel button
  **✉ שליחת הודעה — השולחן מוכן** in the entry details (מזדמנים list drawer/accordion).
- **Message** (`backend/src/lib/tableReady.ts`): branded bilingual default per the spec template;
  adapts naturally when the guest name is missing; makes no indefinite-hold promise.
- **Channel — existing InforU SMS only.** `sendTableReady` calls the same `lib/messaging.sendSms`
  used by every other Iron Booking SMS (reservation-received, confirmation, reminder). No new
  provider or channel is introduced: the send uses the restaurant's configured SMS provider
  (`settings.smsProvider` → InforU in production, MOCK in dev/unconfigured) and the same
  `settings.smsEnabled` gate. There is no WhatsApp path, no fallback, and no channel selection.
- **Audit trail:** every attempt is recorded by `sendSms` in `MessageLog` — `messageType:
  TABLE_READY`, the new `waitlistEntryId` link, `channel: SMS`, the actual InforU/MOCK provider,
  status PENDING→SENT/FAILED, and the provider error message on failure. `WaitlistEntry.tableReadySentAt`
  stamps the last successful send for cheap cross-device duplicate detection.
- **Duplicate guard:** repeat send → `409` with `TABLE_READY_ALREADY_SENT` + previous send time; the
  UI shows "already sent X minutes ago" and asks for confirmation; `force: true` resends. A 409 raced
  from another device switches the UI into the same confirm flow.
- **No auto-seat:** status moves WAITING → NOTIFIED only (+`notifiedAt`); seating remains a separate
  host action (asserted by integration test).
- The legacy `POST /:id/notify` (a pre-existing endpoint using the separate WhatsApp helper) is left
  untouched for backward compatibility but is not used by this feature; the new SMS endpoint powers
  the UI.

## 7. Realtime summary

`floor_updated` now also fires on waitlist add/update/table-ready (was: seat only) so waitlist
changes propagate across devices; `callback_updated` covers the callback queue. Both ride the
existing SSE relay with per-restaurant scoping.

## 8. Tests (all executed, all passing)

| Suite | Command | Result |
|---|---|---|
| Live-restore decision logic | `cd frontend && npm run test:live-restore` | 6/6 |
| Duration defaults + end time | `cd frontend && npm run test:duration` | 6/6 |
| מזדמנים terminology | `cd frontend && npm run test:terminology` | 5/5 |
| Table-ready message builder | `cd backend && npm run test:table-ready` | 5/5 |
| Najma two-hour wording (incl. bug-mechanism regression) | `cd backend && npm run test:najma-wording` | 7/7 |
| Integration: callbacks FIFO/concurrency/auto-resolve, waitlist duration persist/edit/seat/validation, table-ready send/audit/duplicate/no-seat | `cd backend && npm run verify:host-workflow` (against local server) | 42/42 |
| TypeScript | `npx tsc --noEmit` backend + frontend, `npm run build` frontend | clean |

## 9. Migrations

`backend/prisma/migrations/20260717_callback_queue_waitlist_duration_table_ready.sql` (documentation;
applied by `prisma db push` on deploy). All additive/nullable — safe against the running deploy:
callback columns + `CallbackStatus` enum on `call_logs`, `durationMinutes` + `tableReadySentAt` on
`waitlist_entries`, and `waitlistEntryId` on `message_logs`. The `MessageProvider` enum is unchanged
(INFORU / MOCK) — table-ready reuses the existing InforU provider, so no new enum value was needed.
Applied to the local dev DB; **production schema updates on next deploy** (not deployed per work order).

## 10. Remaining risks / follow-ups

- **Not deployed.** Until the next backend deploy, production lacks the callback endpoints, waitlist
  duration fields, and table-ready endpoint; until the next frontend deploy, Najma hosts creating
  ≤2-party reservations still send the old hardcoded 90 (the Najma data fix + already-live 120 rule
  cover online bookings and everything already stored).
- Cross-instance SSE remains best-effort (pre-existing single-process bus); polling fallback bounds
  staleness.
- Link provider status vocabulary is free-form; enqueue treats any non-"answered" status as missed
  (matches the existing UI rule). If the provider emits interim statuses beyond ring/answered, watch
  the queue for false positives in the first field days.
- Table-ready sends through the existing InforU SMS pipeline; a live-field test needs a restaurant
  with `smsEnabled` + INFORU configured (the integration test exercises the same code path via the
  MOCK provider, and the send is fully audited in `MessageLog`).
- Manual field verification per [manual-verification-checklist.md](manual-verification-checklist.md)
  still required on real tablets (RTL layout, tel: links, two-device SSE timing).
