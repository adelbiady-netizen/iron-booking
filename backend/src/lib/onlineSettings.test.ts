// Online-reservation settings reader — pure tests (no DB, no network).
// Run: npm run test:online-settings
//
// Guards the money-safety invariant behind the Host-app online-reservations
// toggle: a missing/legacy key must NEVER close online booking; only an
// explicit `false` does.

import assert from 'assert';
import { readOnlineReservationSettings, DEFAULT_MAX_ONLINE_PARTY } from './onlineSettings';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

// ── onlineReservationsEnabled default ────────────────────────────────────────
P('absent key → online reservations ENABLED (existing restaurants keep booking)', () => {
  assert.strictEqual(readOnlineReservationSettings({}).onlineReservationsEnabled, true);
});

P('null / undefined settings → ENABLED', () => {
  assert.strictEqual(readOnlineReservationSettings(null).onlineReservationsEnabled, true);
  assert.strictEqual(readOnlineReservationSettings(undefined).onlineReservationsEnabled, true);
});

P('unrelated keys present, no toggle key → ENABLED', () => {
  const s = { maxPartySize: 20, guestClubSignupEnabled: true };
  assert.strictEqual(readOnlineReservationSettings(s).onlineReservationsEnabled, true);
});

P('explicit false → DISABLED (the only way to close online booking)', () => {
  assert.strictEqual(readOnlineReservationSettings({ onlineReservationsEnabled: false }).onlineReservationsEnabled, false);
});

P('explicit true → ENABLED', () => {
  assert.strictEqual(readOnlineReservationSettings({ onlineReservationsEnabled: true }).onlineReservationsEnabled, true);
});

P('non-boolean garbage in the key → falls back to ENABLED (never accidentally closed)', () => {
  assert.strictEqual(readOnlineReservationSettings({ onlineReservationsEnabled: 'false' }).onlineReservationsEnabled, true);
  assert.strictEqual(readOnlineReservationSettings({ onlineReservationsEnabled: 0 }).onlineReservationsEnabled, true);
  assert.strictEqual(readOnlineReservationSettings({ onlineReservationsEnabled: null }).onlineReservationsEnabled, true);
});

// ── maxOnlinePartySize default ───────────────────────────────────────────────
P(`absent key → default max online party (${DEFAULT_MAX_ONLINE_PARTY})`, () => {
  assert.strictEqual(readOnlineReservationSettings({}).maxOnlinePartySize, DEFAULT_MAX_ONLINE_PARTY);
});

P('explicit numeric value is honoured', () => {
  assert.strictEqual(readOnlineReservationSettings({ maxOnlinePartySize: 8 }).maxOnlinePartySize, 8);
});

P('non-numeric garbage → default (never NaN into validation)', () => {
  assert.strictEqual(readOnlineReservationSettings({ maxOnlinePartySize: '8' }).maxOnlinePartySize, DEFAULT_MAX_ONLINE_PARTY);
});

console.log(`\n${passed}/9 online-settings tests passed`);
process.exit(0);
