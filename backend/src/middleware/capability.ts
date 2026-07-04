/**
 * Capability guard for the Management Workspace (Mission P0.1).
 *
 * HQ tiers (SUPER_ADMIN / HQ_ADMIN) bypass — they manage across restaurants and
 * are scoped elsewhere. Restaurant roles must hold the capability for their role.
 * Backend is the authoritative gate; the frontend only mirrors this for UX.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { hasCapability, canAccessManagement, type Capability } from '../lib/capabilities';

export function requireCapability(cap: Capability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }
    if (role === 'SUPER_ADMIN' || role === 'HQ_ADMIN') {
      next();
      return;
    }
    if (hasCapability(role, cap)) {
      next();
      return;
    }
    next(new ForbiddenError(`Missing capability: ${cap}`));
  };
}

/**
 * Authoritative Management Center entry gate — honors the per-user grant.
 * HQ + owner tier pass without a DB hit; MANAGER is allowed only when their
 * User.managementAccess is true; HOST/SERVER are always blocked. Real-time:
 * a revoked grant blocks on the very next request (no re-login needed).
 */
export async function requireManagementAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const role = req.auth?.role;
    if (!role) { next(new UnauthorizedError('Not authenticated')); return; }
    // Fast path: roles that never depend on the per-user grant.
    if (canAccessManagement(role, false)) { next(); return; }
    if (role === 'MANAGER') {
      const u = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { managementAccess: true } });
      if (u?.managementAccess) { next(); return; }
    }
    next(new ForbiddenError('Missing management access'));
  } catch (err) { next(err as Error); }
}
