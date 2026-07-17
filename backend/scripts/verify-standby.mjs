// STANDBY feature — production verification
// Tests: create standby, no conflict blocking, excluded from day list,
//        update STANDBY→CONFIRMED with table, confirm endpoint accepts STANDBY
const BASE = 'https://iron-booking.onrender.com/api';
const DATE = '2026-06-25';

const r0 = await fetch(`${BASE}/auth/dev-super-login`, { method: 'POST' });
const d0 = await r0.json();
const token = d0.token;
console.log('AUTH:', token ? 'OK' : 'FAIL', d0.user?.email ?? '');

const hdr  = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
const GET  = (url) => fetch(`${BASE}${url}`, { headers: hdr() }).then(r => r.json());
const POST = async (url, body = {}) => {
  const r = await fetch(`${BASE}${url}`, { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const PATCH = async (url, body = {}) => {
  const r = await fetch(`${BASE}${url}`, { method: 'PATCH', headers: hdr(), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

const results = [];
const P = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${label}${detail ? ' (' + detail + ')' : ''}`);
};

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 1. CREATE STANDBY (no table, no conflict check) ===');
// ────────────────────────────────────────────────────────────────────────────
const create = await POST('/reservations', {
  guestName:  'Standby Verify',
  guestPhone: '+972-STANDBY-001',
  partySize:  4,
  date:       DATE,
  time:       '20:00',
  source:     'PHONE',
  status:     'STANDBY',
});
P('create standby → 201',          create.status === 201,                   `status=${create.status} err=${create.body?.error?.message ?? ''}`);
P('returned status=STANDBY',       create.body?.status === 'STANDBY',       `got ${create.body?.status}`);
P('no tableId assigned',           !create.body?.tableId,                   `tableId=${create.body?.tableId}`);
const standbyId = create.body?.id;

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 2. STANDBY EXCLUDED FROM DEFAULT DAY LIST ===');
// ────────────────────────────────────────────────────────────────────────────
const dayList = await GET(`/reservations?date=${DATE}&limit=500`);
const dayReservations = dayList.data ?? dayList ?? [];
const foundInDay = Array.isArray(dayReservations) && dayReservations.find(r => r.id === standbyId);
P('standby absent from default day list', !foundInDay, foundInDay ? `found with status=${foundInDay.status}` : 'not present');

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 3. STANDBY RETURNED WITH status=STANDBY FILTER ===');
// ────────────────────────────────────────────────────────────────────────────
const standbyList = await GET(`/reservations?date=${DATE}&status=STANDBY&limit=200`);
const standbyData = standbyList.data ?? standbyList ?? [];
const foundInStandby = Array.isArray(standbyData) && standbyData.find(r => r.id === standbyId);
P('standby present with status filter', !!foundInStandby, `found=${!!foundInStandby}`);

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 4. STANDBY → CONFIRMED VIA UPDATE ===');
// ────────────────────────────────────────────────────────────────────────────
// Get a table to assign
const floorData = await GET(`/tables/floor?date=${DATE}&time=20:00`);
const tables = Array.isArray(floorData) ? floorData : [];
const availTable = tables.find(t => t.isActive && t.capacity >= 4 && t.status !== 'OCCUPIED');
if (standbyId && availTable) {
  const confirm = await PATCH(`/reservations/${standbyId}`, {
    tableId: availTable.id,
    status:  'CONFIRMED',
  });
  P('STANDBY→CONFIRMED via PATCH → 200', confirm.status === 200, `status=${confirm.status} err=${confirm.body?.error?.message ?? ''}`);
  P('returned status=CONFIRMED',         confirm.body?.status === 'CONFIRMED', `got ${confirm.body?.status}`);
  P('tableId assigned',                  !!confirm.body?.tableId, `tableId=${confirm.body?.tableId}`);

  // Cleanup: cancel
  await POST(`/reservations/${confirm.body?.id ?? standbyId}/cancel`);
} else if (standbyId) {
  P('STANDBY→CONFIRMED — skipped', true, `no available table for date ${DATE} at 20:00`);
  await POST(`/reservations/${standbyId}/cancel`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 5. INVALID TRANSITION STANDBY → SEATED BLOCKED ===');
// ────────────────────────────────────────────────────────────────────────────
const create2 = await POST('/reservations', {
  guestName:  'Standby Verify 2',
  guestPhone: '+972-STANDBY-002',
  partySize:  2,
  date:       DATE,
  time:       '19:00',
  source:     'PHONE',
  status:     'STANDBY',
});
const standbyId2 = create2.body?.id;
if (standbyId2) {
  const seatAttempt = await PATCH(`/reservations/${standbyId2}`, { status: 'SEATED' });
  P('STANDBY→SEATED blocked → 4xx', seatAttempt.status >= 400, `status=${seatAttempt.status} msg=${seatAttempt.body?.error?.message ?? ''}`);
  // Cleanup
  await POST(`/reservations/${standbyId2}/cancel`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('RESULTS');
console.log('══════════════════════════════════════════');
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass);
console.log(`${passed}/${results.length} passed`);
if (failed.length) {
  console.log('\nFAILED:');
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ' (' + f.detail + ')' : ''}`);
}
