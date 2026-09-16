import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';
import type { PosEventEnvelope } from './schema';
import { localWallClock, pickReservationForOrder, pickBindablePosVisit } from './reservationMatch';

type IngestResult = {
  accepted: string[];
  rejected: { event_id: string; reason: string }[];
};

export async function ingestEvents(restaurantId: string, events: PosEventEnvelope[]): Promise<IngestResult> {
  const accepted: string[] = [];
  const rejected: { event_id: string; reason: string }[] = [];

  for (const event of events) {
    // Idempotency: insert into log — 0 rows = already processed
    const inserted = await prisma.posEventLog.createMany({
      data: [{ eventId: event.event_id, eventType: event.type, payload: event.payload as object }],
      skipDuplicates: true,
    });

    if (inserted.count === 0) {
      accepted.push(event.event_id);
      continue;
    }

    try {
      switch (event.type) {
        case 'pos.pos_attached_ack':
          await handlePosAttachedAck(restaurantId);
          break;
        // Order opened / visit bound. ATLAS emits pos.visit_opened; the older
        // order.opened name is kept for back-compat.
        case 'order.opened':
        case 'pos.visit_opened':
          await handleOrderOpened(restaurantId, event);
          break;
        // Payment recorded. ATLAS emits visit.payment_completed.
        case 'payment.completed':
        case 'visit.payment_completed':
          await handlePaymentCompleted(restaurantId, event);
          break;
        // Order closed / table released → clear the active-order flag. ATLAS
        // emits visit.table_released on close.
        case 'order.closed':
        case 'visit.table_released':
          await handleOrderClosed(restaurantId, event);
          break;
        // Meal course advanced (starter/main/dessert) → colour the floor.
        case 'visit.course_stage_changed':
          await handleCourseStageChanged(restaurantId, event);
          break;
        // Full itemised visit record on close → guest/reservation history.
        case 'visit.summary':
          await handleVisitSummary(restaurantId, event);
          break;
        // Bill requested on the POS → flag the bound reservation so the host
        // floor shows "חשבון מבוקש".
        case 'visit.bill_requested':
          await handleBillRequested(restaurantId, event);
          break;
        // Whole order voided → free the table's active-order state so the host can
        // close it (or a new order can bind). Not a paid close → no auto-complete.
        case 'visit.order_voided':
          await handleOrderVoided(restaurantId, event);
          break;
        // Whole-order table transfer on the POS → mirror the move inbound so the
        // bound reservation FOLLOWS the order to the new table (POS-authoritative),
        // freeing the original table. Inbound-only — must NOT re-emit to ATLAS.
        case 'pos.visit_table_changed':
          await handleVisitTableChanged(restaurantId, event);
          break;
        // First kitchen-fire of the order → flip the fire flag. The floor's
        // order-occupied projection + course/bill pill are gated on this.
        case 'visit.fired':
          await handleVisitFired(restaurantId, event);
          break;
        // Accepted, no state change:
        case 'order.items_sent':
        case 'order.item_voided':
        case 'visit.items_committed':
        case 'pos.visit_closed':
          break;
        case 'pos.table_directory_ack':
          await handleTableDirectoryAck(restaurantId, event);
          break;
        default:
          rejected.push({ event_id: event.event_id, reason: 'unknown_event_type' });
          continue;
      }
      accepted.push(event.event_id);
    } catch (err) {
      console.error(`[pos] Failed to process event ${event.event_id} (${event.type}):`, err);
      rejected.push({ event_id: event.event_id, reason: 'processing_error' });
    }
  }

  // POS events change floor state (seating-bind, course stage, bill requested,
  // table released). Nudge SSE-connected host floors to re-fetch so the board
  // updates live without a manual refresh. Fire-and-forget.
  if (accepted.length > 0) {
    eventBus.emit('floor_updated', { restaurantId });
  }

  return { accepted, rejected };
}

async function handlePosAttachedAck(restaurantId: string): Promise<void> {
  await prisma.posConfig.update({
    where: { restaurantId },
    data: { ackReceivedAt: new Date() },
  });
}

