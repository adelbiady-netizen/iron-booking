import { prisma } from '../../lib/prisma';
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
        // Accepted, no state change:
        case 'order.items_sent':
        case 'order.item_voided':
        case 'visit.items_committed':
        case 'visit.order_voided':
        case 'visit.bill_requested':
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
  const payload = event.payload as { atlas_table_id?: string; table_id?: string; cover_count?: number };
  const table_id = payload.atlas_table_id ?? payload.table_id;
  const cover_count = payload.cover_count;
  if (!table_id) {
    console.warn(`[pos] order.opened missing table_id — event_id=${event.event_id}`);
    return;
  }

  const occurredAt = new Date(event.occurred_at);

  // Resolve ATLAS table_id → Iron Booking table
  const table = await prisma.table.findFirst({
    where: { restaurantId, atlasTableId: table_id },
  });

  if (!table) {
    console.warn(`[pos] order.opened: unknown atlasTableId=${table_id} for restaurant=${restaurantId}`);
    // Still create a walk-in visit so the event isn't lost
    await prisma.posVisit.upsert({
      where:  { visitId: event.visit_id },
      create: { visitId: event.visit_id, restaurantId, atlasTableId: table_id, coverCount: cover_count ?? null, openedAt: occurredAt },
      update: {},
    });
    return;
  }

  // Table-time lookup: CONFIRMED or SEATED reservation on this table today
  const reservation = await findReservationAtTable(restaurantId, table.id, occurredAt);

  if (reservation) {
    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { posVisitId: event.visit_id, posOrderActive: true },
    });
  } else {
    await prisma.posVisit.upsert({
      where:  { visitId: event.visit_id },
      create: { visitId: event.visit_id, restaurantId, atlasTableId: table_id, coverCount: cover_count ?? null, openedAt: occurredAt },
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
  // Clear the active-order flag so IB can complete/release the table.
  await prisma.reservation.updateMany({
    where: { restaurantId, posVisitId: event.visit_id },
    data:  { posOrderActive: false },
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
