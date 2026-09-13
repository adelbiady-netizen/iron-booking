/**
 * Unit tests for reservedAt.ts — run with:
 *   npx ts-node --transpile-only src/modules/reservations/reservedAt.test.ts
 *
 * Guards the bug where a visit's reserved_at was built from the date only
 * (midnight), dropping the reservation time — which pushed the visit out of the
 * POS incoming/daily windows so it never showed on the floor.
 */

import assert from 'node:assert/strict';
import { reservedAtIso } from './reservedAt';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e) { console.error(`  ✗  ${name}`); console.error(`     ${(e as Error).message}`); failed++; }
}

console.log('\nreservedAtIso');

test('combines a date-only Date (midnight) with the real time — time NOT dropped', () => {
  const out = reservedAtIso(new Date('2026-09-13T00:00:00.000Z'), '17:30');
  assert.equal(out, '2026-09-13T17:30:00.000Z');
});

test('accepts a string date', () => {
  assert.equal(reservedAtIso('2026-09-13', '09:05'), '2026-09-13T09:05:00.000Z');
});

test('never collapses a non-midnight reservation to midnight (the regression)', () => {
  const out = reservedAtIso(new Date('2026-09-13T00:00:00.000Z'), '20:00');
  assert.ok(!out.endsWith('T00:00:00.000Z'), `must keep the time, got ${out}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
