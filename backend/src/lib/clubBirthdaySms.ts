import { prisma } from './prisma';
import { MessageType, MessageStatus, RewardType, RewardStatus } from '@prisma/client';
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
  templateKey:       string;
  giftKey:           string;
  defaultTemplate:   (firstName: string, restaurantName: string, gift: string, bookingLink: string) => string;
  dryRun:            boolean;
}

export function applyTemplate(
  tpl: string,
  vars: { firstName: string; restaurantName: string; gift: string; bookingLink: string },
): string {
  return tpl
    .replace(/\{firstName\}/g,      vars.firstName)
    .replace(/\{restaurantName\}/g, vars.restaurantName)
    .replace(/\{gift\}/g,           vars.gift)
    .replace(/\{bookingLink\}/g,    vars.bookingLink);
}

async function runClubSmsBatch(p: BatchParams): Promise<{ sent: number; skipped: number }> {
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: p.restaurantId },
    select: { name: true, slug: true, timezone: true, settings: true },
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

  // Rule B: send if smsConsent=true OR marketingConsent=true (ACTIVE only)
  const members = await prisma.clubMember.findMany({
    where: {
      restaurantId: p.restaurantId,
      status:       'ACTIVE',
      [p.field]:    targetMmDd,
      OR: [{ smsConsent: true }, { marketingConsent: true }],
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

    const firstName   = member.guest.firstName ?? 'אורח';
    const gift        = typeof s[p.giftKey] === 'string' ? (s[p.giftKey] as string).trim() : '';
    const bookingLink = `https://www.ironbooking.com/book/${restaurant.slug}`;
    const tpl         = typeof s[p.templateKey] === 'string' ? (s[p.templateKey] as string).trim() : '';
    const message     = tpl
      ? applyTemplate(tpl, { firstName, restaurantName: restaurant.name, gift, bookingLink })
      : p.defaultTemplate(firstName, restaurant.name, gift, bookingLink);

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

    if (result.success) {
      sent++;
      // Auto-create reward — one per member per event type per year (dedup)
      const rewardType = p.messageType === MessageType.BIRTHDAY ? RewardType.BIRTHDAY : RewardType.ANNIVERSARY;
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const existingReward = await prisma.guestReward.findFirst({
        where: {
          restaurantId: p.restaurantId,
          guestId:      member.guestId,
          clubMemberId: member.id,
          type:         rewardType,
          issuedAt:     { gte: oneYearAgo },
        },
        select: { id: true },
      });
      if (!existingReward) {
        const gift  = typeof s[p.giftKey] === 'string' ? (s[p.giftKey] as string).trim() : '';
        const title = rewardType === RewardType.BIRTHDAY ? 'מתנת יום הולדת' : 'מתנת יום נישואים';
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await prisma.guestReward.create({
          data: {
            restaurantId: p.restaurantId,
            guestId:      member.guestId,
            clubMemberId: member.id,
            type:         rewardType,
            title,
            description:  gift || null,
            expiresAt,
            status:       RewardStatus.ISSUED,
          },
        });
      }
    } else { skipped++; }
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
    templateKey:       'clubBirthdaySmsTemplate',
    giftKey:           'clubBirthdaySmsGift',
    defaultTemplate: (firstName, restaurantName, gift, bookingLink) => {
      const giftLine = gift ? `\nהטבה: ${gift}.` : '';
      return `היי ${firstName}, יום ההולדת שלך מתקרב 🎉\nב־${restaurantName} נשמח לחגוג איתך.${giftLine}\nלהזמנת מקום: ${bookingLink}`;
    },
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
    templateKey:       'clubAnniversarySmsTemplate',
    giftKey:           'clubAnniversarySmsGift',
    defaultTemplate: (firstName, restaurantName, gift, bookingLink) => {
      const giftLine = gift ? `\nהטבה: ${gift}.` : '';
      return `היי ${firstName}, יום הנישואים שלכם מתקרב ❤️\nב־${restaurantName} נשמח לארח אתכם לערב מיוחד.${giftLine}\nלהזמנת מקום: ${bookingLink}`;
    },
    dryRun,
  });
}
