import { prisma } from './prisma';
import { MomentType, MomentStatus } from '@prisma/client';

/**
 * Scans ClubMembers with birthdays in the next 7 days and queues BIRTHDAY_ECHO
 * messages for them. Safe to call repeatedly — deduplicates via a 6-day lookback
 * on existing MomentQueue entries.
 */
export async function runBirthdayEngine(
  restaurantId: string,
): Promise<{ queued: number; skipped: number }> {
  // ── 1. Check restaurant is club-enabled ──────────────────────────────────
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, timezone: true, settings: true },
  });

  if (!restaurant) return { queued: 0, skipped: 0 };

  const settings = (restaurant.settings ?? {}) as Record<string, unknown>;
  if (settings.ironClubEnabled === false) {
    return { queued: 0, skipped: 0 };
  }

  // ── 2. Build list of upcoming MM-DD strings for next 7 days ─────────────
  const tz = restaurant.timezone ?? 'UTC';

  function getMmDd(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${month}-${day}`;
  }

  const upcomingDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    upcomingDates.push(getMmDd(d, tz));
  }

  // ── 3. Find eligible club members ────────────────────────────────────────
  const members = await prisma.clubMember.findMany({
    where: {
      restaurantId,
      status: 'ACTIVE',
      smsConsent: true,
      birthday: { in: upcomingDates },
    },
    select: {
      id: true,
      guestId: true,
    },
  });

  if (members.length === 0) return { queued: 0, skipped: 0 };

  // ── 4. Process each member ───────────────────────────────────────────────
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

  let queued = 0;
  let skipped = 0;

  for (const member of members) {
    // Dedup check — existing PENDING/APPROVED/SENT within last 6 days
    const existing = await prisma.momentQueue.findFirst({
      where: {
        restaurantId,
        guestId: member.guestId,
        type: MomentType.BIRTHDAY_ECHO,
        status: {
          in: [MomentStatus.PENDING, MomentStatus.APPROVED, MomentStatus.SENT],
        },
        createdAt: { gte: sixDaysAgo },
      },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // Fetch guest first name
    const guest = await prisma.guest.findUnique({
      where: { id: member.guestId },
      select: { firstName: true },
    });

    const firstName = guest?.firstName ?? 'אורח';
    const message = `היי ${firstName}! מסעדת ${restaurant.name} מאחלת לך יום הולדת שמח 🎂 מחכים לראותך בקרוב!`;

    await prisma.momentQueue.create({
      data: {
        restaurantId,
        guestId: member.guestId,
        type: MomentType.BIRTHDAY_ECHO,
        status: MomentStatus.PENDING,
        draftMessage: message,
      },
    });

    queued++;
  }

  return { queued, skipped };
}
