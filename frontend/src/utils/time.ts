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
