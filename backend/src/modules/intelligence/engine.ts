import { prisma } from '../../lib/prisma';
import { sendWhatsApp } from '../../lib/sms';

// ─── Memory Detection ─────────────────────────────────────────────────────────

export async function detectGuestMemories(restaurantId: string, guestId: string) {
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, restaurantId },
    include: {
      reservations: {
        where: { restaurantId, status: { in: ['COMPLETED', 'SEATED'] } },
        orderBy: { date: 'asc' },
      },
    },
  });
  if (!guest) return;

  const completed = guest.reservations;

  // Milestone: every 5th visit
  const visitCount = completed.length;
  if (visitCount > 0 && visitCount % 5 === 0) {
    const latest = completed[completed.length - 1]!;
    await upsertMemory({
      restaurantId,
      guestId,
      reservationId: latest.id,
      category: 'MILESTONE',
      headline: `ביקור מספר ${visitCount} במסעדה`,
      emotionalWeight: visitCount >= 20 ? 9 : visitCount >= 10 ? 7 : 5,
      occurredAt: latest.date,
    });
  }

  // Preference: consistent party size
  if (completed.length >= 3) {
    const sizes = completed.map((r) => r.partySize);
    const mostCommon = mode(sizes);
    if (mostCommon && sizes.filter((s) => s === mostCommon).length >= 3) {
      const latest = completed[completed.length - 1]!;
      await upsertMemory({
        restaurantId,
        guestId,
        reservationId: latest.id,
        category: 'PREFERENCE',
        headline: `תמיד מגיע בקבוצה של ${mostCommon}`,
        emotionalWeight: 3,
        occurredAt: latest.date,
      });
    }
  }

  // Group event: party ≥ 8
  for (const r of completed) {
    if (r.partySize >= 8) {
      await upsertMemory({
        restaurantId,
        guestId,
        reservationId: r.id,
        category: 'GROUP_EVENT',
        headline: `ארח אירוע גדול — ${r.partySize} איש`,
        emotionalWeight: 7,
        occurredAt: r.date,
      });
    }
  }

  // Celebration: occasion field
  for (const r of completed) {
    if (r.occasion) {
      const isRecurring = !!(r.birthday || r.anniversary);
      await upsertMemory({
        restaurantId,
        guestId,
        reservationId: r.id,
        category: 'CELEBRATION',
        headline: `חגג: ${r.occasion}`,
        emotionalWeight: 8,
        occurredAt: r.date,
        isRecurring,
      });
    }
  }
}

async function upsertMemory(data: {
  restaurantId: string;
  guestId: string;
  reservationId?: string;
  category: string;
  headline: string;
  emotionalWeight: number;
  occurredAt: Date;
  isRecurring?: boolean;
}) {
  const existing = await prisma.guestMemory.findFirst({
    where: {
      restaurantId: data.restaurantId,
      guestId: data.guestId,
      category: data.category as never,
      headline: data.headline,
    },
  });
  if (existing) return;

  await prisma.guestMemory.create({
    data: {
      restaurantId: data.restaurantId,
      guestId: data.guestId,
      reservationId: data.reservationId,
      category: data.category as never,
      headline: data.headline,
      emotionalWeight: data.emotionalWeight,
      occurredAt: data.occurredAt,
      isRecurring: data.isRecurring ?? false,
    },
  });
}

// ─── Guest Stats Refresh ──────────────────────────────────────────────────────

