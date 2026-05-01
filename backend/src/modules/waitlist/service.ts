import { prisma } from '../../lib/prisma';
import { WaitlistStatus, Prisma } from '@prisma/client';
import { NotFoundError, BusinessRuleError } from '../../lib/errors';
import { getFloorState } from '../tables/service';
import { sendWhatsApp } from '../../lib/sms';
import { findOrCreateGuest, splitName } from '../guests/service';

function parseDateArg(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertEntry(restaurantId: string, id: string) {
  const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
  if (!entry || entry.restaurantId !== restaurantId) throw new NotFoundError('Waitlist entry', id);
  return entry;
}

// ─── Live floor-based wait estimation ────────────────────────────────────────
// Computes the minimum minutes until a suitable table opens for a given party.
// AVAILABLE → 0, OCCUPIED → minutesRemaining, RESERVED_SOON → minutesUntil + duration.
// RESERVED (>15m away) and BLOCKED tables are excluded.

type FloorEntry = Awaited<ReturnType<typeof getFloorState>>[number];

function computeEstimatedWait(
  partySize: number,
  floorTables: FloorEntry[],
  defaultTurnMinutes: number,
): number | null {
  let best: number | null = null;

  for (const table of floorTables) {
    if (!table.isActive || table.locked) continue;
    if (table.maxCovers < partySize) continue;

    let wait: number | null = null;

    if (table.liveStatus === 'AVAILABLE') {
      wait = 0;
    } else if (table.liveStatus === 'OCCUPIED') {
      if (table.currentReservation) {
        wait = Math.max(0, Math.ceil(table.currentReservation.minutesRemaining));
      }
    } else if (table.liveStatus === 'RESERVED_SOON') {
      const upcoming = table.upcomingReservations[0] as (typeof table.upcomingReservations[0] & { duration: number }) | undefined;
      if (upcoming) {
        const duration = upcoming.duration ?? defaultTurnMinutes;
        wait = Math.ceil(upcoming.minutesUntil + duration);
      }
    }

    if (wait !== null && (best === null || wait < best)) {
      best = wait;
    }
  }

  return best;
}

// ─── Quoted wait time (used when guest is added) ──────────────────────────────
// Estimates wait based on current seated count and average turn time.

export async function estimateWaitMinutes(
  restaurantId: string,
  date: Date,
  partySize: number
): Promise<number> {
  const settings = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { settings: true },
  });
  const s = settings.settings as Record<string, any>;
  const turnMinutes: number = s.defaultTurnMinutes ?? 90;

  const [seatedCount, waitingAhead] = await Promise.all([
    prisma.reservation.count({
      where: { restaurantId, date, status: 'SEATED' },
    }),
    prisma.waitlistEntry.count({
      where: { restaurantId, date, status: 'WAITING' },
    }),
  ]);

  const tables = await prisma.table.count({ where: { restaurantId, isActive: true } });

  // Simple model: each table cycles in `turnMinutes`. If seats are occupied,
  // estimate how many will free up in what time.
  if (seatedCount === 0) return 0;

  const occupancyRate = Math.min(1, seatedCount / Math.max(1, tables));
  const baseWait = occupancyRate * (turnMinutes / 2); // avg remaining time
  const queueDelay = waitingAhead * (turnMinutes / Math.max(1, tables));

  return Math.round(baseWait + queueDelay);
}

// ─── Service Functions ────────────────────────────────────────────────────────

export async function listWaitlist(restaurantId: string, date: string, time?: string) {
  const parsedDate = parseDateArg(date);
  const now = new Date();
  const timeStr = time ?? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const [entries, floorTables, restaurant] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { restaurantId, date: parsedDate, status: { in: ['WAITING', 'NOTIFIED'] } },
      orderBy: { addedAt: 'asc' },
    }),
    getFloorState(restaurantId, parsedDate, timeStr),
    prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { settings: true },
    }),
  ]);

  const s = restaurant.settings as Record<string, any>;
  const defaultTurnMinutes: number = s.defaultTurnMinutes ?? 90;

  return entries.map(entry => ({
    ...entry,
    estimatedWaitMin: computeEstimatedWait(entry.partySize, floorTables, defaultTurnMinutes),
  }));
}

export async function getWaitlistEntry(restaurantId: string, id: string) {
  return assertEntry(restaurantId, id);
}

export async function addToWaitlist(restaurantId: string, data: {
  guestName: string;
  guestPhone?: string;
  partySize: number;
  date: string;
  source?: string;
  notes?: string;
}) {
  const date = parseDateArg(data.date);
  const quotedWaitMinutes = await estimateWaitMinutes(restaurantId, date, data.partySize);

  // Auto-link Guest CRM record when phone is present
  let guestId: string | null = null;
  if (data.guestPhone || data.guestName) {
    try {
      const { firstName, lastName } = splitName(data.guestName);
      const { guest } = await findOrCreateGuest(restaurantId, {
        firstName,
        lastName,
        phone: data.guestPhone,
      });
      guestId = guest.id;
    } catch {
      // Non-fatal: entry created without guest link
    }
  }

  return prisma.waitlistEntry.create({
    data: {
      restaurantId,
      date,
      guestId,
      guestName: data.guestName,
      guestPhone: data.guestPhone ?? null,
      partySize: data.partySize,
      source: (data.source as any) ?? 'WALK_IN',
      quotedWaitMinutes,
      notes: data.notes ?? null,
    },
  });
}

