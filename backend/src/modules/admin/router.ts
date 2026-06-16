import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import { sendSms } from '../../lib/messaging';
import { MessageType, MessageProvider, MessageStatus, MessageChannel } from '@prisma/client';

const router = Router();

function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// ─── Bootstrap (no auth required) ────────────────────────────────────────────

// GET /admin/bootstrap-status — used by frontend to decide whether to show setup page
router.get('/bootstrap-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
    res.json({ bootstrapped: count > 0 });
  } catch (err) { next(err); }
});

const BootstrapSchema = z.object({
  email:     z.string().email(),
  password:  z.string().min(8),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
});

// POST /admin/bootstrap — creates the first SUPER_ADMIN + system restaurant
router.post('/bootstrap', validate(BootstrapSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
    if (existing > 0) throw new ConflictError('Super admin already exists. Use normal login.');

    const { email, password, firstName, lastName } = req.body as z.infer<typeof BootstrapSchema>;
    const passwordHash = await bcrypt.hash(password, 12);

    const { user, restaurant } = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.upsert({
        where: { slug: '_system' },
        update: {},
        create: {
          name: 'System', slug: '_system', isSystem: true,
          settings: { defaultTurnMinutes: 90 },
        },
      });
      const user = await tx.user.create({
        data: { restaurantId: restaurant.id, email, passwordHash, firstName, lastName, role: 'SUPER_ADMIN' },
      });
      return { user, restaurant };
    });

    const token = jwt.sign(
      { userId: user.id, restaurantId: restaurant.id, role: user.role, email: user.email, firstName: user.firstName, lastName: user.lastName },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any },
    );

    res.status(201).json({
      token,
      user: {
        id: user.id, email: user.email, firstName: user.firstName,
        lastName: user.lastName, role: user.role, restaurant: null,
      },
    });
  } catch (err) { next(err); }
});

// ─── Schemas shared by pre-gate and post-gate routes ─────────────────────────

const HHmm = /^\d{2}:\d{2}$/;

const OperatingHoursSchema = z.object({
  hours: z.array(z.object({
    dayOfWeek:   z.number().int().min(0).max(6),
    isOpen:      z.boolean(),
    openTime:    z.string().regex(HHmm),
    closeTime:   z.string().regex(HHmm),
    lastSeating: z.string().regex(HHmm),
  })).length(7),
});

const OnlineRestrictionSchema = z.object({
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  startTime:       z.string().regex(HHmm, 'startTime must be HH:mm').nullable().optional(),
  endTime:         z.string().regex(HHmm, 'endTime must be HH:mm').nullable().optional(),
  restrictionType: z.string().default('BLOCK'),
  reason:          z.string().nullable().optional(),
  guestMessage:    z.string().max(200).nullable().optional(),
});

// Helper: validate an HQ_ADMIN's groupId matches a restaurant's groupId.
// SUPER_ADMIN always passes. Throws ForbiddenError otherwise.
async function assertGroupAccess(req: Request, restaurantGroupId: string | null) {
  if (req.auth.role === 'SUPER_ADMIN') return;
  if (!req.auth.groupId || restaurantGroupId !== req.auth.groupId) {
    throw new ForbiddenError('Access denied: restaurant is not in your group');
  }
}

// Helper: per-role restaurant isolation — explicit checks only, no fallthrough.
// SUPER_ADMIN: unrestricted. HQ_ADMIN: group-scoped. RESTAURANT_ADMIN: own restaurant only.
// All other roles (including GROUP_MANAGER): denied — must be added explicitly if needed.
async function assertRestaurantAccess(req: Request, restaurantId: string): Promise<void> {
  if (req.auth.role === 'SUPER_ADMIN') return;
  if (req.auth.role === 'HQ_ADMIN') {
    const r = await prisma.restaurant.findFirst({ where: { id: restaurantId }, select: { groupId: true } });
    await assertGroupAccess(req, r?.groupId ?? null);
    return;
  }
  if (req.auth.role === 'RESTAURANT_ADMIN') {
    if (req.auth.restaurantId !== restaurantId) {
      throw new ForbiddenError('Access denied: restaurant is not yours');
    }
    return;
  }
  throw new ForbiddenError('Access denied');
}

// Helper: check a portal permission for RESTAURANT_ADMIN callers.
// HQ_ADMIN and SUPER_ADMIN bypass all portal permission checks — they always pass.
// Returns 403 if the RESTAURANT_ADMIN's row is absent or the flag is false.
async function assertPortalPermission(
  req: Request,
  restaurantId: string,
  permission: 'canManageOperatingHours' | 'canManageOnlineRestrictions',
): Promise<void> {
  if (req.auth.role === 'SUPER_ADMIN' || req.auth.role === 'HQ_ADMIN') return;
  const perms = await prisma.restaurantPortalPermissions.findUnique({
    where: { restaurantId },
    select: { [permission]: true },
  });
  if (!perms || !perms[permission]) {
    throw new ForbiddenError(`Permission denied: ${permission} is not enabled for this restaurant`);
  }
}

// ─── Restaurant-scoped routes (accessible to RESTAURANT_ADMIN and above) ──────
// Registered BEFORE the HQ_ADMIN gate so RESTAURANT_ADMIN (level 50) can reach them.
// Each route carries its own authenticate + requireRole('RESTAURANT_ADMIN') guard.
// assertRestaurantAccess enforces isolation inside every handler.

