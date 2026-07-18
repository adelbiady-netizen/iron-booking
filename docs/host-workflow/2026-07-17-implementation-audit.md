# Host Workflow Batch — Implementation Audit (2026-07-17)

Scope: callback queue for incoming calls · timeline auto-return-to-Live · rename ממתינים → מזדמנים ·
custom seating duration for מזדמנים · Najma seating-duration messaging contradiction · "table ready" message.

This audit was produced **before any code change**, per the work order. All paths relative to `iron-booking/`.

---

## 1. Incoming calls / callback records — current state

- **Model:** `CallLog` (`backend/prisma/schema.prisma:709`, table `call_logs`) is the only call entity.
  Fields: `phone` (ANI), `called` (DNIS), `group`/`extension`/`callid` (Link PBX metadata), `status`
  (**free-form provider string** — "answered"/other), `duration`, `recordUrl`, `createdAt`, Phase-128
  routing fields (`routingStatus`, `category`, `channel`, `restaurantName`, `guestName` denormalized).
  Indexes: `phone`, `restaurantId`, `callid`. **No queue/ordering index, no callback concept, no notes,
  no handled-by, no status lifecycle.** A forward-looking comment block in
  `backend/src/modules/integrations/link.router.ts:20-25` explicitly anticipates a missed-call/callback
  queue on this model.
- **Ingestion:** Link telephony webhook only — `GET/POST /api/integrations/link/call`
  (`link.router.ts:234-268` → `processCallWebhook` at `:77-226`): routing via `settings.linkGroupIds`
  → legacy hardcoded groups → DNIS match; 60s dedupe by `(callid,status)`; guest enrichment; create; then
  `eventBus.emit('incoming_call', payload)` (suppressed when unrouted).
- **Read API:** `GET /api/call-logs` (`backend/src/modules/calls/router.ts`) — list only, newest-first.
  **No mutation endpoints.**
- **Frontend:** `CallDrawer` (live incoming call w/ guest enrichment), `IncomingCallCard` (compact toast
  when a workflow is active), `CallLogPanel` (history; missed = `status !== 'answered'`; actions only
  prefill reservation/guest search — nothing marks a call handled). Wired in `HostDashboard.tsx:313-405,
  3098-3282`.
- **Realtime:** in-process `EventEmitter` (`backend/src/lib/eventBus.ts`) → SSE
  (`backend/src/modules/integrations/events.router.ts`, JWT via query token, relay filtered per
  `restaurantId`). Exactly two events exist: `incoming_call`, `floor_updated` (`{restaurantId}` → client
  gets `{ts}` and refetches). Frontend: `useServerEvents` hook, backed by 30–60s polling because the bus
  is single-process (documented in HostDashboard comments).

**Decision:** extend `CallLog` with a *separate* callback lifecycle (`queueStatus` enum
PENDING_CALLBACK / CALLBACK_IN_PROGRESS / CALLBACK_COMPLETED / CALLBACK_CANCELLED + `callbackNote`,
`handledBy`, `claimedAt`, `callbackCompletedAt`, composite index `(restaurantId, queueStatus, createdAt)`).
Do **not** overload the provider `status` string. Claim = atomic
`updateMany({where:{id, queueStatus:'PENDING_CALLBACK'}})` count check. New SSE event `callback_updated`
through the existing bus/relay pattern. Missed, routed calls enter the queue at webhook time; FIFO =
`createdAt asc` (server timestamp — survives refresh/devices). One open callback per phone per restaurant
(a second missed call from the same phone does not create a duplicate queue item).

## 2. Timeline / Live mode — current state

- All timeline state is local to `HostDashboard.tsx`: `date` (:153), `time` (:154, 30-min snapped),
  `liveMode` boolean (:159, default true) + `liveModeRef` (:160). Derived `operationalNow` (:530) is the
  single time input to `FloorBoard`/`TableTimeline`. There is **no scrubber**; the timeline position is
  100% a function of `operationalNow`. Live auto-advance = 30s interval (:586-598) gated on `liveModeRef`.
- **Host-driven movers** (must never be fought): `handleDateChange` :2439, `handleTimeChange` :2448,
  `handlePrevDay`/`handleNextDay` :2461/:2472, `handlePrev30`/`handleNext30` :2483/:2490,
  `handleDrawerDateTimeChange` :1467, and `handleNow` :2453 (the only go-live).
- **System-driven movers** (jump + `liveMode=false`): `handlePanelSelect` :708-710 (open reservation from
  list), `openReservationDetails` :731-733 (shared details opener), `handleReorganizeSelect` :719-720,
  `handleChooseTable` :1736-1737. Table-pick mode already snapshots and restores
  (`tablePickRestoreRef` :298, snapshot :1569, restore :1598-1606 / :1644-1650) — but **only** pick mode.
