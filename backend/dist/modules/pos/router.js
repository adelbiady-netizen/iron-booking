"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const crypto_1 = require("crypto");
const prisma_1 = require("../../lib/prisma");
const schema_1 = require("./schema");
const service_1 = require("./service");
const router = (0, express_1.Router)();
// Shared-secret auth — different from JWT auth used by the rest of the API.
// Looks up PosConfig by pos_secret from the Bearer token.
async function authenticatePos(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    // Dev escape hatch: empty-string secret disables auth on both sides
    if (token === '') {
        req.posRestaurantId = '';
        next();
        return;
    }
    if (!token) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Bearer token' });
        return;
    }
    const config = await prisma_1.prisma.posConfig.findFirst({ where: { posSecret: token } });
    if (!config) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid POS secret' });
        return;
    }
    req.posRestaurantId = config.restaurantId;
    next();
}
// POST /api/v1/events/ingest
// Called by ATLAS POS dispatcher on every state change.
router.post('/events/ingest', authenticatePos, async (req, res, next) => {
    try {
        const restaurantId = req.posRestaurantId;
        const parsed = schema_1.PosIngestBodySchema.safeParse(req.body);
        if (!parsed.success) {
            // Return 200 with all events rejected — never 4xx for schema issues
            const ids = (req.body?.events ?? []).map((e) => e?.event_id).filter(Boolean);
            res.json({ accepted: [], rejected: ids.map(id => ({ event_id: id, reason: 'invalid_envelope' })) });
            return;
        }
        const result = await (0, service_1.ingestEvents)(restaurantId, parsed.data.events);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /api/v1/pos/admin/attach — one-shot setup. Protected by POS_ADMIN_SECRET env var.
// Creates PosConfig, sends system.hospitality_attached to ATLAS, imports table directory.
// Can be removed after initial setup.
router.post('/pos/admin/attach', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const body = zod_1.z.object({
        restaurantId: zod_1.z.string().uuid(),
        atlasLocationId: zod_1.z.string().uuid(), // ATLAS's UUID for this restaurant (location_id in their events)
        posApiBase: zod_1.z.string().url(),
        hospitalityApiBase: zod_1.z.string().url(),
        hospitalitySecret: zod_1.z.string().min(1),
        posSecret: zod_1.z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
        return;
    }
    const { restaurantId, atlasLocationId, posApiBase, hospitalityApiBase, hospitalitySecret, posSecret } = body.data;
    const restaurant = await prisma_1.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) {
        res.status(404).json({ error: 'RESTAURANT_NOT_FOUND' });
        return;
    }
    // If another restaurant already owns this atlasLocationId, release it first.
    // This handles re-attachment to a different IB restaurant without a P2002 conflict.
    await prisma_1.prisma.posConfig.updateMany({
        where: { atlasLocationId, NOT: { restaurantId } },
        data: { atlasLocationId: null },
    });
    const existing = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId } });
    await prisma_1.prisma.posConfig.upsert({
        where: { restaurantId },
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
                event_id: (0, crypto_1.randomUUID)(),
                type: 'system.hospitality_attached',
                version: 1,
                occurred_at: new Date().toISOString(),
                source: 'hospitality',
                brand_id: atlasLocationId,
                location_id: atlasLocationId,
                visit_id: null,
                sequence: 1,
                causation_id: null,
                payload: {
                    hospitality_instance_id: restaurantId,
                    hospitality_api_base: hospitalityApiBase,
                    pos_api_base: posApiBase,
                    pos_secret: posSecret,
                    attached_at: new Date().toISOString(),
                },
            }],
    };
    const atlasRes = await fetch(`${posApiBase}/api/v1/events/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hospitalitySecret}` },
        body: JSON.stringify(attachEvent),
    });
    const atlasBody = atlasRes.ok ? await atlasRes.json() : null;
    await prisma_1.prisma.posConfig.update({
        where: { restaurantId },
        data: { attachedAt: new Date() },
    });
    let tableSync = { matched: 0, skipped: 0 };
    try {
        const dirRes = await fetch(`${posApiBase}/api/v1/hospitality/table-directory?location_id=${atlasLocationId}`, { headers: { Authorization: `Bearer ${hospitalitySecret}` } });
        if (dirRes.ok) {
            const dir = await dirRes.json();
            const tables = ('data' in dir ? dir.data.tables : dir.tables) ?? [];
            tableSync.tables = tables;
            const ironTables = await prisma_1.prisma.table.findMany({ where: { restaurantId } });
            for (const at of tables) {
                if (!at.active)
                    continue;
                const label = at.name ?? at.number;
                const iron = ironTables.find(t => t.name === label ||
                    t.name === at.number ||
                    t.name === `T${at.number}` ||
                    t.name.replace(/\s+/g, '') === label.replace(/\s+/g, ''));
                if (!iron) {
                    tableSync.skipped++;
                    continue;
                }
                await prisma_1.prisma.table.update({ where: { id: iron.id }, data: { atlasTableId: at.table_id } });
                tableSync.matched++;
            }
        }
    }
    catch (_e) {
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
router.patch('/pos/admin/patch-config', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const body = zod_1.z.object({
        restaurantId: zod_1.z.string().uuid(),
        atlasLocationId: zod_1.z.string().uuid().optional(),
        hospitalitySecret: zod_1.z.string().min(1).optional(),
        posApiBase: zod_1.z.string().url().optional(),
    }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
        return;
    }
    const { restaurantId, atlasLocationId, hospitalitySecret, posApiBase } = body.data;
    if (!atlasLocationId && !hospitalitySecret && !posApiBase) {
        res.status(400).json({ error: 'INVALID_BODY', message: 'Provide at least one of: atlasLocationId, hospitalitySecret, posApiBase.' });
        return;
    }
    const config = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId } });
    if (!config) {
        res.status(404).json({ error: 'NO_POS_CONFIG', message: 'No PosConfig found for this restaurant. Run /attach first.' });
        return;
    }
    if (atlasLocationId) {
        // Guard: reject if another restaurant already owns this atlasLocationId.
        const conflict = await prisma_1.prisma.posConfig.findFirst({
            where: { atlasLocationId, NOT: { restaurantId } },
        });
        if (conflict) {
            res.status(409).json({
                error: 'ATLAS_LOCATION_CONFLICT',
                message: `atlasLocationId is already owned by restaurantId=${conflict.restaurantId}. Release it there first.`,
            });
            return;
        }
    }
    await prisma_1.prisma.posConfig.update({
        where: { restaurantId },
        data: {
            ...(atlasLocationId ? { atlasLocationId, atlasBrandId: atlasLocationId } : {}),
            ...(hospitalitySecret ? { hospitalitySecret } : {}),
            ...(posApiBase ? { posApiBase } : {}),
        },
    });
    res.json({
        ok: true,
        restaurantId,
        updated: {
            ...(atlasLocationId ? { atlasLocationId } : {}),
            ...(hospitalitySecret ? { hospitalitySecret: hospitalitySecret.slice(0, 6) + '...' } : {}),
            ...(posApiBase ? { posApiBase } : {}),
        },
    });
});
// POST /api/v1/pos/admin/release-config
// Clears atlasLocationId (and atlasBrandId) on a PosConfig row so the ATLAS location
// can be re-assigned to another restaurant via patch-config. No ATLAS events fired.
router.post('/pos/admin/release-config', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const body = zod_1.z.object({
        restaurantId: zod_1.z.string().uuid(),
    }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
        return;
    }
    const { restaurantId } = body.data;
    const config = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId } });
    if (!config) {
        res.status(404).json({ error: 'NO_POS_CONFIG' });
        return;
    }
    const prev = config.atlasLocationId;
    await prisma_1.prisma.posConfig.update({
        where: { restaurantId },
        data: { atlasLocationId: null, atlasBrandId: null },
    });
    res.json({ ok: true, restaurantId, released: prev });
});
// POST /api/v1/pos/admin/resync-tables
// Sends system.table_directory_sync to ATLAS for a given restaurant.
// ATLAS processes the table list and queues a pos.table_directory_ack event containing
// the authoritative ibTableId → atlasTableUUID mapping. The iron-booking ingest handler
// picks it up and updates Table.atlasTableId for every matched table.
// Run this once after deploy to repopulate any null/stale atlasTableId values.
// POST /api/v1/pos/admin/copy-hospitality-secret
// Copies hospitalitySecret from one PosConfig row to another without exposing the value.
// Use when the donor row's secret is what ATLAS currently expects for a given location
// (i.e. the last attach event for that location used the donor's secret).
router.post('/pos/admin/copy-hospitality-secret', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const body = zod_1.z.object({
        fromRestaurantId: zod_1.z.string().uuid(),
        toRestaurantId: zod_1.z.string().uuid(),
    }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
        return;
    }
    const { fromRestaurantId, toRestaurantId } = body.data;
    const donor = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId: fromRestaurantId } });
    if (!donor) {
        res.status(404).json({ error: 'DONOR_NOT_FOUND' });
        return;
    }
    const target = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId: toRestaurantId } });
    if (!target) {
        res.status(404).json({ error: 'TARGET_NOT_FOUND' });
        return;
    }
    await prisma_1.prisma.posConfig.update({
        where: { restaurantId: toRestaurantId },
        data: { hospitalitySecret: donor.hospitalitySecret },
    });
    res.json({
        ok: true,
        fromRestaurantId,
        toRestaurantId,
        hospitalitySecretHint: donor.hospitalitySecret.slice(0, 6) + '...',
    });
});
// POST /api/v1/pos/admin/resync-tables
router.post('/pos/admin/resync-tables', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const body = zod_1.z.object({ restaurantId: zod_1.z.string().uuid() }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: 'INVALID_BODY', issues: body.error.issues });
        return;
    }
    const { restaurantId } = body.data;
    const config = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId } });
    if (!config?.atlasLocationId) {
        res.status(404).json({ error: 'NO_POS_CONFIG', message: 'No ATLAS connection configured for this restaurant.' });
        return;
    }
    const tables = await prisma_1.prisma.table.findMany({
        where: { restaurantId },
        include: { section: true },
        orderBy: { name: 'asc' },
    });
    const directoryVersion = Math.floor(Date.now() / 1000);
    const syncEvent = {
        events: [{
                envelope_version: 1,
                event_id: (0, crypto_1.randomUUID)(),
                type: 'system.table_directory_sync',
                version: 1,
                occurred_at: new Date().toISOString(),
                source: 'hospitality',
                brand_id: config.atlasLocationId,
                location_id: config.atlasLocationId,
                visit_id: null,
                sequence: 1,
                causation_id: null,
                payload: {
                    directory_version: directoryVersion,
                    published_at: new Date().toISOString(),
                    tables: tables.map(t => ({
                        table_id: t.id,
                        number: t.name,
                        name: t.name,
                        zone: t.section?.name ?? 'Main',
                        section: t.section?.name ?? '',
                        capacity: t.maxCovers,
                        active: t.isActive,
                        combined_table_ids: [],
                    })),
                },
            }],
    };
    let atlasStatus;
    let atlasBody;
    try {
        const atlasRes = await fetch(`${config.posApiBase}/api/v1/events/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.hospitalitySecret}` },
            body: JSON.stringify(syncEvent),
        });
        atlasStatus = atlasRes.status;
        atlasBody = atlasRes.ok ? await atlasRes.json() : null;
    }
    catch (err) {
        res.status(502).json({ error: 'ATLAS_UNREACHABLE', message: String(err) });
        return;
    }
    res.json({
        ok: atlasStatus >= 200 && atlasStatus < 300,
        directoryVersion,
        tablesSent: tables.length,
        atlas: { status: atlasStatus, body: atlasBody },
        note: 'ATLAS will queue pos.table_directory_ack and deliver it to /api/v1/events/ingest within ~5 s. Table.atlasTableId values will be updated automatically on receipt.',
    });
});
// GET /api/v1/pos/admin/status — returns current pos_config rows. Protected by POS_ADMIN_SECRET.
router.get('/pos/admin/status', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const rows = await prisma_1.prisma.$queryRaw `
    SELECT pc.id::text, pc.restaurant_id::text, r.name AS restaurant_name, r.slug,
           pc.atlas_location_id::text, pc.pos_api_base, pc.attached_at,
           LEFT(pc.hospitality_secret, 6) || '...' AS hospitality_secret_hint,
           LEFT(pc.pos_secret, 6) || '...' AS pos_secret_hint
    FROM pos_config pc
    LEFT JOIN restaurants r ON r.id = pc.restaurant_id
    ORDER BY pc.created_at
  `;
    res.json({ rows });
});
// GET /api/v1/pos/admin/outbox — recent outbox rows. Protected by POS_ADMIN_SECRET.
router.get('/pos/admin/outbox', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const rows = await prisma_1.prisma.$queryRaw `
    SELECT id::text, restaurant_id::text, visit_id::text, event_type,
           status, attempts, last_error,
           created_at, last_attempt_at, delivered_at
    FROM pos_outbox
    ORDER BY created_at DESC
    LIMIT 20
  `;
    res.json({ rows });
});
// GET /api/v1/pos/admin/diagnose?restaurantId=<uuid>
// End-to-end integration diagnostic for a single restaurant. Returns:
//   - Whether pos.table_directory_ack was ever received (posEventLog)
//   - Table.atlasTableId population counts
//   - Last 5 visit events emitted to ATLAS (pos_outbox), with payload excerpt
//   - Sample table showing atlasTableId state
router.get('/pos/admin/diagnose', async (req, res) => {
    const adminSecret = process.env.POS_ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
    }
    const restaurantId = req.query.restaurantId;
    if (!restaurantId || !/^[0-9a-f-]{36}$/.test(restaurantId)) {
        res.status(400).json({ error: 'INVALID_QUERY', message: 'restaurantId query param required (UUID)' });
        return;
    }
    // 1. pos.table_directory_ack received?
    const ackLogs = await prisma_1.prisma.$queryRaw `
    SELECT event_id::text, received_at
    FROM pos_event_log
    WHERE event_type = 'pos.table_directory_ack'
    ORDER BY received_at DESC
    LIMIT 5
  `;
    // 2. Table atlasTableId population — ::int avoids BigInt serialization issues
    const tableCounts = await prisma_1.prisma.$queryRaw `
    SELECT
      COUNT(*)::int                                         AS total,
      COUNT(*) FILTER (WHERE atlas_table_id IS NOT NULL)::int AS with_atlas_id,
      COUNT(*) FILTER (WHERE atlas_table_id IS NULL)::int     AS without_atlas_id
    FROM tables
    WHERE restaurant_id = ${restaurantId}::uuid
  `;
    // 3. Sample tables (first 10, show id, name, atlasTableId)
    const sampleTables = await prisma_1.prisma.$queryRaw `
    SELECT id::text, name, atlas_table_id::text
    FROM tables
    WHERE restaurant_id = ${restaurantId}::uuid
    ORDER BY name
    LIMIT 10
  `;
    // 4. Last 5 visit events sent to ATLAS (from pos_outbox, visit.* types)
    const recentVisitEvents = await prisma_1.prisma.$queryRaw `
    SELECT id::text, visit_id::text, event_type, status, attempts, last_error,
           payload,
           created_at, delivered_at
    FROM pos_outbox
    WHERE restaurant_id = ${restaurantId}::uuid
      AND event_type LIKE 'visit.%'
    ORDER BY created_at DESC
    LIMIT 5
  `;
    // 5. Live incoming visits from ATLAS (to confirm ATLAS side)
    const config = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId } });
    let atlasIncoming = null;
    let atlasIncomingStatus = null;
    if (config?.posApiBase && config?.atlasLocationId) {
        try {
            const r = await fetch(`${config.posApiBase}/api/v1/hospitality/visits/incoming?location_id=${config.atlasLocationId}`, { headers: { Authorization: `Bearer ${config.hospitalitySecret}` } });
            atlasIncomingStatus = r.status;
            atlasIncoming = r.ok ? await r.json() : null;
        }
        catch (_e) {
            atlasIncoming = 'FETCH_FAILED';
        }
    }
    const counts = tableCounts[0];
    res.json({
        restaurantId,
        step1_ack_received: {
            count: ackLogs.length,
            entries: ackLogs,
        },
        step2_table_population: {
            total: counts?.total ?? 0,
            with_atlas_id: counts?.with_atlas_id ?? 0,
            without_atlas_id: counts?.without_atlas_id ?? 0,
        },
        step3_sample_tables: sampleTables,
        step4_recent_visit_events: recentVisitEvents,
        step5_atlas_incoming: {
            status: atlasIncomingStatus,
            body: atlasIncoming,
        },
    });
});
exports.default = router;
