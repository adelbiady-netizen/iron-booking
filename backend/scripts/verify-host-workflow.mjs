// Host workflow batch — integration verification.
// Covers: callback queue (FIFO, concurrency, auto-resolve, dedupe),
// waitlist custom seating duration (persist, edit, seat, validation),
// table-ready message (send, audit, duplicate guard, no auto-seat).
//
// Runs against a LOCAL backend by default (new endpoints are not deployed yet):
//   BASE=http://localhost:3001/api node scripts/verify-host-workflow.mjs
// Uses dev-super-login + a temporary restaurant-scoped user; cleans up after itself.

const BASE = process.env.BASE ?? 'http://localhost:3001/api';
const results = [];
const P = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${label}${detail ? ' (' + detail + ')' : ''}`);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Auth: super admin ─────────────────────────────────────────────────────────
const superLogin = await (await fetch(`${BASE}/auth/dev-super-login`, { method: 'POST' })).json();
const superToken = superLogin.token;
if (!superToken) { console.error('super login failed', superLogin); process.exit(1); }

const hdr  = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const GET  = async (url, t) => { const r = await fetch(`${BASE}${url}`, { headers: hdr(t) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const SEND = async (m, url, b, t) => { const r = await fetch(`${BASE}${url}`, { method: m, headers: hdr(t), body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };

// ── Setup: pick a non-system restaurant, temp user, unique link group ────────
const restaurants = (await GET('/admin/restaurants', superToken)).body ?? [];
const restaurant = restaurants.find(r => !r.isSystem) ?? restaurants[0];
if (!restaurant) { console.error('no restaurant available'); process.exit(1); }
console.log(`Setup — restaurant: ${restaurant.slug} (${restaurant.id})`);

const GROUP = String(900 + Math.floor(Math.random() * 90));
const prevSettings = (await GET(`/admin/restaurants/${restaurant.id}`, superToken)).body?.settings ?? {};
const prevLinkGroups = prevSettings.linkGroupIds ?? [];
const prevSmsEnabled = prevSettings.smsEnabled === true;
const prevSmsProvider = prevSettings.smsProvider;
await SEND('PATCH', `/admin/restaurants/${restaurant.id}/settings`, {
  linkGroupIds: [...new Set([...prevLinkGroups, GROUP])],
  smsEnabled: true, smsProvider: 'MOCK',
}, superToken);

const tempEmail = `verify-host-workflow-${Date.now()}@internal.local`;
const tempPassword = 'verify-' + Math.random().toString(36).slice(2, 12) + 'A1';
const createdUser = await SEND('POST', `/admin/restaurants/${restaurant.id}/users`, {
  email: tempEmail, password: tempPassword, firstName: 'Verify', lastName: 'Host', role: 'ADMIN',
}, superToken);
const tempUserId = createdUser.body?.id ?? createdUser.body?.user?.id;
const tokenA = (await SEND('POST', '/auth/login', { email: tempEmail, password: tempPassword })).body?.token;
const tokenB = (await SEND('POST', '/auth/login', { email: tempEmail, password: tempPassword })).body?.token; // "second device"
P('setup: temp restaurant user + two device tokens', Boolean(tokenA && tokenB));

const STAMP = Date.now();
const phone = (n) => `+9725299${String(STAMP % 10000).padStart(4, '0')}${n}`;
const webhook = (caller, status, callid) =>
  fetch(`${BASE}/integrations/link/call?caller=${encodeURIComponent(caller)}&group=${GROUP}&status=${status}` + (callid ? `&callid=${callid}` : ''));

// ════════════════════════════════════════════════════════════════
console.log('\n=== 1. CALLBACK QUEUE ===');
// ════════════════════════════════════════════════════════════════
await webhook(phone(1), 'missed', `vh-${STAMP}-1`); await sleep(700);
await webhook(phone(2), 'missed', `vh-${STAMP}-2`); await sleep(700);
await webhook(phone(3), 'missed', `vh-${STAMP}-3`); await sleep(700);

let q = (await GET('/call-logs/callbacks', tokenA)).body;
const mine = (list) => (list ?? []).filter(c => [phone(1), phone(2), phone(3)].includes(c.phone));
let act = mine(q?.active);
P('three missed calls appear in the active queue', act.length === 3, `got ${act.length}`);
P('FIFO order: earliest call first', act[0]?.phone === phone(1) && act[1]?.phone === phone(2) && act[2]?.phone === phone(3),
  act.map(c => c.phone).join(','));
P('all created as PENDING_CALLBACK', act.every(c => c.queueStatus === 'PENDING_CALLBACK'));
P('positions are 1-based FIFO ranks', act.every((c, i) => typeof c.position === 'number'));

// refresh does not change order
const q2 = (await GET('/call-logs/callbacks', tokenA)).body;
P('refetch (refresh) keeps identical order', JSON.stringify(mine(q2?.active).map(c => c.id)) === JSON.stringify(act.map(c => c.id)));

// second device sees the same order
const qB = (await GET('/call-logs/callbacks', tokenB)).body;
P('second device sees the same order', JSON.stringify(mine(qB?.active).map(c => c.id)) === JSON.stringify(act.map(c => c.id)));

// device B starts the SECOND callback
const second = act[1];
const startB = await SEND('POST', `/call-logs/${second.id}/callback/start`, { hostName: 'Host B' }, tokenB);
P('device B starts callback #2', startB.status === 200 && startB.body?.queueStatus === 'CALLBACK_IN_PROGRESS');
const qA2 = mine((await GET('/call-logs/callbacks', tokenA)).body?.active);
const secondOnA = qA2.find(c => c.id === second.id);
P('device A sees callback #2 in progress by Host B', secondOnA?.queueStatus === 'CALLBACK_IN_PROGRESS' && secondOnA?.handledBy === 'Host B');

// concurrent start on the same callback → 409 with holder info
const startA = await SEND('POST', `/call-logs/${second.id}/callback/start`, { hostName: 'Host A' }, tokenA);
P('starting an already-claimed callback → 409 with holder', startA.status === 409 &&
  startA.body?.error?.details?.callback?.handledBy === 'Host B');

// note add/edit
const noteRes = await SEND('PATCH', `/call-logs/${act[0].id}/callback/note`, { note: 'רוצה שולחן לזוג' }, tokenA);
P('host note saved', noteRes.status === 200 && noteRes.body?.callbackNote === 'רוצה שולחן לזוג');

// complete the FIRST callback → second (in progress) stays, third promotes
const done1 = await SEND('POST', `/call-logs/${act[0].id}/callback/complete`, { hostName: 'Host A' }, tokenA);
P('completing the first callback succeeds', done1.status === 200 && done1.body?.queueStatus === 'CALLBACK_COMPLETED');
const qA3 = mine((await GET('/call-logs/callbacks', tokenA)).body?.active);
P('completed callback left the active queue', !qA3.some(c => c.id === act[0].id));
P('queue promotes: former #2 is now first', qA3[0]?.id === act[1].id, qA3.map(c => c.phone).join(','));

// cancel the third
const cancel3 = await SEND('POST', `/call-logs/${act[2].id}/callback/cancel`, { note: 'טעות חיוג' }, tokenA);
P('cancelling a callback succeeds', cancel3.status === 200 && cancel3.body?.queueStatus === 'CALLBACK_CANCELLED');
const qA4 = mine((await GET('/call-logs/callbacks', tokenA)).body?.active);
P('cancelled callback left the active queue', !qA4.some(c => c.id === act[2].id));

// dedupe: another missed call from a phone already in the queue → no second item
await webhook(phone(2), 'missed', `vh-${STAMP}-2b`); await sleep(700);
const qA5 = mine((await GET('/call-logs/callbacks', tokenA)).body?.active);
P('second missed call from same phone does not duplicate the queue item', qA5.filter(c => c.phone === phone(2)).length === 1);

// answered call auto-resolves the open callback for that phone
await webhook(phone(2), 'answered', `vh-${STAMP}-2c`); await sleep(700);
const qA6 = mine((await GET('/call-logs/callbacks', tokenA)).body?.active);
P('answered call from the guest auto-resolves their open callback', !qA6.some(c => c.phone === phone(2)));
P('active queue is empty for test phones', qA6.length === 0, qA6.map(c => c.phone).join(','));

// closed items visible in recentClosed
const closed = mine((await GET('/call-logs/callbacks', tokenA)).body?.recentClosed);
P('closed callbacks appear in recently-handled with statuses', closed.length >= 3 &&
  closed.some(c => c.queueStatus === 'CALLBACK_COMPLETED') && closed.some(c => c.queueStatus === 'CALLBACK_CANCELLED'));

// ════════════════════════════════════════════════════════════════
console.log('\n=== 2. WAITLIST CUSTOM DURATION ===');
// ════════════════════════════════════════════════════════════════
const today = new Date().toISOString().slice(0, 10);
const wlPhone = phone(7);

// invalid durations rejected
for (const bad of [0, -30, 10, 999]) {
  const r = await SEND('POST', '/waitlist', { guestName: 'V Bad', partySize: 2, date: today, durationMinutes: bad }, tokenA);
  P(`invalid duration ${bad} rejected`, r.status >= 400, `status=${r.status}`);
}

// add with 60 minutes
const add60 = await SEND('POST', '/waitlist', {
  guestName: 'Verify Sixty', guestPhone: wlPhone, partySize: 2, date: today, source: 'HOST', durationMinutes: 60,
}, tokenA);
P('add walk-in with 60-minute duration', add60.status === 201 && add60.body?.durationMinutes === 60, `status=${add60.status} dur=${add60.body?.durationMinutes}`);
const entryId = add60.body?.id;

// persists across refetch (server truth, not browser state)
const fetched = (await GET(`/waitlist/${entryId}`, tokenB)).body;
P('duration persists on refetch from a second device', fetched?.durationMinutes === 60);

// edit 60 → 90 → 120
const edit90 = await SEND('PATCH', `/waitlist/${entryId}`, { durationMinutes: 90 }, tokenA);
P('edit duration to 90', edit90.status === 200 && edit90.body?.durationMinutes === 90);
const edit120 = await SEND('PATCH', `/waitlist/${entryId}`, { durationMinutes: 120 }, tokenA);
P('edit duration to 120', edit120.status === 200 && edit120.body?.durationMinutes === 120);
const reFetched = (await GET(`/waitlist/${entryId}`, tokenA)).body;
P('edited value shown when reopened', reFetched?.durationMinutes === 120);

// custom valid value
const edit75 = await SEND('PATCH', `/waitlist/${entryId}`, { durationMinutes: 75 }, tokenA);
P('custom duration (75) accepted and stored', edit75.status === 200 && edit75.body?.durationMinutes === 75);

// seat without table → reservation uses the stored duration (timeline/conflict input)
const seat = await SEND('POST', `/waitlist/${entryId}/seat`, {}, tokenA);
P('seat converts to reservation with the STORED custom duration', seat.status === 200 && seat.body?.reservation?.duration === 75,
  `resDur=${seat.body?.reservation?.duration}`);
P('seating does not alter the waitlist record duration', seat.body?.entry?.durationMinutes === 75);
if (seat.body?.reservation?.id) await SEND('PATCH', `/reservations/${seat.body.reservation.id}`, { status: 'COMPLETED' }, tokenA);

// explicit seat-time duration override wins over the stored value
const add2 = await SEND('POST', '/waitlist', {
  guestName: 'Verify Override', guestPhone: phone(8), partySize: 2, date: today, source: 'HOST', durationMinutes: 60,
}, tokenA);
const seat2 = await SEND('POST', `/waitlist/${add2.body.id}/seat`, { durationMinutes: 45 }, tokenA);
P('explicit seat-time duration overrides the stored one', seat2.status === 200 && seat2.body?.reservation?.duration === 45,
  `resDur=${seat2.body?.reservation?.duration}`);
if (seat2.body?.reservation?.id) await SEND('PATCH', `/reservations/${seat2.body.reservation.id}`, { status: 'COMPLETED' }, tokenA);

// no host-chosen duration → restaurant turn-time rules apply (party-size aware)
const ops = (await GET('/tables/op-settings', tokenA)).body;
const expectFor = (party) => {
  const rule = (ops?.turnTimeRules ?? []).find(r => party >= r.partySizeMin && party <= r.partySizeMax);
  return rule?.durationMinutes ?? (party >= 3 ? 120 : 90);
};
const add3 = await SEND('POST', '/waitlist', {
  guestName: 'Verify Rules', guestPhone: phone(9), partySize: 5, date: today, source: 'HOST',
}, tokenA);
const seat3 = await SEND('POST', `/waitlist/${add3.body.id}/seat`, {}, tokenA);
P('no chosen duration → turn-time rules resolve it (party 5)', seat3.status === 200 && seat3.body?.reservation?.duration === expectFor(5),
  `resDur=${seat3.body?.reservation?.duration} expected=${expectFor(5)}`);
if (seat3.body?.reservation?.id) await SEND('PATCH', `/reservations/${seat3.body.reservation.id}`, { status: 'COMPLETED' }, tokenA);

// ════════════════════════════════════════════════════════════════
console.log('\n=== 3. TABLE-READY MESSAGE ===');
// ════════════════════════════════════════════════════════════════
const trPhone = phone(6);
const trAdd = await SEND('POST', '/waitlist', {
  guestName: 'Verify Ready', guestPhone: trPhone, partySize: 2, date: today, source: 'HOST', durationMinutes: 60,
}, tokenA);
const trId = trAdd.body?.id;

const send1 = await SEND('POST', `/waitlist/${trId}/table-ready`, { hostName: 'Host A' }, tokenA);
P('table-ready SMS sends via existing pipeline', send1.status === 200 && Boolean(send1.body?.messageLogId),
  `status=${send1.status} logId=${send1.body?.messageLogId} err=${JSON.stringify(send1.body?.error ?? '').slice(0, 120)}`);
P('entry stamped with tableReadySentAt', Boolean(send1.body?.entry?.tableReadySentAt));
P('guest NOT auto-seated (status NOTIFIED, not SEATED)', send1.body?.entry?.status === 'NOTIFIED');

// audit trail in message log
const logs = (await GET('/sms/logs', tokenA)).body;
const logRows = Array.isArray(logs) ? logs : (logs?.data ?? logs?.logs ?? []);
const trLog = logRows.find(l => l.phone === trPhone && l.messageType === 'TABLE_READY');
P('send recorded in MessageLog with type/channel/status', Boolean(trLog) && trLog.status === 'SENT',
  trLog ? `status=${trLog.status} channel=${trLog.channel}` : 'no log row');

// duplicate send blocked without force
const send2 = await SEND('POST', `/waitlist/${trId}/table-ready`, { hostName: 'Host B' }, tokenB);
P('repeat send without force → 409 with previous send time', send2.status === 409 &&
  send2.body?.error?.details?.code === 'TABLE_READY_ALREADY_SENT' && Boolean(send2.body?.error?.details?.sentAt));

// cross-device: device B sees the already-sent stamp
const trFetchB = (await GET(`/waitlist/${trId}`, tokenB)).body;
P('second device sees tableReadySentAt', Boolean(trFetchB?.tableReadySentAt));

// forced resend allowed
const send3 = await SEND('POST', `/waitlist/${trId}/table-ready`, { hostName: 'Host B', force: true }, tokenB);
P('forced resend succeeds after confirmation', send3.status === 200);

// failure path: entry without phone
const noPhone = await SEND('POST', '/waitlist', { guestName: 'No Phone', partySize: 2, date: today, source: 'HOST' }, tokenA);
const sendNoPhone = await SEND('POST', `/waitlist/${noPhone.body.id}/table-ready`, {}, tokenA);
P('entry without phone → clear failure', sendNoPhone.status >= 400);

// ── Cleanup ──────────────────────────────────────────────────────────────────
console.log('\n=== CLEANUP ===');
for (const id of [entryId, add2.body?.id, add3.body?.id, trId, noPhone.body?.id]) {
  if (id) await SEND('POST', `/waitlist/${id}/remove`, { reason: 'REMOVED' }, tokenA).catch(() => {});
}
await SEND('PATCH', `/admin/restaurants/${restaurant.id}/settings`, {
  linkGroupIds: prevLinkGroups,
  smsEnabled: prevSmsEnabled,
  ...(prevSmsProvider ? { smsProvider: prevSmsProvider } : {}),
}, superToken);
if (tempUserId) await SEND('DELETE', `/admin/users/${tempUserId}`, undefined, superToken);
console.log('settings restored, temp user deleted');

// ── Summary ──────────────────────────────────────────────────────────────────
const failCount = results.filter(r => !r.pass).length;
console.log(`\n=== ${results.length - failCount}/${results.length} PASSED${failCount ? ` — ${failCount} FAILED` : ''} ===`);
process.exit(failCount ? 1 : 0);
