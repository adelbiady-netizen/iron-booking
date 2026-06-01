import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { formatDurationHe, formatDurationEn } from '../../lib/duration';
import {
  CreateReservationSchema,
  UpdateReservationSchema,
  AssignTableSchema,
  MoveTableSchema,
  SwapReservationsSchema,
  ListReservationsQuerySchema,
  ListReservationsQuery,
} from './schema';
import * as service from './service';
import { sendConfirmationSms } from '../../lib/sms';
import { sendSms, sendReservationReceivedSms } from '../../lib/messaging';
import { MessageType, MessageStatus } from '@prisma/client';
import { sendReservationReminders } from '../../lib/reminder';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { NotFoundError, BusinessRuleError } from '../../lib/errors';
import { eventBus } from '../../lib/eventBus';

// Notify all SSE-connected hosts in this restaurant that floor state changed.
// Called after every mutation that creates, updates, or removes a reservation.
// Fire-and-forget — never awaited, never allowed to throw.
function notifyFloorUpdated(restaurantId: string): void {
  eventBus.emit('floor_updated', { restaurantId });
}

function buildConfirmationSmsText(
  r: { guestName: string; date: Date | string; time: string; partySize: number; guestLang?: string | null; duration?: number | null },
  restaurantName: string,
): string {
  const lang = r.guestLang ?? 'he';
  const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
  if (lang === 'he') {
    const durationLine = r.duration ? ` השולחן יעמוד לרשותכם למשך ${formatDurationHe(r.duration)}.` : '';
    return `שלום ${r.guestName}, הזמנתך ב${restaurantName} לתאריך ${dateStr} בשעה ${r.time} ל-${r.partySize} אנשים אושרה.${durationLine} תודה!`;
  }
  const durationLine = r.duration ? ` Your table will be held for ${formatDurationEn(r.duration)}.` : '';
  return `Hi ${r.guestName}, your reservation at ${restaurantName} on ${dateStr} at ${r.time} for ${r.partySize} guests has been confirmed.${durationLine} Thank you!`;
}

function buildReminderSmsText(
  r: { guestName: string; time: string; guestLang?: string | null; duration?: number | null },
  restaurantName: string,
  confirmUrl: string,
): string {
  const lang = r.guestLang ?? 'he';
  if (lang === 'he') {
    const durationLine = r.duration ? ` השולחן יעמוד לרשותכם למשך ${formatDurationHe(r.duration)}.` : '';
    return `היי ${r.guestName}, תזכורת להזמנה שלך ב${restaurantName} היום בשעה ${r.time}.${durationLine} לאישור: ${confirmUrl}`;
  }
  const durationLine = r.duration ? ` Your table is held for ${formatDurationEn(r.duration)}.` : '';
  return `Hi ${r.guestName}, reminder for your reservation at ${restaurantName} today at ${r.time}.${durationLine} Confirm: ${confirmUrl}`;
}

function buildConfirmationRequestSmsText(
  r: { guestName: string; date: Date | string; time: string; partySize: number; guestLang?: string | null; duration?: number | null },
  restaurantName: string,
  confirmUrl: string,
): string {
  const lang = r.guestLang ?? 'he';
  const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
  if (lang === 'he') {
    const durationLine = r.duration ? ` השולחן יעמוד לרשותכם למשך ${formatDurationHe(r.duration)}.` : '';
    return `שלום ${r.guestName}, אנא אשר/י את הגעתך ל${restaurantName} בתאריך ${dateStr} בשעה ${r.time} ל-${r.partySize} אנשים.${durationLine} לאישור: ${confirmUrl}`;
  }
  const durationLine = r.duration ? ` Your table will be held for ${formatDurationEn(r.duration)}.` : '';
  return `Hi ${r.guestName}, please confirm your arrival at ${restaurantName} on ${dateStr} at ${r.time} for ${r.partySize} guests.${durationLine} Confirm here: ${confirmUrl}`;
}

const router = Router();
router.use(authenticate);

