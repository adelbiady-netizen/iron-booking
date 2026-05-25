/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         INTERNAL DIAGNOSTIC SCRIPT — DO NOT DEPLOY          ║
 * ║  SMS smoke test for verifying InforU provider integration.   ║
 * ║  Blocked in production unless ALLOW_PROD_SMS_TEST=true.      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Required env vars:
 *   SMS_TEST_TO          — destination phone number (e.g. 0541234567)
 *   INFORU_BASIC_AUTH    — Base64 credentials for InforU
 *   DATABASE_URL         — Prisma connection string
 *
 * Optional env vars:
 *   ALLOW_PROD_SMS_TEST  — set to "true" to run against production DB
 *
 * Run on Render shell after all env vars are set:
 *   node dist/scripts/internal/smsTest.js
 */

import { prisma } from '../lib/prisma';
import { sendSms } from '../lib/messaging';
import { MessageType } from '@prisma/client';

// ── Production guard ──────────────────────────────────────────────────────────
if (
  process.env.NODE_ENV === 'production' &&
  process.env.ALLOW_PROD_SMS_TEST !== 'true'
) {
  console.error('');
  console.error('  [smsTest] BLOCKED — running in production environment.');
  console.error('  Set ALLOW_PROD_SMS_TEST=true to override intentionally.');
  console.error('');
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const RESTAURANT_SLUG = 'eataliano-dalla-costa';
const SMS_SENDER      = 'ITALIANO';
const TEST_MESSAGE    = 'שלום, זוהי הודעת בדיקה של Iron Booking מאיטליאנו דה לה קוסטה.';

const TEST_PHONE: string = process.env.SMS_TEST_TO ?? '';
if (!TEST_PHONE) {
  console.error('[smsTest] SMS_TEST_TO env var is required (e.g. SMS_TEST_TO=0541234567)');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  ⚠  INTERNAL DIAGNOSTIC SCRIPT — sends a real SMS via InforU');
  console.log('');

  // 1. Resolve restaurant
  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug: RESTAURANT_SLUG },
    select: { id: true, name: true, settings: true },
  });

  if (!restaurant) {
    console.error(`[smsTest] Restaurant not found: slug="${RESTAURANT_SLUG}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[smsTest] Restaurant : ${restaurant.name}`);
  console.log(`[smsTest] ID         : ${restaurant.id}`);

  // 2. Patch SMS settings (non-destructive merge)
  const base = (restaurant.settings ?? {}) as Record<string, unknown>;
  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      settings: {
        ...base,
        smsEnabled:    true,
        smsProvider:   'INFORU',
        smsSenderName: SMS_SENDER,
      },
    },
  });
  console.log(`[smsTest] Settings   : smsEnabled=true  smsProvider=INFORU  smsSenderName=${SMS_SENDER}`);

  // 3. Send one SMS
  console.log(`[smsTest] Sending to : ${TEST_PHONE}`);
  console.log(`[smsTest] Message    : ${TEST_MESSAGE}`);
  console.log('');

  const result = await sendSms({
    restaurantId: restaurant.id,
    to:           TEST_PHONE,
    message:      TEST_MESSAGE,
    type:         MessageType.SYSTEM,
  });

  // 4. Read full MessageLog row
  const log = await prisma.messageLog.findUnique({ where: { id: result.messageLogId } });

  console.log('══════════════════════════════════════════════');
  console.log('  SMS TEST RESULT');
  console.log('══════════════════════════════════════════════');
  console.log('  status           :', log?.status           ?? '(null)');
  console.log('  providerMessageId:', log?.providerMessageId ?? '(none)');
  console.log('  errorMessage     :', log?.errorMessage      ?? '(none)');
  console.log('  sentAt           :', log?.sentAt            ?? '(none)');
  console.log('  messageLogId     :', log?.id);
  console.log('══════════════════════════════════════════════');

  await prisma.$disconnect();
  process.exit(result.success ? 0 : 1);
}

main().catch(async err => {
  console.error('[smsTest] Fatal:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
