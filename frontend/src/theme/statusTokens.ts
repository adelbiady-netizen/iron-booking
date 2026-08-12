// ─── Host status color tokens ─────────────────────────────────────────────────
// Single source of truth for reservation-status colors across the Host workspace.
// Before this, each surface (GuestDrawer pill, ReservationPanel list badge,
// GuestProfile, and the table panels) defined its own status→class map, which
// drifted (e.g. SEATED read emerald in dots but brand-green in pills; NO_SHOW
// mixed orange and red). One state must read as one color everywhere.
//
// Canonical decisions (Host Excellence Sprint P0):
//   • NO_SHOW  = orange  (kept distinct from Cancel-red)
//   • SEATED   = brand green (iron-green), not emerald
//
// `pill` is self-contained (background + text + border) so it drops into an
// element with or without its own `border` class. `dot` is the small
// status-dot background, exported for the table panels to adopt.
import type { ReservationStatus } from '../types';

export interface ReservationStatusToken {
  /** Full self-contained badge/pill className: background + text + border. */
  pill: string;
  /** Small status-dot background className. */
  dot: string;
}

export const RESERVATION_STATUS_TOKENS: Record<ReservationStatus, ReservationStatusToken> = {
  PENDING:   { pill: 'bg-status-warning/15 text-status-warning border border-status-warning/30',      dot: 'bg-status-warning' },
  CONFIRMED: { pill: 'bg-status-reserved/12 text-status-reserved/90 border border-status-reserved/25', dot: 'bg-status-reserved' },
  SEATED:    { pill: 'bg-iron-green/22 text-iron-green-light border border-iron-green/35',             dot: 'bg-iron-green-light' },
  COMPLETED: { pill: 'bg-iron-border/18 text-iron-muted/75 border border-iron-border/25',              dot: 'bg-iron-muted/50' },
  CANCELLED: { pill: 'bg-red-900/15 text-status-danger border border-red-900/25',                      dot: 'bg-status-danger' },
  NO_SHOW:   { pill: 'bg-orange-900/15 text-orange-400 border border-orange-900/25',                   dot: 'bg-orange-400' },
  STANDBY:   { pill: 'bg-amber-900/15 text-amber-400 border border-amber-900/25',                      dot: 'bg-amber-400' },
};

/** Self-contained pill/badge className (bg + text + border) for a reservation status. */
export function statusPill(status: ReservationStatus): string {
  return RESERVATION_STATUS_TOKENS[status].pill;
}

/** Status-dot background className for a reservation status. */
export function statusDot(status: ReservationStatus): string {
  return RESERVATION_STATUS_TOKENS[status].dot;
}
