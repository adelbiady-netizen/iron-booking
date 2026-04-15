/**
 * Reservation controller — owns request parsing, validation, and response shaping.
 *
 * Field naming convention at the HTTP boundary intentionally differs from the
 * internal service layer to keep the public API intuitive for restaurant staff:
 *   customerName  → guestName
 *   phone         → guestPhone
 *   email         → guestEmail
 *   durationMinutes → durationMin
 *   notes         → guestNotes
 *   tableId       → preferredTableId
 *   zoneId        → (resolved to ZoneType via DB lookup) preferredZone
 *
 * Time handling:
 *   Callers send `date` (YYYY-MM-DD) + `startTime` (HH:MM) in the restaurant's
 *   local wall-clock time. The controller resolves the restaurant's IANA timezone
 *   and converts to UTC before calling the service.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ReservationService } from '../../services/reservation/ReservationService';
import { ValidationError } from '../../utils/errors';
import { localTimeToUTC } from '../../utils/datetime';
import { prisma } from '../../lib/prisma';
import type { ZoneType } from '@prisma/client';

const service = new ReservationService();

// ─── Validation schemas ────────────────────────────────────────────────────────

const VALID_SOURCES = ['HOST', 'PHONE', 'WALK_IN', 'ONLINE', 'THIRD_PARTY'] as const;
const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

/**
 * POST /reservations — create a reservation.
 *
 * `date` and `startTime` are in the restaurant's local time zone. The controller
 * fetches the restaurant's timezone and converts them to UTC before calling the
 * service, so callers never need to think about UTC offsets.
 */
const createSchema = z.object({
  restaurantId: z.string().min(1, 'restaurantId is required'),

  // Guest identity
  customerName: z.string().min(1, 'customerName is required').max(100),
  phone:        z.string().optional(),
  email:        z.string().email('Invalid email address').optional(),
  customerId:   z.string().optional(), // link to an existing Customer profile

  // Party size
  guestCount: z
    .number({ required_error: 'guestCount is required', invalid_type_error: 'guestCount must be a number' })
    .int('guestCount must be a whole number')
    .min(1, 'guestCount must be at least 1')
    .max(100, 'guestCount cannot exceed 100'),

  // Time — local wall-clock, not UTC
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM (24-hour)'),

  // Duration — optional, falls back to service period default then restaurant default
  durationMinutes: z
    .number()
    .int('durationMinutes must be a whole number')
    .min(30,  'minimum duration is 30 minutes')
    .max(360, 'maximum duration is 360 minutes')
    .optional(),

  // Notes visible to the guest (confirmation, etc.)
  notes: z.string().max(1000).optional(),

  // Seating preferences — both optional; algorithm falls back to best fit
  tableId: z.string().optional(), // preferred specific table
  zoneId:  z.string().optional(), // preferred zone (resolved to type internally)

  // Metadata
  source:      z.enum(VALID_SOURCES).optional(),
  createdById: z.string().optional(), // staffId who entered the booking
});

/**
 * GET /reservations — list reservations for a date.
 */
const listSchema = z.object({
  restaurantId: z.string().min(1, 'restaurantId is required'),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  timezone: z.string().default('UTC'),
  // Optional filter — note: CANCELLED reservations are excluded by the service
  // by default. Filter on CANCELLED will return an empty list unless you remove
  // that exclusion in ReservationService.listForDate.
  status: z.enum(VALID_STATUSES).optional(),
});

/**
 * PATCH /reservations/:id — update guest details.
 * Time rescheduling and status changes use dedicated action endpoints.
 */
