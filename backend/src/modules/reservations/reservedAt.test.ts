/**
 * Unit tests for reservedAt.ts — run with:
 *   npx ts-node --transpile-only src/modules/reservations/reservedAt.test.ts
 *
 * Guards two bugs:
 *  1. reserved_at built from the date only (midnight), dropping the reservation
 *     time — which pushed the visit out of the POS incoming/daily windows.
 *  2. the reservation's LOCAL wall-clock time being labelled 'Z' (UTC), so the
 *     POS rendered it shifted by the timezone offset (a 10:30 booking showed as
 *     13:30 in summer, UTC+3). reserved_at must be the correct UTC instant.
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

test('converts summer (DST, UTC+3) local wall-clock to the right UTC instant', () => {
  // 2026-09-13 is Israel Daylight Time (+3): 17:30 local == 14:30 UTC.
  assert.equal(reservedAtIso(new Date('2026-09-13T00:00:00.000Z'), '17:30'), '2026-09-13T14:30:00.000Z');
});

test('accepts a string date (DST +3)', () => {
  assert.equal(reservedAtIso('2026-09-13', '09:05'), '2026-09-13T06:05:00.000Z');
});

test('converts winter (standard, UTC+2) local wall-clock correctly (DST-aware)', () => {
  // 2026-01-15 is Israel Standard Time (+2): 10:30 local == 08:30 UTC.
  assert.equal(reservedAtIso('2026-01-15', '10:30'), '2026-01-15T08:30:00.000Z');
});

test('rolls the date back when the local time is before the UTC offset', () => {
  // 00:15 local (+3) is on the previous UTC day.
  assert.equal(reservedAtIso('2026-09-15', '00:15'), '2026-09-14T21:15:00.000Z');
});

test('never collapses a non-midnight reservation to midnight (original regression)', () => {
  const out = reservedAtIso(new Date('2026-09-13T00:00:00.000Z'), '20:00');
  assert.ok(!out.endsWith('T00:00:00.000Z'), `must keep the time, got ${out}`);
});

test('honours an explicit timezone argument', () => {
  // UTC zone: no shift.
  assert.equal(reservedAtIso('2026-09-13', '17:30', 'UTC'), '2026-09-13T17:30:00.000Z');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
