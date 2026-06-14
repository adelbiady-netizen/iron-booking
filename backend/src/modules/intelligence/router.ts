import { Router, Request } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import * as svc from './service';
import { seedIntelligenceDemo, clearIntelligenceDemo } from './seeder';
import { computeLoyaltyScore } from './engine';
import { prisma } from '../../lib/prisma';

const router = Router({ mergeParams: true });

router.use(authenticate);

// mergeParams injects restaurantId from the parent route — cast to access it
function rid(req: Request): string {
  return (req.params as Record<string, string>)['restaurantId'] ?? '';
}

// GET /restaurants/:restaurantId/intelligence/guests/:guestId
router.get('/guests/:guestId', async (req, res) => {
  try {
    const data = await svc.getGuestIntelligence(rid(req), req.params.guestId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/guests/:guestId/refresh
router.post('/guests/:guestId/refresh', async (req, res) => {
  try {
    const data = await svc.refreshGuestIntelligence(rid(req), req.params.guestId);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/guests/:guestId/memories
router.post('/guests/:guestId/memories', async (req, res) => {
  try {
    const memory = await svc.addMemory(rid(req), req.params.guestId, req.body as Parameters<typeof svc.addMemory>[2]);
    res.status(201).json(memory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /restaurants/:restaurantId/intelligence/alerts/:alertId
router.delete('/alerts/:alertId', async (req, res) => {
  try {
    await svc.dismissAlert(rid(req), req.params.alertId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/guests/:guestId/recovery
router.post('/guests/:guestId/recovery', async (req, res) => {
  try {
    const recoveryCase = await svc.createRecoveryCase(rid(req), req.params.guestId, req.body as Parameters<typeof svc.createRecoveryCase>[2]);
    res.status(201).json(recoveryCase);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/recovery/:caseId/actions
router.post('/recovery/:caseId/actions', async (req, res) => {
  try {
    const action = await svc.addRecoveryAction(rid(req), req.params.caseId, req.body as Parameters<typeof svc.addRecoveryAction>[2]);
    res.status(201).json(action);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/recovery/:caseId/resolve
router.post('/recovery/:caseId/resolve', async (req, res) => {
  try {
    const updated = await svc.resolveRecoveryCase(rid(req), req.params.caseId);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /restaurants/:restaurantId/intelligence/moments?status=PENDING|APPROVED|SENT
router.get('/moments', async (req, res) => {
  try {
    const status = req.query['status'] as string | undefined;
    const moments = await svc.getMoments(rid(req), status);
    res.json(moments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/moments/:momentId/review
router.post('/moments/:momentId/review', async (req, res) => {
  try {
    const updated = await svc.reviewMoment(rid(req), req.params.momentId, req.body as Parameters<typeof svc.reviewMoment>[2]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /restaurants/:restaurantId/intelligence/morning-brief
router.get('/morning-brief', async (req, res) => {
  try {
    const brief = await svc.getMorningBrief(rid(req), req.query['date'] as string | undefined);
    if (!brief) return res.status(404).json({ error: 'No brief yet' });
    res.json(brief);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /restaurants/:restaurantId/intelligence/backfill-v2
// ADMIN/SUPER_ADMIN only. Recomputes loyaltyScore, engagementScore, gicLabel for all guests.
// Does NOT send SMS. Does NOT create alerts. Does NOT touch V1 scores.
// Processes in batches of 50. Returns count + label distribution.
router.post('/backfill-v2', requireRole('RESTAURANT_ADMIN', 'ADMIN', 'OWNER', 'SUPER_ADMIN'), async (req, res) => {
  const restaurantId = rid(req);
  const BATCH = 50;

  // Verify caller has access to this restaurant
  if (req.auth.role !== 'SUPER_ADMIN' && req.auth.restaurantId !== restaurantId) {
    res.status(403).json({ error: 'Access denied: restaurant is not yours' });
    return;
  }

  try {
    // Fetch all guest IDs for this restaurant (no reservation filter — include CRM-only guests)
    const allGuests = await prisma.guest.findMany({
      where: { restaurantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const total = allGuests.length;
    let processed = 0;
    const errors: Array<{ guestId: string; error: string }> = [];

    for (let i = 0; i < allGuests.length; i += BATCH) {
      const batch = allGuests.slice(i, i + BATCH);
      await Promise.all(batch.map(async ({ id: guestId }) => {
        try {
          await computeLoyaltyScore(restaurantId, guestId);
          processed++;
        } catch (err) {
          errors.push({ guestId, error: err instanceof Error ? err.message : String(err) });
        }
      }));
    }

    // Label distribution after backfill
    const distribution = await prisma.guest.groupBy({
      by: ['gicLabel'],
      where: { restaurantId },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const labelDist: Record<string, number> = {};
    for (const row of distribution) {
      labelDist[row.gicLabel ?? 'null'] = row._count.id;
    }

    // Score ranges for a quick sanity check
    const scoreStats = await prisma.guest.aggregate({
      where: { restaurantId, loyaltyScore: { not: null } },
      _avg: { loyaltyScore: true, engagementScore: true },
      _max: { loyaltyScore: true },
      _min: { loyaltyScore: true },
      _count: { loyaltyScore: true },
    });

    res.json({
      total,
      processed,
      errors: errors.length,
      errorDetails: errors.slice(0, 10), // cap to first 10
      labelDistribution: labelDist,
      scoreStats: {
        scored: scoreStats._count.loyaltyScore,
        avgLoyalty: Math.round((scoreStats._avg.loyaltyScore ?? 0) * 10) / 10,
        avgEngagement: Math.round((scoreStats._avg.engagementScore ?? 0) * 10) / 10,
        maxLoyalty: scoreStats._max.loyaltyScore,
        minLoyalty: scoreStats._min.loyaltyScore,
      },
    });
  } catch (err) {
    console.error('[backfill-v2]', err);
    res.status(500).json({ error: 'Backfill failed', detail: String(err) });
  }
});

// POST /restaurants/:restaurantId/intelligence/seed-demo
// Temporary: seeds realistic GIC test data for UI evaluation. Idempotent — clears prior seed first.
router.post('/seed-demo', async (req, res) => {
  try {
    const result = await seedIntelligenceDemo(rid(req));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Seed failed', detail: String(err) });
  }
});

// DELETE /restaurants/:restaurantId/intelligence/seed-demo
router.delete('/seed-demo', async (req, res) => {
  try {
    const result = await clearIntelligenceDemo(rid(req));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Clear failed', detail: String(err) });
  }
});

export default router;
