/**
 * List all production restaurants with their slugs and URL inventory.
 * Run against production DB:
 *   DATABASE_URL="<render_db_url>" npx tsx backend/scripts/list-restaurants.ts
 */
import { prisma } from '../src/lib/prisma';

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    where: { isSystem: false },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      primaryColor: true,
      createdAt: true,
      _count: { select: { users: true, reservations: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\n=== RESTAURANT SLUG INVENTORY ===\n');
  console.log(`Total restaurants: ${restaurants.length}\n`);

  const BASE = 'https://www.ironbooking.com';

  for (const r of restaurants) {
    const slugStatus = r.slug ? '✅' : '❌ MISSING';
    console.log(`Name:             ${r.name}`);
    console.log(`ID:               ${r.id}`);
    console.log(`Slug:             ${r.slug ?? 'NONE'} ${slugStatus}`);
    console.log(`Users:            ${r._count.users}`);
    console.log(`Reservations:     ${r._count.reservations}`);
    console.log(`Public Booking:   ${r.slug ? `${BASE}/book/${r.slug}` : 'N/A — needs slug'}`);
    console.log(`Guest Hub:        ${r.slug ? `${BASE}/r/${r.slug}` : 'N/A — needs slug'}`);
    console.log(`Staff Login URL:  ${r.slug ? `${BASE}/${r.slug}` : 'N/A — needs slug'}`);
    if (!r.slug) {
      const suggested = r.name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
      console.log(`Suggested Slug:  ${suggested}  ⚠️ NEEDS CREATION`);
    }
    console.log('');
  }

  const missing = restaurants.filter(r => !r.slug);
  if (missing.length > 0) {
    console.log(`⚠️  ${missing.length} restaurant(s) have no slug — DO NOT DEPLOY until fixed.\n`);
  } else {
    console.log('✅ All restaurants have slugs.\n');
  }
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
