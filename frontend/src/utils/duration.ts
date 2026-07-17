// Returns the default duration based on party size: 3+ guests → 120 min, otherwise 90 min.
export function getDefaultDuration(partySize?: number): number {
  return (partySize ?? 0) >= 3 ? 120 : 90;
}

// A turn-time rule as exposed by GET /tables/op-settings.
export interface TurnTimeRuleLite {
  partySizeMin: number;
  partySizeMax: number;
  durationMinutes: number;
}

// Restaurant-aware default: first matching active TurnTimeRule wins (same
// semantics as the backend's resolveTurnTime), falling back to the product
// baseline 90/120. Pass the rules from op-settings when available.
export function resolveDefaultDuration(partySize: number | undefined, rules?: TurnTimeRuleLite[] | null): number {
  const p = partySize ?? 0;
  const rule = rules?.find(r => p >= r.partySizeMin && p <= r.partySizeMax);
  return rule?.durationMinutes ?? getDefaultDuration(partySize);
}
