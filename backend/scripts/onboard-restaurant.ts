/**
 * One-time restaurant onboarding script.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/onboard-restaurant.ts
 *
 * Safe to re-run: exits cleanly if the slug already exists.
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';

dotenv.config();

const RESTAURANT = {
  slug:     'italiano-dalla-costa',
  name:     'Italiano Dalla Costa',
  timezone: 'Asia/Jerusalem',
  settings: {
    defaultTurnMinutes:       90,
    slotIntervalMinutes:      15,
    maxPartySize:             20,
    autoConfirm:              false,
    bufferBetweenTurnsMinutes: 0,
  },
};

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma  = new PrismaClient({ adapter, log: ['error'] });

  try {
    console.log('\n──────────────────────────────────────────────────────────');
    console.log('  Restaurant Onboarding');
    console.log(`  Slug : ${RESTAURANT.slug}`);
    console.log(`  Name : ${RESTAURANT.name}`);
    console.log('──────────────────────────────────────────────────────────\n');

    // Guard: abort if slug already exists
    const existing = await prisma.restaurant.findUnique({
      where:  { slug: RESTAURANT.slug },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    if (existing) {
      console.log('  Already exists — no changes made.');
      console.log(`  id        : ${existing.id}`);
      console.log(`  name      : ${existing.name}`);
      console.log(`  slug      : ${existing.slug}`);
      console.log(`  createdAt : ${existing.createdAt.toISOString()}\n`);
      return;
    }

    const restaurant = await prisma.restaurant.create({
      data: {
        slug:     RESTAURANT.slug,
        name:     RESTAURANT.name,
        timezone: RESTAURANT.timezone,
        settings: RESTAURANT.settings,
      },
    });

    console.log('  Created successfully.');
    console.log(`  id        : ${restaurant.id}`);
    console.log(`  name      : ${restaurant.name}`);
    console.log(`  slug      : ${restaurant.slug}`);
    console.log(`  timezone  : ${restaurant.timezone}`);
    console.log(`  createdAt : ${restaurant.createdAt.toISOString()}\n`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
