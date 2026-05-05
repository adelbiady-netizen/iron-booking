import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { eventBus } from '../../lib/eventBus';

const router = Router();

/**
 * GET /api/integrations/events
 *
 * Server-Sent Events stream for authenticated host sessions.
 * Emitted events:
 *   incoming_call  { phone: string, createdAt: string }
 */
router.get('/', authenticate, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx response buffering
  res.flushHeaders();

  // Ping every 25 s — most proxies drop idle connections at 30 s
  const ping = setInterval(() => res.write(':ping\n\n'), 25_000);

  function relay(data: object) {
    console.log('[events/sse] Sending event to client:', data);
    res.write(`event: incoming_call\ndata: ${JSON.stringify(data)}\n\n`);
  }

  eventBus.on('incoming_call', relay);

  req.on('close', () => {
    clearInterval(ping);
    eventBus.off('incoming_call', relay);
  });
});

export default router;
