import { prisma } from './prisma';
import { sendReminderSms } from './sms';
import { config } from '../config';

export interface ReminderResult {
  sent: number;
  skipped: number;
  failed: string[];
  total: number;
}

// Convert minutes → HH:mm (clamps at 23:59)
function toHHmm(mins: number): string {
  const clamped = Math.min(mins, 23 * 60 + 59);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export async function sendReservationReminders(
  restaurantId: string,
  date: string,
  withinMinutes = 60
): Promise<ReminderResult> {
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { name: true },
  });
  const restaurantName = restaurant?.name ?? 'the restaurant';

  const now        = new Date();
  const nowMins    = now.getHours() * 60 + now.getMinutes();
  const cutoffMins = nowMins + withinMinutes;

  // String comparison works correctly within the same day (no midnight crossing)
  const nowStr    = toHHmm(nowMins);
  const cutoffStr = toHHmm(cutoffMins);

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
    // Safety re-check (guards against race conditions on repeated calls)
    if (r.isConfirmedByGuest || r.reminderCount >= 2) { skipped++; continue; }

    // Reuse existing token; create one only if missing
    const token      = r.confirmationToken ?? crypto.randomUUID();
    const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}`;

    try {
      await sendReminderSms(r.guestPhone!, r.guestName, restaurantName, r.time, confirmUrl);

      await prisma.reservation.update({
        where: { id: r.id },
        data: {
          remindedAt:    new Date(),
          reminderCount: { increment: 1 },
          // Only write token if it didn't already exist
          ...(r.confirmationToken ? {} : { confirmationToken: token }),
        },
      });
      sent++;
    } catch (err) {
      console.error(`[reminder] Failed for ${r.id}:`, err instanceof Error ? err.message : err);
      failed.push(r.id);
    }
  }

  return { sent, skipped, failed, total: reservations.length };
}
