// Arrival state helper — computed from reservation time vs. operational now.
// Uses the selected dashboard time (not the machine clock) so the host can
// view any date without triggering spurious late-arrival signals.

export type ArrivalState = 'ARRIVING_SOON' | 'DUE_NOW' | 'LATE' | 'NO_SHOW_RISK';

// Returns minutes until reservation (negative = past)
export function minutesUntilRes(resTime: string, nowTime: string): number {
  const [rH, rM] = resTime.split(':').map(Number);
  const [nH, nM] = nowTime.split(':').map(Number);
  return (rH * 60 + rM) - (nH * 60 + nM);
}

export function computeArrivalState(
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
