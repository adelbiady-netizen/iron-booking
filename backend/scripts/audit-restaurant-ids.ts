/**
 * audit-restaurant-ids.ts
 *
 * Diagnostic script: identify both restaurants in the SSE tenant mismatch.
 *
 * Run with production DATABASE_URL:
 *   DATABASE_URL="postgresql://..." npx ts-node backend/scripts/audit-restaurant-ids.ts
 *
 * Or via Render shell:
 *   npx ts-node backend/scripts/audit-restaurant-ids.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EVENT_RESTAURANT_ID  = '25be8dc0-9d68-4811-b4c2-c4e0e0206baa'; // found via slug lookup
const SESSION_RESTAURANT_ID = '35f85f49-7d5a-4d9d-b9dc-b46914732e38'; // from logged-in JWT

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log(' SSE Tenant Mismatch Audit');
  console.log('══════════════════════════════════════════════════════\n');

  // 1. Look up both restaurants
  const [eventRest, sessionRest] = await Promise.all([
    prisma.restaurant.findUnique({
      where: { id: EVENT_RESTAURANT_ID },
      select: { id: true, name: true, slug: true, createdAt: true, isSystem: true },
    }),
    prisma.restaurant.findUnique({
      where: { id: SESSION_RESTAURANT_ID },
      select: { id: true, name: true, slug: true, createdAt: true, isSystem: true },
    }),
  ]);

  console.log('── Restaurant A (link webhook target) ───────────────');
  if (eventRest) {
    console.log('  id:        ', eventRest.id);
    console.log('  name:      ', eventRest.name);
    console.log('  slug:      ', eventRest.slug);
    console.log('  createdAt: ', eventRest.createdAt.toISOString());
    console.log('  isSystem:  ', eventRest.isSystem);
  } else {
    console.log('  *** NOT FOUND — ID does not exist in DB ***');
  }

  console.log('\n── Restaurant B (logged-in user session) ────────────');
  if (sessionRest) {
    console.log('  id:        ', sessionRest.id);
    console.log('  name:      ', sessionRest.name);
    console.log('  slug:      ', sessionRest.slug);
    console.log('  createdAt: ', sessionRest.createdAt.toISOString());
    console.log('  isSystem:  ', sessionRest.isSystem);
  } else {
    console.log('  *** NOT FOUND — ID does not exist in DB ***');
  }

  // 2. List ALL non-system restaurants so we can see if there are duplicates
  const allRestaurants = await prisma.restaurant.findMany({
    where:   { isSystem: false },
    select:  { id: true, name: true, slug: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\n── All non-system restaurants in DB ─────────────────');
  for (const r of allRestaurants) {
    const tag =
      r.id === EVENT_RESTAURANT_ID  ? ' ← LINK WEBHOOK TARGET' :
      r.id === SESSION_RESTAURANT_ID ? ' ← LOGGED-IN SESSION' : '';
    console.log(`  [${r.createdAt.toISOString().slice(0, 10)}]  ${r.slug.padEnd(40)} ${r.id}${tag}`);
  }

  // 3. Count users per relevant restaurant
  const [usersA, usersB] = await Promise.all([
    eventRest
      ? prisma.user.count({ where: { restaurantId: EVENT_RESTAURANT_ID } })
      : Promise.resolve(0),
    sessionRest
      ? prisma.user.count({ where: { restaurantId: SESSION_RESTAURANT_ID } })
      : Promise.resolve(0),
  ]);

  console.log('\n── User counts ──────────────────────────────────────');
  console.log('  Restaurant A (webhook target) users:', usersA);
  console.log('  Restaurant B (session) users:       ', usersB);

  // 4. Count reservations per relevant restaurant
  const [resA, resB] = await Promise.all([
    eventRest
      ? prisma.reservation.count({ where: { restaurantId: EVENT_RESTAURANT_ID } })
      : Promise.resolve(0),
    sessionRest
      ? prisma.reservation.count({ where: { restaurantId: SESSION_RESTAURANT_ID } })
      : Promise.resolve(0),
  ]);

  console.log('\n── Reservation counts ───────────────────────────────');
  console.log('  Restaurant A (webhook target) reservations:', resA);
  console.log('  Restaurant B (session) reservations:       ', resB);

  console.log('\n══════════════════════════════════════════════════════');
  console.log(' Diagnosis');
  console.log('══════════════════════════════════════════════════════\n');

  if (sessionRest && eventRest && sessionRest.slug !== eventRest.slug) {
    console.log('  ROOT CAUSE: Two separate restaurant rows exist.');
    console.log(`  Link group 201 maps to slug "${eventRest.slug}" (Restaurant A).`);
    console.log(`  Logged-in user belongs to slug "${sessionRest.slug}" (Restaurant B).`);
    console.log('');
    console.log('  FIX (code change — no data migration):');
    console.log(`    In backend/src/modules/integrations/link.router.ts,`);
    console.log(`    change LINK_GROUP_ROUTES['201'].restaurantSlug`);
    console.log(`    from: "${eventRest.slug}"`);
    console.log(`    to:   "${sessionRest.slug}"`);
    console.log('');
    console.log('  Canonical restaurant (Restaurant B) has:');
    console.log(`    ${usersB} user(s), ${resB} reservation(s)`);
  } else if (sessionRest && !eventRest) {
    console.log('  Restaurant A (webhook target) does NOT exist in DB.');
    console.log('  The slug lookup in link.router.ts resolved a phantom ID somehow.');
  } else if (sessionRest && eventRest && sessionRest.slug === eventRest.slug) {
    console.log('  Slugs match — the mismatch is not slug-based. Deeper investigation needed.');
  }

  console.log('');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
