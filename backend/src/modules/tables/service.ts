import { prisma } from '../../lib/prisma';
import { Prisma, ReservationStatus } from '@prisma/client';
import { NotFoundError, BusinessRuleError, ConflictError } from '../../lib/errors';
import { suggestTables } from '../../engine/tableMatcher';
import { addMinutes } from 'date-fns';
import { parseTimeOnDate } from '../../engine/availability';

const ACTIVE_STATUSES: ReservationStatus[] = ['CONFIRMED', 'SEATED', 'PENDING'];

// ─── Floor State ─────────────────────────────────────────────────────────────
// Returns all tables with their live status for a given date/time.
// This is what powers the host's table board.

export async function getFloorState(restaurantId: string, date: Date, time: string) {
  const [tables, reservations, blocks] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId, isActive: true },
      include: { section: true },
      orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date,
        status: { in: ACTIVE_STATUSES },
      },
      include: {
        guest: { select: { id: true, firstName: true, lastName: true, isVip: true, tags: true } },
      },
    }),
    prisma.blockedPeriod.findMany({
      where: {
        restaurantId,
        startTime: { lte: parseTimeOnDate(date, time) },
        endTime: { gte: parseTimeOnDate(date, time) },
      },
    }),
  ]);

  const slotTime = parseTimeOnDate(date, time);

  return tables.map((table) => {
    // Respect lockedUntil expiry without a DB write
    const effectiveLocked = table.locked && (!table.lockedUntil || table.lockedUntil > slotTime);

    // Check blocks first
    const block = blocks.find((b) => b.tableId === table.id || b.tableId === null);
    if (block) {
      return {
        ...table,
        locked: effectiveLocked,
        liveStatus: 'BLOCKED' as const,
        blockReason: block.reason,
        blockType: block.type,
        currentReservation: null,
        upcomingReservations: [],
      };
    }

    // Find seated reservation
    const seated = reservations.find(
      (r) => r.tableId === table.id && r.status === 'SEATED'
    );
    if (seated) {
      const [rH, rM] = seated.time.split(':').map(Number);
      const [sH, sM] = time.split(':').map(Number);
      const resMins  = rH * 60 + rM;
      const slotMins = sH * 60 + sM;
      // seatedAt is a real wall-clock timestamp set by seatReservation / seatWaitlistGuest.
      // The fallback only fires if a reservation was inserted directly into the DB as SEATED
      // without going through those code paths (e.g. data migrations, tests).
      // It uses the reservation's time on the selected service-day date — no midnight
      // adjustment needed here because the reservation belongs to this calendar date.
      const seatedAt = seated.seatedAt ?? parseTimeOnDate(date, seated.time);
      // expectedEnd is the real-time moment the turn is scheduled to finish.
      // It is included in the response so the frontend never has to recompute it.
      const expectedEnd = addMinutes(seatedAt, seated.duration);
      // Service-day midnight crossing: if the reservation is late-night (e.g. 23:47)
      // but the slot is past midnight (e.g. 00:03), the slot is on the NEXT calendar
      // day — advance effectiveSlotTime by one day so minutesRemaining is correct.
      const effectiveSlotTime = resMins > slotMins + 720
        ? parseTimeOnDate(new Date(date.getTime() + 86_400_000), time)
        : slotTime;
      const minutesRemaining = Math.round(
        (expectedEnd.getTime() - effectiveSlotTime.getTime()) / 60000
      );
      return {
        ...table,
        locked: effectiveLocked,
        liveStatus: 'OCCUPIED' as const,
        currentReservation: {
          ...seated,
          minutesRemaining,
          expectedEndTime: expectedEnd.toISOString(),
        },
        upcomingReservations: [],
      };
    }

    // Find upcoming reservations for this table on this date
    const upcoming = reservations
      .filter((r) => r.tableId === table.id && r.status !== 'SEATED')
      .sort((a, b) => a.time.localeCompare(b.time));

    const nextRes = upcoming[0];
    if (nextRes) {
      const nextTime = parseTimeOnDate(date, nextRes.time);
      const minutesUntil = Math.round(
        (nextTime.getTime() - slotTime.getTime()) / 60000
      );
      return {
        ...table,
        locked: effectiveLocked,
        liveStatus: minutesUntil <= 15 ? ('RESERVED_SOON' as const) : ('RESERVED' as const),
        currentReservation: null,
        upcomingReservations: upcoming.slice(0, 3).map((r) => ({
          ...r,
          minutesUntil: Math.round(
            (parseTimeOnDate(date, r.time).getTime() - slotTime.getTime()) / 60000
          ),
        })),
      };
    }

    return {
      ...table,
      locked: effectiveLocked,
      liveStatus: 'AVAILABLE' as const,
      currentReservation: null,
      upcomingReservations: [],
    };
  });
}

