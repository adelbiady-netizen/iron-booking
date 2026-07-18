// Backend P3 tests — mark-handled / Clear All / Undo orchestration.
//
// Runs DB-free: an in-memory CallbackStore mirrors the Prisma store's semantics
// (tenant scoping, OPEN-only transitions, the FIFO lock snapshot, and the
// compare-and-swap that makes Undo safe). This exercises the SAME plan* code the
// HTTP handlers call, so the concurrency + audit guarantees are verified without
// a database. Run: npm run test:callback-ops
//
// Convention matches callbackState.test.ts: a tiny P() runner + node:assert.

import assert from 'node:assert';
import type { CallbackStatus } from './callbackState';
import { isOpen } from './callbackState';
import {
  planComplete,
  planCancel,
  planClearAll,
  planUndo,
  toOpenStatus,
  type CallbackStore,
  type Effects,
} from './callbackOps';

// In-memory store mirroring the Prisma store's semantics: tenant scoping,
// OPEN-only transitions, a FIFO lock snapshot, and the completedAt compare-and-swap.
interface MemRow {
  id: string;
  restaurantId: string;
  phone: string;
  status: string;
  createdAt: Date;
  guestName: string | null;
  restaurantName: string | null;
  queueStatus: CallbackStatus | null;
  callbackNote: string | null;
  handledBy: string | null;
  claimedAt: Date | null;
  callbackCompletedAt: Date | null;
}

function makeInMemoryStore(rows: MemRow[], opts: { injectAfterLock?: MemRow } = {}): CallbackStore {
  let injected = false;
  const find = (rid: string, id: string) => rows.find((r) => r.id === id && r.restaurantId === rid);
  return {
    async getStatus(rid, id) {
      const r = find(rid, id);
      return r ? r.queueStatus : undefined;
    },
    async getRow(rid, id) {
      const r = find(rid, id);
      if (!r) return null;
      const { restaurantId: _omit, ...rest } = r;
      return rest;
    },
    async closeIfOpen(rid, id, to, at, handledBy, note) {
      const r = find(rid, id);
      if (!r || !isOpen(r.queueStatus)) return 0;
      r.queueStatus = to;
      r.handledBy = handledBy;
      r.callbackCompletedAt = at;
      if (note !== undefined) r.callbackNote = note;
      return 1;
    },
    async lockOpen(rid) {
      const snapshot = rows
        .filter((r) => r.restaurantId === rid && isOpen(r.queueStatus))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => ({ id: r.id, previousStatus: toOpenStatus(r.queueStatus) }));
      // Simulate a concurrent insert that lands AFTER the FOR UPDATE snapshot.
      if (opts.injectAfterLock && !injected) {
        injected = true;
        rows.push(opts.injectAfterLock);
      }
      return snapshot;
    },
    async completeMany(rid, ids, at, handledBy) {
      for (const id of ids) {
        const r = find(rid, id);
        if (!r) continue;
        r.queueStatus = 'CALLBACK_COMPLETED';
        r.handledBy = handledBy;
        r.callbackCompletedAt = at;
      }
    },
    async casRestore(rid, id, token, previousStatus) {
      const r = find(rid, id);
      if (!r || r.queueStatus !== 'CALLBACK_COMPLETED') return false;
      if (r.callbackCompletedAt?.getTime() !== token.getTime()) return false;
      if (previousStatus === 'PENDING_CALLBACK') {
        r.queueStatus = 'PENDING_CALLBACK';
        r.callbackCompletedAt = null;
        r.handledBy = null;
        r.claimedAt = null;
      } else {
        r.queueStatus = 'CALLBACK_IN_PROGRESS';
        r.callbackCompletedAt = null;
      }
      return true;
    },
  };
}

let passed = 0;
async function P(label: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`PASS | ${label}`);
}

const T0 = new Date('2026-07-18T10:00:00.000Z');
const T1 = new Date('2026-07-18T10:05:00.000Z');
const T2 = new Date('2026-07-18T10:09:00.000Z');
const R1 = 'rest-1';
const R2 = 'rest-2';

function row(id: string, queueStatus: CallbackStatus | null, restaurantId = R1, createdAt = T0): MemRow {
  return {
    id, restaurantId, phone: `+972${id}`, status: 'missed', createdAt,
    guestName: null, restaurantName: null, queueStatus,
    callbackNote: null, handledBy: null, claimedAt: null, callbackCompletedAt: null,
  };
}

