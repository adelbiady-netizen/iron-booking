/**
 * Maps an Iron Booking reservation to the POS "visit state" projected onto the
 * ATLAS floor. This is the single source of truth for the state a visit snapshot
 * carries, so every reservation mutation projects a consistent state instead of
 * relying on a hand-placed event per action.
 */
export type VisitState =
  | 'expected'
  | 'arrived'
  | 'seated'
  | 'closed'
  | 'cancelled'
  | 'no_show'
  | 'standby';

/**
 * Derive the POS visit state from a reservation's status + physical-arrival flag.
 * PENDING/CONFIRMED become 'arrived' when the host marked the guest present,
 * otherwise 'expected'. Terminal statuses map straight through.
 */
export function reservationVisitState(status: string, isArrived: boolean): VisitState {
  switch (status) {
    case 'SEATED':
      return 'seated';
    case 'COMPLETED':
      // ATLAS's hospitality_visit_registry state CHECK allows 'closed', NOT
      // 'completed'. Sending 'completed' made ATLAS reject the visit.upserted
      // (internal_error) on every booking completion, so a completed no-order
      // reservation stayed 'seated' and its POS table never freed. 'closed' is
      // ATLAS's terminal state (filtered off the incoming floor) — the right one.
      return 'closed';
    case 'CANCELLED':
      return 'cancelled';
    case 'NO_SHOW':
      return 'no_show';
    case 'STANDBY':
      return 'standby';
    case 'PENDING':
    case 'CONFIRMED':
    default:
      return isArrived ? 'arrived' : 'expected';
  }
}

/**
 * States that must NOT be projected onto the POS floor at all. STANDBY is the
 * waitlist — no table, not a booked cover — so it never becomes a floor visit.
 */
export function isFloorlessState(state: VisitState): boolean {
  return state === 'standby';
}
