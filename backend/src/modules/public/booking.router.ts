import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { addMinutes, areIntervalsOverlapping } from 'date-fns';
import { parseTimeOnDate, formatTime } from '../../engine/availability';
import { sendConfirmationSms } from '../../lib/sms';
import { findOrCreateGuest, splitName } from '../guests/service';
import { config } from '../../config';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublicSlot {
  time: string;
  available: boolean;
  tier: 'IDEAL' | 'GOOD' | 'LIMITED';
  tablesLeft: number;
}

interface BookingAlternative {
  date: string;
  time: string;
  tablesLeft: number;
}

class SlotTakenError extends Error {
  constructor() { super('SLOT_TAKEN'); this.name = 'SlotTakenError'; }
}

// ─── Simple in-memory rate limiter ───────────────────────────────────────────
// Max 10 booking attempts per IP per minute on POST /reserve.

const _rateMap = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateMap) {
    if (entry.resetAt < now - 60_000) _rateMap.delete(ip);
  }
}, 120_000).unref();

function isRateLimited(ip: string): boolean {
  const now   = Date.now();
  const entry = _rateMap.get(ip);
  if (!entry || entry.resetAt < now) {
    _rateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (entry.count >= 10) return true;
  entry.count++;
  return false;
}

// ─── Settings reader ──────────────────────────────────────────────────────────

function parseSettings(settings: unknown) {
  const s = (settings ?? {}) as Record<string, unknown>;
  return {
    defaultTurnMinutes:        (s['defaultTurnMinutes']        as number) ?? 90,
    bufferBetweenTurnsMinutes: (s['bufferBetweenTurnsMinutes'] as number) ?? 15,
    slotIntervalMinutes:       (s['slotIntervalMinutes']        as number) ?? 30,
    maxPartySize:              (s['maxPartySize']               as number) ?? 12,
    maxAdvanceBookingDays:     (s['maxAdvanceBookingDays']      as number) ?? 60,
    minAdvanceBookingHours:    (s['minAdvanceBookingHours']     as number) ?? 2,
  };
}

// ─── Restaurant lookup ────────────────────────────────────────────────────────

async function findRestaurantBySlug(slug: string) {
  return prisma.restaurant.findUnique({
    where: { slug },
    include: { operatingHours: { orderBy: { dayOfWeek: 'asc' } } },
  });
}

type RestaurantWithHours = NonNullable<Awaited<ReturnType<typeof findRestaurantBySlug>>>;

// ─── Availability engine (public, capacity-aware) ────────────────────────────
// Pre-fetches all data for the day in a single pass, then evaluates each
// time slot in memory. Avoids the N-query loop in getAvailableSlots().

async function computePublicSlots(
  restaurantId:   string,
  date:           Date,
  partySize:      number,
  openTime:       string,
  lastSeating:    string,
  intervalMinutes: number,
  durationMinutes: number,
  bufferMinutes:  number,
  minBookingTime: Date
): Promise<PublicSlot[]> {
  const firstSlot = parseTimeOnDate(date, openTime);
  const lastSlot  = parseTimeOnDate(date, lastSeating);
  if (lastSlot <= firstSlot) return [];

  const queryStart = addMinutes(firstSlot, -bufferMinutes);
  const queryEnd   = addMinutes(addMinutes(lastSlot, durationMinutes), bufferMinutes);

  // Single-pass data fetch
  const [tables, reservations, blocks] = await Promise.all([
    prisma.table.findMany({
      where: {
        restaurantId,
        isActive: true,
        locked:   false,
        minCovers: { lte: partySize },
        maxCovers: { gte: partySize },
      },
      select: { id: true, maxCovers: true },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date,
        status:  { in: ['CONFIRMED', 'SEATED', 'PENDING'] },
        tableId: { not: null },
      },
      select: { tableId: true, time: true, duration: true },
    }),
    prisma.blockedPeriod.findMany({
      where: {
        restaurantId,
        startTime: { lt: queryEnd },
        endTime:   { gt: queryStart },
      },
      select: { tableId: true, startTime: true, endTime: true },
    }),
  ]);

  if (tables.length === 0) return [];

  const restaurantBlocks = blocks.filter(b => b.tableId === null);
  const slots: PublicSlot[] = [];
  let cursor = firstSlot;

  while (cursor <= lastSlot) {
    const timeStr      = formatTime(cursor);
    const slotEnd      = addMinutes(cursor, durationMinutes);
    const effStart     = addMinutes(cursor, -bufferMinutes);
    const effEnd       = addMinutes(slotEnd, bufferMinutes);
    const slotInterval = { start: effStart, end: effEnd };

    // Skip past the minimum advance booking window
    if (cursor < minBookingTime) {
      cursor = addMinutes(cursor, intervalMinutes);
      continue;
    }

    // Skip if a restaurant-level block covers this slot
    const hasRestaurantBlock = restaurantBlocks.some(b =>
      areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime })
    );
    if (hasRestaurantBlock) {
      cursor = addMinutes(cursor, intervalMinutes);
      continue;
    }

    // Count available tables
    let availableCount = 0;
    for (const table of tables) {
      const tableBlocked = blocks.some(b =>
        b.tableId === table.id &&
        areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime })
      );
      if (tableBlocked) continue;

      const hasConflict = reservations.some(r => {
        if (r.tableId !== table.id) return false;
        const rStart = parseTimeOnDate(date, r.time);
        const rEnd   = addMinutes(rStart, r.duration + bufferMinutes);
        return areIntervalsOverlapping(slotInterval, { start: rStart, end: rEnd });
      });
      if (!hasConflict) availableCount++;
    }

    if (availableCount > 0) {
      const tier: 'IDEAL' | 'GOOD' | 'LIMITED' =
        availableCount >= 3 ? 'IDEAL' : availableCount === 2 ? 'GOOD' : 'LIMITED';
      slots.push({ time: timeStr, available: true, tier, tablesLeft: availableCount });
    } else {
      slots.push({ time: timeStr, available: false, tier: 'IDEAL', tablesLeft: 0 });
    }

    cursor = addMinutes(cursor, intervalMinutes);
  }

  return slots;
}

