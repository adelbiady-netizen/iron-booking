// Arrival state is computed from reservation.time vs. the operational "now"
// (the dashboard's selected time, not the machine clock).
// Only applies to CONFIRMED reservations — other statuses return null.

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
