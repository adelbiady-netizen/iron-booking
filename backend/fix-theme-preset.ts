import { prisma } from './src/lib/prisma';

async function main() {
  const hub = await prisma.guestHub.findFirst({
    where: { slug: 'eataliano-dalla-costa' },
    include: { branding: true, publishedBranding: true },
  });

  if (!hub) { console.log('HUB NOT FOUND'); return; }

  console.log('hubId:', hub.id);
  console.log('draft.themePreset (before):', hub.branding?.themePreset ?? '(null)');
  console.log('published.themePreset (before):', hub.publishedBranding?.themePreset ?? '(null)');

  if (!hub.branding) { console.log('No draft branding found'); return; }

  await prisma.guestHubBranding.update({
    where: { hubId: hub.id },
    data: { themePreset: 'WINE' },
  });

  await prisma.guestHubPublishedBranding.update({
    where: { hubId: hub.id },
    data: { themePreset: 'WINE' },
  });

  const fresh = await prisma.guestHub.findFirst({
    where: { slug: 'eataliano-dalla-costa' },
    include: { branding: true, publishedBranding: true },
  });
  console.log('draft.themePreset (after):', fresh?.branding?.themePreset ?? '(null)');
  console.log('published.themePreset (after):', fresh?.publishedBranding?.themePreset ?? '(null)');
  console.log('Done.');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
