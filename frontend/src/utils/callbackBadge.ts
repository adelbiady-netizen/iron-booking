// Pure logic behind the floating phone button (P1). Kept separate from the
// CallFab component so it is unit-testable with `node --experimental-strip-types`
// (the repo's frontend test convention — no JSX in tests).

/**
 * Badge text rule:
 *  - count <= 0 (or NaN) -> null  (badge is hidden entirely)
 *  - 1..99               -> the number as a string
 *  - > 99                -> "99+"
 */
export function formatCallBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count > 99) return '99+';
  return String(Math.floor(count));
}

/**
 * Server-authoritative unresolved count from GET /call-logs/callbacks.
 * Prefers the explicit `count.total` (PENDING + IN_PROGRESS, computed server-side);
 * falls back to the length of the full active array for resilience against an
 * older backend. Never derived from the paginated call-history list.
 */
export function callbackCountFromResponse(
  r: { count?: { total?: number } | null; active?: unknown[] } | null | undefined,
): number {
  const total = r?.count?.total;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) return total;
  return Array.isArray(r?.active) ? r!.active!.length : 0;
}

export type OpenCallsTarget = 'mobile-calls-tab' | 'desktop-drawer';

/**
 * Which existing calls surface the floating button opens. On mobile it switches
 * the bottom-nav to the calls tab; on desktop it opens the right-side call drawer.
 * (P1 reuses the current experience — no new panel.)
 */
export function resolveOpenCallsTarget(isMobile: boolean): OpenCallsTarget {
  return isMobile ? 'mobile-calls-tab' : 'desktop-drawer';
}
