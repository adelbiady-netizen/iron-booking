/**
 * Online booking conflict-detection tests — run with:
 *   npx ts-node --transpile-only src/modules/public/booking.conflict.test.ts
 *
 * Verifies:
 *   1. Future-reservation conflict detection works for the online path
 *      (mirrors the inline check used by computePublicSlots and
 *       executeBookingTransaction without touching the database).
 *   2. ReserveSchema strips overrideConflicts — the field must never
 *      reach the transaction layer from an online request.
 *
 * Scenario under test:
 *   Table X has a confirmed reservation at 19:00.
 *   Online guest attempts to book 18:00 with duration = 120 min.
 *   The new turn runs 18:00 → 20:00 (+ 15-min buffer → effEnd 20:15).
 *   The 19:00 reservation starts at 19:00 which is inside [17:45, 20:15].
 *   Expected: conflict detected → slot/table unavailable, booking rejected.
 */

import assert from 'node:assert/strict';
import { reservationConflicts, parseTimeOnDate } from '../../engine/occupancy';
import { ReserveSchema } from './booking.router';

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

const DATE = new Date('2026-01-15T00:00:00.000Z'); // arbitrary future date
const BUFFER = 15;  // bufferBetweenTurnsMinutes default
const NEW_DURATION  = 120; // defaultTurnMinutes in the scenario
const NEW_SLOT_TIME = '18:00';

// Shorthand: does existing res conflict with the 18:00 / 120-min online slot?
function conflicts(existingTime: string, existingDuration: number): boolean {
  return reservationConflicts(
    { time: existingTime, duration: existingDuration },
    { date: DATE, time: NEW_SLOT_TIME, duration: NEW_DURATION },
    BUFFER,
  );
}

// ─── Core scenario: 18:00 slot (120 min) vs 19:00 existing ──────────────────
// New slot effInterval: [17:45, 20:15]
// Any reservation whose window overlaps [17:45, 20:15] must block the slot.

console.log('\n18:00 slot (120 min + 15 min buffer) vs 19:00 existing reservation');

test('existing 19:00 (90 min) conflicts — standard turn', () => {
  assert.equal(conflicts('19:00', 90), true);
});

test('existing 19:00 (120 min) conflicts — same duration as new slot', () => {
  assert.equal(conflicts('19:00', 120), true);
});

test('existing 19:00 (60 min) conflicts — shorter turn', () => {
  assert.equal(conflicts('19:00', 60), true);
});

test('existing 19:00 (30 min) conflicts — very short turn', () => {
  assert.equal(conflicts('19:00', 30), true);
});

test('existing 19:00 (1 min) conflicts — minimum conceivable duration', () => {
  assert.equal(conflicts('19:00', 1), true);
});

// ─── Buffer boundary cases ────────────────────────────────────────────────────

test('existing 17:45 (1 min) — starts exactly at effStart, IS a conflict', () => {
  // 17:45..17:46 overlaps [17:45, 20:15] because start is shared
  assert.equal(conflicts('17:45', 1), true);
});

test('existing 16:00 (105 min) — ends exactly at effStart (17:45) → no conflict', () => {
  // rEnd = 17:45; areIntervalsOverlapping exclusive end → false
  assert.equal(conflicts('16:00', 105), false);
});

test('existing 16:00 (106 min) — ends 1 min past effStart (17:46) → conflict', () => {
  // rEnd = 17:46 > 17:45 → overlap
  assert.equal(conflicts('16:00', 106), true);
});

// ─── Non-conflicting cases ────────────────────────────────────────────────────

console.log('\nnon-conflicting cases');

test('existing 20:15 (60 min) — starts exactly at effEnd, no conflict', () => {
  // areIntervalsOverlapping exclusive → false when intervals only touch
  assert.equal(conflicts('20:15', 60), false);
});

test('existing 20:16 (60 min) — starts after effEnd, no conflict', () => {
  assert.equal(conflicts('20:16', 60), false);
});

test('existing 21:00 (60 min) — well after new slot, no conflict', () => {
  assert.equal(conflicts('21:00', 60), false);
});

test('existing 14:00 (30 min) — ends long before effStart, no conflict', () => {
  assert.equal(conflicts('14:00', 30), false);
});

// ─── Symmetric check: availability → create both reject for same reason ───────

console.log('\nsymmetric check (same math in computePublicSlots and executeBookingTransaction)');

test('effInterval for 18:00 slot is [17:45, 20:15]', () => {
  const slotStart = parseTimeOnDate(DATE, '18:00');
  const slotEnd   = new Date(slotStart.getTime() + NEW_DURATION * 60_000);
  const effStart  = new Date(slotStart.getTime() - BUFFER * 60_000);
  const effEnd    = new Date(slotEnd.getTime()   + BUFFER * 60_000);
  assert.equal(effStart.getHours(), 17);
  assert.equal(effStart.getMinutes(), 45);
  assert.equal(effEnd.getHours(), 20);
  assert.equal(effEnd.getMinutes(), 15);
});

// ─── ReserveSchema: overrideConflicts must not pass through ──────────────────
// The schema uses z.object() which STRIPS unknown keys by default.
// overrideConflicts sent by a malicious/modified client is silently discarded
// before the body reaches executeBookingTransaction.

console.log('\nReserveSchema — overrideConflicts isolation');

const VALID_BODY = {
  date:       '2026-01-15',
  time:       '18:00',
  partySize:  2,
  guestName:  'Test Guest',
  guestPhone: '0500000000',
};

test('valid body parses without error', () => {
  const result = ReserveSchema.safeParse(VALID_BODY);
  assert.equal(result.success, true);
});

test('overrideConflicts is stripped from parsed output', () => {
  const result = ReserveSchema.safeParse({ ...VALID_BODY, overrideConflicts: true });
  assert.equal(result.success, true);
  assert.equal('overrideConflicts' in (result.data ?? {}), false);
});

test('tableId is stripped from parsed output (no table pre-selection by guests)', () => {
  const result = ReserveSchema.safeParse({ ...VALID_BODY, tableId: 'some-uuid' });
  assert.equal(result.success, true);
  assert.equal('tableId' in (result.data ?? {}), false);
});

test('partySize below 1 is rejected', () => {
  const result = ReserveSchema.safeParse({ ...VALID_BODY, partySize: 0 });
  assert.equal(result.success, false);
});

test('missing guestName is rejected', () => {
  const { guestName: _, ...body } = VALID_BODY;
  const result = ReserveSchema.safeParse(body);
  assert.equal(result.success, false);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
