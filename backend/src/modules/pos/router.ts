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
      const dir = await dirRes.json() as { data: { tables: AtlasTable[] } } | { tables: AtlasTable[] };
      const tables = ('data' in dir ? dir.data.tables : dir.tables) ?? [];
      tableSync.tables = tables;
      const ironTables = await prisma.table.findMany({ where: { restaurantId } });

      for (const at of tables) {
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

// PATCH /api/v1/pos/admin/patch-config
// Restores a null atlasLocationId on an existing PosConfig without re-triggering
// the full attach flow or displacing other restaurants.
// Use when the displace logic orphaned a restaurant's atlasLocationId.
router.patch('/pos/admin/patch-config', async (req: Request, res: Response) => {
  const adminSecret = process.env.POS_ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = z.object({
    restaurantId:    z.string().uuid(),
    atlasLocationId: z.string().uuid(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
    return;
  }

  const { restaurantId, atlasLocationId } = body.data;

  const config = await prisma.posConfig.findUnique({ where: { restaurantId } });
  if (!config) {
    res.status(404).json({ error: 'NO_POS_CONFIG', message: 'No PosConfig found for this restaurant. Run /attach first.' });
    return;
  }

  // Guard: reject if another restaurant already owns this atlasLocationId.
  const conflict = await prisma.posConfig.findFirst({
    where: { atlasLocationId, NOT: { restaurantId } },
  });
  if (conflict) {
    res.status(409).json({
      error: 'ATLAS_LOCATION_CONFLICT',
      message: `atlasLocationId is already owned by restaurantId=${conflict.restaurantId}. Release it there first.`,
    });
    return;
  }

  await prisma.posConfig.update({
    where: { restaurantId },
    data:  { atlasLocationId, atlasBrandId: atlasLocationId },
  });

  res.json({ ok: true, restaurantId, atlasLocationId });
});

// POST /api/v1/pos/admin/release-config
// Clears atlasLocationId (and atlasBrandId) on a PosConfig row so the ATLAS location
// can be re-assigned to another restaurant via patch-config. No ATLAS events fired.
router.post('/pos/admin/release-config', async (req: Request, res: Response) => {
  const adminSecret = process.env.POS_ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = z.object({
    restaurantId: z.string().uuid(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
    return;
  }

  const { restaurantId } = body.data;

  const config = await prisma.posConfig.findUnique({ where: { restaurantId } });
  if (!config) {
    res.status(404).json({ error: 'NO_POS_CONFIG' });
    return;
  }

  const prev = config.atlasLocationId;
  await prisma.posConfig.update({
    where: { restaurantId },
    data:  { atlasLocationId: null, atlasBrandId: null },
  });

  res.json({ ok: true, restaurantId, released: prev });
});

// POST /api/v1/pos/admin/resync-tables
// Sends system.table_directory_sync to ATLAS for a given restaurant.
// ATLAS processes the table list and queues a pos.table_directory_ack event containing
// the authoritative ibTableId → atlasTableUUID mapping. The iron-booking ingest handler
// picks it up and updates Table.atlasTableId for every matched table.
// Run this once after deploy to repopulate any null/stale atlasTableId values.
router.post('/pos/admin/resync-tables', async (req: Request, res: Response) => {
  const adminSecret = process.env.POS_ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = z.object({ restaurantId: z.string().uuid() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
    return;
  }

  const { restaurantId } = body.data;

  const config = await prisma.posConfig.findUnique({ where: { restaurantId } });
  if (!config?.atlasLocationId) {
    res.status(404).json({ error: 'NO_POS_CONFIG', message: 'No ATLAS connection configured for this restaurant.' });
    return;
  }

  const tables = await prisma.table.findMany({
    where:   { restaurantId },
    include: { section: true },
    orderBy: { name: 'asc' },
  });

  const directoryVersion = Math.floor(Date.now() / 1000);

  const syncEvent = {
    events: [{
      envelope_version: 1,
      event_id:    randomUUID(),
      type:        'system.table_directory_sync',
      version:     1,
      occurred_at: new Date().toISOString(),
      source:      'hospitality',
      brand_id:    config.atlasLocationId,
      location_id: config.atlasLocationId,
      visit_id:    null,
      sequence:    1,
      causation_id: null,
      payload: {
        directory_version: directoryVersion,
        published_at:      new Date().toISOString(),
        tables: tables.map(t => ({
          table_id:           t.id,
          number:             t.name,
          name:               t.name,
          zone:               t.section?.name ?? 'Main',
          section:            t.section?.name ?? '',
          capacity:           t.maxCovers,
          active:             t.isActive,
          combined_table_ids: [] as string[],
        })),
      },
    }],
  };

  let atlasStatus: number;
  let atlasBody: unknown;
  try {
    const atlasRes = await fetch(`${config.posApiBase}/api/v1/events/ingest`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.hospitalitySecret}` },
      body:    JSON.stringify(syncEvent),
    });
    atlasStatus = atlasRes.status;
    atlasBody   = atlasRes.ok ? await atlasRes.json() : null;
  } catch (err) {
    res.status(502).json({ error: 'ATLAS_UNREACHABLE', message: String(err) });
    return;
  }

  res.json({
    ok:               atlasStatus >= 200 && atlasStatus < 300,
    directoryVersion,
    tablesSent:       tables.length,
    atlas:            { status: atlasStatus, body: atlasBody },
    note:             'ATLAS will queue pos.table_directory_ack and deliver it to /api/v1/events/ingest within ~5 s. Table.atlasTableId values will be updated automatically on receipt.',
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

// GET /api/v1/pos/admin/outbox — recent outbox rows. Protected by POS_ADMIN_SECRET.
router.get('/pos/admin/outbox', async (req: Request, res: Response) => {
  const adminSecret = process.env.POS_ADMIN_SECRET;
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' }); return;
  }
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, restaurant_id::text, visit_id::text, event_type,
           status, attempts, last_error,
           created_at, last_attempt_at, delivered_at
    FROM pos_outbox
    ORDER BY created_at DESC
    LIMIT 20
  `;
  res.json({ rows });
});

export default router;
