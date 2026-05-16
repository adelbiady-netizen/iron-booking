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
  publishHub,
  activateHub,
  deactivateHub,
  provisionHub,
} from './adminService';
import { getHubDraftBySlug } from './service';
import {
  getMenuTree,
  createCategory,
  updateCategory,
  createDish,
  updateDish,
} from './menuAdminService';
import {
  listTokens,
  createToken,
  updateToken,
  deactivateToken,
  reactivateToken,
} from './tokenAdminService';

const router = Router();

router.use(authenticate);
router.use(requireRole('MANAGER'));

// ── GET /api/admin/hub/preview/:slug ─────────────────────────────────────────
// Returns draft hub content (branding + social links) for preview before publish.
// Uses slug (not restaurantId) so preview URLs are bookmarkable.
// Must be defined before /:restaurantId to avoid the slug being consumed as restaurantId.
router.get('/preview/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getHubDraftBySlug(String(req.params['slug']));
    if (!data) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Hub not found' },
      });
    }
    return res.json(data);
  } catch (err) { next(err); }
});

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

// ── POST /api/admin/hub/:restaurantId/activate ────────────────────────────────
// Sets publicStatus = PUBLISHED, making /r/:slug visible to guests.
// Requires published branding. Idempotent: re-activates INACTIVE hubs too.
router.post('/:restaurantId/activate', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await activateHub(String(req.params['restaurantId']));
    return res.json(hub);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/deactivate ──────────────────────────────
// Sets publicStatus = INACTIVE, taking /r/:slug offline without deleting data.
router.post('/:restaurantId/deactivate', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await deactivateHub(String(req.params['restaurantId']));
    return res.json(hub);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/provision ───────────────────────────────
// Idempotent: creates GuestHub + branding + menu + QR token for a restaurant.
// Returns existing hub without modification if already configured.
// Hub starts in draft — not published. Admin must review and click Publish.
router.post('/:restaurantId/provision', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await provisionHub(String(req.params['restaurantId']));
    return res.json(hub);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/publish ─────────────────────────────────
// Atomically copies draft branding + social links to the published tables.
// 422 when no branding draft exists.
router.post('/:restaurantId/publish', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' },
      });
    }
    const result = await publishHub(hub.id, req.auth);
    return res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/admin/hub/:restaurantId/menu ──────────────────────────────────────
// Returns the full menu tree (menus → categories → dishes).
router.get('/:restaurantId/menu', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' } });
    }
    const tree = await getMenuTree(hub.id);
    return res.json(tree);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/menu/categories ─────────────────────────
router.post('/:restaurantId/menu/categories', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[DIAG 8] POST /menu/categories hit — restaurantId:', req.params['restaurantId'], 'body:', JSON.stringify(req.body));
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' } });
    }
    console.log('[DIAG 9] hub resolved — hubId:', hub.id, 'body to createCategory:', JSON.stringify(req.body));
    const category = await createCategory(hub.id, req.body as Record<string, unknown>);
    console.log('[DIAG 9] createCategory returned — id:', (category as { id?: string }).id);
    return res.status(201).json(category);
  } catch (err) {
    console.error('[DIAG 9] createCategory threw:', err);
    next(err);
  }
});

// ── PATCH /api/admin/hub/:restaurantId/menu/categories/:categoryId ────────────
router.patch('/:restaurantId/menu/categories/:categoryId', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' } });
    }
    const category = await updateCategory(hub.id, String(req.params['categoryId']), req.body as Record<string, unknown>);
    return res.json(category);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/menu/categories/:categoryId/dishes ──────
router.post('/:restaurantId/menu/categories/:categoryId/dishes', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' } });
    }
    const dish = await createDish(hub.id, String(req.params['categoryId']), req.body as Record<string, unknown>);
    return res.status(201).json(dish);
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/hub/:restaurantId/menu/categories/:categoryId/dishes/:dishId
router.patch('/:restaurantId/menu/categories/:categoryId/dishes/:dishId', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hub = await getHubForRestaurant(String(req.params['restaurantId']));
    if (!hub) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No Guest Hub configured for this restaurant' } });
    }
    const dish = await updateDish(hub.id, String(req.params['categoryId']), String(req.params['dishId']), req.body as Record<string, unknown>);
    return res.json(dish);
  } catch (err) { next(err); }
});

// ── QR Token management ───────────────────────────────────────────────────────
// hubId is derived server-side from restaurantId — never accepted from client.
// Token string is immutable once created; only label/metadata are mutable.

// ── GET /api/admin/hub/:restaurantId/tokens ────────────────────────────────────
router.get('/:restaurantId/tokens', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await listTokens(String(req.params['restaurantId']));
    return res.json({ tokens });
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/tokens ───────────────────────────────────
// Creates a new token. Token string is generated server-side.
// Body: { label?: string, metadata?: { tableName?, zone?, campaign?, source? } }
router.post('/:restaurantId/tokens', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await createToken(String(req.params['restaurantId']), req.body as Record<string, unknown>);
    return res.status(201).json(token);
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/hub/:restaurantId/tokens/:tokenId ────────────────────────
// Updates label and/or metadata. Token string is immutable — printed QRs are safe.
router.patch('/:restaurantId/tokens/:tokenId', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await updateToken(
      String(req.params['restaurantId']),
      String(req.params['tokenId']),
      req.body as Record<string, unknown>,
    );
    return res.json(token);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/tokens/:tokenId/deactivate ──────────────
// Stops QR resolution — any printed card pointing to this token returns 404.
router.post('/:restaurantId/tokens/:tokenId/deactivate', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await deactivateToken(
      String(req.params['restaurantId']),
      String(req.params['tokenId']),
    );
    return res.json(token);
  } catch (err) { next(err); }
});

// ── POST /api/admin/hub/:restaurantId/tokens/:tokenId/reactivate ──────────────
// Restores QR resolution — existing printed cards start working again.
router.post('/:restaurantId/tokens/:tokenId/reactivate', scopeToRestaurant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await reactivateToken(
      String(req.params['restaurantId']),
      String(req.params['tokenId']),
    );
    return res.json(token);
  } catch (err) { next(err); }
});

export default router;