// ─── Alternative slot finder ──────────────────────────────────────────────────
// When a date is fully booked, look forward up to 14 days for the first
// available slot on each open day, returning up to 3 alternatives.

async function findAlternatives(
  restaurant:     RestaurantWithHours,
  s:              ReturnType<typeof parseSettings>,
  requestedDate:  string,
  partySize:      number,
  minBookingTime: Date,
  maxDate:        Date
): Promise<BookingAlternative[]> {
  const alternatives: BookingAlternative[] = [];
  const base = new Date(requestedDate + 'T00:00:00.000Z');
  let found = 0;

  for (let offset = 1; offset <= 14 && found < 3; offset++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    if (d > maxDate) break;

    const hours = restaurant.operatingHours.find(h => h.dayOfWeek === d.getUTCDay());
    if (!hours?.isOpen) continue;

    const slots = await computePublicSlots(
      restaurant.id, d, partySize,
      hours.openTime, hours.lastSeating,
      s.slotIntervalMinutes, s.defaultTurnMinutes, s.bufferBetweenTurnsMinutes,
      minBookingTime
    );

    const first = slots.find(sl => sl.available);
    if (first) {
      alternatives.push({ date: d.toISOString().split('T')[0], time: first.time, tablesLeft: first.tablesLeft });
      found++;
    }
  }

  return alternatives;
}

// ─── Booking transaction (serializable) ──────────────────────────────────────
// Picks the best-fit table inside the transaction so the table assignment
// is part of the atomic unit — making concurrent overbooking impossible.