export async function refreshGuestStats(restaurantId: string, guestId: string) {
  const reservations = await prisma.reservation.findMany({
    where: { restaurantId, guestId, status: { in: ['COMPLETED', 'SEATED'] } },
    orderBy: { date: 'asc' },
    select: { date: true },
  });

  if (reservations.length === 0) return;

  const dates = reservations.map((r) => r.date);
  const firstVisitAt = dates[0]!;
  const lastVisitAt = dates[dates.length - 1]!;

  let avgVisitIntervalDays: number | null = null;
  if (dates.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const diff = (dates[i]!.getTime() - dates[i - 1]!.getTime()) / 86400000;
      intervals.push(diff);
    }
    avgVisitIntervalDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }

  const nextExpectedVisitDate =
    avgVisitIntervalDays && lastVisitAt
      ? new Date(lastVisitAt.getTime() + avgVisitIntervalDays * 86400000)
      : null;

  let silentScore: number | null = null;
  if (avgVisitIntervalDays && lastVisitAt) {
    const daysSince = (Date.now() - lastVisitAt.getTime()) / 86400000;
    const ratio = daysSince / avgVisitIntervalDays;
    silentScore = Math.min(100, Math.round(ratio * 50));
  }

  const guest = await prisma.guest.findUnique({
    where: { id: guestId },
    select: { visitCount: true, noShowCount: true },
  });
  let vipScore = Math.min(100, (guest?.visitCount ?? 0) * 5);
  vipScore -= (guest?.noShowCount ?? 0) * 10;
  vipScore = Math.max(0, vipScore);

  // restaurantId in where prevents cross-tenant IDOR if guestId is crafted externally
  await prisma.guest.updateMany({
    where: { id: guestId, restaurantId },
    data: {
      firstVisitAt,
      lastVisitAt,
      avgVisitIntervalDays,
      nextExpectedVisitDate,
      silentScore,
      vipScore,
      gicComputedAt: new Date(),
    },
  });
}

// ─── Alert Generation ─────────────────────────────────────────────────────────

export async function generateGuestAlerts(restaurantId: string, guestId: string) {
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, restaurantId },
    select: {
      id: true,
      avgVisitIntervalDays: true,
      lastVisitAt: true,
      silentScore: true,
      noShowCount: true,
    },
  });
  if (!guest) return;

  // Birthday/anniversary: look at most recent reservation for the guest
  const latestRes = await prisma.reservation.findFirst({
    where: { restaurantId, guestId },
    orderBy: { date: 'desc' },
    select: { birthday: true, anniversary: true },
  });

  if (latestRes?.birthday) {
    const daysUntil = daysUntilMMDD(latestRes.birthday);
    if (daysUntil !== null && daysUntil >= 0 && daysUntil <= 7) {
      await upsertAlert(restaurantId, guestId, 'BIRTHDAY_SOON', {
        headline: `יום הולדת בעוד ${daysUntil} ימים`,
        context: `תאריך: ${latestRes.birthday}`,
        expiresAt: addDays(new Date(), 8),
      });
    }
  }

  if (latestRes?.anniversary) {
    const daysUntil = daysUntilMMDD(latestRes.anniversary);
    if (daysUntil !== null && daysUntil >= 0 && daysUntil <= 7) {
      await upsertAlert(restaurantId, guestId, 'ANNIVERSARY_SOON', {
        headline: `יום נישואין בעוד ${daysUntil} ימים`,
        context: `תאריך: ${latestRes.anniversary}`,
        expiresAt: addDays(new Date(), 8),
      });
    }
  }

  // Silent guest
  if ((guest.silentScore ?? 0) >= 80) {
    const days = guest.lastVisitAt
      ? Math.round((Date.now() - guest.lastVisitAt.getTime()) / 86400000)
      : null;
    await upsertAlert(restaurantId, guestId, 'SILENT_GUEST', {
      headline: `לא חזר כבר ${days ?? '?'} ימים`,
      context: guest.avgVisitIntervalDays
        ? `קצב ביקורים רגיל: כל ${Math.round(guest.avgVisitIntervalDays)} ימים`
        : undefined,
      expiresAt: addDays(new Date(), 30),
    });
  }

  // High no-show
  if ((guest.noShowCount ?? 0) >= 3) {
    await upsertAlert(restaurantId, guestId, 'HIGH_NOSHOW', {
      headline: `${guest.noShowCount} אי-הופעות רשומות`,
      expiresAt: null,
    });
  }

  // Open recovery case
  const openCase = await prisma.recoveryCase.findFirst({
    where: { restaurantId, guestId, status: 'OPEN' },
    select: { description: true },
  });
  if (openCase) {
    await upsertAlert(restaurantId, guestId, 'RECOVERY_OPEN', {
      headline: 'ישנו מקרה טיפול פתוח',
      context: openCase.description,
      expiresAt: null,
    });
  }
}

async function upsertAlert(
  restaurantId: string,
  guestId: string,
  type: string,
  data: { headline: string; context?: string; expiresAt: Date | null }
) {
  const existing = await prisma.guestAlert.findFirst({
    where: { restaurantId, guestId, type: type as never, isDismissed: false },
  });
  if (existing) return;

  await prisma.guestAlert.create({
    data: {
      restaurantId,
      guestId,
      type: type as never,
      headline: data.headline,
      context: data.context,
      expiresAt: data.expiresAt,
    },
  });
}

