import { prisma } from './src/lib/prisma';

async function main() {
  const updated = await prisma.restaurant.update({
    where: { slug: 'eataliano-dalla-costa' },
    data: {
      primaryColor:      '#928762',   // muted warm olive
      accentColor:       null,
      publicThemePreset: 'italiano',
    },
    select: { id: true, name: true, slug: true, primaryColor: true, publicThemePreset: true },
  });
  console.log('Updated:', JSON.stringify(updated, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