// ─── Table CRUD ───────────────────────────────────────────────────────────────

export async function listTables(restaurantId: string) {
  return prisma.table.findMany({
    where: { restaurantId },
    include: { section: true },
    orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
}

export async function getTable(restaurantId: string, tableId: string) {
  const t = await prisma.table.findUnique({ where: { id: tableId }, include: { section: true } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return t;
}

export async function createTable(restaurantId: string, data: {
  name: string;
  sectionId?: string;
  minCovers: number;
  maxCovers: number;
  shape?: string;
  isCombinable?: boolean;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  rotation?: number;
  turnTimeMinutes?: number;
  notes?: string;
}) {
  return prisma.table.create({
    data: {
      restaurantId,
      name: data.name,
      sectionId: data.sectionId ?? null,
      minCovers: data.minCovers,
      maxCovers: data.maxCovers,
      shape: (data.shape as any) ?? 'RECTANGLE',
      isCombinable: data.isCombinable ?? false,
      posX: data.posX ?? 0,
      posY: data.posY ?? 0,
      width: data.width ?? 80,
      height: data.height ?? 80,
      rotation: data.rotation ?? 0,
      turnTimeMinutes: data.turnTimeMinutes ?? null,
      notes: data.notes ?? null,
    },
    include: { section: true },
  });
}

export async function updateTable(restaurantId: string, tableId: string, data: Prisma.TableUpdateInput) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return prisma.table.update({ where: { id: tableId }, data, include: { section: true } });
}

export async function deleteTable(restaurantId: string, tableId: string) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);

  // Check for active reservations
  const active = await prisma.reservation.count({
    where: { tableId, status: { in: ACTIVE_STATUSES } },
  });
  if (active > 0) {
    throw new BusinessRuleError('Cannot delete table with active reservations');
  }

  return prisma.table.delete({ where: { id: tableId } });
}

// ─── Block / Unblock ─────────────────────────────────────────────────────────

export async function blockTable(restaurantId: string, data: {
  tableId?: string;
  reason: string;
  type: string;
  startTime: Date;
  endTime: Date;
  createdBy: string;
}) {
  if (data.tableId) {
    const t = await prisma.table.findUnique({ where: { id: data.tableId } });
    if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', data.tableId);
  }

  return prisma.blockedPeriod.create({
    data: {
      restaurantId,
      tableId: data.tableId ?? null,
      reason: data.reason,
      type: data.type as any,
      startTime: data.startTime,
      endTime: data.endTime,
      createdBy: data.createdBy,
    },
  });
}

export async function unblockTable(restaurantId: string, blockId: string) {
  const block = await prisma.blockedPeriod.findUnique({ where: { id: blockId } });
  if (!block || block.restaurantId !== restaurantId) throw new NotFoundError('Block', blockId);
  return prisma.blockedPeriod.delete({ where: { id: blockId } });
}

export async function listBlocks(restaurantId: string, tableId?: string) {
  return prisma.blockedPeriod.findMany({
    where: {
      restaurantId,
      ...(tableId ? { tableId } : {}),
      endTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
  });
}

// ─── Lock / Unlock ───────────────────────────────────────────────────────────

export async function lockTable(restaurantId: string, tableId: string, data: {
  reason?: string | null;
  lockedUntil?: Date | null;
}) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return prisma.table.update({
    where: { id: tableId },
    data: { locked: true, lockReason: data.reason ?? null, lockedUntil: data.lockedUntil ?? null },
    include: { section: true },
  });
}

export async function unlockTable(restaurantId: string, tableId: string) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return prisma.table.update({
    where: { id: tableId },
    data: { locked: false, lockReason: null, lockedUntil: null },
    include: { section: true },
  });
}

// ─── Table Suggestions ───────────────────────────────────────────────────────

export async function getTableSuggestions(restaurantId: string, query: {
  date: string;
  time: string;
  partySize: number;
  duration?: number;
  occasion?: string;
  guestIsVip?: boolean;
}) {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { settings: true },
  });
  const s = restaurant.settings as Record<string, any>;
  const duration = query.duration ?? (s.defaultTurnMinutes as number) ?? 90;
  const buffer = (s.bufferBetweenTurnsMinutes as number) ?? 15;

  return suggestTables({
    restaurantId,
    date: new Date(query.date + 'T00:00:00.000Z'),
    time: query.time,
    partySize: query.partySize,
    durationMinutes: duration,
    bufferMinutes: buffer,
    occasion: query.occasion,
    guestIsVip: query.guestIsVip,
  });
}

// ─── Floor Suggestions ───────────────────────────────────────────────────────
// For each AVAILABLE table, find the best-matching unassigned PENDING/CONFIRMED
// reservation based on party size fit, time proximity, and status.

export interface FloorSuggestion {
  tableId: string;
  suggestedReservationId: string;
  score: number;
  reason: string;
  reservation: {
    guestName: string;
    partySize: number;
    time: string;
    status: string;
  };
}

