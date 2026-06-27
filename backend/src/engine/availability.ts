import { prisma } from '../lib/prisma';
import { addMinutes } from 'date-fns';
import { ReservationStatus } from '@prisma/client';
import { parseTimeOnDate, ACTIVE_STATUSES, reservationConflicts } from './occupancy';

export { parseTimeOnDate } from './occupancy';

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface TableAvailability {
  tableId: string;
  isAvailable: boolean;
  conflictingReservationId?: string;
  blockedBy?: string;
  nextAvailableAt?: Date;
  // Debug: populated only when isAvailable is false due to a reservation conflict
  _debug?: {
    conflictingResId:         string;
    conflictingResTime:       string;
    conflictingResDuration:   number;
    conflictingResStatus:     string;
    conflictingResGuestName:  string;
    conflictingResTableId:    string | null;
    conflictingResCombinedTableIds: string[];
    conflictingResReorganizeAt: Date | null;
    isSelfConflict:           boolean;
    slotWindow:               string;
    conflictWindow:           string;
    incomingTime:             string;
    incomingDuration:         number;
    bufferMinutes:            number;
  };
}

/**
 * Given a date, time string ("HH:mm"), and duration (minutes),
 * compute which tables are available for that slot.
 */
export async function getTableAvailability(
  restaurantId: string,
  date: Date,
  timeStr: string,
  durationMinutes: number,
  bufferMinutes: number,
  tableIds?: string[],
  excludeReservationIds: string[] = []
): Promise<TableAvailability[]> {
  const slotStart = parseTimeOnDate(date, timeStr);
  const slotEnd = addMinutes(slotStart, durationMinutes);
  // Buffer endpoints used only for blocked-period filtering
  const effectiveStart = addMinutes(slotStart, -bufferMinutes);
  const effectiveEnd = addMinutes(slotEnd, bufferMinutes);

  // Pull tables, reservations, and blocks for this date in one pass.
  // When tableIds is provided, scope both queries to only the relevant tables
  // so validation skips the full O(all_tables × all_reservations) scan.
  const [tables, reservations, blocks] = await Promise.all([
    prisma.table.findMany({
      where: {
        restaurantId,
        isActive: true,
        ...(tableIds ? { id: { in: tableIds } } : {}),
      },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date,
        status: { in: [...ACTIVE_STATUSES] as ReservationStatus[] },
        tableId: { not: null },
        reorganizeAt: null, // displaced reservations have vacated their original table
        ...(tableIds ? {
          OR: [
            { tableId: { in: tableIds } },
            { combinedTableIds: { hasSome: tableIds } },
          ],
        } : {}),
      },
      select: {
        id: true,
        tableId: true,
        combinedTableIds: true,
        time: true,
        duration: true,
        status: true,
        guestName: true,
        reorganizeAt: true,
      },
    }),
    prisma.blockedPeriod.findMany({
      where: {
        restaurantId,
        startTime: { lt: effectiveEnd },
        endTime: { gt: effectiveStart },
      },
    }),
  ]);

  return tables.map((table) => {
    // Check blocked periods first
    const block = blocks.find(
      (b) => b.tableId === table.id || b.tableId === null
    );
    if (block) {
      return {
        tableId: table.id,
        isAvailable: false,
        blockedBy: block.reason,
      };
    }

    // Check operational lock (table.locked field, separate from time-based BlockedPeriod)
    const effectiveLocked = table.locked && (!table.lockedUntil || table.lockedUntil > slotStart);
    if (effectiveLocked) {
      return {
        tableId: table.id,
        isAvailable: false,
        blockedBy: table.lockReason ?? 'Table is locked',
      };
    }

    // Check reservation conflicts — skip any reservations being mutually displaced (e.g. swap)
    const eligibleReservations = excludeReservationIds.length
      ? reservations.filter(r => !excludeReservationIds.includes(r.id))
      : reservations;
    if (excludeReservationIds.length) {
      const skipped = reservations.filter(r => excludeReservationIds.includes(r.id)).map(r => r.id);
      const candidates = eligibleReservations.map(r => r.id);
      console.log('[swap:validation] getTableAvailability table=', table.id, 'skippedIds=', skipped, 'candidateIds=', candidates);
    }
    const conflict = eligibleReservations.find((r) => {
      if (r.tableId !== table.id && !r.combinedTableIds.includes(table.id)) return false;
      return reservationConflicts(r, { date, time: timeStr, duration: durationMinutes }, bufferMinutes);
    });

    if (conflict) {
      const cStart = parseTimeOnDate(date, conflict.time);
      const cEnd   = addMinutes(cStart, conflict.duration);
      const sWindowStart = addMinutes(slotStart, -bufferMinutes);
      const sWindowEnd   = addMinutes(slotEnd,    bufferMinutes);
      const isSelf = excludeReservationIds.includes(conflict.id);
      console.log('[availability:block] conflict found', {
        tableId: table.id,
        slotWindow: `[${sWindowStart.toISOString()}, ${sWindowEnd.toISOString()}]`,
        conflictingReservationId: conflict.id,
        conflictingGuestName: conflict.guestName,
        conflictingStatus: conflict.status,
        conflictingTableId: conflict.tableId,
        conflictingCombinedTableIds: conflict.combinedTableIds,
        conflictingTime: conflict.time,
        conflictingDuration: conflict.duration,
        conflictingWindow: `[${cStart.toISOString()}, ${cEnd.toISOString()}]`,
        conflictingReorganizeAt: conflict.reorganizeAt,
        isSelfConflict: isSelf,
        incomingTime: timeStr,
        incomingDuration: durationMinutes,
        bufferMinutes,
        excludedIds: excludeReservationIds,
      });
      return {
        tableId: table.id,
        isAvailable: false,
        conflictingReservationId: conflict.id,
        nextAvailableAt: addMinutes(cStart, durationMinutes + bufferMinutes),
        _debug: {
          conflictingResId:              conflict.id,
          conflictingResTime:            conflict.time,
          conflictingResDuration:        conflict.duration,
          conflictingResStatus:          conflict.status,
          conflictingResGuestName:       conflict.guestName,
          conflictingResTableId:         conflict.tableId,
          conflictingResCombinedTableIds: conflict.combinedTableIds,
          conflictingResReorganizeAt:    conflict.reorganizeAt,
          isSelfConflict:                isSelf,
          slotWindow:                    `[${sWindowStart.toISOString()}, ${sWindowEnd.toISOString()}]`,
          conflictWindow:                `[${cStart.toISOString()}, ${cEnd.toISOString()}]`,
          incomingTime:                  timeStr,
          incomingDuration:              durationMinutes,
          bufferMinutes,
        },
      };
    }

    return { tableId: table.id, isAvailable: true };
  });
}

/**
 * Get all available slots for a given party size across a full day.
 * Used for online booking widget.
 */
export async function getAvailableSlots(
  restaurantId: string,
  date: Date,
  partySize: number,
  intervalMinutes: number,
  openTime: string,
  lastSeating: string,
  durationMinutes: number,
  bufferMinutes: number
): Promise<string[]> {
  const slots: string[] = [];
  let cursor = parseTimeOnDate(date, openTime);
  const cutoff = parseTimeOnDate(date, lastSeating);

  while (cursor <= cutoff) {
    const timeStr = formatTime(cursor);
    const availability = await getTableAvailability(
      restaurantId,
      date,
      timeStr,
      durationMinutes,
      bufferMinutes
    );

    const hasCapableTable = availability.some((a) => a.isAvailable);
    if (hasCapableTable) slots.push(timeStr);

    cursor = addMinutes(cursor, intervalMinutes);
  }

  return slots;
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
