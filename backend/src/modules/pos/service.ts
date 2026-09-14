import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';
import type { PosEventEnvelope } from './schema';

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
        // Accepted, no state change:
        case 'order.items_sent':
        case 'order.item_voided':
        case 'visit.items_committed':
        case 'visit.order_voided':
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
    await prisma.posVisit.upsert({
      where:  { visitId: event.visit_id },
      create: { visitId: event.visit_id, restaurantId, atlasTableId: (table_id ?? hospitalityTableId)!, coverCount: cover_count ?? null, openedAt: occurredAt },
      update: {},
    });
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

async function handleOrderClosed(restaurantId: string, event: PosEventEnvelope): Promise<void> {
  if (!event.visit_id) return;
  // Reached only on a FULL close (order.closed / visit.table_released) — a
  // partial payment arrives as visit.payment_completed and never lands here.
  // Clear the active-order + bill flags...
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id },
    data:  { posOrderActive: false, billRequested: false, billRequestedAt: null },
  });
  // ...and auto-complete a still-seated reservation so the host floor frees the
  // table on its own when the cashier closes the bill (owner 2026-09-14). Only
  // when SEATED — never overrides a cancelled/no-show/already-completed row.
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id, status: 'SEATED' },
    data:  { status: 'COMPLETED', completedAt: new Date(event.occurred_at) },
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
  const dateOnly = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const atMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();

  const candidates = await prisma.reservation.findMany({
    where: {
      restaurantId,
      tableId:   ironTableId,
      status:    { in: ['CONFIRMED', 'SEATED'] },
      posVisitId: null,
      date:       dateOnly,
    },
  });

  // Find reservation whose [time, time+duration) window contains `at`
  for (const res of candidates) {
    const [h, m] = res.time.split(':').map(Number);
    const startMinutes = h * 60 + m;
    const endMinutes   = startMinutes + res.duration;
    if (atMinutes >= startMinutes && atMinutes < endMinutes) {
      return res;
    }
  }

  // Fallback: take any reservation on the same day (loose match for walk-up seating)
  return candidates[0] ?? null;
}
