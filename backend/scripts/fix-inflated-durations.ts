/**
 * One-time fix: update future reservations that were stored with inflated
 * 120-minute duration due to the since-removed defaultDurationForPartySize logic.
 *
 * Targets only: CONFIRMED or PENDING reservations on or after today whose
 * duration is exactly 120 and party size >= 3 (the auto-default signature).
 * Manually-set durations of 120 are indistinguishable, so this script prints
 * a preview and asks for confirmation before writing.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/fix-inflated-durations.ts
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/fix-inflated-durations.ts --write
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const adapter  = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma   = new PrismaClient({ adapter } as any);
const DRY_RUN  = !process.argv.includes('--write');
const TODAY    = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

async function main() {
  // Fetch all restaurants so we can use each one's defaultTurnMinutes
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, settings: true },
  });

  const restaurantSettings = new Map<string, number>();
  for (const r of restaurants) {
    const s = r.settings as Record<string, any>;
    restaurantSettings.set(r.id, (s.defaultTurnMinutes as number) ?? 90);
  }

  // Find affected reservations
  const affected = await prisma.reservation.findMany({
    where: {
      date: { gte: TODAY },
      duration: 120,
      partySize: { gte: 3 },
      status: { in: ['CONFIRMED', 'PENDING'] },
    },
    select: {
      id: true,
      restaurantId: true,
      guestName: true,
      date: true,
      time: true,
      partySize: true,
      duration: true,
      tableId: true,
    },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });

  if (affected.length === 0) {
    console.log('No affected reservations found. Nothing to update.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${affected.length} reservation(s) with inflated 120-min duration:\n`);
  for (const r of affected) {
    const newDuration = restaurantSettings.get(r.restaurantId) ?? 90;
    console.log(
      `  ${r.date.toISOString().slice(0, 10)} ${r.time}  ${r.guestName.padEnd(20)}  ` +
      `party=${r.partySize}  duration: 120 → ${newDuration}  table=${r.tableId ?? 'none'}  id=${r.id}`
    );
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written. Rerun with --write to apply.\n');
    await prisma.$disconnect();
    return;
  }

  console.log('\nApplying updates...');
  let updated = 0;
  for (const r of affected) {
    const newDuration = restaurantSettings.get(r.restaurantId) ?? 90;
    await prisma.reservation.update({
      where: { id: r.id },
      data: { duration: newDuration },
    });
    updated++;
  }
  console.log(`\nDone. Updated ${updated} reservation(s).\n`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
