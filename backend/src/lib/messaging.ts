import { prisma } from './prisma';
import { MessageChannel, MessageProvider, MessageStatus, MessageType } from '@prisma/client';

// ─── Public input / output types ─────────────────────────────────────────────

export interface SendSmsInput {
  restaurantId:  string;
  to:            string;
  message:       string;
  type:          MessageType;
  reservationId?: string;
  guestId?:      string;
}

export interface SendSmsResult {
  success:          boolean;
  messageLogId:     string;
  providerMessageId?: string;
}

// ─── Provider interface ───────────────────────────────────────────────────────

interface SmsProvider {
  readonly providerName: MessageProvider;
  send(to: string, body: string): Promise<{ providerMessageId: string }>;
}

// ─── MOCK provider ────────────────────────────────────────────────────────────
// Simulates a successful send. Writes a log entry. Never contacts any external API.

class MockSmsProvider implements SmsProvider {
  readonly providerName = MessageProvider.MOCK;

  async send(to: string, body: string): Promise<{ providerMessageId: string }> {
    const providerMessageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[MockSMS] → ${to} | type=${body.slice(0, 40).replace(/\n/g, ' ')}… | id=${providerMessageId}`);
    return { providerMessageId };
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────
// Phase 1: always returns MOCK.
// Phase 2: read smsProvider from settings and instantiate InforU when 'INFORU'.

function resolveProvider(_smsProvider: string | undefined): SmsProvider {
  return new MockSmsProvider();
}

// ─── Core dispatch ────────────────────────────────────────────────────────────

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const { restaurantId, to, message, type, reservationId, guestId } = input;

  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { settings: true },
  });

  const settings = (restaurant?.settings ?? {}) as Record<string, unknown>;
  const smsEnabled = settings.smsEnabled === true;

  if (!smsEnabled) {
    const log = await prisma.messageLog.create({
      data: {
        restaurantId,
        reservationId: reservationId ?? null,
        guestId:       guestId ?? null,
        phone:         to,
        messageType:   type,
        channel:       MessageChannel.SMS,
        provider:      MessageProvider.MOCK,
        status:        MessageStatus.FAILED,
        body:          message,
        errorMessage:  'SMS not enabled for this restaurant',
        failedAt:      new Date(),
      },
    });
    return { success: false, messageLogId: log.id };
  }

  const provider = resolveProvider(settings.smsProvider as string | undefined);

  const log = await prisma.messageLog.create({
    data: {
      restaurantId,
      reservationId: reservationId ?? null,
      guestId:       guestId ?? null,
      phone:         to,
      messageType:   type,
      channel:       MessageChannel.SMS,
      provider:      provider.providerName,
      status:        MessageStatus.PENDING,
      body:          message,
    },
  });

  try {
    const result = await provider.send(to, message);
    await prisma.messageLog.update({
      where: { id: log.id },
      data: {
        status:           MessageStatus.SENT,
        providerMessageId: result.providerMessageId,
        sentAt:           new Date(),
      },
    });
    return { success: true, messageLogId: log.id, providerMessageId: result.providerMessageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Messaging] SMS send failed for log ${log.id}:`, errorMessage);
    await prisma.messageLog.update({
      where: { id: log.id },
      data: {
        status:       MessageStatus.FAILED,
        errorMessage,
        failedAt:     new Date(),
      },
    });
    return { success: false, messageLogId: log.id };
  }
}