const actorName = (req: Request) =>
  `${req.auth.firstName} ${req.auth.lastName}`.trim() || req.auth.email || 'Host';

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
    notifyFloorUpdated(req.auth.restaurantId);

    // Fire-and-forget: send "reservation received" SMS via InforU.
    // Skip walk-ins (guest is physically present) and missing phone numbers.
    // Failure is logged but never surfaces to the host — the reservation already exists.
    if (r.guestPhone && r.source !== 'WALK_IN') {
      const lang    = r.guestLang === 'he' ? 'he' : 'en';
      const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      void sendReservationReceivedSms({
        restaurantId:  req.auth.restaurantId,
        reservationId: r.id,
        guestId:       r.guestId ?? undefined,
        phone:         r.guestPhone,
        guestName:     r.guestName,
        date:          dateStr,
        time:          r.time,
        partySize:     r.partySize,
        duration:      r.duration ?? undefined,
        lang,
      }).catch((err: unknown) => {
        console.error(
          `[ReservationReceived] Failed for reservation ${r.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  } catch (err) { next(err); }
});

// GET /reservations/activity-log — must come before /:id routes
router.get('/activity-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, actor, action, page = '1', limit = '50' } = req.query as Record<string, string>;
    const restaurantId = req.auth.restaurantId;
    const isManager = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(req.auth.role);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Date boundaries — default to today in UTC if not provided
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
    const dayEnd   = new Date(`${targetDate}T23:59:59.999Z`);

    const selfActor = `${req.auth.firstName} ${req.auth.lastName}`.trim() || req.auth.email || 'Host';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      reservation: { restaurantId },
      timestamp: { gte: dayStart, lte: dayEnd },
    };

    if (action) where.action = action;

    if (isManager) {
      if (actor) where.actor = { contains: actor, mode: 'insensitive' };
    } else {
      where.actor = selfActor;
    }

    const [total, entries] = await Promise.all([
      prisma.reservationActivity.count({ where }),
      prisma.reservationActivity.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
        include: { reservation: { select: { id: true, guestName: true } } },
      }),
    ]);

    // Batch-resolve table names from details JSON fields
    const tableIdSet = new Set<string>();
    for (const e of entries) {
      const d = e.details as Record<string, unknown>;
      for (const key of ['tableId', 'fromTableId', 'toTableId', 'displacedFrom', 'assignedTableId']) {
        if (typeof d[key] === 'string') tableIdSet.add(d[key] as string);
      }
    }
    const tableNameMap: Record<string, string> = {};
    if (tableIdSet.size > 0) {
      const tables = await prisma.table.findMany({
        where: { id: { in: [...tableIdSet] } },
        select: { id: true, name: true },
      });
      for (const t of tables) tableNameMap[t.id] = t.name;
    }

    const data = entries.map(e => {
      const d = e.details as Record<string, unknown>;
      return {
        id:                e.id,
        action:            e.action,
        actor:             e.actor,
        timestamp:         e.timestamp.toISOString(),
        reservationId:     e.reservationId,
        guestName:         e.reservation?.guestName ?? (d.guestName as string | undefined) ?? '',
        tableId:           typeof d.tableId === 'string' ? d.tableId : null,
        tableName:         typeof d.tableId === 'string' ? (tableNameMap[d.tableId] ?? null) : null,
        fromTableName:     typeof d.fromTableId === 'string' ? (tableNameMap[d.fromTableId] ?? null) : null,
        toTableName:       typeof d.toTableId === 'string' ? (tableNameMap[d.toTableId] ?? null) : null,
        displacedFromName: typeof d.displacedFrom === 'string' ? (tableNameMap[d.displacedFrom] ?? null) : null,
        assignedTableName: typeof d.assignedTableId === 'string' ? (tableNameMap[d.assignedTableId] ?? null) : null,
        details:           d,
      };
    });

    res.json({ data, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// POST /reservations/swap — atomically swap tables between two reservations
router.post('/swap', validate(SwapReservationsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reservationAId, reservationBId } = req.body as { reservationAId: string; reservationBId: string };
    const result = await service.swapReservations(req.auth.restaurantId, reservationAId, reservationBId, actorName(req));
    res.json(result);
    notifyFloorUpdated(req.auth.restaurantId);
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
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/confirm
router.post('/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.confirmReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    notifyFloorUpdated(req.auth.restaurantId);

    let smsFailed = false;
    if (r.guestPhone) {
      try {
        // Dedup: skip if a SENT confirmation SMS already exists for this reservation.
        const existing = await prisma.messageLog.findFirst({
          where: { reservationId: r.id, messageType: MessageType.CONFIRMATION, status: MessageStatus.SENT },
        });
        if (!existing) {
          const restaurant = await prisma.restaurant.findUnique({
            where:  { id: req.auth.restaurantId },
            select: { name: true },
          });
          const message = buildConfirmationSmsText(r, restaurant?.name ?? '');
          const result = await sendSms({
            restaurantId:  req.auth.restaurantId,
            to:            r.guestPhone,
            message,
            type:          MessageType.CONFIRMATION,
            reservationId: r.id,
            guestId:       r.guestId ?? undefined,
          });
          if (!result.success) smsFailed = true;
        }
      } catch {
        smsFailed = true;
      }
    }

    res.json(smsFailed ? { ...r, _smsFailed: true } : r);
  } catch (err) { next(err); }
});

// POST /reservations/:id/seat
router.post('/:id/seat', validate(AssignTableSchema), async (req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  try {
    const r = await service.seatReservation(
      req.auth.restaurantId,
      p(req, 'id'),
      req.body.tableId,
      actorName(req),
      req.body.overrideConflicts,
      req.body.combinedTableIds,
      req.body.reorganizeIds
    );
    console.log(`[perf:seat] router total ${Date.now() - t0}ms`);
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/move
router.post('/:id/move', validate(MoveTableSchema), async (req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  try {
    const r = await service.moveReservation(req.auth.restaurantId, p(req, 'id'), req.body, actorName(req));
    console.log(`[perf:move] router total ${Date.now() - t0}ms`);
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/complete
router.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.completeReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/no-show
router.post('/:id/no-show', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.markNoShow(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/cancel
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reason = req.body?.reason as string | undefined;
    const r = await service.cancelReservation(req.auth.restaurantId, p(req, 'id'), reason, actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/unseat
router.post('/:id/unseat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.unseatReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/unconfirm — revert CONFIRMED → PENDING
// POST /reservations/:id/release-table — release table ownership from a late PENDING/CONFIRMED reservation.
// Clears tableId and combinedTableIds without changing status or marking no-show.
// Safe to call on any PENDING/CONFIRMED reservation that holds a table.
router.post('/:id/release-table', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.releaseTableOwnership(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

router.post('/:id/unconfirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.unconfirmReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// DELETE /reservations/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await service.deleteReservation(req.auth.restaurantId, p(req, 'id'));
    res.status(204).send();
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/undo
router.post('/:id/undo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.undoReservation(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/send-confirmation
// Generates a confirmation token then attempts WhatsApp and InforU SMS independently.
// Neither channel can block the other. Token is always persisted; confirmationSentAt
// is set if at least one channel succeeds. Returns per-channel failure flags.
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
      throw new BusinessRuleError('Reservation has no phone number for confirmation');
    }

    const lang           = (reservation.guestLang === 'he' ? 'he' : 'en') as 'en' | 'he';
    const token          = crypto.randomUUID();
    const confirmUrl      = `${config.frontendBaseUrl}/confirm?token=${token}${lang === 'he' ? '&lang=he' : ''}`;
    const shortConfirmUrl = `${config.frontendBaseUrl}/c/${token}`;
    const restaurantName = restaurant?.name ?? 'the restaurant';

    // ── Channel 1: WhatsApp ───────────────────────────────────────────────────
    let whatsappFailed = false;
    try {
      await sendConfirmationSms(
        req.auth.restaurantId,
        reservation.guestPhone,
        reservation.guestName,
        restaurantName,
        reservation.date.toISOString().split('T')[0],
        reservation.time,
        reservation.partySize,
        confirmUrl,
        lang
      );
    } catch (err) {
      whatsappFailed = true;
      console.error('[send-confirmation] WhatsApp failed:', err instanceof Error ? err.message : err);
    }

    // ── Channel 2: InforU SMS (10-min dedup) ──────────────────────────────────
    let smsFailed    = false;
    let smsAttempted = false;
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentSent = await prisma.messageLog.findFirst({
        where: {
          reservationId: reservation.id,
          messageType:   MessageType.CONFIRMATION_REQUEST,
          status:        MessageStatus.SENT,
          sentAt:        { gte: tenMinutesAgo },
        },
      });
      if (!recentSent) {
        smsAttempted = true;
        const message = buildConfirmationRequestSmsText(reservation, restaurantName, shortConfirmUrl);
        const result  = await sendSms({
          restaurantId:  req.auth.restaurantId,
          to:            reservation.guestPhone,
          message,
          type:          MessageType.CONFIRMATION_REQUEST,
          reservationId: reservation.id,
          guestId:       reservation.guestId ?? undefined,
        });
        if (!result.success) smsFailed = true;
      }
    } catch {
      smsAttempted = true;
      smsFailed    = true;
    }

    // ── Persist token; stamp sentAt only if at least one channel succeeded ────
    const anySent = !whatsappFailed || (smsAttempted && !smsFailed);
    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        confirmationToken: token,
        ...(anySent ? { confirmationSentAt: new Date() } : {}),
      },
    });

    res.json({
      ...updated,
      ...(whatsappFailed                  ? { whatsappFailed: true } : {}),
      ...(smsAttempted && smsFailed       ? { smsFailed: true }      : {}),
    });
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/mark-arrived — host marks guest as physically present, not yet seated
router.post('/:id/mark-arrived', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.markArrived(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/unmark-arrived — host undoes the arrival mark
router.post('/:id/unmark-arrived', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await service.unmarkArrived(req.auth.restaurantId, p(req, 'id'), actorName(req));
    res.json(r);
    notifyFloorUpdated(req.auth.restaurantId);
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
    notifyFloorUpdated(req.auth.restaurantId);
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
        const lang       = (r.guestLang === 'he' ? 'he' : 'en') as 'en' | 'he';
        const token      = crypto.randomUUID();
        const confirmUrl = `${config.frontendBaseUrl}/confirm?token=${token}${lang === 'he' ? '&lang=he' : ''}`;

        // Send first — only write token + sentAt together if send succeeds.
        await sendConfirmationSms(req.auth.restaurantId, r.guestPhone!, r.guestName, restaurantName, date, r.time, r.partySize, confirmUrl, lang);

        await prisma.reservation.update({
          where: { id: r.id },
          data:  { confirmationToken: token, confirmationSentAt: new Date() },
        });
        sent++;
      } catch (err) {
        console.error(`[bulk-confirm] Failed for reservation ${r.id}:`, err instanceof Error ? err.message : err);
        failed.push(r.id);
      }
    }

    res.json({ sent, failed, total: reservations.length });
    if (sent > 0) notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

// POST /reservations/:id/send-reminder — send a single reminder for one reservation
router.post('/:id/send-reminder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [reservation, restaurant] = await Promise.all([
      prisma.reservation.findUnique({ where: { id: p(req, 'id') } }),
      prisma.restaurant.findUnique({ where: { id: req.auth.restaurantId }, select: { name: true, settings: true } }),
    ]);
    if (!reservation || reservation.restaurantId !== req.auth.restaurantId) {
      throw new NotFoundError('Reservation', p(req, 'id'));
    }
    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status)) {
      throw new BusinessRuleError(`Cannot send reminder for a ${reservation.status} reservation`);
    }
    if (!reservation.guestPhone) {
      throw new BusinessRuleError('Reservation has no phone number for reminder');
    }
    if (reservation.isConfirmedByGuest) {
      throw new BusinessRuleError('Guest has already confirmed — no reminder needed');
    }
    if (reservation.reminderCount >= 2) {
      throw new BusinessRuleError('Maximum of 2 reminders already sent for this reservation');
    }

    const settings = (restaurant?.settings ?? {}) as Record<string, unknown>;
    if (settings.reminderEnabled === false) {
      throw new BusinessRuleError('Reminders are disabled for this restaurant');
    }
    const leadMinutes = typeof settings.reminderLeadMinutes === 'number' ? settings.reminderLeadMinutes : 60;

    // Dedup: block if a REMINDER was already SENT within the lead window
    const recentReminder = await prisma.messageLog.findFirst({
      where: {
        reservationId: reservation.id,
        messageType:   MessageType.REMINDER,
        status:        MessageStatus.SENT,
        sentAt:        { gte: new Date(Date.now() - leadMinutes * 60 * 1000) },
      },
    });
    if (recentReminder) {
      throw new BusinessRuleError('A reminder was already sent recently for this reservation');
    }

    const lang            = (reservation.guestLang === 'he' ? 'he' : 'en') as 'en' | 'he';
    const token           = reservation.confirmationToken ?? crypto.randomUUID();
    const shortConfirmUrl = `${config.frontendBaseUrl}/c/${token}`;
    const message         = buildReminderSmsText(reservation, restaurant?.name ?? 'the restaurant', shortConfirmUrl);

    const result = await sendSms({
      restaurantId:  req.auth.restaurantId,
      to:            reservation.guestPhone,
      message,
      type:          MessageType.REMINDER,
      reservationId: reservation.id,
      guestId:       reservation.guestId ?? undefined,
    });

    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        ...(result.success ? { remindedAt: new Date(), reminderCount: { increment: 1 } } : {}),
        ...(reservation.confirmationToken ? {} : { confirmationToken: token }),
      },
    });

    res.json(result.success ? updated : { ...updated, _smsFailed: true });
    notifyFloorUpdated(req.auth.restaurantId);
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
    if (result.sent > 0) notifyFloorUpdated(req.auth.restaurantId);
  } catch (err) { next(err); }
});

export default router;
