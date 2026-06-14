import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { sendSms } from '../../lib/messaging';
import { MessageType } from '@prisma/client';
import crypto from 'crypto';

export async function generateFeedbackToken(
  restaurantId: string,
  reservationId: string,
  guestId: string | null,
  guestPhone: string | null,
  guestName: string,
): Promise<void> {
  // Check feature flag
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, settings: true },
  });
  if (!restaurant) return;

  const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
  if (settings.feedbackEnabled === false) return;

  // One feedback per reservation (idempotent)
  const existing = await prisma.guestFeedback.findUnique({ where: { reservationId } });
  if (existing) return;

  const token = crypto.randomUUID();
  await prisma.guestFeedback.create({
    data: { restaurantId, guestId, reservationId, token },
  });

  // Send SMS if guest has a phone number and SMS is enabled
  if (guestPhone) {
    const url = `${config.frontendBaseUrl}/f/${token}`;
    const firstName = guestName.split(/\s+/)[0] ?? guestName;
    const message = `היי ${firstName}, תודה על ביקורך ב${restaurant.name}. נשמח לשמוע מה חשבת: ${url}`;

    void sendSms({
      restaurantId,
      to: guestPhone,
      message,
      type: MessageType.FEEDBACK_REQUEST,
      reservationId,
      guestId: guestId ?? undefined,
    }).catch(err => console.error('[Feedback] SMS send failed:', err));
  }
}
