import { Router } from 'express';
import { prisma } from '../../lib/prisma';

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
  }).catch((err: unknown) => {
    console.error('[integrations/link/call] failed to persist call log:', err);
  });
});

export default router;
