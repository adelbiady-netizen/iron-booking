import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { authenticate, requireRole } from '../../middleware/auth';
import { NotFoundError, ForbiddenError } from '../../lib/errors';

// Express 5 types req.params values as string | string[]; route params from
// :id patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

const router = Router();
router.use(authenticate);
router.use(requireRole('MANAGER'));

const CreateHostSchema = z.object({
  firstName:  z.string().min(1),
  lastName:   z.string().min(1),
  role:       z.enum(['HOST', 'SERVER', 'MANAGER']).default('HOST'),
  avatarUrl:  z.string().url().optional().nullable(),
  pin:        z.string().regex(/^\d{4}$/, 'PIN must be 4 digits').optional(),
});

const UpdateHostSchema = z.object({
  firstName:  z.string().min(1).optional(),
  lastName:   z.string().min(1).optional(),
  role:       z.enum(['HOST', 'SERVER', 'MANAGER']).optional(),
  avatarUrl:  z.string().url().optional().nullable(),
});

const SetPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

const SELECT = {
  id: true, firstName: true, lastName: true, role: true,
  avatarUrl: true, isActive: true, email: true, pin: true, createdAt: true,
} as const;

function hostShape(u: {
  id: string; firstName: string; lastName: string; role: string;
  avatarUrl: string | null; isActive: boolean; email: string | null;
  pin: string | null; createdAt: Date;
}) {
  return {
    id:        u.id,
    firstName: u.firstName,
    lastName:  u.lastName,
    role:      u.role,
    avatarUrl: u.avatarUrl,
    isActive:  u.isActive,
    email:     u.email,
    hasPin:    u.pin !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

// GET /hosts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { restaurantId: req.auth.restaurantId },
      select: SELECT,
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });
    res.json(users.map(hostShape));
  } catch (err) { next(err); }
});

// POST /hosts — create a PIN-only host (no email/password)
router.post('/', validate(CreateHostSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { firstName, lastName, role, avatarUrl, pin } = req.body;
    const pinHash = pin ? await bcrypt.hash(pin, 10) : null;

    const user = await prisma.user.create({
      data: {
        restaurantId: req.auth.restaurantId,
        firstName,
        lastName,
        role,
        avatarUrl:    avatarUrl ?? null,
        pin:          pinHash,
      },
      select: SELECT,
    });

    res.status(201).json(hostShape(user));
  } catch (err) { next(err); }
});

// PATCH /hosts/:id — update host details
router.patch('/:id', validate(UpdateHostSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = p(req, 'id');
    const existing = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth.restaurantId },
    });
    if (!existing) throw new NotFoundError('Host not found');
    if (existing.role === 'ADMIN' || existing.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Cannot modify admin accounts via this endpoint');
    }

    const { firstName, lastName, role, avatarUrl } = req.body;
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName  !== undefined && { lastName  }),
        ...(role      !== undefined && { role      }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
      select: SELECT,
    });

    res.json(hostShape(user));
  } catch (err) { next(err); }
});

// POST /hosts/:id/set-pin
router.post('/:id/set-pin', validate(SetPinSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = p(req, 'id');
    const existing = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth.restaurantId },
    });
    if (!existing) throw new NotFoundError('Host not found');

    const pinHash = await bcrypt.hash(req.body.pin, 10);
    const user = await prisma.user.update({
      where: { id },
      data:  { pin: pinHash },
      select: SELECT,
    });

    res.json(hostShape(user));
  } catch (err) { next(err); }
});

// PATCH /hosts/:id/active — toggle active status
router.patch('/:id/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = p(req, 'id');
    const existing = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth.restaurantId },
    });
    if (!existing) throw new NotFoundError('Host not found');
    if (existing.role === 'ADMIN' || existing.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Cannot modify admin accounts via this endpoint');
    }

    const user = await prisma.user.update({
      where: { id },
      data:  { isActive: !existing.isActive },
      select: SELECT,
    });

    res.json(hostShape(user));
  } catch (err) { next(err); }
});

// DELETE /hosts/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = p(req, 'id');
    const existing = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth.restaurantId },
    });
    if (!existing) throw new NotFoundError('Host not found');
    if (existing.role === 'ADMIN' || existing.role === 'SUPER_ADMIN') {
      throw new ForbiddenError('Cannot delete admin accounts via this endpoint');
    }
    if (existing.id === req.auth.userId) {
      throw new ForbiddenError('Cannot delete your own account');
    }

    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
