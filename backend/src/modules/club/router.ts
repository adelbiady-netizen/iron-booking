import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { NotFoundError, BusinessRuleError } from '../../lib/errors';
import { ClubJoinSource, ClubMemberStatus } from '@prisma/client';
import { z } from 'zod';
import { validate } from '../../middleware/validate';

const router = Router({ mergeParams: true });

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// All club routes require MANAGER+
router.use(authenticate, requireRole('MANAGER'));

const CreateMemberSchema = z.object({
  guestId: z.string().uuid(),
  source: z.nativeEnum(ClubJoinSource),
  birthday: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  anniversary: z.string().regex(/^\d{2}-\d{2}$/).optional(),
  marketingConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

const UpdateMemberSchema = z.object({
  birthday: z.string().regex(/^\d{2}-\d{2}$/).nullable().optional(),
  anniversary: z.string().regex(/^\d{2}-\d{2}$/).nullable().optional(),
  marketingConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
  status: z.nativeEnum(ClubMemberStatus).optional(),
  notes: z.string().max(500).nullable().optional(),
});

// GET /api/restaurants/:restaurantId/club/members
router.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const { search, status, page = '1', limit = '50' } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = { restaurantId };
    if (status) where.status = status;
    if (search) {
      where.guest = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      prisma.clubMember.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { joinDate: 'desc' },
        include: {
          guest: {
            select: {
              id: true, firstName: true, lastName: true, phone: true,
              email: true, visitCount: true, vipScore: true, isVip: true,
              lastVisitAt: true,
            },
          },
        },
      }),
      prisma.clubMember.count({ where }),
    ]);

    res.json({ data, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// POST /api/restaurants/:restaurantId/club/members
router.post('/members', validate(CreateMemberSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const { guestId, source, birthday, anniversary, marketingConsent, smsConsent, emailConsent, notes } =
      req.body as z.infer<typeof CreateMemberSchema>;

    const existing = await prisma.clubMember.findUnique({ where: { restaurantId_guestId: { restaurantId, guestId } } });
    if (existing) throw new BusinessRuleError('Guest is already a club member at this restaurant');

    const member = await prisma.clubMember.create({
      data: {
        restaurantId,
        guestId,
        source,
        birthday: birthday ?? null,
        anniversary: anniversary ?? null,
        marketingConsent: marketingConsent ?? false,
        smsConsent: smsConsent ?? false,
        emailConsent: emailConsent ?? false,
        notes: notes ?? null,
      },
      include: {
        guest: { select: { id: true, firstName: true, lastName: true, phone: true, visitCount: true, vipScore: true } },
      },
    });

    // Write to guest timeline
    await prisma.guestMemory.create({
      data: {
        restaurantId,
        guestId,
        category: 'MILESTONE',
        source: 'AUTO_DETECTED',
        headline: 'הצטרף לאיירון קלאב',
        context: source === 'FEEDBACK_FLOW' ? 'הצטרפות דרך משוב ביקור' :
                 source === 'HOST_STAFF' ? 'הצטרפות על ידי צוות' : null,
        emotionalWeight: 5,
        occurredAt: new Date(),
        addedBy: 'CLUB',
      },
    });

    res.status(201).json(member);
  } catch (err) { next(err); }
});

// GET /api/restaurants/:restaurantId/club/members/:memberId
router.get('/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const member = await prisma.clubMember.findFirst({
      where: { id: p(req, 'memberId'), restaurantId: p(req, 'restaurantId') },
      include: {
        guest: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, email: true,
            visitCount: true, vipScore: true, silentScore: true, isVip: true,
            lastVisitAt: true, firstVisitAt: true, allergies: true, tags: true,
            internalNotes: true,
          },
        },
      },
    });
    if (!member) throw new NotFoundError('ClubMember', p(req, 'memberId'));
    res.json(member);
  } catch (err) { next(err); }
});

