import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';

const router = Router();

// ─── Phase-128 group routing map (Eataliano Dalla Costa only) ─────────────────
// Maps Link ring-group IDs to their restaurant target and call metadata.
// Unknown groups fall through to DNIS-based routing with routingStatus=unresolved.

interface GroupRoute {
  restaurantName: string;
  category: string;
  channel: string;
}

const LINK_GROUP_ROUTES: Record<string, GroupRoute> = {
  '201': { restaurantName: 'Eataliano Dalla Costa', category: 'reservation', channel: 'phone' },
  '203': { restaurantName: 'Eataliano Dalla Costa', category: 'reservation', channel: 'sms'   },
};

/**
 * GET /api/integrations/link/call
 *
 * Webhook called by Link telephony on every call event.
 * Responds 200 immediately; restaurant lookup + DB write are fire-and-forget.
 *
 * Query params:
 *   caller    – caller phone number (ANI)
 *   called    – dialed number (DNIS) — fallback routing for unknown groups
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

  // ── Routing resolution ──────────────────────────────────────────────────
  // Phase 128: known groups resolve via the static map (Eataliano Dalla Costa).
  // Unknown groups fall back to the original DNIS-based lookup and are marked
  // unresolved so the HQ team can extend the map as new restaurants go live.

  const groupRoute: GroupRoute | undefined = groupStr
    ? LINK_GROUP_ROUTES[groupStr]
    : undefined;

  // Fix B2: for known groups, chain a DNIS fallback if the name lookup misses.
  // Protects against minor DB name drift without adding a new routing abstraction.
  const restaurantLookup: Promise<{ id: string } | null> = groupRoute
    ? prisma.restaurant
        .findFirst({ where: { name: groupRoute.restaurantName }, select: { id: true } })
        .then(r => {
          if (r) return r;
          if (calledStr) {
            console.warn('[link/call] group', groupStr, '→ name lookup missed, trying DNIS fallback on', calledStr);
            return prisma.restaurant.findUnique({ where: { linkPhone: calledStr }, select: { id: true } });
          }
          return null;
        })
    : calledStr
      ? prisma.restaurant.findUnique({ where: { linkPhone: calledStr }, select: { id: true } })
      : Promise.resolve(null);

  restaurantLookup.then(restaurant => {
    if (groupRoute) {
      if (!restaurant) {
        console.warn(
          '[link/call] group', groupStr, '→ target "' + groupRoute.restaurantName + '" not found in DB (routing resolved without restaurantId)'
        );
      } else {
        console.log(
          '[link/call] group', groupStr, '→', groupRoute.restaurantName,
          '|', groupRoute.category, '|', groupRoute.channel,
          '| restaurantId:', restaurant.id
        );
      }
    } else {
      // Unknown group — original DNIS path
      if (calledStr && !restaurant) {
        console.warn('[link/call] No restaurant found for called number:', calledStr, '| group:', groupStr ?? '(none)');
      } else if (restaurant) {
        console.log('[link/call] Routed via DNIS to restaurant:', restaurant.id);
      }
    }

    return prisma.callLog.create({
      data: {
        restaurantId:  restaurant?.id ?? null,
        phone:         callerStr,
        called:        calledStr,
        group:         groupStr,
        extension:     extensionStr,
        status:        statusStr,
        duration:      durationSecs !== null && !isNaN(durationSecs) ? durationSecs : null,
        recordUrl:     recordStr,
        // Phase-128 routing metadata
        routingStatus:  groupRoute ? 'resolved'               : 'unresolved',
        category:       groupRoute ? groupRoute.category      : null,
        channel:        groupRoute ? groupRoute.channel       : null,
        restaurantName: groupRoute ? groupRoute.restaurantName: null,
      },
    });
  }).then(log => {
    console.log(
      '[link/call] CallLog saved — id:', log.id,
      '| phone:', log.phone,
      '| restaurantId:', log.restaurantId ?? '(unrouted)',
      '| routingStatus:', log.routingStatus ?? 'pre-128',
      '| channel:', log.channel ?? '—',
    );
    console.log('[link/call] Emitting incoming_call event:', log.phone);
    eventBus.emit('incoming_call', {
      phone:        log.phone,
      restaurantId: log.restaurantId ?? undefined, // Fix B1: undefined broadcasts; null was silently dropped by SSE relay
      createdAt:    log.createdAt.toISOString(),
    });
  }).catch((err: unknown) => {
    console.error('[link/call] Failed to persist call log:', err);
  });
});

export default router;
