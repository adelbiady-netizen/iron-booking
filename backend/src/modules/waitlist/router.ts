import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import * as service from './service';
import { eventBus } from '../../lib/eventBus';

const router = Router();
router.use(authenticate);

// Express 5 types req.params values as string | string[]; route params from
// :param patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// Normalize a validated query string value to string
function q(req: Request, key: string): string {
  const v = req.query[key];
  if (Array.isArray(v)) return v[0] as string;
  return v as string;
}

// Host-chosen seating duration (minutes). Bounds mirror the reservation editor
// (30–480, step-free) — rejects zero/negative/absurd values.
const DurationField = z.number().int().min(30).max(480);

const AddSchema = z.object({
  guestName:       z.string().min(1),
  guestPhone:      z.string().optional(),
  partySize:       z.number().int().min(1),
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type:            z.enum(['LIVE', 'FUTURE']).optional(),
  source:          z.enum(['WALK_IN', 'HOST', 'PHONE', 'ONLINE']).optional(),
  notes:           z.string().optional(),
  preferredTime:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  requestedTime:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  section:         z.string().optional(),
  durationMinutes: DurationField.optional(),
});

const UpdateSchema = z.object({
  guestName:       z.string().min(1).optional(),
  guestPhone:      z.string().optional(),
  partySize:       z.number().int().min(1).optional(),
  notes:           z.string().nullable().optional(),
  durationMinutes: DurationField.nullable().optional(), // null = revert to restaurant default
});

const SeatSchema = z.object({
  tableId:           z.string().optional(),
  overrideConflicts: z.boolean().optional(),
  durationMinutes:   DurationField.optional(),
});

const DateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// GET /waitlist?date=YYYY-MM-DD&time=HH:MM
router.get('/', validate(DateQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const timeStr = typeof req.query.time === 'string' ? req.query.time : undefined;
    const entries = await service.listWaitlist(req.auth.restaurantId, q(req, 'date'), timeStr);
    res.json(entries);
  } catch (err) { next(err); }
});

// GET /waitlist/stats?date=YYYY-MM-DD
router.get('/stats', validate(DateQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await service.getWaitlistStats(req.auth.restaurantId, q(req, 'date'));
    res.json(stats);
  } catch (err) { next(err); }
});

// POST /waitlist
router.post('/', validate(AddSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await service.addToWaitlist(req.auth.restaurantId, req.body);
    res.status(201).json(entry);
    eventBus.emit('floor_updated', { restaurantId: req.auth.restaurantId });
  } catch (err) { next(err); }
});

// GET /waitlist/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await service.getWaitlistEntry(req.auth.restaurantId, p(req, 'id'));
    res.json(entry);
  } catch (err) { next(err); }
});

// PATCH /waitlist/:id
router.patch('/:id', validate(UpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await service.updateWaitlistEntry(req.auth.restaurantId, p(req, 'id'), req.body);
    res.json(entry);
    eventBus.emit('floor_updated', { restaurantId: req.auth.restaurantId });
  } catch (err) { next(err); }
});

// POST /waitlist/:id/notify — legacy verbal-notify stamp (kept for compatibility)
router.post('/:id/notify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await service.notifyGuest(req.auth.restaurantId, p(req, 'id'));
    res.json(entry);
    eventBus.emit('floor_updated', { restaurantId: req.auth.restaurantId });
  } catch (err) { next(err); }
});

// POST /waitlist/:id/table-ready — send the branded "your table is ready"
// message on the restaurant's messaging channel, with full MessageLog audit.
// Repeat sends require force=true (the 409 payload carries the previous send time).
// Never seats the guest.
router.post('/:id/table-ready', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hostName = typeof req.body?.hostName === 'string' && req.body.hostName.trim()
      ? req.body.hostName.trim().slice(0, 80)
      : `${req.auth.firstName ?? ''} ${req.auth.lastName ?? ''}`.trim() || 'Host';
    const result = await service.sendTableReadyMessage(
      req.auth.restaurantId,
      p(req, 'id'),
      hostName,
      req.body?.force === true,
    );
    res.json(result);
    eventBus.emit('floor_updated', { restaurantId: req.auth.restaurantId });
  } catch (err) { next(err); }
});

// POST /waitlist/:id/seat
router.post('/:id/seat', validate(SeatSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.seatWaitlistGuest(
      req.auth.restaurantId,
      p(req, 'id'),
      req.body.tableId,
      req.body.overrideConflicts === true,
      req.body.durationMinutes
    );
    res.json(result);
    eventBus.emit('floor_updated', { restaurantId: req.auth.restaurantId });
  } catch (err) { next(err); }
});

// POST /waitlist/:id/mark-offered — Phase 1: status change only, no SMS
router.post('/:id/mark-offered', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await service.markOffered(req.auth.restaurantId, p(req, 'id'));
    res.json(entry);
  } catch (err) { next(err); }
});

// POST /waitlist/:id/remove
router.post('/:id/remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reason = req.body.reason === 'LEFT' ? 'LEFT' : 'REMOVED';
    const entry = await service.removeFromWaitlist(req.auth.restaurantId, p(req, 'id'), reason);
    res.json(entry);
  } catch (err) { next(err); }
});

export default router;
