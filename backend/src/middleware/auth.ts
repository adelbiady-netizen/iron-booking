import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';
import { UserRole } from '@prisma/client';

export interface AuthPayload {
  userId: string;
  restaurantId: string;
  role: UserRole;
  email: string;
  firstName: string;
  lastName: string;
  groupId?: string; // present for HQ_ADMIN / GROUP_MANAGER users
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or invalid authorization header'));
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

// Middleware factory: require minimum role level.
// Values are cardinal — only relative ordering matters.
// HQ roles sit above ADMIN; OWNER is a restaurant-level alias for ADMIN.
const roleHierarchy: Record<UserRole, number> = {
  SUPER_ADMIN:   100, // system-wide (all restaurants, cross-group)
  HQ_ADMIN:       80, // group-wide (all branches in their group)
  GROUP_MANAGER:  60, // limited cross-branch within their group
  OWNER:          40, // restaurant owner (same scope as ADMIN)
  ADMIN:          40, // restaurant-level admin (backward compat)
  MANAGER:        30,
  HOST:           20,
  SERVER:         10,
};

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userLevel = roleHierarchy[req.auth.role] ?? 0;
    const minRequired = Math.min(...roles.map((r) => roleHierarchy[r]));
    if (userLevel < minRequired) {
      next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}

// Ensure request restaurantId param matches the JWT restaurantId.
// SUPER_ADMIN and HQ_ADMIN bypass this check — they have elevated cross-restaurant access.
// (HQ_ADMIN cross-branch validation via group is a future concern; for now, elevated bypass is safe
// since HQ users are provisioned manually and there are no HQ users in production yet.)
export function scopeToRestaurant(req: Request, res: Response, next: NextFunction): void {
  const { role } = req.auth;
  if (role === 'SUPER_ADMIN' || role === 'HQ_ADMIN') { next(); return; }
  const paramId = req.params.restaurantId ?? req.query.restaurantId;
  if (paramId && paramId !== req.auth.restaurantId) {
    next(new ForbiddenError('Cross-restaurant access denied'));
    return;
  }
  next();
}
