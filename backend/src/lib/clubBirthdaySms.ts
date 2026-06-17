import { prisma } from './prisma';
import { MessageType, MessageStatus } from '@prisma/client';
import { sendSms } from './messaging';

function getMmDd(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const month = parts.find(p => p.type === 'month')?.value ?? '01';
  const day   = parts.find(p => p.type === 'day')?.value   ?? '01';
  return `${month}-${day}`;
}

function addDays(base: Date, n: number): Date {
  return new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
}

interface BatchParams {
  restaurantId:      string;
  enableKey:         string;
  daysBeforeKey:     string;
  defaultDaysBefore: number;
  field:             'birthday' | 'anniversary';
  messageType:       MessageType;
  buildMessage:      (firstName: string, restaurantName: string) => string;
  dryRun:            boolean;
}

async function runClubSmsBatch(p: BatchParams): Promise<{ sent: number; skipped: number }> {
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: p.restaurantId },
    select: { name: true, timezone: true, settings: true },
  });
  if (!restaurant) return { sent: 0, skipped: 0 };

  const s = (restaurant.settings ?? {}) as Record<string, unknown>;

  if (s.ironClubEnabled === false) return { sent: 0, skipped: 0 };
  if (s.smsEnabled !== true)       return { sent: 0, skipped: 0 };
  if (s[p.enableKey] !== true)     return { sent: 0, skipped: 0 };

  const daysBefore = typeof s[p.daysBeforeKey] === 'number'
    ? (s[p.daysBeforeKey] as number)
    : p.defaultDaysBefore;

  const tz         = restaurant.timezone ?? 'UTC';
  const targetMmDd = getMmDd(addDays(new Date(), daysBefore), tz);

  const members = await prisma.clubMember.findMany({
    where: {
      restaurantId: p.restaurantId,
      status:       'ACTIVE',
      smsConsent:   true,
      [p.field]:    targetMmDd,
    },
    select: {
      id:      true,
      guestId: true,
      guest:   { select: { firstName: true, phone: true } },
    },
  });

  if (members.length === 0) return { sent: 0, skipped: 0 };

  // 330-day lookback — catches any send from the past ~year without rejecting
  // legitimate annual sends when scheduling drifts slightly.
  const cutoff = new Date(Date.now() - 330 * 24 * 60 * 60 * 1000);
  let sent    = 0;
  let skipped = 0;

  for (const member of members) {
    const phone = member.guest.phone;
    if (!phone) { skipped++; continue; }

    const already = await prisma.messageLog.findFirst({
      where: {
        restaurantId:  p.restaurantId,
        clubMemberId:  member.id,
        messageType:   p.messageType,
        status:        { in: [MessageStatus.SENT, MessageStatus.PENDING] },
        createdAt:     { gte: cutoff },
      },
      select: { id: true },
    });
    if (already) { skipped++; continue; }

    const firstName = member.guest.firstName ?? 'אורח';
    const message   = p.buildMessage(firstName, restaurant.name);

    if (p.dryRun) {
      const masked = `${phone.slice(0, 3)}****${phone.slice(-3)}`;
      console.log(`[club-sms] DRY-RUN | ${p.messageType} | member=${member.id} | ${masked} | "${message.slice(0, 50)}…"`);
      skipped++;
      continue;
    }

    const result = await sendSms({
      restaurantId: p.restaurantId,
      to:           phone,
      message,
      type:         p.messageType,
      guestId:      member.guestId,
    });

    // Link the MessageLog row back to the ClubMember for audit purposes.
    if (result.messageLogId) {
      await prisma.messageLog.update({
        where: { id: result.messageLogId },
        data:  { clubMemberId: member.id },
      });
    }

    if (result.success) { sent++; } else { skipped++; }
  }

  console.log(`[club-sms] ${p.messageType} | restaurantId=${p.restaurantId} | target=${targetMmDd} | sent=${sent} skipped=${skipped} dryRun=${p.dryRun}`);
  return { sent, skipped };
}

export async function runClubBirthdaySmsBatch(
  restaurantId: string,
  dryRun: boolean,
): Promise<{ sent: number; skipped: number }> {
  return runClubSmsBatch({
    restaurantId,
    enableKey:         'clubBirthdaySmsEnabled',
    daysBeforeKey:     'clubBirthdaySmsDaysBefore',
    defaultDaysBefore: 7,
    field:             'birthday',
    messageType:       MessageType.BIRTHDAY,
    buildMessage: (firstName, restaurantName) =>
      `היי ${firstName}, יום ההולדת שלך מתקרב 🎉\nב־${restaurantName} נשמח לחגוג איתך ולהעניק לך קינוח מתנה בהזמנה מראש.`,
    dryRun,
  });
}

export async function runClubAnniversarySmsBatch(
  restaurantId: string,
  dryRun: boolean,
): Promise<{ sent: number; skipped: number }> {
  return runClubSmsBatch({
    restaurantId,
    enableKey:         'clubAnniversarySmsEnabled',
    daysBeforeKey:     'clubAnniversarySmsDaysBefore',
    defaultDaysBefore: 10,
    field:             'anniversary',
    messageType:       MessageType.ANNIVERSARY,
    buildMessage: (firstName, restaurantName) =>
      `היי ${firstName}, יום הנישואים שלכם מתקרב ❤️\nב־${restaurantName} נשמח לארח אתכם לערב מיוחד עם קינוח זוגי מתנה בהזמנה מראש.`,
    dryRun,
  });
}
