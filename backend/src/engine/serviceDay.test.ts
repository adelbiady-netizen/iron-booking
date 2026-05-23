/**
 * Unit tests for serviceDay.ts — run with:
 *   npx ts-node --transpile-only src/engine/serviceDay.test.ts
 *
 * No test framework or database required; all functions are pure.
 */

import assert from 'node:assert/strict';
import { serviceAnchorDate, parseTimeOnServiceDay } from './serviceDay';
import { parseTimeOnDate } from './occupancy';

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

const ONE_DAY_MS = 86_400_000;
const MAY23 = new Date('2026-05-23T00:00:00.000Z'); // anchor: Saturday dinner
const MAY24 = new Date('2026-05-24T00:00:00.000Z'); // anchor: Sunday dinner
const CUTOFF = 6;                                    // service ends at 06:00

// ─── serviceAnchorDate ────────────────────────────────────────────────────────

console.log('\nserviceAnchorDate');

test('22:00 on May 23 belongs to the same service anchor (May 23)', () => {
  assert.equal(serviceAnchorDate('2026-05-23', '22:00', CUTOFF), '2026-05-23');
});

test('02:30 on May 24 with cutoff 6 belongs to previous service anchor (May 23)', () => {
  assert.equal(serviceAnchorDate('2026-05-24', '02:30', CUTOFF), '2026-05-23');
});

test('exactly at cutoff (06:00) is the start of the new service day, not the previous', () => {
  assert.equal(serviceAnchorDate('2026-05-24', '06:00', CUTOFF), '2026-05-24');
});

test('one minute before cutoff (05:59) belongs to the previous anchor date', () => {
  assert.equal(serviceAnchorDate('2026-05-24', '05:59', CUTOFF), '2026-05-23');
});

test('month boundary: 02:30 on May 1 → April 30 anchor', () => {
  assert.equal(serviceAnchorDate('2026-05-01', '02:30', CUTOFF), '2026-04-30');
});

test('year boundary: 02:30 on Jan 1 → Dec 31 of prior year', () => {
  assert.equal(serviceAnchorDate('2027-01-01', '02:30', CUTOFF), '2026-12-31');
});

test('cutoff null: 02:30 returns same calendar date (feature disabled)', () => {
  assert.equal(serviceAnchorDate('2026-05-24', '02:30', null), '2026-05-24');
});

test('cutoff null: 22:00 returns same calendar date (feature disabled)', () => {
  assert.equal(serviceAnchorDate('2026-05-23', '22:00', null), '2026-05-23');
});

// ─── parseTimeOnServiceDay ────────────────────────────────────────────────────

console.log('\nparseTimeOnServiceDay');

test('22:00 returns identical virtual time to parseTimeOnDate — no adjustment', () => {
  const result   = parseTimeOnServiceDay(MAY23, '22:00', CUTOFF);
  const expected = parseTimeOnDate(MAY23, '22:00');
  assert.equal(result.getTime(), expected.getTime());
});

test('02:30 sorts AFTER 22:00 within the same service-day anchor', () => {
  const postMidnight = parseTimeOnServiceDay(MAY23, '02:30', CUTOFF);
  const evening      = parseTimeOnServiceDay(MAY23, '22:00', CUTOFF);
  assert.ok(
    postMidnight.getTime() > evening.getTime(),
    `expected 02:30 service-day time (${postMidnight.toISOString()}) > 22:00 (${evening.toISOString()})`,
  );
});

test('02:30 service-day virtual time is exactly 24 h ahead of the naive parseTimeOnDate result', () => {
  const naive   = parseTimeOnDate(MAY23, '02:30');
  const shifted = parseTimeOnServiceDay(MAY23, '02:30', CUTOFF);
  assert.equal(shifted.getTime() - naive.getTime(), ONE_DAY_MS);
});

test('cutoff null: 02:30 returns identical result to parseTimeOnDate (no shift)', () => {
  const naive  = parseTimeOnDate(MAY24, '02:30');
  const result = parseTimeOnServiceDay(MAY24, '02:30', null);
  assert.equal(result.getTime(), naive.getTime());
});

test('cutoff null: 22:00 returns identical result to parseTimeOnDate (no shift)', () => {
  const naive  = parseTimeOnDate(MAY23, '22:00');
  const result = parseTimeOnServiceDay(MAY23, '22:00', null);
  assert.equal(result.getTime(), naive.getTime());
});

test('post-midnight virtual Date preserves hours/minutes (getHours=2, getMinutes=30)', () => {
  const result = parseTimeOnServiceDay(MAY23, '02:30', CUTOFF);
  assert.equal(result.getHours(), 2);
  assert.equal(result.getMinutes(), 30);
});

test('ordering within a service day: 22:00 < 23:00 < 01:00 < 02:30 < 03:00 < 05:59', () => {
  const times    = ['22:00', '23:00', '01:00', '02:30', '03:00', '05:59'];
  const virtuals = times.map(t => parseTimeOnServiceDay(MAY23, t, CUTOFF).getTime());
  for (let i = 0; i < virtuals.length - 1; i++) {
    assert.ok(
      virtuals[i] < virtuals[i + 1],
      `expected ${times[i]} < ${times[i + 1]} in service-day order`,
    );
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
