// Single source of truth for the callback-queue state machine and the
// server-authoritative unresolved count. Pure (no DB, no I/O) so it is unit
// testable and reused by the calls router, the SSE count, and later phases
// (clear-all, undo/reopen).
//
// The queue models CALLBACKS on missed inbound calls only. Statuses live in the
// Prisma `CallbackStatus` enum on CallLog.queueStatus.

export type CallbackStatus =
  | 'PENDING_CALLBACK'
  | 'CALLBACK_IN_PROGRESS'
  | 'CALLBACK_COMPLETED'
  | 'CALLBACK_CANCELLED';

// "Open" = still requires attention. This is the set the badge counts.
export const OPEN_STATUSES = ['PENDING_CALLBACK', 'CALLBACK_IN_PROGRESS'] as const;
export const CLOSED_STATUSES = ['CALLBACK_COMPLETED', 'CALLBACK_CANCELLED'] as const;

export function isOpen(status: CallbackStatus | null | undefined): boolean {
  return status === 'PENDING_CALLBACK' || status === 'CALLBACK_IN_PROGRESS';
}

export interface OpenCount {
  pending: number;
  inProgress: number;
  total: number; // pending + inProgress — the actionable badge value (D5)
}

// Server-authoritative unresolved count over a set of callback rows. The badge
// (D5) shows `total` = PENDING + IN_PROGRESS; COMPLETED/CANCELLED are excluded.
export function countOpen(items: ReadonlyArray<{ queueStatus: CallbackStatus | null }>): OpenCount {
  let pending = 0;
  let inProgress = 0;
  for (const it of items) {
    if (it.queueStatus === 'PENDING_CALLBACK') pending++;
    else if (it.queueStatus === 'CALLBACK_IN_PROGRESS') inProgress++;
  }
  return { pending, inProgress, total: pending + inProgress };
}

export type CallbackAction = 'start' | 'complete' | 'cancel' | 'release' | 'reopen';

// The transition spec. Returns the resulting status for a legal transition, or
// null if the action is not allowed from `from`. Mirrors the guards enforced in
// calls/router.ts and defines the contract for future clear-all / undo.
//
// - start:    PENDING            -> IN_PROGRESS   (claim)
// - complete: PENDING|IN_PROGRESS-> COMPLETED     (mark handled — D1)
// - cancel:   PENDING|IN_PROGRESS-> CANCELLED     (dismiss)
// - release:  IN_PROGRESS        -> PENDING       (un-claim, keeps FIFO position)
// - reopen:   COMPLETED|CANCELLED-> PENDING       (undo — D3, used by Undo toast)
export function nextStatus(
  from: CallbackStatus | null,
  action: CallbackAction,
): CallbackStatus | null {
  switch (action) {
    case 'start':
      return from === 'PENDING_CALLBACK' ? 'CALLBACK_IN_PROGRESS' : null;
    case 'complete':
      return isOpen(from) ? 'CALLBACK_COMPLETED' : null;
    case 'cancel':
      return isOpen(from) ? 'CALLBACK_CANCELLED' : null;
    case 'release':
      return from === 'CALLBACK_IN_PROGRESS' ? 'PENDING_CALLBACK' : null;
    case 'reopen':
      return from === 'CALLBACK_COMPLETED' || from === 'CALLBACK_CANCELLED'
        ? 'PENDING_CALLBACK'
        : null;
    default:
      return null;
  }
}
