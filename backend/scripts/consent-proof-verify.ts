/**
 * Phase 4 — Consent Proof Export — Verification
 *
 * Tests GET /api/guests/:id/consent-proof end-to-end:
 * - Auth gate (401, 404, cross-tenant)
 * - HTML download: Content-Type, Content-Disposition, charset
 * - Proof contents: guest name, restaurant name, audit rows
 * - Privacy: no full IPv4 in output, no raw UA
 * - Empty-guest case: 200 with empty timeline
 * - Phase 2 endpoint unchanged: GET /api/guests/:id/consent-audit still works
 *
 * Usage (local):
 *   npx ts-node --transpile-only scripts/consent-proof-verify.ts --slug eataliano-dalla-costa
 *
 * Usage (production):
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/consent-proof-verify.ts \
 *     --slug eataliano-dalla-costa \
 *     --api https://iron-booking.onrender.com/api \
 *     --jwt-secret "<prod-secret>"
 */

import dotenv from 'dotenv';
dotenv.config();

import jwt    from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { writeConsentAudit, ConsentType, ConsentAction, ConsentSource } from '../src/lib/consentAudit';

// ── Args ──────────────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const targetSlug   = argValue('--slug')       ?? 'eataliano-dalla-costa';
const API_BASE     = argValue('--api')        ?? 'http://localhost:3001/api';
const jwtSecretArg = argValue('--jwt-secret');
const skipCleanup  = process.argv.includes('--skip-cleanup');
const JWT_SECRET   = jwtSecretArg ?? process.env.JWT_SECRET ?? 'iron-booking-dev-secret-change-in-prod';

// ── Output helpers ────────────────────────────────────────────────────────────

let section  = '';
let passed   = 0;
let failed   = 0;
const failures: string[] = [];

