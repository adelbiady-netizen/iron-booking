import { prisma } from './prisma';
import { MessageChannel, MessageProvider, MessageStatus, MessageType } from '@prisma/client';
import { formatDurationHe, formatDurationEn } from './duration';
import { composeSms } from './smsTemplates';

// ─── Reservation received ─────────────────────────────────────────────────────

function buildReservationReceivedText(p: {
  guestName: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  lang: 'en' | 'he';
  duration?: number;
}): string {
  if (p.lang === 'he') {
    const durationLine = p.duration ? ` השולחן יעמוד לרשותכם למשך ${formatDurationHe(p.duration)}.` : '';
    return `היי ${p.guestName}, ההזמנה שלך ב-${p.restaurantName} התקבלה ל-${p.date} בשעה ${p.time} עבור ${p.partySize} סועדים.${durationLine} מחכים לארח אותך.`;
  }
  const durationLine = p.duration ? ` Your table will be held for ${formatDurationEn(p.duration)}.` : '';
  return `Hi ${p.guestName}, your reservation at ${p.restaurantName} was received for ${p.date} at ${p.time} for ${p.partySize} guests.${durationLine} We look forward to hosting you.`;
}

// Fire-and-forget safe: caller should void + .catch(). Dedup prevents duplicates.
export async function sendReservationReceivedSms(params: {
  restaurantId:  string;
  reservationId: string;
  guestId?:      string;
  phone:         string;
  guestName:     string;
  date:          string;
  time:          string;
  partySize:     number;
  lang:          'en' | 'he';
  duration?:     number;
}): Promise<void> {
  const { restaurantId, reservationId, guestId, phone, guestName, date, time, partySize, lang, duration } = params;

  // One SENT RESERVATION_RECEIVED per reservation lifetime — no retries needed
  const already = await prisma.messageLog.findFirst({
    where: { reservationId, messageType: MessageType.RESERVATION_RECEIVED, status: MessageStatus.SENT },
  });
  if (already) return;

  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { name: true, settings: true },
  });

  const restaurantName = restaurant?.name ?? '';
  const defaultText = buildReservationReceivedText({
    guestName, restaurantName, date, time, partySize, lang, duration,
  });
  const message = composeSms(
    'RESERVATION_RECEIVED',
    defaultText,
    { guestName, restaurantName, date, time, partySize },
    (restaurant?.settings ?? {}) as Record<string, unknown>,
  );

  await sendSms({ restaurantId, to: phone, message, type: MessageType.RESERVATION_RECEIVED, reservationId, guestId });
}

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

// InforU CAPI v2 response shape (fields may be absent on error paths).
// Observed production shape: { StatusId: 1, StatusDescription: "Success" }
// Legacy/error shape may use Status/Description instead.
interface InforUResponse {
  StatusId?:          number;
  StatusDescription?: string;
  Status?:            string | number;
  Description?:       string;
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
    const rawAuth = (process.env.INFORU_BASIC_AUTH ?? '').trim();
    if (!rawAuth) throw new Error('INFORU_BASIC_AUTH environment variable is not set');
    const authorization = rawAuth.startsWith('Basic ') ? rawAuth : `Basic ${rawAuth}`;

    const phone = toInforUPhone(to);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INFORU_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(INFORU_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
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

    // InforU CAPI v2 success: StatusId===1 or StatusDescription==="Success"
    // Fallback: legacy Status field "0" or "success" (error paths may use it)
    const isSuccess =
      parsed?.StatusId === 1 ||
      parsed?.StatusDescription?.toLowerCase() === 'success' ||
      String(parsed?.Status ?? '') === '0' ||
      String(parsed?.Status ?? '').toLowerCase() === 'success';

    if (!isSuccess) {
      const statusDetail =
        parsed?.StatusDescription ?? parsed?.Description ??
        `StatusId=${parsed?.StatusId ?? ''} Status=${parsed?.Status ?? ''}`;
      throw new Error(`InforU rejected message: ${statusDetail}`);
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
    return new InforUSmsProvider(resolveSenderName(settings) ?? 'IRON');
  }
  return new MockSmsProvider();
}

// The alphanumeric sender shown to the guest. INFORU uses the configured sender
// (fallback 'IRON'); MOCK has no real sender. Persisted on every MessageLog row.
function resolveSenderName(settings: Record<string, unknown>): string | null {
  const providerKey = (settings.smsProvider as string | undefined)?.toUpperCase();
  if (providerKey === 'INFORU') {
    return ((settings.smsSenderName as string | undefined) ?? '').trim() || 'IRON';
  }
  return null;
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
      senderName:    resolveSenderName(settings),
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
