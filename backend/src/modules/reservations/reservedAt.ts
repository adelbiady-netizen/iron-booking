/**
 * Build a visit's reserved_at (ISO, UTC) from a reservation's date + time.
 *
 * A reservation stores its calendar day in `date` (a date-only value, i.e.
 * midnight) and the actual time separately in `time` ("HH:MM"), both expressed
 * in the restaurant's LOCAL wall-clock. Naively appending 'Z' treats that local
 * time as UTC, so the POS (which renders reserved_at in local time) showed the
 * reservation shifted by the UTC offset — e.g. a 10:30 booking appeared at 13:30
 * in summer (UTC+3). Convert the local wall-clock to the correct UTC instant
 * instead, DST-aware, via the IANA timezone.
 *
 * Combining the date part with the time (rather than date.toISOString() alone,
 * which yields midnight and drops the time) is still essential so the visit's
 * expected_end_at lands in the POS "incoming"/"daily" windows.
 */
export function reservedAtIso(
  date: Date | string,
  time: string,
  timeZone = 'Asia/Jerusalem',
): string {
  const datePart = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);

  // Interpret (y, mo, d, h, mi) as a wall-clock time in `timeZone` and resolve
  // it to the matching UTC instant. Method: guess the instant as if the
  // wall-clock were UTC, ask what that instant looks like in the target zone,
  // and correct by the resulting offset (handles DST without a library).
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcGuess));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // Intl may render midnight as "24" for the hour in some environments.
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const tzAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  const offset = tzAsUtc - utcGuess; // how far ahead of UTC the zone is at that instant
  return new Date(utcGuess - offset).toISOString();
}
