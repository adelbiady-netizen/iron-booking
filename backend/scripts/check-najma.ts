/**
 * READ-ONLY production diagnostic for a restaurant's SMS pipeline.
 * Makes NO writes. Answers: was a reservation created, was a RESERVATION_RECEIVED
 * SMS attempted, is there a MessageLog row, what status, and the provider response.
 *
 * Usage (from backend/):
 *   DATABASE_URL="<prod>" npx tsx scripts/check-najma.ts [slug=najma]
 */

import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/lib/prisma';

async function main() {
  const slug = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'najma';

  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug },
    select: { id: true, name: true, slug: true, settings: true },
  });
  if (!restaurant) { console.error(`No restaurant with slug "${slug}".`); process.exit(1); }

  const s = (restaurant.settings ?? {}) as Record<string, unknown>;

  console.log(`\n=== ${restaurant.name} [slug=${restaurant.slug}] id=${restaurant.id} ===`);
  console.log('\n[6] Production SMS settings:');
  console.log(`     smsEnabled    = ${s.smsEnabled}`);
  console.log(`     smsProvider   = ${s.smsProvider}`);
  console.log(`     smsSenderName = ${JSON.stringify(s.smsSenderName)}`);

  // [1] Latest reservations
  const reservations = await prisma.reservation.findMany({
    where:   { restaurantId: restaurant.id },
    orderBy: { createdAt: 'desc' },
    take:    5,
    select: {
      id: true, createdAt: true, guestName: true, guestPhone: true,
      partySize: true, date: true, time: true, status: true, source: true,
    },
  });

  console.log(`\n[1] Latest reservations (${reservations.length}):`);
  if (reservations.length === 0) console.log('     (none)');
  reservations.forEach((r, i) => {
    console.log(`     ${i === 0 ? '>' : ' '} ${r.createdAt.toISOString()} | ${r.guestName} | ${r.guestPhone ?? 'NO PHONE'} | party ${r.partySize} | ${r.status} | source=${r.source} | id=${r.id}`);
  });

  const latest = reservations[0];

  // [2/3/4/5] MessageLog rows for the latest reservation
  if (latest) {
    const expectSms = latest.source !== 'WALK_IN' && !!latest.guestPhone;
    console.log(`\n[2] RESERVATION_RECEIVED SMS expected for latest reservation? ${expectSms}` +
      (!expectSms ? `  (skipped: ${latest.source === 'WALK_IN' ? 'walk-in' : 'no guest phone'})` : ''));

    const logsForReservation = await prisma.messageLog.findMany({
      where:   { reservationId: latest.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, messageType: true, status: true, provider: true, senderName: true,
        providerMessageId: true, errorMessage: true, phone: true, createdAt: true,
      },
    });

    console.log(`\n[3] MessageLog rows tied to latest reservation (${logsForReservation.length}):`);
    if (logsForReservation.length === 0) console.log('     (no row)');
    logsForReservation.forEach(l => {
      console.log(`     • ${l.createdAt.toISOString()} | ${l.messageType} | status=${l.status} | provider=${l.provider} | sender=${JSON.stringify(l.senderName)} | to=${l.phone}`);
      console.log(`       providerMessageId=${l.providerMessageId ?? '—'}`);
      if (l.errorMessage) console.log(`       [5] provider/error response: ${l.errorMessage}`);
    });
  }

  // Recent SMS activity for the restaurant overall (last 10)
  const recent = await prisma.messageLog.findMany({
    where:   { restaurantId: restaurant.id },
    orderBy: { createdAt: 'desc' },
    take:    10,
    select: {
      messageType: true, status: true, provider: true, senderName: true,
      providerMessageId: true, errorMessage: true, phone: true, createdAt: true,
    },
  });
  console.log(`\n[*] Recent SMS activity for ${restaurant.name} (last ${recent.length}):`);
  if (recent.length === 0) console.log('     (no message logs at all)');
  recent.forEach(l => {
    console.log(`     • ${l.createdAt.toISOString()} | ${l.messageType} | ${l.status} | ${l.provider} | sender=${JSON.stringify(l.senderName)} | ${l.phone}${l.errorMessage ? ` | err: ${l.errorMessage}` : ''}`);
  });

  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
