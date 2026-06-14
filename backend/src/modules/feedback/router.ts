import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { NotFoundError, BusinessRuleError } from '../../lib/errors';
import { AlertType } from '@prisma/client';
import { z } from 'zod';
import { validate } from '../../middleware/validate';

const router = Router();

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// ── Public: get feedback form info ───────────────────────────────────────────

router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fb = await prisma.guestFeedback.findUnique({
      where: { token: p(req, 'token') },
      include: {
        restaurant: { select: { name: true, slug: true } },
        reservation: { select: { guestName: true, date: true, time: true } },
      },
    });
    if (!fb) throw new NotFoundError('Feedback', p(req, 'token'));
    res.json({
      restaurant: fb.restaurant,
      guestName: fb.reservation?.guestName ?? null,
      date: fb.reservation?.date ?? null,
      time: fb.reservation?.time ?? null,
      alreadySubmitted: fb.submittedAt !== null,
    });
  } catch (err) { next(err); }
});

// ── Public: submit feedback ───────────────────────────────────────────────────

const SubmitSchema = z.object({
  sentiment: z.enum(['EXCELLENT', 'GOOD', 'BAD']),
  freeText: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

router.post('/:token', validate(SubmitSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fb = await prisma.guestFeedback.findUnique({
      where: { token: p(req, 'token') },
      include: {
        guest: { select: { id: true, visitCount: true, vipScore: true, firstName: true, lastName: true } },
        reservation: { select: { guestName: true, date: true } },
      },
    });
    if (!fb) throw new NotFoundError('Feedback', p(req, 'token'));
    if (fb.submittedAt) throw new BusinessRuleError('Feedback already submitted');

    const { sentiment, freeText, tags } = req.body as z.infer<typeof SubmitSchema>;

    await prisma.guestFeedback.update({
      where: { id: fb.id },
      data: { sentiment, freeText, tags: tags ?? [], submittedAt: new Date() },
    });

    // Intelligence integration: negative feedback → alert + recovery case
    if (sentiment === 'BAD' && fb.guestId) {
      const guest = fb.guest!;
      const isLoyal = (guest.visitCount ?? 0) >= 6;
      const isVip = (guest.vipScore ?? 0) >= 70;
      const isHighPriority = isLoyal || isVip;

      const headline = isHighPriority
        ? `⚠️ Red Alert — משוב שלילי מאורח ${isVip ? 'VIP' : 'נאמן'}`
        : 'משוב שלילי התקבל';
      const tagList = (tags ?? []).join(', ');
      const context = [
        freeText || null,
        tagList ? `נושאים: ${tagList}` : null,
      ].filter(Boolean).join(' · ');

      await prisma.guestAlert.create({
        data: {
          restaurantId: fb.restaurantId,
          guestId: fb.guestId,
          type: AlertType.FEEDBACK_NEGATIVE,
          headline,
          context: context || null,
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });

      const guestName = guest.firstName
        ? `${guest.firstName} ${guest.lastName ?? ''}`.trim()
        : fb.reservation?.guestName ?? 'אורח';
      const description = [
        `${guestName} השאיר/ה משוב שלילי לאחר הביקור.`,
        tagList ? `נושאים שצוינו: ${tagList}.` : null,
        freeText ? `הערה: "${freeText}"` : null,
      ].filter(Boolean).join(' ');

      await prisma.recoveryCase.create({
        data: {
          restaurantId: fb.restaurantId,
          guestId: fb.guestId,
          reservationId: fb.reservationId ?? undefined,
          description,
          status: 'OPEN',
        },
      });

      // Memory record — negative experience
      await prisma.guestMemory.create({
        data: {
          restaurantId: fb.restaurantId,
          guestId: fb.guestId,
          reservationId: fb.reservationId ?? undefined,
          category: 'RECOVERY',
          source: 'AUTO_DETECTED',
          headline: `משוב שלילי — ${tagList || 'חוויה לא טובה'}`,
          context: freeText ?? null,
          emotionalWeight: isHighPriority ? 9 : 7,
          occurredAt: new Date(),
          addedBy: 'FEEDBACK',
        },
      });
    } else if (sentiment === 'EXCELLENT' && fb.guestId) {
      // Positive memory — lightweight, low weight
      await prisma.guestMemory.create({
        data: {
          restaurantId: fb.restaurantId,
          guestId: fb.guestId,
          reservationId: fb.reservationId ?? undefined,
          category: 'EMOTIONAL_MOMENT',
          source: 'AUTO_DETECTED',
          headline: 'משוב מצוין — האורח היה מרוצה מאוד',
          context: freeText ?? null,
          emotionalWeight: 6,
          occurredAt: new Date(),
          addedBy: 'FEEDBACK',
        },
      });
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Protected: list feedback for a restaurant ─────────────────────────────────

router.get('/restaurants/:restaurantId/list', authenticate, requireRole('MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId') || req.auth.restaurantId;
    const list = await prisma.guestFeedback.findMany({
      where: { restaurantId, submittedAt: { not: null } },
      orderBy: { submittedAt: 'desc' },
      take: 100,
      include: {
        guest: { select: { id: true, firstName: true, lastName: true, phone: true } },
        reservation: { select: { guestName: true, date: true, time: true } },
      },
    });
    res.json(list);
  } catch (err) { next(err); }
});

export default router;
