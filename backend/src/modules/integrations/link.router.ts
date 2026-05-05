import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';

const router = Router();

/**
 * GET /api/integrations/link/call
 *
 * Webhook called by Link telephony on every call event.
 * Responds 200 immediately; database write is fire-and-forget.
 *
 * Query params:
 *   caller   – caller phone number
 *   status   – call status string (e.g. "answered", "missed")
 *   duration – call duration in seconds (optional)
 *   record   – recording URL (optional)
 */
router.get('/call', (req, res) => {
  console.log('[link/call] Webhook received:', req.query);
  res.sendStatus(200);

  const { caller, status, duration, record } = req.query;

  const durationSecs = duration !== undefined
    ? parseInt(String(duration), 10)
    : null;

  prisma.callLog.create({
    data: {
      phone:     String(caller  ?? ''),
      status:    String(status  ?? ''),
      duration:  durationSecs !== null && !isNaN(durationSecs) ? durationSecs : null,
      recordUrl: record ? String(record) : null,
    },
  }).then(log => {
    console.log('[link/call] CallLog saved:', log.phone);
    console.log('[link/call] Emitting incoming_call event:', log.phone);
    eventBus.emit('incoming_call', { phone: log.phone, createdAt: log.createdAt.toISOString() });
  }).catch((err: unknown) => {
    console.error('[link/call] Failed to persist call log:', err);
  });
});

export default router;
