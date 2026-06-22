/**
 * Unit tests for consent logic — run with:
 *   npx ts-node --transpile-only src/lib/consentAudit.test.ts
 *
 * Tests the four consent rule cases and deriveAction helper.
 * No test framework or database required; all functions are pure.
 */

import assert from 'node:assert/strict';
import { deriveAction, ConsentAction } from './consentAudit';

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

// ── SMS eligibility rule (mirrors clubBirthdaySms.ts query filter) ────────────
// The actual gate is a Prisma `where: { smsConsent: true }` query.
// These tests verify the *policy* expressed in that condition.

function smsAllowed(smsConsent: boolean, _marketingConsent: boolean): boolean {
  // Policy: smsConsent=true is required; marketingConsent alone is NOT sufficient.
  return smsConsent === true;
}

console.log('\n── SMS consent policy ──────────────────────────────────────────\n');

test('smsConsent=false, marketingConsent=true → SMS BLOCKED', () => {
  assert.equal(smsAllowed(false, true), false);
});

test('smsConsent=true, marketingConsent=false → SMS ALLOWED', () => {
  assert.equal(smsAllowed(true, false), true);
});

test('smsConsent=true, marketingConsent=true → SMS ALLOWED', () => {
  assert.equal(smsAllowed(true, true), true);
});

test('smsConsent=false, marketingConsent=false → SMS BLOCKED', () => {
  assert.equal(smsAllowed(false, false), false);
});

// ── deriveAction helper ───────────────────────────────────────────────────────

console.log('\n── deriveAction ────────────────────────────────────────────────\n');

test('null old value → GRANTED (first-time consent)', () => {
  assert.equal(deriveAction(null, true), ConsentAction.GRANTED);
});

test('undefined old value → GRANTED (first-time consent)', () => {
  assert.equal(deriveAction(undefined, true), ConsentAction.GRANTED);
});

test('false → true → GRANTED', () => {
  assert.equal(deriveAction(false, true), ConsentAction.GRANTED);
});

test('true → false → REVOKED', () => {
  assert.equal(deriveAction(true, false), ConsentAction.REVOKED);
});

test('true → true → UPDATED (no change in value)', () => {
  assert.equal(deriveAction(true, true), ConsentAction.UPDATED);
});

test('false → false → UPDATED (no change in value)', () => {
  assert.equal(deriveAction(false, false), ConsentAction.UPDATED);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──────────────────────────\n`);
if (failed > 0) process.exit(1);
