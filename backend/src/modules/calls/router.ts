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

    const [data, total] = await Promise.all([
      prisma.callLog.findMany({
        where:   { restaurantId },
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip:    offset,
        select: {
          id: true, phone: true, status: true, duration: true,
          recordUrl: true, group: true, restaurantName: true,
          routingStatus: true, createdAt: true,
        },
      }),
      prisma.callLog.count({ where: { restaurantId } }),
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
