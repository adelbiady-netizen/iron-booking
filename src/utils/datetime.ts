/**
 * Datetime utilities for Iron Booking.
 *
 * Rule: ALL times are stored as UTC in the database. This module converts
 * between restaurant local wall-clock times and UTC. Uses Luxon for correct
 * DST handling (Luxon properly handles the "fall back" ambiguity that
 * native Date cannot resolve).
 */

import { DateTime } from 'luxon';

/**
 * Convert a wall-clock time string ("HH:MM") on a given local date to a UTC Date.
 * Handles DST transitions — "ambiguous" times (during fall-back) are resolved
 * to the earlier (pre-transition) instant.
 */
export function localTimeToUTC(
  localDateStr: string, // "YYYY-MM-DD"
  timeStr: string,      // "HH:MM"
  timezone: string,     // IANA: "America/New_York"
): Date {
  const [hour, minute] = timeStr.split(':').map(Number);
  const dt = DateTime.fromObject(
    { year: 0, month: 0, day: 0, hour, minute },
    { zone: timezone },
  );

  // Parse date separately to avoid fromObject quirks with full ISO strings
  const [year, month, day] = localDateStr.split('-').map(Number);
  const full = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: timezone },
  );

  if (!full.isValid) {
    throw new Error(
      `Invalid datetime: date=${localDateStr} time=${timeStr} tz=${timezone} — ${full.invalidExplanation}`,
    );
  }

  return full.toUTC().toJSDate();
}

/**
 * Convert a UTC Date to a local wall-clock time string ("HH:MM") in the given timezone.
 */
export function utcToLocalTimeStr(utcDate: Date, timezone: string): string {
  return DateTime.fromJSDate(utcDate, { zone: 'utc' }).setZone(timezone).toFormat('HH:mm');
}

/**
 * Convert a UTC Date to a local "YYYY-MM-DD" date string in the given timezone.
 */
export function utcToLocalDateStr(utcDate: Date, timezone: string): string {
  return DateTime.fromJSDate(utcDate, { zone: 'utc' }).setZone(timezone).toISODate()!;
}

/**
 * Get the current time as a UTC Date.
 */
export function nowUTC(): Date {
  return new Date();
}

/**
 * Add minutes to a Date and return a new Date.
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Get the day of week (0=Sun…6=Sat) for a UTC Date in the given timezone.
 */
export function localDayOfWeek(utcDate: Date, timezone: string): number {
  return DateTime.fromJSDate(utcDate, { zone: 'utc' }).setZone(timezone).weekday % 7;
  // Luxon weekday: 1=Mon…7=Sun. We want 0=Sun…6=Sat like JS.
}

/**
 * Generate a sequence of Date values stepping by intervalMin between start and end (exclusive).
 */
export function generateSlotTimes(start: Date, end: Date, intervalMin: number): Date[] {
  const slots: Date[] = [];
  let current = start.getTime();
  const endMs = end.getTime();
  while (current < endMs) {
    slots.push(new Date(current));
    current += intervalMin * 60_000;
  }
  return slots;
}

/**
 * Returns true if two time windows [aStart, aEnd) and [bStart, bEnd) overlap.
 */
export function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Parse "HH:MM" → { hour, minute }
 */
export function parseTimeStr(timeStr: string): { hour: number; minute: number } {
  const [hour, minute] = timeStr.split(':').map(Number);
  return { hour, minute };
}

/**
 * Format minutes as "Xhr Ymin" for display (e.g. 90 → "1hr 30min")
 */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}min`;
}
