// "Your table is ready" message for waitlist (מזדמנים) guests.
//
// Channel selection reuses the restaurant's existing messaging behaviour:
//   1. WhatsApp (UltraMsg) when the restaurant has credentials configured —
//      this is the channel waitlist messages already use.
//   2. InforU/Mock SMS via lib/messaging.sendSms when settings.smsEnabled.
// Every attempt (both channels, success and failure) is recorded in MessageLog
// with messageType TABLE_READY and waitlistEntryId, so send history survives
// refresh and is visible across devices.

import { prisma } from './prisma';
import { MessageChannel, MessageProvider, MessageStatus, MessageType } from '@prisma/client';
import { sendWhatsApp } from './sms';
import { sendSms } from './messaging';

export interface TableReadyTarget {
  id: string;             // waitlist entry id
  guestName: string;
  guestPhone: string;
  guestId?: string | null;
}

export interface TableReadyResult {
  success: boolean;
  channel: 'WHATSAPP' | 'SMS';
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

export async function sendTableReady(
  restaurantId: string,
  target: TableReadyTarget,
): Promise<TableReadyResult> {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { name: true, settings: true, ultramsgInstanceId: true, ultramsgToken: true },
  });

  const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
  const body = buildTableReadyMessage({ guestName: target.guestName, restaurantName: restaurant.name });

  const hasWhatsApp = Boolean(restaurant.ultramsgInstanceId && restaurant.ultramsgToken);
  const hasSms = settings.smsEnabled === true;

  if (!hasWhatsApp && !hasSms) {
    // No channel at all — record the failed attempt so it is auditable.
    const log = await prisma.messageLog.create({
      data: {
        restaurantId,
        waitlistEntryId: target.id,
        guestId: target.guestId ?? null,
        phone: target.guestPhone,
        messageType: MessageType.TABLE_READY,
        channel: MessageChannel.SMS,
        provider: MessageProvider.MOCK,
        status: MessageStatus.FAILED,
        body,
        errorMessage: 'No messaging channel configured (no WhatsApp credentials, SMS disabled)',
        failedAt: new Date(),
      },
    });
    return { success: false, channel: 'SMS', messageLogId: log.id, errorMessage: 'No messaging channel configured' };
  }

  if (hasWhatsApp) {
    const log = await prisma.messageLog.create({
      data: {
        restaurantId,
        waitlistEntryId: target.id,
        guestId: target.guestId ?? null,
        phone: target.guestPhone,
        messageType: MessageType.TABLE_READY,
        channel: MessageChannel.WHATSAPP,
        provider: MessageProvider.ULTRAMSG,
        status: MessageStatus.PENDING,
        body,
      },
    });
    try {
      await sendWhatsApp(restaurantId, target.guestPhone, body);
      await prisma.messageLog.update({
        where: { id: log.id },
        data: { status: MessageStatus.SENT, sentAt: new Date() },
      });
      return { success: true, channel: 'WHATSAPP', messageLogId: log.id };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await prisma.messageLog.update({
        where: { id: log.id },
        data: { status: MessageStatus.FAILED, errorMessage, failedAt: new Date() },
      });
      // WhatsApp configured but failed — fall back to SMS when available.
      if (!hasSms) return { success: false, channel: 'WHATSAPP', messageLogId: log.id, errorMessage };
      console.warn('[tableReady] WhatsApp failed, falling back to SMS:', errorMessage);
    }
  }

  const smsResult = await sendSms({
    restaurantId,
    to: target.guestPhone,
    message: body,
    type: MessageType.TABLE_READY,
    guestId: target.guestId ?? undefined,
    waitlistEntryId: target.id,
  });
  return {
    success: smsResult.success,
    channel: 'SMS',
    messageLogId: smsResult.messageLogId,
    errorMessage: smsResult.success ? undefined : 'SMS send failed — see message log',
  };
}
