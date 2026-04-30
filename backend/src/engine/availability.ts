import { prisma } from '../lib/prisma';
import { addMinutes, parseISO, isWithinInterval, areIntervalsOverlapping } from 'date-fns';
import { ReservationStatus } from '@prisma/client';

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
}

const OCCUPIED_STATUSES: ReservationStatus[] = ['CONFIRMED', 'SEATED', 'PENDING'];

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
  // Buffer is added to both ends to account for setup/teardown
  const effectiveStart = addMinutes(slotStart, -bufferMinutes);
  const effectiveEnd = addMinutes(slotEnd, bufferMinutes);

  const requestedSlot: TimeSlot = { start: effectiveStart, end: effectiveEnd };

  // Pull all tables, reservations, and blocks for this date in one pass
  const [tables, reservations, blocks] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId, isActive: true },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date,
        status: { in: OCCUPIED_STATUSES },
        tableId: { not: null },
      },
      select: {
        id: true,
        tableId: true,
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
      if (r.tableId !== table.id) return false;
      const rStart = parseTimeOnDate(date, r.time);
      const rEnd = addMinutes(rStart, r.duration + bufferMinutes);
      return areIntervalsOverlapping(requestedSlot, { start: rStart, end: rEnd });
    });

    if (conflict) {
      const cStart = parseTimeOnDate(date, conflict.time);
      return {
        tableId: table.id,
        isAvailable: false,
        conflictingReservationId: conflict.id,
        nextAvailableAt: addMinutes(cStart, durationMinutes + bufferMinutes),
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

export function parseTimeOnDate(date: Date, timeStr: string): Date {
  // date is always created as UTC midnight (e.g. new Date('YYYY-MM-DDT00:00:00.000Z')).
  // Extract the UTC calendar date so we get the right day regardless of local timezone,
  // then build a local-time string (no Z) to match seatedAt/confirmedAt timestamps.
  const yyyy = date.getUTCFullYear();
  const mm   = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(date.getUTCDate()).padStart(2, '0');
  return new Date(`${yyyy}-${mm}-${dd}T${timeStr}:00`);
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
