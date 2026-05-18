// ─── Guest Hub public router ──────────────────────────────────────────────────
// Mounted at /api/public/hub in app.ts.
// All routes are unauthenticated and read-only.
//
// ISOLATION: No JWT middleware, no reservation/waitlist/floor imports.
//            Removing Guest Hub: delete features/guestHub/ (frontend) and
//            guestHub/ (backend), and revert the app.ts mount line.

import { Router, Request, Response, NextFunction } from 'express';
import { getHubBySlug, resolveQrToken } from './service';

const router = Router();

// ─── GET /api/public/hub/q/:token ────────────────────────────────────────────
// Resolves a stable QR token to its current hub slug.
// Must be registered BEFORE /:slug to avoid the wildcard swallowing /q/* paths.
// Frontend performs the slug redirect — keeping redirect logic in JS avoids
// HTTP redirect caching surprises when slugs change.
router.get('/q/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.params['token'] === 'string' ? req.params['token'].trim() : '';
    if (!token) {
      return res.status(400).json({ error: { code: 'MISSING_PARAM', message: 'token is required' } });
    }

    const slug = await resolveQrToken(token);
    if (!slug) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'QR token not found or inactive' } });
    }

    return res.json({ slug });
  } catch (err) { next(err); }
});

// ─── GET /api/public/hub/:slug ────────────────────────────────────────────────
// Full hub payload: branding, menus, featured dishes, promotions, events, links.
// Suitable for edge caching — no user-specific data.
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.params['slug'] === 'string' ? req.params['slug'].trim() : '';
    if (!slug) {
      return res.status(400).json({ error: { code: 'MISSING_PARAM', message: 'slug is required' } });
    }

    const hub = await getHubBySlug(slug);
    if (!hub) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Hub not found' } });
    }

    // Allow CDN/browser to cache for 60 s; revalidate in background.
    // Tighten or remove once real-time updates (webhooks) are wired up.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('X-Hub-Deploy', 'c8fc7f45');
    return res.json(hub);
  } catch (err) { next(err); }
});

export default router;
