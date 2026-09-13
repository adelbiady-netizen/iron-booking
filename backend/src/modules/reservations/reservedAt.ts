/**
 * Build a visit's reserved_at (ISO) from a reservation's date + time.
 *
 * A reservation stores its calendar day in `date` (a date-only value, i.e.
 * midnight) and the actual time separately in `time` ("HH:MM"). Using
 * `date.toISOString()` alone yields midnight and DROPS the time, which makes the
 * visit's expected_end_at land in the small hours — pushing it out of the POS
 * "incoming" (expected_end_at > now-15m) and "daily" (business-day) windows, so
 * it never appears on the floor. Always combine the date part with the time.
 */
export function reservedAtIso(date: Date | string, time: string): string {
  const datePart = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${datePart}T${time}:00.000Z`;
}
