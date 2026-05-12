import { prisma } from './src/lib/prisma';

async function main() {
  const r = await prisma.restaurant.findUnique({
    where: { slug: 'eataliano-dalla-costa' },
    select: { id: true, settings: true },
  });
  if (!r) throw new Error('Restaurant eataliano-dalla-costa not found');

  const current = (r.settings ?? {}) as Record<string, unknown>;
  const updated = await prisma.restaurant.update({
    where: { id: r.id },
    data: {
      settings: { ...current, slotIntervalMinutes: 30 },
    },
    select: { slug: true, settings: true },
  });
  console.log('Updated:', JSON.stringify(updated, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
