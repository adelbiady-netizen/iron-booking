// Pure logic + dependency-injected runners for the P3 overlay actions
// (mark-handled, Clear All, Undo). Kept out of the React component so it is
// unit-testable with `node --experimental-strip-types`. The runners take the
// api call + refetch as deps, so tests can assert that authoritative refetch
// happens after every operation — without a browser.

import type {
  CallbackClearAllResponse,
  CallbackUndoDescriptor,
  CallbackUndoResponse,
} from '../types';

// Short, practical Undo window (ms). The toast auto-dismisses after this; it does
// NOT delete any server record — Undo validity is a server-side token check.
export const UNDO_WINDOW_MS = 9000;

// Clear All is offered only when there is an unresolved (actionable) set.
export function shouldShowClearAll(activeCount: number): boolean {
  return activeCount > 0;
}

// Confirmation copy — always includes the count being affected.
export function clearAllConfirmText(count: number, template: (n: number) => string): string {
  return template(count);
}

// Prevent duplicate submission while a request for this scope is in flight.
export function isActionDisabled(inFlight: boolean): boolean {
  return inFlight;
}

// An operation's undo token is actionable only if it changed something we can
// still reference (has items + a completedAt token to validate against).
export function hasUndoableItems(undo: CallbackUndoDescriptor | null | undefined): boolean {
  return !!undo && !!undo.completedAt && undo.items.length > 0;
}

export type UndoOutcome = 'restored' | 'partial' | 'conflict' | 'noop';

// Classify a server Undo result for user feedback.
export function classifyUndoResult(res: CallbackUndoResponse): UndoOutcome {
  const restored = res.restored.length;
  const conflicted = res.conflicted.length;
  if (restored > 0 && conflicted === 0) return 'restored';
  if (restored > 0 && conflicted > 0) return 'partial';
  if (restored === 0 && conflicted > 0) return 'conflict';
  return 'noop';
}

// True when the user should see the "changed on another device" message
// (something the operation could not restore).
export function isUndoConflict(outcome: UndoOutcome): boolean {
  return outcome === 'conflict' || outcome === 'partial';
}

export interface ClearAllDeps {
  clearAll: () => Promise<CallbackClearAllResponse>;
  refetch: () => void | Promise<void>;
}

// Run Clear All, ALWAYS refetching authoritative data afterward (success or not).
// Returns the undo token when the op changed something, else null.
export async function runClearAll(
  deps: ClearAllDeps,
): Promise<{ undo: CallbackUndoDescriptor | null; count: number }> {
  try {
    const res = await deps.clearAll();
    return { undo: hasUndoableItems(res.undo) ? res.undo : null, count: res.count };
  } finally {
    await deps.refetch();
  }
}

export interface UndoDeps {
  undo: (payload: CallbackUndoDescriptor) => Promise<CallbackUndoResponse>;
  refetch: () => void | Promise<void>;
}

// Run Undo, ALWAYS refetching authoritative data afterward. Returns the outcome
// for feedback (conflict → the calm "changed on another device" message).
export async function runUndo(
  deps: UndoDeps,
  descriptor: CallbackUndoDescriptor,
): Promise<{ outcome: UndoOutcome }> {
  try {
    const res = await deps.undo(descriptor);
    return { outcome: classifyUndoResult(res) };
  } finally {
    await deps.refetch();
  }
}
