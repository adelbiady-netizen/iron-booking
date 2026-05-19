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
 *   incoming_call  { id, phone, restaurantId, createdAt, status, duration,
 *                    recordUrl, group, restaurantName, routingStatus }
 *   floor_updated  { ts: number } — any reservation or waitlist-seat mutation
 *
 * Tenant isolation: each relay function guards by restaurantId.
 * Unrouted calls (no restaurantId) are dropped silently at the source.
 *
 * Scalability note: eventBus.setMaxListeners(200) supports up to 200 concurrent
 * host sessions per process. For larger multi-restaurant deployments, replace
 * the in-process EventEmitter with a Redis pub/sub channel.
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

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx / Render response buffering
  res.flushHeaders();

  const sessionTag = `[SSE:${payload.restaurantId}]`;
  const activeSessions = eventBus.listenerCount('incoming_call') + 1; // +1 for this new connection
  console.log(sessionTag, 'Connection opened — total active sessions:', activeSessions);

  // Ping every 25 s — most proxies drop idle connections at 30 s
  const ping = setInterval(() => res.write(':ping\n\n'), 25_000);

  function relay(data: Record<string, unknown>) {
    // Only relay to the session whose restaurant matches exactly.
    // Unrouted calls (dropped at emit source) never reach this point,
    // but the guard is kept as a safety net.
    if (data.restaurantId !== payload.restaurantId) return;
    res.write(`event: incoming_call\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function relayFloorUpdate(data: { restaurantId: string }) {
    if (data.restaurantId !== payload.restaurantId) return;
    // Forward only the timestamp — no reservation data crosses tenant boundary.
    res.write(`event: floor_updated\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }

  eventBus.on('incoming_call', relay);
  eventBus.on('floor_updated', relayFloorUpdate);

  req.on('close', () => {
    clearInterval(ping);
    eventBus.off('incoming_call', relay);
    eventBus.off('floor_updated', relayFloorUpdate);
    const remaining = eventBus.listenerCount('incoming_call');
    console.log(sessionTag, 'Connection closed — remaining sessions:', remaining);
  });
});

export default router;
