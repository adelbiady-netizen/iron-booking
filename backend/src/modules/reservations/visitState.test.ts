/**
 * Unit tests for visitState.ts — run with:
 *   npx ts-node --transpile-only src/modules/reservations/visitState.test.ts
 */
import assert from 'node:assert/strict';
import { reservationVisitState, isFloorlessState } from './visitState';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e) { console.error(`  ✗  ${name}`); console.error(`     ${(e as Error).message}`); failed++; }
}

console.log('\nreservationVisitState');
test('terminal statuses map through', () => {
  assert.equal(reservationVisitState('SEATED', false), 'seated');
  assert.equal(reservationVisitState('COMPLETED', false), 'closed'); // ATLAS registry allows 'closed', not 'completed'
  assert.equal(reservationVisitState('CANCELLED', false), 'cancelled');
  assert.equal(reservationVisitState('NO_SHOW', false), 'no_show');
  assert.equal(reservationVisitState('STANDBY', false), 'standby');
});
test('pending/confirmed → expected, or arrived when marked present', () => {
  assert.equal(reservationVisitState('PENDING', false), 'expected');
  assert.equal(reservationVisitState('CONFIRMED', false), 'expected');
  assert.equal(reservationVisitState('CONFIRMED', true), 'arrived');
  assert.equal(reservationVisitState('PENDING', true), 'arrived');
});
test('a seated reservation stays seated even if arrival flag lingers', () => {
  assert.equal(reservationVisitState('SEATED', true), 'seated');
});

console.log('\nisFloorlessState');
test('standby is floorless; active/terminal states are not', () => {
  assert.equal(isFloorlessState('standby'), true);
  assert.equal(isFloorlessState('expected'), false);
  assert.equal(isFloorlessState('cancelled'), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
