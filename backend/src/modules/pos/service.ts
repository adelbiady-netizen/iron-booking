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
        case 'order.opened':
          await handleOrderOpened(restaurantId, event);
          break;
        case 'payment.completed':
          await handlePaymentCompleted(restaurantId, event);
          break;
        case 'order.items_sent':
        case 'order.item_voided':
          // Priority 2 — logged, no further action yet
          break;
        case 'order.closed':
          await handleOrderClosed(restaurantId, event);
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

  const payload = event.payload as { table_id?: string; cover_count?: number };
  const { table_id, cover_count } = payload;
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
