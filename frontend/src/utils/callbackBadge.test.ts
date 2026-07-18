// Floating phone button — badge text, authoritative count source, open target.
// Run: npm run test:callback-badge  (node --experimental-strip-types)

import assert from 'node:assert';
import { formatCallBadge, callbackCountFromResponse, resolveOpenCallsTarget } from './callbackBadge.ts';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

// ── badge hidden at zero ─────────────────────────────────────────────────────
P('badge hidden at zero (and for negative / NaN) → null', () => {
  assert.strictEqual(formatCallBadge(0), null);
  assert.strictEqual(formatCallBadge(-3), null);
  assert.strictEqual(formatCallBadge(NaN), null);
});

// ── correct numeric badge ────────────────────────────────────────────────────
P('correct numeric badge for 1..99', () => {
  assert.strictEqual(formatCallBadge(1), '1');
  assert.strictEqual(formatCallBadge(7), '7');
  assert.strictEqual(formatCallBadge(42), '42');
  assert.strictEqual(formatCallBadge(99), '99');
});

// ── 99+ ──────────────────────────────────────────────────────────────────────
P('99+ for counts above 99 (boundary at 100)', () => {
  assert.strictEqual(formatCallBadge(100), '99+');
  assert.strictEqual(formatCallBadge(250), '99+');
});

// ── authoritative count source (drives the callback_updated refetch) ─────────
P('count comes from server count.total (PENDING + IN_PROGRESS), authoritative', () => {
  assert.strictEqual(
    callbackCountFromResponse({ count: { total: 4 }, active: [{}, {}] }),
    4, // trusts server total, NOT the array length
  );
});

P('falls back to active.length when count is absent (older backend)', () => {
  assert.strictEqual(callbackCountFromResponse({ active: [{}, {}, {}] }), 3);
  assert.strictEqual(callbackCountFromResponse({ count: null, active: [{}] }), 1);
});

P('degrades to 0 on empty / malformed response (badge hidden, never crashes)', () => {
  assert.strictEqual(callbackCountFromResponse({}), 0);
  assert.strictEqual(callbackCountFromResponse(null), 0);
  assert.strictEqual(callbackCountFromResponse(undefined), 0);
  assert.strictEqual(callbackCountFromResponse({ count: { total: -1 }, active: [] }), 0);
});

P('never derived from a partial call-history list (only count.total or active)', () => {
  // A response shaped like the paginated /call-logs list (data/meta) must NOT be
  // mistaken for a count — it has no count and no active, so → 0.
  assert.strictEqual(callbackCountFromResponse({} as never), 0);
});

// ── click opens the existing calls surface ───────────────────────────────────
P('open target: mobile → calls tab, desktop → right-side drawer', () => {
  assert.strictEqual(resolveOpenCallsTarget(true), 'mobile-calls-tab');
  assert.strictEqual(resolveOpenCallsTarget(false), 'desktop-drawer');
});

console.log(`\n${passed}/8 callback-badge tests passed`);
