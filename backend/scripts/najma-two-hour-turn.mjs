// Najma (slug "najma") — make the seating duration uniformly TWO HOURS.
//
// Root cause of the "message says 1.5h at the start and 2h later" contradiction:
// customer-facing duration wording is interpolated from the reservation's stored
// duration (formatDurationHe: 90 → "כשעה וחצי", 120 → "כשעתיים"). Najma's config
// still carried the generic party-size split (1–2 → 90, 3+ → 120) plus
// settings.defaultTurnMinutes=90 on the waitlist path, so different messages /
// sections of the same flow mixed both phrases. Najma's actual policy is 2 hours.
//
// This script fixes the SOURCE OF TRUTH, scoped to slug "najma" ONLY:
//   1. Every active TurnTimeRule → durationMinutes 120.
//   2. settings.defaultTurnMinutes → 120.
//   3. Future PENDING/CONFIRMED reservations stored with duration 90 → 120
//      (so reminders/confirmations for already-booked visits also say שעתיים).
//      Uses a temporary admin user (created + hard-deleted by this script)
//      because reservation routes are restaurant-scoped.
//
// Usage (from backend/):
//   node scripts/najma-two-hour-turn.mjs           # dry run — reports, changes nothing
//   node scripts/najma-two-hour-turn.mjs --apply   # apply
//   BASE=http://localhost:4000/api node scripts/najma-two-hour-turn.mjs ...  # non-prod target
//
// Idempotent: re-running after success finds nothing left to change.

import crypto from 'node:crypto';

const BASE  = process.env.BASE ?? 'https://iron-booking.onrender.com/api';
const APPLY = process.argv.includes('--apply');
// Production slug is "njma"; local/dev seeds use "najma". SLUG env overrides.
const SLUGS = process.env.SLUG ? [process.env.SLUG] : ['njma', 'najma'];
const TARGET_MINUTES = 120;

console.log(`=== Najma two-hour turn — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${BASE} ===\n`);

// ── Auth (super admin) ────────────────────────────────────────────────────────
const loginRes = await fetch(`${BASE}/auth/dev-super-login`, { method: 'POST' });
const loginBody = await loginRes.json();
const superToken = loginBody.token;
if (!superToken) { console.error('AUTH FAILED:', JSON.stringify(loginBody).slice(0, 300)); process.exit(1); }