function auditEvents(e: Effects): string[] {
  return e.audits.map((a) => a.event);
}

async function main() {
  // ── Mark handled (single) ──────────────────────────────────────────────────
  await P('complete one: OPEN→COMPLETED, emits, audits, returns undo token', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK')];
    const store = makeInMemoryStore(rows);
    const res = await planComplete(store, { restaurantId: R1, id: 'p1', hostName: 'Dana', operationId: 'op-1', now: T1 });
    assert.ok(res.ok, 'expected ok');
    if (!res.ok) return;
    assert.strictEqual(rows[0].queueStatus, 'CALLBACK_COMPLETED');
    assert.strictEqual(rows[0].callbackCompletedAt?.getTime(), T1.getTime());
    assert.strictEqual(res.effects.emit, true);
    assert.deepStrictEqual(res.effects.audits, [
      { event: 'callback.complete', properties: { callbackId: 'p1', from: 'PENDING_CALLBACK', to: 'CALLBACK_COMPLETED' } },
    ]);
    assert.deepStrictEqual(res.undo.items, [{ id: 'p1', previousStatus: 'PENDING_CALLBACK' }]);
    assert.strictEqual(res.undo.completedAt?.getTime(), T1.getTime());
  });

  await P('complete one: already-closed → CONFLICT, no emit, no audit', async () => {
    const rows = [row('c1', 'CALLBACK_COMPLETED')];
    const store = makeInMemoryStore(rows);
    const res = await planComplete(store, { restaurantId: R1, id: 'c1', hostName: 'Dana', operationId: 'op-2', now: T1 });
    assert.strictEqual(res.ok, false);
    if (res.ok) return;
    assert.strictEqual(res.code, 'CONFLICT');
  });

  await P('complete one: missing row → NOT_FOUND', async () => {
    const store = makeInMemoryStore([]);
    const res = await planComplete(store, { restaurantId: R1, id: 'nope', hostName: 'Dana', operationId: 'op-3', now: T1 });
    assert.strictEqual(res.ok, false);
    if (res.ok) return;
    assert.strictEqual(res.code, 'NOT_FOUND');
  });

  await P('complete one: tenant-isolated — cannot touch another restaurant', async () => {
    const rows = [row('q1', 'PENDING_CALLBACK', R2)];
    const store = makeInMemoryStore(rows);
    const res = await planComplete(store, { restaurantId: R1, id: 'q1', hostName: 'Dana', operationId: 'op-4', now: T1 });
    assert.strictEqual(res.ok, false); // not visible to R1
    assert.strictEqual(rows[0].queueStatus, 'PENDING_CALLBACK'); // untouched
  });

  await P('cancel one: audits callback.cancel with from/to', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK')];
    const store = makeInMemoryStore(rows);
    const res = await planCancel(store, { restaurantId: R1, id: 'p1', hostName: 'Dana', operationId: 'op-5', now: T1 });
    assert.ok(res.ok);
    assert.strictEqual(rows[0].queueStatus, 'CALLBACK_CANCELLED');
    if (!res.ok) return;
    assert.deepStrictEqual(res.effects.audits, [
      { event: 'callback.cancel', properties: { callbackId: 'p1', from: 'PENDING_CALLBACK', to: 'CALLBACK_CANCELLED' } },
    ]);
  });

  // ── Clear All ───────────────────────────────────────────────────────────────
  await P('Clear All: affects only PENDING/IN_PROGRESS, leaves closed + non-callbacks', async () => {
    const rows = [
      row('p1', 'PENDING_CALLBACK', R1, new Date('2026-07-18T09:00:00Z')),
      row('p2', 'CALLBACK_IN_PROGRESS', R1, new Date('2026-07-18T09:01:00Z')),
      row('c1', 'CALLBACK_COMPLETED'),
      row('x1', 'CALLBACK_CANCELLED'),
      row('n1', null), // answered call, not a callback
    ];
    const store = makeInMemoryStore(rows);
    const res = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-1', now: T1 });
    assert.strictEqual(res.count, 2);
    assert.strictEqual(rows.find((r) => r.id === 'p1')!.queueStatus, 'CALLBACK_COMPLETED');
    assert.strictEqual(rows.find((r) => r.id === 'p2')!.queueStatus, 'CALLBACK_COMPLETED');
    assert.strictEqual(rows.find((r) => r.id === 'c1')!.queueStatus, 'CALLBACK_COMPLETED'); // unchanged (already)
    assert.strictEqual(rows.find((r) => r.id === 'x1')!.queueStatus, 'CALLBACK_CANCELLED'); // unchanged
    assert.strictEqual(rows.find((r) => r.id === 'n1')!.queueStatus, null); // unchanged
  });

  await P('Clear All: tenant-isolated — other restaurant untouched', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK', R1), row('q1', 'PENDING_CALLBACK', R2)];
    const store = makeInMemoryStore(rows);
    const res = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-2', now: T1 });
    assert.strictEqual(res.count, 1);
    assert.strictEqual(rows.find((r) => r.id === 'q1')!.queueStatus, 'PENDING_CALLBACK');
  });

  await P('Clear All: a callback created AFTER the lock snapshot is not affected', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK')];
    // Simulate a new missed call arriving after FOR UPDATE captured the open set:
    // it is inserted into the table but excluded from the lock snapshot.
    const store = makeInMemoryStore(rows, { injectAfterLock: row('late', 'PENDING_CALLBACK', R1, T2) });
    const res = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-3', now: T1 });
    assert.strictEqual(res.count, 1);
    assert.deepStrictEqual(res.undo.items.map((i) => i.id), ['p1']);
    assert.strictEqual(rows.find((r) => r.id === 'late')!.queueStatus, 'PENDING_CALLBACK'); // still open
  });

  await P('Clear All: previous states preserved per item in undo token', async () => {
    const rows = [
      row('p1', 'PENDING_CALLBACK', R1, new Date('2026-07-18T09:00:00Z')),
      row('p2', 'CALLBACK_IN_PROGRESS', R1, new Date('2026-07-18T09:01:00Z')),
    ];
    const store = makeInMemoryStore(rows);
    const res = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-4', now: T1 });
    assert.deepStrictEqual(res.undo.items, [
      { id: 'p1', previousStatus: 'PENDING_CALLBACK' },
      { id: 'p2', previousStatus: 'CALLBACK_IN_PROGRESS' },
    ]);
    assert.strictEqual(res.undo.completedAt?.getTime(), T1.getTime());
  });

  await P('Clear All: repeated call is an idempotent, silent no-op', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK')];
    const store = makeInMemoryStore(rows);
    await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-5a', now: T1 });
    const second = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-5b', now: T2 });
    assert.strictEqual(second.count, 0);
    assert.deepStrictEqual(second.undo.items, []);
    assert.strictEqual(second.effects.emit, false);
    assert.deepStrictEqual(second.effects.audits, []);
  });

  await P('Clear All: audit = one parent bulk entry + per-item complete (bulkId-linked)', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK'), row('p2', 'CALLBACK_IN_PROGRESS')];
    const store = makeInMemoryStore(rows);
    const res = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-6', now: T1 });
    assert.deepStrictEqual(auditEvents(res.effects), ['callback.clear_all', 'callback.complete', 'callback.complete']);
    assert.deepStrictEqual(res.effects.audits[0], {
      event: 'callback.clear_all',
      properties: { bulkId: 'bulk-6', count: 2, callbackIds: ['p1', 'p2'] },
    });
    assert.deepStrictEqual(res.effects.audits[1], {
      event: 'callback.complete',
      properties: { callbackId: 'p1', from: 'PENDING_CALLBACK', to: 'CALLBACK_COMPLETED', bulkId: 'bulk-6' },
    });
    assert.strictEqual(res.effects.emit, true);
  });

  // ── Undo ──────────────────────────────────────────────────────────────────
  await P('Undo: safe restore of a clear-all returns items to previous state', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK'), row('p2', 'CALLBACK_IN_PROGRESS')];
    const store = makeInMemoryStore(rows);
    const cleared = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-7', now: T1 });
    const undo = await planUndo(store, { restaurantId: R1, operationId: 'bulk-7', token: T1, items: cleared.undo.items });
    assert.deepStrictEqual(undo.restored.sort(), ['p1', 'p2']);
    assert.deepStrictEqual(undo.conflicted, []);
    assert.strictEqual(rows.find((r) => r.id === 'p1')!.queueStatus, 'PENDING_CALLBACK');
    assert.strictEqual(rows.find((r) => r.id === 'p1')!.callbackCompletedAt, null);
    assert.strictEqual(rows.find((r) => r.id === 'p2')!.queueStatus, 'CALLBACK_IN_PROGRESS');
    assert.strictEqual(undo.effects.emit, true);
    assert.deepStrictEqual(auditEvents(undo.effects), ['callback.undo', 'callback.reopen', 'callback.reopen']);
  });

  await P('Undo: reopen audit records from/to and reversedOperationId', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK')];
    const store = makeInMemoryStore(rows);
    const done = await planComplete(store, { restaurantId: R1, id: 'p1', hostName: 'Dana', operationId: 'op-8', now: T1 });
    assert.ok(done.ok);
    if (!done.ok) return;
    const undo = await planUndo(store, { restaurantId: R1, operationId: 'op-8', token: T1, items: done.undo.items });
    assert.deepStrictEqual(undo.effects.audits[0], {
      event: 'callback.undo',
      properties: { reversedOperationId: 'op-8', restoredIds: ['p1'], conflictedIds: [] },
    });
    assert.deepStrictEqual(undo.effects.audits[1], {
      event: 'callback.reopen',
      properties: { callbackId: 'p1', from: 'CALLBACK_COMPLETED', to: 'PENDING_CALLBACK', reversedOperationId: 'op-8' },
    });
  });

  await P('Undo: stale token (item changed since) is rejected, never overwritten', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK'), row('p2', 'CALLBACK_IN_PROGRESS')];
    const store = makeInMemoryStore(rows);
    const cleared = await planClearAll(store, { restaurantId: R1, hostName: 'Dana', operationId: 'bulk-9', now: T1 });
    // Another device independently reopens p1 (new state, no longer COMPLETED@T1).
    const p1 = rows.find((r) => r.id === 'p1')!;
    p1.queueStatus = 'PENDING_CALLBACK';
    p1.callbackCompletedAt = null;
    const undo = await planUndo(store, { restaurantId: R1, operationId: 'bulk-9', token: T1, items: cleared.undo.items });
    assert.deepStrictEqual(undo.restored, ['p2']);
    assert.deepStrictEqual(undo.conflicted, ['p1']);
    assert.strictEqual(p1.queueStatus, 'PENDING_CALLBACK'); // untouched by undo — newer state wins
  });

  await P('Undo: all-conflict → no restore, no emit, no audit', async () => {
    const rows = [row('p1', 'PENDING_CALLBACK')];
    const store = makeInMemoryStore(rows);
    const done = await planComplete(store, { restaurantId: R1, id: 'p1', hostName: 'Dana', operationId: 'op-10', now: T1 });
    assert.ok(done.ok);
    if (!done.ok) return;
    // Undo with a wrong token — simulates a re-complete at a different instant.
    const undo = await planUndo(store, { restaurantId: R1, operationId: 'op-10', token: T2, items: done.undo.items });
    assert.deepStrictEqual(undo.restored, []);
    assert.deepStrictEqual(undo.conflicted, ['p1']);
    assert.strictEqual(undo.effects.emit, false);
    assert.deepStrictEqual(undo.effects.audits, []);
    assert.strictEqual(rows[0].queueStatus, 'CALLBACK_COMPLETED'); // unchanged
  });

  await P('Undo: tenant-isolated — cannot restore another restaurant’s callback', async () => {
    const rows = [row('q1', 'PENDING_CALLBACK', R2)];
    const store = makeInMemoryStore(rows);
    // q1 belongs to R2; complete it as R2.
    const done = await planComplete(store, { restaurantId: R2, id: 'q1', hostName: 'Dana', operationId: 'op-11', now: T1 });
    assert.ok(done.ok);
    if (!done.ok) return;
    // Attacker/other tenant R1 attempts undo with the right token but wrong tenant.
    const undo = await planUndo(store, { restaurantId: R1, operationId: 'op-11', token: T1, items: done.undo.items });
    assert.deepStrictEqual(undo.conflicted, ['q1']);
    assert.strictEqual(rows[0].queueStatus, 'CALLBACK_COMPLETED'); // untouched
  });

  console.log(`\n${passed}/16 callback-ops tests passed`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL |', err);
  process.exit(1);
});
