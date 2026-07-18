// Single source of truth for how the online-reservation controls are read out
// of the Restaurant.settings JSON blob. Used by BOTH the public booking guard
// (modules/public/booking.router.ts) and the Host-app settings endpoint
// (modules/hostSettings/router.ts) so their defaults can never drift apart.
//
// SAFETY INVARIANT: onlineReservationsEnabled defaults to TRUE. Existing
// restaurants have no such key in their settings JSON — a missing/legacy key
// must never silently disable online booking. Only an explicit `false` closes it.

export interface OnlineReservationSettings {
  onlineReservationsEnabled: boolean;
  maxOnlinePartySize: number;
}

export const DEFAULT_MAX_ONLINE_PARTY = 5;

export function readOnlineReservationSettings(settings: unknown): OnlineReservationSettings {
  const s = (settings ?? {}) as Record<string, unknown>;
  return {
    onlineReservationsEnabled:
      typeof s['onlineReservationsEnabled'] === 'boolean'
        ? (s['onlineReservationsEnabled'] as boolean)
        : true,
    maxOnlinePartySize:
      typeof s['maxOnlinePartySize'] === 'number'
        ? (s['maxOnlinePartySize'] as number)
        : DEFAULT_MAX_ONLINE_PARTY,
  };
}
