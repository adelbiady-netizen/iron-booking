import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { authenticate, type AuthPayload } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';
import { writeHostAudit } from '../../lib/hostAudit';
import { OPEN_STATUSES, countOpen } from './callbackState';
import {
  CALLBACK_SELECT,
  makePrismaCallbackStore,
  planComplete,
  planCancel,
  planClearAll,
  planUndo,
  type Effects,
} from './callbackOps';

const router = Router();
router.use(authenticate);

// Kept name for readability; single source of truth is callbackState.OPEN_STATUSES.
const OPEN_CALLBACK_STATUSES = OPEN_STATUSES;

function hostNameFrom(req: { auth: { firstName?: string; lastName?: string }; body?: unknown }): string {
  const body = (req.body ?? {}) as { hostName?: unknown };
  if (typeof body.hostName === 'string' && body.hostName.trim()) return body.hostName.trim().slice(0, 80);
  return `${req.auth.firstName ?? ''} ${req.auth.lastName ?? ''}`.trim() || 'Host';
}

function emitCallbackUpdated(restaurantId: string, callback: unknown): void {
  eventBus.emit('callback_updated', { restaurantId, callback });
}

// Apply the append-only audit rows an operation produced. Fire-and-forget, so it
// can never fail or delay the action the host just performed.
function applyAudits(auth: AuthPayload, effects: Effects): void {
  for (const a of effects.audits) writeHostAudit(auth, a.event, a.properties);
}

const NoteSchema = z.object({ note: z.string().max(300).nullable() });

const UndoSchema = z.object({
  operationId: z.string().optional(),
  completedAt: z.string(),
  items: z
    .array(z.object({
      id: z.string(),
      previousStatus: z.enum(['PENDING_CALLBACK', 'CALLBACK_IN_PROGRESS']),
    }))
    .max(500),
});

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
    // Server-authoritative unresolved count (D5): PENDING + IN_PROGRESS.
    // `active` is the full open set (not paginated), so its count is reliable —
    // clients use `count.total` for the floating-button badge rather than
    // deriving it from a partial/paginated call-history list.
    res.json({
      active: active.map((c, i) => ({ ...c, position: i + 1 })),
      recentClosed,
      count: countOpen(active),
    });
  } catch (err) { next(err); }
});

// POST /call-logs/callbacks/clear-all — mark every currently-unresolved callback
// (PENDING + IN_PROGRESS) as handled in ONE atomic, tenant-scoped operation.
//
// Atomicity + concurrency live in the store's `lockOpen` (SELECT … FOR UPDATE):
// a second Clear All running simultaneously waits, then sees zero open rows and
// is a safe no-op; callbacks created after the lock are never in the set. The
// response carries an `undo` token (affected IDs + previous states).
router.post('/callbacks/clear-all', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const hostName = hostNameFrom(req);

    const result = await prisma.$transaction((tx) =>
      planClearAll(makePrismaCallbackStore(tx), {
        restaurantId, hostName, operationId: randomUUID(), now: new Date(),
      }),
    );

    applyAudits(req.auth, result.effects);
    if (result.effects.emit) emitCallbackUpdated(restaurantId, null);
    res.json({ count: result.count, undo: result.undo });
  } catch (err) { next(err); }
});

// POST /call-logs/callbacks/undo — safely reverse a complete or clear-all.
//
// Per item, a compare-and-swap restores it ONLY IF it is still COMPLETED with the
// exact `callbackCompletedAt` token from the original op. Any item independently
// changed since (reopened, re-completed, cancelled) fails the swap and is returned
// in `conflicted` — never overwritten. The client payload is intent, not permission.
router.post('/callbacks/undo', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const parsed = UndoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid undo payload' } });
      return;
    }
    const { operationId, completedAt, items } = parsed.data;
    const token = new Date(completedAt);
    if (Number.isNaN(token.getTime())) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid completedAt token' } });
      return;
    }

    const result = await prisma.$transaction((tx) =>
      planUndo(makePrismaCallbackStore(tx), { restaurantId, operationId, token, items }),
    );

    applyAudits(req.auth, result.effects);
    if (result.effects.emit) emitCallbackUpdated(restaurantId, null);
    res.json({ restored: result.restored, conflicted: result.conflicted });
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

// POST /call-logs/:id/callback/complete — mark handled (D1). Server-authoritative:
// the client never removes the item optimistically; it refetches after this
// resolves. Returns an `undo` token so the action can be reversed from a toast.
router.post('/:id/callback/complete', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);
    const hostName = hostNameFrom(req);
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : undefined;

    const result = await planComplete(makePrismaCallbackStore(prisma), {
      restaurantId, id, hostName, note, operationId: randomUUID(), now: new Date(),
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } });
        return;
      }
      res.status(409).json({ error: { code: 'CALLBACK_NOT_OPEN', message: 'Callback is not open', details: { callback: result.row } } });
      return;
    }

    applyAudits(req.auth, result.effects);
    if (result.effects.emit) emitCallbackUpdated(restaurantId, result.row);
    res.json({ ...result.row, undo: result.undo });
  } catch (err) { next(err); }
});

// POST /call-logs/:id/callback/cancel — dismiss an invalid callback
router.post('/:id/callback/cancel', async (req, res, next) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const id = String(req.params.id);
    const hostName = hostNameFrom(req);
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : undefined;

    const result = await planCancel(makePrismaCallbackStore(prisma), {
      restaurantId, id, hostName, note, operationId: randomUUID(), now: new Date(),
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Callback not found' } });
        return;
      }
      res.status(409).json({ error: { code: 'CALLBACK_NOT_OPEN', message: 'Callback is not open', details: { callback: result.row } } });
      return;
    }

    applyAudits(req.auth, result.effects);
    if (result.effects.emit) emitCallbackUpdated(restaurantId, result.row);
    res.json(result.row);
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