async function executeBookingTransaction(
  restaurantId:   string,
  date:           Date,
  time:           string,
  partySize:      number,
  durationMinutes: number,
  bufferMinutes:  number,
  token:          string,
  guest: {
    guestName:  string;
    guestPhone: string;
    guestEmail?: string;
    occasion?:  string;
    guestNotes?: string;
  }
): Promise<{ id: string; tableId: string | null }> {
  const slotStart  = parseTimeOnDate(date, time);
  const slotEnd    = addMinutes(slotStart, durationMinutes);
  const effStart   = addMinutes(slotStart, -bufferMinutes);
  const effEnd     = addMinutes(slotEnd, bufferMinutes);
  const slotInterval = { start: effStart, end: effEnd };

  return prisma.$transaction(async (tx) => {
    // Re-read availability inside the transaction — this is what makes
    // serializable isolation meaningful: both transactions read the same
    // committed state, and one will lose the serialization check.
    const tables = await tx.table.findMany({
      where: {
        restaurantId,
        isActive:  true,
        locked:    false,
        minCovers: { lte: partySize },
        maxCovers: { gte: partySize },
      },
      select:  { id: true, maxCovers: true },
      orderBy: { maxCovers: 'asc' }, // smallest viable table first
    });

    if (tables.length === 0) throw new SlotTakenError();

    const [reservations, blocks] = await Promise.all([
      tx.reservation.findMany({
        where: {
          restaurantId,
          date,
          status:  { in: ['CONFIRMED', 'SEATED', 'PENDING'] },
          tableId: { in: tables.map(t => t.id) },
        },
        select: { tableId: true, time: true, duration: true },
      }),
      tx.blockedPeriod.findMany({
        where: {
          restaurantId,
          startTime: { lt: effEnd },
          endTime:   { gt: effStart },
        },
        select: { tableId: true, startTime: true, endTime: true },
      }),
    ]);

    // Restaurant-level block check
    if (blocks.some(b => b.tableId === null &&
        areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime }))) {
      throw new SlotTakenError();
    }

    // Find best-fit available table
    const bestTable = tables.find(table => {
      if (blocks.some(b => b.tableId === table.id &&
          areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime }))) {
        return false;
      }
      return !reservations.some(r => {
        if (r.tableId !== table.id) return false;
        const rStart = parseTimeOnDate(date, r.time);
        const rEnd   = addMinutes(rStart, r.duration + bufferMinutes);
        return areIntervalsOverlapping(slotInterval, { start: rStart, end: rEnd });
      });
    });

    if (!bestTable) throw new SlotTakenError();

    // Create the reservation — table is assigned atomically
    const reservation = await tx.reservation.create({
      data: {
        restaurantId,
        tableId:           bestTable.id,
        partySize,
        date,
        time,
        duration:          durationMinutes,
        status:            'PENDING',
        source:            'ONLINE',
        guestName:         guest.guestName,
        guestPhone:        guest.guestPhone,
        guestEmail:        guest.guestEmail  || null,
        occasion:          guest.occasion    || null,
        guestNotes:        guest.guestNotes  || null,
        confirmationToken: token,
      },
      select: { id: true, tableId: true },
    });

    // Activity log (inline — logActivity is not exported from reservations/service)
    const actLog = await tx.reservationActivity.create({
      data: { reservationId: reservation.id, action: 'CREATED', actor: 'guest (online)' },
      select: { id: true },
    });
    await tx.$executeRaw`
      UPDATE reservation_activity
      SET details = ${JSON.stringify({
        toStatus: 'PENDING', source: 'ONLINE',
        partySize, date: date.toISOString().split('T')[0],
        time, guestName: guest.guestName, tableId: bestTable.id,
        occasion: guest.occasion ?? null,
      })}::jsonb
      WHERE id = ${actLog.id}
    `;

    return reservation;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait:  5_000,
    timeout: 10_000,
  });
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const AvailabilityQuerySchema = z.object({
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  partySize: z.coerce.number().int().min(1).max(100),
});

const ReserveSchema = z.object({
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time:       z.string().regex(/^\d{2}:\d{2}$/),
  partySize:  z.number().int().min(1).max(100),
  guestName:  z.string().min(1).max(200),
  guestPhone: z.string().min(3).max(30),
  guestEmail: z.string().max(200).optional(),
  occasion:   z.string().max(100).optional(),
  guestNotes: z.string().max(1000).optional(),
});

