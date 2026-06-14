import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { RecoveryStatus, RecoveryPriority } from '@prisma/client';
import { z } from 'zod';
import { validate } from '../../middleware/validate';

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

const router = Router({ mergeParams: true });

router.use(authenticate, requireRole('MANAGER'));

// ─── Schemas ────────────────────────────────────────────────────────────────

const createCaseSchema = z.object({
  guestId: z.string(),
  description: z.string().min(1),
  priority: z.nativeEnum(RecoveryPriority).optional(),
  assignedTo: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  reservationId: z.string().optional(),
});

const updateCaseSchema = z.object({
  status: z.nativeEnum(RecoveryStatus).optional(),
  priority: z.nativeEnum(RecoveryPriority).optional(),
  assignedTo: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  description: z.string().min(1).optional(),
});

const createActionSchema = z.object({
  actorName: z.string().min(1),
  note: z.string().min(1),
});

// ─── Priority sort order ─────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<RecoveryPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

// ─── GET /cases ──────────────────────────────────────────────────────────────

router.get('/cases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) ?? '30', 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      restaurantId,
      ...(req.query.status ? { status: req.query.status as RecoveryStatus } : {}),
      ...(req.query.priority ? { priority: req.query.priority as RecoveryPriority } : {}),
      ...(req.query.assignedTo ? { assignedTo: req.query.assignedTo as string } : {}),
    };

    const [cases, total, openCount, contactedCount] = await Promise.all([
      prisma.recoveryCase.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          guest: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              visitCount: true,
              vipScore: true,
              isVip: true,
            },
          },
          reservation: {
            select: {
              date: true,
              time: true,
              guestName: true,
            },
          },
          actions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.recoveryCase.count({ where }),
      prisma.recoveryCase.count({ where: { restaurantId, status: 'OPEN' } }),
      prisma.recoveryCase.count({ where: { restaurantId, status: 'CONTACTED' } }),
    ]);

    // Sort by priority desc then createdAt desc (CRITICAL/HIGH first)
    const sorted = [...cases].sort((a, b) => {
      const pDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (pDiff !== 0) return pDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const data = sorted.map((c) => ({
      ...c,
      lastAction: c.actions[0] ?? null,
      actions: undefined,
    }));

    res.json({
      data,
      meta: { total, page, limit, openCount, contactedCount },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /cases ─────────────────────────────────────────────────────────────

router.post(
  '/cases',
  validate(createCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurantId = p(req, 'restaurantId');
      const body = req.body as z.infer<typeof createCaseSchema>;

      const recoveryCase = await prisma.$transaction(async (tx) => {
        const created = await tx.recoveryCase.create({
          data: {
            restaurantId,
            guestId: body.guestId,
            description: body.description,
            priority: body.priority ?? 'NORMAL',
            assignedTo: body.assignedTo,
            dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
            reservationId: body.reservationId,
            status: 'OPEN',
          },
          include: {
            guest: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
                visitCount: true,
                vipScore: true,
                isVip: true,
              },
            },
            reservation: {
              select: {
                date: true,
                time: true,
                guestName: true,
              },
            },
            actions: true,
          },
        });

        await tx.guestAlert.create({
          data: {
            restaurantId,
            guestId: body.guestId,
            type: 'RECOVERY_OPEN',
            headline: body.description.slice(0, 200),
            context: body.description.length > 200 ? body.description : null,
          },
        });

        await tx.guestMemory.create({
          data: {
            restaurantId,
            guestId: body.guestId,
            category: 'RECOVERY',
            source: 'AUTO_DETECTED',
            headline: body.description.slice(0, 200),
            emotionalWeight: body.priority === 'CRITICAL' ? 9 : body.priority === 'HIGH' ? 7 : 5,
            occurredAt: new Date(),
            addedBy: 'RECOVERY',
          },
        });

        return created;
      });

      res.status(201).json(recoveryCase);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /cases/:caseId ──────────────────────────────────────────────────────

router.get('/cases/:caseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const caseId = p(req, 'caseId');

    const recoveryCase = await prisma.recoveryCase.findFirst({
      where: { id: caseId, restaurantId },
      include: {
        guest: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            visitCount: true,
            vipScore: true,
            isVip: true,
          },
        },
        reservation: {
          select: {
            date: true,
            time: true,
            guestName: true,
          },
        },
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!recoveryCase) throw new NotFoundError('Recovery case not found');

    const openCasesCount = await prisma.recoveryCase.count({
      where: {
        restaurantId,
        guestId: recoveryCase.guestId,
        status: { in: ['OPEN', 'CONTACTED'] },
        id: { not: caseId },
      },
    });

    res.json({ ...recoveryCase, openCasesCount });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /cases/:caseId ────────────────────────────────────────────────────

router.patch(
  '/cases/:caseId',
  validate(updateCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurantId = p(req, 'restaurantId');
      const caseId = p(req, 'caseId');
      const body = req.body as z.infer<typeof updateCaseSchema>;

      const existing = await prisma.recoveryCase.findFirst({
        where: { id: caseId, restaurantId },
      });
      if (!existing) throw new NotFoundError('Recovery case not found');

      let resolvedAt: Date | null | undefined = undefined;
      if (body.status === 'RESOLVED' && existing.status !== 'RESOLVED') {
        resolvedAt = new Date();
      } else if (body.status !== undefined && body.status !== 'RESOLVED' && existing.status === 'RESOLVED') {
        resolvedAt = null;
      }

      const updated = await prisma.recoveryCase.update({
        where: { id: caseId },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.assignedTo !== undefined ? { assignedTo: body.assignedTo } : {}),
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
            : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(resolvedAt !== undefined ? { resolvedAt } : {}),
        },
        include: {
          guest: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
              visitCount: true,
              vipScore: true,
              isVip: true,
            },
          },
          reservation: {
            select: {
              date: true,
              time: true,
              guestName: true,
            },
          },
          actions: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /cases/:caseId/actions ─────────────────────────────────────────────

router.post(
  '/cases/:caseId/actions',
  validate(createActionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurantId = p(req, 'restaurantId');
      const caseId = p(req, 'caseId');
      const body = req.body as z.infer<typeof createActionSchema>;

      const existing = await prisma.recoveryCase.findFirst({
        where: { id: caseId, restaurantId },
        include: { actions: { take: 1 } },
      });
      if (!existing) throw new NotFoundError('Recovery case not found');

      const isFirstAction = existing.actions.length === 0;
      const shouldAdvance = isFirstAction && existing.status === 'OPEN';

      const [action, updatedCase] = await prisma.$transaction([
        prisma.recoveryAction.create({
          data: {
            recoveryCaseId: caseId,
            actorName: body.actorName,
            note: body.note,
          },
        }),
        prisma.recoveryCase.update({
          where: { id: caseId },
          data: shouldAdvance ? { status: 'CONTACTED' } : {},
          include: {
            guest: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
                visitCount: true,
                vipScore: true,
                isVip: true,
              },
            },
            reservation: {
              select: {
                date: true,
                time: true,
                guestName: true,
              },
            },
            actions: {
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
      ]);

      res.status(201).json({ action, case: updatedCase });
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /cases/:caseId (soft-close) ──────────────────────────────────────

router.delete('/cases/:caseId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const caseId = p(req, 'caseId');

    const existing = await prisma.recoveryCase.findFirst({
      where: { id: caseId, restaurantId },
    });
    if (!existing) throw new NotFoundError('Recovery case not found');

    const updated = await prisma.recoveryCase.update({
      where: { id: caseId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
      include: {
        guest: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            visitCount: true,
            vipScore: true,
            isVip: true,
          },
        },
        reservation: {
          select: {
            date: true,
            time: true,
            guestName: true,
          },
        },
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');

    const [open, contacted, resolved, criticalOpen, assigneeRows] = await Promise.all([
      prisma.recoveryCase.count({ where: { restaurantId, status: 'OPEN' } }),
      prisma.recoveryCase.count({ where: { restaurantId, status: 'CONTACTED' } }),
      prisma.recoveryCase.count({ where: { restaurantId, status: 'RESOLVED' } }),
      prisma.recoveryCase.count({
        where: { restaurantId, status: 'OPEN', priority: 'CRITICAL' },
      }),
      prisma.recoveryCase.groupBy({
        by: ['assignedTo'],
        where: {
          restaurantId,
          status: { in: ['OPEN', 'CONTACTED'] },
          assignedTo: { not: null },
        },
        _count: { id: true },
      }),
    ]);

    const assignees = assigneeRows
      .filter((r): r is typeof r & { assignedTo: string } => r.assignedTo !== null)
      .map((r) => ({ name: r.assignedTo, openCount: r._count.id }))
      .sort((a, b) => b.openCount - a.openCount);

    res.json({ open, contacted, resolved, criticalOpen, assignees });
  } catch (err) {
    next(err);
  }
});

export default router;
