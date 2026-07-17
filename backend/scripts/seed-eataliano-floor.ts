/**
 * Seed realistic Eataliano Dalla Costa floor plan in local dev DB.
 * Run: npx ts-node --transpile-only scripts/seed-eataliano-floor.ts
 */
/* eslint-disable no-console */
import { prisma as db } from '../src/lib/prisma';

const RESTAURANT_ID = 'bcc5bac9-8218-4634-8bd5-2655d5932a84';

const SECTIONS = [
  { id: 'sec-main',    name: 'אולם ראשי', color: '#4B5F2A' },
  { id: 'sec-terrace', name: 'טרסה',      color: '#7A5C2E' },
  { id: 'sec-private', name: 'פרטי',      color: '#2E4A6B' },
];

const TABLES = [
  // Main hall
  { id: 't01', name: 'שולחן 1',   posX: 80,  posY: 80,  width: 90,  height: 70,  minCovers: 1, maxCovers: 2,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't02', name: 'שולחן 2',   posX: 200, posY: 80,  width: 90,  height: 70,  minCovers: 1, maxCovers: 2,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't03', name: 'שולחן 3',   posX: 320, posY: 80,  width: 90,  height: 70,  minCovers: 2, maxCovers: 4,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't04', name: 'שולחן 4',   posX: 80,  posY: 200, width: 110, height: 80,  minCovers: 2, maxCovers: 4,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't05', name: 'שולחן 5',   posX: 220, posY: 200, width: 110, height: 80,  minCovers: 2, maxCovers: 4,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't06', name: 'שולחן 6',   posX: 360, posY: 200, width: 90,  height: 80,  minCovers: 2, maxCovers: 4,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't07', name: 'שולחן 7',   posX: 80,  posY: 330, width: 130, height: 80,  minCovers: 4, maxCovers: 6,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  { id: 't08', name: 'שולחן 8',   posX: 240, posY: 330, width: 160, height: 80,  minCovers: 6, maxCovers: 8,  shape: 'RECTANGLE' as const, sectionId: 'sec-main' },
  // Terrace
  { id: 't09', name: 'טרסה 1',    posX: 560, posY: 80,  width: 80,  height: 80,  minCovers: 1, maxCovers: 2,  shape: 'ROUND' as const,     sectionId: 'sec-terrace' },
  { id: 't10', name: 'טרסה 2',    posX: 670, posY: 80,  width: 80,  height: 80,  minCovers: 1, maxCovers: 2,  shape: 'ROUND' as const,     sectionId: 'sec-terrace' },
  { id: 't11', name: 'טרסה 3',    posX: 555, posY: 200, width: 100, height: 100, minCovers: 2, maxCovers: 4,  shape: 'ROUND' as const,     sectionId: 'sec-terrace' },
  { id: 't12', name: 'טרסה 4',    posX: 675, posY: 200, width: 100, height: 100, minCovers: 2, maxCovers: 4,  shape: 'ROUND' as const,     sectionId: 'sec-terrace' },
  // Private room
  { id: 't13', name: 'VIP 1',     posX: 555, posY: 360, width: 140, height: 90,  minCovers: 4, maxCovers: 6,  shape: 'RECTANGLE' as const, sectionId: 'sec-private' },
  { id: 't14', name: 'VIP 2',     posX: 715, posY: 360, width: 140, height: 90,  minCovers: 4, maxCovers: 6,  shape: 'RECTANGLE' as const, sectionId: 'sec-private' },
  { id: 't15', name: 'VIP 3',     posX: 635, posY: 480, width: 180, height: 100, minCovers: 8, maxCovers: 12, shape: 'RECTANGLE' as const, sectionId: 'sec-private' },
];

async function main() {
  const restaurant = await db.restaurant.findUnique({ where: { id: RESTAURANT_ID }, select: { id: true, name: true } });
  if (!restaurant) { console.error('Restaurant not found:', RESTAURANT_ID); process.exit(1); }
  console.log('Restaurant:', restaurant.name);

  for (const sec of SECTIONS) {
    await db.section.upsert({
      where: { id: sec.id },
      create: { id: sec.id, name: sec.name, color: sec.color, restaurantId: RESTAURANT_ID },
      update: { name: sec.name, color: sec.color },
    });
  }
  console.log(`Upserted ${SECTIONS.length} sections`);

  for (const t of TABLES) {
    await db.table.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: t.name,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
        minCovers: t.minCovers,
        maxCovers: t.maxCovers,
        shape: t.shape,
        restaurantId: RESTAURANT_ID,
        sectionId: t.sectionId,
        isActive: true,
        isCombinable: false,
      },
      update: { name: t.name, posX: t.posX, posY: t.posY, width: t.width, height: t.height, sectionId: t.sectionId },
    });
  }
  console.log(`Upserted ${TABLES.length} tables`);

  // 3 reservations today with different states
  const TODAY = new Date('2026-06-23T00:00:00.000Z');
  const testRes = [
    { id: 'res-seed-1', guestName: "ג'ורג' רוסי",   guestPhone: '+972501111111', partySize: 2, time: '12:00', tableId: 't01', status: 'CONFIRMED' as const, isArrived: true,  duration: 90 },
    { id: 'res-seed-2', guestName: 'מריה ביאנקי',   guestPhone: '+972502222222', partySize: 4, time: '12:30', tableId: 't03', status: 'CONFIRMED' as const, isArrived: false, duration: 90 },
    { id: 'res-seed-3', guestName: 'לוקה פרארי',    guestPhone: '+972503333333', partySize: 6, time: '13:00', tableId: 't07', status: 'PENDING'   as const, isArrived: false, duration: 90 },
  ];

  for (const r of testRes) {
    const exists = await db.reservation.findUnique({ where: { id: r.id } });
    if (!exists) {
      await db.reservation.create({
        data: {
          id: r.id,
          guestName: r.guestName,
          guestPhone: r.guestPhone,
          partySize: r.partySize,
          date: TODAY,
          time: r.time,
          tableId: r.tableId,
          status: r.status,
          isArrived: r.isArrived,
          duration: r.duration,
          source: 'PHONE',
          restaurantId: RESTAURANT_ID,
        },
      });
    }
  }
  console.log(`Created test reservations`);
  console.log('Done!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
