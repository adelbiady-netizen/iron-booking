/**
 * ONE-TIME SCRIPT — backfill smsConsent=true for Eataliano Dalla Costa club members
 *
 * Criteria: ACTIVE + marketingConsent=true + smsConsent=false
 * Touches nothing else (OPTED_OUT, PAUSED, future members untouched).
 *
 * Run (dry-run first):
 *   DATABASE_URL="<neon_url>" npx tsx scripts/backfill-sms-consent-eataliano.ts --dry-run
 *   DATABASE_URL="<neon_url>" npx tsx scripts/backfill-sms-consent-eataliano.ts
 *
 * Delete after use.
 *
 * NOTE: This script predates the ConsentAudit system. Rows updated here will not
 * have a ConsentAudit entry. If re-run, add writeConsentAudit() calls with
 * source=IMPORT after each update.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL before running this script.');
  console.error('Example: DATABASE_URL="postgresql://..." npx tsx scripts/backfill-sms-consent-eataliano.ts');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma  = new PrismaClient({ adapter, log: ['error'] });

const SLUG       = 'eataliano-dalla-costa';
const DRY_RUN    = process.argv.includes('--dry-run');
const DAYS_AHEAD = 30;

async function main() {
  console.log(`[backfill-sms-consent] mode=${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | host=${new URL(connectionString!).hostname}`);

  const restaurant = await prisma.restaurant.findFirst({
    where:  { slug: SLUG },
    select: { id: true, name: true, timezone: true },
  });
  if (!restaurant) {
    console.error(`Restaurant not found: ${SLUG}`);
    process.exit(1);
  }
  console.log(`[backfill-sms-consent] Restaurant: ${restaurant.name} (${restaurant.id})`);

  // ── 1. Identify targets ───────────────────────────────────────────────────────
  const targets = await prisma.clubMember.findMany({
    where: { restaurantId: restaurant.id, status: 'ACTIVE', marketingConsent: true, smsConsent: false },
    select: { id: true },
  });
  console.log(`[backfill-sms-consent] Targets (ACTIVE + marketingConsent=true + smsConsent=false): ${targets.length}`);

  // ── 2. Update ─────────────────────────────────────────────────────────────────
  let updated = 0;
  if (!DRY_RUN && targets.length > 0) {
    const result = await prisma.clubMember.updateMany({
      where: { id: { in: targets.map(t => t.id) } },
      data:  { smsConsent: true },
    });
    updated = result.count;
  } else {
    updated = targets.length;
  }

  // ── 3. Remaining without consent (post-update in live; pre-update in dry-run) ──
  const remaining = await prisma.clubMember.count({
    where: { restaurantId: restaurant.id, status: 'ACTIVE', smsConsent: false },
  });

  // ── 4. Upcoming SMS eligibility ───────────────────────────────────────────────
  const tz = restaurant.timezone ?? 'UTC';
  const mmddToDay = new Map<string, number>();
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const d     = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit', day: '2-digit' }).formatToParts(d);
    const mmdd  = `${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
    if (!mmddToDay.has(mmdd)) mmddToDay.set(mmdd, i);
  }
  const upcomingDates = Array.from(mmddToDay.keys());
  const cutoff = new Date(Date.now() - 330 * 24 * 60 * 60 * 1000);

  async function countWillSend(field: 'birthday' | 'anniversary', messageType: 'BIRTHDAY' | 'ANNIVERSARY') {
    const members = await prisma.clubMember.findMany({
      where: { restaurantId: restaurant!.id, status: 'ACTIVE', smsConsent: true, [field]: { in: upcomingDates } },
      select: { id: true },
    });
    let will = 0;
    for (const m of members) {
      const already = await prisma.messageLog.findFirst({
        where: { restaurantId: restaurant!.id, clubMemberId: m.id, messageType, status: { in: ['SENT', 'PENDING'] }, createdAt: { gte: cutoff } },
        select: { id: true },
      });
      if (!already) will++;
    }
    return will;
  }

  const birthdaySmsCount    = await countWillSend('birthday',    'BIRTHDAY');
  const anniversarySmsCount = await countWillSend('anniversary', 'ANNIVERSARY');

  // ── 5. Report ─────────────────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(` SMS Consent Backfill Report — ${restaurant.name}`);
  console.log('══════════════════════════════════════════════════════');
  console.log(` Mode:                          ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE — writes committed'}`);
  console.log(` Updated smsConsent → true:     ${updated}`);
  console.log(` Remaining smsConsent=false:    ${remaining} (ACTIVE members)`);
  console.log('──────────────────────────────────────────────────────');
  console.log(` Birthday SMS (next ${DAYS_AHEAD} days):      ${birthdaySmsCount} members will receive`);
  console.log(` Anniversary SMS (next ${DAYS_AHEAD} days):   ${anniversarySmsCount} members will receive`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  if (DRY_RUN) console.log('Re-run without --dry-run to apply changes.');
}

main()
  .catch(err => { console.error('[FATAL]', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
