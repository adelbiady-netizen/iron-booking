// Returns the hardcoded fallback duration when restaurant settings are unavailable.
// Always 90 min — party-size-based inflation was removed because it caused
// 120-min reservations to block valid operational turns (e.g. 18:30+120 blocks 20:30).
export function getDefaultDuration(_partySize?: number): number {
  return 90;
}
