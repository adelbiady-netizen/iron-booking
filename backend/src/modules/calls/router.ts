import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';

const router = Router();
router.use(authenticate);

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
          routingStatus: true, createdAt: true,
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

export default router;
