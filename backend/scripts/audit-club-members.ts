/**
 * Audit ClubMember records for a given restaurant slug.
 * Run: npx tsx backend/scripts/audit-club-members.ts [slug]
 */
import { prisma } from '../src/lib/prisma';

async function main() {
  const slug = process.argv[2] ?? 'eataliano';
  const rest = await prisma.restaurant.findFirst({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!rest) { console.error('Restaurant not found:', slug); process.exit(1); }
  console.log(`\n=== IRON CLUB AUDIT: ${rest.name} (${rest.id}) ===\n`);

  const [total, active, withBday, withAnniv, newest] = await Promise.all([
    prisma.clubMember.count({ where: { restaurantId: rest.id } }),
    prisma.clubMember.count({ where: { restaurantId: rest.id, status: 'ACTIVE' } }),
    prisma.clubMember.count({ where: { restaurantId: rest.id, birthday: { not: null } } }),
    prisma.clubMember.count({ where: { restaurantId: rest.id, anniversary: { not: null } } }),
    prisma.clubMember.findMany({
      where: { restaurantId: rest.id },
      orderBy: { joinDate: 'desc' },
      take: 10,
      select: {
        joinDate: true,
        source: true,
        status: true,
        birthday: true,
        anniversary: true,
        guest: { select: { firstName: true, lastName: true, phone: true } },
      },
    }),
  ]);

  console.log(`Total members:       ${total}`);
  console.log(`Active:              ${active}`);
  console.log(`With birthday:       ${withBday}`);
  console.log(`With anniversary:    ${withAnniv}`);
  console.log(`Without birthday:    ${total - withBday}`);
  console.log(`Without anniversary: ${total - withAnniv}`);
  console.log('\n─── Newest 10 members ───\n');
  newest.forEach((m, i) => {
    const name = `${m.guest.firstName} ${m.guest.lastName}`;
    console.log(`${String(i + 1).padStart(2)}. ${name.padEnd(28)} phone=${m.guest.phone ?? '—'} joined=${m.joinDate.toISOString().slice(0, 10)} src=${m.source} status=${m.status} bday=${m.birthday ?? '—'} anniv=${m.anniversary ?? '—'}`);
  });
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
