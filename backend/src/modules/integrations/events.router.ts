import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import type { AuthPayload } from '../../middleware/auth';
import { eventBus } from '../../lib/eventBus';

const router = Router();

/**
 * GET /api/integrations/events?token=<jwt>
 *
 * Server-Sent Events stream for authenticated host sessions.
 * Token is passed as a query param because native EventSource cannot
 * send custom headers.
 *
 * Emitted events:
 *   incoming_call  { phone: string, createdAt: string }
 *   floor_updated  { ts: number } — any reservation or waitlist-seat mutation
 */
router.get('/', (req, res) => {
  const raw = req.query.token;
  const token = typeof raw === 'string' ? raw : undefined;

  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    return;
  }

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return;
  }

  req.auth = payload;
  console.log('[events/sse] Authenticated via query token — userId:', payload.userId);

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx response buffering
  res.flushHeaders();

  console.log('[events/sse] Client connected — userId:', payload.userId, '| restaurantId:', payload.restaurantId);

  // Ping every 25 s — most proxies drop idle connections at 30 s
  const ping = setInterval(() => res.write(':ping\n\n'), 25_000);

  function relay(data: Record<string, unknown>) {
    if (data.restaurantId !== undefined && data.restaurantId !== payload.restaurantId) return;
    res.write(`event: incoming_call\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Relay floor_updated only to connections belonging to the same restaurant.
  // The payload carries restaurantId for tenant isolation; only the timestamp
  // is forwarded to the client so no reservation data leaks across tenants.
  function relayFloorUpdate(data: { restaurantId: string }) {
    if (data.restaurantId !== payload.restaurantId) return;
    res.write(`event: floor_updated\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }

  eventBus.on('incoming_call', relay);
  eventBus.on('floor_updated', relayFloorUpdate);

  req.on('close', () => {
    console.log('[events/sse] Client disconnected — userId:', payload.userId);
    clearInterval(ping);
    eventBus.off('incoming_call', relay);
    eventBus.off('floor_updated', relayFloorUpdate);
  });
});

export default router;