- **No drawer/modal close handler restores time or Live** (GuestDrawer onClose :3162/:3169, CreateDrawer
  onClose :3190-3207, ContextPanel/TableQuickPanel :2932/:2965). After opening any reservation from a
  list, the board silently stays frozen at that reservation's time.

**Decision:** generalize the existing snapshot/restore pattern. System movers snapshot
`{date,time,liveMode}` once per workflow; workflow-end (drawer close, pick done/cancel) restores — to
Live if the board was Live when the system moved it, else to the host's prior planning position. Any
host-driven mover clears the pending snapshot (manual navigation wins). No timers, no loops (restore
happens once per workflow end; the 30s ticker resumes normal Live advance).

## 3. ממתינים → מזדמנים — current state

- Host UI strings: `frontend/src/strings.ts` (EN base) + `frontend/src/i18n/strings-he.ts` (HE),
  selected by `useT()`. Public booking flow uses i18next JSON (`frontend/src/i18n/locales/he.json`).
- Feature-label occurrences (to rename): `reservationPanel.tabWaitlist` 'ממתינים' (:208),
  `waitlistPanel.addToWaitlistButton` (:275), `emptyTitle` (:276), `footerEmpty` (:283), `footerCount`
  (:284), `ctxGuestWaitlist` 'המתנה' (:139), `seatButton` 'שבץ מהמתנה' (:265), `tableCard.waitlistWaiting`
  (:181), `toastWLRemoved` (:1023); manage dashboard: `pages/manage/modules/dashboard/model.ts:87,165`,
  `DashboardModule.tsx:97`.
- Grammatical "currently waiting" occurrences (keep): `tableTimeline.mWait` (:161),
  `reservationPanel.arrivedWaiting` (:232), `waitlistPanel.mWaiting`/`waitingMin` (:285/:290),
  `guestArrived` (:564), `softHoldWaiting` (:817), `urgencyHigh/Critical` (:820/:821).
- Unrelated domains (keep): reservation status 'ממתין' (PENDING, :25), SMS-approval queues
  (IntelligencePage/ClubCenterPage), rewards 'ממתינות למימוש', analytics 'ממתינות' (:939).
- Guest-facing public texts ("הצטרף לרשימת ההמתנה", waitlist WhatsApp in `backend/src/lib/sms.ts:167`)
  are **customer-facing**, not host-facing → unchanged.
- 'מזדמן' already exists for walk-in singular (`reservationPanel.walkIn` :209, `emptyHintWalkIn` :220).

## 4. Seating duration for walk-ins/waitlist — current state

- `Reservation.duration Int` is the only stored duration; end time always derived `time + duration`.
  **`WaitlistEntry` has no duration field.**
- Party-size source of truth: `baselineTurnMinutes(partySize)` = ≤2→90 / ≥3→120
  (`backend/src/engine/opProfile.ts:52`), overridable per restaurant via `TurnTimeRule` rows
  (`resolveTurnTime`, `opProfile.ts:23-43`). `createReservation` uses `input.duration ??
  resolveTurnTime(...)` (`reservations/service.ts:208`); PATCH re-derives on party-size change (:388).
- **Inconsistency:** the waitlist seat path ignores all of that —
  `seatWaitlistGuest` (`waitlist/service.ts:306`) uses flat `settings.defaultTurnMinutes ?? 90`.
  A party of 5 seated from the waitlist gets 90 min where a reservation would get 120.
- UI: CreateDrawer walk-in tab **already** has a full duration control (60/90/120/150 presets + custom
  30–480 step 15 + live end-time preview) feeding `api.reservations.create({duration})` — the reference
  implementation. WaitlistPanel add/edit has **no** duration field; `PATCH /waitlist/:id` service allows
  only `guestName/guestPhone/partySize/notes`; map-based seat (`FloorBoard` waitlistAssign) passes no
  duration. GuestDrawer edits duration for any existing reservation (presets 90/120 + custom).
- Timeline/conflicts consume the stored duration everywhere (`TableTimeline.tsx:189`,
  `validateTableAssignment` → availability engine).

**Decision:** add `durationMinutes Int?` to `WaitlistEntry` (+SQL doc migration); accept/validate it in
add/update/seat; seat precedence = request duration ?? entry duration ?? `resolveTurnTime(...)`
(fixing the flat-90 bug); WaitlistPanel gets default-populated quick picks 60/90/120 + custom + expected
end time.

## 5. Najma messaging contradiction — root cause

- Najma = production restaurant row, **slug `najma`**, id `b40324cc-1a21-4d9a-aef0-1fe03cad4085`.
  No seed/code config; identified only by slug. `settings`: smsEnabled=true, provider INFORU, sender
  NAJMA, **defaultTurnMinutes=90**, no `smsTemplates` overrides. TurnTimeRules: 1–2 → **90**, 3–20 → 120.
