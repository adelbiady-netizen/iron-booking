/**
 * Backfill ClubMember rows from online reservations where:
 *   - marketingOptIn = true
 *   - guestId is set (CRM linked)
 *   - no ClubMember yet exists for that restaurantId + guestId
 *
 * Run dry-run first (default):
 *   npx tsx backend/scripts/backfill-club-from-bookings.ts
 *
 * Run write mode:
 *   WRITE=true npx tsx backend/scripts/backfill-club-from-bookings.ts
 */
import { prisma } from '../src/lib/prisma';
import { ClubJoinSource, ClubMemberStatus } from '@prisma/client';

const WRITE = process.env['WRITE'] === 'true';

async function main() {
  console.log(`\n=== Club Backfill from Bookings (${WRITE ? 'WRITE' : 'DRY-RUN'}) ===\n`);

  // Find all online reservations with marketingOptIn=true that have a linked guest
  const candidates = await prisma.reservation.findMany({
    where: {
      source:        'ONLINE',
      marketingOptIn: true,
      guestId:       { not: null },
    },
    select: {
      id:           true,
      restaurantId: true,
      guestId:      true,
      birthday:     true,
      anniversary:  true,
      createdAt:    true,
      restaurant:   { select: { name: true } },
      guest:        { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Reservations with marketingOptIn=true and guestId set: ${candidates.length}`);

  // Check which guests already have a ClubMember row
  const pairs = candidates.map(r => ({ restaurantId: r.restaurantId, guestId: r.guestId! }));
  const existing = await prisma.clubMember.findMany({
    where: {
      OR: pairs.map(p => ({ restaurantId: p.restaurantId, guestId: p.guestId })),
    },
    select: { restaurantId: true, guestId: true, status: true },
  });
  const existingSet = new Set(existing.map(e => `${e.restaurantId}:${e.guestId}`));

  const toCreate = candidates.filter(r => !existingSet.has(`${r.restaurantId}:${r.guestId!}`));
  const alreadyMember = candidates.length - toCreate.length;

  console.log(`Already have ClubMember:       ${alreadyMember}`);
  console.log(`Would create ClubMember rows:  ${toCreate.length}`);

  // Birthday/anniversary coverage in the to-create set
  const withBday  = toCreate.filter(r => r.birthday).length;
  const withAnniv = toCreate.filter(r => r.anniversary).length;
  console.log(`  of which have birthday:      ${withBday}`);
  console.log(`  of which have anniversary:   ${withAnniv}`);

  // Group by restaurant
  const byRestaurant = new Map<string, { name: string; count: number }>();
  for (const r of toCreate) {
    const entry = byRestaurant.get(r.restaurantId) ?? { name: r.restaurant.name, count: 0 };
    entry.count++;
    byRestaurant.set(r.restaurantId, entry);
  }
  console.log('\nBy restaurant:');
  for (const [, v] of byRestaurant) {
    console.log(`  ${v.name}: ${v.count}`);
  }

  if (!WRITE) {
    console.log('\nDry-run complete. Set WRITE=true to apply.\n');
    return;
  }

  // Deduplicate: keep only the earliest reservation per (restaurantId, guestId) pair
  // so we don't try to insert the same pair twice in batch.
  const seen = new Set<string>();
  const deduped = toCreate.filter(r => {
    const key = `${r.restaurantId}:${r.guestId!}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nCreating ${deduped.length} ClubMember rows...`);
  let created = 0;
  let skipped = 0;

  for (const r of deduped) {
    try {
      await prisma.clubMember.create({
        data: {
          restaurantId:     r.restaurantId,
          guestId:          r.guestId!,
          source:           ClubJoinSource.WEBSITE,
          status:           ClubMemberStatus.ACTIVE,
          birthday:         r.birthday    ?? null,
          anniversary:      r.anniversary ?? null,
          marketingConsent: true,
          smsConsent:       false,
          emailConsent:     false,
          joinDate:         r.createdAt, // backdate to reservation's created time
        },
      });
      created++;
    } catch (e: any) {
      // P2002 = unique constraint — already exists (race or duplicate reservation)
      if (e?.code === 'P2002') { skipped++; continue; }
      throw e;
    }
  }

  console.log(`Created: ${created}  Skipped (already existed): ${skipped}`);
  console.log('\nBackfill complete.\n');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