async function handleOrderOpened(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;

  // ATLAS (pos.visit_opened) sends atlas_table_id; the legacy name was table_id.
  // It also sends hospitality_table_id = our OWN table id, which is stable —
  // atlas_table_id drifts when ATLAS recreates tables on a layout re-sync, which
  // broke order→reservation binding (T4, 2026-09-14). Prefer the stable id.
  const payload = event.payload as { atlas_table_id?: string; table_id?: string; hospitality_table_id?: string; cover_count?: number };
  const hospitalityTableId = payload.hospitality_table_id;
  const table_id = payload.atlas_table_id ?? payload.table_id;
  const cover_count = payload.cover_count;
  if (!table_id && !hospitalityTableId) {
    console.warn(`[pos] order.opened missing table id — event_id=${event.event_id}`);
    return;
  }

  const occurredAt = new Date(event.occurred_at);

  // Resolve to the Iron Booking table: prefer our own stable id, fall back to
  // the (drift-prone) atlas_table_id for older events.
  let table = hospitalityTableId
    ? await prisma.table.findFirst({ where: { restaurantId, id: hospitalityTableId } })
    : null;
  if (!table && table_id) {
    table = await prisma.table.findFirst({ where: { restaurantId, atlasTableId: table_id } });
  }

  if (!table) {
    console.warn(`[pos] order.opened: unknown atlasTableId=${table_id} for restaurant=${restaurantId}`);
    // Still create a walk-in visit so the event isn't lost
    await prisma.posVisit.upsert({
      where:  { visitId: event.visit_id },
      create: { visitId: event.visit_id, restaurantId, atlasTableId: (table_id ?? hospitalityTableId)!, coverCount: cover_count ?? null, openedAt: occurredAt },
      update: {},
    });
    return;
  }

  // Table-time lookup: CONFIRMED or SEATED reservation on this table today
  const reservation = await findReservationAtTable(restaurantId, table.id, occurredAt);

  if (reservation) {
    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { posVisitId: event.visit_id, posOrderActive: true, billRequested: false, billRequestedAt: null },
    });
  } else {
    // No reservation matched yet (order-before-seat, or the booking is still
    // PENDING). Persist the order as an unbound posVisit WITH our stable table
    // id so a later /seat can attach it (bind-on-seat).
    await prisma.posVisit.upsert({
      where:  { visitId: event.visit_id },
      create: { visitId: event.visit_id, restaurantId, atlasTableId: (table_id ?? hospitalityTableId)!, tableId: table.id, coverCount: cover_count ?? null, openedAt: occurredAt },
      update: { tableId: table.id },
    });
  }
}

/**
 * Bind-on-seat: when a host seats a reservation, attach a live unbound POS order
 * that was already opened at that table (the order-before-seat / still-PENDING
 * case that order-open binding missed). Sets posVisitId so course/bill/payment
 * writeback and auto-complete start flowing to this reservation. Best-effort —
 * never throws into the seat hot path; a no-op when the reservation is already
 * bound or no open order sits at the table.
 */
export async function bindOpenOrderOnSeat(
  restaurantId: string,
  reservationId: string,
  ironTableId: string,
): Promise<string | null> {
  try {
    const reservation = await prisma.reservation.findFirst({
      where: { id: reservationId, restaurantId },
      select: { id: true, posVisitId: true },
    });
    if (!reservation || reservation.posVisitId) return null; // already bound at order-open

    const candidates = await prisma.posVisit.findMany({
      where: { restaurantId, tableId: ironTableId, status: 'open' },
    });
    const visit = pickBindablePosVisit(candidates);
    if (!visit) return null;

    await prisma.$transaction([
      prisma.reservation.update({
        where: { id: reservationId },
        data:  { posVisitId: visit.visitId, posOrderActive: true, billRequested: false, billRequestedAt: null },
      }),
      prisma.posVisit.update({
        where: { visitId: visit.visitId },
        data:  { status: 'bound' },
      }),
    ]);
    console.log(`[pos] bind-on-seat: reservation ${reservationId} <- order ${visit.visitId} (table ${ironTableId})`);
    return visit.visitId;
  } catch (e) {
    console.error('[pos] bind-on-seat failed', e);
    return null;
  }
}

async function handlePaymentCompleted(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  const { amount } = event.payload as { amount?: number };
  if (amount == null) return;

  await prisma.posVisit.updateMany({
    where: { visitId: event.visit_id, restaurantId },
    data:  { paidAmount: amount },
  });
}

export async function handleOrderClosed(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  // Reached only on a FULL close (order.closed / visit.table_released) — a
  // partial payment arrives as visit.payment_completed and never lands here.
  // Clear the active-order + bill + fire flags... Keyed on posVisitId only, so it
  // frees/completes the reservation identically for any source (online/host/walk-in).
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id },
    data:  { posOrderActive: false, billRequested: false, billRequestedAt: null, fired: false, firedAt: null },
  });
  // ...and auto-complete a still-seated reservation so the host floor frees the
  // table on its own when the cashier closes the bill (owner 2026-09-14). Only
  // when SEATED — never overrides a cancelled/no-show/already-completed row.
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id, status: 'SEATED' },
    data:  { status: 'COMPLETED', completedAt: new Date(event.occurred_at) },
  });
}

