/**
 * Enable (or update) SMS for a single restaurant — idempotent, per-tenant.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/enable-sms.ts <slug> [SENDER] [--provider INFORU|MOCK] [--test +9725XXXXXXXX]
 *
 * Examples:
 *   npx tsx scripts/enable-sms.ts najma NAJMA
 *   npx tsx scripts/enable-sms.ts najma NAJMA --test +972501234567
 *
 * - Merges into restaurant.settings (never clobbers other settings).
 * - Re-runnable: running again just re-applies the same values.
 * - The optional --test sends ONE SMS, but only after the config is read back and
 *   verified. Requires INFORU_BASIC_AUTH in the environment for a live send.
 */

import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/lib/prisma';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  // strip values that belong to flags
  const flagValues = new Set([arg('--provider'), arg('--test')].filter(Boolean) as string[]);
  const [slug, senderArg] = positional.filter(a => !flagValues.has(a));

  if (!slug) {
    console.error('Usage: npx tsx scripts/enable-sms.ts <slug> [SENDER] [--provider INFORU|MOCK] [--test +9725XXXXXXXX]');
    process.exit(1);
  }

  const provider = (arg('--provider') ?? 'INFORU').toUpperCase();
  const sender   = (senderArg ?? slug).toUpperCase().slice(0, 11);
  const testPhone = arg('--test');

  const restaurant = await prisma.restaurant.findUnique({
    where:  { slug },
    select: { id: true, name: true, slug: true, settings: true },
  });
  if (!restaurant) {
    console.error(`No restaurant with slug "${slug}".`);
    process.exit(1);
  }

  const prev = (restaurant.settings ?? {}) as Record<string, unknown>;
  const next = { ...prev, smsEnabled: true, smsProvider: provider, smsSenderName: sender };

  await prisma.restaurant.update({ where: { id: restaurant.id }, data: { settings: next } });

  // Read back and verify before doing anything else
  const after = await prisma.restaurant.findUnique({ where: { id: restaurant.id }, select: { settings: true } });
  const s = (after?.settings ?? {}) as Record<string, unknown>;

  console.log(`\n  SMS enabled for "${restaurant.name}" [slug=${restaurant.slug}]`);
  console.log(`     smsEnabled    = ${s.smsEnabled}`);
  console.log(`     smsProvider   = ${s.smsProvider}`);
  console.log(`     smsSenderName = ${JSON.stringify(s.smsSenderName)}`);

  const verified = s.smsEnabled === true && String(s.smsProvider).toUpperCase() === provider && s.smsSenderName === sender;
  if (!verified) {
    console.error('\n  Verification FAILED — settings did not persist as expected. Aborting (no test sent).');
    process.exit(1);
  }
  console.log('     verified      = OK');

  if (testPhone) {
    console.log(`\n  Sending one test SMS to ${testPhone} ...`);
    const { sendSms } = await import('../src/lib/messaging');
    const { MessageType } = await import('@prisma/client');
    const result = await sendSms({
      restaurantId: restaurant.id,
      to:           testPhone,
      message:      `Iron Booking SMS test — ${restaurant.name}`,
      type:         MessageType.SYSTEM,
    });
    const log = await prisma.messageLog.findUnique({ where: { id: result.messageLogId } });
    console.log(`     success       = ${result.success}`);
    console.log(`     provider      = ${log?.provider}`);
    console.log(`     senderName    = ${JSON.stringify(log?.senderName)}`);
    console.log(`     status        = ${log?.status}`);
    if (log?.errorMessage) console.log(`     error         = ${log.errorMessage}`);
    if (log?.providerMessageId) console.log(`     providerMsgId = ${log.providerMessageId}`);
  } else {
    console.log('\n  (No --test phone given — configuration only. Re-run with --test +9725XXXXXXXX to send a test.)');
  }
}

main()
  .catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
