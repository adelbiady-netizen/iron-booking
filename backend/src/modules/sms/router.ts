import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../lib/errors';

// Restaurant-scoped SMS diagnostics. Any authenticated user sees ONLY their own
// restaurant's data — every query is keyed on req.auth.restaurantId, so there is
// no cross-tenant exposure and no SUPER_ADMIN requirement.

const router = Router();

// GET /api/sms/config — the caller's restaurant SMS configuration
router.get('/config', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const r = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { id: true, name: true, slug: true, settings: true },
    });
    if (!r) throw new NotFoundError('Restaurant', restaurantId);
    const s = (r.settings ?? {}) as Record<string, unknown>;
    res.json({
      restaurantId:    r.id,
      name:            r.name,
      slug:            r.slug,
      smsEnabled:      s.smsEnabled === true,
      smsProvider:     (s.smsProvider as string | undefined) ?? 'MOCK',
      smsSenderName:   (s.smsSenderName as string | undefined) ?? null,
      smsMonthlyQuota: (s.smsMonthlyQuota as number | undefined) ?? null,
    });
  } catch (err) { next(err); }
});

const LogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// GET /api/sms/logs?limit=20 — latest MessageLog rows for the caller's restaurant
router.get('/logs', authenticate, validate(LogsQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.auth.restaurantId;
    const limit = (req.query as { limit?: number }).limit ?? 20;
    const logs = await prisma.messageLog.findMany({
      where:   { restaurantId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select: {
        id: true, phone: true, messageType: true, provider: true, senderName: true,
        status: true, providerMessageId: true, errorMessage: true, costAgorot: true,
        reservationId: true, createdAt: true,
      },
    });
    res.json({ restaurantId, count: logs.length, logs });
  } catch (err) { next(err); }
});

export default router;