const updateSchema = z.object({
  customerName: z.string().min(1).max(100).optional(),
  phone:        z.string().optional(),
  email:        z.string().email('Invalid email address').optional(),
  guestCount:   z.number().int().min(1).optional(),
  notes:        z.string().max(1000).optional(),
  staffNotes:   z.string().max(1000).optional(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Format Zod issues into a single readable string. */
function zodMsg(issues: z.ZodIssue[]): string {
  return issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reservations
 *
 * Creates a new reservation. On success returns 201 with the reservation view
 * (includes confirmation code, assigned tables, and status).
 *
 * Example body:
 * {
 *   "restaurantId":    "clxyz...",
 *   "customerName":    "Adel Karimi",
 *   "phone":           "+1-555-0100",
 *   "guestCount":      4,
 *   "date":            "2026-04-15",
 *   "startTime":       "19:30",
 *   "durationMinutes": 90,
 *   "notes":           "Window table preferred",
 *   "zoneId":          "clzone..." // optional
 * }
 */
export async function createReservation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(zodMsg(parsed.error.issues));

    const {
      restaurantId,
      date,
      startTime,
      zoneId,
      customerName,
      phone,
      email,
      guestCount,
      durationMinutes,
      notes,
      tableId,
      customerId,
      source,
      createdById,
    } = parsed.data;

    // Fetch restaurant timezone for local→UTC conversion
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { id: true, timezone: true },
    });
    if (!restaurant) throw new ValidationError(`Restaurant not found: ${restaurantId}`);

    // Convert wall-clock date + time to UTC
    const requestedStartTime = localTimeToUTC(date, startTime, restaurant.timezone);

    // Resolve optional zoneId → ZoneType (for the table-assignment algorithm)
    let preferredZone: ZoneType | undefined;
    if (zoneId) {
      const zone = await prisma.zone.findFirst({
        where:  { id: zoneId, restaurantId, isActive: true },
        select: { type: true },
      });
      if (!zone) throw new ValidationError(`Zone not found or inactive: ${zoneId}`);
      preferredZone = zone.type;
    }

    const reservation = await service.create({
      restaurantId,
      guestName:       customerName,
      guestPhone:      phone,
      guestEmail:      email,
      guestCount,
      requestedStartTime,
      durationMin:     durationMinutes,
      guestNotes:      notes,
      preferredTableId: tableId,
      preferredZone,
      customerId,
      source:          source as never,
      createdById,
    });

    res.status(201).json(reservation);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/reservations?restaurantId=...&date=YYYY-MM-DD&timezone=...&status=...
 *
 * Lists all non-cancelled reservations for a date, ordered by start time.
 * Optional `status` filter narrows results further (e.g. status=CONFIRMED).
 *
 * Response shape:
 * { "date": "2026-04-15", "count": 12, "reservations": [...] }
 */
export async function listReservations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(zodMsg(parsed.error.issues));

    const { restaurantId, date, timezone, status } = parsed.data;

    const all = await service.listForDate(restaurantId, date, timezone);

    // Apply optional in-memory status filter
    const reservations = status ? all.filter((r) => r.status === status) : all;

    res.json({ date, count: reservations.length, reservations });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/reservations/:id
 *
 * Fetch a single reservation by its internal ID.
 */
export async function getReservation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const reservation = await service.findById(req.params.id);
    res.json(reservation);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/reservations/confirmation/:code
 *
 * Look up a reservation by its confirmation code (printed on receipts / SMS).
 * Must be registered before /:id in the router to avoid shadowing.
 */
export async function getByConfirmationCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const reservation = await service.findByConfirmationCode(req.params.code);
    res.json(reservation);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/reservations/:id
 *
 * Update mutable guest details. Does NOT allow status changes or time
 * rescheduling — use the dedicated action endpoints for those.
 *
 * Example body:
 * { "guestCount": 5, "notes": "Added one more person" }
 */
export async function updateReservation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(zodMsg(parsed.error.issues));

    const { customerName, phone, email, guestCount, notes, staffNotes } = parsed.data;

    const reservation = await service.update(req.params.id, {
      guestName:  customerName,
      guestPhone: phone,
      guestEmail: email,
      guestCount,
      guestNotes: notes,
      staffNotes,
    });

    res.json(reservation);
  } catch (err) {
    next(err);
  }
}

// ─── Status transition handlers ────────────────────────────────────────────────
// These are thin — the service owns all the state-machine logic and guards.

/** POST /api/v1/reservations/:id/seat — mark as SEATED (party arrived). */
export async function seatReservation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.seat(req.params.id));
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/reservations/:id/complete — mark as COMPLETED (party departed). */
export async function completeReservation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.complete(req.params.id));
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/reservations/:id/cancel
 * Optional body: { "staffNotes": "Guest called to cancel" }
 */
export async function cancelReservation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { staffNotes } = req.body as { staffNotes?: string };
    res.json(await service.cancel(req.params.id, staffNotes));
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/reservations/:id/no-show — guest never arrived. */
export async function markNoShow(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.markNoShow(req.params.id));
  } catch (err) {
    next(err);
  }
}
