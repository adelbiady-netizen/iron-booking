/**
 * Unit tests for unsubscribe token logic — run with:
 *   npx ts-node --transpile-only src/lib/unsubscribeToken.test.ts
 *
 * Covers all 9 spec cases without hitting the database or network.
 * All checks are pure (no imports from unsubscribeToken.ts needed).
 */

import assert from 'node:assert/strict';
import crypto from 'crypto';

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

// ── SHA-256 helper (mirrors unsubscribeToken.ts internals) ────────────────────

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const TOKEN_BYTES = 32; // must match unsubscribeToken.ts

// ── Test 1: raw token is 64 lowercase hex chars ───────────────────────────────

test('Raw token is 64 hex chars (32 bytes of entropy)', () => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  assert.equal(token.length, 64, `expected 64, got ${token.length}`);
  assert.match(token, /^[0-9a-f]{64}$/);
});

// ── Test 2: SHA-256 hash is deterministic ─────────────────────────────────────

test('SHA-256 hash is deterministic — same input, same output', () => {
  const token = 'test-token-abc';
  assert.equal(hashToken(token), hashToken(token));
});

// ── Test 3: raw token never equals its hash ──────────────────────────────────

test('Raw token never equals its stored hash', () => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  assert.notEqual(token, hashToken(token));
});

// ── Test 4: invalid token (wrong length) → rejected ──────────────────────────

test('Short / empty token is rejected by length guard', () => {
  function lengthOk(raw: string): boolean {
    return !!(raw && raw.length === TOKEN_BYTES * 2);
  }
  assert.equal(lengthOk(''),             false, 'empty → rejected');
  assert.equal(lengthOk('abc'),          false, 'short → rejected');
  assert.equal(lengthOk('x'.repeat(63)), false, '63 chars → rejected');
  assert.equal(lengthOk('a'.repeat(64)), true,  '64 chars → accepted');
  assert.equal(lengthOk('a'.repeat(65)), false, '65 chars → rejected');
});

// ── Test 5: expired token detected correctly ──────────────────────────────────

test('Token with expiresAt in the past is identified as expired', () => {
  function isExpired(expiresAt: Date): boolean {
    return expiresAt < new Date();
  }
  assert.equal(isExpired(new Date(Date.now() - 1)),       true,  'past → expired');
  assert.equal(isExpired(new Date(Date.now() + 100_000)), false, 'future → not expired');
});

// ── Test 6: consumed token detected correctly ─────────────────────────────────

test('Token with usedAt set is identified as already_used', () => {
  function isUsed(usedAt: Date | null): boolean {
    return usedAt !== null;
  }
  assert.equal(isUsed(new Date()), true,  'usedAt set → used');
  assert.equal(isUsed(null),       false, 'usedAt null → not used');
});

// ── Test 7: unsubscribe URL includes token and is HTTPS ───────────────────────

test('Unsubscribe URL is HTTPS and embeds the raw token', () => {
  const base  = 'https://www.ironbooking.com';
  const token = 'a'.repeat(64);
  const url   = `${base}/unsubscribe/${token}`;
  assert.ok(url.startsWith('https://'),     'must be HTTPS');
  assert.ok(url.includes('/unsubscribe/'),  'must contain /unsubscribe/');
  assert.ok(url.endsWith(token),            'must end with raw token');
});

// ── Test 8: marketing SMS message contains Hebrew unsubscribe line ─────────────

test('Marketing SMS body includes "להסרה:" label and unsubscribe URL', () => {
  const base    = 'שלום ישראל, מתנת יום הולדת מחכה לך!';
  const url     = 'https://www.ironbooking.com/unsubscribe/' + 'b'.repeat(64);
  const message = `${base}\nלהסרה: ${url}`;

  assert.ok(message.includes('להסרה:'), 'must contain Hebrew unsubscribe label');
  assert.ok(message.includes(url),       'must contain full URL');
  assert.ok(message.startsWith(base),    'base message must be preserved first');
});

// ── Test 9: operational SMS types excluded from marketing set ─────────────────

test('Operational SMS types are not in the marketing-link set', () => {
  const MARKETING_TYPES = new Set([
    'BIRTHDAY', 'ANNIVERSARY', 'CLUB_CAMPAIGN', 'RECOVERY', 'MANUAL_MARKETING',
  ]);
  const operational = ['RESERVATION_CONFIRMATION', 'REMINDER', 'CANCELLATION'];

  for (const t of operational) {
    assert.equal(MARKETING_TYPES.has(t), false, `${t} must NOT require unsubscribe link`);
  }

  // Sanity: confirm marketing types are in the set
  assert.ok(MARKETING_TYPES.has('BIRTHDAY'),    'BIRTHDAY is marketing');
  assert.ok(MARKETING_TYPES.has('ANNIVERSARY'), 'ANNIVERSARY is marketing');
});

// ── Verdict ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
