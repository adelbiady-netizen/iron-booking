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

// Middleware factory: require minimum role level
const roleHierarchy: Record<UserRole, number> = {
  SUPER_ADMIN: 5,
  ADMIN: 4,
  MANAGER: 3,
  HOST: 2,
  SERVER: 1,
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
// SUPER_ADMIN bypasses this check — they can access any restaurant.
export function scopeToRestaurant(req: Request, res: Response, next: NextFunction): void {
  if (req.auth.role === 'SUPER_ADMIN') { next(); return; }
  const paramId = req.params.restaurantId ?? req.query.restaurantId;
  if (paramId && paramId !== req.auth.restaurantId) {
    next(new ForbiddenError('Cross-restaurant access denied'));
    return;
  }
  next();
}
