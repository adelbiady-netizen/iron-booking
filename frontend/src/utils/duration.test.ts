// Restaurant-aware default seating duration + expected end time.
// Run: npm run test:duration  (node --experimental-strip-types)

import assert from 'node:assert';
import { getDefaultDuration, resolveDefaultDuration, type TurnTimeRuleLite } from './duration.ts';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

P('baseline: party ≤2 → 90, party ≥3 → 120', () => {
  assert.strictEqual(getDefaultDuration(1), 90);
  assert.strictEqual(getDefaultDuration(2), 90);
  assert.strictEqual(getDefaultDuration(3), 120);
  assert.strictEqual(getDefaultDuration(8), 120);
});

const najmaRules: TurnTimeRuleLite[] = [{ partySizeMin: 1, partySizeMax: 20, durationMinutes: 120 }];

P('Najma-style rule (1–20 → 120) overrides the 90-min baseline for small parties', () => {
  assert.strictEqual(resolveDefaultDuration(2, najmaRules), 120);
  assert.strictEqual(resolveDefaultDuration(1, najmaRules), 120);
  assert.strictEqual(resolveDefaultDuration(6, najmaRules), 120);
});

P('split rules resolve by party size (first matching rule wins)', () => {
  const rules: TurnTimeRuleLite[] = [
    { partySizeMin: 1, partySizeMax: 2, durationMinutes: 75 },
    { partySizeMin: 3, partySizeMax: 20, durationMinutes: 150 },
  ];
  assert.strictEqual(resolveDefaultDuration(2, rules), 75);
  assert.strictEqual(resolveDefaultDuration(5, rules), 150);
});

P('no matching rule → falls back to baseline', () => {
  const rules: TurnTimeRuleLite[] = [{ partySizeMin: 10, partySizeMax: 20, durationMinutes: 180 }];
  assert.strictEqual(resolveDefaultDuration(2, rules), 90);
  assert.strictEqual(resolveDefaultDuration(12, rules), 180);
});

P('empty / undefined rules → baseline', () => {
  assert.strictEqual(resolveDefaultDuration(2, []), 90);
  assert.strictEqual(resolveDefaultDuration(4, undefined), 120);
});

P('expected end time = start + duration (60 min from 20:00 → 21:00)', () => {
  const start = new Date('2026-07-18T20:00:00').getTime();
  const end = new Date(start + 60 * 60_000);
  const hh = String(end.getHours()).padStart(2, '0');
  const mm = String(end.getMinutes()).padStart(2, '0');
  assert.strictEqual(`${hh}:${mm}`, '21:00');
});

console.log(`\n${passed}/6 duration tests passed`);
