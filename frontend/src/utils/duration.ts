// Returns the default duration based on party size: 3+ guests → 120 min, otherwise 90 min.
export function getDefaultDuration(partySize?: number): number {
  return (partySize ?? 0) >= 3 ? 120 : 90;
}
