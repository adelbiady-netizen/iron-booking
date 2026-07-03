/**
 * Capability guard for the Management Workspace (Mission P0.1).
 *
 * HQ tiers (SUPER_ADMIN / HQ_ADMIN) bypass — they manage across restaurants and
 * are scoped elsewhere. Restaurant roles must hold the capability for their role.
 * Backend is the authoritative gate; the frontend only mirrors this for UX.
 */

import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { hasCapability, type Capability } from '../lib/capabilities';

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
