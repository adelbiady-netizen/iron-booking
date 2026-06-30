import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { PosIngestBodySchema } from './schema';
import { ingestEvents } from './service';

const router = Router();

// Shared-secret auth — different from JWT auth used by the rest of the API.
// Looks up PosConfig by pos_secret from the Bearer token.
async function authenticatePos(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;

  // Dev escape hatch: empty-string secret disables auth on both sides
  if (token === '') {
    (req as Request & { posRestaurantId: string }).posRestaurantId = '';
    next();
    return;
  }

  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Bearer token' });
    return;
  }

  const config = await prisma.posConfig.findFirst({ where: { posSecret: token } });
  if (!config) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid POS secret' });
    return;
  }

  (req as Request & { posRestaurantId: string }).posRestaurantId = config.restaurantId;
  next();
}

// POST /api/v1/events/ingest
// Called by ATLAS POS dispatcher on every state change.
router.post('/events/ingest', authenticatePos, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = (req as Request & { posRestaurantId: string }).posRestaurantId;

    const parsed = PosIngestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      // Return 200 with all events rejected — never 4xx for schema issues
      const ids = (req.body?.events ?? []).map((e: unknown) =>
        (e as Record<string, unknown>)?.event_id as string | undefined
      ).filter(Boolean) as string[];
      res.json({ accepted: [], rejected: ids.map(id => ({ event_id: id, reason: 'invalid_envelope' })) });
      return;
    }

    const result = await ingestEvents(restaurantId, parsed.data.events);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/pos/admin/attach — one-shot setup. Protected by POS_ADMIN_SECRET env var.
// Creates PosConfig, sends system.hospitality_attached to ATLAS, imports table directory.
// Can be removed after initial setup.
router.post('/pos/admin/attach', async (req: Request, res: Response) => {
  const adminSecret = process.env.POS_ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = z.object({
    restaurantId:      z.string().uuid(),
    atlasLocationId:   z.string().uuid(), // ATLAS's UUID for this restaurant (location_id in their events)
    posApiBase:        z.string().url(),
    hospitalityApiBase:z.string().url(),
    hospitalitySecret: z.string().min(1),
    posSecret:         z.string().min(1),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
    return;
  }

  const { restaurantId, atlasLocationId, posApiBase, hospitalityApiBase, hospitalitySecret, posSecret } = body.data;

  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) {
    res.status(404).json({ error: 'RESTAURANT_NOT_FOUND' });
    return;
  }

  // If another restaurant already owns this atlasLocationId, release it first.
  // This handles re-attachment to a different IB restaurant without a P2002 conflict.
  await prisma.posConfig.updateMany({
    where:  { atlasLocationId, NOT: { restaurantId } },
    data:   { atlasLocationId: null },
  });

  const existing = await prisma.posConfig.findUnique({ where: { restaurantId } });

  await prisma.posConfig.upsert({
    where:  { restaurantId },
    create: { restaurantId, atlasLocationId, posApiBase, posSecret, hospitalitySecret },
    update: { atlasLocationId, posApiBase, posSecret, hospitalitySecret },
  });

  const displaced = existing?.atlasLocationId && existing.atlasLocationId !== atlasLocationId
    ? existing.atlasLocationId : null;

  // Send system.hospitality_attached to ATLAS.
  // brand_id and location_id MUST be ATLAS's own UUID for this restaurant.
  const attachEvent = {
    events: [{
      envelope_version: 1,
      event_id:  randomUUID(),
      type:      'system.hospitality_attached',
      version:   1,
      occurred_at:  new Date().toISOString(),
      source:    'hospitality',
      brand_id:  atlasLocationId,
      location_id: atlasLocationId,
      visit_id:  null,
      sequence:  1,
      causation_id: null,
      payload: {
        hospitality_instance_id: restaurantId,
        hospitality_api_base:    hospitalityApiBase,
        pos_api_base:            posApiBase,
        pos_secret:              posSecret,
        attached_at:             new Date().toISOString(),
      },
    }],
  };

  const atlasRes = await fetch(`${posApiBase}/api/v1/events/ingest`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalitySecret}` },
    body:    JSON.stringify(attachEvent),
  });

  const atlasBody = atlasRes.ok ? await atlasRes.json() : null;

  await prisma.posConfig.update({
    where: { restaurantId },
    data:  { attachedAt: new Date() },
  });

  // Fetch table directory from ATLAS and write atlasTableId
  type AtlasTable = { table_id: string; number: string; name: string | null; section: string; capacity: number; active: boolean };
  let tableSync: { matched: number; skipped: number; tables?: AtlasTable[] } = { matched: 0, skipped: 0 };

  try {
    const dirRes = await fetch(
      `${posApiBase}/api/v1/hospitality/table-directory?location_id=${atlasLocationId}`,
      { headers: { Authorization: `Bearer ${hospitalitySecret}` } }
    );

    if (dirRes.ok) {
      const dir = await dirRes.json() as { tables: AtlasTable[] };
      tableSync.tables = dir.tables;
      const ironTables = await prisma.table.findMany({ where: { restaurantId } });

      for (const at of dir.tables) {
        if (!at.active) continue;
        const label = at.name ?? at.number;
        const iron = ironTables.find(t =>
          t.name === label ||
          t.name === at.number ||
          t.name === `T${at.number}` ||
          t.name.replace(/\s+/g, '') === label.replace(/\s+/g, '')
        );
        if (!iron) { tableSync.skipped++; continue; }
        await prisma.table.update({ where: { id: iron.id }, data: { atlasTableId: at.table_id } });
        tableSync.matched++;
      }
    }
  } catch (_e) {
    // table directory sync is best-effort
  }

  res.json({
    ok: true,
    restaurant: restaurant.name,
    atlas: { status: atlasRes.status, body: atlasBody },
    tableSync: { matched: tableSync.matched, skipped: tableSync.skipped, total: tableSync.tables?.length ?? 0 },
    ...(displaced ? { displaced: { previousAtlasLocationId: displaced } } : {}),
  });
});

// GET /api/v1/pos/admin/status — returns current pos_config rows. Protected by POS_ADMIN_SECRET.
router.get('/pos/admin/status', async (req: Request, res: Response) => {
  const adminSecret = process.env.POS_ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const rows = await prisma.$queryRaw<Array<{
    id: string; restaurant_id: string; restaurant_name: string; slug: string;
    atlas_location_id: string | null; pos_api_base: string; attached_at: Date | null;
  }>>`
    SELECT pc.id::text, pc.restaurant_id::text, r.name AS restaurant_name, r.slug,
           pc.atlas_location_id::text, pc.pos_api_base, pc.attached_at
    FROM pos_config pc
    LEFT JOIN restaurants r ON r.id = pc.restaurant_id
    ORDER BY pc.created_at
  `;

  res.json({ rows });
});

export default router;
