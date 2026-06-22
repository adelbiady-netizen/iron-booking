import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { NotFoundError, BusinessRuleError } from '../../lib/errors';
import { ClubJoinSource } from '@prisma/client';
import { writeConsentAudit, ConsentType, ConsentAction, ConsentSource } from '../../lib/consentAudit';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { config } from '../../config';
import crypto from 'crypto';

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const JoinSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  phone: z.string().optional(),
  birthday: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  anniversary: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  smsConsent: z.boolean().default(false),
  marketingConsent: z.boolean().default(false),
});

const CreateInviteSchema = z.object({
  guestId: z.string().optional(),
  guestName: z.string().optional(),
  guestPhone: z.string().optional(),
  reservationId: z.string().optional(),
  expiresInDays: z.number().min(1).max(90).default(30),
});

// ─── Public router — mounted at /api/join ─────────────────────────────────────
// Handles GET /api/join/:token and POST /api/join/:token

export const joinPublicRouter = Router({ mergeParams: true });

// GET /api/join/:token
joinPublicRouter.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = p(req, 'token');

    const invite = await prisma.clubJoinInvite.findUnique({
      where: { token },
      include: {
        restaurant: { select: { name: true, slug: true } },
      },
    });

    if (!invite) throw new NotFoundError('ClubJoinInvite');

    const expired = invite.expiresAt < new Date();
    const alreadyJoined = invite.usedAt != null;

    res.json({
      restaurantName: invite.restaurant.name,
      restaurantSlug: invite.restaurant.slug,
      guestName: invite.guestName ?? null,
      alreadyJoined,
      expired,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/join/:token
joinPublicRouter.post('/:token', validate(JoinSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = p(req, 'token');
    const body = req.body as z.infer<typeof JoinSchema>;

    const invite = await prisma.clubJoinInvite.findUnique({
      where: { token },
      include: { restaurant: { select: { name: true } } },
    });

    if (!invite) throw new NotFoundError('ClubJoinInvite');
    if (invite.expiresAt < new Date()) throw new BusinessRuleError('הקישור פג תוקף');
    if (invite.usedAt != null) throw new BusinessRuleError('כבר הצטרפת לקלאב');

    const { restaurantId, reservationId } = invite;

    // ── Resolve or create Guest ───────────────────────────────────────────────
    let guestId: string;

    if (invite.guestId) {
      guestId = invite.guestId;
      await prisma.guest.update({
        where: { id: guestId },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          ...(body.phone ? { phone: body.phone } : {}),
        },
      });
    } else {
      const existingGuest = body.phone
        ? await prisma.guest.findFirst({
            where: { restaurantId, phone: body.phone },
          })
        : null;

      if (existingGuest) {
        guestId = existingGuest.id;
        await prisma.guest.update({
          where: { id: guestId },
          data: { firstName: body.firstName, lastName: body.lastName },
        });
      } else {
        const newGuest = await prisma.guest.create({
          data: {
            restaurantId,
            firstName: body.firstName,
            lastName: body.lastName,
            phone: body.phone ?? null,
          },
        });
        guestId = newGuest.id;
      }
    }

    // ── Deduplicate ────────────────────────────────────────────────────────────
    const existingMember = await prisma.clubMember.findUnique({
      where: { restaurantId_guestId: { restaurantId, guestId } },
    });

    if (existingMember) {
      await prisma.clubJoinInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
      return res.json({ ok: true, membershipId: existingMember.id });
    }

    // ── Create ClubMember ─────────────────────────────────────────────────────
    const source: ClubJoinSource = reservationId ? 'RESERVATION_LINK' : 'FEEDBACK_FLOW';

    const member = await prisma.clubMember.create({
      data: {
        restaurantId,
        guestId,
        source,
        birthday: body.birthday ?? null,
        anniversary: body.anniversary ?? null,
        smsConsent: body.smsConsent,
        marketingConsent: body.marketingConsent,
        emailConsent: false,
      },
    });

    await prisma.clubJoinInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    await prisma.guestMemory.create({
      data: {
        restaurantId,
        guestId,
        category: 'MILESTONE',
        source: 'AUTO_DETECTED',
        headline: 'הצטרף לאיירון קלאב',
        context: source === 'RESERVATION_LINK' ? 'הצטרפות דרך קישור הזמנה' : 'הצטרפות דרך משוב ביקור',
        emotionalWeight: 5,
        occurredAt: new Date(),
        addedBy: 'CLUB',
      },
    });

    void writeConsentAudit({
      restaurantId,
      guestId,
      clubMemberId:    member.id,
      consentType:     ConsentType.CLUB_MEMBERSHIP,
      action:          ConsentAction.GRANTED,
      source:          source === 'RESERVATION_LINK' ? ConsentSource.CLUB_JOIN_FORM : ConsentSource.FEEDBACK_FORM,
      smsConsent:      member.smsConsent,
      marketingConsent: member.marketingConsent,
      emailConsent:    member.emailConsent,
      ipAddress:       req.ip ?? null,
      userAgent:       req.headers['user-agent'] ?? null,
    });

    return res.status(201).json({ ok: true, membershipId: member.id });
  } catch (err) {
    next(err);
  }
});

// ─── Invite management router — mounted at /api/restaurants/:restaurantId/club ─
// Handles POST /invites and GET /invites

export const joinInviteRouter = Router({ mergeParams: true });

// POST /api/restaurants/:restaurantId/club/invites
joinInviteRouter.post(
  '/invites',
  authenticate,
  requireRole('MANAGER'),
  validate(CreateInviteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurantId = p(req, 'restaurantId');
      const body = req.body as z.infer<typeof CreateInviteSchema>;

      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + body.expiresInDays * 86400 * 1000);

      const invite = await prisma.clubJoinInvite.create({
        data: {
          restaurantId,
          token,
          guestId: body.guestId ?? null,
          guestName: body.guestName ?? null,
          guestPhone: body.guestPhone ?? null,
          reservationId: body.reservationId ?? null,
          expiresAt,
        },
      });

      const joinUrl = `${config.frontendBaseUrl}/join/${token}`;

      return res.status(201).json({ invite, joinUrl });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/restaurants/:restaurantId/club/invites
joinInviteRouter.get(
  '/invites',
  authenticate,
  requireRole('MANAGER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurantId = p(req, 'restaurantId');

      const invites = await prisma.clubJoinInvite.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          token: true,
          guestName: true,
          guestPhone: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
        },
      });

      const now = new Date();

      const result = invites.map((invite) => {
        const status: 'USED' | 'EXPIRED' | 'PENDING' = invite.usedAt
          ? 'USED'
          : invite.expiresAt < now
          ? 'EXPIRED'
          : 'PENDING';

        return {
          ...invite,
          joinUrl: `${config.frontendBaseUrl}/join/${invite.token}`,
          status,
        };
      });

      return res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Default export kept for backward compat — exports the public router
export default joinPublicRouter;
