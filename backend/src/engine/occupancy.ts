import { addMinutes, areIntervalsOverlapping } from 'date-fns';

// ─── parseTimeOnDate ──────────────────────────────────────────────────────────
// date is always created as UTC midnight (e.g. new Date('YYYY-MM-DDT00:00:00.000Z')).
// Extract the UTC calendar date so we get the right day regardless of local timezone,
// then build a local-time string (no Z) to match seatedAt/confirmedAt timestamps.
export function parseTimeOnDate(date: Date, timeStr: string): Date {
  const yyyy = date.getUTCFullYear();
  const mm   = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(date.getUTCDate()).padStart(2, '0');
  return new Date(`${yyyy}-${mm}-${dd}T${timeStr}:00`);
}

// ─── ACTIVE_STATUSES ──────────────────────────────────────────────────────────
// Single canonical definition consumed by all three overlap engines.
export const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

// ─── reservationConflicts ─────────────────────────────────────────────────────
// Does existing reservation R conflict with requested slot S at buffer B?
//
// Buffer extends the requested SLOT only — existing reservations are not widened.
// This matches getTableAvailability() semantics and fixes the double-buffer bug
// in suggestTables() where both the slot AND the reservation end were padded.
export function reservationConflicts(
  res:    { time: string; duration: number },
  slot:   { date: Date; time: string; duration: number },
  bufferMinutes: number,
): boolean {
  const slotStart = parseTimeOnDate(slot.date, slot.time);
  const slotEnd   = addMinutes(slotStart, slot.duration);
  const resStart  = parseTimeOnDate(slot.date, res.time);
  const resEnd    = addMinutes(resStart, res.duration);
  return areIntervalsOverlapping(
    { start: addMinutes(slotStart, -bufferMinutes), end: addMinutes(slotEnd, bufferMinutes) },
    { start: resStart, end: resEnd },
  );
}

// ─── reservationOverlapsSlotTime ──────────────────────────────────────────────
// Is existing reservation R active at point-in-time T?
//
// SEATED uses real seatedAt so a late-arriving guest's turn ends proportionally
// later. Falls back to the scheduled time field if seatedAt is missing.
// Non-SEATED uses scheduled time + duration.
//
// Used for SEATED checks in getFloorState(). For upcoming (non-SEATED)
// reservations on the board, use reservationIsUpcoming() instead.
export function reservationOverlapsSlotTime(
  res:      { time: string; duration: number; status: string; seatedAt?: Date | null },
  date:     Date,
  slotTime: Date,
): boolean {
  if (res.status === 'SEATED') {
    const anchor = res.seatedAt ?? parseTimeOnDate(date, res.time);
    return addMinutes(anchor, res.duration) > slotTime;
  }
  return addMinutes(parseTimeOnDate(date, res.time), res.duration) > slotTime;
}

// ─── RESERVED_SOON_MINUTES ────────────────────────────────────────────────────
// A non-SEATED reservation marks the floor board as RESERVED_SOON when its
// scheduled start is within this many minutes of the selected board time.
// Beyond this window the table appears AVAILABLE on the map (the reservation
// still shows in the sidebar list which uses the full day's data).
export const RESERVED_SOON_MINUTES = 15;

// ─── NO_SHOW_AFTER_MINUTES ───────────────────────────────────────────────────
// Grace period after a reservation's scheduled start before it is considered a
// no-show on the live floor. Once this threshold has elapsed without the guest
// being seated the table is released on the floor map (AVAILABLE), even though
// the DB record remains PENDING/CONFIRMED for historical integrity.
// Hosts can still manually mark it NO_SHOW at any time.
export const NO_SHOW_AFTER_MINUTES = 30;

// ─── reservationIsUpcoming ────────────────────────────────────────────────────
// Should a non-SEATED reservation make the floor board show this table as
// non-AVAILABLE at the selected board time?
//
// Returns true when the reservation:
//   (a) starts within RESERVED_SOON_MINUTES in the future (imminent), OR
//       started within NO_SHOW_AFTER_MINUTES in the past (guest may still arrive), AND
//   (b) hasn't ended yet (turn still relevant).
//
// Reservations that started more than NO_SHOW_AFTER_MINUTES ago are treated as
// operationally expired on the floor map — the DB record is untouched.
export function reservationIsUpcoming(
  res:      { time: string; duration: number },
  date:     Date,
  slotTime: Date,
): boolean {
  const resStart     = parseTimeOnDate(date, res.time);
  const resEnd       = addMinutes(resStart, res.duration);
  const minutesUntil = (resStart.getTime() - slotTime.getTime()) / 60_000;
  return minutesUntil <= RESERVED_SOON_MINUTES
    && minutesUntil >= -NO_SHOW_AFTER_MINUTES
    && resEnd > slotTime;
}
