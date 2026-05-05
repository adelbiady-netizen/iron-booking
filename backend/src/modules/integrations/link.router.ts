import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';

const router = Router();

/**
 * GET /api/integrations/link/call
 *
 * Webhook called by Link telephony on every call event.
 * Responds 200 immediately; restaurant lookup + DB write are fire-and-forget.
 *
 * Query params:
 *   caller    – caller phone number (ANI)
 *   called    – dialed number (DNIS) — used to route to the correct restaurant
 *   group     – Link call group / ring group
 *   extension – Link extension reached
 *   status    – call status string (e.g. "answered", "missed")
 *   duration  – call duration in seconds (optional)
 *   record    – recording URL (optional)
 */
router.get('/call', (req, res) => {
  console.log('[link/call] Webhook received:', req.query);
  res.sendStatus(200);

  const { caller, called, group, extension, status, duration, record } = req.query;

  const callerStr    = String(caller    ?? '');
  const calledStr    = called    ? String(called)    : null;
  const groupStr     = group     ? String(group)     : null;
  const extensionStr = extension ? String(extension) : null;
  const statusStr    = String(status ?? '');
  const recordStr    = record    ? String(record)    : null;
  const durationSecs = duration !== undefined
    ? parseInt(String(duration), 10)
    : null;

  // Identify restaurant by the dialed number (DNIS).
  // linkPhone must be configured on the restaurant to enable routing.
  const restaurantLookup = calledStr
    ? prisma.restaurant.findUnique({ where: { linkPhone: calledStr }, select: { id: true } })
    : Promise.resolve(null);

  restaurantLookup.then(restaurant => {
    if (calledStr && !restaurant) {
      console.warn('[link/call] No restaurant found for called number:', calledStr);
    } else if (restaurant) {
      console.log('[link/call] Routed to restaurant:', restaurant.id);
    }

    return prisma.callLog.create({
      data: {
        restaurantId: restaurant?.id ?? null,
        phone:        callerStr,
        called:       calledStr,
        group:        groupStr,
        extension:    extensionStr,
        status:       statusStr,
        duration:     durationSecs !== null && !isNaN(durationSecs) ? durationSecs : null,
        recordUrl:    recordStr,
      },
    });
  }).then(log => {
    console.log('[link/call] CallLog saved — id:', log.id, '| phone:', log.phone, '| restaurantId:', log.restaurantId ?? '(unrouted)');
    console.log('[link/call] Emitting incoming_call event:', log.phone);
    eventBus.emit('incoming_call', {
      phone:        log.phone,
      restaurantId: log.restaurantId ?? null,
      createdAt:    log.createdAt.toISOString(),
    });
  }).catch((err: unknown) => {
    console.error('[link/call] Failed to persist call log:', err);
  });
});

export default router;