// visit.order_voided → the WHOLE POS order was cancelled. Unlike a paid close
// this must NOT auto-complete the reservation (the guest may still be seated and
// re-order), but it must clear the active-order/bill/course state and UNBIND the
// visit so the table is no longer stuck "ordering" — the host can close it from
// booking, and a fresh order can bind again. (Before this, order_voided was a
// no-op, so a voided table stayed SEATED + posOrderActive=true and could not be
// closed from either side.)
async function handleOrderVoided(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id },
    data:  {
      posOrderActive: false,
      billRequested: false,
      billRequestedAt: null,
      courseStage: null,
      courseStageAt: null,
      fired: false,
      firedAt: null,
      posVisitId: null,
    },
  });
}

// pos.visit_table_changed → ATLAS moved the WHOLE order to another table (a POS
// table transfer). Mirror it inbound: the bound reservation FOLLOWS the order to
// the new table (POS-authoritative), which frees the original table. Inbound-only
// — we do NOT emit visit.upserted back to ATLAS (that would loop the move straight
// back out).
async function handleVisitTableChanged(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  // ATLAS emits { atlas_order_id, from_table_id, to_table_id, changed_at } and sets
  // the envelope visit_id to the order's registry visit id (same key as
  // pos.visit_opened). NOTE the contract: the target is `to_table_id`, an ATLAS
  // table id → Table.atlasTableId. ATLAS does NOT send hospitality_table_id here
  // (unlike visit_opened) — we still prefer it if a future emit adds it.
  const payload = event.payload as {
    atlas_order_id?: string;
    to_table_id?: string;
    hospitality_table_id?: string;
    atlas_table_id?: string;
  };
  const hospitalityTableId = payload.hospitality_table_id;
  const atlasTableId = payload.to_table_id ?? payload.atlas_table_id;
  if (!hospitalityTableId && !atlasTableId) {
    console.warn(`[pos] visit_table_changed missing target table id — event_id=${event.event_id}`);
    return;
  }

  // Resolve the target IB table: prefer our own stable id, fall back to the
  // (drift-prone) atlas table id.
  let table = hospitalityTableId
    ? await prisma.table.findFirst({ where: { restaurantId, id: hospitalityTableId } })
    : null;
  if (!table && atlasTableId) {
    table = await prisma.table.findFirst({ where: { restaurantId, atlasTableId } });
  }
  if (!table) {
    console.warn(`[pos] visit_table_changed: unknown target table (hospitality=${hospitalityTableId} atlas=${atlasTableId}) restaurant=${restaurantId}`);
    return;
  }

  // Correlate the move with the order. visit_id is the join key (matches
  // reservation.posVisitId / posVisit.visitId); fall back to atlas_order_id for
  // the walk-in/no-registry case where visit_id defaulted to the order id.
  const visitId = event.visit_id ?? payload.atlas_order_id ?? null;
  if (!visitId) return;

  // Keep an unbound posVisit registry row in sync (best-effort) so a later
  // bind-on-seat resolves the new table for an order-before-seat move.
  const movedVisit = await prisma.posVisit.updateMany({
    where: { restaurantId, visitId },
    data:  { tableId: table.id },
  });

  // Move the bound reservation to follow the order to the new table.
  const reservation = await prisma.reservation.findFirst({
    where:  { restaurantId, posVisitId: visitId },
    select: { id: true, tableId: true },
  });
  if (reservation) {
    if (reservation.tableId !== table.id) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data:  { tableId: table.id, previousTableId: reservation.tableId },
      });
    }
  } else if (movedVisit.count === 0) {
    console.warn(`[pos] visit_table_changed: no reservation or posVisit bound to visit=${visitId}`);
  }
}

// visit.fired → the FIRST kitchen-fire of the bound order. Flip the reservation's
// fire flag; the floor's order-occupied projection + course/bill pill are gated on
// it (before fire the guest shows SEATED but no POS pill). Reset on close/void.
async function handleVisitFired(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  // ATLAS emits { atlas_order_id, fired_at } with the envelope visit_id set to the
  // order's registry visit id (same key as pos.visit_opened). Fall back to
  // atlas_order_id for the walk-in/no-registry case where visit_id == order id.
  const payload = event.payload as { atlas_order_id?: string; fired_at?: string };
  const visitId = event.visit_id ?? payload.atlas_order_id ?? null;
  if (!visitId) return;
  const firedAt = payload.fired_at ? new Date(payload.fired_at) : new Date(event.occurred_at);
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: visitId },
    data:  { fired: true, firedAt },
  });
}

