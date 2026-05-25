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
  success:           boolean;
  messageLogId:      string;
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
    console.log(`[MockSMS] → ${to} | ${body.slice(0, 40).replace(/\n/g, ' ')}… | id=${providerMessageId}`);
    return { providerMessageId };
  }
}

// ─── InforU provider ──────────────────────────────────────────────────────────
// POST https://capi.inforu.co.il/api/v2/SMS/SendSms
// Auth: Authorization: Basic <INFORU_BASIC_AUTH env var>
// Credentials are never written to logs.

const INFORU_ENDPOINT = 'https://capi.inforu.co.il/api/v2/SMS/SendSms';
const INFORU_TIMEOUT_MS = 10_000;

// InforU CAPI v2 response shape (fields may be absent on error paths)
interface InforUResponse {
  Status?:      string | number;
  Description?: string;
  Response?: {
    BatchId?:  string;
    Messages?: Array<{ MessageId?: string; Phone?: string; Status?: string }>;
  };
}

// Convert +972XXXXXXXXX → 0XXXXXXXXX for InforU (example format: 0541234567)
function toInforUPhone(phone: string): string {
  const stripped = phone.replace(/[\s\-(). ]/g, '');
  if (stripped.startsWith('+972')) return '0' + stripped.slice(4);
  if (stripped.startsWith('972') && stripped.length === 12) return '0' + stripped.slice(3);
  return stripped; // already local format or unknown — pass through
}

class InforUSmsProvider implements SmsProvider {
  readonly providerName = MessageProvider.INFORU;

  constructor(private readonly senderName: string) {}

  async send(to: string, body: string): Promise<{ providerMessageId: string }> {
    const rawAuth = process.env.INFORU_BASIC_AUTH ?? '';
    if (!rawAuth) throw new Error('INFORU_BASIC_AUTH environment variable is not set');
    const basicAuth = rawAuth.startsWith('Basic ') ? rawAuth : `Basic ${rawAuth}`;

    const phone = toInforUPhone(to);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INFORU_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(INFORU_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': basicAuth,
        },
        body: JSON.stringify({
          Data: {
            Message: body,
            Recipients: [{ Phone: phone }],
            Settings: { Sender: this.senderName },
          },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? `InforU request timed out after ${INFORU_TIMEOUT_MS}ms`
        : `InforU request failed: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(msg);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      throw new Error(`InforU HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    let parsed: InforUResponse | null = null;
    try {
      parsed = JSON.parse(text) as InforUResponse;
    } catch {
      throw new Error(`InforU returned non-JSON response (HTTP ${res.status})`);
    }

    // InforU CAPI v2: Status "0" = success
    const statusStr = String(parsed?.Status ?? '');
    if (statusStr !== '0' && statusStr.toLowerCase() !== 'success') {
      throw new Error(
        `InforU rejected message: Status=${statusStr}${parsed?.Description ? ` — ${parsed.Description}` : ''}`
      );
    }

    // Prefer per-message ID, fall back to batch ID, then synthesise one
    const providerMessageId =
      parsed?.Response?.Messages?.[0]?.MessageId ??
      parsed?.Response?.BatchId ??
      `inforu_${Date.now()}`;

    console.log(`[InforU] SMS sent → ${phone} | sender=${this.senderName} | id=${providerMessageId}`);
    return { providerMessageId };
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function resolveProvider(settings: Record<string, unknown>): SmsProvider {
  const providerKey = (settings.smsProvider as string | undefined)?.toUpperCase();
  if (providerKey === 'INFORU') {
    const senderName = ((settings.smsSenderName as string | undefined) ?? '').trim() || 'IRON';
    return new InforUSmsProvider(senderName);
  }
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

  const provider = resolveProvider(settings);

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
        status:            MessageStatus.SENT,
        providerMessageId: result.providerMessageId,
        sentAt:            new Date(),
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
