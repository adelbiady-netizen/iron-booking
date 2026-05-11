// Returns the automatic default reservation duration for a given party size.
// 1–2 guests → 90 min; 3+ guests → 120 min.
// Used by CreateDrawer (auto-default) and the backend (fallback when omitted).
export function getDefaultDuration(partySize: number): number {
  return partySize >= 3 ? 120 : 90;
}
