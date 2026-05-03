import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { addMinutes, areIntervalsOverlapping } from 'date-fns';
import { parseTimeOnDate, formatTime } from '../../engine/availability';
import { sendConfirmationSms, sendWhatsApp } from '../../lib/sms';
import { findOrCreateGuest, splitName } from '../guests/service';
import { config } from '../../config';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublicSlot {
  time: string;
  available: boolean;
  tier: 'IDEAL' | 'GOOD' | 'LIMITED';
  tablesLeft: number;
  softState: 'HIGH_DEMAND' | 'SHORT_WINDOW' | null;
  _score: number;  // stripped before API response; used for alternative ranking
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

function makeRateLimiter(max: number) {
  const map = new Map<string, { count: number; resetAt: number }>();
  return function isLimited(ip: string): boolean {
    const now   = Date.now();
    const entry = map.get(ip);
    if (!entry || entry.resetAt < now) {
      map.set(ip, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    if (entry.count >= max) return true;
    entry.count++;
    return false;
  };
}

const isRateLimited         = makeRateLimiter(10); // reserve: 10/min
const isWaitlistRateLimited = makeRateLimiter(5);  // waitlist: 5/min

function fmt12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
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

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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
      select:  { id: true, maxCovers: true },
      orderBy: { maxCovers: 'asc' },
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

  const restaurantBlocks   = blocks.filter(b => b.tableId === null);
  const lastSeatingMinutes = timeToMinutes(lastSeating);
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

    // Count available tables, tracking best-fit for scoring
    let availableCount   = 0;
    let bestFitMaxCovers = Infinity;
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
      if (!hasConflict) {
        availableCount++;
        if (table.maxCovers < bestFitMaxCovers) bestFitMaxCovers = table.maxCovers;
      }
    }

    if (availableCount > 0) {
      const tier: 'IDEAL' | 'GOOD' | 'LIMITED' =
        availableCount >= 3 ? 'IDEAL' : availableCount === 2 ? 'GOOD' : 'LIMITED';

      // ── Soft state detection (pre-fetched data, zero extra queries) ──────────
      const slotMinutes = timeToMinutes(timeStr);
      const windowCount = reservations.filter(r => Math.abs(timeToMinutes(r.time) - slotMinutes) <= 60).length;
      const softState: PublicSlot['softState'] =
        windowCount >= Math.ceil(tables.length * 0.5)             ? 'HIGH_DEMAND' :
        (lastSeatingMinutes - slotMinutes) <= 60 && availableCount <= 2 ? 'SHORT_WINDOW' :
        null;

      // ── Slot score (fit + pacing; proximity added in findAlternatives) ───────
      const fitScore    = 1 - (bestFitMaxCovers - partySize) / bestFitMaxCovers;
      const pacingScore = Math.max(0, 1 - windowCount / Math.max(1, tables.length));
      const _score      = fitScore * 0.40 + pacingScore * 0.35;

      slots.push({ time: timeStr, available: true, tier, tablesLeft: availableCount, softState, _score });
    } else {
      slots.push({ time: timeStr, available: false, tier: 'IDEAL', tablesLeft: 0, softState: null, _score: 0 });
    }

    cursor = addMinutes(cursor, intervalMinutes);
  }

  return slots;
}

// ─── Alternative slot finder ──────────────────────────────────────────────────
// Scans up to 14 days ahead for the best-scored available slot per day.
// When requestedTime is provided (SLOT_TAKEN case), also checks same-day slots
// within ±2 hours of the taken time before moving to future dates.
// Scoring: table fit (0.40) + pacing (0.35) + time proximity (0.25, when known).

