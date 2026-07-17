// "Your table is ready" message for waitlist (מזדמנים) guests.
//
// Uses the EXISTING InforU SMS infrastructure only (lib/messaging.sendSms) —
// the same sender, provider selection (INFORU / MOCK), and MessageLog audit
// trail every other Iron Booking SMS goes through. No other channel or provider
// is introduced. The send is recorded in MessageLog with messageType TABLE_READY
// and the waitlistEntryId link, with PENDING → SENT / FAILED status.

import { prisma } from './prisma';
import { MessageType } from '@prisma/client';
import { sendSms } from './messaging';

export interface TableReadyTarget {
  id: string;             // waitlist entry id
  guestName: string;
  guestPhone: string;
  guestId?: string | null;
}

export interface TableReadyResult {
  success: boolean;
  messageLogId: string;
  errorMessage?: string;
}

// Default branded copy. Adapts when the guest name is missing; makes no promise
// that the table is held indefinitely.
export function buildTableReadyMessage(p: {
  guestName?: string | null;
  restaurantName: string;
  lang?: 'en' | 'he';
}): string {
  const lang = p.lang ?? 'he';
  const name = p.guestName?.trim();
  if (lang === 'he') {
    const greeting = name ? `שלום ${name},` : 'שלום,';
    return (
      `${greeting}\n` +
      `השולחן שלכם ב־${p.restaurantName} מוכן.\n` +
      `נשמח לראותכם כעת.\n` +
      `אם אינכם יכולים להגיע, אנא עדכנו אותנו.`
    );
  }
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return (
    `${greeting}\n` +
    `Your table at ${p.restaurantName} is ready.\n` +
    `We'd love to see you now.\n` +
    `If you can't make it, please let us know.`
  );
}

// Sends the table-ready SMS through the existing InforU pipeline. The send
// attempt (success or failure, including "SMS not enabled") is persisted in
// MessageLog by sendSms — provider is the restaurant's actual SMS provider.
export async function sendTableReady(
  restaurantId: string,
  target: TableReadyTarget,
): Promise<TableReadyResult> {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { name: true },
  });

  const body = buildTableReadyMessage({ guestName: target.guestName, restaurantName: restaurant.name });

  const result = await sendSms({
    restaurantId,
    to: target.guestPhone,
    message: body,
    type: MessageType.TABLE_READY,
    guestId: target.guestId ?? undefined,
    waitlistEntryId: target.id,
  });

  return {
    success: result.success,
    messageLogId: result.messageLogId,
    errorMessage: result.success ? undefined : 'SMS send failed — see message log',
  };
}
