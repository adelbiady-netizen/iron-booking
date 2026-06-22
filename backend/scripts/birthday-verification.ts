/**
 * Birthday SMS Verification Script
 *
 * Audits production state and optionally fires a controlled test SMS.
 *
 * Usage:
 *   # Audit only (no SMS sent):
 *   DATABASE_URL=... npx tsx backend/scripts/birthday-verification.ts
 *
 *   # Dry-run preview for a specific restaurant:
 *   DATABASE_URL=... npx tsx backend/scripts/birthday-verification.ts --slug eataliano --dry-run
 *
 *   # Real send to a test phone only (safe — no customer touches):
 *   DATABASE_URL=... INFORU_BASIC_AUTH=... npx tsx backend/scripts/birthday-verification.ts \
 *     --slug eataliano --send --test-phone +972XXXXXXXXX
 *
 * Flags:
 *   --slug <slug>          Target a single restaurant (default: all)
 *   --dry-run              Preview messages without sending
 *   --send                 Actually send (requires --test-phone)
 *   --test-phone <phone>   Create a sandbox member with this phone + birthday tomorrow
 *   --cleanup              Remove sandbox member after test
 */

import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/lib/prisma';
import { runClubBirthdaySmsBatch } from '../src/lib/clubBirthdaySms';

// ── Arg helpers ──────────────────────────────────────────────────────────────
function flag(name: string): boolean {
  return process.argv.includes(name);
}
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const targetSlug = argValue('--slug');
const doDryRun   = flag('--dry-run');
const doSend     = flag('--send');
const testPhone  = argValue('--test-phone');
const doCleanup  = flag('--cleanup');

// ── Helpers ──────────────────────────────────────────────────────────────────
function hr(label: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
}