export async function getFloorSuggestions(
  restaurantId: string,
  date: string,
  time: string
): Promise<FloorSuggestion[]> {
  const dateObj = new Date(date + 'T00:00:00.000Z');

  const [floorState, reservations] = await Promise.all([
    getFloorState(restaurantId, dateObj, time),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date: dateObj,
        status: { in: ['PENDING', 'CONFIRMED'] as ReservationStatus[] },
        tableId: null,
      },
      select: { id: true, guestName: true, partySize: true, time: true, status: true },
    }),
  ]);

  const availableTables = floorState.filter((t) => t.liveStatus === 'AVAILABLE' && !t.locked);
  if (availableTables.length === 0 || reservations.length === 0) return [];

  const [nowH, nowM] = time.split(':').map(Number);
  const nowMinutes = nowH * 60 + nowM;

  const suggestions: FloorSuggestion[] = [];

  for (const table of availableTables) {
    let bestId: string | null = null;
    let bestScore = -1;
    let bestReason = '';
    let bestRes: (typeof reservations)[0] | null = null;

    for (const res of reservations) {
      if (res.partySize > table.maxCovers) continue; // can't seat — hard skip

      // Party size fit (0–40)
      let partySizeScore: number;
      if (res.partySize >= table.minCovers && res.partySize <= table.maxCovers) {
        const slack = table.maxCovers - res.partySize;
        partySizeScore = slack === 0 ? 40 : slack === 1 ? 35 : slack <= 2 ? 28 : 20;
      } else {
        partySizeScore = 5; // under minCovers — possible but non-ideal
      }

      // Time proximity (0–40)
      const [rH, rM] = res.time.split(':').map(Number);
      const diff = rH * 60 + rM - nowMinutes;
      const timeScore =
        diff >= 0 && diff <= 30  ? 40 :
        diff > 30 && diff <= 60  ? 30 :
        diff > 60 && diff <= 120 ? 20 :
        diff > 120               ? 10 :
        diff >= -30              ? 25 : // slightly late, still relevant
                                    5;

      // Status (0–20)
      const statusScore = res.status === 'CONFIRMED' ? 20 : 10;

      const score = partySizeScore + timeScore + statusScore;
      if (score <= bestScore) continue;

      // Reason describes the fit — time is shown separately in the UI
      const fit = res.partySize >= table.minCovers && res.partySize <= table.maxCovers;
      const slack = table.maxCovers - res.partySize;
      const fitLabel = fit
        ? (slack <= 1 ? `Perfect fit for ${table.minCovers}–${table.maxCovers} covers`
                      : `Good fit for ${table.minCovers}–${table.maxCovers} covers`)
        : `Works for party of ${res.partySize}`;
      const reason = res.status === 'CONFIRMED' ? `${fitLabel} · confirmed` : fitLabel;

      bestId    = res.id;
      bestScore = score;
      bestReason = reason;
      bestRes   = res;
    }

    if (bestId && bestRes) {
      suggestions.push({
        tableId: table.id,
        suggestedReservationId: bestId,
        score: bestScore,
        reason: bestReason,
        reservation: {
          guestName: bestRes.guestName,
          partySize: bestRes.partySize,
          time: bestRes.time,
          status: bestRes.status,
        },
      });
    }
  }

  return suggestions;
}

// ─── Unified Host Intelligence ───────────────────────────────────────────────
// Single pass over all tables + unassigned reservations to produce a ranked
// list of insights the host should act on.

export interface FloorInsight {
  type: 'SEAT_NOW' | 'LATE_GUEST' | 'ENDING_SOON';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  tableId: string;
  reservationId?: string;
  message: string;
  // Populated for SEAT_NOW — used by the click-to-seat badge in the UI
  reservation?: { guestName: string; partySize: number; time: string; status: string };
  reason?: string;
}

