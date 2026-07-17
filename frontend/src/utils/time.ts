// ── Restaurant business-day / timezone helpers ───────────────────────────────
// The host board must key off the restaurant's BUSINESS DAY (in the restaurant's
// timezone), never the browser's local calendar date or UTC. The business day does
// NOT switch at calendar midnight — it switches 3 hours after the restaurant's
// closing time (from operating hours), so late-night service keeps showing the
// previous business day and open/seated reservations never vanish at midnight.

type OperatingHour = {
  dayOfWeek: number;   // 0 = Sunday … 6 = Saturday
  isOpen?: boolean;
  openTime?: string;   // "HH:mm"
  closeTime?: string;  // "HH:mm" — may be after midnight (e.g. "02:00")
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function tzCalendarDate(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function tzMinutesOfDay(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  return h * 60 + m;
}

function shiftYMD(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, mo - 1, d + days)); // rollover-safe
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function weekdayOfYMD(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday … 6 = Saturday
}

// Fallback business-day cutoff when operating hours are missing: 05:00 local.
export const BUSINESS_DAY_FALLBACK_CUTOFF_MIN = 5 * 60;
// Grace period after closing before the board rolls to the next business day.
export const BUSINESS_DAY_CLOSE_GRACE_MIN = 3 * 60;

/**
 * Cutoff, in minutes after LOCAL midnight of the current calendar day, at which the
 * board rolls from yesterday's business day to today's. Derived from yesterday's
 * closing time + 3 h. Returns the 05:00 fallback when yesterday has no usable
 * closing time. Pure/testable — no Date or Intl.
 *
 * Examples (yesterday's close → cutoff-of-day):
 *   close 02:00 (overnight)  → 02:00 + 3h = 05:00
 *   close 23:00 (same-day)   → (23:00 − 24h) + 3h = 02:00
 *   close 20:00 (same-day)   → (20:00 − 24h) + 3h = 23:00 yesterday → ≤ 0 → no tail (today)
 *   no hours                 → 05:00 fallback
 */
export function businessDayCutoffMinutes(yesterday: OperatingHour | undefined): number {
  if (!yesterday || !yesterday.closeTime || !yesterday.openTime) {
    return BUSINESS_DAY_FALLBACK_CUTOFF_MIN;
  }
  const closeMin = toMin(yesterday.closeTime);
  const openMin  = toMin(yesterday.openTime);
  const overnight = closeMin <= openMin; // close crosses midnight (e.g. 02:00 ≤ 18:00)
  // Close instant expressed relative to TODAY's local midnight (minutes):
  //   overnight → close is on today at closeMin
  //   same-day  → close was yesterday → closeMin − 1440
  const closeRelToday = overnight ? closeMin : closeMin - 1440;
  return closeRelToday + BUSINESS_DAY_CLOSE_GRACE_MIN;
}

/** Plain restaurant-local calendar date "YYYY-MM-DD" (no business-day logic). */
export function restaurantLocalDate(
  timezone: string | undefined | null,
  now: Date = new Date(),
): string {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return tzCalendarDate(tz, now);
}

/**
 * Current BUSINESS-DAY date "YYYY-MM-DD" in the restaurant's timezone.
 * If the local wall-clock has not yet reached (yesterday's closing time + 3 h), we
 * are still in yesterday's business-day tail and return yesterday. Otherwise today.
 * Missing operating hours → 05:00 local fallback cutoff.
 */
export function restaurantBusinessDay(
  timezone: string | undefined | null,
  operatingHours: OperatingHour[] | undefined | null,
  now: Date = new Date(),
): string {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const todayLocal = tzCalendarDate(tz, now);
  const nowMin = tzMinutesOfDay(tz, now);
  const yesterday = shiftYMD(todayLocal, -1);
  const yesterdayHours = operatingHours?.find(o => o.dayOfWeek === weekdayOfYMD(yesterday));
  const cutoffMin = businessDayCutoffMinutes(yesterdayHours);
  // Still before the cutoff → yesterday's business day is not over yet.
  return nowMin < cutoffMin ? yesterday : todayLocal;
}

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
//   min(max(scheduledEnd, seatedAt + minWindow), scheduledEnd + minWindow)
// For on-time / slightly-late guests: max(...) gives at least minWindow from seating so
// the timer is never instantly negative. For extremely-late guests the outer min caps
// the result at scheduledEnd + minWindow, preventing a runaway future turn.
// date may be "YYYY-MM-DD" or a full ISO string; only the date part is used.
export function optimisticExpectedEnd(
  res: { date: string; time: string; duration: number },
  seatedAtMs: number,
): string {
  const dateStr = String(res.date).slice(0, 10);
  const scheduledEndMs =
    new Date(`${dateStr}T${res.time}:00`).getTime() + res.duration * 60_000;
  const minWindowMs = 15 * 60_000;
  return new Date(
    Math.min(
      Math.max(scheduledEndMs, seatedAtMs + minWindowMs),
      scheduledEndMs + minWindowMs,
    )
  ).toISOString();
}
