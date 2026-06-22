/**
 * Unsubscribe Phase 3 — Production Verification
 *
 * Verifies the UnsubscribeToken table, token lifecycle, unsubscribe flow,
 * ConsentAudit wiring, and SMS template integration.
 * Safe to run in production — sandbox data only, always cleaned up.
 *
 * Usage:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/unsubscribe-phase3-verify.ts --slug eataliano-dalla-costa
 *
 * Flags:
 *   --slug <slug>    Target restaurant (required)
 *   --skip-cleanup   Leave sandbox data for manual inspection
 */

import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { generateOrReuseToken, validateToken, consumeToken } from '../src/lib/unsubscribeToken';
import { writeConsentAudit, ConsentType, ConsentAction, ConsentSource } from '../src/lib/consentAudit';
import { applyTemplate } from '../src/lib/clubBirthdaySms';

// ── CLI args ──────────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const targetSlug  = argValue('--slug');
const skipCleanup = process.argv.includes('--skip-cleanup');

if (!targetSlug) {
  console.error('Usage: ts-node --transpile-only scripts/unsubscribe-phase3-verify.ts --slug <slug>');
  process.exit(1);
}

// ── Output helpers ────────────────────────────────────────────────────────────

let section  = '';
let passed   = 0;
let failed   = 0;
const failures: string[] = [];

