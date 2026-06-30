"use strict";
/**
 * IB → ATLAS POS outbound event dispatcher.
 *
 * Usage:
 *   queueVisitEvent(...)  — called from the reservations router after each
 *                           lifecycle mutation; writes one row to pos_outbox.
 *   startDispatcher()     — called once at server startup; polls every 5 s.
 *
 * Retry policy: up to MAX_ATTEMPTS with exponential back-off (5 s, 25 s,
 * 125 s, …).  After MAX_ATTEMPTS failures the row is marked 'failed' and
 * left for manual inspection — it is never deleted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueVisitEvent = queueVisitEvent;
exports.startDispatcher = startDispatcher;
exports.stopDispatcher = stopDispatcher;
const crypto_1 = require("crypto");
const prisma_1 = require("../../lib/prisma");
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL = 5_000; // ms
const BATCH_SIZE = 20;
/**
 * Queue a visit lifecycle event for delivery to ATLAS POS.
 * Generates a deterministic event_id so retries send the same ID (idempotent).
 * No-ops silently if the restaurant has no PosConfig or no atlasLocationId.
 */
async function queueVisitEvent(restaurantId, eventType, visitId, // IB reservation.id
payload) {
    const config = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId } });
    if (!config?.atlasLocationId)
        return; // not attached to ATLAS — skip silently
    // Deterministic event_id: sha256(visitId:eventType) → UUID-formatted hex.
    // This means retries send the same event_id; ATLAS upserts are idempotent.
    const hash = (0, crypto_1.createHash)('sha256').update(`${visitId}:${eventType}`).digest('hex');
    const eventId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    // Cast through unknown so Prisma's InputJsonValue is satisfied without
    // adding an index signature to every interface.
    const envelope = {
        envelope_version: 1,
        event_id: eventId,
        type: eventType,
        version: 1,
        occurred_at: new Date().toISOString(),
        source: 'hospitality',
        brand_id: config.atlasLocationId,
        location_id: config.atlasLocationId,
        visit_id: visitId,
        sequence: 1,
        causation_id: null,
        payload,
    };
    const envelopeJson = envelope;
    await prisma_1.prisma.posOutbox.upsert({
        where: { eventId },
        create: { restaurantId, visitId, eventType, eventId, payload: envelopeJson, status: 'pending' },
        // On conflict: reset to pending so a re-trigger causes a re-send.
        update: { status: 'pending', nextRetryAt: new Date(), lastError: null },
    });
}
// ── Worker ────────────────────────────────────────────────────────────────────
let _timer = null;
function startDispatcher() {
    if (_timer)
        return;
    console.log('[POS dispatcher] started — polling every 5 s');
    void dispatchPending(); // immediate first pass
    _timer = setInterval(() => void dispatchPending(), POLL_INTERVAL);
}
function stopDispatcher() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}
// ── Core dispatch loop ────────────────────────────────────────────────────────
async function dispatchPending() {
    const now = new Date();
    const rows = await prisma_1.prisma.posOutbox.findMany({
        where: {
            status: { in: ['pending'] },
            nextRetryAt: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
    });
    for (const row of rows) {
        await deliverOne(row);
    }
}
async function deliverOne(row) {
    const config = await prisma_1.prisma.posConfig.findUnique({ where: { restaurantId: row.restaurantId } });
    if (!config?.atlasLocationId) {
        // Config removed — mark failed, don't retry forever.
        await prisma_1.prisma.posOutbox.update({
            where: { id: row.id },
            data: { status: 'failed', lastError: 'no pos_config or atlasLocationId', lastAttemptAt: new Date() },
        });
        return;
    }
    const attempt = row.attempts + 1;
    let delivered = false;
    let lastError;
    try {
        const res = await fetch(`${config.posApiBase}/api/v1/events/ingest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.hospitalitySecret}`,
            },
            body: JSON.stringify({ events: [row.payload] }),
            signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
            const body = await res.json();
            const accepted = body?.data?.accepted ?? [];
            const rejected = body?.data?.rejected ?? [];
            if (rejected.length > 0) {
                lastError = `ATLAS rejected: ${JSON.stringify(rejected)}`;
                console.warn(`[POS dispatcher] ${row.id} rejected by ATLAS:`, rejected);
            }
            else if (accepted.length > 0) {
                delivered = true;
                console.log(`[POS dispatcher] ✓ delivered ${row.id} (attempt ${attempt})`);
            }
            else {
                lastError = 'empty accepted list';
            }
        }
        else {
            const text = await res.text().catch(() => '');
            lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
            console.warn(`[POS dispatcher] ${row.id} HTTP ${res.status}:`, text.slice(0, 200));
        }
    }
    catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`[POS dispatcher] ${row.id} network error:`, lastError);
    }
    if (delivered) {
        await prisma_1.prisma.posOutbox.update({
            where: { id: row.id },
            data: { status: 'delivered', deliveredAt: new Date(), attempts: attempt, lastAttemptAt: new Date() },
        });
        return;
    }
    // Back-off: 5^attempt seconds (5 s, 25 s, 125 s, 625 s, …)
    const backoffMs = Math.min(Math.pow(5, attempt) * 1_000, 3_600_000);
    const nextRetry = new Date(Date.now() + backoffMs);
    const exhausted = attempt >= MAX_ATTEMPTS;
    await prisma_1.prisma.posOutbox.update({
        where: { id: row.id },
        data: {
            status: exhausted ? 'failed' : 'pending',
            attempts: attempt,
            lastAttemptAt: new Date(),
            nextRetryAt: exhausted ? new Date() : nextRetry,
            lastError: lastError ?? null,
        },
    });
    if (exhausted) {
        console.error(`[POS dispatcher] ✗ DEAD LETTER ${row.id} after ${attempt} attempts. Last error: ${lastError}`);
    }
}