// GET /admin/restaurants — role-scoped list
router.get('/restaurants', authenticate, requireRole('RESTAURANT_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    let where: { isSystem: boolean; groupId?: string; id?: string };
    if (req.auth.role === 'SUPER_ADMIN') {
      where = { isSystem: false };
    } else if (req.auth.role === 'HQ_ADMIN') {
      where = { isSystem: false, groupId: req.auth.groupId ?? '__none__' };
    } else if (req.auth.role === 'RESTAURANT_ADMIN') {
      where = { isSystem: false, id: req.auth.restaurantId };
    } else {
      throw new ForbiddenError('Access denied');
    }
    const rows = await prisma.restaurant.findMany({
      where,
      include: { _count: { select: { users: true, tables: true, reservations: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // Attach guestHubSlug via separate query (GuestHub.restaurantId is a soft link, not a Prisma relation)
    const hubs = await prisma.guestHub.findMany({
      where: { restaurantId: { in: rows.map(r => r.id) } },
      select: { restaurantId: true, slug: true },
    });
    const hubSlugByRestaurantId = new Map(hubs.map(h => [h.restaurantId, h.slug]));
    res.json(rows.map(r => ({ ...r, guestHubSlug: hubSlugByRestaurantId.get(r.id) ?? null })));
  } catch (err) { next(err); }
});

// GET /admin/restaurants/:id
router.get('/restaurants/:id', authenticate, requireRole('RESTAURANT_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertRestaurantAccess(req, p(req, 'id'));
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: p(req, 'id'), isSystem: false },
      include: {
        operatingHours:    { orderBy: { dayOfWeek: 'asc' } },
        portalPermissions: true,
        _count: { select: { users: true, tables: true, reservations: true } },
      },
    });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    const hub = await prisma.guestHub.findFirst({
      where: { restaurantId: restaurant.id },
      select: { slug: true },
    });
    res.json({ ...restaurant, guestHubSlug: hub?.slug ?? null });
  } catch (err) { next(err); }
});

