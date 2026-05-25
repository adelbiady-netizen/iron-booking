// Arrival state is computed from reservation.time vs. the operational "now"
// (the dashboard's selected time, not the machine clock).
// Only applies to CONFIRMED reservations — other statuses return null.

// Returns true only when the board is showing near-real-time live service:
//   - selected date is today's calendar date, AND
//   - board time is within ±90 minutes of the wall-clock
// Outside this window the board is in browse/preview mode and all arrival
// alerts (late, no-show-risk, overdue) must be suppressed to avoid false
// operational noise when inspecting past or future services.
export function isLiveServiceView(date: string, boardTime: string): boolean {
  const now = new Date();
  const todayStr =
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')}`;
  if (date !== todayStr) return false;
  const [bH, bM] = boardTime.split(':').map(Number);
  const realMins  = now.getHours() * 60 + now.getMinutes();
  const boardMins = bH * 60 + bM;
  return Math.abs(boardMins - realMins) <= 90;
}

export type ArrivalState = 'ARRIVING_SOON' | 'DUE_NOW' | 'LATE' | 'NO_SHOW_RISK';

// Late-arrival thresholds (minutes past reservation time).
//   0 → LATE_WARN_MINUTES   : LATE badge (keep on floor, mark late/מאחר)
//   LATE_WARN_MINUTES → FLOOR_RELEASE_MINUTES : NO_SHOW_RISK (stronger warning)
//   beyond FLOOR_RELEASE_MINUTES : floor released → sidebar "needs action" only
export const LATE_WARN_MINUTES     = 20;
export const FLOOR_RELEASE_MINUTES = 50;

// Kept for backward compatibility — matches the floor-release threshold.
export const NO_SHOW_AFTER_MINUTES = FLOOR_RELEASE_MINUTES;

// Returns minutes until reservation (negative = past)
export function minutesUntilRes(resTime: string, nowTime: string): number {
  const [rH, rM] = resTime.split(':').map(Number);
  const [nH, nM] = nowTime.split(':').map(Number);
  return (rH * 60 + rM) - (nH * 60 + nM);
}

// True when a PENDING/CONFIRMED reservation is past the floor-release threshold.
// The table stops being treated as RESERVED and the sidebar surfaces a "needs action" row.
// Display-only flag — never writes to the DB.
export function isFloorReleased(resTime: string, status: string, nowTime: string): boolean {
  if (status !== 'PENDING' && status !== 'CONFIRMED') return false;
  return minutesUntilRes(resTime, nowTime) <= -FLOOR_RELEASE_MINUTES;
}

// Alias used in ReservationPanel for the stale-row dimming style.
export function isStaleReservation(resTime: string, status: string, nowTime: string): boolean {
  return isFloorReleased(resTime, status, nowTime);
}

// Strict FIFO comparator for arrived guests.
// Pre-condition: both records must have non-null arrivedAt (filter with !!r.arrivedAt first).
// Returns negative when a arrived before b (oldest first).
export function arrivedFifoSort(
  a: { arrivedAt: string | null },
  b: { arrivedAt: string | null },
): number {
  return new Date(a.arrivedAt!).getTime() - new Date(b.arrivedAt!).getTime();
}

export function arrivalState(
  resTime: string,
  status: string,
  nowTime: string,
): ArrivalState | null {
  if (status !== 'CONFIRMED') return null;
  const diff = minutesUntilRes(resTime, nowTime);
  if (diff <= -LATE_WARN_MINUTES) return 'NO_SHOW_RISK'; // 20+ min late → red alert
  if (diff < 0)                   return 'LATE';          // 0–20 min late → orange
  if (diff <=  5)                 return 'DUE_NOW';
  if (diff <= 15)                 return 'ARRIVING_SOON';
  return null;
}
