/**
 * Master kill-switch for the Iron Booking ↔ ATLAS POS integration.
 *
 * DISABLED BY DEFAULT. The entire integration — outbound event dispatch,
 * outbox queueing, inbound ATLAS→IB endpoints, and the admin endpoints that
 * call ATLAS directly (attach / resync-tables / populate-atlas-table-ids) —
 * only runs when the environment variable ATLAS_SYNC_ENABLED is exactly "true".
 *
 * While disabled there is NO connection between the two systems in either
 * direction: IB never calls ATLAS, and ATLAS's calls into IB are refused.
 *
 * To reconnect later: set ATLAS_SYNC_ENABLED=true in the backend environment
 * and redeploy. No data is deleted while disabled, so re-enabling is instant.
 *
 * ── Per-location allowlist (ATLAS_SYNC_ALLOWED_LOCATIONS) ────────────────────
 * On top of the global switch, an optional comma-separated allowlist of ATLAS
 * location ids scopes the bridge to a chosen set of locations. When it is unset
 * or empty every location is allowed (whole-fleet, back-compat). When it is
 * non-empty ONLY the listed locations sync — every other location stays inert
 * (no outbound events, refused inbound calls) even while the global switch is
 * on. This is how a single location (e.g. the demo) can be enabled with full
 * control while the rest of the fleet remains frozen by construction.
 *   e.g. ATLAS_SYNC_ALLOWED_LOCATIONS=f0d59744-e974-46d8-a445-064906eb2417
 */
import { Request, Response, NextFunction } from 'express';

export function atlasSyncEnabled(): boolean {
  return process.env.ATLAS_SYNC_ENABLED === 'true';
}

/**
 * Parse ATLAS_SYNC_ALLOWED_LOCATIONS into a lower-cased Set of location ids.
 * Returns null when the allowlist is unset or contains no ids — the caller
 * treats null as "all locations allowed" (whole-fleet, back-compat).
 */
function allowedLocationSet(): Set<string> | null {
  const raw = process.env.ATLAS_SYNC_ALLOWED_LOCATIONS;
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return ids.length === 0 ? null : new Set(ids);
}

/**
 * True when the given ATLAS location is permitted under the allowlist.
 * - No allowlist in force → every location allowed (back-compat).
 * - Allowlist in force → only listed locations; a null/undefined location is
 *   never allowed (an unattached row cannot ride the bridge).
 * Independent of the global switch — combine via atlasSyncEnabledForLocation.
 */
export function locationAllowed(atlasLocationId: string | null | undefined): boolean {
  const set = allowedLocationSet();
  if (set === null) return true;
  if (!atlasLocationId) return false;
  return set.has(atlasLocationId.toLowerCase());
}

/**
 * The full gate for a specific location: the global switch must be on AND the
 * location must pass the allowlist. Use this wherever a location context is
 * known (outbound queueing/delivery, inbound after the caller is resolved).
 */
export function atlasSyncEnabledForLocation(atlasLocationId: string | null | undefined): boolean {
  return atlasSyncEnabled() && locationAllowed(atlasLocationId);
}

/**
 * Express guard for every ATLAS-facing route. Returns 503 when the integration
 * is disabled so ATLAS gets a clear, non-retryable-looking signal that the
 * bridge is intentionally down.
 */
export function requireAtlasSync(_req: Request, res: Response, next: NextFunction): void {
  if (!atlasSyncEnabled()) {
    res.status(503).json({
      error:   'ATLAS_SYNC_DISABLED',
      message: 'Iron Booking ↔ ATLAS integration is currently disabled (ATLAS_SYNC_ENABLED != "true").',
    });
    return;
  }
  next();
}
