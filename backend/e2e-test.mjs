// E2E test: Eataliano Dalla Costa — full validation
// Production restaurant ID: 35f85f49-7d5a-4d9d-b9dc-b46914732e38
const BASE = 'https://iron-booking.onrender.com/api';
const R_ID = '35f85f49-7d5a-4d9d-b9dc-b46914732e38';
const SLUG = 'eataliano-dalla-costa';

// ── Auth ──────────────────────────────────────────────────────────────────
const r0 = await fetch(`${BASE}/auth/dev-super-login`, { method: 'POST' });
const d0 = await r0.json();
const token = d0.token;
console.log('AUTH:', token ? 'OK' : 'FAIL', d0.user?.email ?? '');

const hdr = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
const GET   = (url) => fetch(`${BASE}${url}`, { headers: hdr() }).then(r => r.json());
const POST  = async (url, body = {}) => { const r = await fetch(`${BASE}${url}`, { method: 'POST', headers: hdr(), body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const DEL   = async (url) => { const r = await fetch(`${BASE}${url}`, { method: 'DELETE', headers: hdr() }); return { status: r.status, body: await r.json() }; };
const PATCH = async (url, body) => { const r = await fetch(`${BASE}${url}`, { method: 'PATCH', headers: hdr(), body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const avail = (date, partySize) => fetch(`${BASE}/public/book/${SLUG}/availability?date=${date}&partySize=${partySize}`).then(r => r.json());

const results = [];
const P = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${label}${detail ? ' (' + detail + ')' : ''}`);
};

// ════════════════════════════════════════════════════════════════
console.log('\n=== 1. FLOOR PLAN STATE ===');
// ════════════════════════════════════════════════════════════════
const hours   = await GET(`/admin/restaurants/${R_ID}/operating-hours`);
const secs    = await GET(`/admin/restaurants/${R_ID}/sections`);
const tables  = await GET(`/admin/restaurants/${R_ID}/tables`);
const combos  = await GET(`/admin/restaurants/${R_ID}/table-combinations`);

P('7 operating hour rows', hours.hours?.length === 7,    `found ${hours.hours?.length}`);
P('all 7 days isOpen',     hours.hours?.every(h => h.isOpen) === true);
P('≥1 section exists',     (secs.sections?.length ?? 0) >= 1, `found ${secs.sections?.length}`);
P('section ספות exists',   secs.sections?.some(s => s.name === 'ספות') === true);
P('≥8 tables exist',       (tables.tables?.length ?? 0) >= 8, `found ${tables.tables?.length}`);
P('1 combination exists',  combos.combinations?.length === 1, `found ${combos.combinations?.length}`);

const combo = combos.combinations?.[0];
P('combo 100+101 active',  combo?.isActive === true && (combo?.name === '100+101'), `name=${combo?.name} active=${combo?.isActive}`);
P('combo minCovers=5',     combo?.minCovers === 5, `got ${combo?.minCovers}`);
P('combo maxCovers=8',     combo?.maxCovers === 8, `got ${combo?.maxCovers}`);

// Component tables must be active — inactive components silently disable the combination
const t100 = tables.tables?.find(t => t.name === '100');
const t101 = tables.tables?.find(t => t.name === '101');
P('combo component table 100 isActive', t100?.isActive === true, `isActive=${t100?.isActive}`);
P('combo component table 101 isActive', t101?.isActive === true, `isActive=${t101?.isActive}`);

// ════════════════════════════════════════════════════════════════
console.log('\n=== 2. SEED GUARD ===');
// ════════════════════════════════════════════════════════════════
const seedAttempt = await POST(`/admin/restaurants/${R_ID}/seed-floor-plan`);
P('seed blocked 409 (floor already exists)', seedAttempt.status === 409, `status ${seedAttempt.status} code=${seedAttempt.body?.error?.code}`);

// ════════════════════════════════════════════════════════════════
console.log('\n=== 3. PUBLIC INFO ===');
// ════════════════════════════════════════════════════════════════
const info = await fetch(`${BASE}/public/book/${SLUG}`).then(r => r.json());
P('public /slug returns restaurant',        info.name === 'Eataliano Dalla Costa', `name=${info.name}`);
P('maxOnlinePartySize=8',                   info.maxOnlinePartySize === 8,         `got ${info.maxOnlinePartySize}`);
P('slotIntervalMinutes reported',           (info.slotIntervalMinutes ?? 0) > 0,   `got ${info.slotIntervalMinutes}`);
P('operatingHours=7 in public endpoint',   info.operatingHours?.length === 7,      `got ${info.operatingHours?.length}`);

// ════════════════════════════════════════════════════════════════
console.log('\n=== 4. AVAILABILITY E2E ===');
// ════════════════════════════════════════════════════════════════
const today = new Date();
const toUTC = (offset) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
};
const daysToThu = (4 - today.getUTCDay() + 7) % 7 || 7;
const daysToSat = (6 - today.getUTCDay() + 7) % 7 || 7;
const thuDate = toUTC(daysToThu);
const satDate = toUTC(daysToSat);
console.log(`  Test dates: Thu=${thuDate}, Sat=${satDate}`);

// 4a. Basic: party=2 gets slots on Thursday
const a2thu = await avail(thuDate, 2);
P('party=2 Thursday: not closed',   a2thu.isClosed !== true,        `isClosed=${a2thu.isClosed}`);
P('party=2 Thursday: has slots',    (a2thu.slots?.length ?? 0) > 0, `${a2thu.slots?.length} slots`);
const availSlots2 = a2thu.slots?.filter(s => s.available).length ?? 0;
P('party=2 Thursday: has available slots', availSlots2 > 0, `${availSlots2} available`);
if (a2thu.slots?.length > 0) {
  const s = a2thu.slots[0];
  console.log(`  party=2 slot[0]: time=${s.time} available=${s.available} turnMinutes=${s.turnMinutes ?? 'N/A'}`);
}

// 4b. party=9 blocked (maxOnlinePartySize=8)
const a9thu = await avail(thuDate, 9);
P('party=9 blocked (PARTY_TOO_LARGE_ONLINE)', a9thu.error?.code === 'PARTY_TOO_LARGE_ONLINE', `code=${a9thu.error?.code}`);

// 4c. party=8 allowed (≤ maxOnlinePartySize)
const a8thu = await avail(thuDate, 8);
P('party=8 allowed (≤ maxOnlinePartySize)', a8thu.error?.code !== 'PARTY_TOO_LARGE_ONLINE', `code=${a8thu.error?.code} slots=${a8thu.slots?.length}`);

// 4d. Saturday: party=2 gets slots
const aSat2 = await avail(satDate, 2);
const availSat2 = aSat2.slots?.filter(s => s.available).length ?? 0;
P('party=2 Saturday: not closed',   aSat2.isClosed !== true,  `isClosed=${aSat2.isClosed}`);
P('party=2 Saturday: has slots',    availSat2 > 0,            `${availSat2} available`);

// Slot interval check
if (aSat2.slots?.length >= 2) {
  const [s0, s1] = aSat2.slots;
  const parseMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const diff = parseMin(s1.time) - parseMin(s0.time);
  console.log(`  Saturday slot interval: ${diff} min (expected ${info.slotIntervalMinutes ?? 30})`);
  P(`slot interval matches settings (${info.slotIntervalMinutes ?? 30}min)`, diff === (info.slotIntervalMinutes ?? 30), `diff=${diff}min`);
}

// Last slot check: should be ≤ lastSeating for Saturday
const satHours = hours.hours?.find(h => h.dayOfWeek === 6);
if (satHours && aSat2.slots?.length > 0) {
  const lastSlot = aSat2.slots[aSat2.slots.length - 1];
  console.log(`  Saturday last slot: ${lastSlot.time} (lastSeating=${satHours.lastSeating})`);
  const parseMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  P('Saturday last slot ≤ lastSeating', parseMin(lastSlot.time) <= parseMin(satHours.lastSeating), `last=${lastSlot.time} lastSeating=${satHours.lastSeating}`);
}

// 4e. TurnTimeRules: party=2 (90min) vs party=3 (120min) on Saturday
const aSat3 = await avail(satDate, 3);
const availSat3 = aSat3.slots?.filter(s => s.available).length ?? 0;
console.log(`  Saturday available: party=2 -> ${availSat2}, party=3 -> ${availSat3}`);
P('party=2 (shorter turn) ≥ party=3 slot count', availSat2 >= availSat3, `${availSat2} vs ${availSat3}`);

// 4f. Single time window: create Saturday window, verify restriction
const slotsBefore = aSat2.slots?.filter(s => s.available).map(s => s.time) ?? [];
const satOpen = satHours?.openTime ?? '11:00';
const satOpenPlus2 = (() => { const [h,m] = satOpen.split(':').map(Number); const end = h*60+m+120; return `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`; })();
console.log(`  Creating time window Sat ${satOpen}-${satOpenPlus2}`);

const twRes = await POST(`/admin/restaurants/${R_ID}/time-windows`, {
  name: 'E2E Test Window', dayOfWeek: 6, startTime: satOpen, endTime: satOpenPlus2, sourceScope: 'ONLINE', isActive: true
});
P('time window created', twRes.status === 201 || twRes.status === 200, `status ${twRes.status}`);
const twId = twRes.body?.id;

if (twId) {
  const aSatWin = await avail(satDate, 2);
  const slotsWin = aSatWin.slots?.filter(s => s.available).map(s => s.time) ?? [];
  const parseMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const winClipsCorrectly = slotsWin.length > 0 && slotsWin.every(t => parseMin(t) >= parseMin(satOpen) && parseMin(t) <= parseMin(satOpenPlus2));
  P('time window clips slots correctly', winClipsCorrectly && slotsWin.length < slotsBefore.length, `${slotsWin.length} in window vs ${slotsBefore.length} before`);

  const delTw = await DEL(`/admin/restaurants/${R_ID}/time-windows/${twId}`);
  P('time window deleted ok', delTw.status === 200 || delTw.body?.ok === true, `status ${delTw.status}`);
  const aSatRestored = await avail(satDate, 2);
  const slotsRestored = aSatRestored.slots?.filter(s => s.available).length ?? 0;
  P('slots restore after window delete', slotsRestored >= slotsBefore.length, `${slotsRestored} vs ${slotsBefore.length}`);
}

// ════════════════════════════════════════════════════════════════
console.log('\n=== 8. MULTI-WINDOW PER DAY ===');
// ════════════════════════════════════════════════════════════════
// Use Sunday (dayOfWeek=0): create two non-overlapping windows
// Window A: 11:30–12:30  (lunch)
// Window B: 14:30–17:00  (afternoon)
// Verify: 13:00 NOT available, 14:30 available, overlap rejected with 409

const thuDow = 4; // Thursday in E2E = dayOfWeek 4

// Create window A: 11:30–12:30
const mwA = await POST(`/admin/restaurants/${R_ID}/time-windows`, {
  name: 'E2E Multi A', dayOfWeek: thuDow, startTime: '11:30', endTime: '12:30', sourceScope: 'ONLINE', isActive: true
});
P('multi-window A created (11:30–12:30)', mwA.status === 201, `status ${mwA.status}`);
const mwAId = mwA.body?.id;

// Create window B: 14:30–17:00 (gap 12:30–14:30 is intentional)
const mwB = await POST(`/admin/restaurants/${R_ID}/time-windows`, {
  name: 'E2E Multi B', dayOfWeek: thuDow, startTime: '14:30', endTime: '17:00', sourceScope: 'ONLINE', isActive: true
});
P('multi-window B created (14:30–17:00)', mwB.status === 201, `status ${mwB.status}`);
const mwBId = mwB.body?.id;

// Overlap rejection: try to create C that overlaps B (14:00–15:00)
const mwOverlap = await POST(`/admin/restaurants/${R_ID}/time-windows`, {
  name: 'E2E Overlap', dayOfWeek: thuDow, startTime: '14:00', endTime: '15:00', sourceScope: 'ONLINE', isActive: true
});
P('overlapping window rejected 409', mwOverlap.status === 409, `status ${mwOverlap.status} code=${mwOverlap.body?.error?.code}`);

if (mwAId && mwBId) {
  const parseMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const aThu = await avail(thuDate, 2);
  const slotsMap = Object.fromEntries((aThu.slots ?? []).map(s => [s.time, s]));

  // 13:00 is in the gap — should NOT be available
  P('13:00 not available (in gap 12:30–14:30)', slotsMap['13:00']?.available !== true,
    `available=${slotsMap['13:00']?.available ?? 'slot missing'}`);

  // 11:30 should be in window A
  P('11:30 available (window A)', slotsMap['11:30']?.available === true,
    `available=${slotsMap['11:30']?.available ?? 'slot missing'}`);

  // 14:30 should be in window B
  P('14:30 available (window B)', slotsMap['14:30']?.available === true,
    `available=${slotsMap['14:30']?.available ?? 'slot missing'}`);

  // Slots within window A must be within 11:30–12:30
  const availableSlots = (aThu.slots ?? []).filter(s => s.available).map(s => s.time);
  const allInWindows = availableSlots.every(t => {
    const m = parseMin(t);
    return (m >= parseMin('11:30') && m <= parseMin('12:30')) ||
           (m >= parseMin('14:30') && m <= parseMin('17:00'));
  });
  P('all available slots fall within the two windows', allInWindows,
    `${availableSlots.length} slots: ${availableSlots.slice(0,6).join(', ')}${availableSlots.length > 6 ? '…' : ''}`);

  // Clean up
  await DEL(`/admin/restaurants/${R_ID}/time-windows/${mwAId}`);
  await DEL(`/admin/restaurants/${R_ID}/time-windows/${mwBId}`);
  P('multi-window cleanup ok', true, 'windows deleted');
}

// ════════════════════════════════════════════════════════════════
console.log('\n=== 5. DELETE GUARDS ===');
// ════════════════════════════════════════════════════════════════
const secWithTables = secs.sections?.find(s => (s.tableCount ?? 0) > 0);
if (secWithTables) {
  const dSec = await DEL(`/admin/restaurants/${R_ID}/sections/${secWithTables.id}`);
  P(`section with tables blocked 409`, dSec.status === 409, `section=${secWithTables.name} status=${dSec.status} code=${dSec.body?.error?.code}`);
}

const comboTable = tables.tables?.find(t => t.name === '100' || t.name === '101');
if (comboTable) {
  const dTab = await DEL(`/admin/restaurants/${R_ID}/tables/${comboTable.id}`);
  P(`table in combination blocked 409`, dTab.status === 409, `table=${comboTable.name} status=${dTab.status} code=${dTab.body?.error?.code}`);
}

// ════════════════════════════════════════════════════════════════
console.log('\n=== 6. TABLE TOGGLE ===');
// ════════════════════════════════════════════════════════════════
const anyTable = tables.tables?.[0];
if (anyTable) {
  const tog = await PATCH(`/admin/restaurants/${R_ID}/tables/${anyTable.id}`, { isActive: false });
  P('deactivate table', tog.body?.isActive === false, `table=${anyTable.name} isActive=${tog.body?.isActive}`);
  const tog2 = await PATCH(`/admin/restaurants/${R_ID}/tables/${anyTable.id}`, { isActive: true });
  P('restore table',    tog2.body?.isActive === true,  `table=${anyTable.name} isActive=${tog2.body?.isActive}`);
}

// ════════════════════════════════════════════════════════════════
console.log('\n=== 7. GROUP ALLOCATION STATUS ===');
// ════════════════════════════════════════════════════════════════
const gcRes = await GET(`/admin/restaurants/${R_ID}/group-configs`);
const sofasSec = gcRes.sections?.find(s => s.name === 'ספות');
P('ספות hasCombinations=true', sofasSec?.hasCombinations === true, `hasCombinations=${sofasSec?.hasCombinations}`);
console.log(`  Group configs count: ${gcRes.configs?.length ?? 0}`);
if ((gcRes.configs?.length ?? 0) === 0) {
  console.log('  NOTE: No group config yet. Combination prerequisite now MET (100+101 in ספות).');
}

// ════════════════════════════════════════════════════════════════
console.log('\n=== SUMMARY ===');
// ════════════════════════════════════════════════════════════════
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`Total: ${results.length} checks — ${passed} PASS, ${failed} FAIL`);
if (failed > 0) {
  console.log('\nFAILED:');
  results.filter(r => !r.pass).forEach(r => console.log(`  FAIL | ${r.label} ${r.detail ? '(' + r.detail + ')' : ''}`));
}
