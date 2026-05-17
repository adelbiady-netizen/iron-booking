import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';

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

// ─── All routes below require at least HQ_ADMIN ──────────────────────────────
// SUPER_ADMIN (100) passes. HQ_ADMIN (80) passes.
// Mutation routes each carry an explicit requireRole('SUPER_ADMIN') guard.
router.use(authenticate, requireRole('HQ_ADMIN'));

const superAdminOnly = requireRole('SUPER_ADMIN');

// Helper: validate an HQ_ADMIN's groupId matches a restaurant's groupId.
// SUPER_ADMIN always passes. Throws ForbiddenError otherwise.
async function assertGroupAccess(req: Request, restaurantGroupId: string | null) {
  if (req.auth.role === 'SUPER_ADMIN') return;
  if (!req.auth.groupId || restaurantGroupId !== req.auth.groupId) {
    throw new ForbiddenError('Access denied: restaurant is not in your group');
  }
}

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

// GET /admin/restaurants — SUPER_ADMIN sees all; HQ_ADMIN sees their group only
router.get('/restaurants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where = req.auth.role === 'SUPER_ADMIN'
      ? { isSystem: false }
      : { isSystem: false, groupId: req.auth.groupId ?? '__none__' };
    const rows = await prisma.restaurant.findMany({
      where,
      include: { _count: { select: { users: true, tables: true, reservations: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  } catch (err) { next(err); }
});

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

// GET /admin/restaurants/:id
router.get('/restaurants/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: p(req, 'id'), isSystem: false },
      include: {
        operatingHours: { orderBy: { dayOfWeek: 'asc' } },
        _count: { select: { users: true, tables: true, reservations: true } },
      },
    });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));
    await assertGroupAccess(req, restaurant.groupId);
    res.json(restaurant);
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
});

// PATCH /admin/restaurants/:id/settings
router.patch('/restaurants/:id/settings', superAdminOnly, validate(UpdateSettingsSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));

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

// PUT /admin/restaurants/:id/operating-hours — replace all 7 day records
router.put('/restaurants/:id/operating-hours', superAdminOnly, validate(OperatingHoursSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: p(req, 'id'), isSystem: false } });
    if (!restaurant) throw new NotFoundError('Restaurant', p(req, 'id'));

    const { hours } = req.body as z.infer<typeof OperatingHoursSchema>;

    // Validate lastSeating ≤ closeTime for open days
    for (const h of hours) {
      if (h.isOpen && h.lastSeating > h.closeTime) {
        throw new BusinessRuleError(`Day ${h.dayOfWeek}: last seating (${h.lastSeating}) cannot be after close time (${h.closeTime})`);
      }
    }

    // Bulk upsert all 7 days + keep settings.openingHour in sync (earliest open day)
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
      select: { id: true, name: true, linkPhone: true },
      orderBy: { name: 'asc' },
    });
    res.json(rows);
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

// ─── Online Booking Restrictions ─────────────────────────────────────────────
// Manage per-date/time-range online booking blocks.
// These only affect the public slot engine — host/admin reservation creation is unaffected.

const OnlineRestrictionSchema = z.object({
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  startTime:       z.string().regex(HHmm, 'startTime must be HH:mm').nullable().optional(),
  endTime:         z.string().regex(HHmm, 'endTime must be HH:mm').nullable().optional(),
  restrictionType: z.string().default('BLOCK'),
  reason:          z.string().nullable().optional(),
  guestMessage:    z.string().max(200).nullable().optional(),
});

// GET /admin/restaurants/:id/online-restrictions
router.get('/restaurants/:id/online-restrictions', async (req: Request, res: Response, next: NextFunction) => {
  try {
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
router.post('/restaurants/:id/online-restrictions', validate(OnlineRestrictionSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
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
router.delete('/restaurants/:id/online-restrictions/:rid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.onlineBookingRestriction.findFirst({
      where: { id: p(req, 'rid'), restaurantId: p(req, 'id') },
    });
    if (!row) throw new NotFoundError('OnlineBookingRestriction', p(req, 'rid'));

    await prisma.onlineBookingRestriction.delete({ where: { id: p(req, 'rid') } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
