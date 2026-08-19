/**
 * Unit tests for waitlist ("STANDBY" list) SMS wording — run with:
 *   npx ts-node --transpile-only src/lib/waitlistSms.test.ts
 *
 * Regression guard for the bug where a guest placed on the waiting list
 * received the reservation-confirmation SMS ("השולחן שמור לכם" / "your table
 * is reserved") instead of a waitlist acknowledgment. A waitlist guest has
 * NO table held — the message must never claim one is reserved.
 *
 * All functions are pure; no framework or database required.
 */

import assert from 'node:assert/strict';
import { buildWaitlistJoinedText, buildReservationReceivedText } from './smsDefaults';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

const base = {
  guestName: 'דנה',
  restaurantName: 'איטליאנו',
  date: '2026-08-20',
  time: '20:00',
  partySize: 4,
};

console.log('\n── Waitlist SMS wording ───────────────────────\n');

test('HE: says the guest joined the waitlist', () => {
  const msg = buildWaitlistJoinedText({ ...base, lang: 'he' });
  assert.ok(msg.includes('רשימת ההמתנה'), `expected waitlist phrasing, got: ${msg}`);
});

test('HE: never claims a table is reserved/held', () => {
  const msg = buildWaitlistJoinedText({ ...base, lang: 'he' });
  assert.ok(!msg.includes('שמור'), `waitlist msg must not say the table is reserved: ${msg}`);
});

test('HE: sets the right expectation (we will contact you)', () => {
  const msg = buildWaitlistJoinedText({ ...base, lang: 'he' });
  assert.ok(msg.includes('ניצור') || msg.includes('נעדכן'), `expected a follow-up promise, got: ${msg}`);
});

test('EN: says the guest is on the waitlist and holds no table', () => {
  const msg = buildWaitlistJoinedText({ ...base, lang: 'en' });
  assert.ok(/waitlist/i.test(msg), `expected "waitlist", got: ${msg}`);
  assert.ok(!/reserved|held/i.test(msg), `waitlist msg must not claim a table: ${msg}`);
});

test('Contrast: reservation-received DOES reserve a table (unchanged)', () => {
  const msg = buildReservationReceivedText({ ...base, lang: 'he', duration: 90 });
  assert.ok(msg.includes('שמור'), `reservation-received should still say the table is held: ${msg}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