// PUT /admin/restaurants/:id/operating-hours — replace all 7 day records
router.put('/restaurants/:id/operating-hours', authenticate, requireRole('RESTAURANT_ADMIN'), validate(OperatingHoursSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertRestaurantAccess(req, p(req, 'id'));
    await assertPortalPermission(req, p(req, 'id'), 'canManageOperatingHours');
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));

    const { hours } = req.body as z.infer<typeof OperatingHoursSchema>;

    for (const h of hours) {
      if (h.isOpen && h.lastSeating > h.closeTime) {
        throw new BusinessRuleError(`Day ${h.dayOfWeek}: last seating (${h.lastSeating}) cannot be after close time (${h.closeTime})`);
      }
    }

    const openDays = hours.filter(h => h.isOpen);
    const earliestOpen = openDays.length > 0
      ? openDays.reduce((a, b) => a.openTime <= b.openTime ? a : b).openTime
      : null;

    await prisma.$transaction([
      ...hours.map(h =>
        prisma.operatingHour.upsert({
          where:  { restaurantId_dayOfWeek: { restaurantId: p(req, 'id'), dayOfWeek: h.dayOfWeek } },
          update: { isOpen: h.isOpen, openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating },
          create: { restaurantId: p(req, 'id'), dayOfWeek: h.dayOfWeek, isOpen: h.isOpen, openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating },
        })
      ),
      ...(earliestOpen ? [
        prisma.restaurant.update({
          where: { id: p(req, 'id') },
          data:  { settings: { ...(restaurant.settings as object), openingHour: earliestOpen } },
        }),
      ] : []),
    ]);

    const updated = await prisma.operatingHour.findMany({
      where:   { restaurantId: p(req, 'id') },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /admin/restaurants/:id/online-restrictions
router.get('/restaurants/:id/online-restrictions', authenticate, requireRole('RESTAURANT_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertRestaurantAccess(req, p(req, 'id'));
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    const rows = await prisma.onlineBookingRestriction.findMany({
      where:   { restaurantId: p(req, 'id'), isActive: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /admin/restaurants/:id/online-restrictions
router.post('/restaurants/:id/online-restrictions', authenticate, requireRole('RESTAURANT_ADMIN'), validate(OnlineRestrictionSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertRestaurantAccess(req, p(req, 'id'));
    await assertPortalPermission(req, p(req, 'id'), 'canManageOnlineRestrictions');
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));

    const body = req.body as z.infer<typeof OnlineRestrictionSchema>;

    if (body.startTime && body.endTime && body.startTime >= body.endTime) {
      throw new BusinessRuleError('startTime must be before endTime');
    }

    const row = await prisma.onlineBookingRestriction.create({
      data: {
        restaurantId:    p(req, 'id'),
        date:            body.date,
        startTime:       body.startTime ?? null,
        endTime:         body.endTime ?? null,
        restrictionType: body.restrictionType ?? 'BLOCK',
        reason:          body.reason ?? null,
        guestMessage:    body.guestMessage ?? null,
        createdBy:       req.auth.userId,
      },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// DELETE /admin/restaurants/:id/online-restrictions/:rid
router.delete('/restaurants/:id/online-restrictions/:rid', authenticate, requireRole('RESTAURANT_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await assertRestaurantAccess(req, p(req, 'id'));
    await assertPortalPermission(req, p(req, 'id'), 'canManageOnlineRestrictions');
    const row = await prisma.onlineBookingRestriction.findFirst({
      where: { id: p(req, 'rid'), restaurantId: p(req, 'id') },
    });
    if (!row) throw new NotFoundError('OnlineBookingRestriction', p(req, 'rid'));
    await prisma.onlineBookingRestriction.delete({ where: { id: p(req, 'rid') } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── All routes below require at least HQ_ADMIN ──────────────────────────────
// SUPER_ADMIN (100) passes. HQ_ADMIN (80) passes.
// Mutation routes each carry an explicit requireRole('SUPER_ADMIN') guard.
router.use(authenticate, requireRole('HQ_ADMIN'));

const superAdminOnly = requireRole('SUPER_ADMIN');

// POST /admin/create-super-admin — create an additional SUPER_ADMIN account
const CreateSuperAdminSchema = z.object({
  email:     z.string().email(),
  password:  z.string().min(8),
  firstName: z.string().min(1).default('Admin'),
  lastName:  z.string().min(1).default('User'),
});

router.post('/create-super-admin', superAdminOnly, validate(CreateSuperAdminSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, firstName, lastName } = req.body as z.infer<typeof CreateSuperAdminSchema>;

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) throw new ConflictError(`User with email ${email} already exists`);

    const restaurant = await prisma.restaurant.findFirst({ where: { isSystem: true } });
    if (!restaurant) throw new Error('System restaurant not found — run bootstrap first');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { restaurantId: restaurant.id, email, passwordHash, firstName, lastName, role: 'SUPER_ADMIN' },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (err) { next(err); }
});

// ─── Restaurants ─────────────────────────────────────────────────────────────


const CreateRestaurantSchema = z.object({
  name:     z.string().min(1),
  slug:     z.string().min(2).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  timezone: z.string().default('America/New_York'),
  phone:    z.string().optional(),
  email:    z.string().email().optional(),
  address:  z.string().optional(),
});

// POST /admin/restaurants
router.post('/restaurants', superAdminOnly, validate(CreateRestaurantSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, slug, timezone, phone, email, address } = req.body as z.infer<typeof CreateRestaurantSchema>;

    const exists = await prisma.restaurant.findUnique({ where: { slug } });
    if (exists) throw new ConflictError(`Slug "${slug}" is already taken`);

    const restaurant = await prisma.$transaction(async (tx) => {
      const r = await tx.restaurant.create({
        data: {
          name, slug, timezone, phone, email, address,
          settings: {
            defaultTurnMinutes: 90, slotIntervalMinutes: 30, maxPartySize: 20,
            depositRequired: false, depositAmountCents: 0, autoConfirm: false,
            bufferBetweenTurnsMinutes: 15, openingHour: '11:00', closingHour: '22:00',
            lastSeatingOffset: 60, lateThresholdMinutes: 5, noShowThresholdMinutes: 15,
            confirmationRequired: false,
          },
        },
      });
      await tx.operatingHour.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          restaurantId: r.id, dayOfWeek: day,
          openTime: '11:00', closeTime: '22:00', lastSeating: '21:00',
          isOpen: day !== 0,
        })),
      });
      return r;
    });

    res.status(201).json(restaurant);
  } catch (err) { next(err); }
});


const UpdateRestaurantSchema = z.object({
  name:      z.string().min(1).optional(),
  phone:     z.string().nullable().optional(),
  email:     z.string().email().nullable().optional(),
  address:   z.string().nullable().optional(),
  timezone:  z.string().optional(),
  linkPhone: z.string().nullable().optional(), // Link telephony DID for call routing
});

// PATCH /admin/restaurants/:id
router.patch('/restaurants/:id', superAdminOnly, validate(UpdateRestaurantSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    const updated = await prisma.restaurant.update({
      where: { id: p(req, 'id') },
      data: req.body,
    });
    res.json(updated);
  } catch (err) { next(err); }
});

const PortalPermissionsSchema = z.object({
  canManageOperatingHours:     z.boolean().optional(),
  canManageOnlineRestrictions: z.boolean().optional(),
});

// PATCH /admin/restaurants/:id/portal-permissions — HQ_ADMIN/SUPER_ADMIN only
router.patch('/restaurants/:id/portal-permissions', validate(PortalPermissionsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false }, select: { groupId: true } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    if (req.auth.role !== 'SUPER_ADMIN') {
      await assertGroupAccess(req, restaurant.groupId);
    }
    const body = req.body as z.infer<typeof PortalPermissionsSchema>;
    const perms = await prisma.restaurantPortalPermissions.upsert({
      where:  { restaurantId: p(req, 'id') },
      update: { ...body },
      create: {
        restaurantId:                p(req, 'id'),
        canManageOperatingHours:     body.canManageOperatingHours     ?? false,
        canManageOnlineRestrictions: body.canManageOnlineRestrictions ?? false,
      },
    });
    res.json(perms);
  } catch (err) { next(err); }
});

// Per-restaurant SMS templates: a main override (with {variables}) + a free-text
// addon, per message type. Both nullable/optional — empty means "use the default".
const SmsTemplatePairSchema = z.object({
  main:  z.string().max(600).nullable().optional(),
  addon: z.string().max(600).nullable().optional(),
});
const SmsTemplatesSchema = z.object({
  RESERVATION_RECEIVED: SmsTemplatePairSchema.optional(),
  CONFIRMATION_REQUEST: SmsTemplatePairSchema.optional(),
  REMINDER:             SmsTemplatePairSchema.optional(),
});

const UpdateSettingsSchema = z.object({
  defaultTurnMinutes:        z.number().int().min(15).max(480).optional(),
  slotIntervalMinutes:       z.number().int().optional(),
  maxPartySize:              z.number().int().optional(),
  depositRequired:           z.boolean().optional(),
  autoConfirm:               z.boolean().optional(),
  bufferBetweenTurnsMinutes: z.number().int().optional(),
  openingHour:               z.string().optional(),
  closingHour:               z.string().optional(),
  lastSeatingOffset:         z.number().int().optional(),
  lateThresholdMinutes:      z.number().int().min(1).max(60).optional(),
  noShowThresholdMinutes:    z.number().int().min(5).max(120).optional(),
  confirmationRequired:      z.boolean().optional(),
  // SMS service configuration (stored in restaurant.settings JSON)
  smsEnabled:                z.boolean().optional(),
  smsProvider:               z.enum(['INFORU', 'MOCK']).optional(),
  smsSenderName:             z.string().trim().min(1).max(11).optional(),
  smsMonthlyQuota:           z.number().int().min(0).optional(),
  smsFallbackEnabled:        z.boolean().optional(),
  reminderEnabled:           z.boolean().optional(),
  reminderLeadMinutes:       z.number().int().min(0).max(1440).optional(),
  smsTemplates:              SmsTemplatesSchema.optional(),
  // Link telephony — numeric ring-group IDs owned by this restaurant (e.g. ["205","206"]).
  // Used by the Link webhook to route incoming calls to this restaurant.
  linkGroupIds:              z.array(z.string().trim().regex(/^\d+$/, 'Link group IDs must be numeric')).max(50).optional(),
  // Feature flags
  guestsPageEnabled:          z.boolean().optional(),
  // IRON CLUB
  ironClubEnabled:            z.boolean().optional(),
  ironClubTier:               z.enum(['NONE', 'STARTER', 'MEMBER', 'INTELLIGENCE', 'LUXURY']).optional(),
  feedbackApprovalRequired:   z.boolean().optional(),
});

// PATCH /admin/restaurants/:id/settings
router.patch('/restaurants/:id/settings', superAdminOnly, validate(UpdateSettingsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));

    // Tenant isolation: a Link group ID may belong to at most one restaurant.
    // Reject if any requested group is already claimed by a different restaurant.
    const requestedGroups: unknown = req.body.linkGroupIds;
    if (Array.isArray(requestedGroups) && requestedGroups.length > 0) {
      const wanted = requestedGroups.map(String);
      const others = await prisma.restaurant.findMany({
        where: { isSystem: false, id: { not: restaurant.id } },
        select: { name: true, settings: true },
      });
      const conflicts: string[] = [];
      for (const o of others) {
        const owned = (o.settings as Record<string, unknown> | null)?.linkGroupIds;
        if (!Array.isArray(owned)) continue;
        const ownedStr = owned.map(String);
        for (const g of wanted) if (ownedStr.includes(g)) conflicts.push(`${g} → ${o.name}`);
      }
      if (conflicts.length > 0) {
        throw new ConflictError(`Link group(s) already assigned to another restaurant: ${conflicts.join(', ')}`);
      }
    }

    const merged = { ...(restaurant.settings as object), ...req.body };
    const updated = await prisma.restaurant.update({
      where: { id: p(req, 'id') },
      data: { settings: merged },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

const UpdateWhatsappSchema = z.object({
  ultramsgInstanceId: z.string().min(1).nullable(),
  ultramsgToken:      z.string().min(1).nullable(),
  whatsappPhone:      z.string().nullable().optional(),
});

// PATCH /admin/restaurants/:id/whatsapp — save per-restaurant UltraMsg credentials
router.patch('/restaurants/:id/whatsapp', superAdminOnly, validate(UpdateWhatsappSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    const updated = await prisma.restaurant.update({
      where: { id: p(req, 'id') },
      data: {
        ultramsgInstanceId: req.body.ultramsgInstanceId,
        ultramsgToken:      req.body.ultramsgToken,
        whatsappPhone:      req.body.whatsappPhone ?? null,
      },
      select: {
        id: true, ultramsgInstanceId: true, whatsappPhone: true,
        // never return the raw token — return a boolean instead
      },
    });
    res.json({ id: updated.id, ultramsgInstanceId: updated.ultramsgInstanceId, whatsappPhone: updated.whatsappPhone, tokenSet: !!req.body.ultramsgToken });
  } catch (err) { next(err); }
});

// POST /admin/restaurants/:id/whatsapp/test — send a test WhatsApp to the restaurant's whatsappPhone
router.post('/restaurants/:id/whatsapp/test', superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    if (!restaurant.ultramsgInstanceId || !restaurant.ultramsgToken) {
      throw new BusinessRuleError('WhatsApp credentials are not configured for this restaurant');
    }
    if (!restaurant.whatsappPhone) {
      throw new BusinessRuleError('No test phone number configured — set whatsappPhone first');
    }
    const { sendWhatsApp } = await import('../../lib/sms');
    const result = await sendWhatsApp(restaurant.id, restaurant.whatsappPhone, `✅ Iron Booking WhatsApp test — ${restaurant.name}`);
    res.json({ ok: result.success, to: result.to });
  } catch (err) { next(err); }
});

