/**
 * Combine/uncombine fix — verification against the dev DB using the REAL
 * exported service functions (no HTTP, no deploy).
 *
 * Scenario (from the bug report):
 *   Tables 43/44/45 each have a CONFIRMED reservation at 16:00 today.
 *   Current time is well before 16:00 → tables are physically free now.
 *
 * Asserts:
 *   A. combineReservationTables() ALLOWS the combine (future reservations don't block).
 *   B. The OLD path (validateTableAssignment) WOULD have blocked — proves root cause + bypass.
 *   C. A live SEATED party on a requested table BLOCKS the combine.
 *   D. A table with only a future CONFIRMED reservation is ALLOWED.
 *   E. Uncombine (combinedTableIds: []) is allowed.
 *
 * Creates its own throwaway rows and deletes them in a finally block.
 */
import { prisma } from '../src/lib/prisma';
import {
  combineReservationTables,
  validateTableAssignment,
} from '../src/modules/reservations/service';
import { ConflictError } from '../src/lib/errors';

const results: { label: string; pass: boolean; detail?: string }[] = [];
const P = (label: string, pass: boolean, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${label}${detail ? ' (' + detail + ')' : ''}`);
};

const SUFFIX = `_cmbverify_${Date.now()}`;
const createdTableIds: string[] = [];
const createdResIds: string[] = [];

async function mkTable(name: string, x: number) {
  const t = await prisma.table.create({
    data: {
      restaurantId: REST_ID,
      name: name + SUFFIX,
      minCovers: 2,
      maxCovers: 4,
      isActive: true,
      isCombinable: true,
      posX: x,
      posY: 100,
    },
    select: { id: true, name: true },
  });
  createdTableIds.push(t.id);
  return t;
}

async function mkRes(tableId: string, status: 'CONFIRMED' | 'SEATED', dateObj: Date) {
  const r = await prisma.reservation.create({
    data: {
      restaurantId: REST_ID,
      tableId,
      partySize: 2,
      date: dateObj,
      time: '16:00',
      duration: 120,
      status,
      source: 'PHONE',
      guestName: 'Combine Verify',
      ...(status === 'SEATED' ? { seatedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  createdResIds.push(r.id);
  return r;
}

let REST_ID = '';

async function main() {
  const restaurant = await prisma.restaurant.findFirst({
    select: { id: true, name: true, timezone: true, settings: true },
  });
  if (!restaurant) throw new Error('No restaurant in dev DB');
  REST_ID = restaurant.id;
  const tz = restaurant.timezone ?? 'UTC';
  const settings = (restaurant.settings as Record<string, unknown>) ?? {};
  const buffer = (settings.bufferBetweenTurnsMinutes as number) ?? 15;

  // "Today" in the restaurant timezone, stored as UTC-midnight Date (matches @db.Date semantics)
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const dateObj = new Date(todayStr + 'T00:00:00.000Z');
  const nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  console.log(`Restaurant: ${restaurant.name} | tz=${tz} | today=${todayStr} | now(local)=${nowLocal} | reservations @16:00`);
  console.log('(If now(local) >= 16:00 the "future reservation" premise no longer holds — re-run earlier in the day.)\n');

  const t43 = await mkTable('T43', 100);
  const t44 = await mkTable('T44', 200);
  const t45 = await mkTable('T45', 300);

  const resA = await mkRes(t43.id, 'CONFIRMED', dateObj); // the reservation we combine FROM
  await mkRes(t44.id, 'CONFIRMED', dateObj);              // t44's own future reservation
  await mkRes(t45.id, 'CONFIRMED', dateObj);              // t45's own future reservation

  // ── A. Combine allowed despite future reservations on 44/45 ──
  try {
    const updated = await combineReservationTables(REST_ID, resA.id, [t44.id, t45.id], 'Verify');
    const ok = JSON.stringify([...updated.combinedTableIds].sort()) === JSON.stringify([t44.id, t45.id].sort());
    P('A. combine ALLOWED despite future 16:00 reservations', ok, `combinedTableIds=${JSON.stringify(updated.combinedTableIds)}`);
  } catch (err) {
    P('A. combine ALLOWED despite future 16:00 reservations', false, `threw: ${(err as Error).message}`);
  }

  // ── B. Old validator WOULD have blocked (proves root cause + that we bypass it) ──
  try {
    await validateTableAssignment(REST_ID, t43.id, dateObj, '16:00', 120, buffer, 2, [resA.id], [t44.id, t45.id]);
    P('B. old validateTableAssignment WOULD block (sanity)', false, 'did not throw — expected a conflict');
  } catch (err) {
    P('B. old validateTableAssignment WOULD block (sanity)', err instanceof ConflictError, `threw: ${(err as Error).message}`);
  }

  // ── C. A live SEATED party on a requested table BLOCKS combine ──
  const tSeat = await mkTable('T46', 400);
  await mkRes(tSeat.id, 'SEATED', dateObj); // physically occupied right now
  try {
    await combineReservationTables(REST_ID, resA.id, [t44.id, t45.id, tSeat.id], 'Verify');
    P('C. SEATED occupant BLOCKS combine', false, 'did not throw — expected occupied conflict');
  } catch (err) {
    const isConflict = err instanceof ConflictError;
    P('C. SEATED occupant BLOCKS combine', isConflict, `threw: ${(err as Error).message}`);
  }

  // ── D. Table with only a future CONFIRMED reservation is ALLOWED ──
  try {
    const updated = await combineReservationTables(REST_ID, resA.id, [t44.id], 'Verify');
    const ok = JSON.stringify(updated.combinedTableIds) === JSON.stringify([t44.id]);
    P('D. future-CONFIRMED-only table ALLOWED', ok, `combinedTableIds=${JSON.stringify(updated.combinedTableIds)}`);
  } catch (err) {
    P('D. future-CONFIRMED-only table ALLOWED', false, `threw: ${(err as Error).message}`);
  }

  // ── E. Uncombine (clear) allowed ──
  try {
    const updated = await combineReservationTables(REST_ID, resA.id, [], 'Verify');
    P('E. uncombine (clear) ALLOWED', updated.combinedTableIds.length === 0, `combinedTableIds=${JSON.stringify(updated.combinedTableIds)}`);
  } catch (err) {
    P('E. uncombine (clear) ALLOWED', false, `threw: ${(err as Error).message}`);
  }
}

async function cleanup() {
  if (createdResIds.length) {
    await prisma.reservationActivity.deleteMany({ where: { reservationId: { in: createdResIds } } });
    await prisma.reservation.deleteMany({ where: { id: { in: createdResIds } } });
  }
  if (createdTableIds.length) {
    await prisma.table.deleteMany({ where: { id: { in: createdTableIds } } });
  }
}

main()
  .catch((e) => { console.error('SCRIPT ERROR:', e); })
  .finally(async () => {
    try { await cleanup(); console.log('\ncleanup: removed test rows'); }
    catch (e) { console.error('cleanup error:', (e as Error).message); }
    const passed = results.filter(r => r.pass).length;
    console.log('\n══════════════════════════════════════════');
    console.log(`${passed}/${results.length} passed`);
    const failed = results.filter(r => !r.pass);
    if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log(`  x ${f.label} ${f.detail ?? ''}`)); }
    await prisma.$disconnect();
    process.exit(failed.length ? 1 : 0);
  });
