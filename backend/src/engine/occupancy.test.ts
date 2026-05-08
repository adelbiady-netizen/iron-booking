/**
 * Unit tests for occupancy.ts — run with:
 *   npx ts-node --transpile-only src/engine/occupancy.test.ts
 *
 * No test framework or database required; all functions are pure.
 */

import assert from 'node:assert/strict';
import {
  reservationConflicts,
  reservationOverlapsSlotTime,
  reservationIsUpcoming,
  parseTimeOnDate,
  ACTIVE_STATUSES,
  RESERVED_SOON_MINUTES,
} from './occupancy';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(e as Error).message}`);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// UTC-midnight date (local calendar day 2026-05-09)
const D = new Date('2026-05-09T00:00:00.000Z');
const slot23 = parseTimeOnDate(D, '23:00');

// ─── parseTimeOnDate ──────────────────────────────────────────────────────────

console.log('\nparseTimeOnDate');

test('builds correct local Date from UTC-midnight date and time string', () => {
  const result = parseTimeOnDate(D, '14:30');
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 30);
  assert.equal(result.getSeconds(), 0);
});

test('time 00:00 on a UTC-midnight date lands on same calendar day', () => {
  const result = parseTimeOnDate(D, '00:00');
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 4); // May = 4 (0-indexed)
  assert.equal(result.getDate(), 9);
});

// ─── ACTIVE_STATUSES ──────────────────────────────────────────────────────────

console.log('\nACTIVE_STATUSES');

test('contains exactly PENDING, CONFIRMED, SEATED', () => {
  assert.deepEqual([...ACTIVE_STATUSES], ['PENDING', 'CONFIRMED', 'SEATED']);
});

// ─── reservationConflicts ─────────────────────────────────────────────────────

console.log('\nreservationConflicts');

// Slot: 23:00, duration 90 min (23:00–00:30), buffer 0 unless stated.

test('no overlap: res ends long before slot starts', () => {
  // res 14:30–16:00, slot 23:00–00:30
  assert.equal(
    reservationConflicts({ time: '14:30', duration: 90 }, { date: D, time: '23:00', duration: 90 }, 0),
    false,
  );
});

test('overlap: res spans slot start', () => {
  // res 22:30–00:00, slot 23:00–00:30
  assert.equal(
    reservationConflicts({ time: '22:30', duration: 90 }, { date: D, time: '23:00', duration: 90 }, 0),
    true,
  );
});

test('overlap: res fully contained within slot', () => {
  // res 23:10–23:50, slot 23:00–00:30
  assert.equal(
    reservationConflicts({ time: '23:10', duration: 40 }, { date: D, time: '23:00', duration: 90 }, 0),
    true,
  );
});

test('exact boundary (no buffer): res ends exactly at slot start → no conflict', () => {
  // res 21:00–23:00, slot 23:00–00:30; areIntervalsOverlapping uses exclusive end
  assert.equal(
    reservationConflicts({ time: '21:00', duration: 120 }, { date: D, time: '23:00', duration: 90 }, 0),
    false,
  );
});

test('buffer makes boundary a conflict: res ends at buffered-slot start', () => {
  // res 21:00–23:00 (ends at 23:00); buffer=15 → buffered slot starts at 22:45
  // areIntervalsOverlapping({22:45, 00:45}, {21:00, 23:00}) → 22:45 < 23:00 ✓
  assert.equal(
    reservationConflicts({ time: '21:00', duration: 120 }, { date: D, time: '23:00', duration: 90 }, 15),
    true,
  );
});

test('double-buffer fix: res ends exactly at buffered-slot-start → not a conflict', () => {
  // buffer=30; res 20:00–22:30, slot 23:00–00:30; buffered slot starts at 22:30.
  // Single-buffer (correct): areIntervalsOverlapping({22:30, 01:00}, {20:00, 22:30})
  //   → 22:30 < 22:30 is false → NOT a conflict.  ✓
  // Old double-buffer would extend res to 23:00:
  //   areIntervalsOverlapping({22:30, 01:00}, {20:00, 23:00}) → 22:30 < 23:00 → true (false positive).
  assert.equal(
    reservationConflicts({ time: '20:00', duration: 150 }, { date: D, time: '23:00', duration: 90 }, 30),
    false,
    'single-buffer: 30-min gap exactly equals buffer → no conflict',
  );
});

test('midnight crossing: slot at 23:30, res straddles midnight', () => {
  // res 23:00+90min = 00:30; slot 23:30+60min = 00:30; buffer=0
  assert.equal(
    reservationConflicts({ time: '23:00', duration: 90 }, { date: D, time: '23:30', duration: 60 }, 0),
    true,
  );
});

test('res starts after slot ends → no conflict', () => {
  // res 01:00, slot 23:00–00:30; res starts well after slot ends
  assert.equal(
    reservationConflicts({ time: '01:00', duration: 60 }, { date: D, time: '23:00', duration: 90 }, 0),
    false,
  );
});

// ─── reservationOverlapsSlotTime ──────────────────────────────────────────────

console.log('\nreservationOverlapsSlotTime');

test('PENDING: ends before slotTime → false', () => {
  // res 14:30+90=16:00; slotTime=23:00
  assert.equal(
    reservationOverlapsSlotTime({ time: '14:30', duration: 90, status: 'PENDING' }, D, slot23),
    false,
  );
});

test('PENDING: ends after slotTime → true', () => {
  // res 22:00+90=23:30; slotTime=23:00
  assert.equal(
    reservationOverlapsSlotTime({ time: '22:00', duration: 90, status: 'PENDING' }, D, slot23),
    true,
  );
});

test('CONFIRMED: ends after slotTime → true', () => {
  assert.equal(
    reservationOverlapsSlotTime({ time: '22:30', duration: 90, status: 'CONFIRMED' }, D, slot23),
    true,
  );
});

test('exact boundary: res ends exactly at slotTime → false (strictly greater than)', () => {
  // res 14:30+90=16:00; slotTime=16:00 → NOT overlapping (> is strict)
  const slot16 = parseTimeOnDate(D, '16:00');
  assert.equal(
    reservationOverlapsSlotTime({ time: '14:30', duration: 90, status: 'CONFIRMED' }, D, slot16),
    false,
  );
});

test('SEATED with seatedAt late: turn ends after slotTime → true', () => {
  // Booked 22:00, actually seated at 22:30; ends at 00:00; slotTime=23:00
  const seatedAt = parseTimeOnDate(D, '22:30');
  assert.equal(
    reservationOverlapsSlotTime({ time: '22:00', duration: 90, status: 'SEATED', seatedAt }, D, slot23),
    true,
  );
});

test('SEATED with early seatedAt: turn already ended → false', () => {
  // Seated 14:30+90=16:00; slotTime=23:00
  const seatedAt = parseTimeOnDate(D, '14:30');
  assert.equal(
    reservationOverlapsSlotTime({ time: '14:30', duration: 90, status: 'SEATED', seatedAt }, D, slot23),
    false,
  );
});

test('SEATED seatedAt=null: falls back to scheduled time field', () => {
  // time=22:30+90=00:00; slotTime=23:00 → true
  assert.equal(
    reservationOverlapsSlotTime({ time: '22:30', duration: 90, status: 'SEATED', seatedAt: null }, D, slot23),
    true,
  );
});

test('SEATED seatedAt=undefined: falls back to scheduled time field', () => {
  // time=14:30+90=16:00; slotTime=23:00 → false
  assert.equal(
    reservationOverlapsSlotTime({ time: '14:30', duration: 90, status: 'SEATED' }, D, slot23),
    false,
  );
});

// ─── reservationIsUpcoming ────────────────────────────────────────────────────

console.log('\nreservationIsUpcoming');

// Board time: 11:55

const slot1155 = parseTimeOnDate(D, '11:55');

test('RESERVED_SOON_MINUTES constant is 15', () => {
  assert.equal(RESERVED_SOON_MINUTES, 15);
});

test('reservation 335 min in the future (17:30 at 11:55) → false — not on floor map', () => {
  // The bug scenario: 17:30 res at board time 11:55
  assert.equal(
    reservationIsUpcoming({ time: '17:30', duration: 90 }, D, slot1155),
    false,
  );
});

test('reservation 35 min in the future (12:30 at 11:55) → false — beyond RESERVED_SOON window', () => {
  // The bug scenario: 12:30 res at board time 11:55
  assert.equal(
    reservationIsUpcoming({ time: '12:30', duration: 90 }, D, slot1155),
    false,
  );
});

test('reservation 15 min away (12:10 at 11:55) → true — exactly at RESERVED_SOON boundary', () => {
  assert.equal(
    reservationIsUpcoming({ time: '12:10', duration: 90 }, D, slot1155),
    true,
  );
});

test('reservation 14 min away (12:09 at 11:55) → true — within RESERVED_SOON window', () => {
  assert.equal(
    reservationIsUpcoming({ time: '12:09', duration: 90 }, D, slot1155),
    true,
  );
});

test('reservation 16 min away (12:11 at 11:55) → false — just outside window', () => {
  assert.equal(
    reservationIsUpcoming({ time: '12:11', duration: 90 }, D, slot1155),
    false,
  );
});

test('guest 5 min late (res at 11:50 at board time 11:55, turn not yet ended) → true', () => {
  // minutesUntil = -5 ≤ 15; resEnd = 11:50+90 = 13:20 > 11:55 → true
  assert.equal(
    reservationIsUpcoming({ time: '11:50', duration: 90 }, D, slot1155),
    true,
  );
});

test('guest 2 hours late, turn has ended (res at 09:00 dur 60min at 11:55) → false', () => {
  // minutesUntil = -175 ≤ 15 BUT resEnd = 10:00 < 11:55 → false
  assert.equal(
    reservationIsUpcoming({ time: '09:00', duration: 60 }, D, slot1155),
    false,
  );
});

test('reservation starting now (11:55 at 11:55) → true', () => {
  // minutesUntil = 0 ≤ 15; resEnd = 13:25 > 11:55 → true
  assert.equal(
    reservationIsUpcoming({ time: '11:55', duration: 90 }, D, slot1155),
    true,
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
