import { prisma } from '../../lib/prisma';

/**
 * Seeds realistic GIC demo data for one restaurant using its real guests.
 * Idempotent: clears all prior seeded rows (tagged with addedBy='DEMO_SEED')
 * before inserting fresh data. Does not create fake reservations.
 */
export async function seedIntelligenceDemo(restaurantId: string) {
  // ── 0. Verify restaurant exists ───────────────────────────────────────────
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) throw new Error(`Restaurant ${restaurantId} not found`);

  // ── 1. Clear prior seed rows ──────────────────────────────────────────────
  await prisma.momentQueue.deleteMany({
    where: { restaurantId, draftMessage: { contains: '[DEMO]' } },
  });
  await prisma.guestAlert.deleteMany({
    where: { restaurantId, context: { contains: '[DEMO]' } },
  });
  await prisma.recoveryCase.deleteMany({
    where: { restaurantId, description: { contains: '[DEMO]' } },
  });
  await prisma.guestMemory.deleteMany({
    where: { restaurantId, addedBy: 'DEMO_SEED' },
  });
  // Reset demo guest stats
  await prisma.guest.updateMany({
    where: { restaurantId, internalNotes: { contains: '[DEMO_VIP]' } },
    data: { vipScore: null, silentScore: null, internalNotes: '' },
  });

  // ── 2. Pick real guests ───────────────────────────────────────────────────
  const guests = await prisma.guest.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (guests.length < 5) {
    throw new Error(
      `Not enough guests — found ${guests.length}, need at least 5. Add real guests first.`
    );
  }

  const pick = (i: number) => guests[i % guests.length];
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 86_400_000);

  const created = {
    memories: 0,
    alerts: 0,
    recoveryCases: 0,
    moments: 0,
    vipGuest: null as string | null,
  };

  // ── 3. Birthday alerts (3 guests) ─────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const g = pick(i);
    await prisma.guestAlert.create({
      data: {
        restaurantId,
        guestId: g.id,
        type: 'BIRTHDAY_SOON',
        headline: `יום הולדת בעוד ${i + 2} ימים`,
        context: `${g.firstName} חוגג/ת יום הולדת ב-${daysFromNow(i + 2).toLocaleDateString('he-IL')} [DEMO]`,
        expiresAt: daysFromNow(8),
      },
    });
    await prisma.guestMemory.create({
      data: {
        restaurantId,
        guestId: g.id,
        category: 'CELEBRATION',
        source: 'AUTO_DETECTED',
        headline: `יום הולדת — ${g.firstName} אוהב/ת לחגוג אצלנו`,
        emotionalWeight: 8,
        occurredAt: daysAgo(30),
        isRecurring: true,
        addedBy: 'DEMO_SEED',
      },
    });
    created.alerts++;
    created.memories++;
  }

  // ── 4. Anniversary alerts (2 guests) ─────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const g = pick(3 + i);
    await prisma.guestAlert.create({
      data: {
        restaurantId,
        guestId: g.id,
        type: 'ANNIVERSARY_SOON',
        headline: `יום נישואין בעוד ${i + 3} ימים`,
        context: `${g.firstName} ו${g.lastName || 'בן/בת הזוג'} — יום נישואין ב-${daysFromNow(i + 3).toLocaleDateString('he-IL')} [DEMO]`,
        expiresAt: daysFromNow(9),
      },
    });
    await prisma.guestMemory.create({
      data: {
        restaurantId,
        guestId: g.id,
        category: 'CELEBRATION',
        source: 'AUTO_DETECTED',
        headline: `יום נישואין — ${g.firstName} חוזר/ת מדי שנה לציון האירוע`,
        emotionalWeight: 9,
        occurredAt: daysAgo(365),
        isRecurring: true,
        addedBy: 'DEMO_SEED',
      },
    });
    created.alerts++;
    created.memories++;
  }

  // ── 5. Long-return guests (3 guests, silentScore 80–95) ──────────────────
  const silentScores = [95, 85, 80];
  const absenceDays = [68, 52, 45];
  for (let i = 0; i < 3; i++) {
    const g = pick(5 + i);
    await prisma.guest.update({
      where: { id: g.id },
      data: {
        silentScore: silentScores[i],
        avgVisitIntervalDays: 21,
        nextExpectedVisitDate: daysAgo(absenceDays[i] - 21),
        gicComputedAt: now,
      },
    });
    await prisma.guestAlert.create({
      data: {
        restaurantId,
        guestId: g.id,
        type: 'SILENT_GUEST',
        headline: `לא ביקר/ה ${absenceDays[i]} ימים`,
        context: `${g.firstName} לא חזר/ה כבר ${absenceDays[i]} יום (ממוצע ביקורים: 21 יום) [DEMO]`,
        expiresAt: daysFromNow(30),
      },
    });
    created.alerts++;
  }

  // ── 6. Recovery cases (2 guests) ─────────────────────────────────────────
  const recoveryGuest1 = pick(8);
  const rc1 = await prisma.recoveryCase.create({
    data: {
      restaurantId,
      guestId: recoveryGuest1.id,
      description: `${recoveryGuest1.firstName} התלונן/ה על המתנה ארוכה וחוויה מאכזבת. יש ליצור קשר ולהציע שולחן מועדף בביקור הבא. [DEMO]`,
      status: 'CONTACTED',
    },
  });
  await prisma.recoveryAction.create({
    data: {
      recoveryCaseId: rc1.id,
      actorName: 'מנהל המשמרת',
      note: 'יצרנו קשר טלפוני והתנצלנו. הלקוח קיבל בהבנה ואמר שישקול לחזור.',
    },
  });
  await prisma.guestAlert.create({
    data: {
      restaurantId,
      guestId: recoveryGuest1.id,
      type: 'RECOVERY_OPEN',
      headline: 'תיק שחזור פתוח — נוצר קשר',
      context: `[DEMO]`,
      expiresAt: daysFromNow(60),
    },
  });
  created.alerts++;
  created.recoveryCases++;

  const recoveryGuest2 = pick(9);
  await prisma.recoveryCase.create({
    data: {
      restaurantId,
      guestId: recoveryGuest2.id,
      description: `${recoveryGuest2.firstName} קיבל/ה מנה שגויה ועזב/ה מאוכזב/ת. ביקור לפני שבועיים, עדיין לא חזר/ה. [DEMO]`,
      status: 'OPEN',
    },
  });
  await prisma.guestAlert.create({
    data: {
      restaurantId,
      guestId: recoveryGuest2.id,
      type: 'RECOVERY_OPEN',
      headline: 'תיק שחזור פתוח — ממתין לטיפול',
      context: `[DEMO]`,
      expiresAt: daysFromNow(60),
    },
  });
  created.alerts++;
  created.recoveryCases++;

  // ── 7. VIP guest (1 guest, vipScore 95, 20 visits) ───────────────────────
  const vipGuest = pick(10);
  await prisma.guest.update({
    where: { id: vipGuest.id },
    data: {
      vipScore: 95,
      visitCount: 20,
      firstVisitAt: daysAgo(365),
      gicComputedAt: now,
      internalNotes: '[DEMO_VIP]',
    },
  });
  await prisma.guestMemory.create({
    data: {
      restaurantId,
      guestId: vipGuest.id,
      category: 'MILESTONE',
      source: 'AUTO_DETECTED',
      headline: `ביקור מספר 20 — ${vipGuest.firstName} לקוח/ה VIP מאז שנה`,
      context: 'לקוח קבוע ביותר. תמיד מזמין/ה שולחן ומגיע/ה בזמן. ממליץ/ה לחברים.',
      emotionalWeight: 10,
      occurredAt: daysAgo(7),
      addedBy: 'DEMO_SEED',
    },
  });
  await prisma.guestMemory.create({
    data: {
      restaurantId,
      guestId: vipGuest.id,
      category: 'PREFERENCE',
      source: 'HOST_ADDED',
      headline: `${vipGuest.firstName} תמיד מבקש/ת שולחן שקט בפינה`,
      emotionalWeight: 7,
      occurredAt: daysAgo(60),
      addedBy: 'DEMO_SEED',
    },
  });
  created.vipGuest = `${vipGuest.firstName} ${vipGuest.lastName ?? ''}`.trim();
  created.memories += 2;

  // ── 8. Moments: 1 PENDING, 1 APPROVED, 1 SENT ────────────────────────────
  const momentGuests = [pick(11), pick(12), pick(13)];

  // PENDING
  await prisma.momentQueue.create({
    data: {
      restaurantId,
      guestId: momentGuests[0].id,
      type: 'LONG_RETURN',
      status: 'PENDING',
      draftMessage: `שלום ${momentGuests[0].firstName}, שמחנו לראות שאת/ה חוזר/ת אלינו לאחר תקופה. שמרנו לך את השולחן האהוב. מחכים לך! [DEMO]`,
      scheduledFor: daysFromNow(1),
    },
  });

  // APPROVED
  await prisma.momentQueue.create({
    data: {
      restaurantId,
      guestId: momentGuests[1].id,
      type: 'BIRTHDAY_ECHO',
      status: 'APPROVED',
      draftMessage: `יום הולדת שמח ${momentGuests[1].firstName}! שמחים שבחרת/ת לחגוג אצלנו — חגיגה קטנה מהמסעדה מחכה לך. [DEMO]`,
      finalMessage: `יום הולדת שמח ${momentGuests[1].firstName}! 🎂 שמחנו לארח אותך ביום המיוחד שלך — מפתיע קטן מחכה לך. [DEMO]`,
      scheduledFor: daysFromNow(2),
    },
  });

  // SENT
  const sentAt = daysAgo(1);
  await prisma.momentQueue.create({
    data: {
      restaurantId,
      guestId: momentGuests[2].id,
      type: 'RECOVERY_SEALED',
      status: 'SENT',
      draftMessage: `שלום ${momentGuests[2].firstName}, שמחנו לראות שחזרת/ת אלינו. מקווים שהביקור האחרון היה טוב יותר. נשמח לפגוש אותך שוב! [DEMO]`,
      finalMessage: `שלום ${momentGuests[2].firstName}, שמחנו לראות שחזרת/ת אלינו. הביקור שלך חשוב לנו מאוד. [DEMO]`,
      scheduledFor: sentAt,
      sentAt,
    },
  });
  created.moments += 3;

  return {
    ok: true,
    restaurant: restaurant.name,
    seeded: {
      birthdayAlerts: 3,
      anniversaryAlerts: 2,
      longReturnGuests: 3,
      recoveryCases: 2,
      vipGuest: created.vipGuest,
      moments: { PENDING: 1, APPROVED: 1, SENT: 1 },
      memories: created.memories,
    },
    note: 'Call DELETE /intelligence/seed-demo to clear this data.',
  };
}

export async function clearIntelligenceDemo(restaurantId: string) {
  await prisma.momentQueue.deleteMany({
    where: { restaurantId, draftMessage: { contains: '[DEMO]' } },
  });
  await prisma.guestAlert.deleteMany({
    where: { restaurantId, context: { contains: '[DEMO]' } },
  });
  const cases = await prisma.recoveryCase.findMany({
    where: { restaurantId, description: { contains: '[DEMO]' } },
    select: { id: true },
  });
  await prisma.recoveryAction.deleteMany({
    where: { recoveryCaseId: { in: cases.map(c => c.id) } },
  });
  await prisma.recoveryCase.deleteMany({
    where: { restaurantId, description: { contains: '[DEMO]' } },
  });
  await prisma.guestMemory.deleteMany({
    where: { restaurantId, addedBy: 'DEMO_SEED' },
  });
  await prisma.guest.updateMany({
    where: { restaurantId, internalNotes: '[DEMO_VIP]' },
    data: { vipScore: null, silentScore: null, internalNotes: '' },
  });
  return { ok: true, cleared: true };
}
