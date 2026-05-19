/**
 * One-time fix: update future reservations stored with inflated 120-min duration
 * due to the since-removed defaultDurationForPartySize logic.
 *
 * FLAGS
 *   (none)                  Dry run — print affected rows, no writes
 *   --write                 Apply the duration updates to reservations
 *   --target-duration=N     Override the target duration (default: restaurant's
 *                           defaultTurnMinutes, or 90 if not set).
 *                           Use --target-duration=90 when the restaurant setting
 *                           itself is wrong and you want to force 90.
 *
 * USAGE
 *   # Preview with restaurant's configured defaultTurnMinutes as target
 *   npx ts-node --transpile-only scripts/fix-inflated-durations.ts
 *
 *   # Preview forcing 90-min target regardless of restaurant setting
 *   npx ts-node --transpile-only scripts/fix-inflated-durations.ts --target-duration=90
 *
 *   # Apply with forced 90-min target
 *   npx ts-node --transpile-only scripts/fix-inflated-durations.ts --target-duration=90 --write
 *
 * SAFETY
 *   Only touches: CONFIRMED or PENDING, date >= today, duration == 120, partySize >= 3
 *   Never touches: SEATED, COMPLETED, NO_SHOW, CANCELLED, past dates, partySize < 3,
 *                  duration != 120, or rows where current == target (no-op skipped)
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter } as any);

const DRY_RUN = !process.argv.includes('--write');
const TODAY   = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

// --target-duration=N override
const targetArg = process.argv.find(a => a.startsWith('--target-duration='));
const targetOverride = targetArg ? parseInt(targetArg.split('=')[1]!, 10) : null;

if (targetOverride !== null && (isNaN(targetOverride) || targetOverride < 30 || targetOverride > 360)) {
  console.error('--target-duration must be a number between 30 and 360');
  process.exit(1);
}

async function main() {
  // ── 1. Load all restaurants and their settings ──────────────────────────────
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, slug: true, settings: true },
  });

  type RestaurantInfo = { name: string; slug: string; configuredTurn: number; targetDuration: number };
  const restaurantMap = new Map<string, RestaurantInfo>();

  console.log('\n── Restaurant settings audit ───────────────────────────────────────');
  for (const r of restaurants) {
    const s = r.settings as Record<string, any>;
    const configuredTurn: number = (s.defaultTurnMinutes as number) ?? 90;
    const targetDuration: number = targetOverride ?? configuredTurn;
    restaurantMap.set(r.id, { name: r.name, slug: r.slug, configuredTurn, targetDuration });

    const flag = configuredTurn === 120
      ? '  ⚠️  defaultTurnMinutes=120 — this setting itself may need updating'
      : '';
    console.log(`  ${r.name} (${r.slug}): defaultTurnMinutes=${configuredTurn}${flag}`);
  }

  if (targetOverride !== null) {
    console.log(`\n  --target-duration override active: all matched rows → ${targetOverride} min`);
  }

  // ── 2. Find candidate reservations ──────────────────────────────────────────
  const candidates = await prisma.reservation.findMany({
    where: {
      date:      { gte: TODAY },
      duration:  120,
      partySize: { gte: 3 },
      status:    { in: ['CONFIRMED', 'PENDING'] },
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
      status: true,
    },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });

  // ── 3. Classify: will-change vs no-op ───────────────────────────────────────
  const willChange = candidates.filter(r => {
    const info = restaurantMap.get(r.restaurantId);
    return info ? info.targetDuration !== r.duration : false;
  });

  const noOp = candidates.filter(r => {
    const info = restaurantMap.get(r.restaurantId);
    return info ? info.targetDuration === r.duration : true;
  });

  // ── 4. Print results ─────────────────────────────────────────────────────────
  console.log('\n── Reservations that WILL change ───────────────────────────────────');
  if (willChange.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of willChange) {
      const info = restaurantMap.get(r.restaurantId)!;
      console.log(
        `  ${r.date.toISOString().slice(0, 10)}  ${r.time}` +
        `  ${r.guestName.padEnd(22)}` +
        `  party=${r.partySize}` +
        `  duration: ${r.duration} → ${info.targetDuration}` +
        `  table=${r.tableId ?? 'unassigned'}` +
        `  status=${r.status}` +
        `  id=${r.id}` +
        `  [${info.name}]`
      );
    }
  }

  console.log('\n── Reservations that are NO-OP (target == current, skipped) ────────');
  if (noOp.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of noOp) {
      const info = restaurantMap.get(r.restaurantId);
      const target = info?.targetDuration ?? '?';
      console.log(
        `  SKIP  ${r.date.toISOString().slice(0, 10)}  ${r.time}` +
        `  ${r.guestName.padEnd(22)}` +
        `  duration: ${r.duration} → ${target} (no change)` +
        `  id=${r.id}` +
        `  [${info?.name ?? 'unknown'}]`
      );
    }
    if (!targetOverride) {
      console.log('\n  ℹ️  These rows are no-ops because the restaurant\'s defaultTurnMinutes');
      console.log('     is also 120. To force them to 90, rerun with --target-duration=90');
    }
  }

  // ── 5. Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ─────────────────────────────────────────────────────────');
  console.log(`  Candidates found  : ${candidates.length}  (duration=120, partySize>=3, CONFIRMED/PENDING, date>=today)`);
  console.log(`  Will change       : ${willChange.length}`);
  console.log(`  Skipped (no-op)   : ${noOp.length}`);
  console.log(`  Historical/other  : not queried (SEATED/COMPLETED/NO_SHOW/CANCELLED excluded by design)`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written.');
    if (willChange.length > 0) {
      console.log('  Rerun with --write to apply the changes above.');
    }
    if (noOp.length > 0 && !targetOverride) {
      console.log('  Rerun with --target-duration=90 to fix no-op rows where restaurant setting is 120.');
    }
    console.log('');
    await prisma.$disconnect();
    return;
  }

  // ── 6. Apply ─────────────────────────────────────────────────────────────────
  if (willChange.length === 0) {
    console.log('\nNothing to update.\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying ${willChange.length} update(s)...`);
  for (const r of willChange) {
    const info = restaurantMap.get(r.restaurantId)!;
    await prisma.reservation.update({
      where: { id: r.id },
      data:  { duration: info.targetDuration },
    });
    console.log(`  ✓  ${r.id}  ${r.guestName}  ${r.duration} → ${info.targetDuration}`);
  }
  console.log(`\nDone. Updated ${willChange.length} reservation(s).\n`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
