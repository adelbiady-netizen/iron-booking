import { prisma } from './prisma';
import { sendSms } from './messaging';
import { MessageType, MessageStatus } from '@prisma/client';
import { config } from '../config';

export interface ReminderResult {
  sent: number;
  skipped: number;
  failed: string[];
  total: number;
}

function toHHmm(mins: number): string {
  const clamped = Math.min(mins, 23 * 60 + 59);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

// Convert a UTC instant to HH:mm in a given IANA timezone.
// hourCycle h23 guarantees 00–23 range (avoids h24 midnight edge on some ICU builds).
function localTimeHHmm(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour   = parts.find(p => p.type === 'hour')!.value;
  const minute = parts.find(p => p.type === 'minute')!.value;
  return `${hour}:${minute}`;
}

// Convert a UTC instant to YYYY-MM-DD in a given IANA timezone.
// en-CA locale produces ISO date format natively.
function localDateYMD(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function buildReminderSmsText(
  r: { guestName: string; time: string; guestLang?: string | null },
  restaurantName: string,
  confirmUrl: string,
): string {
  const lang = r.guestLang ?? 'he';
  if (lang === 'he') {
    return `היי ${r.guestName}, תזכורת להזמנה שלך ב${restaurantName} היום בשעה ${r.time}. לאישור: ${confirmUrl}`;
  }
  return `Hi ${r.guestName}, reminder for your reservation at ${restaurantName} today at ${r.time}. Confirm: ${confirmUrl}`;
}

export async function sendReservationReminders(
  restaurantId: string,
  date: string,
  withinMinutes = 60
): Promise<ReminderResult> {
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { name: true, timezone: true, settings: true },
  });

  const settings       = (restaurant?.settings ?? {}) as Record<string, unknown>;
  const restaurantName = restaurant?.name ?? 'the restaurant';
  const timezone       = restaurant?.timezone ?? 'UTC';

  // Respect reminderEnabled setting — defaults to enabled if not explicitly set
  if (settings.reminderEnabled === false) {
    return { sent: 0, skipped: 0, failed: [], total: 0 };
  }

  const leadMinutes = typeof settings.reminderLeadMinutes === 'number'
    ? settings.reminderLeadMinutes
    : withinMinutes;

  const now       = new Date();
  const localTime = localTimeHHmm(timezone, now);
  const localDate = localDateYMD(timezone, now);

  const [lh, lm]   = localTime.split(':').map(Number);
  const nowMins    = lh * 60 + lm;
  const cutoffMins = nowMins + leadMinutes;
  const nowStr     = toHHmm(nowMins);
  const cutoffStr  = toHHmm(cutoffMins);

  const reservations = await prisma.reservation.findMany({
    where: {
      restaurantId,
      date:               new Date(date + 'T00:00:00.000Z'),
      status:             { in: ['PENDING', 'CONFIRMED'] },
      guestPhone:         { not: null },
      isConfirmedByGuest: false,
      confirmationSentAt: { not: null },
      reminderCount:      { lt: 2 },
      time:               { gt: nowStr, lte: cutoffStr },
    },
  });

  let sent    = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const r of reservations) {
    // Cross-day guard: skip if reservation date ≠ restaurant-local today.
    // Prevents cross-day sends around UTC midnight / timezone boundaries.
    if (r.date.toISOString().slice(0, 10) !== localDate) { skipped++; continue; }

    // Safety re-check against concurrent calls
    if (r.isConfirmedByGuest || r.reminderCount >= 2) { skipped++; continue; }

    // MessageLog dedup: skip if a REMINDER was already SENT within the lead window
    const recentReminder = await prisma.messageLog.findFirst({
      where: {
        reservationId: r.id,
        messageType:   MessageType.REMINDER,
        status:        MessageStatus.SENT,
        sentAt:        { gte: new Date(Date.now() - leadMinutes * 60 * 1000) },
      },
    });
    if (recentReminder) { skipped++; continue; }

    const lang       = (r.guestLang === 'he' ? 'he' : 'en') as 'en' | 'he';
    const token      = r.confirmationToken ?? crypto.randomUUID();
    const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}${lang === 'he' ? '&lang=he' : ''}`;
    const message    = buildReminderSmsText(r, restaurantName, confirmUrl);

    try {
      const result = await sendSms({
        restaurantId,
        to:            r.guestPhone!,
        message,
        type:          MessageType.REMINDER,
        reservationId: r.id,
        guestId:       r.guestId ?? undefined,
      });

      if (result.success) {
        await prisma.reservation.update({
          where: { id: r.id },
          data: {
            remindedAt:    new Date(),
            reminderCount: { increment: 1 },
            ...(r.confirmationToken ? {} : { confirmationToken: token }),
          },
        });
        sent++;
      } else {
        failed.push(r.id);
      }
    } catch (err) {
      console.error(`[reminder] Failed for ${r.id}:`, err instanceof Error ? err.message : err);
      failed.push(r.id);
    }
  }

  return { sent, skipped, failed, total: reservations.length };
}
