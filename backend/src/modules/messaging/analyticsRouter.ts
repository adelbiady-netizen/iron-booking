import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { MessageChannel, MessageStatus, MessageType } from '@prisma/client';

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

const SUPER_ROLES = ['SUPER_ADMIN', 'HQ_ADMIN'];

const router = Router({ mergeParams: true });

router.use(authenticate);
router.use((req: Request, _res: Response, next: NextFunction) => {
  const role = req.auth.role;
  if (
    !['SUPER_ADMIN', 'HQ_ADMIN', 'GROUP_MANAGER', 'RESTAURANT_ADMIN', 'OWNER', 'ADMIN', 'MANAGER'].includes(role)
  ) {
    return next(new Error('Forbidden'));
  }
  next();
});

function resolveRestaurantId(req: Request): string | undefined {
  const role = req.auth.role;
  if (SUPER_ROLES.includes(role)) {
    // Super admins may optionally scope by restaurantId query param
    const qParam = req.query.restaurantId;
    if (typeof qParam === 'string' && qParam.length > 0) return qParam;
    return undefined; // all restaurants
  }
  return req.auth.restaurantId;
}

function parseMonth(month?: string): { gte: Date; lt: Date } {
  const ref = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const gte = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const lt = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  return { gte, lt };
}

// GET /api/messaging/analytics/summary
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = resolveRestaurantId(req);
    const monthParam = typeof req.query.month === 'string' ? req.query.month : undefined;
    const { gte, lt } = parseMonth(monthParam);

    const baseWhere = {
      createdAt: { gte, lt },
      ...(restaurantId ? { restaurantId } : {}),
    };

    const sentStatuses: MessageStatus[] = ['SENT', 'DELIVERED'];

    const [totalSent, totalDelivered, totalFailed, costResult, byCategory, byChannel] = await Promise.all([
      prisma.messageLog.count({
        where: { ...baseWhere, status: { in: sentStatuses } },
      }),
      prisma.messageLog.count({
        where: { ...baseWhere, status: 'DELIVERED' },
      }),
      prisma.messageLog.count({
        where: { ...baseWhere, status: 'FAILED' },
      }),
      prisma.messageLog.aggregate({
        where: { ...baseWhere, status: { in: sentStatuses } },
        _sum: { costAgorot: true },
      }),
      prisma.messageLog.groupBy({
        by: ['messageType'],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.messageLog.groupBy({
        by: ['channel'],
        where: baseWhere,
        _count: { id: true },
      }),
    ]);

    // Build byCategory with sent/delivered/failed per messageType
    const allMessageTypes = Object.values(MessageType);
    const byCategoryResult: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const type of allMessageTypes) {
      byCategoryResult[type] = { sent: 0, delivered: 0, failed: 0 };
    }

    // We need per-type breakdown by status — do it with a second groupBy
    const byCategoryDetail = await prisma.messageLog.groupBy({
      by: ['messageType', 'status'],
      where: baseWhere,
      _count: { id: true },
    });

    for (const row of byCategoryDetail) {
      const cat = byCategoryResult[row.messageType] ?? { sent: 0, delivered: 0, failed: 0 };
      if ((sentStatuses as MessageStatus[]).includes(row.status)) {
        cat.sent += row._count.id;
      }
      if (row.status === 'DELIVERED') {
        cat.delivered += row._count.id;
      }
      if (row.status === 'FAILED') {
        cat.failed += row._count.id;
      }
      byCategoryResult[row.messageType] = cat;
    }

    const allChannels = Object.values(MessageChannel);
    const byChannelResult: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const ch of allChannels) {
      byChannelResult[ch] = { sent: 0, delivered: 0, failed: 0 };
    }

    const byChannelDetail = await prisma.messageLog.groupBy({
      by: ['channel', 'status'],
      where: baseWhere,
      _count: { id: true },
    });

    for (const row of byChannelDetail) {
      const ch = byChannelResult[row.channel] ?? { sent: 0, delivered: 0, failed: 0 };
      if ((sentStatuses as MessageStatus[]).includes(row.status)) {
        ch.sent += row._count.id;
      }
      if (row.status === 'DELIVERED') {
        ch.delivered += row._count.id;
      }
      if (row.status === 'FAILED') {
        ch.failed += row._count.id;
      }
      byChannelResult[row.channel] = ch;
    }

    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 10000) / 100 : 0;

    res.json({
      totalSent,
      totalDelivered,
      totalFailed,
      deliveryRate,
      byCategory: byCategoryResult,
      byChannel: byChannelResult,
      estimatedCost: costResult._sum.costAgorot ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/messaging/analytics/by-restaurant
router.get('/by-restaurant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.auth.role;
    if (!SUPER_ROLES.includes(role)) {
      return next(new Error('Forbidden'));
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await prisma.messageLog.groupBy({
      by: ['restaurantId'],
      where: { createdAt: { gte: since } },
      _count: { id: true },
    });

    const restaurantIds = rows.map((r) => r.restaurantId);
    const restaurants = await prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: { id: true, name: true },
    });
    const nameMap: Record<string, string> = {};
    for (const r of restaurants) {
      nameMap[r.id] = r.name;
    }

    // Get per-restaurant status breakdown
    const detail = await prisma.messageLog.groupBy({
      by: ['restaurantId', 'status'],
      where: { createdAt: { gte: since } },
      _count: { id: true },
    });

    const aggMap: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const row of detail) {
      const entry = aggMap[row.restaurantId] ?? { sent: 0, delivered: 0, failed: 0 };
      if (['SENT', 'DELIVERED'].includes(row.status)) {
        entry.sent += row._count.id;
      }
      if (row.status === 'DELIVERED') {
        entry.delivered += row._count.id;
      }
      if (row.status === 'FAILED') {
        entry.failed += row._count.id;
      }
      aggMap[row.restaurantId] = entry;
    }

    const result = Object.entries(aggMap).map(([restaurantId, counts]) => ({
      restaurantId,
      restaurantName: nameMap[restaurantId] ?? restaurantId,
      sent: counts.sent,
      delivered: counts.delivered,
      failed: counts.failed,
      deliveryRate: counts.sent > 0 ? Math.round((counts.delivered / counts.sent) * 10000) / 100 : 0,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/messaging/analytics/daily
router.get('/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = resolveRestaurantId(req);

    const daysParam = parseInt(req.query.days as string) || 30;
    const days = Math.min(daysParam, 90);

    if (!restaurantId) {
      const rows = await prisma.$queryRaw<
        Array<{ date: string; sent: bigint; delivered: bigint; failed: bigint }>
      >`
        SELECT
          DATE("createdAt") AS date,
          COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED')) AS sent,
          COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
          COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
        FROM "MessageLog"
        WHERE "createdAt" >= NOW() - make_interval(days => ${days})
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `;

      return res.json(
        rows.map((r) => ({
          date: r.date,
          sent: Number(r.sent),
          delivered: Number(r.delivered),
          failed: Number(r.failed),
        }))
      );
    }

    const rows = await prisma.$queryRaw<
      Array<{ date: string; sent: bigint; delivered: bigint; failed: bigint }>
    >`
      SELECT
        DATE("createdAt") AS date,
        COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED')) AS sent,
        COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
        COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
      FROM "MessageLog"
      WHERE "restaurantId" = ${restaurantId}
        AND "createdAt" >= NOW() - make_interval(days => ${days})
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    res.json(
      rows.map((r) => ({
        date: r.date,
        sent: Number(r.sent),
        delivered: Number(r.delivered),
        failed: Number(r.failed),
      }))
    );
  } catch (err) {
    next(err);
  }
});

export default router;