function getMmDd(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const d = parts.find(p => p.type === 'day')?.value   ?? '01';
  return `${m}-${d}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

// ── 1. Environment Audit ─────────────────────────────────────────────────────
function auditEnv() {
  hr('1. ENVIRONMENT VARIABLES');

  const vars = [
    'REMINDER_SCHEDULER_ENABLED',
    'REMINDER_SCHEDULER_DRY_RUN',
    'REMINDER_SCHEDULER_RESTAURANTS',
    'INFORU_BASIC_AUTH',
    'NODE_ENV',
  ];

  for (const v of vars) {
    const raw = process.env[v];
    let display: string;
    if (raw === undefined)    display = '⚠️  NOT SET';
    else if (v === 'INFORU_BASIC_AUTH') display = raw ? `✓  SET (${raw.length} chars)` : '⚠️  EMPTY';
    else                      display = `✓  "${raw}"`;
    console.log(`  ${v.padEnd(38)} ${display}`);
  }

  // Derived scheduler state
  const schedulerEnabled = process.env.REMINDER_SCHEDULER_ENABLED === 'true';
  const dryRunActive     = process.env.REMINDER_SCHEDULER_DRY_RUN !== 'false';
  const inforuSet        = !!process.env.INFORU_BASIC_AUTH?.trim();

  console.log('\n  ── Derived State ──');
  console.log(`  Scheduler running:   ${schedulerEnabled ? '✓ YES' : '✗ NO'}`);
  console.log(`  DRY_RUN active:      ${dryRunActive     ? '⚠️  YES — no real SMS sent' : '✓ NO — live mode'}`);
  console.log(`  InforU credentials:  ${inforuSet        ? '✓ SET' : '✗ MISSING — will use MOCK provider'}`);
}

// ── 2. Database Audit ────────────────────────────────────────────────────────
async function auditDatabase(restaurantId?: string) {
  hr('2. DATABASE — CLUB MEMBERS');

  const where = restaurantId ? { restaurantId } : {};

  const [total, active, withBday, consentSms, consentMarketing, consentEither] = await Promise.all([
    prisma.clubMember.count({ where }),
    prisma.clubMember.count({ where: { ...where, status: 'ACTIVE' } }),
    prisma.clubMember.count({ where: { ...where, status: 'ACTIVE', birthday: { not: null } } }),
    prisma.clubMember.count({ where: { ...where, status: 'ACTIVE', birthday: { not: null }, smsConsent: true } }),
    prisma.clubMember.count({ where: { ...where, status: 'ACTIVE', birthday: { not: null }, marketingConsent: true } }),
    prisma.clubMember.count({ where: { ...where, status: 'ACTIVE', birthday: { not: null }, OR: [{ smsConsent: true }, { marketingConsent: true }] } }),
  ]);

  console.log(`  Total members:               ${total}`);
  console.log(`  Active:                      ${active}`);
  console.log(`  Active + has birthday:       ${withBday}`);
  console.log(`  Active + bday + smsConsent:  ${consentSms}`);
  console.log(`  Active + bday + mktConsent:  ${consentMarketing}`);
  console.log(`  Active + bday + EITHER:      ${consentEither}  ← eligible for birthday SMS`);

  // Per-restaurant breakdown if all restaurants
  const rests = restaurantId ? [] : await prisma.restaurant.findMany({
    where:  { isSystem: false },
    select: { id: true, name: true, slug: true, settings: true },
  });

  if (rests.length > 0) {
    console.log('\n  ── Per-restaurant SMS config ──');
    for (const r of rests) {
      const s = (r.settings ?? {}) as Record<string, unknown>;
      const smsEn   = s.smsEnabled === true;
      const clubEn  = s.ironClubEnabled !== false;
      const bdayEn  = s.clubBirthdaySmsEnabled === true;
      const prov    = (s.smsProvider as string | undefined) ?? 'MOCK';
      const daysBef = typeof s.clubBirthdaySmsDaysBefore === 'number' ? s.clubBirthdaySmsDaysBefore : 7;
      const gift    = (s.clubBirthdaySmsGift as string | undefined) ?? '—';

      const mCount = await prisma.clubMember.count({
        where: { restaurantId: r.id, status: 'ACTIVE', birthday: { not: null }, OR: [{ smsConsent: true }, { marketingConsent: true }] },
      });

      const ready = smsEn && clubEn && bdayEn && prov === 'INFORU';
      console.log(
        `  ${r.name.padEnd(24)} sms=${String(smsEn).padEnd(5)} club=${String(clubEn).padEnd(5)} bday=${String(bdayEn).padEnd(5)} ` +
        `prov=${prov.padEnd(6)} days=${daysBef} gift="${gift.slice(0, 20)}" eligible=${mCount} ${ready ? '✓ FULLY CONFIGURED' : '⚠️  INCOMPLETE'}`,
      );
    }
  }

  // Upcoming birthdays (next 30 days)
  hr('2b. UPCOMING BIRTHDAYS (next 30 days)');
  const tz     = 'Asia/Jerusalem';
  const now    = new Date();
  const upcoming: Array<{ mmdd: string; daysUntil: number; count: number }> = [];

  for (let offset = 0; offset <= 30; offset++) {
    const mmdd = getMmDd(addDays(now, offset), tz);
    const count = await prisma.clubMember.count({
      where: {
        ...where,
        status:   'ACTIVE',
        birthday: mmdd,
        OR: [{ smsConsent: true }, { marketingConsent: true }],
      },
    });
    if (count > 0) upcoming.push({ mmdd, daysUntil: offset, count });
  }

  if (upcoming.length === 0) {
    console.log('  No eligible birthdays in the next 30 days.');
  } else {
    for (const u of upcoming) {
      const label = u.daysUntil === 0 ? '← TODAY' : u.daysUntil === 7 ? '← 7-day trigger' : '';
      console.log(`  ${u.mmdd}  (+${String(u.daysUntil).padStart(2)} days)  ${u.count} eligible member(s)  ${label}`);
    }
  }
}

// ── 3. MessageLog Audit ──────────────────────────────────────────────────────
async function auditMessageLog(restaurantId?: string) {
  hr('3. MESSAGE LOG — BIRTHDAY HISTORY');

  const where = restaurantId ? { restaurantId } : {};

  const logs = await prisma.messageLog.findMany({
    where:   { ...where, messageType: 'BIRTHDAY' },
    orderBy: { createdAt: 'desc' },
    take:    20,
    select:  {
      id: true, createdAt: true, status: true, provider: true,
      phone: true, errorMessage: true, clubMemberId: true,
      restaurant: { select: { name: true } },
    },
  });

  if (logs.length === 0) {
    console.log('  ⚠️  No BIRTHDAY MessageLog entries found — none ever sent.');
    return;
  }

  const byStatus = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`  Total BIRTHDAY log entries: ${logs.length} (showing last 20)\n`);
  console.log('  Status breakdown: ' + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(' | '));
  console.log('');

  for (const log of logs) {
    const masked = log.phone ? `${log.phone.slice(0, 4)}****${log.phone.slice(-3)}` : '—';
    const errSnip = log.errorMessage ? ` err="${log.errorMessage.slice(0, 60)}"` : '';
    console.log(
      `  ${log.createdAt.toISOString().slice(0, 16)}  ${log.status.padEnd(8)}  ${log.provider?.padEnd(6) ?? '—'.padEnd(6)}  ` +
      `${masked}  club=${log.clubMemberId ? '✓' : '—'}  rest="${log.restaurant.name}"${errSnip}`,
    );
  }
}

// ── 4. Sandbox Test ──────────────────────────────────────────────────────────
async function runSandboxTest(slug: string, phone: string, send: boolean) {
  hr('4. SANDBOX TEST');

  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug },
    select: { id: true, name: true, timezone: true, settings: true },
  });
  if (!restaurant) { console.error(`  Restaurant not found: ${slug}`); return null; }

  const s = (restaurant.settings ?? {}) as Record<string, unknown>;
  if (s.smsEnabled !== true || s.ironClubEnabled === false) {
    console.error(`  Restaurant ${slug} does not have smsEnabled=true or ironClubEnabled. Run enable-sms.ts first.`);
    return null;
  }

  const tz      = restaurant.timezone ?? 'Asia/Jerusalem';
  const daysBef = typeof s.clubBirthdaySmsDaysBefore === 'number' ? s.clubBirthdaySmsDaysBefore : 7;
  // Birthday should be (daysBefore) days from now so it triggers today
  const bdayDate = addDays(new Date(), daysBef);
  const birthday = getMmDd(bdayDate, tz);

  console.log(`  Restaurant:  ${restaurant.name} (${slug})`);
  console.log(`  Test phone:  ${phone}`);
  console.log(`  daysBefore:  ${daysBef}`);
  console.log(`  Birthday:    ${birthday}  (triggers today's batch)`);
  console.log(`  Mode:        ${send ? 'REAL SEND' : 'DRY RUN'}`);

  // Find or create a sandbox guest
  const SANDBOX_MARKER = '__birthday_sandbox__';
  let guest = await prisma.guest.findFirst({
    where: { restaurantId: restaurant.id, phone },
    select: { id: true },
  });
  if (!guest) {
    guest = await prisma.guest.create({
      data: {
        restaurantId: restaurant.id,
        phone,
        firstName:    'בדיקה',
        lastName:     SANDBOX_MARKER,
        visitCount:   0,
      },
    });
    console.log(`\n  Created sandbox guest: ${guest.id}`);
  } else {
    console.log(`\n  Reusing existing guest: ${guest.id}`);
  }

  // Remove stale MessageLog dedup entry (330-day lookback) so test can fire
  const cutoff = new Date(Date.now() - 330 * 24 * 60 * 60 * 1000);
  const existingMember = await prisma.clubMember.findFirst({
    where: { restaurantId: restaurant.id, guestId: guest.id },
    select: { id: true },
  });

  if (existingMember) {
    // Clear any prior BIRTHDAY log for this member so dedup doesn't block us
    const cleared = await prisma.messageLog.deleteMany({
      where: {
        clubMemberId: existingMember.id,
        messageType:  'BIRTHDAY',
        createdAt:    { gte: cutoff },
      },
    });
    if (cleared.count > 0) {
      console.log(`  Cleared ${cleared.count} prior dedup MessageLog entry(ies) for sandbox member`);
    }
    // Update birthday to today's trigger date
    await prisma.clubMember.update({
      where: { id: existingMember.id },
      data:  { birthday, smsConsent: true, status: 'ACTIVE' },
    });
    console.log(`  Updated sandbox member: ${existingMember.id}`);
  } else {
    const member = await prisma.clubMember.create({
      data: {
        restaurantId: restaurant.id,
        guestId:      guest.id,
        status:       'ACTIVE',
        birthday,
        smsConsent:   true,
        marketingConsent: false,
        source:       'MANUAL',
        joinDate:     new Date(),
      },
    });
    console.log(`  Created sandbox member: ${member.id}`);
  }

  // Count eligible before run
  const eligible = await prisma.clubMember.count({
    where: {
      restaurantId: restaurant.id,
      status:       'ACTIVE',
      birthday,
      OR: [{ smsConsent: true }, { marketingConsent: true }],
    },
  });
  console.log(`\n  Eligible for today's batch (birthday=${birthday}): ${eligible}`);

  if (!send) {
    console.log('\n  Running DRY RUN ...');
    const result = await runClubBirthdaySmsBatch(restaurant.id, true);
    console.log(`\n  Dry run result: sent=${result.sent} skipped=${result.skipped}`);
    console.log('  (Check console above for DRY-RUN preview lines)');
    return { restaurantId: restaurant.id, birthday };
  }

  // Real send
  console.log('\n  ⚡ Running REAL SEND (dryRun=false) ...');
  const before = await prisma.messageLog.count({ where: { restaurantId: restaurant.id, messageType: 'BIRTHDAY' } });
  const result = await runClubBirthdaySmsBatch(restaurant.id, false);
  const after  = await prisma.messageLog.count({ where: { restaurantId: restaurant.id, messageType: 'BIRTHDAY' } });

  console.log(`\n  Batch result: sent=${result.sent} skipped=${result.skipped}`);
  console.log(`  MessageLog rows before: ${before}  after: ${after}  delta: ${after - before}`);

  // Show the new log entry
  const logs = await prisma.messageLog.findMany({
    where:   { restaurantId: restaurant.id, messageType: 'BIRTHDAY' },
    orderBy: { createdAt: 'desc' },
    take:    3,
    select:  { id: true, status: true, provider: true, phone: true, body: true, errorMessage: true, providerMessageId: true },
  });
  console.log('\n  Latest BIRTHDAY log entries:');
  for (const log of logs) {
    const masked = log.phone ? `${log.phone.slice(0, 4)}****${log.phone.slice(-3)}` : '—';
    console.log(`    id=${log.id}  status=${log.status}  prov=${log.provider}  phone=${masked}  provMsgId=${log.providerMessageId ?? '—'}`);
    if (log.errorMessage) console.log(`    error: ${log.errorMessage}`);
    console.log(`    body: "${log.body?.slice(0, 80)}"`);
  }

  // Dedup verification — re-run should skip
  console.log('\n  Dedup check: re-running batch ...');
  const result2 = await runClubBirthdaySmsBatch(restaurant.id, false);
  console.log(`  Second run: sent=${result2.sent} skipped=${result2.skipped}  ${result2.sent === 0 ? '✓ Dedup working' : '✗ Dedup FAILED — duplicate sent!'}`);

  return { restaurantId: restaurant.id, birthday };
}

// ── 5. Cleanup ───────────────────────────────────────────────────────────────
async function cleanup(restaurantId: string) {
  hr('5. CLEANUP');
  const guests = await prisma.guest.findMany({
    where: { restaurantId, lastName: '__birthday_sandbox__' },
    select: { id: true },
  });
  if (guests.length === 0) { console.log('  Nothing to clean up.'); return; }

  for (const g of guests) {
    await prisma.messageLog.deleteMany({ where: { guestId: g.id } });
    await prisma.guestReward.deleteMany({ where: { guestId: g.id } });
    await prisma.clubMember.deleteMany({ where: { guestId: g.id } });
    await prisma.guest.delete({ where: { id: g.id } });
  }
  console.log(`  Removed ${guests.length} sandbox guest(s) and all related records.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║        IRON CLUB — Birthday SMS Verification              ║');
  console.log(`║        ${new Date().toISOString().slice(0, 19).replace('T', ' ')}                              ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  if (doSend && !testPhone) {
    console.error('\n  ERROR: --send requires --test-phone <phone>\n');
    process.exit(1);
  }
  if (doSend && !targetSlug) {
    console.error('\n  ERROR: --send requires --slug <restaurant-slug>\n');
    process.exit(1);
  }

  // Resolve restaurantId for targeted runs
  let restaurantId: string | undefined;
  if (targetSlug) {
    const r = await prisma.restaurant.findUnique({ where: { slug: targetSlug }, select: { id: true } });
    if (!r) { console.error(`Restaurant not found: ${targetSlug}`); process.exit(1); }
    restaurantId = r.id;
  }

  // Always run env + DB + log audits
  auditEnv();
  await auditDatabase(restaurantId);
  await auditMessageLog(restaurantId);

  let sandboxResult: { restaurantId: string; birthday: string } | null = null;

  if (testPhone && targetSlug) {
    sandboxResult = await runSandboxTest(targetSlug, testPhone, doSend);
  } else if (doDryRun && targetSlug && restaurantId) {
    hr('4. DRY RUN (no sandbox member)');
    const result = await runClubBirthdaySmsBatch(restaurantId, true);
    console.log(`  Result: sent=${result.sent} skipped=${result.skipped}`);
  } else {
    hr('4. SANDBOX TEST');
    console.log('  Skipped — pass --slug <slug> --test-phone <phone> [--send] to run');
  }

  if (doCleanup && sandboxResult) {
    await cleanup(sandboxResult.restaurantId);
  }

  // Final verdict
  hr('VERDICT');
  const schedulerEnabled = process.env.REMINDER_SCHEDULER_ENABLED === 'true';
  const dryRunActive     = process.env.REMINDER_SCHEDULER_DRY_RUN !== 'false';
  const inforuSet        = !!process.env.INFORU_BASIC_AUTH?.trim();

  if (!schedulerEnabled) {
    console.log('  RESULT: NOT VERIFIED');
    console.log('  Reason: REMINDER_SCHEDULER_ENABLED is not "true"');
    console.log('  Fix:    Set REMINDER_SCHEDULER_ENABLED=true on Render');
  } else if (dryRunActive) {
    console.log('  RESULT: NOT VERIFIED (DRY_RUN MODE)');
    console.log('  Reason: REMINDER_SCHEDULER_DRY_RUN is not explicitly "false"');
    console.log('  Fix:    Set REMINDER_SCHEDULER_DRY_RUN=false on Render');
  } else if (!inforuSet) {
    console.log('  RESULT: NOT VERIFIED (MOCK PROVIDER)');
    console.log('  Reason: INFORU_BASIC_AUTH is not set — all sends use MOCK provider');
    console.log('  Fix:    Set INFORU_BASIC_AUTH=<base64creds> on Render');
  } else {
    console.log('  RESULT: CONFIGURATION OK — birthday SMS can reach real phones');
    console.log('  To confirm end-to-end: run with --slug <slug> --test-phone <phone> --send --cleanup');
  }
  console.log('');
}

main()
  .catch(e => { console.error('\nFATAL:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
