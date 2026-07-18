// Callback state machine + unresolved count — pure tests (no DB, no network).
// Run: npm run test:callback-state

import assert from 'assert';
import { countOpen, isOpen, nextStatus, OPEN_STATUSES, CLOSED_STATUSES } from './callbackState';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

// ── count (D5: badge = PENDING + IN_PROGRESS) ────────────────────────────────
P('countOpen counts PENDING + IN_PROGRESS, excludes COMPLETED/CANCELLED/null', () => {
  const items = [
    { queueStatus: 'PENDING_CALLBACK' as const },
    { queueStatus: 'PENDING_CALLBACK' as const },
    { queueStatus: 'CALLBACK_IN_PROGRESS' as const },
    { queueStatus: 'CALLBACK_COMPLETED' as const },
    { queueStatus: 'CALLBACK_CANCELLED' as const },
    { queueStatus: null },
  ];
  assert.deepStrictEqual(countOpen(items), { pending: 2, inProgress: 1, total: 3 });
});

P('countOpen on empty set = 0', () => {
  assert.deepStrictEqual(countOpen([]), { pending: 0, inProgress: 0, total: 0 });
});

P('total always equals pending + inProgress', () => {
  const c = countOpen([
    { queueStatus: 'PENDING_CALLBACK' as const },
    { queueStatus: 'CALLBACK_IN_PROGRESS' as const },
    { queueStatus: 'CALLBACK_IN_PROGRESS' as const },
  ]);
  assert.strictEqual(c.total, c.pending + c.inProgress);
  assert.strictEqual(c.total, 3);
});

P('badge count does NOT grow with completed/cancelled history (no drift over closed items)', () => {
  const withHistory = [
    { queueStatus: 'PENDING_CALLBACK' as const },
    ...Array.from({ length: 50 }, () => ({ queueStatus: 'CALLBACK_COMPLETED' as const })),
    ...Array.from({ length: 30 }, () => ({ queueStatus: 'CALLBACK_CANCELLED' as const })),
  ];
  assert.strictEqual(countOpen(withHistory).total, 1);
});

// ── isOpen / status sets ─────────────────────────────────────────────────────
P('isOpen true only for PENDING and IN_PROGRESS', () => {
  assert.strictEqual(isOpen('PENDING_CALLBACK'), true);
  assert.strictEqual(isOpen('CALLBACK_IN_PROGRESS'), true);
  assert.strictEqual(isOpen('CALLBACK_COMPLETED'), false);
  assert.strictEqual(isOpen('CALLBACK_CANCELLED'), false);
  assert.strictEqual(isOpen(null), false);
});

P('OPEN and CLOSED status sets are disjoint and cover all 4 statuses', () => {
  const all = [...OPEN_STATUSES, ...CLOSED_STATUSES];
  assert.strictEqual(new Set(all).size, 4);
  for (const s of OPEN_STATUSES) assert.ok(!CLOSED_STATUSES.includes(s as never));
});

// ── transitions (mirror the router guards; contract for clear-all/undo) ──────
P('start: PENDING -> IN_PROGRESS, illegal elsewhere', () => {
  assert.strictEqual(nextStatus('PENDING_CALLBACK', 'start'), 'CALLBACK_IN_PROGRESS');
  assert.strictEqual(nextStatus('CALLBACK_IN_PROGRESS', 'start'), null);
  assert.strictEqual(nextStatus('CALLBACK_COMPLETED', 'start'), null);
  assert.strictEqual(nextStatus(null, 'start'), null);
});

P('complete: from either open state -> COMPLETED, not from closed', () => {
  assert.strictEqual(nextStatus('PENDING_CALLBACK', 'complete'), 'CALLBACK_COMPLETED');
  assert.strictEqual(nextStatus('CALLBACK_IN_PROGRESS', 'complete'), 'CALLBACK_COMPLETED');
  assert.strictEqual(nextStatus('CALLBACK_COMPLETED', 'complete'), null);
  assert.strictEqual(nextStatus('CALLBACK_CANCELLED', 'complete'), null);
});

P('cancel: from either open state -> CANCELLED, not from closed', () => {
  assert.strictEqual(nextStatus('PENDING_CALLBACK', 'cancel'), 'CALLBACK_CANCELLED');
  assert.strictEqual(nextStatus('CALLBACK_IN_PROGRESS', 'cancel'), 'CALLBACK_CANCELLED');
  assert.strictEqual(nextStatus('CALLBACK_COMPLETED', 'cancel'), null);
});

P('release: IN_PROGRESS -> PENDING only', () => {
  assert.strictEqual(nextStatus('CALLBACK_IN_PROGRESS', 'release'), 'PENDING_CALLBACK');
  assert.strictEqual(nextStatus('PENDING_CALLBACK', 'release'), null);
});

P('reopen (undo): COMPLETED/CANCELLED -> PENDING, not from open', () => {
  assert.strictEqual(nextStatus('CALLBACK_COMPLETED', 'reopen'), 'PENDING_CALLBACK');
  assert.strictEqual(nextStatus('CALLBACK_CANCELLED', 'reopen'), 'PENDING_CALLBACK');
  assert.strictEqual(nextStatus('PENDING_CALLBACK', 'reopen'), null);
  assert.strictEqual(nextStatus('CALLBACK_IN_PROGRESS', 'reopen'), null);
});

P('complete is idempotent-safe: re-completing a completed item is a no-op (null) not a crash', () => {
  assert.strictEqual(nextStatus('CALLBACK_COMPLETED', 'complete'), null);
});

console.log(`\n${passed}/12 callback-state tests passed`);
process.exit(0);
