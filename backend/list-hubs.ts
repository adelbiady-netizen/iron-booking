import { prisma } from './src/lib/prisma';

async function main() {
  const hubs = await prisma.guestHub.findMany({
    select: { id: true, slug: true, restaurantId: true },
    take: 20,
  });
  hubs.forEach(h => console.log(`${h.id} | slug="${h.slug}" | restaurantId=${h.restaurantId ?? 'none'}`));
}

main().catch(e => console.error('ERROR:', e.message)).finally(() => prisma.$disconnect());