async function findAlternatives(
  restaurant:    RestaurantWithHours,
  s:             ReturnType<typeof parseSettings>,
  requestedDate: string,
  requestedTime: string | null,
  partySize:     number,
  minBookingTime: Date,
  maxDate:        Date
): Promise<BookingAlternative[]> {
  const alternatives: BookingAlternative[] = [];
  const base = new Date(requestedDate + 'T00:00:00.000Z');
  let found = 0;

  // offset=0 = same day, only when requestedTime is known (SLOT_TAKEN path)
  const startOffset = requestedTime ? 0 : 1;
  const reqMin      = requestedTime ? timeToMinutes(requestedTime) : null;

  for (let offset = startOffset; offset <= 14 && found < 3; offset++) {
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

    let available = slots.filter(sl => sl.available);
    if (available.length === 0) continue;

    // Same-day: only show slots within ±2 hours of the taken time, excluding that exact time
    if (offset === 0 && requestedTime && reqMin !== null) {
      available = available.filter(sl =>
        sl.time !== requestedTime && Math.abs(timeToMinutes(sl.time) - reqMin) <= 120
      );
      if (available.length === 0) continue;
    }

    // Pick highest-scored slot. _score = fit*0.40 + pacing*0.35 (from computePublicSlots).
    // Add proximity bonus of 0.25 when requestedTime is known.
    let bestSlot: PublicSlot = available[0]!;
    let bestScore = -Infinity;
    for (const sl of available) {
      let score = sl._score;
      if (reqMin !== null) {
        const delta = Math.abs(timeToMinutes(sl.time) - reqMin);
        score += Math.max(0, 1 - delta / 120) * 0.25;
      }
      if (score > bestScore) { bestScore = score; bestSlot = sl; }
    }

    alternatives.push({ date: d.toISOString().split('T')[0], time: bestSlot.time, tablesLeft: bestSlot.tablesLeft });
    found++;
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
  lang:       z.enum(['en', 'he']).optional(),
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
      alternatives = await findAlternatives(restaurant, s, date, null, partySize, minBookingTime, maxDate);
    }

    // Strip internal _score before sending to client
    const publicSlots = slots.map(({ _score, ...rest }) => rest);
    return res.json({
      date, partySize,
      timezone:    restaurant.timezone,
      slots:       publicSlots,
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
        const alternatives = await findAlternatives(restaurant, s, body.date, body.time, body.partySize, minBookingTime, maxDate);
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
        const lang       = body.lang ?? 'en';
        const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}${lang === 'he' ? '&lang=he' : ''}`;
        await sendConfirmationSms(
          body.guestPhone.trim(),
          body.guestName.trim(),
          restaurant.name,
          body.date,
          body.time,
          body.partySize,
          confirmUrl,
          lang
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

// ─── POST /api/public/book/:slug/waitlist ─────────────────────────────────────
// Public self-service waitlist entry. No auth required.
// Rate-limited to 5 submissions per IP per minute.

const WaitlistSchema = z.object({
  guestName:     z.string().min(1).max(200),
  guestPhone:    z.string().min(3).max(30),
  partySize:     z.number().int().min(1).max(100),
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/),
  flexibleTime:  z.boolean().optional(),
  notes:         z.string().max(1000).optional(),
});

router.post('/:slug/waitlist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress ?? 'unknown';
    if (isWaitlistRateLimited(ip)) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again in a minute.' } });
    }

    const parsed = WaitlistSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid waitlist data.' } });
    }
    const body = parsed.data;

    const restaurant = await findRestaurantBySlug(req.params['slug'] as string);
    if (!restaurant || restaurant.isSystem) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Restaurant not found.' } });
    }

    // Date validation — no past dates
    const dateObj   = new Date(body.date + 'T00:00:00.000Z');
    const todayUTC  = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z');
    if (dateObj < todayUTC) {
      return res.status(400).json({ error: { code: 'PAST_DATE', message: 'Cannot join waitlist for a past date.' } });
    }

    // Auto-link Guest CRM (non-fatal)
    let guestId: string | null = null;
    try {
      const { firstName, lastName } = splitName(body.guestName.trim());
      const { guest } = await findOrCreateGuest(restaurant.id, { firstName, lastName, phone: body.guestPhone.trim() });
      guestId = guest.id;
    } catch { /* non-fatal */ }

    const publicToken = randomUUID();

    const entry = await prisma.waitlistEntry.create({
      data: {
        restaurantId:  restaurant.id,
        guestId,
        date:          dateObj,
        guestName:     body.guestName.trim(),
        guestPhone:    body.guestPhone.trim(),
        partySize:     body.partySize,
        source:        'PUBLIC_ONLINE',
        publicToken,
        preferredTime: body.preferredTime,
        flexibleTime:  body.flexibleTime ?? false,
        notes:         body.notes?.trim() || null,
        quotedWaitMinutes: null,
      },
    });

    // WhatsApp acknowledgment — fire and forget
    void (async () => {
      try {
        const dateLabel = new Date(body.date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
        });
        const flexLine = body.flexibleTime ? '\nFlexible: ±1 hour' : '';
        const message =
          `Hi ${body.guestName.trim()},\n\n` +
          `You're on the waitlist at ${restaurant.name}.\n\n` +
          `Date: ${dateLabel}\n` +
          `Party: ${body.partySize} ${body.partySize === 1 ? 'guest' : 'guests'}\n` +
          `Preferred time: ${fmt12h(body.preferredTime)}${flexLine}\n\n` +
          `We'll reach out if a table becomes available. Thank you for your patience.\n\n` +
          `— ${restaurant.name}`;
        await sendWhatsApp(body.guestPhone.trim(), message);
      } catch (e) {
        console.error('[waitlist] WhatsApp send failed:', e instanceof Error ? e.message : e);
      }
    })();

    return res.status(201).json({
      publicToken:       entry.publicToken,
      restaurantName:    restaurant.name,
      restaurantLogoUrl: restaurant.logoUrl,
      date:              body.date,
      partySize:         body.partySize,
      preferredTime:     body.preferredTime,
    });
  } catch (err) { next(err); }
});

export default router;