// ─── GET /api/public/book/:slug ───────────────────────────────────────────────

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params['slug'] as string;
    const restaurant = await findRestaurantBySlug(slug);
    if (!restaurant || restaurant.isSystem) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Restaurant not found.' } });
    }

    const s = parseSettings(restaurant.settings);

    return res.json({
      id:                   restaurant.id,
      name:                 restaurant.name,
      slug:                 restaurant.slug,
      timezone:             restaurant.timezone,
      description:          restaurant.description,
      cuisine:              restaurant.cuisine,
      address:              restaurant.address,
      logoUrl:              restaurant.logoUrl,
      coverImageUrl:        restaurant.coverImageUrl,
      websiteUrl:           restaurant.websiteUrl,
      instagramUrl:         restaurant.instagramUrl,
      googleMapsUrl:        restaurant.googleMapsUrl,
      wazeUrl:              restaurant.wazeUrl,
      parkingNotes:         restaurant.parkingNotes,
      specialInstructions:  restaurant.specialInstructions,
      cancellationPolicy:   restaurant.cancellationPolicy,
      maxPartySize:         Math.min(s.maxPartySize, config.maxPartySizeAbsolute),
      slotIntervalMinutes:  s.slotIntervalMinutes,
      maxAdvanceBookingDays: s.maxAdvanceBookingDays,
      operatingHours: restaurant.operatingHours.map(h => ({
        dayOfWeek:  h.dayOfWeek,
        isOpen:     h.isOpen,
        openTime:   h.openTime,
        closeTime:  h.closeTime,
        lastSeating: h.lastSeating,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /api/public/book/:slug/availability ──────────────────────────────────

router.get('/:slug/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug   = req.params['slug'] as string;
    const parsed = AvailabilityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.' } });
    }
    const { date, partySize } = parsed.data;

    const restaurant = await findRestaurantBySlug(slug);
    if (!restaurant || restaurant.isSystem) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Restaurant not found.' } });
    }

    const s          = parseSettings(restaurant.settings);
    const maxParty   = Math.min(s.maxPartySize, config.maxPartySizeAbsolute);
    if (partySize < 1 || partySize > maxParty) {
      return res.status(400).json({ error: { code: 'INVALID_PARTY_SIZE', message: `Party size must be between 1 and ${maxParty}.` } });
    }

    const now            = new Date();
    const minBookingTime = addMinutes(now, s.minAdvanceBookingHours * 60);
    const maxDate        = addMinutes(now, s.maxAdvanceBookingDays * 24 * 60);
    const dateObj        = new Date(date + 'T00:00:00.000Z');
    const todayUTC       = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z');

    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'Invalid date.' } });
    }
    if (dateObj < todayUTC) {
      return res.json({ date, partySize, slots: [], isFullyBooked: false, isClosed: false, isPast: true, alternatives: [] });
    }
    if (dateObj > maxDate) {
      return res.json({ date, partySize, slots: [], isFullyBooked: false, isClosed: false, isPast: false, isTooFar: true, alternatives: [] });
    }

    const hours = restaurant.operatingHours.find(h => h.dayOfWeek === dateObj.getUTCDay());
    if (!hours?.isOpen) {
      return res.json({ date, partySize, slots: [], isFullyBooked: false, isClosed: true, isPast: false, alternatives: [] });
    }

    const slots        = await computePublicSlots(
      restaurant.id, dateObj, partySize,
      hours.openTime, hours.lastSeating,
      s.slotIntervalMinutes, s.defaultTurnMinutes, s.bufferBetweenTurnsMinutes,
      minBookingTime
    );
    const availableSlots  = slots.filter(sl => sl.available);
    const isFullyBooked   = slots.length > 0 && availableSlots.length === 0;
    const isNearlyFull    = availableSlots.length > 0 && availableSlots.length <= 2;

    let alternatives: BookingAlternative[] = [];
    if (isFullyBooked || isNearlyFull) {
      alternatives = await findAlternatives(restaurant, s, date, partySize, minBookingTime, maxDate);
    }

    return res.json({
      date, partySize,
      timezone:    restaurant.timezone,
      slots,
      isFullyBooked,
      isClosed:    false,
      isPast:      false,
      alternatives,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/public/book/:slug/reserve ─────────────────────────────────────

router.post('/:slug/reserve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Rate limiting
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
    if (isRateLimited(ip)) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many booking attempts. Please try again in a minute.' } });
    }

    const parsed = ReserveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid booking data.' } });
    }
    const body = parsed.data;

    const restaurant = await findRestaurantBySlug(req.params['slug'] as string);
    if (!restaurant || restaurant.isSystem) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Restaurant not found.' } });
    }

    const s          = parseSettings(restaurant.settings);
    const now        = new Date();
    const minBookingTime = addMinutes(now, s.minAdvanceBookingHours * 60);
    const maxDate        = addMinutes(now, s.maxAdvanceBookingDays * 24 * 60);

    // Party size guard
    const maxParty = Math.min(s.maxPartySize, config.maxPartySizeAbsolute);
    if (body.partySize < 1 || body.partySize > maxParty) {
      return res.status(400).json({ error: { code: 'INVALID_PARTY_SIZE', message: `Party size must be between 1 and ${maxParty}.` } });
    }

    // Date validity
    const dateObj = new Date(body.date + 'T00:00:00.000Z');
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: { code: 'INVALID_DATE', message: 'Invalid date.' } });
    }

    // Advance booking window
    const requestedSlot = parseTimeOnDate(dateObj, body.time);
    if (requestedSlot < minBookingTime) {
      return res.status(400).json({ error: { code: 'TOO_SOON', message: `Reservations require at least ${s.minAdvanceBookingHours} hours advance notice.` } });
    }
    if (dateObj > maxDate) {
      return res.status(400).json({ error: { code: 'TOO_FAR', message: `Bookings are available up to ${s.maxAdvanceBookingDays} days in advance.` } });
    }

    // Operating hours
    const hours = restaurant.operatingHours.find(h => h.dayOfWeek === dateObj.getUTCDay());
    if (!hours?.isOpen) {
      return res.status(400).json({ error: { code: 'CLOSED', message: 'The restaurant is closed on that day.' } });
    }
    if (body.time < hours.openTime || body.time > hours.lastSeating) {
      return res.status(400).json({ error: { code: 'OUTSIDE_HOURS', message: 'That time is outside of operating hours.' } });
    }

    // Execute booking (serializable transaction — secures the slot)
    const token = crypto.randomUUID();
    let reservation: { id: string; tableId: string | null };

    try {
      reservation = await executeBookingTransaction(
        restaurant.id, dateObj, body.time, body.partySize,
        s.defaultTurnMinutes, s.bufferBetweenTurnsMinutes,
        token, {
          guestName:  body.guestName.trim(),
          guestPhone: body.guestPhone.trim(),
          guestEmail: body.guestEmail,
          occasion:   body.occasion,
          guestNotes: body.guestNotes,
        }
      );
    } catch (err) {
      if (err instanceof SlotTakenError ||
          (err instanceof Error && (err.message.includes('40001') || err.message.includes('serialize')))) {
        const alternatives = await findAlternatives(restaurant, s, body.date, body.partySize, minBookingTime, maxDate);
        return res.status(409).json({ error: { code: 'SLOT_TAKEN', message: 'That time is no longer available.', alternatives } });
      }
      throw err;
    }

    // ── Post-booking side effects (all non-fatal) ─────────────────────────────

    // 1. Link guest CRM record and increment visit count
    void (async () => {
      try {
        const { firstName, lastName } = splitName(body.guestName.trim());
        const { guest } = await findOrCreateGuest(restaurant.id, {
          firstName, lastName,
          phone: body.guestPhone.trim(),
          email: body.guestEmail || undefined,
        });
        await Promise.all([
          prisma.reservation.update({ where: { id: reservation.id }, data: { guestId: guest.id } }),
          prisma.guest.update({ where: { id: guest.id }, data: { visitCount: { increment: 1 } } }),
        ]);
      } catch (e) {
        console.error('[booking] Guest CRM link failed:', e instanceof Error ? e.message : e);
      }
    })();

    // 2. Send WhatsApp confirmation
    void (async () => {
      try {
        const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}`;
        await sendConfirmationSms(
          body.guestPhone.trim(),
          body.guestName.trim(),
          restaurant.name,
          body.date,
          body.time,
          body.partySize,
          confirmUrl
        );
        await prisma.reservation.update({
          where: { id: reservation.id },
          data:  { confirmationSentAt: new Date() },
        });
      } catch (e) {
        console.error('[booking] WhatsApp confirmation failed:', e instanceof Error ? e.message : e);
      }
    })();

    return res.status(201).json({
      reservationId:     reservation.id,
      confirmationToken: token,
      status:            'PENDING',
      date:              body.date,
      time:              body.time,
      partySize:         body.partySize,
      restaurantName:    restaurant.name,
      restaurantLogoUrl: restaurant.logoUrl,
    });
  } catch (err) { next(err); }
});

export default router;