// ─── Moment Queue Builder ─────────────────────────────────────────────────────

export async function buildMomentQueue(
  restaurantId: string,
  guestId: string,
  reservationId: string
) {
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, restaurantId },
    select: {
      firstName: true,
      phone: true,
      avgVisitIntervalDays: true,
      lastVisitAt: true,
    },
  });
  if (!guest?.phone) return;

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { date: true, birthday: true, anniversary: true },
  });
  if (!reservation) return;

  const guestFirstName = guest.firstName;

  // Long return
  if (guest.avgVisitIntervalDays && guest.lastVisitAt) {
    const daysSince = (reservation.date.getTime() - guest.lastVisitAt.getTime()) / 86400000;
    if (daysSince > guest.avgVisitIntervalDays * 1.5) {
      const months = Math.round(daysSince / 30);
      await enqueueMoment({
        restaurantId,
        guestId,
        type: 'LONG_RETURN',
        draftMessage: `${guestFirstName} שלום! כמה שמחים לראותך שוב אחרי ${months} חודשים 🙏 מחכים לארח אותך בחוויה מיוחדת.`,
      });
    }
  }

  // Birthday echo
  if (reservation.birthday) {
    const daysUntil = daysUntilMMDD(reservation.birthday);
    if (daysUntil !== null && daysUntil >= 0 && daysUntil <= 7) {
      await enqueueMoment({
        restaurantId,
        guestId,
        type: 'BIRTHDAY_ECHO',
        draftMessage: `${guestFirstName} יקר, יום הולדת שמח! 🎂 כל הכבוד שבחרת לחגוג אצלנו — יש לנו הפתעה קטנה בשבילך.`,
      });
    }
  }

  // Anniversary echo
  if (reservation.anniversary) {
    const daysUntil = daysUntilMMDD(reservation.anniversary);
    if (daysUntil !== null && daysUntil >= 0 && daysUntil <= 7) {
      await enqueueMoment({
        restaurantId,
        guestId,
        type: 'ANNIVERSARY_ECHO',
        draftMessage: `${guestFirstName} שלום! יום נישואין שמח! 💍 שמחים שבחרתם לחגוג איתנו. אנחנו נדאג שיהיה מושלם.`,
      });
    }
  }

  // Recovery sealed
  const resolvedCase = await prisma.recoveryCase.findFirst({
    where: { restaurantId, guestId, status: 'RESOLVED' },
    orderBy: { resolvedAt: 'desc' },
  });
  if (resolvedCase) {
    const existingMoment = await prisma.momentQueue.findFirst({
      where: { restaurantId, guestId, type: 'RECOVERY_SEALED', status: { not: 'REJECTED' } },
    });
    if (!existingMoment) {
      await enqueueMoment({
        restaurantId,
        guestId,
        type: 'RECOVERY_SEALED',
        draftMessage: `${guestFirstName} שלום, שמחים מאוד לראותך שוב! חשוב לנו שתדע שאנחנו כאן לעשות את החוויה מושלמת עבורך.`,
      });
    }
  }
}

async function enqueueMoment(data: {
  restaurantId: string;
  guestId: string;
  type: string;
  draftMessage: string;
  memoryId?: string;
}) {
  const existing = await prisma.momentQueue.findFirst({
    where: {
      restaurantId: data.restaurantId,
      guestId: data.guestId,
      type: data.type as never,
      status: { in: ['PENDING', 'APPROVED'] },
    },
  });
  if (existing) return;

  await prisma.momentQueue.create({
    data: {
      restaurantId: data.restaurantId,
      guestId: data.guestId,
      type: data.type as never,
      draftMessage: data.draftMessage,
      memoryId: data.memoryId,
    },
  });
}

// ─── Morning Brief ────────────────────────────────────────────────────────────

