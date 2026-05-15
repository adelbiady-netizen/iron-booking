// ─── Guest Hub admin router ────────────────────────────────────────────────────
// Mounted at /api/admin/hub in app.ts.
// All routes require authentication and at least MANAGER role.
// scopeToRestaurant enforces restaurant-scoping for non-SUPER_ADMIN/HQ_ADMIN callers.
//
// ISOLATION: No reservation, waitlist, floor, or SSE imports.

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole, scopeToRestaurant } from '../../middleware/auth';
import {
  getHubForRestaurant,
  upsertHubBranding,
  replaceHubSocialLinks,
} from './adminService';

const router = Router();

router.use(authenticate);
router.use(requireRole('MANAGER'));

// ── GET /api/admin/hub/:restaurantId ──────────────────────────────────────────
// Returns the hub (branding + social links) for a restaurant.
// 404 when no hub is linked to this restaurant.
router.get('/:restaurantId', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' },
      });
    }
    return res.json(hub);
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/hub/:restaurantId/branding ────────────────────────────────
// Upserts branding fields. Creates the branding record on first save.
// Required body: { name, tagline?, phone?, address?, logoUrl?, coverImageUrl? }
router.patch('/:restaurantId/branding', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' },
      });
    }
    const updated = await upsertHubBranding(hub.id, req.body as Record<string, unknown>, req.auth);
    return res.json(updated);
  } catch (err) { next(err); }
});

// ── PUT /api/admin/hub/:restaurantId/social ────────────────────────────────────
// Atomically replaces all social links. Pass an empty array to clear all links.
// Required body: { links: Array<{ platform, handle }> }
router.put('/:restaurantId/social', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' },
      });
    }
    const links = Array.isArray((req.body as Record<string, unknown>).links)
      ? (req.body as Record<string, unknown>).links
      : [];
    const updated = await replaceHubSocialLinks(hub.id, links, req.auth);
    return res.json({ links: updated });
  } catch (err) { next(err); }
});

export default router;
