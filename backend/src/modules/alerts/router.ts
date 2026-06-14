import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { AlertType } from '@prisma/client';
import { z } from 'zod';

const router = Router({ mergeParams: true });
router.use(authenticate, requireRole('MANAGER'));

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

const CRITICAL_TYPES: AlertType[] = ['FEEDBACK_NEGATIVE', 'VIP_AT_RISK', 'HIGH_NOSHOW'];
const ATTENTION_TYPES: AlertType[] = ['RECOVERY_OPEN', 'SILENT_GUEST'];
const UPCOMING_TYPES: AlertType[] = ['BIRTHDAY_SOON', 'ANNIVERSARY_SOON'];

// GET /api/restaurants/:restaurantId/alerts/center
router.get('/center', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const now = new Date();

    const alerts = await prisma.guestAlert.findMany({
      where: {
        restaurantId,
        isDismissed: false,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      include: {
        guest: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            visitCount: true,
            vipScore: true,
            isVip: true,
          },
        },
      },
      orderBy: [
        { createdAt: 'desc' },
      ],
      take: 100,
    });

    // Sort: critical types first, then attention, then upcoming, then by createdAt desc
    const urgencyOrder = (type: AlertType): number => {
      if (CRITICAL_TYPES.includes(type)) return 0;
      if (ATTENTION_TYPES.includes(type)) return 1;
      if (UPCOMING_TYPES.includes(type)) return 2;
      return 3;
    };

    alerts.sort((a, b) => {
      const diff = urgencyOrder(a.type) - urgencyOrder(b.type);
      if (diff !== 0) return diff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Fetch open recovery case counts for guests present in the list
    const guestIds = [...new Set(alerts.map((a) => a.guestId))];
    const recoveryCounts = await prisma.recoveryCase.groupBy({
      by: ['guestId'],
      where: {
        restaurantId,
        guestId: { in: guestIds },
        status: 'OPEN',
      },
      _count: { id: true },
    });

    const recoveryCountMap: Record<string, number> = {};
    for (const row of recoveryCounts) {
      recoveryCountMap[row.guestId] = row._count.id;
    }

    const enriched = alerts.map((alert) => ({
      ...alert,
      openRecoveryCases: recoveryCountMap[alert.guestId] ?? 0,
    }));

    const critical = enriched.filter((a) => CRITICAL_TYPES.includes(a.type));
    const attention = enriched.filter((a) => ATTENTION_TYPES.includes(a.type));
    const upcoming = enriched.filter((a) => UPCOMING_TYPES.includes(a.type));
    const unreadCount = enriched.filter((a) => !a.isRead).length;

    res.json({
      critical,
      attention,
      upcoming,
      totalCount: enriched.length,
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/restaurants/:restaurantId/alerts/:alertId/read
router.patch('/:alertId/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const alertId = p(req, 'alertId');

    const alert = await prisma.guestAlert.updateMany({
      where: { id: alertId, restaurantId },
      data: { isRead: true },
    });

    if (alert.count === 0) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/restaurants/:restaurantId/alerts/:alertId/dismiss
router.patch('/:alertId/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const alertId = p(req, 'alertId');

    const alert = await prisma.guestAlert.updateMany({
      where: { id: alertId, restaurantId },
      data: { isDismissed: true },
    });

    if (alert.count === 0) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const dismissAllSchema = z.object({
  type: z.nativeEnum(AlertType).optional(),
});

// POST /api/restaurants/:restaurantId/alerts/dismiss-all
router.post('/dismiss-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const parsed = dismissAllSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      return;
    }

    const { type } = parsed.data;

    const result = await prisma.guestAlert.updateMany({
      where: {
        restaurantId,
        isDismissed: false,
        ...(type ? { type } : {}),
      },
      data: { isDismissed: true },
    });

    res.json({ success: true, dismissed: result.count });
  } catch (err) {
    next(err);
  }
});

export default router;
