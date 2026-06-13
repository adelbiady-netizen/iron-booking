import { prisma } from '../../lib/prisma';
import {
  refreshGuestStats,
  detectGuestMemories,
  generateGuestAlerts,
  buildMomentQueue,
  generateMorningBrief,
} from './engine';

export async function getGuestIntelligence(restaurantId: string, guestId: string) {
  const [guest, memories, alerts, recoveryCases] = await Promise.all([
    prisma.guest.findFirst({
      where: { id: guestId, restaurantId },
      select: {
        id: true,
        firstVisitAt: true,
        avgVisitIntervalDays: true,
        nextExpectedVisitDate: true,
        silentScore: true,
        vipScore: true,
        gicComputedAt: true,
      },
    }),
    prisma.guestMemory.findMany({
      where: { restaurantId, guestId, isSuppressed: false },
      orderBy: [{ emotionalWeight: 'desc' }, { occurredAt: 'desc' }],
    }),
    prisma.guestAlert.findMany({
      where: { restaurantId, guestId, isDismissed: false, isRead: false },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.recoveryCase.findMany({
      where: { restaurantId, guestId },
      include: { actions: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { guest, memories, alerts, recoveryCases };
}

export async function dismissAlert(restaurantId: string, alertId: string) {
  return prisma.guestAlert.updateMany({
    where: { id: alertId, restaurantId },
    data: { isDismissed: true },
  });
}

export async function addMemory(
  restaurantId: string,
  guestId: string,
  data: {
    category: string;
    headline: string;
    context?: string;
    emotionalWeight?: number;
    occurredAt: string;
    addedBy?: string;
  }
) {
  return prisma.guestMemory.create({
    data: {
      restaurantId,
      guestId,
      category: data.category as never,
      source: 'HOST_ADDED',
      headline: data.headline,
      context: data.context,
      emotionalWeight: data.emotionalWeight ?? 5,
      occurredAt: new Date(data.occurredAt),
      addedBy: data.addedBy,
    },
  });
}

export async function createRecoveryCase(
  restaurantId: string,
  guestId: string,
  data: { description: string; reservationId?: string }
) {
  return prisma.recoveryCase.create({
    data: {
      restaurantId,
      guestId,
      reservationId: data.reservationId,
      description: data.description,
    },
  });
}

export async function addRecoveryAction(
  restaurantId: string,
  caseId: string,
  data: { actorName: string; note: string }
) {
  // verify ownership
  const recoveryCase = await prisma.recoveryCase.findFirst({
    where: { id: caseId, restaurantId },
  });
  if (!recoveryCase) throw new Error('Not found');

  return prisma.recoveryAction.create({
    data: { recoveryCaseId: caseId, actorName: data.actorName, note: data.note },
  });
}

export async function resolveRecoveryCase(restaurantId: string, caseId: string) {
  const recoveryCase = await prisma.recoveryCase.findFirst({
    where: { id: caseId, restaurantId },
  });
  if (!recoveryCase) throw new Error('Not found');

  return prisma.recoveryCase.update({
    where: { id: caseId },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
}

export async function getPendingMoments(restaurantId: string) {
  return prisma.momentQueue.findMany({
    where: { restaurantId, status: 'PENDING' },
    include: { guest: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function reviewMoment(
  restaurantId: string,
  momentId: string,
  data: { action: 'approve' | 'reject'; finalMessage?: string; scheduledFor?: string }
) {
  const moment = await prisma.momentQueue.findFirst({
    where: { id: momentId, restaurantId },
  });
  if (!moment) throw new Error('Not found');

  return prisma.momentQueue.update({
    where: { id: momentId },
    data: {
      status: data.action === 'approve' ? 'APPROVED' : 'REJECTED',
      finalMessage: data.finalMessage,
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : new Date(),
    },
  });
}

export async function getMorningBrief(restaurantId: string, date?: string) {
  const briefDate = date ? new Date(date) : new Date();
  briefDate.setHours(0, 0, 0, 0);

  return prisma.morningBrief.findUnique({
    where: { restaurantId_briefDate: { restaurantId, briefDate } },
  });
}

export async function refreshGuestIntelligence(restaurantId: string, guestId: string) {
  await refreshGuestStats(restaurantId, guestId);
  await detectGuestMemories(restaurantId, guestId);
  await generateGuestAlerts(restaurantId, guestId);
  return getGuestIntelligence(restaurantId, guestId);
}
