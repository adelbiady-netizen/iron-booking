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
 */
import { Request, Response, NextFunction } from 'express';

export function atlasSyncEnabled(): boolean {
  return process.env.ATLAS_SYNC_ENABLED === 'true';
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
