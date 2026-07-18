// Pure logic for the compact communication overlay (P2). Kept out of the React
// component so it is unit-testable with `node --experimental-strip-types`.
//
// The overlay is a SECOND VIEW of the same server-authoritative data
// (GET /call-logs/callbacks) — it does not introduce a parallel data model.

import type { CallbackItem } from '../types';
import { callbackCountFromResponse } from './callbackBadge.ts';

export const RECENT_HANDLED_LIMIT = 5;

export interface OverlaySections {
  /** Requires attention — PENDING + IN_PROGRESS, in the server's FIFO order. */
  active: CallbackItem[];
  /** Recently handled — COMPLETED + CANCELLED, capped and kept visually quiet. */
  recentHandled: CallbackItem[];
  /** Server-authoritative unresolved count (matches the FAB badge). */
  activeCount: number;
  /** True when nothing requires attention (calm empty state). */
  isEmpty: boolean;
}

type CallbacksResponse = {
  active?: CallbackItem[];
  recentClosed?: CallbackItem[];
  count?: { total?: number } | null;
} | null | undefined;

/**
 * Split a /call-logs/callbacks response into the overlay's sections. Server owns
 * ordering (active is FIFO by createdAt asc) — we only cap the "recently handled"
 * tail. Null / malformed input (e.g. an API failure handled upstream) degrades to
 * empty sections so the overlay renders a calm/empty state, never crashes.
 */
export function buildOverlaySections(
  r: CallbacksResponse,
  limit: number = RECENT_HANDLED_LIMIT,
): OverlaySections {
  const active = Array.isArray(r?.active) ? (r!.active as CallbackItem[]) : [];
  const recentAll = Array.isArray(r?.recentClosed) ? (r!.recentClosed as CallbackItem[]) : [];
  const recentHandled = recentAll.slice(0, Math.max(0, limit));
  const activeCount = callbackCountFromResponse(r ?? undefined);
  return { active, recentHandled, activeCount, isEmpty: active.length === 0 };
}

export type FabTarget = 'compact-overlay' | 'mobile-calls-tab';

/**
 * Where the floating phone button leads. Desktop / wide browser opens the new
 * compact overlay (P2's primary daily workflow); mobile — which includes the
 * installed-PWA tablets (isMobile is true for standalone touch devices) — keeps
 * the existing calls tab, the sanctioned safe fallback.
 */
export function resolveFabTarget(isMobile: boolean): FabTarget {
  return isMobile ? 'mobile-calls-tab' : 'compact-overlay';
}
