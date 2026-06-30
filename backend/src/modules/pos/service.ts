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
        case 'order.closed':
          // Priority 2 — logged, no further action yet
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
      data:  { posVisitId: event.visit_id },
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