const UpdateBrandingSchema = z.object({
  cuisine:           z.string().max(80).nullable().optional(),
  primaryColor:      z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  accentColor:       z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  publicThemePreset: z.enum(['luxury','casual','family','nightlife','minimal','fineDining','mediterranean','italiano']).nullable().optional(),
  logoUrl:           z.string().url().nullable().optional(),
  coverImageUrl:     z.string().url().nullable().optional(),
  heroVideoUrl:      z.string().url().nullable().optional(),
  buttonStyle:           z.enum(['rounded','pill','sharp','luxury']).nullable().optional(),
  cardStyle:             z.enum(['glass','solid','luxury-dark','soft-light']).nullable().optional(),
  backgroundMood:        z.enum(['espresso','olive','cream','dark','warm']).nullable().optional(),
  backgroundColorHex:    z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  backgroundGradientHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  websiteUrl:    z.string().url().nullable().optional(),
  instagramUrl:  z.string().url().nullable().optional(),
  googleMapsUrl: z.string().url().nullable().optional(),
  wazeUrl:       z.string().url().nullable().optional(),
});

// PATCH /admin/restaurants/:id/branding
router.patch('/restaurants/:id/branding', superAdminOnly, validate(UpdateBrandingSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    const updated = await prisma.restaurant.update({
      where: { id: p(req, 'id') },
      data: {
        cuisine:           req.body.cuisine           ?? null,
        primaryColor:      req.body.primaryColor      ?? null,
        accentColor:       req.body.accentColor       ?? null,
        publicThemePreset: req.body.publicThemePreset ?? null,
        logoUrl:           req.body.logoUrl           ?? null,
        coverImageUrl:     req.body.coverImageUrl     ?? null,
        heroVideoUrl:      req.body.heroVideoUrl      ?? null,
        buttonStyle:           req.body.buttonStyle           ?? null,
        cardStyle:             req.body.cardStyle             ?? null,
        backgroundMood:        req.body.backgroundMood        ?? null,
        backgroundColorHex:    req.body.backgroundColorHex    ?? null,
        backgroundGradientHex: req.body.backgroundGradientHex ?? null,
        websiteUrl:    req.body.websiteUrl    ?? null,
        instagramUrl:  req.body.instagramUrl  ?? null,
        googleMapsUrl: req.body.googleMapsUrl ?? null,
        wazeUrl:       req.body.wazeUrl       ?? null,
      },
    });
    res.json({
      id:                    updated.id,
      cuisine:               updated.cuisine,
      primaryColor:          updated.primaryColor,
      accentColor:           updated.accentColor,
      publicThemePreset:     updated.publicThemePreset,
      logoUrl:               updated.logoUrl,
      coverImageUrl:         updated.coverImageUrl,
      heroVideoUrl:          updated.heroVideoUrl,
      buttonStyle:           updated.buttonStyle,
      cardStyle:             updated.cardStyle,
      backgroundMood:        updated.backgroundMood,
      backgroundColorHex:    updated.backgroundColorHex,
      backgroundGradientHex: updated.backgroundGradientHex,
      websiteUrl:    updated.websiteUrl,
      instagramUrl:  updated.instagramUrl,
      googleMapsUrl: updated.googleMapsUrl,
      wazeUrl:       updated.wazeUrl,
    });
  } catch (err) { next(err); }
});


