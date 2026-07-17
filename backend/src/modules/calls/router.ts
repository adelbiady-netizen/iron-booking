import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';

const router = Router();
router.use(authenticate);

const OPEN_CALLBACK_STATUSES = ['PENDING_CALLBACK', 'CALLBACK_IN_PROGRESS'] as const;

const CALLBACK_SELECT = {
  id: true, phone: true, status: true, createdAt: true, guestName: true,
  restaurantName: true, queueStatus: true, callbackNote: true,
  handledBy: true, claimedAt: true, callbackCompletedAt: true,
} as const;

function hostNameFrom(req: { auth: { firstName?: string; lastName?: string }; body?: unknown }): string {
  const body = (req.body ?? {}) as { hostName?: unknown };
  if (typeof body.hostName === 'string' && body.hostName.trim()) return body.hostName.trim().slice(0, 80);
  return `${req.auth.firstName ?? ''} ${req.auth.lastName ?? ''}`.trim() || 'Host';
}

function emitCallbackUpdated(restaurantId: string, callback: unknown): void {
  eventBus.emit('callback_updated', { restaurantId, callback });
}

const NoteSchema = z.object({ note: z.string().max(300).nullable() });

router.get('/', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const limit  = Math.min(Number(req.query.limit  ?? 25), 100);
    const offset = Number(req.query.offset ?? 0);

    // Optional date filter: ?date=YYYY-MM-DD
    // Filters by UTC day. Non-breaking — omitting date returns all calls (existing behaviour).
    const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
    const dateFilter = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? { gte: new Date(`${dateParam}T00:00:00.000Z`), lte: new Date(`${dateParam}T23:59:59.999Z`) }
      : undefined;

    const where = { restaurantId, ...(dateFilter ? { createdAt: dateFilter } : {}) };

    const [data, total] = await Promise.all([
      prisma.callLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip:    offset,
        select: {
          id: true, phone: true, status: true, duration: true,
          recordUrl: true, group: true, restaurantName: true,
          routingStatus: true, createdAt: true, guestName: true,
        },
      }),
      prisma.callLog.count({ where }),
    ]);

    res.json({
      data: data.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
      meta: { total, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Callback queue ──────────────────────────────────────────────────────────
// FIFO over missed calls: order = createdAt asc (server timestamp), so every
// device sees the same queue regardless of refresh / reconnect.

// GET /call-logs/callbacks — active queue (FIFO) + recently closed
router.get('/callbacks', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const [active, recentClosed] = await Promise.all([
      prisma.callLog.findMany({
        where: { restaurantId, queueStatus: { in: [...OPEN_CALLBACK_STATUSES] } },
        orderBy: { createdAt: 'asc' },
        select: CALLBACK_SELECT,
      }),
      prisma.callLog.findMany({
        where: { restaurantId, queueStatus: { in: ['CALLBACK_COMPLETED', 'CALLBACK_CANCELLED'] } },
        orderBy: { callbackCompletedAt: 'desc' },
        take: 20,
        select: CALLBACK_SELECT,
      }),
    ]);
    res.json({
      active: active.map((c, i) => ({ ...c, position: i + 1 })),
      recentClosed,
    });
  } catch (err) { next(err); }
});

// POST /call-logs/:id/callback/start — claim atomically; 409 if someone else holds it
router.post('/:id/callback/start', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);
    const hostName = hostNameFrom(req);

    const claimed = await prisma.callLog.updateMany({
      where: { id, restaurantId, queueStatus: 'PENDING_CALLBACK' },
      data: { queueStatus: 'CALLBACK_IN_PROGRESS', handledBy: hostName, claimedAt: new Date() },
    });

    const row = await prisma.callLog.findFirst({ where: { id, restaurantId }, select: CALLBACK_SELECT });
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } }); return; }

    if (claimed.count === 0) {
      // Not claimable — either another host already started it, or it's closed.
      res.status(409).json({
        error: { code: 'CALLBACK_ALREADY_HANDLED', message: 'Callback is not pending', details: { callback: row } },
      });
      return;
    }

    emitCallbackUpdated(restaurantId, row);
    res.json(row);
  } catch (err) { next(err); }
});

// POST /call-logs/:id/callback/complete — allowed from PENDING or IN_PROGRESS
router.post('/:id/callback/complete', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);
    const hostName = hostNameFrom(req);
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : undefined;

    const done = await prisma.callLog.updateMany({
      where: { id, restaurantId, queueStatus: { in: [...OPEN_CALLBACK_STATUSES] } },
      data: {
        queueStatus: 'CALLBACK_COMPLETED',
        handledBy: hostName,
        callbackCompletedAt: new Date(),
        ...(note !== undefined ? { callbackNote: note } : {}),
      },
    });

    const row = await prisma.callLog.findFirst({ where: { id, restaurantId }, select: CALLBACK_SELECT });
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } }); return; }
    if (done.count === 0) {
      res.status(409).json({ error: { code: 'CALLBACK_NOT_OPEN', message: 'Callback is not open', details: { callback: row } } });
      return;
    }

    emitCallbackUpdated(restaurantId, row);
    res.json(row);
  } catch (err) { next(err); }
});

// POST /call-logs/:id/callback/cancel — dismiss an invalid callback
router.post('/:id/callback/cancel', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);
    const hostName = hostNameFrom(req);
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : undefined;

    const cancelled = await prisma.callLog.updateMany({
      where: { id, restaurantId, queueStatus: { in: [...OPEN_CALLBACK_STATUSES] } },
      data: {
        queueStatus: 'CALLBACK_CANCELLED',
        handledBy: hostName,
        callbackCompletedAt: new Date(),
        ...(note !== undefined ? { callbackNote: note } : {}),
      },
    });

    const row = await prisma.callLog.findFirst({ where: { id, restaurantId }, select: CALLBACK_SELECT });
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } }); return; }
    if (cancelled.count === 0) {
      res.status(409).json({ error: { code: 'CALLBACK_NOT_OPEN', message: 'Callback is not open', details: { callback: row } } });
      return;
    }

    emitCallbackUpdated(restaurantId, row);
    res.json(row);
  } catch (err) { next(err); }
});

// POST /call-logs/:id/callback/release — un-claim (IN_PROGRESS → PENDING), keeps FIFO position
router.post('/:id/callback/release', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);

    const released = await prisma.callLog.updateMany({
      where: { id, restaurantId, queueStatus: 'CALLBACK_IN_PROGRESS' },
      data: { queueStatus: 'PENDING_CALLBACK', handledBy: null, claimedAt: null },
    });

    const row = await prisma.callLog.findFirst({ where: { id, restaurantId }, select: CALLBACK_SELECT });
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } }); return; }
    if (released.count === 0) {
      res.status(409).json({ error: { code: 'CALLBACK_NOT_IN_PROGRESS', message: 'Callback is not in progress', details: { callback: row } } });
      return;
    }

    emitCallbackUpdated(restaurantId, row);
    res.json(row);
  } catch (err) { next(err); }
});

// PATCH /call-logs/:id/callback/note — add/edit the short host note
router.patch('/:id/callback/note', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);
    const parsed = NoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'note must be a string (max 300) or null' } });
      return;
    }

    const existing = await prisma.callLog.findFirst({ where: { id, restaurantId }, select: { queueStatus: true } });
    if (!existing || existing.queueStatus === null) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } });
      return;
    }

    const row = await prisma.callLog.update({
      where: { id },
      data: { callbackNote: parsed.data.note },
      select: CALLBACK_SELECT,
    });

    emitCallbackUpdated(restaurantId, row);
    res.json(row);
  } catch (err) { next(err); }
});

export default router;
