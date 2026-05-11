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

// Grace period after which a PENDING/CONFIRMED reservation is considered stale
// on the live floor. Must stay in sync with the backend occupancy constant.
export const NO_SHOW_AFTER_MINUTES = 30;

// A PENDING/CONFIRMED reservation is "stale" when it started more than
// NO_SHOW_AFTER_MINUTES ago and the guest never arrived. The DB record is
// preserved for history; this is a display-only computed flag.
export function isStaleReservation(resTime: string, status: string, nowTime: string): boolean {
  if (status !== 'PENDING' && status !== 'CONFIRMED') return false;
  return minutesUntilRes(resTime, nowTime) < -NO_SHOW_AFTER_MINUTES;
}

// Returns minutes until reservation (negative = past)
export function minutesUntilRes(resTime: string, nowTime: string): number {
  const [rH, rM] = resTime.split(':').map(Number);
  const [nH, nM] = nowTime.split(':').map(Number);
  return (rH * 60 + rM) - (nH * 60 + nM);
}

export function arrivalState(
  resTime: string,
  status: string,
  nowTime: string,
): ArrivalState | null {
  if (status !== 'CONFIRMED') return null;
  const diff = minutesUntilRes(resTime, nowTime);
  if (diff <= -15) return 'NO_SHOW_RISK';
  if (diff <   -5) return 'LATE';
  if (diff <=   5) return 'DUE_NOW';
  if (diff <=  15) return 'ARRIVING_SOON';
  return null;
}
