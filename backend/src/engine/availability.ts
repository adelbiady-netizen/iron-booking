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
    conflictingResId:    string;
    conflictingResTime:  string;
    conflictingResDuration: number;
    conflictingResStatus: string;
    incomingTime:        string;
    incomingDuration:    number;
    bufferMinutes:       number;
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
  bufferMinutes: number
): Promise<TableAvailability[]> {
  const slotStart = parseTimeOnDate(date, timeStr);
  const slotEnd = addMinutes(slotStart, durationMinutes);
  // Buffer endpoints used only for blocked-period filtering
  const effectiveStart = addMinutes(slotStart, -bufferMinutes);
  const effectiveEnd = addMinutes(slotEnd, bufferMinutes);

  // Pull all tables, reservations, and blocks for this date in one pass
  const [tables, reservations, blocks] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId, isActive: true },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date,
        status: { in: [...ACTIVE_STATUSES] as ReservationStatus[] },
        tableId: { not: null },
      },
      select: {
        id: true,
        tableId: true,
        combinedTableIds: true,
        time: true,
        duration: true,
        status: true,
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

    // Check reservation conflicts
    const conflict = reservations.find((r) => {
      if (r.tableId !== table.id && !r.combinedTableIds.includes(table.id)) return false;
      return reservationConflicts(r, { date, time: timeStr, duration: durationMinutes }, bufferMinutes);
    });

    if (conflict) {
      const cStart = parseTimeOnDate(date, conflict.time);
      return {
        tableId: table.id,
        isAvailable: false,
        conflictingReservationId: conflict.id,
        nextAvailableAt: addMinutes(cStart, durationMinutes + bufferMinutes),
        _debug: {
          conflictingResId:       conflict.id,
          conflictingResTime:     conflict.time,
          conflictingResDuration: conflict.duration,
          conflictingResStatus:   conflict.status,
          incomingTime:           timeStr,
          incomingDuration:       durationMinutes,
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
