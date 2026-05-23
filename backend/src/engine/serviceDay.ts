/**
 * Service-day utilities — Phase 1 foundation only.
 *
 * A hospitality "service day" is a monotonically ordered time interval anchored
 * to a calendar date that may cross midnight.  A dinner service starting at
 * 10:00 on 2026-05-23 and running until 04:00 on 2026-05-24 is a SINGLE service
 * day anchored on "2026-05-23".
 *
 * The cutoff hour (restaurant setting `serviceDayCutoffHour`, e.g. 6 = 06:00)
 * is the boundary: any reservation time strictly before that hour belongs to the
 * PREVIOUS calendar date's service day anchor.
 *
 * When cutoffHour is null the feature is disabled and both functions preserve
 * existing calendar-date behaviour exactly — no production behaviour change.
 *
 * NOTE: These functions are intentionally NOT wired into getFloorState,
 * reservationConflicts, or availability yet.  They are the safe Phase 1
 * foundation; integration comes in a later phase.
 */

import { parseTimeOnDate } from './occupancy';

const ONE_DAY_MS = 86_400_000;

/**
 * Returns the service-anchor date for a given calendar date + time.
 *
 * @param date       Calendar date "YYYY-MM-DD" on which the clock time falls
 * @param time       "HH:mm" in restaurant local time
 * @param cutoffHour Service-day cutoff (0–23).  Times strictly before this hour
 *                   belong to the PREVIOUS calendar date's service anchor.
 *                   Pass null to disable — returns `date` unchanged.
 * @returns "YYYY-MM-DD" service anchor date
 *
 * @example
 *   serviceAnchorDate("2026-05-23", "22:00", 6) → "2026-05-23"  // same day
 *   serviceAnchorDate("2026-05-24", "02:30", 6) → "2026-05-23"  // previous anchor
 *   serviceAnchorDate("2026-05-24", "06:00", 6) → "2026-05-24"  // cutoff is inclusive of new day
 *   serviceAnchorDate("2026-05-24", "02:30", null) → "2026-05-24" // feature disabled
 */
export function serviceAnchorDate(
  date: string,
  time: string,
  cutoffHour: number | null,
): string {
  if (cutoffHour === null) return date;
  const hour = parseInt(time.split(':')[0], 10);
  if (hour >= cutoffHour) return date;
  // Post-midnight slot — belongs to the previous calendar date's service anchor
  const [y, mo, d] = date.split('-').map(Number);
  const prev = new Date(y, mo - 1, d - 1); // JS Date handles month/year rollover
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prev.getFullYear()}-${p(prev.getMonth() + 1)}-${p(prev.getDate())}`;
}

/**
 * Builds a "virtual local time" Date for the given time within the service day
 * anchored on `anchorDate`, consistent with parseTimeOnDate's virtual-local-time
 * approach (no TZ suffix — arithmetic stays in the restaurant's local-time space).
 *
 * When time < cutoffHour the time falls in the post-midnight segment: the
 * returned Date is advanced by 24 h so it sorts AFTER same-anchor-day times
 * (e.g. 02:30 sorts after 22:00 within the same service day).
 *
 * When cutoffHour is null, returns parseTimeOnDate(anchorDate, time) exactly —
 * no behaviour change versus the existing system.
 *
 * @param anchorDate UTC-midnight Date for the service anchor date
 *                   (e.g. new Date("2026-05-23T00:00:00.000Z"))
 * @param time       "HH:mm" in restaurant local time
 * @param cutoffHour Service-day cutoff hour (null = disabled)
 * @returns virtual-local-time Date, safe for arithmetic within the service day
 */
export function parseTimeOnServiceDay(
  anchorDate: Date,
  time: string,
  cutoffHour: number | null,
): Date {
  const base = parseTimeOnDate(anchorDate, time);
  if (cutoffHour === null) return base;
  const hour = parseInt(time.split(':')[0], 10);
  if (hour >= cutoffHour) return base;
  // Post-midnight: advance by 24 h so this time sorts after same-day evening times
  return new Date(base.getTime() + ONE_DAY_MS);
}
