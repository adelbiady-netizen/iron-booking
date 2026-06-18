/**
 * READ-ONLY report — Eataliano Dalla Costa club member consent analysis.
 * No writes. No SMS sent.
 *
 * Run:
 *   $env:DATABASE_URL = "postgresql://..." ; npx tsx scripts/club-consent-report-eataliano.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL before running. No writes are performed.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma  = new PrismaClient({ adapter, log: ['error'] });

const SLUG       = 'eataliano-dalla-costa';
const DAYS_AHEAD = 30;

// Sources that represent genuine opt-in via a booking or club flow
const ORGANIC_SOURCES = ['WEBSITE', 'RESERVATION_LINK', 'FEEDBACK_FLOW', 'IMPORT', 'MANUAL'];

async function main() {
  const restaurant = await prisma.restaurant.findFirst({
    where:  { slug: SLUG },
    select: { id: true, name: true, timezone: true },
  });
  if (!restaurant) { console.error('Restaurant not found:', SLUG); process.exit(1); }

  // ── Consent counts ─────────────────────────────────────────────────────────────
  const [total, active, smsConsentTrue, marketingTrue, smsNoMarkYes, optedOut, paused] = await Promise.all([
    prisma.clubMember.count({ where: { restaurantId: restaurant.id } }),
    prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'ACTIVE' } }),
    prisma.clubMember.count({ where: { restaurantId: restaurant.id, smsConsent: true } }),
    prisma.clubMember.count({ where: { restaurantId: restaurant.id, marketingConsent: true } }),
    prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'ACTIVE', smsConsent: false, marketingConsent: true } }),
    prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'OPTED_OUT' } }),
    prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'PAUSED' } }),
  ]);

  // ── Source breakdown for smsConsent=false ACTIVE members ──────────────────────
  const noSmsActiveMembers = await prisma.clubMember.findMany({
    where: { restaurantId: restaurant.id, status: 'ACTIVE', smsConsent: false },
    select: { id: true, source: true, marketingConsent: true },
  });
  const sourceMap: Record<string, number> = {};
  for (const m of noSmsActiveMembers) {
    sourceMap[m.source] = (sourceMap[m.source] ?? 0) + 1;
  }

  // ── Build upcoming MM-DD window ───────────────────────────────────────────────
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

  async function countByRule(
    field:       'birthday' | 'anniversary',
    messageType: 'BIRTHDAY' | 'ANNIVERSARY',
    rule:        'A' | 'B',
  ) {
    const where =
      rule === 'A'
        ? { restaurantId: restaurant!.id, status: 'ACTIVE' as const, smsConsent: true, [field]: { in: upcomingDates } }
        : { restaurantId: restaurant!.id, status: 'ACTIVE' as const, [field]: { in: upcomingDates },
            OR: [
              { smsConsent: true },
              { marketingConsent: true, source: { in: ORGANIC_SOURCES } },
            ],
          };

    const members = await prisma.clubMember.findMany({ where, select: { id: true, source: true, smsConsent: true, marketingConsent: true } });

    let will = 0;
    const skippedDedup: string[] = [];
    for (const m of members) {
      const already = await prisma.messageLog.findFirst({
        where: { restaurantId: restaurant!.id, clubMemberId: m.id, messageType, status: { in: ['SENT', 'PENDING'] }, createdAt: { gte: cutoff } },
        select: { id: true },
      });
      if (!already) { will++; }
      else           { skippedDedup.push(m.id); }
    }
    return { will, total: members.length, skippedDedup: skippedDedup.length };
  }

  const bdayA    = await countByRule('birthday',    'BIRTHDAY',    'A');
  const bdayB    = await countByRule('birthday',    'BIRTHDAY',    'B');
  const annivA   = await countByRule('anniversary', 'ANNIVERSARY', 'A');
  const annivB   = await countByRule('anniversary', 'ANNIVERSARY', 'B');

  const bdayDelta  = bdayB.will  - bdayA.will;
  const annivDelta = annivB.will - annivA.will;

  // ── Print report ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` Club Member Consent Report — ${restaurant.name}`);
  console.log(` READ-ONLY. No data changed.`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' ── Member counts ────────────────────────────────────────────');
  console.log(`  Total ClubMembers:                 ${total}`);
  console.log(`  ACTIVE:                            ${active}`);
  console.log(`  OPTED_OUT:                         ${optedOut}  ← always excluded`);
  console.log(`  PAUSED:                            ${paused}   ← always excluded`);
  console.log('');
  console.log(' ── Consent breakdown (all statuses) ─────────────────────────');
  console.log(`  smsConsent = true:                 ${smsConsentTrue}`);
  console.log(`  marketingConsent = true:           ${marketingTrue}`);
  console.log(`  ACTIVE + smsConsent=false          `);
  console.log(`       + marketingConsent=true:      ${smsNoMarkYes}  ← Rule B extra pool`);
  console.log('');
  console.log(' ── Source breakdown for ACTIVE + smsConsent=false members ───');
  for (const [src, count] of Object.entries(sourceMap).sort((a, b) => b[1] - a[1])) {
    const inRuleB = ORGANIC_SOURCES.includes(src) ? ' ✓ Rule B eligible' : ' ✗ Rule B excluded';
    console.log(`  ${src.padEnd(20)} ${String(count).padStart(4)}${inRuleB}`);
  }
  console.log('');
  console.log(` ── Birthday SMS — next ${DAYS_AHEAD} days ─────────────────────────────`);
  console.log(`  Rule A (smsConsent=true only):     ${bdayA.will}  (${bdayA.skippedDedup} already sent this year)`);
  console.log(`  Rule B (+ marketingConsent):       ${bdayB.will}  (${bdayB.skippedDedup} already sent this year)`);
  console.log(`  Delta (extra sends under Rule B):  +${bdayDelta}`);
  console.log('');
  console.log(` ── Anniversary SMS — next ${DAYS_AHEAD} days ──────────────────────────`);
  console.log(`  Rule A (smsConsent=true only):     ${annivA.will}  (${annivA.skippedDedup} already sent this year)`);
  console.log(`  Rule B (+ marketingConsent):       ${annivB.will}  (${annivB.skippedDedup} already sent this year)`);
  console.log(`  Delta (extra sends under Rule B):  +${annivDelta}`);
  console.log('');
  console.log(' ── Recommendation ───────────────────────────────────────────');

  if (smsNoMarkYes === 0) {
    console.log('  No ACTIVE members with smsConsent=false + marketingConsent=true.');
    console.log('  Rule A = Rule B. No data change needed.');
  } else if (bdayDelta + annivDelta === 0) {
    console.log('  Rule B would reach extra members but none have upcoming events in 30 days.');
    console.log('  Recommendation: update smsConsent=true for the marketingConsent=true');
    console.log('  group as a hygiene fix — no immediate operational impact.');
  } else {
    console.log(`  ${smsNoMarkYes} ACTIVE members have marketingConsent but not smsConsent.`);
    console.log(`  Rule B would send ${bdayDelta + annivDelta} additional messages in the next ${DAYS_AHEAD} days.`);
    console.log('');
    console.log('  Option 1 — Update data (clean, future-proof):');
    console.log('    Backfill smsConsent=true for ACTIVE + marketingConsent=true members.');
    console.log('    Run the backfill script, then keep Rule A in the scheduler.');
    console.log('    Pro: consent field is authoritative. Con: one-time data write.');
    console.log('');
    console.log('  Option 2 — Change automation rule (no data change):');
    console.log('    Add marketingConsent fallback in clubBirthdaySms.ts query.');
    console.log('    Pro: zero data risk. Con: splits consent logic across two fields.');
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('');
}

main()
  .catch(err => { console.error('[FATAL]', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
