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

// ─── V2 Multi-Factor Loyalty Scoring ─────────────────────────────────────────
//
// Signal catalogue (with weights):
//
//  FREQUENCY
//    visitCount (Iron Booking)   +4 each, max 24 pts      — capped so CRM guests aren't buried
//
//  RECENCY  (from lastVisitAt)
//    < 30 days                   +12
//    30–90 days                  +6
//    91–180 days                 +0
//    > 180 days                  −8
//
//  CLUB MEMBERSHIP
//    Active ClubMember           +18                       — strong intent signal
//    Club smsConsent             +5                        — marketing engagement
//    Birthday stored             +4                        — recurring occasion potential
//
//  FEEDBACK
//    Submitted any feedback      +8                        — participation
//    Most recent = EXCELLENT/GOOD +10                      — positive sentiment
//    Most recent = BAD           −15                       — at-risk signal
//
//  RECOVERY
//    Has RESOLVED recovery case  +15                       — loyalty recovery success
//    Has OPEN/CONTACTED case     −10                       — needs attention
//
//  RELIABILITY
//    noShowCount = 0 AND ≥3 IB visits  +6                 — perfect attendance
//    noShowCount ≥ 3             −15
//
//  OCCASIONS
//    Has any celebration occasion +5                       — event guest
//    Received a SENT moment      +5                        — message engagement
//
// Raw sum → clamp 0–100 → loyaltyScore
// Engagement breadth (signal types fired / total possible) × 100 → engagementScore
//
// LABEL assignment (evaluated top-to-bottom, first match wins):
//   VIP           isVip=true  (manual flag, always overrides)
//   RECOVERED     resolved recovery + loyaltyScore ≥ 35
//   HIGH_ENGAGEMENT clubActive + feedbackParticipated + loyaltyScore ≥ 55
//   LOYAL         loyaltyScore ≥ 50
//   VIP_CANDIDATE loyaltyScore ≥ 35 AND !isVip
//   AT_RISK       openRecovery OR latestFeedback=BAD
//   SILENT        silentScore ≥ 80 OR (lastVisit > 180 days AND IBvisitCount ≥ 2)
//   CRM_MEMBER    clubActive AND IBvisitCount = 0   (imported club member, no IB history)
//   NEEDS_ATTENTION noShowCount ≥ 3 OR (loyaltyScore < 20 AND IBvisitCount ≥ 2)
//   NEW           default