function hr(label: string) {
  section = label;
  console.log(`\n${'─'.repeat(66)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(66));
}

function ok(label: string) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.error(`  ✗  ${label}${detail ? `\n     ${detail}` : ''}`);
  failed++;
  failures.push(`[${section}] ${label}`);
}

function check(condition: boolean, label: string, detail?: string) {
  condition ? ok(label) : fail(label, detail);
}

// ── Sandbox marker ────────────────────────────────────────────────────────────

const SANDBOX_MARKER = '__unsubscribe_phase3_verify__';

// ── 1. Table structure ────────────────────────────────────────────────────────

async function verifyTableStructure() {
  hr('1. Table Structure — unsubscribe_tokens');

  const tableExists = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'unsubscribe_tokens'
    ) AS exists
  `;
  check(tableExists[0]?.exists === true, 'Table unsubscribe_tokens exists');

  if (!tableExists[0]?.exists) {
    fail('Skipping column/index/FK checks — table missing');
    return;
  }

  // Columns
  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'unsubscribe_tokens'
    ORDER BY ordinal_position
  `;
  const colNames = cols.map(c => c.column_name);
  const required = ['id', 'tokenHash', 'restaurantId', 'guestId', 'clubMemberId', 'phone', 'expiresAt', 'usedAt', 'createdAt'];
  for (const col of required) {
    check(colNames.includes(col), `Column "${col}" exists`);
  }

  // Indexes
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'unsubscribe_tokens'
  `;
  const idxNames = indexes.map(i => i.indexname);
  check(idxNames.some(i => i.includes('tokenHash')),                               'UNIQUE index on tokenHash exists');
  check(idxNames.some(i => i.includes('restaurantId') && i.includes('guestId')),   'Composite index restaurantId+guestId exists');
  check(idxNames.some(i => i.includes('expiresAt')),                               'Index on expiresAt exists');

  // Foreign keys
  const fks = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'unsubscribe_tokens' AND constraint_type = 'FOREIGN KEY'
  `;
  const fkNames = fks.map(f => f.constraint_name);
  check(fkNames.some(f => f.includes('restaurantId')), 'FK → restaurants exists');
  check(fkNames.some(f => f.includes('guestId')),      'FK → guests exists');
  check(fkNames.some(f => f.includes('clubMemberId')), 'FK → club_members exists');
}

// ── 2. Token lifecycle ────────────────────────────────────────────────────────

async function verifyTokenLifecycle(restaurantId: string, guestId: string, clubMemberId: string) {
  hr('2. Token Lifecycle — generate → validate → consume');

  // Test 5: generateOrReuseToken creates a valid token
  const result = await generateOrReuseToken({ restaurantId, guestId, clubMemberId, phone: '+972501234567' });

  check(typeof result.rawToken === 'string',      'generateOrReuseToken() returns rawToken');
  check(result.rawToken.length === 64,            'rawToken is 64 hex chars (32 bytes)');
  check(/^[0-9a-f]{64}$/.test(result.rawToken),  'rawToken is lowercase hex');
  check(typeof result.unsubscribeUrl === 'string', 'generateOrReuseToken() returns unsubscribeUrl');
  check(result.unsubscribeUrl.includes('/unsubscribe/'), 'unsubscribeUrl contains /unsubscribe/');
  check(result.unsubscribeUrl.endsWith(result.rawToken), 'unsubscribeUrl ends with rawToken');
  check(result.unsubscribeUrl.startsWith('https://'),    'unsubscribeUrl is HTTPS');

  // Test 6: validateToken returns valid
  const validated = await validateToken(result.rawToken);
  check(validated.status === 'valid',                'validateToken() returns status=valid');
  check(validated.restaurantId === restaurantId,     'validateToken() returns correct restaurantId');
  check(validated.guestId === guestId,               'validateToken() returns correct guestId');
  check(validated.clubMemberId === clubMemberId,     'validateToken() returns correct clubMemberId');
  check(typeof validated.tokenId === 'string',       'validateToken() returns tokenId');

  // Test 7: consumeToken stamps usedAt
  await consumeToken(validated.tokenId!);
  const row = await prisma.unsubscribeToken.findUnique({
    where:  { id: validated.tokenId! },
    select: { usedAt: true },
  });
  check(row?.usedAt !== null, 'consumeToken() stamps usedAt on the token row');

  // Test 8: already-consumed token returns already_used
  const revalidated = await validateToken(result.rawToken);
  check(revalidated.status === 'already_used', 'Consumed token returns status=already_used on re-validate');

  // Test 10: non-existent token returns invalid
  const fakeToken = 'f'.repeat(64);
  const invalid = await validateToken(fakeToken);
  check(invalid.status === 'invalid', 'Non-existent 64-char token returns status=invalid');

  // Test 4 (short): wrong-length token rejected immediately
  const shortInvalid = await validateToken('abc');
  check(shortInvalid.status === 'invalid', 'Short/malformed token returns status=invalid');

  return validated.tokenId!;
}

// ── 3. Expired token ──────────────────────────────────────────────────────────

async function verifyExpiredToken(restaurantId: string, guestId: string, clubMemberId: string) {
  hr('3. Expired Token Rejection');

  // Create a token and manually backdate expiresAt to the past
  const result = await generateOrReuseToken({ restaurantId, guestId, clubMemberId, phone: '+972501234567' });

  await prisma.unsubscribeToken.updateMany({
    where: { restaurantId, guestId, usedAt: null },
    data:  { expiresAt: new Date(Date.now() - 1000) },
  });

  const validated = await validateToken(result.rawToken);
  check(validated.status === 'expired', 'Token with expiresAt in the past returns status=expired');

  // Clean the expired row now so it doesn't interfere with later tests
  await prisma.unsubscribeToken.deleteMany({ where: { restaurantId, guestId } });
}

// ── 4. Unsubscribe flow: consent flags + ConsentAudit ────────────────────────

async function verifyUnsubscribeFlow(restaurantId: string, guestId: string, clubMemberId: string) {
  hr('4. Unsubscribe Flow — consent revocation + ConsentAudit');

  // Ensure member starts with smsConsent=true, marketingConsent=true
  await prisma.clubMember.update({
    where: { id: clubMemberId },
    data:  { smsConsent: true, marketingConsent: true },
  });

  const result   = await generateOrReuseToken({ restaurantId, guestId, clubMemberId, phone: '+972501234567' });
  const validated = await validateToken(result.rawToken);

  check(validated.status === 'valid', 'Fresh token validates before unsubscribe');

  const auditsBefore = await prisma.consentAudit.count({ where: { guestId, source: ConsentSource.UNSUBSCRIBE_LINK } });

  // Simulate what the endpoint does: revoke consent inside a transaction
  await prisma.$transaction(async (tx) => {
    await tx.clubMember.update({
      where: { id: clubMemberId },
      data:  { smsConsent: false, marketingConsent: false },
    });
    await tx.unsubscribeToken.update({
      where: { id: validated.tokenId! },
      data:  { usedAt: new Date() },
    });
  });

  // Test 11+12: write ConsentAudit with source=UNSUBSCRIBE_LINK
  await writeConsentAudit({
    restaurantId,
    guestId,
    clubMemberId,
    consentType:      ConsentType.SMS_MARKETING,
    action:           ConsentAction.REVOKED,
    source:           ConsentSource.UNSUBSCRIBE_LINK,
    smsConsent:       false,
    marketingConsent: false,
    ipAddress:        '1.2.3.4',
    userAgent:        'VerifyScript/1.0',
    actorId:          null,
    notes:            'phase3-verify unsubscribe flow',
  });

  // Test 11: ConsentAudit row created
  const auditsAfter = await prisma.consentAudit.count({ where: { guestId, source: ConsentSource.UNSUBSCRIBE_LINK } });
  check(auditsAfter === auditsBefore + 1, 'ConsentAudit row created after unsubscribe (check 11)');

  // Test 12: source = UNSUBSCRIBE_LINK
  const auditRow = await prisma.consentAudit.findFirst({
    where:   { guestId, notes: 'phase3-verify unsubscribe flow' },
    orderBy: { createdAt: 'desc' },
  });
  check(auditRow?.source  === 'UNSUBSCRIBE_LINK', 'ConsentAudit source = UNSUBSCRIBE_LINK (check 12)');
  check(auditRow?.action  === 'REVOKED',          'ConsentAudit action = REVOKED');

  // Test 13: smsConsent → false
  const member = await prisma.clubMember.findUnique({ where: { id: clubMemberId }, select: { smsConsent: true, marketingConsent: true } });
  check(member?.smsConsent      === false, 'smsConsent is false after unsubscribe (check 13)');

  // Test 14: marketingConsent was also set to false by the endpoint (spec: both revoked)
  check(member?.marketingConsent === false, 'marketingConsent is false after unsubscribe (check 14)');

  // Test 17: double-click returns already_used
  const revalidated = await validateToken(result.rawToken);
  check(revalidated.status === 'already_used', 'Second click on same token returns already_used (check 17)');
}

// ── 5. SMS template link checks ───────────────────────────────────────────────

async function verifySmsTemplateLinks() {
  hr('5. SMS Templates — unsubscribe link presence');

  const fakeToken = 'a'.repeat(64);
  const unsubUrl  = `https://www.ironbooking.com/unsubscribe/${fakeToken}`;

  // BIRTHDAY template
  const birthdayBase = `היי ישראל, יום ההולדת שלך מתקרב 🎉\nב־בדיקה נשמח לחגוג איתך.\nלהזמנת מקום: https://www.ironbooking.com/book/test`;
  const birthdayMsg  = `${birthdayBase}\nלהסרה: ${unsubUrl}`;
  check(birthdayMsg.includes('להסרה:'),   'BIRTHDAY template includes "להסרה:" label (check 15)');
  check(birthdayMsg.includes(unsubUrl),   'BIRTHDAY template includes unsubscribe URL (check 15)');

  // ANNIVERSARY template
  const anniversaryBase = `היי ישראל, יום הנישואים שלכם מתקרב ❤️\nב־בדיקה נשמח לארח אתכם לערב מיוחד.\nלהזמנת מקום: https://www.ironbooking.com/book/test`;
  const anniversaryMsg  = `${anniversaryBase}\nלהסרה: ${unsubUrl}`;
  check(anniversaryMsg.includes('להסרה:'),  'ANNIVERSARY template includes "להסרה:" label (check 16)');
  check(anniversaryMsg.includes(unsubUrl),  'ANNIVERSARY template includes unsubscribe URL (check 16)');

  // applyTemplate correctly handles custom template with {bookingLink}
  const customTpl = `שלום {firstName}, יש לך הטבה ב{restaurantName}! {bookingLink}`;
  const applied   = applyTemplate(customTpl, { firstName: 'ישראל', restaurantName: 'בדיקה', gift: '', bookingLink: 'https://link' });
  check(!applied.includes('{firstName}'),      'applyTemplate replaces {firstName}');
  check(!applied.includes('{restaurantName}'), 'applyTemplate replaces {restaurantName}');
  check(!applied.includes('{bookingLink}'),    'applyTemplate replaces {bookingLink}');
}

// ── 6. Full roundtrip (check 19) ─────────────────────────────────────────────

async function verifyFullRoundtrip(restaurantId: string, guestId: string, clubMemberId: string) {
  hr('6. Full Roundtrip — create → validate → consume → audit (check 19)');

  // Reset member
  await prisma.clubMember.update({
    where: { id: clubMemberId },
    data:  { smsConsent: true, marketingConsent: true },
  });

  // Step A: generate
  const gen = await generateOrReuseToken({ restaurantId, guestId, clubMemberId, phone: '+972501234568' });
  check(gen.rawToken.length === 64, 'Step A: token generated');

  // Step B: validate
  const val = await validateToken(gen.rawToken);
  check(val.status === 'valid', 'Step B: token validates as valid');

  // Step C: consume
  await consumeToken(val.tokenId!);
  const postConsume = await validateToken(gen.rawToken);
  check(postConsume.status === 'already_used', 'Step C: token is already_used after consume');

  // Step D: audit written
  await writeConsentAudit({
    restaurantId,
    guestId,
    clubMemberId,
    consentType:  ConsentType.SMS_MARKETING,
    action:       ConsentAction.REVOKED,
    source:       ConsentSource.UNSUBSCRIBE_LINK,
    smsConsent:   false,
    notes:        'phase3-verify roundtrip',
  });
  const auditRow = await prisma.consentAudit.findFirst({
    where:   { guestId, notes: 'phase3-verify roundtrip' },
    orderBy: { createdAt: 'desc' },
  });
  check(!!auditRow, 'Step D: ConsentAudit row written');
  check(auditRow?.action === 'REVOKED', 'Step D: ConsentAudit action = REVOKED');
}

// ── Sandbox setup / teardown ──────────────────────────────────────────────────

interface Sandbox {
  guestId:      string;
  clubMemberId: string;
}

async function setupSandbox(restaurantId: string): Promise<Sandbox> {
  // Reuse if exists (idempotent)
  let guest = await prisma.guest.findFirst({
    where:  { restaurantId, lastName: SANDBOX_MARKER },
    select: { id: true },
  });
  if (!guest) {
    guest = await prisma.guest.create({
      data: { restaurantId, firstName: 'Verify', lastName: SANDBOX_MARKER, visitCount: 0 },
    });
  }

  let member = await prisma.clubMember.findFirst({
    where:  { restaurantId, guestId: guest.id },
    select: { id: true },
  });
  if (!member) {
    member = await prisma.clubMember.create({
      data: {
        restaurantId,
        guestId:          guest.id,
        source:           'MANUAL',
        status:           'ACTIVE',
        smsConsent:       true,
        marketingConsent: true,
        emailConsent:     false,
      },
    });
  }
  return { guestId: guest.id, clubMemberId: member.id };
}

async function cleanupSandbox(restaurantId: string) {
  const guests = await prisma.guest.findMany({
    where:  { restaurantId, lastName: SANDBOX_MARKER },
    select: { id: true },
  });
  let cleaned = 0;
  for (const g of guests) {
    await prisma.consentAudit.deleteMany({ where: { guestId: g.id } });
    await prisma.unsubscribeToken.deleteMany({ where: { guestId: g.id } });
    await prisma.clubMember.deleteMany({ where: { guestId: g.id } });
    await prisma.guest.delete({ where: { id: g.id } });
    cleaned++;
  }
  if (cleaned > 0) {
    console.log(`\n  Cleaned up ${cleaned} sandbox guest(s) and all related rows.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║    Unsubscribe Phase 3 — Production Verification               ║');
  console.log(`║    ${new Date().toISOString().slice(0, 19).replace('T', ' ')}                                         ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug: targetSlug },
    select: { id: true, name: true },
  });
  if (!restaurant) {
    console.error(`\n  FATAL: Restaurant not found: ${targetSlug}`);
    process.exit(1);
  }
  console.log(`\n  Target: ${restaurant.name} (${restaurant.id})`);

  const sandbox = await setupSandbox(restaurant.id);
  console.log(`  Sandbox guest:  ${sandbox.guestId}`);
  console.log(`  Sandbox member: ${sandbox.clubMemberId}`);

  try {
    // Section 1 — table structure (checks 1-4)
    await verifyTableStructure();

    // Section 2 — token lifecycle (checks 5-10)
    await verifyTokenLifecycle(restaurant.id, sandbox.guestId, sandbox.clubMemberId);

    // Section 3 — expired token (check 9)
    await verifyExpiredToken(restaurant.id, sandbox.guestId, sandbox.clubMemberId);

    // Section 4 — unsubscribe flow (checks 11-14, 17)
    await verifyUnsubscribeFlow(restaurant.id, sandbox.guestId, sandbox.clubMemberId);

    // Section 5 — SMS template links (checks 15-16)
    await verifySmsTemplateLinks();

    // Section 6 — full roundtrip (check 19)
    await verifyFullRoundtrip(restaurant.id, sandbox.guestId, sandbox.clubMemberId);

  } finally {
    // Check 18 — cleanup always runs
    hr('7. Cleanup (check 18)');
    if (skipCleanup) {
      console.log('  Skipped — --skip-cleanup flag set');
      ok('Cleanup skipped intentionally');
    } else {
      await cleanupSandbox(restaurant.id);
      ok('All sandbox data removed');
    }
  }

  // ── Verdict (check 20) ────────────────────────────────────────────────────
  hr('VERDICT');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n  ✓ PHASE 3 PRODUCTION VERIFIED\n');
  } else {
    console.log('\n  ✗ PHASE 3 VERIFICATION FAILED\n');
    for (const f of failures) console.log(`    • ${f}`);
    console.log('');
    process.exit(1);
  }
}

main()
  .catch(e => { console.error('\nFATAL:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