- Customer-facing duration wording is generated exclusively by `formatDurationHe/En`
  (`backend/src/lib/duration.ts`): 90 → "כשעה וחצי", 120 → "כשעתיים". No hardcoded "שעה וחצי"/"שעתיים"
  exists anywhere in messaging code; the phrase is always interpolated from the reservation's stored
  `duration`.
- **Root cause of the contradiction:** Najma's real policy is two hours, but its turn-time config still
  carries the generic 90/120 party-size split (+ `defaultTurnMinutes=90` on the waitlist path, + the
  frontend preset mirror `getDefaultDuration` ≤2→90). Different messages/sections therefore mix
  "כשעה וחצי" (parties ≤2, waitlist seats) with "כשעתיים" (parties ≥3) — including within one
  guest-visible flow. Fixing the wording alone would not fix the held-table math.
- **Fix (source of truth, Najma only):** set Najma's TurnTimeRule rows to 120 across all party sizes,
  `settings.defaultTurnMinutes` → 120, and migrate future non-cancelled Najma reservations stored with
  90 → 120 so reminders/confirmations already booked also say שעתיים. Applied by an idempotent script
  keyed to slug `najma` (`backend/scripts/najma-two-hour-turn.ts`). Additionally, host-UI default
  duration must respect restaurant turn rules instead of the hardcoded 90/120 mirror, or Najma hosts
  would keep pre-selecting 90 for small parties.

## 6. "Table ready" message — current state

- `MessageType.TABLE_READY` exists in the schema (`schema.prisma:1067`) with **no builder, sender or
  call site**. `WaitlistEntry.notifiedAt` exists ("when we sent table ready notification") and
  `POST /waitlist/:id/notify` sends a WhatsApp via the UltraMsg stack.
- Two messaging stacks: **InforU SMS** (`backend/src/lib/messaging.ts`) — writes `MessageLog` rows
  (PENDING→SENT/FAILED, provider id, error), per-restaurant gate `settings.smsEnabled` + provider
  selection; **UltraMsg WhatsApp** (`backend/src/lib/sms.ts`) — per-restaurant credentials columns,
  **writes no MessageLog** (gap). `MessageProvider` enum = INFORU | MOCK (no ULTRAMSG value yet);
  `MessageLog` has no `waitlistEntryId` link.

**Decision (as built):** implement table-ready as a first-class waitlist action using the **existing
InforU SMS pipeline only** (`lib/messaging.sendSms`) — same sender, same provider selection
(INFORU / MOCK), same `smsEnabled` gate. No new provider or channel; the `MessageProvider` enum is
unchanged. Always audited in `MessageLog` (add only the `waitlistEntryId` column; `channel: SMS`,
actual InforU/MOCK provider), stamp `tableReadySentAt` on the entry for cheap cross-device duplicate
detection, status WAITING→NOTIFIED (never SEATED), backend 409 on repeat unless `force`, frontend
confirm dialog showing prior send time. (An earlier draft considered a WhatsApp/UltraMsg channel with
fallback; that was dropped — table-ready is InforU SMS only.)

## 7. Realtime, permissions, tests, migrations

- **Realtime:** reuse `eventBus` + SSE relay; add `callback_updated`; keep `floor_updated` for
  waitlist/duration changes (already emitted by waitlist router). Known limitation (documented in code):
  single-process bus; polling fallback covers multi-instance.
- **Permissions:** all host routes use plain `authenticate` with restaurant scoping; no manager gate on
  waitlist/calls today → callback handling and table-ready remain host-level. No new approvals added.
- **Tests today:** no vitest/jest; standalone ts-node/node assert scripts wired as `test:*` npm scripts
  (`test:engine`, `test:service-day`, …) + HTTP verify scripts (`scripts/verify-waitlist-phase1.mjs`
  pattern with dev-super-login). New tests follow this convention.
- **Migrations:** schema is applied by `prisma db push` on deploy; `prisma/migrations/*.sql` files are
  documentation of each change. Required here: `call_logs` callback columns + enum, `waitlist_entries.durationMinutes`
  + `tableReadySentAt`, `message_logs.waitlistEntryId`. All additive/nullable — backward compatible
  with the running deploy. (No `MessageProvider` enum change — table-ready reuses the InforU provider.)

## 8. Ambiguities / risks

- Single-process SSE: two hosts on different Render instances would rely on the polling fallback for
  callback-queue sync (same as existing floor updates). Accepted; documented.
- The Link webhook posts multiple rows per call (ring/answered events share `callid`); the queue must
  key off missed *terminal* events and skip phones with an already-open callback.
- Najma data fix touches production rows (turn rules, settings, future reservations 90→120) — scoped by
  slug, idempotent, logged; longer holds may surface soft conflicts on already-tight days (host can
  shorten per reservation via the existing duration editor).
- Table-ready uses the existing InforU SMS sender and is fully logged in `MessageLog`. The separate
  UltraMsg WhatsApp helper (used by the legacy `/notify` and online-booking acknowledgments) remains
  unlogged and unchanged — out of scope for this batch.
