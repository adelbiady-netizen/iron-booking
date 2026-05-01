import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  CreateReservationSchema,
  UpdateReservationSchema,
  AssignTableSchema,
  MoveTableSchema,
  ListReservationsQuerySchema,
  ListReservationsQuery,
} from './schema';
import * as service from './service';
import { sendConfirmationSms, sendReminderSms } from '../../lib/sms';
import { sendReservationReminders } from '../../lib/reminder';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { NotFoundError, BusinessRuleError } from '../../lib/errors';

const router = Router();
router.use(authenticate);

const actorName = (req: Request) => `${req.auth.email}`;

// Express 5 types req.params values as string | string[]; route params from
// :id patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// GET /reservations
router.get('/', validate(ListReservationsQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.listReservations(
      req.auth.restaurantId,
      req.query as unknown as ListReservationsQuery
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /reservations
router.post('/', validate(CreateReservationSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.createReservation(req.auth.restaurantId, req.body, actorName(req));
    res.status(201).json(r);
  } catch (err) { next(err); }
});

// GET /reservations/:id/timeline — must come before GET /:id to avoid shadowing
router.get('/:id/timeline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.getReservationTimeline(req.auth.restaurantId, p(req, 'id'));
    res.json(r);
  } catch (err) { next(err); }
});

// GET /reservations/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.getReservation(req.auth.restaurantId, p(req, 'id'));
    res.json(r);
  } catch (err) { next(err); }
});

