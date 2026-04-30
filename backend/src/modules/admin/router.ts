import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';

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
      { userId: user.id, restaurantId: restaurant.id, role: user.role, email: user.email },
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

// ─── All routes below require SUPER_ADMIN ────────────────────────────────────
router.use(authenticate, requireRole('SUPER_ADMIN'));

// ─── Restaurants ─────────────────────────────────────────────────────────────

// GET /admin/restaurants
router.get('/restaurants', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.restaurant.findMany({
      where: { isSystem: false },
      include: {
        _count: { select: { users: true, tables: true, reservations: true } },
      },
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
router.post('/restaurants', validate(CreateRestaurantSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, slug, timezone, phone, email, address } = req.body as z.infer<typeof CreateRestaurantSchema>;

    const exists = await prisma.restaurant.findUnique({ where: { slug } });
    if (exists) throw new ConflictError(`Slug "${slug}" is already taken`);

    const restaurant = await prisma.$transaction(async (tx) => {
      const r = await tx.restaurant.create({
        data: {
          name, slug, timezone, phone, email, address,
          settings: {
            defaultTurnMinutes: 90, slotIntervalMinutes: 15, maxPartySize: 20,
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
    res.json(restaurant);
  } catch (err) { next(err); }
});

const UpdateRestaurantSchema = z.object({
  name:    z.string().min(1).optional(),
  phone:   z.string().nullable().optional(),
  email:   z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

// PATCH /admin/restaurants/:id
router.patch('/restaurants/:id', validate(UpdateRestaurantSchema), async (req: Request, res: Response, next: NextFunction) => {
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
router.patch('/restaurants/:id/settings', validate(UpdateSettingsSchema), async (req: Request, res: Response, next: NextFunction) => {
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

// POST /admin/restaurants/:id/sample-layout — seeds default sections + tables
router.post('/restaurants/:id/sample-layout', async (req: Request, res: Response, next: NextFunction) => {
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
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T1', minCovers: 2, maxCovers: 4 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T2', minCovers: 2, maxCovers: 4 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T3', minCovers: 4, maxCovers: 6, shape: 'ROUND' },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T4', minCovers: 4, maxCovers: 8 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T5', minCovers: 2, maxCovers: 4 },
          { restaurantId: p(req, 'id'), sectionId: main.id, name: 'T6', minCovers: 2, maxCovers: 2, shape: 'SQUARE' },
          { restaurantId: p(req, 'id'), sectionId: bar.id,  name: 'B1', minCovers: 1, maxCovers: 2, shape: 'SQUARE' },
          { restaurantId: p(req, 'id'), sectionId: bar.id,  name: 'B2', minCovers: 1, maxCovers: 2, shape: 'SQUARE' },
        ],
      });
    });

    res.json({ ok: true, message: 'Sample layout applied' });
  } catch (err) { next(err); }
});

// ─── Users ────────────────────────────────────────────────────────────────────

// GET /admin/restaurants/:id/users
router.get('/restaurants/:id/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
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
router.post('/restaurants/:id/users', validate(CreateUserSchema), async (req: Request, res: Response, next: NextFunction) => {
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
router.patch('/users/:id', validate(UpdateUserSchema), async (req: Request, res: Response, next: NextFunction) => {
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

export default router;