export async function computeLoyaltyScore(restaurantId: string, guestId: string) {
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, restaurantId },
    select: {
      isVip: true,
      visitCount: true,
      noShowCount: true,
      lastVisitAt: true,
      silentScore: true,
      clubMemberships: {
        where: { restaurantId },
        take: 1,
        select: { status: true, smsConsent: true, birthday: true },
      },
      feedback: {
        where: { submittedAt: { not: null } },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        select: { sentiment: true, submittedAt: true },
      },
      recoveryCases: {
        where: { restaurantId },
        select: { status: true },
      },
      reservations: {
        where: { restaurantId, occasion: { not: null } },
        take: 1,
        select: { id: true },
      },
      momentQueue: {
        where: { restaurantId, status: 'SENT' },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!guest) return;

  const club = guest.clubMemberships[0] ?? null;
  const clubActive = club?.status === 'ACTIVE';
  const latestFeedback = guest.feedback[0] ?? null;
  const feedbackParticipated = guest.feedback.length > 0;
  const hasResolvedRecovery = guest.recoveryCases.some(c => c.status === 'RESOLVED');
  const hasOpenRecovery = guest.recoveryCases.some(c => c.status === 'OPEN' || c.status === 'CONTACTED');
  const hasCelebration = guest.reservations.length > 0;
  const hasSentMoment = guest.momentQueue.length > 0;

  // Track which signal types fired for engagementScore
  const signals: boolean[] = [];

  let pts = 0;

  // FREQUENCY — Iron Booking visits only
  const ibVisits = guest.visitCount ?? 0;
  const freqPts = Math.min(24, ibVisits * 4);
  pts += freqPts;
  signals.push(ibVisits > 0);

  // RECENCY
  const daysSinceLast = guest.lastVisitAt
    ? (Date.now() - guest.lastVisitAt.getTime()) / 86400000
    : null;
  if (daysSinceLast !== null) {
    if (daysSinceLast < 30)        { pts += 12; signals.push(true); }
    else if (daysSinceLast < 90)   { pts += 6;  signals.push(true); }
    else if (daysSinceLast < 180)  {             signals.push(false); }
    else                           { pts -= 8;  signals.push(false); }
  } else {
    signals.push(false);
  }

  // CLUB MEMBERSHIP
  if (clubActive)                  { pts += 18; signals.push(true); }
  else                             { signals.push(false); }
  if (club?.smsConsent)            { pts += 5; }
  if (club?.birthday)              { pts += 4; signals.push(true); }
  else                             { signals.push(false); }

  // FEEDBACK
  if (feedbackParticipated)        { pts += 8; signals.push(true); }
  else                             { signals.push(false); }
  if (latestFeedback?.sentiment === 'EXCELLENT' || latestFeedback?.sentiment === 'GOOD') {
    pts += 10; signals.push(true);
  } else if (latestFeedback?.sentiment === 'BAD') {
    pts -= 15; signals.push(false);
  } else {
    signals.push(false);
  }

  // RECOVERY
  if (hasResolvedRecovery)         { pts += 15; signals.push(true); }
  else                             { signals.push(false); }
  if (hasOpenRecovery)             { pts -= 10; }

  // RELIABILITY
  if (ibVisits >= 3 && (guest.noShowCount ?? 0) === 0) {
    pts += 6; signals.push(true);
  } else if ((guest.noShowCount ?? 0) >= 3) {
    pts -= 15; signals.push(false);
  } else {
    signals.push(false);
  }

  // OCCASIONS
  if (hasCelebration)              { pts += 5; signals.push(true); }
  else                             { signals.push(false); }
  if (hasSentMoment)               { pts += 5; signals.push(true); }
  else                             { signals.push(false); }

  const loyaltyScore = Math.min(100, Math.max(0, pts));

  // Engagement = proportion of positive signals fired (out of 10 tracked signal types)
  const positiveSignals = signals.filter(Boolean).length;
  const engagementScore = Math.round((positiveSignals / signals.length) * 100);

  // LABEL
  let gicLabel: string;
  if (guest.isVip) {
    gicLabel = 'VIP';
  } else if (hasResolvedRecovery && loyaltyScore >= 35) {
    gicLabel = 'RECOVERED';
  } else if (clubActive && feedbackParticipated && loyaltyScore >= 55) {
    gicLabel = 'HIGH_ENGAGEMENT';
  } else if (loyaltyScore >= 50) {
    gicLabel = 'LOYAL';
  } else if (loyaltyScore >= 35) {
    gicLabel = 'VIP_CANDIDATE';
  } else if (hasOpenRecovery || latestFeedback?.sentiment === 'BAD') {
    gicLabel = 'AT_RISK';
  } else if ((guest.silentScore ?? 0) >= 80 || (daysSinceLast !== null && daysSinceLast > 180 && ibVisits >= 2)) {
    gicLabel = 'SILENT';
  } else if (clubActive && ibVisits === 0) {
    gicLabel = 'CRM_MEMBER';
  } else if ((guest.noShowCount ?? 0) >= 3 || (loyaltyScore < 20 && ibVisits >= 2)) {
    gicLabel = 'NEEDS_ATTENTION';
  } else {
    gicLabel = 'NEW';
  }

  await prisma.guest.updateMany({
    where: { id: guestId, restaurantId },
    data: { loyaltyScore, engagementScore, gicLabel, gicComputedAt: new Date() },
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
  // Include guests with recent reservations OR active club memberships (catches CRM-imported members)
  const activeGuests = await prisma.guest.findMany({
    where: {
      restaurantId,
      OR: [
        { reservations: { some: { date: { gte: new Date(Date.now() - 365 * 86400000) } } } },
        { clubMemberships: { some: { restaurantId, status: 'ACTIVE' } } },
      ],
    },
    select: { id: true },
  });

  for (const { id: guestId } of activeGuests) {
    try {
      await refreshGuestStats(restaurantId, guestId);
      await computeLoyaltyScore(restaurantId, guestId);
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