export async function updateWaitlistEntry(
  restaurantId: string,
  id: string,
  data: { guestName?: string; guestPhone?: string; partySize?: number; notes?: string }
) {
  await assertEntry(restaurantId, id);
  return prisma.waitlistEntry.update({ where: { id }, data });
}

export async function notifyGuest(restaurantId: string, id: string) {
  const entry = await assertEntry(restaurantId, id);
  if (entry.status !== 'WAITING') {
    throw new BusinessRuleError(`Entry is already ${entry.status}`);
  }
  if (!entry.guestPhone) {
    throw new BusinessRuleError('Guest has no phone number on file');
  }

  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { name: true },
  });

  const message =
    `Hi ${entry.guestName}, your table is ready at ${restaurant.name}. Please come to the host stand.`;

  // Send first — only stamp NOTIFIED if the message actually went out
  await sendWhatsApp(entry.guestPhone, message);

  return prisma.waitlistEntry.update({
    where: { id },
    data: { status: 'NOTIFIED', notifiedAt: new Date() },
  });
}

export async function seatWaitlistGuest(
  restaurantId: string,
  id: string,
  tableId?: string
): Promise<{ entry: Awaited<ReturnType<typeof prisma.waitlistEntry.update>>; reservation: any }> {
  const entry = await assertEntry(restaurantId, id);

  if (!['WAITING', 'NOTIFIED'].includes(entry.status)) {
    throw new BusinessRuleError(`Cannot seat a guest with status ${entry.status}`);
  }

  if (tableId) {
    const occupying = await prisma.reservation.findFirst({
      where: { tableId, status: 'SEATED', date: entry.date },
      select: { id: true, guestName: true },
    });
    if (occupying) {
      throw new BusinessRuleError(`Table is currently occupied by ${occupying.guestName}`);
    }
  }

  const settings = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { settings: true },
  });
  const s = settings.settings as Record<string, any>;

  // Resolve guest CRM link: use existing link from entry, or try to resolve
  let resolvedGuestId: string | null = entry.guestId ?? null;
  if (!resolvedGuestId && entry.guestPhone) {
    try {
      const { firstName, lastName } = splitName(entry.guestName);
      const { guest } = await findOrCreateGuest(restaurantId, {
        firstName,
        lastName,
        phone: entry.guestPhone,
      });
      resolvedGuestId = guest.id;
    } catch {
      // Non-fatal: seat without guest link
    }
  }

  // Convert to a reservation
  const reservation = await prisma.$transaction(async (tx) => {
    const res = await tx.reservation.create({
      data: {
        restaurantId,
        guestId: resolvedGuestId,
        partySize: entry.partySize,
        date: entry.date,
        time: new Date().toTimeString().slice(0, 5),
        duration: (s.defaultTurnMinutes as number) ?? 90,
        status: 'SEATED',
        source: 'WALK_IN',
        guestName: entry.guestName,
        guestPhone: entry.guestPhone,
        tableId: tableId ?? null,
        seatedAt: new Date(),
        confirmedAt: new Date(),
      },
    });

    await tx.waitlistEntry.update({
      where: { id },
      data: {
        status: 'SEATED',
        seatedAt: new Date(),
        reservationId: res.id,
      },
    });

    if (resolvedGuestId) {
      await tx.guest.update({
        where: { id: resolvedGuestId },
        data: { visitCount: { increment: 1 }, lastVisitAt: new Date() },
      });
    }

    return res;
  });

  const updated = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
  return { entry: updated, reservation };
}

export async function removeFromWaitlist(restaurantId: string, id: string, reason: 'LEFT' | 'REMOVED') {
  await assertEntry(restaurantId, id);
  return prisma.waitlistEntry.update({
    where: { id },
    data: {
      status: reason,
      leftAt: new Date(),
    },
  });
}

export async function getWaitlistStats(restaurantId: string, date: string) {
  const d = parseDateArg(date);
  const [waiting, notified, seated, left] = await Promise.all([
    prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'WAITING' } }),
    prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'NOTIFIED' } }),
    prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'SEATED' } }),
    prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'LEFT' } }),
  ]);

  const avgWait = await prisma.waitlistEntry.aggregate({
    where: { restaurantId, date: d, status: 'SEATED', seatedAt: { not: null } },
    _avg: { quotedWaitMinutes: true },
  });

  return { waiting, notified, seated, left, avgQuotedWait: avgWait._avg.quotedWaitMinutes };
}