// POST /admin/restaurants/:id/sample-layout — seeds default sections + tables
router.post('/restaurants/:id/sample-layout', superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));

    await prisma.$transaction([
      prisma.table.deleteMany({ where: { restaurantId: p(req, 'id') } }),
      prisma.section.deleteMany({ where: { restaurantId: p(req, 'id') } }),
    ]);

    await prisma.$transaction(async (tx) => {
      const main = await tx.section.create({
        data: { restaurantId: p(req, 'id'), name: 'Main Dining', color: '#6366f1', sortOrder: 1 },
      });
      const bar = await tx.section.create({
        data: { restaurantId: p(req, 'id'), name: 'Bar', color: '#f59e0b', sortOrder: 2 },
      });
      await tx.table.createMany({
        data: [
          // Main Dining — two rows of tables with explicit canvas positions
          // so the floor map activates immediately without needing a LayoutEditor save.
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T1', minCovers: 2, maxCovers: 4,                       posX:  60, posY:  80, width: 120, height: 72 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T2', minCovers: 2, maxCovers: 4,                       posX: 240, posY:  80, width: 120, height: 72 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T3', minCovers: 4, maxCovers: 6, shape: 'ROUND',        posX: 420, posY:  76, width:  80, height: 80 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T4', minCovers: 4, maxCovers: 8,                       posX: 560, posY:  72, width: 160, height: 80 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T5', minCovers: 2, maxCovers: 4,                       posX:  60, posY: 220, width: 120, height: 72 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T6', minCovers: 2, maxCovers: 2, shape: 'SQUARE',       posX: 240, posY: 216, width:  80, height: 80 },
          // Bar — small square tops in their own area
          { restaurantId: p(req, 'id'), sectionId: bar.id,  name: 'B1', minCovers: 1, maxCovers: 2, shape: 'SQUARE',       posX:  60, posY: 500, width:  72, height: 72 },
          { restaurantId: p(req, 'id'), sectionId: bar.id,  name: 'B2', minCovers: 1, maxCovers: 2, shape: 'SQUARE',       posX: 180, posY: 500, width:  72, height: 72 },
        ],
      });
    });

    res.json({ ok: true, message: 'Sample layout applied' });
  } catch (err) { next(err); }
});

// ─── Telephony ────────────────────────────────────────────────────────────────

// GET /admin/telephony — list all restaurants with their telephony routing config
router.get('/telephony', superAdminOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.restaurant.findMany({
      where: { isSystem: false },
      select: { id: true, name: true, slug: true, linkPhone: true, settings: true },
      orderBy: { name: 'asc' },
    });
    res.json(rows.map(r => {
      const ids = (r.settings as Record<string, unknown> | null)?.linkGroupIds;
      return {
        id: r.id, name: r.name, slug: r.slug, linkPhone: r.linkPhone,
        linkGroupIds: Array.isArray(ids) ? ids.map(String) : [],
      };
    }));
  } catch (err) { next(err); }
});

