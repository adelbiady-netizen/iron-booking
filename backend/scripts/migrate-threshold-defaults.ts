/**
 * Phase 0 — One-time migration: fix orphaned lateThresholdMinutes / noShowThresholdMinutes.
 *
 * Problem: these settings were seeded with wrong values (5 and 15) at restaurant creation
 * but never connected to any runtime code. The actual production behavior has always used
 * hardcoded 20 and 30. This script brings all existing DB records into sync with production.
 *
 * Safe to re-run — only updates rows that still carry the old orphaned values.
 *
 * Run: npx ts-node -P tsconfig.json scripts/migrate-threshold-defaults.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, settings: true },
  });

  let updated = 0;

  for (const r of restaurants) {
    const s = (r.settings ?? {}) as Record<string, unknown>;

    const needsLate   = typeof s.lateThresholdMinutes   !== 'number' || s.lateThresholdMinutes   !== 20;
    const needsNoShow = typeof s.noShowThresholdMinutes !== 'number' || s.noShowThresholdMinutes !== 30;

    if (!needsLate && !needsNoShow) continue;

    console.log(`[${r.name}] lateThreshold: ${s.lateThresholdMinutes ?? 'unset'} → 20 | noShowThreshold: ${s.noShowThresholdMinutes ?? 'unset'} → 30`);

    await prisma.restaurant.update({
      where: { id: r.id },
      data: {
        settings: {
          ...s,
          lateThresholdMinutes:   20,
          noShowThresholdMinutes: 30,
        },
      },
    });
    updated++;
  }

  console.log(`\nDone. Updated ${updated} of ${restaurants.length} restaurants.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
