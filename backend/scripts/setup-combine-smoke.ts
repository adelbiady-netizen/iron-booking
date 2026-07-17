/**
 * Scenario setup for the combine UI smoke test (Eataliano Dalla Costa).
 * Idempotent: removes any prior smoke rows first, then recreates them.
 *
 * Creates throwaway tables with REAL uuid ids (the Eataliano seed uses friendly
 * ids like "t03" which fail the uuid() request schema — same as every other
 * reservation endpoint, so production uuid ids are unaffected):
 *
 *   Table 43: CONFIRMED @14:00  ← the reservation we combine FROM
 *   Table 44: CONFIRMED @16:00  ← future-only, must NOT block combine
 *   Table 45: CONFIRMED @16:00  ← future-only, must NOT block combine
 *   Table 46: SEATED now        ← live occupancy, MUST block combine
 *
 * Teardown: SMOKE_TEARDOWN=1 ts-node scripts/setup-combine-smoke.ts
 */
import { prisma } from '../src/lib/prisma';

const REST_ID = 'bcc5bac9-8218-4634-8bd5-2655d5932a84';
const TAG = 'SMOKE_COMBINE';
const TZ = 'Asia/Jerusalem';

async function teardown() {
  const rows = await prisma.reservation.findMany({ where: { restaurantId: REST_ID, hostNotes: TAG }, select: { id: true } });
  const ids = rows.map(r => r.id);
  if (ids.length) {
    await prisma.reservationActivity.deleteMany({ where: { reservationId: { in: ids } } });
    await prisma.reservation.deleteMany({ where: { id: { in: ids } } });
  }
  // smoke tables are tagged via the notes column
  await prisma.table.deleteMany({ where: { restaurantId: REST_ID, notes: TAG } });
  console.log(`teardown: removed ${ids.length} reservations + smoke tables`);
}

async function main() {
  await teardown();
  if (process.env.SMOKE_TEARDOWN) { await prisma.$disconnect(); return; }

  const mkTable = (name: string, x: number) =>
    prisma.table.create({
      data: {
        restaurantId: REST_ID, name, minCovers: 2, maxCovers: 4, isActive: true,
        isCombinable: true, posX: x, posY: 470, width: 90, height: 70, notes: TAG,
      },
      select: { id: true, name: true },
    });

  const t43 = await mkTable('43', 80);
  const t44 = await mkTable('44', 200);
  const t45 = await mkTable('45', 320);
  const t46 = await mkTable('46', 440);

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const dateObj = new Date(todayStr + 'T00:00:00.000Z');

  const mkRes = (tableId: string, time: string, status: 'CONFIRMED' | 'SEATED', name: string) =>
    prisma.reservation.create({
      data: {
        restaurantId: REST_ID, tableId, partySize: 2, date: dateObj, time, duration: 120,
        status, source: 'PHONE', guestName: name, hostNotes: TAG,
        ...(status === 'SEATED' ? { seatedAt: new Date() } : { confirmedAt: new Date() }),
      },
      select: { id: true, tableId: true, time: true, status: true },
    });

  const primary = await mkRes(t43.id, '14:00', 'CONFIRMED', 'Smoke Primary 14:00');
  const f1 = await mkRes(t44.id, '16:00', 'CONFIRMED', 'Smoke Future A 16:00');
  const f2 = await mkRes(t45.id, '16:00', 'CONFIRMED', 'Smoke Future B 16:00');
  const seated = await mkRes(t46.id, '13:30', 'SEATED', 'Smoke Seated NOW');

  console.log(`today=${todayStr}`);
  console.log('tables:', JSON.stringify({ t43, t44, t45, t46 }));
  console.log('reservations:', JSON.stringify({ primary, f1, f2, seated }, null, 1));
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
