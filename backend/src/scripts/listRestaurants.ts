/**
 * Internal diagnostic script — lists all non-system restaurants.
 * Read-only. Prints no credentials, tokens, or secrets.
 *
 * Run on Render Shell:
 *   node dist/scripts/listRestaurants.js
 */

import { prisma } from '../lib/prisma';

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    where:   { isSystem: false },
    orderBy: { name: 'asc' },
    select: {
      id:       true,
      name:     true,
      slug:     true,
      timezone: true,
      settings: true,
    },
  });

  if (restaurants.length === 0) {
    console.log('No restaurants found.');
    return;
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  RESTAURANTS (${restaurants.length})`);
  console.log('══════════════════════════════════════════════════════════════');

  for (const r of restaurants) {
    const s = (r.settings ?? {}) as Record<string, unknown>;
    console.log('');
    console.log(`  name              : ${r.name}`);
    console.log(`  id                : ${r.id}`);
    console.log(`  slug              : ${r.slug}`);
    console.log(`  timezone          : ${r.timezone ?? '(not set)'}`);
    console.log(`  smsEnabled        : ${s.smsEnabled ?? false}`);
    console.log(`  smsProvider       : ${s.smsProvider ?? 'MOCK'}`);
    console.log(`  reminderEnabled   : ${s.reminderEnabled ?? '(not set — defaults to enabled)'}`);
    console.log(`  reminderLeadMinutes: ${s.reminderLeadMinutes ?? '(not set — defaults to 60)'}`);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
}

main()
  .catch(err => {
    console.error('[listRestaurants] Fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