// GET /admin/telephony/unresolved-groups — Link ring-groups seen in call logs but
// not (yet) mapped to any restaurant. Drives the HQ "assign group" panel.
router.get('/telephony/unresolved-groups', superAdminOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [grouped, restaurants] = await Promise.all([
      prisma.callLog.groupBy({
        by: ['group'],
        where: { routingStatus: 'unresolved', group: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.restaurant.findMany({ where: { isSystem: false }, select: { name: true, settings: true } }),
    ]);

    const ownerOf = (g: string): string | null => {
      for (const r of restaurants) {
        const ids = (r.settings as Record<string, unknown> | null)?.linkGroupIds;
        if (Array.isArray(ids) && ids.map(String).includes(g)) return r.name;
      }
      return null;
    };

    const groups = grouped
      .filter(g => g.group)
      .map(g => ({
        group:          g.group as string,
        unresolvedCount: g._count._all,
        lastSeen:        g._max.createdAt,
        assignedTo:      ownerOf(g.group as string),  // non-null = already mapped (will resolve on next call)
      }))
      .sort((a, b) => b.unresolvedCount - a.unresolvedCount);

    res.json({ groups });
  } catch (err) { next(err); }
});

// ─── Users ────────────────────────────────────────────────────────────────────

// GET /admin/restaurants/:id/users
router.get('/restaurants/:id/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.auth.role !== 'SUPER_ADMIN') {
      const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
      await assertGroupAccess(req, restaurant?.groupId ?? null);
    }
    const users = await prisma.user.findMany({
      where: { restaurantId: p(req, 'id') },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(users);
  } catch (err) { next(err); }
});

const CreateUserSchema = z.object({
  email:     z.string().email('Invalid email address'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName:  z.string().min(1, 'Last name is required'),
  role:      z.enum(['ADMIN', 'MANAGER', 'HOST', 'SERVER'] as const, {
    message: 'Role must be one of: ADMIN, MANAGER, HOST, SERVER',
  }).default('HOST'),
});

// POST /admin/restaurants/:id/users
router.post('/restaurants/:id/users', superAdminOnly, validate(CreateUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'id');
    const { email, password, firstName, lastName, role } = req.body as z.infer<typeof CreateUserSchema>;

    const restaurant = await prisma.restaurant.findFirst({ where: { id: restaurantId, isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', restaurantId);

    const existing = await prisma.user.findUnique({
      where: { restaurantId_email: { restaurantId, email } },
    });
    if (existing) throw new ConflictError(`${email} already exists in this restaurant`);

    const user = await prisma.user.create({
      data: { restaurantId, email, passwordHash: await bcrypt.hash(password, 12), firstName, lastName, role },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, createdAt: true,
      },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

const UpdateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
  role:      z.enum(['ADMIN', 'MANAGER', 'HOST', 'SERVER']).optional(),
  isActive:  z.boolean().optional(),
  password:  z.string().min(8).optional(),
});

// PATCH /admin/users/:id
router.patch('/users/:id', superAdminOnly, validate(UpdateUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password, ...rest } = req.body as z.infer<typeof UpdateUserSchema>;

    const user = await prisma.user.findUnique({ where: { id: p(req, 'id') } });
    if (!user) throw new NotFoundError('User', p(req, 'id'));
    if (user.role === 'SUPER_ADMIN') throw new ForbiddenError('Cannot modify a SUPER_ADMIN via this endpoint');

    const updated = await prisma.user.update({
      where: { id: p(req, 'id') },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── Groups ───────────────────────────────────────────────────────────────────

const CreateGroupSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
});

const UpdateGroupSchema = z.object({
  name: z.string().min(1).optional(),
});

// GET /admin/groups — list all groups (SUPER_ADMIN only)
router.get('/groups', superAdminOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await prisma.restaurantGroup.findMany({
      include: { _count: { select: { restaurants: true, users: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(groups);
  } catch (err) { next(err); }
});

// POST /admin/groups — create a group (SUPER_ADMIN only)
router.post('/groups', superAdminOnly, validate(CreateGroupSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, slug } = req.body as z.infer<typeof CreateGroupSchema>;
    const exists = await prisma.restaurantGroup.findUnique({ where: { slug } });
    if (exists) throw new ConflictError(`Slug "${slug}" is already taken`);
    const group = await prisma.restaurantGroup.create({
      data: { name, slug },
      include: { _count: { select: { restaurants: true, users: true } } },
    });
    res.status(201).json(group);
  } catch (err) { next(err); }
});

// GET /admin/groups/:id — SUPER_ADMIN sees any; HQ_ADMIN sees their own group
router.get('/groups/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.restaurantGroup.findUnique({
      where: { id: p(req, 'id') },
      include: {
        restaurants: {
          where: { isSystem: false },
          include: { _count: { select: { users: true, tables: true, reservations: true } } },
          orderBy: { name: 'asc' },
        },
        users: {
          where: { role: 'HQ_ADMIN' },
          select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { restaurants: true, users: true } },
      },
    });
    if (!group) throw new NotFoundError('Group', p(req, 'id'));
    if (req.auth.role !== 'SUPER_ADMIN' && req.auth.groupId !== group.id) {
      throw new ForbiddenError('Access denied');
    }
    res.json(group);
  } catch (err) { next(err); }
});

// GET /admin/groups/:id/tonight — live operational stats per location (group owner or SUPER_ADMIN)
router.get('/groups/:id/tonight', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.restaurantGroup.findUnique({
      where: { id: p(req, 'id') },
      include: { restaurants: { where: { isSystem: false }, select: { id: true, timezone: true } } },
    });
    if (!group) throw new NotFoundError('Group', p(req, 'id'));
    if (req.auth.role !== 'SUPER_ADMIN' && req.auth.groupId !== group.id) {
      throw new ForbiddenError('Access denied');
    }

    const stats = await Promise.all(group.restaurants.map(async (restaurant) => {
      const now = new Date();
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: restaurant.timezone });
      const timeParts = now.toLocaleTimeString('en-GB', {
        timeZone: restaurant.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).split(':');
      const hh = parseInt(timeParts[0], 10);
      const mm = parseInt(timeParts[1], 10);
      const nowTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      const cutoffMins = hh * 60 + mm + 90;
      const upcomingCutoff = `${String(Math.floor(cutoffMins / 60) % 24).padStart(2, '0')}:${String(cutoffMins % 60).padStart(2, '0')}`;

      // date is DateTime @db.Date — must use Date objects, not strings
      const dayStart = new Date(todayStr + 'T00:00:00.000Z');
      const dayEnd   = new Date(todayStr + 'T23:59:59.999Z');
      const rows = await prisma.reservation.findMany({
        where: { restaurantId: restaurant.id, date: { gte: dayStart, lte: dayEnd }, status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] } },
        select: { status: true, time: true },
      });

      return {
        restaurantId: restaurant.id,
        booked:   rows.filter(r => r.status !== 'SEATED').length,
        seated:   rows.filter(r => r.status === 'SEATED').length,
        late:     rows.filter(r => r.status !== 'SEATED' && r.time <= nowTime).length,
        upcoming: rows.filter(r => r.status !== 'SEATED' && r.time > nowTime && r.time <= upcomingCutoff).length,
      };
    }));

    res.json(stats);
  } catch (err) { next(err); }
});