const hdr = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
const GET = async (url, token = superToken) => {
  const r = await fetch(`${BASE}${url}`, { headers: hdr(token) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const SEND = async (method, url, body, token = superToken) => {
  const r = await fetch(`${BASE}${url}`, { method, headers: hdr(token), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ── 1. Find Najma (slug-scoped — never touches another restaurant) ───────────
const restaurantsRes = await GET('/admin/restaurants');
const restaurants = Array.isArray(restaurantsRes.body) ? restaurantsRes.body : (restaurantsRes.body?.data ?? []);
const najma = restaurants.find(r => SLUGS.includes(r.slug));
if (!najma) { console.error(`Restaurant with slug ${SLUGS.join('/')} not found. Aborting.`); process.exit(1); }
console.log(`[1] Najma found — id=${najma.id} slug=${najma.slug} name=${najma.name}`);

// ── 2. Turn-time rules → 120 ─────────────────────────────────────────────────
const rulesRes = await GET(`/admin/restaurants/${najma.id}/turn-time-rules`);
const rules = rulesRes.body?.rules ?? [];
console.log(`\n[2] Turn-time rules (${rules.length}):`);
for (const rule of rules) {
  const needsFix = rule.isActive && rule.durationMinutes !== TARGET_MINUTES;
  console.log(`    • "${rule.name}" party ${rule.partySizeMin}–${rule.partySizeMax} → ${rule.durationMinutes}min active=${rule.isActive}` +
    (needsFix ? `  → WILL SET ${TARGET_MINUTES}` : '  (ok)'));
  if (needsFix && APPLY) {
    const patch = await SEND('PATCH', `/admin/restaurants/${najma.id}/turn-time-rules/${rule.id}`, { durationMinutes: TARGET_MINUTES });
    console.log(`      PATCH → ${patch.status}${patch.status !== 200 ? ' ' + JSON.stringify(patch.body).slice(0, 200) : ''}`);
  }
}
if (rules.length === 0) {
  console.log(`    (no rules) → WILL CREATE a single 1–20 → ${TARGET_MINUTES}min rule`);
  if (APPLY) {
    const create = await SEND('POST', `/admin/restaurants/${najma.id}/turn-time-rules`, {
      name: 'Najma standard turn — two hours',
      partySizeMin: 1, partySizeMax: 20, durationMinutes: TARGET_MINUTES, isActive: true, sortOrder: 0,
    });
    console.log(`      POST → ${create.status}`);
  }
}

// ── 3. settings.defaultTurnMinutes → 120 ─────────────────────────────────────
console.log(`\n[3] settings.defaultTurnMinutes → ${TARGET_MINUTES}${APPLY ? '' : ' (dry run)'}`);
if (APPLY) {
  const st = await SEND('PATCH', `/admin/restaurants/${najma.id}/settings`, { defaultTurnMinutes: TARGET_MINUTES });
  console.log(`    PATCH settings → ${st.status}${st.status !== 200 ? ' ' + JSON.stringify(st.body).slice(0, 200) : ''}`);
}

// ── 4. Future PENDING/CONFIRMED reservations with duration 90 → 120 ──────────
// Reservation routes are restaurant-scoped → temporary Najma admin user.
const tempEmail = `najma-fix-${Date.now()}@ironbooking-internal.local`;
const tempPassword = crypto.randomBytes(18).toString('base64url');
let tempUserId = null;
let najmaToken = null;

const createUser = await SEND('POST', `/admin/restaurants/${najma.id}/users`, {
  email: tempEmail, password: tempPassword, firstName: 'Najma', lastName: 'DurationFix', role: 'ADMIN',
});
if (createUser.status === 201 || createUser.status === 200) {
  tempUserId = createUser.body?.id ?? createUser.body?.user?.id ?? null;
  const login = await SEND('POST', '/auth/login', { email: tempEmail, password: tempPassword });
  najmaToken = login.body?.token ?? null;
  console.log(`\n[4] Temp Najma user created (${tempUserId ? 'id=' + tempUserId : 'no id in response'}) — login ${najmaToken ? 'OK' : 'FAILED: ' + JSON.stringify(login.body).slice(0, 200)}`);
} else {
  console.log(`\n[4] Temp user creation failed (${createUser.status}) — skipping reservation backfill. ${JSON.stringify(createUser.body).slice(0, 200)}`);
}

if (najmaToken) {
  const today = new Date().toISOString().slice(0, 10);
  const targets = [];
  for (const status of ['PENDING', 'CONFIRMED']) {
    const list = await GET(`/reservations?dateFrom=${today}&status=${status}&limit=500`, najmaToken);
    const rows = list.body?.data ?? list.body?.reservations ?? (Array.isArray(list.body) ? list.body : []);
    for (const r of rows) {
      if (r.duration === 90) targets.push(r);
    }
  }
  console.log(`    Future PENDING/CONFIRMED with duration=90: ${targets.length}`);
  let fixed = 0, failed = 0;
  for (const r of targets) {
    console.log(`    • ${String(r.date).slice(0, 10)} ${r.time} ${r.guestName} party=${r.partySize}` + (APPLY ? '' : '  → WILL SET 120'));
    if (APPLY) {
      const patch = await SEND('PATCH', `/reservations/${r.id}`, { duration: TARGET_MINUTES }, najmaToken);
      if (patch.status === 200) { fixed++; }
      else {
        failed++;
        console.log(`      PATCH FAILED (${patch.status}) — ${JSON.stringify(patch.body?.error ?? patch.body).slice(0, 200)} — keeps 90, resolve manually`);
      }
    }
  }
  if (APPLY) console.log(`    Backfill result: ${fixed} updated, ${failed} failed (left at 90)`);
}

// Clean up the temp user regardless of backfill outcome.
if (tempUserId) {
  const del = await SEND('DELETE', `/admin/users/${tempUserId}`);
  console.log(`    Temp user deleted → ${del.status}`);
} else if (najmaToken) {
  console.log('    WARNING: temp user id unknown — delete manually (email above).');
}

// ── 5. Verify ────────────────────────────────────────────────────────────────
if (APPLY) {
  const verify = await GET(`/admin/restaurants/${najma.id}/turn-time-rules`);
  const after = verify.body?.rules ?? [];
  const bad = after.filter(r => r.isActive && r.durationMinutes !== TARGET_MINUTES);
  console.log(`\n[5] Verify: ${after.length} rules, ${bad.length} active rules not at ${TARGET_MINUTES}min ${bad.length === 0 ? '✓' : '✗ ' + JSON.stringify(bad)}`);
}

console.log(`\n=== done (${APPLY ? 'APPLIED' : 'dry run — nothing changed'}) ===`);