// PATCH /reservations/:id
router.patch('/:id', validate(UpdateReservationSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.updateReservation(req.auth.restaurantId, p(req, 'id'), req.body, actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/confirm
router.post('/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.confirmReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/seat
router.post('/:id/seat', validate(AssignTableSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.seatReservation(
      req.auth.restaurantId,
      p(req, 'id'),
      req.body.tableId,
      actorName(req),
      req.body.overrideConflicts
    );
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/move
router.post('/:id/move', validate(MoveTableSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.moveReservation(req.auth.restaurantId, p(req, 'id'), req.body, actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/complete
router.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.completeReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/no-show
router.post('/:id/no-show', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.markNoShow(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/cancel
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reason = req.body?.reason as string | undefined;
    const r = await service.cancelReservation(req.auth.restaurantId, p(req, 'id'), reason, actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/undo
router.post('/:id/undo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.undoReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/send-confirmation — generate token + WhatsApp message
router.post('/:id/send-confirmation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [reservation, restaurant] = await Promise.all([
      prisma.reservation.findUnique({ where: { id: p(req, 'id') } }),
      prisma.restaurant.findUnique({ where: { id: req.auth.restaurantId }, select: { name: true } }),
    ]);
    if (!reservation || reservation.restaurantId !== req.auth.restaurantId) {
      throw new NotFoundError('Reservation', p(req, 'id'));
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status)) {
      throw new BusinessRuleError(`Cannot send confirmation for a ${reservation.status} reservation`);
    }
    if (!reservation.guestPhone) {
      throw new BusinessRuleError('Reservation has no phone number for WhatsApp confirmation');
    }

    const token      = crypto.randomUUID();
    const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}`;

    // Save token to DB FIRST so the link is valid before the SMS arrives
    await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { confirmationToken: token },
    });

    await sendConfirmationSms(
      reservation.guestPhone,
      reservation.guestName,
      restaurant?.name ?? 'the restaurant',
      reservation.date.toISOString().split('T')[0],
      reservation.time,
      reservation.partySize,
      confirmUrl
    );

    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data:  { confirmationSentAt: new Date() },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// POST /reservations/:id/mark-confirmed — staff manually marks guest as confirmed
router.post('/:id/mark-confirmed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reservation = await prisma.reservation.findUnique({ where: { id: p(req, 'id') } });
    if (!reservation || reservation.restaurantId !== req.auth.restaurantId) {
      throw new NotFoundError('Reservation', p(req, 'id'));
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status)) {
      throw new BusinessRuleError(`Cannot confirm a ${reservation.status} reservation`);
    }

    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        isConfirmedByGuest: true,
        confirmedAt: reservation.confirmedAt ?? new Date(),
        status: reservation.status === 'PENDING' ? 'CONFIRMED' : reservation.status,
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

const BulkConfirmSchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timeTo:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// POST /reservations/send-confirmations — bulk send for a date/time window
router.post('/send-confirmations', validate(BulkConfirmSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, timeFrom, timeTo } = req.body as z.infer<typeof BulkConfirmSchema>;

    const [restaurant, reservations] = await Promise.all([
      prisma.restaurant.findUnique({ where: { id: req.auth.restaurantId }, select: { name: true } }),
      prisma.reservation.findMany({
        where: {
          restaurantId:       req.auth.restaurantId,
          date:               new Date(date + 'T00:00:00.000Z'),
          status:             { in: ['PENDING', 'CONFIRMED'] },
          confirmationSentAt: null,
          guestPhone:         { not: null },
          ...(timeFrom || timeTo ? {
            time: {
              ...(timeFrom ? { gte: timeFrom } : {}),
              ...(timeTo   ? { lte: timeTo   } : {}),
            },
          } : {}),
        },
      }),
    ]);

    const restaurantName = restaurant?.name ?? 'the restaurant';
    let sent = 0;
    const failed: string[] = [];

    for (const r of reservations) {
      try {
        const token      = crypto.randomUUID();
        const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}`;

        // Save token first — link is valid before SMS arrives
        await prisma.reservation.update({
          where: { id: r.id },
          data:  { confirmationToken: token },
        });

        await sendConfirmationSms(r.guestPhone!, r.guestName, restaurantName, date, r.time, r.partySize, confirmUrl);

        await prisma.reservation.update({
          where: { id: r.id },
          data:  { confirmationSentAt: new Date() },
        });
        sent++;
      } catch (err) {
        console.error(`[bulk-confirm] Failed for reservation ${r.id}:`, err instanceof Error ? err.message : err);
        failed.push(r.id);
      }
    }

    res.json({ sent, failed, total: reservations.length });
  } catch (err) { next(err); }
});

// POST /reservations/:id/send-reminder — send a single reminder for one reservation
router.post('/:id/send-reminder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [reservation, restaurant] = await Promise.all([
      prisma.reservation.findUnique({ where: { id: p(req, 'id') } }),
      prisma.restaurant.findUnique({ where: { id: req.auth.restaurantId }, select: { name: true } }),
    ]);
    if (!reservation || reservation.restaurantId !== req.auth.restaurantId) {
      throw new NotFoundError('Reservation', p(req, 'id'));
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status)) {
      throw new BusinessRuleError(`Cannot send reminder for a ${reservation.status} reservation`);
    }
    if (!reservation.guestPhone) {
      throw new BusinessRuleError('Reservation has no phone number for WhatsApp reminder');
    }
    if (reservation.isConfirmedByGuest) {
      throw new BusinessRuleError('Guest has already confirmed — no reminder needed');
    }
    if (reservation.reminderCount >= 2) {
      throw new BusinessRuleError('Maximum of 2 reminders already sent for this reservation');
    }

    const token      = reservation.confirmationToken ?? crypto.randomUUID();
    const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}`;

    await sendReminderSms(
      reservation.guestPhone,
      reservation.guestName,
      restaurant?.name ?? 'the restaurant',
      reservation.time,
      confirmUrl
    );

    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        remindedAt:    new Date(),
        reminderCount: { increment: 1 },
        ...(reservation.confirmationToken ? {} : { confirmationToken: token }),
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

const SendRemindersSchema = z.object({
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  withinMinutes: z.number().int().min(1).max(240).default(60),
});

// POST /reservations/send-reminders — bulk remind unconfirmed guests within a time window
router.post('/send-reminders', validate(SendRemindersSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, withinMinutes } = req.body as z.infer<typeof SendRemindersSchema>;
    const result = await sendReservationReminders(req.auth.restaurantId, date, withinMinutes);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
