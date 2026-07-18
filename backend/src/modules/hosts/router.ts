import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { authenticate, requireRole, roleLevel } from '../../middleware/auth';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { UserRole } from '@prisma/client';
import { writeHostAudit } from '../../lib/hostAudit';

// Express 5 types req.params values as string | string[]; route params from
// :id patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

// Anti-escalation invariant: a user may not create, assign, or act on a role
// higher than their own. This is the one hierarchy line kept even though team
// management is otherwise open to any authenticated Host-app user — without it
// a floor host could mint (or seize) a manager-level account and self-escalate.
function assertNotAbove(req: Request, targetRole: string, verb = 'לפעול על'): void {
  if (roleLevel(targetRole as UserRole) > roleLevel(req.auth.role)) {
    throw new ForbiddenError(`אין הרשאה ${verb} משתמש בדרגה גבוהה משלך`);
  }
}

const router = Router();
// Team management is a Restaurant Manager / Owner operation (an operational
// management decision, not something every floor host should do). requireRole
// is a minimum-level gate, so MANAGER and every role above it are admitted;
// HOST and SERVER are not. The anti-escalation guard above further restricts
// managers from acting on anyone ranked above themselves.
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
    assertNotAbove(req, role, 'ליצור');
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

    writeHostAudit(req.auth, 'team.host.created', {
      targetUserId: user.id, firstName, lastName, role,
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
    assertNotAbove(req, existing.role);

    const { firstName, lastName, role, avatarUrl } = req.body;
    if (role !== undefined) assertNotAbove(req, role, 'להעניק דרגת');
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

    writeHostAudit(req.auth, 'team.host.updated', {
      targetUserId: id,
      changes: {
        ...(firstName !== undefined && existing.firstName !== firstName && { firstName: { from: existing.firstName, to: firstName } }),
        ...(lastName  !== undefined && existing.lastName  !== lastName  && { lastName:  { from: existing.lastName,  to: lastName  } }),
        ...(role      !== undefined && existing.role      !== role      && { role:      { from: existing.role,      to: role      } }),
      },
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
    assertNotAbove(req, existing.role);

    const pinHash = await bcrypt.hash(req.body.pin, 10);
    const user = await prisma.user.update({
      where: { id },
      data:  { pin: pinHash },
      select: SELECT,
    });

    // Audit the reset — never log the PIN value itself.
    writeHostAudit(req.auth, 'team.host.pin_reset', { targetUserId: id });
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
    assertNotAbove(req, existing.role);
    if (existing.id === req.auth.userId) {
      throw new ForbiddenError('Cannot disable your own account');
    }

    const user = await prisma.user.update({
      where: { id },
      data:  { isActive: !existing.isActive },
      select: SELECT,
    });

    writeHostAudit(req.auth, 'team.host.active_changed', {
      targetUserId: id, from: existing.isActive, to: !existing.isActive,
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
    assertNotAbove(req, existing.role);
    if (existing.id === req.auth.userId) {
      throw new ForbiddenError('Cannot delete your own account');
    }

    await prisma.user.delete({ where: { id } });
    writeHostAudit(req.auth, 'team.host.deleted', {
      targetUserId: id, firstName: existing.firstName, lastName: existing.lastName, role: existing.role,
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
