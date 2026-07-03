/**
 * Management Workspace router (Mission P0.1) — mounted at /api/management.
 *
 * Isolated from the HQ admin router. P0.1 exposes only the boot context; business
 * endpoints arrive with their modules (P0.3+), each behind its own capability.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireCapability } from '../../middleware/capability';
import { buildManagementContext } from './service';

const router = Router();

// GET /api/management/context — the workspace boot read (own restaurant only).
router.get(
  '/context',
  authenticate,
  requireCapability('management.access'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await buildManagementContext({
        role: req.auth.role,
        restaurantId: req.auth.restaurantId,
      });
      res.json(ctx);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
