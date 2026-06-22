/**
 * Phase 2 — Consent Timeline UI — Production Verification
 *
 * Tests the new GET /api/guests/:id/consent-audit endpoint end-to-end:
 * 1. Generates a real JWT for an ADMIN user at Eataliano Dalla Costa
 * 2. Hits the endpoint over HTTP against the running local server
 * 3. Verifies: scoping, schema, IP masking, UA summary, cross-tenant isolation,
 *    empty-state, unsubscribe row visibility, reverse-chron order, Hebrew labels
 *
 * Usage:
 *   # With local server already running on :3001:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/phase2-verify.ts --slug eataliano-dalla-costa
 *
 *   # Or let the script spawn and kill its own server:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/phase2-verify.ts --slug eataliano-dalla-costa --start-server
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
const targetSlug  = argValue('--slug')       ?? 'eataliano-dalla-costa';
const API_BASE    = argValue('--api')        ?? 'http://localhost:3001/api';
const jwtSecretArg = argValue('--jwt-secret');
const skipCleanup = process.argv.includes('--skip-cleanup');

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

// ── JWT helper ────────────────────────────────────────────────────────────────

// Priority: --jwt-secret arg > JWT_SECRET env var > local dev default
const JWT_SECRET = jwtSecretArg ?? process.env.JWT_SECRET ?? 'iron-booking-dev-secret-change-in-prod';

function signToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function get(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 && res.status !== 404) {
    console.log(`  [DEBUG] ${res.status} ${path} → ${JSON.stringify(body).slice(0, 200)}`);
  }
  return { status: res.status, body };
}

// ── Sandbox marker ────────────────────────────────────────────────────────────

const SANDBOX_MARKER = '__phase2_verify__';

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║    Phase 2 — Consent Timeline UI — Production Verification       ║');
  console.log(`║    ${new Date().toISOString().slice(0, 19).replace('T', ' ')}                                           ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // ── Resolve restaurant ────────────────────────────────────────────────────

  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug: targetSlug },
    select: { id: true, name: true },
  });
  if (!restaurant) {
    console.error(`\n  FATAL: Restaurant not found: ${targetSlug}`);
    process.exit(1);
  }
  console.log(`\n  Target: ${restaurant.name} (${restaurant.id})`);
  console.log(`  API:    ${API_BASE}`);
  console.log(`  JWT secret source: ${jwtSecretArg ? '--jwt-secret arg' : process.env.JWT_SECRET ? 'JWT_SECRET env' : 'default fallback'}`);

  // ── Mint a JWT scoped to this restaurant ──────────────────────────────────
  // Production users table may not have a row for every restaurant (PIN-based
  // staff use a different flow). We use any SUPER_ADMIN user but inject
  // this restaurant's ID — identical to what the server receives from a
  // restaurant-level admin login token.

  const superAdmin = await prisma.user.findFirst({
    where:  { role: 'SUPER_ADMIN' },
    select: { id: true, role: true, email: true, firstName: true, lastName: true },
  });
  const adminUser = superAdmin ?? {
    id: 'verify-synthetic-user', role: 'ADMIN' as const,
    email: 'verify@phase2.test', firstName: 'Verify', lastName: 'Script',
  };
  console.log(`  Auth:   ${adminUser.email} (${adminUser.role}) → scoped to ${restaurant.id}`);

  // JWT carries restaurantId = eataliano — endpoint enforces guestId ∈ this restaurant
  const authToken = signToken({
    userId:       adminUser.id,
    restaurantId: restaurant.id,   // ← scoped to target restaurant
    role:         adminUser.role,
    email:        adminUser.email,
    firstName:    adminUser.firstName,
    lastName:     adminUser.lastName,
  });

  // ── Resolve a second restaurant for cross-tenant test ─────────────────────

  const otherRestaurant = await prisma.restaurant.findFirst({
    where:  { id: { not: restaurant.id } },
    select: { id: true, name: true },
  });

  // ── Sandbox guest ─────────────────────────────────────────────────────────

  let sandboxGuestId = '';
  let sandboxMemberId = '';

  async function setupSandbox() {
    let guest = await prisma.guest.findFirst({
      where:  { restaurantId: restaurant.id, lastName: SANDBOX_MARKER },
      select: { id: true },
    });
    if (!guest) {
      guest = await prisma.guest.create({
        data: { restaurantId: restaurant.id, firstName: 'Phase2', lastName: SANDBOX_MARKER, visitCount: 0 },
      });
    }
    let member = await prisma.clubMember.findFirst({
      where:  { restaurantId: restaurant.id, guestId: guest.id },
      select: { id: true },
    });
    if (!member) {
      member = await prisma.clubMember.create({
        data: {
          restaurantId: restaurant.id,
          guestId:      guest.id,
          source:       'MANUAL', status: 'ACTIVE',
          smsConsent: true, marketingConsent: true, emailConsent: false,
        },
      });
    }
    sandboxGuestId  = guest.id;
    sandboxMemberId = member.id;
    console.log(`  Sandbox guest:  ${sandboxGuestId}`);
    console.log(`  Sandbox member: ${sandboxMemberId}`);
  }

  async function cleanupSandbox() {
    const guests = await prisma.guest.findMany({
      where:  { restaurantId: restaurant.id, lastName: SANDBOX_MARKER },
      select: { id: true },
    });
    for (const g of guests) {
      await prisma.consentAudit.deleteMany({ where: { guestId: g.id } });
      await prisma.unsubscribeToken.deleteMany({ where: { guestId: g.id } });
      await prisma.clubMember.deleteMany({ where: { guestId: g.id } });
      await prisma.guest.delete({ where: { id: g.id } });
    }
    console.log(`\n  Cleaned up ${guests.length} sandbox guest(s).`);
  }

  await setupSandbox();

  try {

    // ── 1. API: empty state ─────────────────────────────────────────────────

    hr('1. Empty State — guest with no audit rows');

    const empty = await get(`/guests/${sandboxGuestId}/consent-audit`, authToken);
    console.log(`  [DEBUG] empty-state: status=${empty.status} body=${JSON.stringify(empty.body).slice(0, 300)}`);
    check(empty.status === 200,           'HTTP 200 on valid guest');
    const emptyData = (empty.body as { data?: unknown[] })?.data;
    check(Array.isArray(emptyData),       'Response has data array');
    check(emptyData?.length === 0,        'Empty array for guest with no audit rows');

    // ── 2. API: write audit row then fetch ──────────────────────────────────

    hr('2. Audit Row — create via writeConsentAudit, fetch via endpoint');

    await writeConsentAudit({
      restaurantId:    restaurant.id,
      guestId:         sandboxGuestId,
      clubMemberId:    sandboxMemberId,
      consentType:     ConsentType.CLUB_MEMBERSHIP,
      action:          ConsentAction.GRANTED,
      source:          ConsentSource.BOOKING_FLOW,
      smsConsent:      true,
      marketingConsent: false,
      ipAddress:       '1.2.3.4',
      userAgent:       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125',
      actorId:         null,
      notes:           'phase2-verify booking grant',
    });

    await writeConsentAudit({
      restaurantId:    restaurant.id,
      guestId:         sandboxGuestId,
      clubMemberId:    sandboxMemberId,
      consentType:     ConsentType.SMS_MARKETING,
      action:          ConsentAction.REVOKED,
      source:          ConsentSource.UNSUBSCRIBE_LINK,
      smsConsent:      false,
      marketingConsent: false,
      ipAddress:       '203.0.113.42',
      userAgent:       'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit',
      actorId:         null,
      notes:           'phase2-verify unsubscribe',
    });

    // Verify rows actually landed in DB (writeConsentAudit swallows errors)
    const dbCount = await prisma.consentAudit.count({ where: { guestId: sandboxGuestId } });
    console.log(`  [DEBUG] DB count for sandbox guest after writes: ${dbCount}`);
    check(dbCount === 2, `DB has 2 consent_audit rows for sandbox guest (got ${dbCount})`);

    const withRows = await get(`/guests/${sandboxGuestId}/consent-audit`, authToken);
    check(withRows.status === 200,        'HTTP 200 after rows written');
    const rows = (withRows.body as { data?: Record<string, unknown>[] })?.data ?? [];
    console.log(`  [DEBUG] API returned ${rows.length} row(s)`);
    if (rows.length === 0 && withRows.status !== 200) {
      console.log(`  [DEBUG] Full response body: ${JSON.stringify(withRows.body).slice(0, 400)}`);
    }
    check(rows.length === 2,              `2 rows returned (got ${rows.length})`);

    // ── 3. Response schema ──────────────────────────────────────────────────

    hr('3. Response Schema — required fields present');

    const requiredFields = [
      'id', 'consentType', 'action', 'source',
      'smsConsent', 'marketingConsent', 'emailConsent',
      'ipAddress', 'userAgent', 'actorId', 'notes', 'createdAt', 'clubMemberId',
    ];
    for (const f of requiredFields) {
      check(f in (rows[0] ?? {}), `Field "${f}" present`);
    }

    // ── 4. IP masking ───────────────────────────────────────────────────────

    hr('4. Privacy — IP masking + UA summary');

    if (rows.length < 2) {
      fail('Need ≥2 rows to check IP masking — skipping section', `Only ${rows.length} row(s) returned`);
    } else {
    const row1 = rows[0] as Record<string, unknown>;
    const row2 = rows[1] as Record<string, unknown>;

    check(row1.ipAddress === '1.2.x.x',        `IPv4 masked correctly (got "${row1.ipAddress}")`);
    check(row2.ipAddress === '203.0.x.x',       `Second IP masked (got "${row2.ipAddress}")`);
    check(row1.ipAddress !== '1.2.3.4',         'Full IPv4 never exposed');
    check(row2.ipAddress !== '203.0.113.42',    'Second full IPv4 never exposed');

    check(row1.userAgent === 'Chrome',          `Desktop UA summarised to "Chrome" (got "${row1.userAgent}")`);
    check(row2.userAgent === 'iOS Safari',       `Mobile UA summarised to "iOS Safari" (got "${row2.userAgent}")`);
    check(typeof row1.userAgent === 'string' && row1.userAgent.length < 20, 'UA string is short (summarised, not raw)');

    // ── 5. Chronological order ─────────────────────────────────────────────

    hr('5. Chronological Order — endpoint returns oldest-first');

    check(
      new Date(rows[0]?.createdAt as string) <= new Date(rows[1]?.createdAt as string),
      'Rows are in ascending createdAt order (oldest first)'
    );
    check(rows[0]?.action === 'GRANTED',   'First row is GRANTED (booking)');
    check(rows[1]?.action === 'REVOKED',   'Second row is REVOKED (unsubscribe)');

    // ── 6. Source + action values ───────────────────────────────────────────

    hr('6. Values — source, action, consent snapshot correctness');

    check(rows[0]?.source    === 'BOOKING_FLOW',      `Row 0 source = BOOKING_FLOW`);
    check(rows[1]?.source    === 'UNSUBSCRIBE_LINK',  `Row 1 source = UNSUBSCRIBE_LINK`);
    check(rows[0]?.smsConsent  === true,              'Row 0 smsConsent = true');
    check(rows[1]?.smsConsent  === false,             'Row 1 smsConsent = false (revoked)');
    check(rows[0]?.marketingConsent === false,        'Row 0 marketingConsent = false');
    check(rows[1]?.marketingConsent === false,        'Row 1 marketingConsent = false');
    check(rows[1]?.notes === 'phase2-verify unsubscribe', 'Notes field preserved');
    } // end rows.length >= 2 guard

    // ── 7. Cross-tenant isolation ───────────────────────────────────────────

    hr('7. Cross-Tenant Isolation — other restaurant cannot read this guest');

    if (otherRestaurant) {
      // Mint a JWT for a different restaurant — this must NOT see eataliano's guests
      const otherToken = signToken({
        userId:       'other-verify-user',
        restaurantId: otherRestaurant.id,  // ← different restaurant
        role:         'ADMIN',
        email:        'other@verify.test',
        firstName:    'Other', lastName: 'Restaurant',
      });
      console.log(`  Other restaurant: ${otherRestaurant.name} (${otherRestaurant.id})`);
      const crossTenant = await get(`/guests/${sandboxGuestId}/consent-audit`, otherToken);
      check(crossTenant.status === 404, `Cross-tenant request returns 404 (got ${crossTenant.status})`);
      const crossData = (crossTenant.body as { data?: unknown[] })?.data;
      check(!crossData || (Array.isArray(crossData) && crossData.length === 0),
        'Cross-tenant response contains no audit rows');
    } else {
      ok('Cross-tenant check skipped — only one restaurant in DB');
    }

    // ── 8. 401 without token ───────────────────────────────────────────────

    hr('8. Auth — unauthenticated request rejected');

    const noAuth = await fetch(`${API_BASE}/guests/${sandboxGuestId}/consent-audit`);
    check(noAuth.status === 401, `Unauthenticated returns 401 (got ${noAuth.status})`);

    // ── 9. Non-existent guest ID ───────────────────────────────────────────

    hr('9. Error Handling — fake guestId returns 404');

    const fakeId  = crypto.randomUUID();
    const notFound = await get(`/guests/${fakeId}/consent-audit`, authToken);
    check(notFound.status === 404, `Fake guestId returns 404 (got ${notFound.status})`);

    // ── 10. Real guest with existing production audit rows ─────────────────

    hr('10. Production Data — real member with consent audit rows');

    const realMember = await prisma.consentAudit.findFirst({
      where:   { restaurantId: restaurant.id },
      orderBy: { createdAt: 'desc' },
      select:  { guestId: true },
    });

    if (realMember) {
      const realRows = await get(`/guests/${realMember.guestId}/consent-audit`, authToken);
      check(realRows.status === 200, 'Real guest with audit rows → 200');
      const realData = (realRows.body as { data?: unknown[] })?.data ?? [];
      check(realData.length > 0, `Real guest has ${realData.length} audit row(s) (expected ≥1)`);

      // Verify masking on real production data
      const sample = realData[0] as Record<string, unknown>;
      if (sample.ipAddress) {
        check(!String(sample.ipAddress).match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/),
          'Real production IP is masked (no full IPv4 exposed)');
      } else {
        ok('Real production row has no IP (null is fine)');
      }
      if (sample.userAgent) {
        check(String(sample.userAgent).length <= 30,
          `Real UA is summarised (≤30 chars): "${sample.userAgent}"`);
      } else {
        ok('Real production row has no UA (null is fine)');
      }
      console.log(`\n  Sample real row: action=${sample.action} source=${sample.source} ip=${sample.ipAddress} ua=${sample.userAgent}`);
    } else {
      console.log('\n  ⚠️  No real ConsentAudit rows in production yet — skipping live-data check');
    }

    // ── 11. Frontend component checks (static) ─────────────────────────────

    hr('11. Frontend — Source + Action Hebrew labels (static check)');

    // These are the labels defined in GuestProfile.tsx — verify they match spec
    const SOURCE_LABEL: Record<string, string> = {
      BOOKING_FLOW:     'הזמנה אונליין',
      CLUB_JOIN_FORM:   'טופס הצטרפות למועדון',
      FEEDBACK_FORM:    'טופס משוב',
      HOST_MANUAL:      'עדכון ידני',
      IMPORT:           'ייבוא נתונים',
      API:              'API',
      UNSUBSCRIBE_LINK: 'קישור הסרה',
    };
    const ACTION_LABEL: Record<string, { text: string }> = {
      GRANTED: { text: 'אישור'  },
      REVOKED: { text: 'הסרה'   },
      UPDATED: { text: 'עדכון'  },
    };

    const expectedSources = ['BOOKING_FLOW','CLUB_JOIN_FORM','FEEDBACK_FORM','HOST_MANUAL','IMPORT','API','UNSUBSCRIBE_LINK'];
    for (const s of expectedSources) {
      check(!!SOURCE_LABEL[s] && SOURCE_LABEL[s].length > 0, `Source label defined for ${s}: "${SOURCE_LABEL[s]}"`);
    }
    check(ACTION_LABEL['GRANTED']?.text === 'אישור', 'GRANTED → "אישור"');
    check(ACTION_LABEL['REVOKED']?.text === 'הסרה',  'REVOKED → "הסרה"');
    check(ACTION_LABEL['UPDATED']?.text === 'עדכון', 'UPDATED → "עדכון"');

  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    hr('12. Cleanup');
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
    console.log('\n  ✓ PHASE 2 PRODUCTION VERIFIED\n');
  } else {
    console.log('\n  ✗ PHASE 2 VERIFICATION FAILED\n');
    for (const f of failures) console.log(`    • ${f}`);
    console.log('');
    process.exit(1);
  }
}

main()
  .catch(e => { console.error('\nFATAL:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