// PATCH /admin/groups/:id — update group name (SUPER_ADMIN only)
router.patch('/groups/:id', superAdminOnly, validate(UpdateGroupSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.restaurantGroup.findUnique({ where: { id: p(req, 'id') } });
    if (!group) throw new NotFoundError('Group', p(req, 'id'));
    const updated = await prisma.restaurantGroup.update({
      where: { id: p(req, 'id') },
      data: req.body,
      include: { _count: { select: { restaurants: true, users: true } } },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /admin/groups/:id/restaurants/:restaurantId — assign restaurant to group (SUPER_ADMIN only)
router.post('/groups/:groupId/restaurants/:restaurantId', superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.restaurantGroup.findUnique({ where: { id: p(req, 'groupId') } });
    if (!group) throw new NotFoundError('Group', p(req, 'groupId'));
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'restaurantId'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'restaurantId'));
    const updated = await prisma.restaurant.update({
      where: { id: p(req, 'restaurantId') },
      data: { groupId: group.id },
      include: { _count: { select: { users: true, tables: true, reservations: true } } },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /admin/groups/:id/restaurants/:restaurantId — remove restaurant from group (SUPER_ADMIN only)
router.delete('/groups/:groupId/restaurants/:restaurantId', superAdminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'restaurantId'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'restaurantId'));
    const updated = await prisma.restaurant.update({
      where: { id: p(req, 'restaurantId') },
      data: { groupId: null },
      include: { _count: { select: { users: true, tables: true, reservations: true } } },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /admin/groups/:id/users — create an HQ_ADMIN for this group (SUPER_ADMIN only)
const CreateHqUserSchema = z.object({
  email:     z.string().email('Invalid email address'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName:  z.string().min(1, 'Last name is required'),
});

router.post('/groups/:id/users', superAdminOnly, validate(CreateHqUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.restaurantGroup.findUnique({ where: { id: p(req, 'id') } });
    if (!group) throw new NotFoundError('Group', p(req, 'id'));

    // HQ_ADMIN users are anchored to the system restaurant (they span all branches in their group)
    const systemRestaurant = await prisma.restaurant.findFirst({ where: { isSystem: true } });
    if (!systemRestaurant) throw new Error('System restaurant not found — run bootstrap first');

    const { email, password, firstName, lastName } = req.body as z.infer<typeof CreateHqUserSchema>;

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) throw new ConflictError(`User with email ${email} already exists`);

    const user = await prisma.user.create({
      data: {
        restaurantId: systemRestaurant.id,
        groupId:      group.id,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        firstName,
        lastName,
        role: 'HQ_ADMIN',
      },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, groupId: true, isActive: true, createdAt: true,
      },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// ─── SMS usage report (SUPER_ADMIN only) ──────────────────────────────────────
// GET /admin/sms/usage?month=YYYY-MM
// Aggregates message_logs to report how many SMS each restaurant actually sent in
// the given month. "Sent" = real provider (INFORU) with status SENT/DELIVERED.
// MOCK rows (provider not yet switched to live) are excluded from the sent count.
// Every non-system restaurant is listed, including those with zero sends.

const SmsUsageQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

router.get('/sms/usage', superAdminOnly, validate(SmsUsageQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const monthParam = (req.query as { month?: string }).month;
    const now = new Date();
    const [year, month] = monthParam
      ? monthParam.split('-').map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];

    const rangeStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const rangeEnd   = new Date(Date.UTC(year, month, 1, 0, 0, 0)); // exclusive

    const [restaurants, grouped] = await Promise.all([
      prisma.restaurant.findMany({
        where:   { isSystem: false },
        select:  { id: true, name: true, slug: true, settings: true },
        orderBy: { name: 'asc' },
      }),
      prisma.messageLog.groupBy({
        by: ['restaurantId', 'provider', 'status'],
        where: {
          channel:   MessageChannel.SMS,
          createdAt: { gte: rangeStart, lt: rangeEnd },
        },
        _count: { _all: true },
      }),
    ]);

    // restaurantId -> { sent, failed, pending, mock }
    const buckets = new Map<string, { sent: number; failed: number; pending: number; mock: number }>();
    for (const g of grouped) {
      const b = buckets.get(g.restaurantId) ?? { sent: 0, failed: 0, pending: 0, mock: 0 };
      const n = g._count._all;
      if (g.provider === MessageProvider.MOCK) {
        b.mock += n;
      } else if (g.status === MessageStatus.SENT || g.status === MessageStatus.DELIVERED) {
        b.sent += n;
      } else if (g.status === MessageStatus.FAILED) {
        b.failed += n;
      } else {
        b.pending += n;
      }
      buckets.set(g.restaurantId, b);
    }

    const rows = restaurants.map(r => {
      const s = (r.settings ?? {}) as Record<string, unknown>;
      const b = buckets.get(r.id) ?? { sent: 0, failed: 0, pending: 0, mock: 0 };
      return {
        restaurantId:  r.id,
        name:          r.name,
        slug:          r.slug,
        smsEnabled:    s.smsEnabled === true,
        smsProvider:   (s.smsProvider as string | undefined) ?? 'MOCK',
        smsSenderName: (s.smsSenderName as string | undefined) ?? null,
        sent:          b.sent,
        failed:        b.failed,
        pending:       b.pending,
        mock:          b.mock,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({ sent: acc.sent + r.sent, failed: acc.failed + r.failed, pending: acc.pending + r.pending, mock: acc.mock + r.mock }),
      { sent: 0, failed: 0, pending: 0, mock: 0 },
    );

    res.json({
      month:      `${year}-${String(month).padStart(2, '0')}`,
      rangeStart: rangeStart.toISOString(),
      rangeEnd:   rangeEnd.toISOString(),
      totals,
      restaurants: rows,
    });
  } catch (err) { next(err); }
});

// GET /admin/sms/usage/:id?month=YYYY-MM
// Per-restaurant detail: month totals, breakdown by messageType, and the latest
// messages (with sender, status, provider message id, error). "Real" sent/failed
// counts use the live provider (INFORU); MOCK rows are reported separately.

router.get('/sms/usage/:id', superAdminOnly, validate(SmsUsageQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = p(req, 'id');
    const restaurant = await prisma.restaurant.findFirst({
      where:  { id: restaurantId, isSystem: false },
      select: { id: true, name: true, slug: true, settings: true },
    });
    if (!restaurant) throw new NotFoundError('Restaurant', restaurantId);

    const s = (restaurant.settings ?? {}) as Record<string, unknown>;
    const monthParam = (req.query as { month?: string }).month;
    const now = new Date();
    const [year, month] = monthParam
      ? monthParam.split('-').map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const rangeStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const rangeEnd   = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const [grouped, latest] = await Promise.all([
      prisma.messageLog.groupBy({
        by: ['messageType', 'provider', 'status'],
        where: {
          restaurantId,
          channel:   MessageChannel.SMS,
          createdAt: { gte: rangeStart, lt: rangeEnd },
        },
        _count: { _all: true },
      }),
      prisma.messageLog.findMany({
        where:   { restaurantId, channel: MessageChannel.SMS },
        orderBy: { createdAt: 'desc' },
        take:    20,
        select: {
          id: true, phone: true, messageType: true, provider: true, senderName: true,
          status: true, providerMessageId: true, errorMessage: true, costAgorot: true, createdAt: true,
        },
      }),
    ]);

    const isSent = (status: MessageStatus) => status === MessageStatus.SENT || status === MessageStatus.DELIVERED;
    const totals = { sent: 0, failed: 0, pending: 0, mock: 0 };
    const byTypeMap = new Map<string, { messageType: string; sent: number; failed: number }>();

    for (const g of grouped) {
      const n = g._count._all;
      const row = byTypeMap.get(g.messageType) ?? { messageType: g.messageType, sent: 0, failed: 0 };
      if (g.provider === MessageProvider.MOCK) {
        totals.mock += n;
      } else if (isSent(g.status)) {
        totals.sent += n; row.sent += n;
      } else if (g.status === MessageStatus.FAILED) {
        totals.failed += n; row.failed += n;
      } else {
        totals.pending += n;
      }
      byTypeMap.set(g.messageType, row);
    }

    res.json({
      restaurantId:  restaurant.id,
      name:          restaurant.name,
      slug:          restaurant.slug,
      smsEnabled:    s.smsEnabled === true,
      smsProvider:   (s.smsProvider as string | undefined) ?? 'MOCK',
      smsSenderName: (s.smsSenderName as string | undefined) ?? null,
      month:         `${year}-${String(month).padStart(2, '0')}`,
      rangeStart:    rangeStart.toISOString(),
      rangeEnd:      rangeEnd.toISOString(),
      totals,
      byType:        Array.from(byTypeMap.values()).sort((a, b) => (b.sent + b.failed) - (a.sent + a.failed)),
      latest,
    });
  } catch (err) { next(err); }
});

// ─── SMS test (SUPER_ADMIN only) ──────────────────────────────────────────────
// POST /admin/sms/test
// Sends a single SMS via the configured provider and returns the MessageLog result.
// Used to verify InforU credentials and phone normalisation before wiring to
// reservation flows. Remove or gate behind a feature flag after smoke test passes.

const SmsTestSchema = z.object({
  restaurantId: z.string().uuid(),
  to:           z.string().min(7),
  message:      z.string().min(1).max(160),
  type:         z.nativeEnum(MessageType).optional().default(MessageType.SYSTEM),
});

router.post(
  '/sms/test',
  authenticate,
  requireRole('SUPER_ADMIN'),
  validate(SmsTestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { restaurantId, to, message, type } = req.body as z.infer<typeof SmsTestSchema>;

      // Verify restaurant exists before attempting send
      const restaurant = await prisma.restaurant.findUnique({
        where:  { id: restaurantId },
        select: { id: true, name: true, settings: true },
      });
      if (!restaurant) throw new NotFoundError('Restaurant not found');

      const result = await sendSms({ restaurantId, to, message, type });

      // Return the full log row so caller can verify status / providerMessageId
      const log = await prisma.messageLog.findUnique({ where: { id: result.messageLogId } });
      res.json({ result, log });
    } catch (err) { next(err); }
  }
);

export default router;
