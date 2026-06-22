import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import * as service from './service';
import { prisma } from '../../lib/prisma';
import { ForbiddenError } from '../../lib/errors';

const router = Router();
router.use(authenticate);

// Helper: Express 5 types req.params values as string | string[] — route
// params from :id patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

const GuestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  isVip: z.boolean().optional(),
  allergies: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  // Zod v4 requires both key and value schemas for z.record()
  preferences: z.record(z.string(), z.unknown()).optional(),
  internalNotes: z.string().optional(),
});

const SearchQuerySchema = z.object({
  search: z.string().optional(),
  isVip: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  isBlacklisted: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

type SearchQuery = z.infer<typeof SearchQuerySchema>;

// GET /guests — guarded by:
//   1. restaurant feature flag (guestsPageEnabled, default true)
//   2. minimum role: MANAGER (HOST and SERVER are denied)
router.get('/', requireRole('MANAGER'), validate(SearchQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.auth.restaurantId },
      select: { settings: true },
    });
    const settings = (restaurant?.settings ?? {}) as Record<string, unknown>;
    if (settings.guestsPageEnabled === false) {
      throw new ForbiddenError('מודול אורחים לא פעיל');
    }
    const result = await service.searchGuests(req.auth.restaurantId, req.query as unknown as SearchQuery);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /guests
router.post('/', validate(GuestSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guest = await service.createGuest(req.auth.restaurantId, req.body);
    res.status(201).json(guest);
  } catch (err) { next(err); }
});

// POST /guests/find-or-create
router.post('/find-or-create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.findOrCreateGuest(req.auth.restaurantId, req.body);
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { next(err); }
});

// GET /guests/lookup?phone=... — read-only phone lookup, never creates
router.get('/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
    const guest = await service.lookupGuestByPhone(req.auth.restaurantId, phone);
    res.json({ guest });
  } catch (err) { next(err); }
});

// GET /guests/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guest = await service.getGuest(req.auth.restaurantId, p(req, 'id'));
    res.json(guest);
  } catch (err) { next(err); }
});

// PATCH /guests/:id
router.patch('/:id', validate(GuestSchema.partial()), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guest = await service.updateGuest(req.auth.restaurantId, p(req, 'id'), req.body);
    res.json(guest);
  } catch (err) { next(err); }
});

// POST /guests/:id/merge — merge duplicate into primary
router.post('/:id/merge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { duplicateId } = req.body;
    const result = await service.mergeGuests(req.auth.restaurantId, p(req, 'id'), duplicateId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /guests/:id/consent-audit — consent history for a guest, scoped to this restaurant
router.get('/:id/consent-audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guestId      = p(req, 'id');
    const restaurantId = req.auth.restaurantId;

    // Verify the guest belongs to this restaurant (prevents cross-tenant leakage)
    const guest = await prisma.guest.findFirst({
      where:  { id: guestId, restaurantId },
      select: { id: true },
    });
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    const rows = await prisma.consentAudit.findMany({
      where:   { guestId, restaurantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id:                  true,
        consentType:         true,
        action:              true,
        source:              true,
        smsConsent:          true,
        marketingConsent:    true,
        emailConsent:        true,
        consentTextVersion:  true,
        ipAddress:           true,
        userAgent:           true,
        actorId:             true,
        notes:               true,
        createdAt:           true,
        clubMemberId:        true,
      },
    });

    // Privacy: partial-mask IP, summarise user-agent
    const sanitised = rows.map(r => ({
      ...r,
      ipAddress: r.ipAddress ? maskIp(r.ipAddress) : null,
      userAgent: r.userAgent ? summariseUA(r.userAgent) : null,
      createdAt: r.createdAt.toISOString(),
    }));

    return res.json({ data: sanitised });
  } catch (err) { next(err); }
});

export default router;

// ── Privacy helpers ───────────────────────────────────────────────────────────

function maskIp(ip: string): string {
  // IPv4: show first two octets, mask the rest  →  "1.2.x.x"
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  // IPv6: show first group only  →  "2001:x:x:…"
  if (ip.includes(':')) return ip.split(':')[0] + ':x:x:x:x:x:x:x';
  return '?.?.?.?';
}

function summariseUA(ua: string): string {
  if (/iPhone|iPad/.test(ua))   return 'iOS Safari';
  if (/Android/.test(ua))       return 'Android';
  if (/Chrome/.test(ua))        return 'Chrome';
  if (/Firefox/.test(ua))       return 'Firefox';
  if (/Safari/.test(ua))        return 'Safari';
  if (/curl|wget|axios|node/i.test(ua)) return 'API';
  return 'דפדפן';
}