// visit.bill_requested → flag the bound reservation so the floor can show the
// guest asked for the check. Cleared when the order opens or closes.
async function handleBillRequested(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id },
    data:  { billRequested: true, billRequestedAt: new Date(event.occurred_at) },
  });
}

// visit.course_stage_changed → record the meal stage on the bound reservation so
// the floor can colour by course (starter/main/dessert).
async function handleCourseStageChanged(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  const { stage } = event.payload as { stage?: string };
  if (!stage) return;
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id },
    data:  { courseStage: stage, courseStageAt: new Date(event.occurred_at) },
  });
}

// visit.summary (order closed) → store the full itemised record as guest history,
// linked to the reservation when the visit is bound to one.
async function handleVisitSummary(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  const payload = event.payload as {
    atlas_order_id?: string;
    total_amount?: string | number;
    cover_count?: number;
    closed_at?: string;
  };
  if (!payload.atlas_order_id) return; // history keys on the order id

  const reservation = await prisma.reservation.findFirst({
    where:  { restaurantId, posVisitId: event.visit_id },
    select: { id: true },
  });
  const totalAmount = payload.total_amount != null ? Number(payload.total_amount) : null;
  const closedAt = payload.closed_at ? new Date(payload.closed_at) : null;

  await prisma.posOrderHistory.upsert({
    where:  { visitId_atlasOrderId: { visitId: event.visit_id, atlasOrderId: payload.atlas_order_id } },
    create: {
      restaurantId,
      reservationId: reservation?.id ?? null,
      visitId:       event.visit_id,
      atlasOrderId:  payload.atlas_order_id,
      totalAmount,
      coverCount:    payload.cover_count ?? null,
      closedAt,
      summary:       event.payload as object,
    },
    update: {
      reservationId: reservation?.id ?? null,
      totalAmount,
      coverCount:    payload.cover_count ?? null,
      closedAt,
      summary:       event.payload as object,
    },
  });
}

// Applies the ibTableId → atlasTableUUID mapping from ATLAS's pos.table_directory_ack.
// This is the authoritative source for Table.atlasTableId — it supersedes the name-based
// matching done during initial attach (which can fail on renamed or newly-added tables).
async function handleTableDirectoryAck(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  const mapping = (event.payload as { mapping?: Record<string, string> }).mapping;

  if (!mapping || typeof mapping !== 'object') {
    console.warn(`[pos] pos.table_directory_ack: missing or invalid mapping — event_id=${event.event_id}`);
    return;
  }

  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    console.warn(`[pos] pos.table_directory_ack: empty mapping — event_id=${event.event_id}`);
    return;
  }

  let updated = 0;
  let missing = 0;

  for (const [ibTableId, atlasTableId] of entries) {
    if (!ibTableId || !atlasTableId) continue;
    const result = await prisma.table.updateMany({
      where: { id: ibTableId, restaurantId },
      data:  { atlasTableId },
    });
    if (result.count === 0) {
      console.warn(`[pos] pos.table_directory_ack: no table matched ibTableId=${ibTableId} restaurantId=${restaurantId}`);
      missing++;
    } else {
      updated++;
    }
  }

  console.log(
    `[pos] pos.table_directory_ack applied — received=${entries.length} updated=${updated} missing=${missing} event_id=${event.event_id}`,
  );
}

// Find the best-matching CONFIRMED/SEATED reservation for a table at a given UTC instant.
// Uses date from the timestamp and compares time strings lexicographically within that day.
async function findReservationAtTable(restaurantId: string, ironTableId: string, at: Date) {
  // Resolve the order instant to the restaurant's LOCAL calendar day + minutes.
  // res.date/res.time are local wall-clock; the old code compared them against
  // UTC, so the window check was off by the tz offset and silently fell back to
  // "first reservation of the day" — the wrong one on a lunch+dinner table.
  const { date, minutes } = localWallClock(at);
  const [y, mo, d] = date.split('-').map(Number);
  const dateOnly = new Date(Date.UTC(y, mo - 1, d)); // reservations store date as UTC-midnight of the local day

  const candidates = await prisma.reservation.findMany({
    where: {
      restaurantId,
      tableId:   ironTableId,
      status:    { in: ['CONFIRMED', 'SEATED'] },
      posVisitId: null,
      date:       dateOnly,
    },
  });

  // Bind by time window (#3). A walk-in on a table whose only booking is far off
  // stays UNBOUND (null) instead of being stamped with that reservation (#1).
  return pickReservationForOrder(candidates, minutes);
}
