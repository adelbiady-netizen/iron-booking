import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { sendSms } from '../../lib/messaging';
import { MessageType, MessageStatus, MessageApprovalStatus, MomentType, MomentStatus } from '@prisma/client';
import crypto from 'crypto';

export async function generateFeedbackToken(
  restaurantId: string,
  reservationId: string,
  guestId: string | null,
  guestPhone: string | null,
  guestName: string,
): Promise<void> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, settings: true },
  });
  if (!restaurant) return;

  const settings = (restaurant.settings ?? {}) as Record<string, unknown>;

  // Master switch: ironClubEnabled (replaces feedbackEnabled)
  if (settings.ironClubEnabled === false) return;

  // One feedback record per reservation (idempotent)
  const existing = await prisma.guestFeedback.findUnique({ where: { reservationId } });
  if (existing) return;

  const token = crypto.randomUUID();
  await prisma.guestFeedback.create({
    data: { restaurantId, guestId, reservationId, token },
  });

  if (!guestPhone) return;

  const url = `${config.frontendBaseUrl}/f/${token}`;
  const firstName = guestName.split(/\s+/)[0] ?? guestName;
  const message = `היי ${firstName}, תודה על ביקורך ב${restaurant.name}. נשמח לשמוע מה חשבת: ${url}`;

  // Safe queue: default is approval-required.
  // Set feedbackApprovalRequired = false in restaurant settings to enable auto-send.
  const approvalRequired = settings.feedbackApprovalRequired !== false;

  if (approvalRequired) {
    // Route through MomentQueue — manager must approve before SMS fires
    if (!guestId) return; // MomentQueue requires a guestId
    await prisma.momentQueue.create({
      data: {
        restaurantId,
        guestId,
        type: MomentType.FEEDBACK_REQUEST,
        status: MomentStatus.PENDING,
        draftMessage: message,
      },
    });
  } else {
    // Pilot restaurants with explicit auto-send enabled
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