// PATCH /api/restaurants/:restaurantId/club/members/:memberId
router.patch('/members/:memberId', validate(UpdateMemberSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.clubMember.findFirst({
      where: { id: p(req, 'memberId'), restaurantId: p(req, 'restaurantId') },
    });
    if (!existing) throw new NotFoundError('ClubMember', p(req, 'memberId'));

    const data = req.body as z.infer<typeof UpdateMemberSchema>;
    const updated = await prisma.clubMember.update({
      where: { id: existing.id },
      data: {
        birthday:         data.birthday  !== undefined ? data.birthday  : undefined,
        anniversary:      data.anniversary !== undefined ? data.anniversary : undefined,
        marketingConsent: data.marketingConsent,
        smsConsent:       data.smsConsent,
        emailConsent:     data.emailConsent,
        status:           data.status,
        notes:            data.notes !== undefined ? data.notes : undefined,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/restaurants/:restaurantId/club/stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const [total, active, optedOut, paused] = await Promise.all([
      prisma.clubMember.count({ where: { restaurantId } }),
      prisma.clubMember.count({ where: { restaurantId, status: 'ACTIVE' } }),
      prisma.clubMember.count({ where: { restaurantId, status: 'OPTED_OUT' } }),
      prisma.clubMember.count({ where: { restaurantId, status: 'PAUSED' } }),
    ]);
    res.json({ total, active, optedOut, paused });
  } catch (err) { next(err); }
});

// GET /api/restaurants/:restaurantId/club/pending-approvals
// Messages pending manager approval (feedback requests + future club messages)
router.get('/pending-approvals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const pending = await prisma.momentQueue.findMany({
      where: {
        restaurantId,
        type: 'FEEDBACK_REQUEST',
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        guest: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });
    res.json(pending);
  } catch (err) { next(err); }
});

// GET /api/restaurants/:restaurantId/club/upcoming-events?days=30
// Read-only. Returns members with birthday or anniversary in the next N days,
// with eligibility flags for SMS automation. No SMS sent, no writes.
router.get('/upcoming-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'restaurantId');
    const days = Math.min(90, Math.max(1, parseInt((req.query['days'] as string) ?? '30') || 30));

    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { timezone: true, settings: true },
    });
    if (!restaurant) return res.json({ birthdays: [], anniversaries: [] });

    const tz = restaurant.timezone ?? 'UTC';
    const s  = (restaurant.settings ?? {}) as Record<string, unknown>;

    // Build MM-DD strings for today through today+days, preserving day index for daysUntil
    const mmddToDay = new Map<string, number>();
    for (let i = 0; i <= days; i++) {
      const d     = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit', day: '2-digit' }).formatToParts(d);
      const mmdd  = `${parts.find(pt => pt.type === 'month')!.value}-${parts.find(pt => pt.type === 'day')!.value}`;
      if (!mmddToDay.has(mmdd)) mmddToDay.set(mmdd, i); // keep earliest occurrence
    }
    const upcomingDates = Array.from(mmddToDay.keys());

    const cutoff = new Date(Date.now() - 330 * 24 * 60 * 60 * 1000);

    async function buildRows(
      field:        'birthday' | 'anniversary',
      messageType:  'BIRTHDAY' | 'ANNIVERSARY',
      autoEnabledKey: string,
    ) {
      const members = await prisma.clubMember.findMany({
        where: { restaurantId, status: 'ACTIVE', [field]: { in: upcomingDates } },
        select: {
          id:          true,
          smsConsent:  true,
          birthday:    true,
          anniversary: true,
          guest: { select: { firstName: true, lastName: true, phone: true } },
        },
        orderBy: { [field]: 'asc' },
      });

      const automationEnabled =
        s.ironClubEnabled !== false &&
        s.smsEnabled      === true  &&
        s[autoEnabledKey] === true;

      const rows = await Promise.all(members.map(async (m) => {
        const mmdd = (field === 'birthday' ? m.birthday : m.anniversary) ?? '';

        const alreadySentThisYear = m.smsConsent
          ? !!(await prisma.messageLog.findFirst({
              where: {
                restaurantId,
                clubMemberId: m.id,
                messageType:  messageType as 'BIRTHDAY' | 'ANNIVERSARY',
                status:       { in: ['SENT', 'PENDING'] },
                createdAt:    { gte: cutoff },
              },
              select: { id: true },
            }))
          : false;

        const phone   = m.guest.phone ?? '';
        const masked  = phone.length >= 6
          ? `${phone.slice(0, 3)}****${phone.slice(-3)}`
          : '—';

        return {
          memberId:            m.id,
          name:                `${m.guest.firstName ?? ''} ${m.guest.lastName ?? ''}`.trim() || '—',
          phoneMasked:         masked,
          mmdd,
          daysUntil:           mmddToDay.get(mmdd) ?? 0,
          smsConsent:          m.smsConsent,
          automationEnabled,
          alreadySentThisYear,
          willReceiveSms:      m.smsConsent && automationEnabled && !!phone && !alreadySentThisYear,
        };
      }));

      return rows.sort((a, b) => a.daysUntil - b.daysUntil);
    }

    const [birthdays, anniversaries] = await Promise.all([
      buildRows('birthday',    'BIRTHDAY',    'clubBirthdaySmsEnabled'),
      buildRows('anniversary', 'ANNIVERSARY', 'clubAnniversarySmsEnabled'),
    ]);

    res.json({ birthdays, anniversaries });
  } catch (err) { next(err); }
});

export default router;
