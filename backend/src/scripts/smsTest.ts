/**
 * One-time SMS smoke test for Italiano Dalla Costa / InforU provider.
 *
 * Run on Render shell after INFORU_BASIC_AUTH is set:
 *   node dist/scripts/smsTest.js
 *
 * Patches restaurant SMS settings, sends one Hebrew test message,
 * then prints the full MessageLog result.
 */

import { prisma } from '../lib/prisma';
import { sendSms } from '../lib/messaging';
import { MessageType } from '@prisma/client';

const RESTAURANT_SLUG = 'eataliano-dalla-costa';
const TEST_PHONE      = '0542442074';
const SMS_SENDER      = 'ITALIANO';
const TEST_MESSAGE    = 'שלום, זוהי הודעת בדיקה של Iron Booking מאיטליאנו דה לה קוסטה.';

async function main() {
  // ── 1. Resolve restaurant ──────────────────────────────────────────────────
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

  // ── 2. Patch SMS settings (non-destructive merge) ─────────────────────────
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

  // ── 3. Send one SMS ────────────────────────────────────────────────────────
  console.log(`[smsTest] Sending to : ${TEST_PHONE}`);
  console.log(`[smsTest] Message    : ${TEST_MESSAGE}`);
  console.log('');

  const result = await sendSms({
    restaurantId: restaurant.id,
    to:           TEST_PHONE,
    message:      TEST_MESSAGE,
    type:         MessageType.SYSTEM,
  });

  // ── 4. Read full MessageLog row ────────────────────────────────────────────
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
