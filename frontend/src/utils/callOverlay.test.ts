// Compact communication overlay — section building + FAB target.
// Run: npm run test:call-overlay  (node --experimental-strip-types)

import assert from 'node:assert';
import { buildOverlaySections, resolveFabTarget, RECENT_HANDLED_LIMIT } from './callOverlay.ts';
import type { CallbackItem } from './../types.ts';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

function item(id: string, queueStatus: CallbackItem['queueStatus']): CallbackItem {
  return {
    id, phone: '+972500000000', status: 'missed', createdAt: '2026-07-18T10:00:00.000Z',
    guestName: null, restaurantName: null, queueStatus, callbackNote: null,
    handledBy: null, claimedAt: null, callbackCompletedAt: null,
  };
}

const resp = {
  active: [item('a1', 'PENDING_CALLBACK'), item('a2', 'CALLBACK_IN_PROGRESS')],
  recentClosed: Array.from({ length: 12 }, (_, i) => item(`c${i}`, 'CALLBACK_COMPLETED')),
  count: { total: 2 },
};

// ── active items shown first / as their own section ──────────────────────────
P('active section = the server active list (PENDING + IN_PROGRESS), untouched order', () => {
  const s = buildOverlaySections(resp);
  assert.deepStrictEqual(s.active.map(i => i.id), ['a1', 'a2']);
  assert.strictEqual(s.activeCount, 2);
  assert.strictEqual(s.isEmpty, false);
});

// ── handled items visually separated (distinct, capped) ──────────────────────
P('recentHandled is a separate list, drawn from recentClosed and capped', () => {
  const s = buildOverlaySections(resp);
  assert.strictEqual(s.recentHandled.length, RECENT_HANDLED_LIMIT); // capped from 12
  // separate array from active — no active ids leak into handled
  const activeIds = new Set(s.active.map(i => i.id));
  assert.ok(s.recentHandled.every(i => !activeIds.has(i.id)));
});

P('custom cap is honoured', () => {
  assert.strictEqual(buildOverlaySections(resp, 3).recentHandled.length, 3);
  assert.strictEqual(buildOverlaySections(resp, 0).recentHandled.length, 0);
});

// ── empty active state ───────────────────────────────────────────────────────
P('empty active → isEmpty true, count 0, calm state', () => {
  const s = buildOverlaySections({ active: [], recentClosed: [], count: { total: 0 } });
  assert.strictEqual(s.isEmpty, true);
  assert.strictEqual(s.activeCount, 0);
  assert.strictEqual(s.active.length, 0);
});

// ── API error / malformed → graceful empty (never throws) ────────────────────
P('null / malformed response degrades to empty sections (API error state)', () => {
  for (const bad of [null, undefined, {}, { active: 'nope' } as never, { recentClosed: 5 } as never]) {
    const s = buildOverlaySections(bad as never);
    assert.deepStrictEqual(s.active, []);
    assert.deepStrictEqual(s.recentHandled, []);
    assert.strictEqual(s.activeCount, 0);
    assert.strictEqual(s.isEmpty, true);
  }
});

P('activeCount trusts server count.total, falls back to active length', () => {
  assert.strictEqual(buildOverlaySections({ active: [item('x', 'PENDING_CALLBACK')], count: { total: 9 } }).activeCount, 9);
  assert.strictEqual(buildOverlaySections({ active: [item('x', 'PENDING_CALLBACK')] }).activeCount, 1);
});

// ── FAB target: desktop opens overlay, mobile stays safe ─────────────────────
P('desktop FAB opens the compact overlay; mobile keeps the existing calls tab', () => {
  assert.strictEqual(resolveFabTarget(false), 'compact-overlay');
  assert.strictEqual(resolveFabTarget(true), 'mobile-calls-tab');
});

console.log(`\n${passed}/7 call-overlay tests passed`);
