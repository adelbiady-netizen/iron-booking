// Format an ISO timestamp as HH:mm (24-hour, locale-independent) for host operational displays.
export function fmtHostTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Normalize any stored time string to HH:mm (24-hour).
// Handles both already-correct "HH:mm" strings and legacy "h:mm AM/PM" strings
// that may exist in the database from older booking form submissions.
export function normalizeTime(timeStr: string): string {
  if (!timeStr) return timeStr;
  const amPmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!amPmMatch) return timeStr; // already HH:mm or unknown — pass through
  let h = parseInt(amPmMatch[1], 10);
  const m = amPmMatch[2];
  const period = amPmMatch[3].toUpperCase();
  if (period === 'AM') { if (h === 12) h = 0; }
  else                 { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, '0')}:${m}`;
}

// Compute minutes remaining until a seated reservation ends.
// startTime must be a full ISO timestamp ("2026-04-29T23:47:00.000Z")
// or a combined date+time string ("2026-04-29T23:47").
// Service-day midnight crossing: if seatedAt is more than 12 h ahead of
// operationalNow, the clock has crossed midnight — operationalNow is
// advanced by one calendar day before the diff is computed.
export function getRemainingMinutes(
  startTime: string,
  duration: number,
  operationalNow: number,
): number {
  const start = new Date(startTime).getTime();
  const end   = start + duration * 60_000;
  const effectiveNow = start - operationalNow > 12 * 3_600_000
    ? operationalNow + 86_400_000
    : operationalNow;
  return Math.floor((end - effectiveNow) / 60_000);
}

// Compute minutes remaining given a pre-computed end time (ISO string).
// The backend surfaces expectedEndTime so the frontend never needs to
// reconstruct seatedAt + duration itself.
// Service-day midnight crossing is detected the same way: if the expected
// end is more than 12 h ahead of operationalNow, advance now by one day.
// This is safe for restaurant sessions (which are always shorter than 12 h).
export function minutesUntilEnd(
  expectedEndTime: string,
  operationalNow: number,
): number {
  const end = new Date(expectedEndTime).getTime();
  const effectiveNow = end - operationalNow > 12 * 3_600_000
    ? operationalNow + 86_400_000
    : operationalNow;
  return Math.floor((end - effectiveNow) / 60_000);
}

// Compute the optimistic expectedEndTime for a reservation being seated at seatedAtMs.
// Mirrors the backend operationalEnd model:
//   max(scheduledEnd, seatedAt + minimumOperationalWindow)
// Prevents a brief full-duration timer when a late guest is seated — without this the
// optimistic state shows now+duration instead of the correct compressed window.
// date may be "YYYY-MM-DD" or a full ISO string; only the date part is used.
export function optimisticExpectedEnd(
  res: { date: string; time: string; duration: number },
  seatedAtMs: number,
): string {
  const dateStr = String(res.date).slice(0, 10);
  const scheduledEndMs =
    new Date(`${dateStr}T${res.time}:00`).getTime() + res.duration * 60_000;
  return new Date(
    Math.max(scheduledEndMs, seatedAtMs + 15 * 60_000)
  ).toISOString();
}