export async function getFloorInsights(
  restaurantId: string,
  date: string,
  time: string
): Promise<FloorInsight[]> {
  const dateObj = new Date(date + 'T00:00:00.000Z');

  const [floorState, unassigned] = await Promise.all([
    getFloorState(restaurantId, dateObj, time),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date: dateObj,
        status: { in: ['PENDING', 'CONFIRMED'] as ReservationStatus[] },
        tableId: null,
      },
      select: { id: true, guestName: true, partySize: true, time: true, status: true },
    }),
  ]);

  const [nowH, nowM] = time.split(':').map(Number);
  const nowMinutes = nowH * 60 + nowM;

  const insights: FloorInsight[] = [];

  for (const table of floorState) {

    // ── ENDING_SOON: occupied table where turn is nearly up ──────────────────
    if (table.liveStatus === 'OCCUPIED' && table.currentReservation) {
      const mr = (table.currentReservation as { minutesRemaining: number }).minutesRemaining;
      if (mr < 10) {
        insights.push({
          type: 'ENDING_SOON',
          priority: 'MEDIUM',
          tableId: table.id,
          message: mr > 0
            ? `Table ${table.name} ends in ${mr}m`
            : `Table ${table.name} — over by ${Math.abs(mr)}m`,
        });
      }
    }

    // ── LATE_GUEST: assigned reservation whose time has already passed ───────
    if (table.liveStatus === 'RESERVED_SOON') {
      type UpcomingRes = { id: string; guestName: string; minutesUntil: number };
      const nextRes = (table.upcomingReservations as UpcomingRes[])[0];
      if (nextRes && nextRes.minutesUntil < 0) {
        insights.push({
          type: 'LATE_GUEST',
          priority: 'HIGH',
          tableId: table.id,
          reservationId: nextRes.id,
          message: `${nextRes.guestName} is ${Math.abs(nextRes.minutesUntil)}m late`,
        });
      }
    }

    // ── SEAT_NOW: available table + best-scoring unassigned reservation ──────
    if (table.liveStatus === 'AVAILABLE' && !table.locked && unassigned.length > 0) {
      let bestRes: (typeof unassigned)[0] | null = null;
      let bestScore = -1;

      for (const res of unassigned) {
        if (res.partySize > table.maxCovers) continue;

        const fit = res.partySize >= table.minCovers && res.partySize <= table.maxCovers;
        const slack = table.maxCovers - res.partySize;
        const partySizeScore = fit
          ? (slack === 0 ? 40 : slack === 1 ? 35 : slack <= 2 ? 28 : 20)
          : 5;

        const [rH, rM] = res.time.split(':').map(Number);
        const diff = rH * 60 + rM - nowMinutes;
        const timeScore =
          diff >= 0 && diff <= 30  ? 40 :
          diff > 30 && diff <= 60  ? 30 :
          diff > 60 && diff <= 120 ? 20 :
          diff > 120               ? 10 :
          diff >= -30              ? 25 : 5;

        const statusScore = res.status === 'CONFIRMED' ? 20 : 10;
        const score = partySizeScore + timeScore + statusScore;
        if (score > bestScore) { bestScore = score; bestRes = res; }
      }

      if (bestRes) {
        const [rH, rM] = bestRes.time.split(':').map(Number);
        const diff = rH * 60 + rM - nowMinutes;
        const fit = bestRes.partySize >= table.minCovers && bestRes.partySize <= table.maxCovers;
        const reason = fit
          ? `Good fit for ${table.minCovers}–${table.maxCovers} covers`
          : `Works for party of ${bestRes.partySize}`;

        insights.push({
          type: 'SEAT_NOW',
          priority: 'HIGH',
          tableId: table.id,
          reservationId: bestRes.id,
          message: diff < 0
            ? `Seat ${bestRes.guestName} now — ${Math.abs(diff)}m late`
            : `Seat ${bestRes.guestName} at ${table.name}`,
          reservation: {
            guestName: bestRes.guestName,
            partySize: bestRes.partySize,
            time: bestRes.time,
            status: bestRes.status,
          },
          reason,
        });
      }
    }
  }

  return insights;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

export async function listSections(restaurantId: string) {
  return prisma.section.findMany({
    where: { restaurantId },
    include: { tables: { where: { isActive: true } } },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function upsertSection(restaurantId: string, data: {
  name: string;
  color?: string;
  sortOrder?: number;
}) {
  return prisma.section.upsert({
    where: { restaurantId_name: { restaurantId, name: data.name } },
    create: { restaurantId, name: data.name, color: data.color ?? '#6366f1', sortOrder: data.sortOrder ?? 0 },
    update: { color: data.color, sortOrder: data.sortOrder },
  });
}

// ─── Floor Objects ────────────────────────────────────────────────────────────

export async function listFloorObjects(restaurantId: string) {
  return prisma.floorObject.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function batchSaveFloorObjects(
  restaurantId: string,
  objects: Array<{
    kind: string;
    label: string;
    posX: number;
    posY: number;
    width: number;
    height: number;
    rotation?: number;
    color?: string | null;
  }>
) {
  return prisma.$transaction(async (tx) => {
    await tx.floorObject.deleteMany({ where: { restaurantId } });
    if (objects.length === 0) return [];
    await tx.floorObject.createMany({
      data: objects.map((o) => ({
        restaurantId,
        kind: o.kind as import('@prisma/client').FloorObjKind,
        label: o.label,
        posX: o.posX,
        posY: o.posY,
        width: o.width,
        height: o.height,
        rotation: o.rotation ?? 0,
        color: o.color ?? null,
      })),
    });
    return tx.floorObject.findMany({ where: { restaurantId }, orderBy: { createdAt: 'asc' } });
  });
}