export async function generateMorningBrief(restaurantId: string, date: Date) {
  const dateOnly = startOfDay(date);
  const nextDay = addDays(dateOnly, 1);

  const reservations = await prisma.reservation.findMany({
    where: {
      restaurantId,
      date: { gte: dateOnly, lt: nextDay },
      status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
    },
    include: {
      guest: {
        select: {
          firstName: true,
          lastName: true,
          isVip: true,
          silentScore: true,
        },
      },
    },
  });

  const vipArrivals = reservations
    .filter((r) => r.guest?.isVip)
    .map((r) => ({
      name: r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : 'אורח VIP',
      time: r.time,
      partySize: r.partySize,
    }));

  const birthdays = reservations
    .filter((r) => r.birthday && daysUntilMMDD(r.birthday) === 0)
    .map((r) => ({
      name: r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : r.guestName,
      time: r.time,
    }));

  const anniversaries = reservations
    .filter((r) => r.anniversary && daysUntilMMDD(r.anniversary) === 0)
    .map((r) => ({
      name: r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : r.guestName,
      time: r.time,
    }));

  const silentReturns = reservations
    .filter((r) => (r.guest?.silentScore ?? 0) >= 70)
    .map((r) => ({
      name: r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : r.guestName,
      silentScore: r.guest?.silentScore,
    }));

  const openRecovery = await prisma.recoveryCase.count({
    where: { restaurantId, status: 'OPEN' },
  });

  const totalCovers = reservations.reduce((sum: number, r) => sum + r.partySize, 0);

  await prisma.morningBrief.upsert({
    where: { restaurantId_briefDate: { restaurantId, briefDate: dateOnly } },
    create: {
      restaurantId,
      briefDate: dateOnly,
      content: { vipArrivals, birthdays, anniversaries, silentReturns, openRecovery, totalCovers },
    },
    update: {
      content: { vipArrivals, birthdays, anniversaries, silentReturns, openRecovery, totalCovers },
    },
  });
}

// ─── Full Restaurant Intelligence Tick ────────────────────────────────────────

export async function runIntelligenceTick(restaurantId: string) {
  const activeGuests = await prisma.guest.findMany({
    where: {
      restaurantId,
      reservations: { some: { date: { gte: new Date(Date.now() - 365 * 86400000) } } },
    },
    select: { id: true },
  });

  for (const { id: guestId } of activeGuests) {
    try {
      await refreshGuestStats(restaurantId, guestId);
      await detectGuestMemories(restaurantId, guestId);
      await generateGuestAlerts(restaurantId, guestId);
    } catch (err) {
      console.error(`[GIC] guest ${guestId} tick failed:`, err);
    }
  }

  await generateMorningBrief(restaurantId, new Date());
}

// ─── Send Approved Moments ─────────────────────────────────────────────────────

export async function sendApprovedMoments(restaurantId: string) {
  // Atomic claim: mark sentAt first so concurrent ticks never double-send
  const now = new Date();
  const claimed = await prisma.momentQueue.findMany({
    where: {
      restaurantId,
      status: 'APPROVED',
      sentAt: null,
      scheduledFor: { lte: now },
    },
    select: { id: true },
  });
  if (claimed.length === 0) return;

  // Stamp each moment individually so the window between select and update is per-row
  for (const { id } of claimed) {
    const updated = await prisma.momentQueue.updateMany({
      where: { id, restaurantId, sentAt: null },
      data: { sentAt: now },
    });
    if (updated.count === 0) continue; // another process claimed it first

    const moment = await prisma.momentQueue.findUnique({
      where: { id },
      include: { guest: { select: { phone: true } } },
    });
    if (!moment?.guest.phone) continue;

    const message = moment.finalMessage ?? moment.draftMessage;
    try {
      await sendWhatsApp(restaurantId, moment.guest.phone, message);
      await prisma.momentQueue.update({
        where: { id },
        data: { status: 'SENT' },
      });
    } catch (err) {
      // Roll back the sentAt claim so it can retry next tick
      await prisma.momentQueue.update({ where: { id }, data: { sentAt: null } });
      console.error(`[GIC] Failed to send moment ${id}:`, err);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mode(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const freq: Record<number, number> = {};
  for (const n of arr) freq[n] = (freq[n] ?? 0) + 1;
  return Number(Object.entries(freq).sort((a, b) => b[1]! - a[1]!)[0]![0]);
}

function daysUntilMMDD(mmdd: string): number | null {
  const parts = mmdd.split('-');
  if (parts.length !== 2) return null;
  const [mm, dd] = parts.map(Number);
  if (!mm || !dd) return null;
  const now = new Date();
  const target = new Date(now.getFullYear(), mm - 1, dd);
  if (target < now) target.setFullYear(now.getFullYear() + 1);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
