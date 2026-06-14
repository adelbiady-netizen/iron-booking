#!/usr/bin/env ts-node
/**
 * V2 Guest Intelligence Scoring Backfill
 *
 * Recomputes loyaltyScore, engagementScore, gicLabel for all guests
 * in a single restaurant. Does NOT send SMS, does NOT create alerts.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/backfill-v2-scoring.ts \
 *     --restaurant italiano-dalla-costa
 *
 * Add --execute to write results. Default is dry-run (score simulation only).
 * Add --sample N to print N example guests after backfill.
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';

dotenv.config();

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let slug: string | undefined;
  let execute = false;
  let sample  = 5;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--restaurant' && args[i+1]) { slug    = args[++i]; continue; }
    if (args[i] === '--execute')                 { execute = true;       continue; }
    if (args[i] === '--sample'    && args[i+1]) { sample  = parseInt(args[++i], 10); continue; }
  }
  return { slug, execute, sample };
}

// ── Scoring ───────────────────────────────────────────────────────────────────
// Mirrors engine.ts computeLoyaltyScore exactly — copied here so the script
// is self-contained and doesn't import the live engine module.

async function scoreGuest(prisma: PrismaClient, restaurantId: string, guestId: string) {
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, restaurantId },
    select: {
      isVip: true,
      visitCount: true,
      noShowCount: true,
      lastVisitAt: true,
      silentScore: true,
      clubMemberships: {
        where: { restaurantId },
        take: 1,
        select: { status: true, smsConsent: true, birthday: true },
      },
      feedback: {
        where: { submittedAt: { not: null } },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        select: { sentiment: true, submittedAt: true },
      },
      recoveryCases: {
        where: { restaurantId },
        select: { status: true },
      },
      reservations: {
        where: { restaurantId, occasion: { not: null } },
        take: 1,
        select: { id: true },
      },
      momentQueue: {
        where: { restaurantId, status: 'SENT' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!guest) return null;

  const club              = guest.clubMemberships[0] ?? null;
  const clubActive        = club?.status === 'ACTIVE';
  const latestFeedback    = guest.feedback[0] ?? null;
  const feedbackParticipated = guest.feedback.length > 0;
  const hasResolvedRecovery  = guest.recoveryCases.some(c => c.status === 'RESOLVED');
  const hasOpenRecovery      = guest.recoveryCases.some(c => c.status === 'OPEN' || c.status === 'CONTACTED');
  const hasCelebration    = guest.reservations.length > 0;
  const hasSentMoment     = guest.momentQueue.length > 0;

  const signals: boolean[] = [];
  let pts = 0;

  // FREQUENCY
  const ibVisits  = guest.visitCount ?? 0;
  pts += Math.min(24, ibVisits * 4);
  signals.push(ibVisits > 0);

  // RECENCY
  const daysSinceLast = guest.lastVisitAt
    ? (Date.now() - guest.lastVisitAt.getTime()) / 86400000
    : null;
  if (daysSinceLast !== null) {
    if      (daysSinceLast < 30)  { pts += 12; signals.push(true); }
    else if (daysSinceLast < 90)  { pts += 6;  signals.push(true); }
    else if (daysSinceLast < 180) {             signals.push(false); }
    else                          { pts -= 8;  signals.push(false); }
  } else {
    signals.push(false);
  }

  // CLUB
  if (clubActive)    { pts += 18; signals.push(true); } else { signals.push(false); }
  if (club?.smsConsent) { pts += 5; }
  if (club?.birthday)   { pts += 4; signals.push(true); } else { signals.push(false); }

  // FEEDBACK
  if (feedbackParticipated) { pts += 8; signals.push(true); } else { signals.push(false); }
  if (latestFeedback?.sentiment === 'EXCELLENT' || latestFeedback?.sentiment === 'GOOD') {
    pts += 10; signals.push(true);
  } else if (latestFeedback?.sentiment === 'BAD') {
    pts -= 15; signals.push(false);
  } else {
    signals.push(false);
  }

  // RECOVERY
  if (hasResolvedRecovery) { pts += 15; signals.push(true); } else { signals.push(false); }
  if (hasOpenRecovery)     { pts -= 10; }

  // RELIABILITY
  if (ibVisits >= 3 && (guest.noShowCount ?? 0) === 0) {
    pts += 6; signals.push(true);
  } else if ((guest.noShowCount ?? 0) >= 3) {
    pts -= 15; signals.push(false);
  } else {
    signals.push(false);
  }

  // OCCASIONS
  if (hasCelebration) { pts += 5; signals.push(true); } else { signals.push(false); }
  if (hasSentMoment)  { pts += 5; signals.push(true); } else { signals.push(false); }

  const loyaltyScore    = Math.min(100, Math.max(0, pts));
  const positiveSignals = signals.filter(Boolean).length;
  const engagementScore = Math.round((positiveSignals / signals.length) * 100);

  let gicLabel: string;
  if (guest.isVip) {
    gicLabel = 'VIP';
  } else if (hasResolvedRecovery && loyaltyScore >= 35) {
    gicLabel = 'RECOVERED';
  } else if (clubActive && feedbackParticipated && loyaltyScore >= 55) {
    gicLabel = 'HIGH_ENGAGEMENT';
  } else if (loyaltyScore >= 50) {
    gicLabel = 'LOYAL';
  } else if (loyaltyScore >= 35) {
    gicLabel = 'VIP_CANDIDATE';
  } else if (hasOpenRecovery || latestFeedback?.sentiment === 'BAD') {
    gicLabel = 'AT_RISK';
  } else if ((guest.silentScore ?? 0) >= 80 || (daysSinceLast !== null && daysSinceLast > 180 && ibVisits >= 2)) {
    gicLabel = 'SILENT';
  } else if (clubActive && ibVisits === 0) {
    gicLabel = 'CRM_MEMBER';
  } else if ((guest.noShowCount ?? 0) >= 3 || (loyaltyScore < 20 && ibVisits >= 2)) {
    gicLabel = 'NEEDS_ATTENTION';
  } else {
    gicLabel = 'NEW';
  }

  return { loyaltyScore, engagementScore, gicLabel, ibVisits, clubActive, feedbackParticipated, hasResolvedRecovery };
}

const LABEL_HE: Record<string, string> = {
  VIP:              'VIP',
  LOYAL:            'נאמן',
  VIP_CANDIDATE:    'מועמד VIP',
  HIGH_ENGAGEMENT:  'מעורב מאוד',
  RECOVERED:        'חזר אלינו',
  AT_RISK:          'זקוק לתשומת לב',
  SILENT:           'לא חזר',
  CRM_MEMBER:       'חבר CRM',
  NEEDS_ATTENTION:  'דורש מעקב',
  NEW:              'חדש',
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { slug, execute, sample } = parseArgs();
  if (!slug) {
    console.error('\nUsage: DATABASE_URL=... npx ts-node --transpile-only scripts/backfill-v2-scoring.ts --restaurant <slug> [--execute] [--sample N]\n');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error('DATABASE_URL not set'); process.exit(1); }

  const { hostname } = new URL(connectionString);
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    console.error('\nABORT: DATABASE_URL points to localhost. Use production connection string.\n');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma  = new PrismaClient({ adapter, log: ['error'] }) as unknown as PrismaClient;

  const mode = execute ? '⚠  LIVE — writing to database' : 'DRY RUN — no database writes';
  console.log(`\n${'═'.repeat(62)}`);
  console.log('  GIC V2 Scoring Backfill');
  console.log(`  Mode       : ${mode}`);
  console.log(`  Restaurant : ${slug}`);
  console.log(`  DB host    : ${hostname}`);
  console.log(`${'═'.repeat(62)}\n`);

  try {
    const restaurant = await (prisma as any).restaurant.findUnique({
      where: { slug }, select: { id: true, name: true },
    });
    if (!restaurant) { console.error(`Restaurant "${slug}" not found.`); process.exit(1); }
    console.log(`  Found: ${restaurant.name} (${restaurant.id})\n`);

    const allGuests = await (prisma as any).guest.findMany({
      where: { restaurantId: restaurant.id },
      select: { id: true, firstName: true, lastName: true, visitCount: true, gicLabel: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`  Total guests: ${allGuests.length}\n`);

    const BATCH = 50;
    let processed = 0;
    let errors    = 0;
    const labelDist: Record<string, number> = {};
    const samples: Array<{ name: string; visitCount: number; before: string | null; after: string; loyaltyScore: number; engagementScore: number; flags: string }> = [];

    for (let i = 0; i < allGuests.length; i += BATCH) {
      const batch = allGuests.slice(i, i + BATCH);
      await Promise.all(batch.map(async (g: any) => {
        try {
          const result = await scoreGuest(prisma as any, restaurant.id, g.id);
          if (!result) return;

          const { loyaltyScore, engagementScore, gicLabel, ibVisits, clubActive, feedbackParticipated, hasResolvedRecovery } = result;
          labelDist[gicLabel] = (labelDist[gicLabel] ?? 0) + 1;
          processed++;

          if (execute) {
            await (prisma as any).guest.updateMany({
              where: { id: g.id, restaurantId: restaurant.id },
              data: { loyaltyScore, engagementScore, gicLabel, gicComputedAt: new Date() },
            });
          }

          // Collect sample entries (changed label or interesting cases)
          const flags = [
            ibVisits === 0 && clubActive ? 'CRM+CLUB' : '',
            feedbackParticipated ? 'FEEDBACK' : '',
            hasResolvedRecovery ? 'RECOVERED' : '',
          ].filter(Boolean).join(' ');

          if (samples.length < sample || (g.gicLabel !== gicLabel)) {
            samples.push({
              name:           `${g.firstName} ${g.lastName}`,
              visitCount:     g.visitCount,
              before:         g.gicLabel,
              after:          gicLabel,
              loyaltyScore,
              engagementScore,
              flags,
            });
          }
        } catch (err) {
          errors++;
          console.error(`  ERROR guest ${g.id}:`, err);
        }
      }));
      process.stdout.write(`  Processed ${Math.min(i + BATCH, allGuests.length)}/${allGuests.length}\r`);
    }

    console.log(`\n\n${'─'.repeat(62)}`);
    console.log(`  RESULTS${execute ? ' (WRITTEN)' : ' (DRY RUN)'}`);
    console.log(`${'─'.repeat(62)}`);
    console.log(`  Processed : ${processed}`);
    console.log(`  Errors    : ${errors}`);
    console.log();
    console.log('  Label distribution:');
    const sorted = Object.entries(labelDist).sort((a, b) => b[1] - a[1]);
    for (const [label, count] of sorted) {
      const he   = LABEL_HE[label] ?? label;
      const bar  = '█'.repeat(Math.round(count / allGuests.length * 30));
      console.log(`    ${label.padEnd(18)} ${String(count).padStart(4)} (${String(Math.round(count/allGuests.length*100)).padStart(3)}%) ${bar}  ${he}`);
    }

    console.log();
    console.log(`  Sample guests (first ${sample} or label-changed):`);
    console.log('  ' + '─'.repeat(58));
    for (const s of samples.slice(0, sample)) {
      const before = s.before ? LABEL_HE[s.before] ?? s.before : 'null';
      const after  = LABEL_HE[s.after] ?? s.after;
      const changed = s.before !== s.after ? ' ← changed' : '';
      console.log(`  ${s.name.slice(0, 20).padEnd(21)} visits=${String(s.visitCount).padStart(3)}  loyalty=${String(s.loyaltyScore).padStart(3)}  eng=${String(s.engagementScore).padStart(3)}  ${after.padEnd(16)} ${s.flags}${changed}`);
      if (s.before !== null && s.before !== s.after) {
        console.log(`    ${''.padEnd(21)} was: ${before}`);
      }
    }
    console.log('  ' + '─'.repeat(58));

    if (!execute) {
      console.log(`\n  DRY RUN COMPLETE. Add --execute to apply to ${processed} guests.\n`);
    } else {
      console.log(`\n  BACKFILL COMPLETE. ${processed} guests updated in production.\n`);
    }

  } finally {
    await (prisma as any).$disconnect();
  }
}

main().catch(err => {
  console.error('\nFatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
