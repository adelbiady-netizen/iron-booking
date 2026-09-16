/**
 * Unit tests for reservationMatch.ts — run with:
 *   npx ts-node --transpile-only src/modules/pos/reservationMatch.test.ts
 *
 * Guards the order↔reservation binding rules (BE Round #1, 2026-09-16):
 *  - localWallClock resolves a UTC instant to Israel local time, DST-aware.
 *  - pickReservationForOrder binds by time window (#3), not "first of the day",
 *    and returns null for a walk-in whose table's only booking is far off (#1),
 *    while still binding an early/order-before-seat arrival within the lead band.
 */

import assert from 'node:assert/strict';
import {
  localWallClock,
  pickReservationForOrder,
  pickBindablePosVisit,
  ResCandidate,
} from './reservationMatch';

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

console.log('\nlocalWallClock (Asia/Jerusalem)');

test('summer instant (DST, UTC+3) -> local minutes', () => {
  // 2026-09-16 is Israel Daylight Time (+3): 08:00Z == 11:00 local.
  const r = localWallClock(new Date('2026-09-16T08:00:00.000Z'));
  assert.equal(r.date, '2026-09-16');
  assert.equal(r.minutes, 11 * 60); // 660
});

test('winter instant (UTC+2) -> local minutes', () => {
  // 2026-01-15 is Israel Standard Time (+2): 08:00Z == 10:00 local.
  const r = localWallClock(new Date('2026-01-15T08:00:00.000Z'));
  assert.equal(r.date, '2026-01-15');
  assert.equal(r.minutes, 10 * 60); // 600
});

test('late-evening instant rolls to the correct LOCAL date', () => {
  // 22:30Z in summer (+3) == 01:30 local the NEXT day.
  const r = localWallClock(new Date('2026-09-16T22:30:00.000Z'));
  assert.equal(r.date, '2026-09-17');
  assert.equal(r.minutes, 90); // 01:30
});

console.log('\npickReservationForOrder');

const lunch: ResCandidate = { time: '12:00', duration: 120 }; // 720..840
const dinner: ResCandidate = { time: '20:00', duration: 120 }; // 1200..1320

test('#3 two same-day bookings: binds the one whose window contains now (dinner)', () => {
  assert.equal(pickReservationForOrder([lunch, dinner], 20 * 60 + 30), dinner); // 20:30
});

test('#3 two same-day bookings: binds the lunch when now is in the lunch window', () => {
  assert.equal(pickReservationForOrder([lunch, dinner], 12 * 60 + 30), lunch); // 12:30
});

test('#3 not first-of-the-day: order of candidates does not decide the match', () => {
  assert.equal(pickReservationForOrder([dinner, lunch], 12 * 60 + 15), lunch);
});

test('#1 walk-in: far-off single booking is NOT bound (null)', () => {
  // 14:00, only a 20:00 booking → outside window and lead band → null.
  assert.equal(pickReservationForOrder([dinner], 14 * 60), null);
});

test('#2 early seating / order-before-seat: within 30-min lead binds', () => {
  // 19:45, dinner 20:00 → within lead band → binds dinner.
  assert.equal(pickReservationForOrder([dinner], 19 * 60 + 45), dinner);
});

test('just before lead band does NOT bind (19:25 vs 20:00, lead 30)', () => {
  assert.equal(pickReservationForOrder([dinner], 19 * 60 + 25), null);
});

test('grace after end still binds (22:10 vs 20:00-22:00, grace 15)', () => {
  assert.equal(pickReservationForOrder([dinner], 22 * 60 + 10), dinner);
});

test('past grace does NOT bind (22:20 vs end 22:00 + 15)', () => {
  assert.equal(pickReservationForOrder([dinner], 22 * 60 + 20), null);
});

test('empty candidates -> null', () => {
  assert.equal(pickReservationForOrder([], 20 * 60), null);
});

test('overlapping windows: earliest-starting containing window wins', () => {
  const a: ResCandidate = { time: '19:30', duration: 120 }; // 1170..1290
  const b: ResCandidate = { time: '20:00', duration: 120 }; // 1200..1320
  // at 20:15 both contain; earliest start (19:30) wins deterministically.
  assert.equal(pickReservationForOrder([b, a], 20 * 60 + 15), a);
});

console.log('\npickBindablePosVisit (bind-on-seat)');

test('no open orders at the table -> null', () => {
  assert.equal(pickBindablePosVisit([]), null);
});

test('one open order -> that order', () => {
  const v = { visitId: 'o1', openedAt: '2026-09-16T09:00:00.000Z' };
  assert.equal(pickBindablePosVisit([v]), v);
});

test('several open orders -> the most recently opened', () => {
  const older = { visitId: 'old', openedAt: '2026-09-16T08:00:00.000Z' };
  const newer = { visitId: 'new', openedAt: '2026-09-16T09:30:00.000Z' };
  // pass in ascending order to prove it does not depend on input order
  assert.equal(pickBindablePosVisit([older, newer]), newer);
  assert.equal(pickBindablePosVisit([newer, older]), newer);
});

test('accepts Date objects too', () => {
  const a = { visitId: 'a', openedAt: new Date('2026-09-16T08:00:00.000Z') };
  const b = { visitId: 'b', openedAt: new Date('2026-09-16T10:00:00.000Z') };
  assert.equal(pickBindablePosVisit([a, b]), b);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