function hr(label: string) {
  section = label;
  console.log(`\n${'─'.repeat(68)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(68));
}
function ok(label: string)   { console.log(`  ✓  ${label}`); passed++; }
function fail(label: string, detail?: string) {
  console.error(`  ✗  ${label}${detail ? `\n     ${detail}` : ''}`);
  failed++;
  failures.push(`[${section}] ${label}`);
}
function check(cond: boolean, label: string, detail?: string) {
  cond ? ok(label) : fail(label, detail);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function signToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

async function getHtml(path: string, token: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  if (res.status !== 200 && res.status !== 404) {
    console.log(`  [DEBUG] ${res.status} ${path} → ${body.slice(0, 200)}`);
  }
  return { status: res.status, body, headers };
}

async function getJson(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const SANDBOX = '__proof_verify__';

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║    Phase 4 — Consent Proof Export — Verification                 ║');
  console.log(`║    ${new Date().toISOString().slice(0, 19).replace('T', ' ')}                                           ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug: targetSlug },
    select: { id: true, name: true },
  });
  if (!restaurant) { console.error(`\n  FATAL: Restaurant not found: ${targetSlug}`); process.exit(1); }
  console.log(`\n  Target: ${restaurant.name} (${restaurant.id})`);
  console.log(`  API:    ${API_BASE}`);
  console.log(`  JWT secret source: ${jwtSecretArg ? '--jwt-secret arg' : process.env.JWT_SECRET ? 'JWT_SECRET env' : 'default fallback'} (length=${JWT_SECRET.length})`);

  const superAdmin = await prisma.user.findFirst({
    where:  { role: 'SUPER_ADMIN' },
    select: { id: true, role: true, email: true, firstName: true, lastName: true },
  });
  const adminUser = superAdmin ?? {
    id: 'proof-verify-user', role: 'ADMIN' as const,
    email: 'proof@verify.test', firstName: 'Proof', lastName: 'Verify',
  };

  const authToken = signToken({
    userId:       adminUser.id,
    restaurantId: restaurant.id,
    role:         adminUser.role,
    email:        adminUser.email,
    firstName:    adminUser.firstName,
    lastName:     adminUser.lastName,
  });

  const otherRestaurant = await prisma.restaurant.findFirst({
    where:  { id: { not: restaurant.id } },
    select: { id: true, name: true },
  });

  // ── Sandbox guest ─────────────────────────────────────────────────────────

  let sandboxGuestId = '';

  async function setupSandbox() {
    let guest = await prisma.guest.findFirst({
      where:  { restaurantId: restaurant!.id, lastName: SANDBOX },
      select: { id: true },
    });
    if (!guest) {
      guest = await prisma.guest.create({
        data: { restaurantId: restaurant!.id, firstName: 'ProofTest', lastName: SANDBOX, phone: '+972500000099', visitCount: 0 },
      });
    }
    sandboxGuestId = guest.id;
    console.log(`  Sandbox guest: ${sandboxGuestId}`);
  }

  async function cleanupSandbox() {
    const guests = await prisma.guest.findMany({
      where:  { restaurantId: restaurant!.id, lastName: SANDBOX },
      select: { id: true },
    });
    for (const g of guests) {
      try { await prisma.consentAudit.deleteMany({ where: { guestId: g.id } }); } catch {}
      try { await prisma.unsubscribeToken.deleteMany({ where: { guestId: g.id } }); } catch {}
      await prisma.clubMember.deleteMany({ where: { guestId: g.id } });
      await prisma.guest.delete({ where: { id: g.id } });
    }
    console.log(`\n  Cleaned up ${guests.length} sandbox guest(s).`);
  }

  await setupSandbox();

  try {

    // ── 1. Auth gate — 401 without token ──────────────────────────────────

    hr('1. Auth — unauthenticated request rejected');

    const noAuth = await fetch(`${API_BASE}/guests/${sandboxGuestId}/consent-proof`);
    check(noAuth.status === 401, `No token → 401 (got ${noAuth.status})`);

    // ── 2. 404 for fake guestId ─────────────────────────────────────────

    hr('2. Error Handling — fake guestId returns 404');

    const fakeId = crypto.randomUUID();
    const notFound = await getHtml(`/guests/${fakeId}/consent-proof`, authToken);
    check(notFound.status === 404, `Fake guestId → 404 (got ${notFound.status})`);

    // ── 3. Cross-tenant isolation ─────────────────────────────────────────

    hr('3. Cross-Tenant Isolation — other restaurant JWT cannot access guest');

    if (otherRestaurant) {
      const otherToken = signToken({
        userId: 'cross-tenant-user', restaurantId: otherRestaurant.id,
        role: 'ADMIN', email: 'other@test', firstName: 'Other', lastName: 'Restaurant',
      });
      const cross = await getHtml(`/guests/${sandboxGuestId}/consent-proof`, otherToken);
      check(cross.status === 404, `Cross-tenant → 404 (got ${cross.status})`);
    } else {
      ok('Cross-tenant skipped — only one restaurant in DB');
    }

    // ── 4. Empty guest — no audit rows ────────────────────────────────────

    hr('4. Empty Guest — 200 HTML with empty timeline');

    const empty = await getHtml(`/guests/${sandboxGuestId}/consent-proof`, authToken);
    check(empty.status === 200, `Empty guest → 200 (got ${empty.status})`);
    check(
      (empty.headers['content-type'] ?? '').includes('text/html'),
      `Content-Type is text/html (got "${empty.headers['content-type']}")`
    );
    check(
      (empty.headers['content-disposition'] ?? '').includes('attachment'),
      `Content-Disposition includes attachment (got "${empty.headers['content-disposition']}")`
    );
    check(
      (empty.headers['content-disposition'] ?? '').includes('.html'),
      'Filename ends in .html'
    );
    check(empty.body.includes('ProofTest'), 'Guest first name in document');
    check(empty.body.includes(restaurant.name), 'Restaurant name in document');
    check(empty.body.includes('אין היסטוריית הרשאות'), 'Empty-timeline message present');
    check(empty.body.includes('dir="rtl"'), 'Document is RTL');
    check(empty.body.includes('lang="he"'), 'Document language is Hebrew');

    // ── 5. With audit rows — write then fetch ─────────────────────────────

    hr('5. With Audit Rows — IP masked, UA summarised, timeline present');

    await writeConsentAudit({
      restaurantId:    restaurant.id,
      guestId:         sandboxGuestId,
      consentType:     ConsentType.CLUB_MEMBERSHIP,
      action:          ConsentAction.GRANTED,
      source:          ConsentSource.BOOKING_FLOW,
      smsConsent:      true,
      marketingConsent: false,
      ipAddress:       '5.6.7.8',
      userAgent:       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125',
      notes:           'proof-verify-grant',
    });

    await writeConsentAudit({
      restaurantId:    restaurant.id,
      guestId:         sandboxGuestId,
      consentType:     ConsentType.SMS_MARKETING,
      action:          ConsentAction.REVOKED,
      source:          ConsentSource.UNSUBSCRIBE_LINK,
      smsConsent:      false,
      marketingConsent: false,
      ipAddress:       '9.10.11.12',
      userAgent:       'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit',
      notes:           'proof-verify-revoke',
    });

    const dbCount = await prisma.consentAudit.count({ where: { guestId: sandboxGuestId } });
    check(dbCount === 2, `DB has 2 consent rows for sandbox guest (got ${dbCount})`);

    const withRows = await getHtml(`/guests/${sandboxGuestId}/consent-proof`, authToken);
    check(withRows.status === 200, `With rows → 200 (got ${withRows.status})`);

    // Privacy: no full IPv4
    const hasFullIp = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(withRows.body);
    check(!hasFullIp, 'No full IPv4 address in document');

    // Privacy: no raw UA
    const hasRawUA = withRows.body.includes('Mozilla/5.0');
    check(!hasRawUA, 'No raw user-agent string in document');

    // Masked IPs present (5.6.x.x and 9.10.x.x)
    check(withRows.body.includes('5.6.x.x'),  'Masked IP 5.6.x.x in document');
    check(withRows.body.includes('9.10.x.x'), 'Masked IP 9.10.x.x in document');

    // Summarised UAs
    check(withRows.body.includes('Chrome'),     'Summarised UA "Chrome" in document');
    check(withRows.body.includes('iOS Safari'), 'Summarised UA "iOS Safari" in document');

    // Source labels (Hebrew)
    check(withRows.body.includes('הזמנה אונליין'), 'Hebrew source "הזמנה אונליין" in document');
    check(withRows.body.includes('קישור הסרה'),    'Hebrew source "קישור הסרה" in document');

    // Action labels
    check(withRows.body.includes('אישור'), 'Action "אישור" in document');
    check(withRows.body.includes('הסרה'),  'Action "הסרה" in document');

    // Notes preserved
    check(withRows.body.includes('proof-verify-grant'), 'Notes field included');

    // ── 6. Phase 2 endpoint still works ──────────────────────────────────

    hr('6. Phase 2 Regression — GET /consent-audit still returns JSON');

    const audit = await getJson(`/guests/${sandboxGuestId}/consent-audit`, authToken);
    check(audit.status === 200, `consent-audit → 200 (got ${audit.status})`);
    const auditData = (audit.body as { data?: unknown[] })?.data ?? [];
    check(auditData.length === 2, `consent-audit returns 2 rows (got ${auditData.length})`);

  } finally {
    hr('7. Cleanup');
    if (skipCleanup) {
      ok('Skipped (--skip-cleanup)');
    } else {
      await cleanupSandbox();
      ok('All sandbox data removed');
    }
  }

  // ── Verdict ───────────────────────────────────────────────────────────────

  hr('VERDICT');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n  ✓ PHASE 4 CONSENT PROOF EXPORT — LOCAL PASS\n');
  } else {
    console.log('\n  ✗ PHASE 4 VERIFICATION FAILED\n');
    for (const f of failures) console.log(`    • ${f}`);
    console.log('');
    process.exit(1);
  }
}

main()
  .catch(e => { console.error('\nFATAL:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
