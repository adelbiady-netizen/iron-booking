import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { eventBus } from '../../lib/eventBus';
import { lookupGuestByPhone } from '../guests/service';

const router = Router();

// ─── Phase-128 group routing map ─────────────────────────────────────────────
// Maps Link ring-group IDs to their restaurant target and call metadata.
// Unknown groups fall through to DNIS-based routing (routingStatus=unresolved).
//
// Extension points for future phases:
//   - Add new groups here as restaurants onboard to Link telephony
//   - Move this map to the DB (Restaurant.linkGroups) when the set grows beyond ~10
//   - category='reservation' today; future values: 'support', 'delivery', 'enquiry'
//   - channel='phone'|'sms' today; future values: 'whatsapp', 'ivr'
//
// Future CRM hooks (do not build yet, preserve structure):
//   - Linked reservations: CallLog.reservationId FK when a call converts to a booking
//   - Outcome tagging:     CallLog.outcome = 'booked'|'callback'|'no_action'
//   - Missed-call queue:   filter CallLog where status='missed' and outcome IS NULL
//   - VIP detection:       cross-reference caller phone with Guest.isVip at emit time
//   - Callback workflow:   missed + no outcome = appears in a "call back" queue panel

interface GroupRoute {
  restaurantSlug: string;   // immutable slug — used for DB lookup (never changes)
  restaurantName: string;   // display label — denormalised into CallLog.restaurantName
  category: string;
  channel: string;
}

const LINK_GROUP_ROUTES: Record<string, GroupRoute> = {
  '201': { restaurantSlug: 'eataliano-dalla-costa', restaurantName: 'Eataliano Dalla Costa', category: 'reservation', channel: 'phone' },
  '203': { restaurantSlug: 'eataliano-dalla-costa', restaurantName: 'Eataliano Dalla Costa', category: 'reservation', channel: 'sms'   },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Guards against array-valued query params (e.g. ?caller=a&caller=b → ['a','b']).
// Takes the first value only; falls back to empty string.
function firstStr(val: unknown, fallback = ''): string {
  if (Array.isArray(val)) return val.length > 0 ? String(val[0]) : fallback;
  if (typeof val === 'string') return val;
  return fallback;
}

function firstStrOrNull(val: unknown): string | null {
  if (Array.isArray(val)) return val.length > 0 ? String(val[0]) : null;
  if (typeof val === 'string') return val;
  return null;
}

/**
 * GET /api/integrations/link/call
 *
 * Webhook called by Link telephony on every call event.
 * Responds 200 immediately; restaurant lookup + DB write are fire-and-forget.
 *
 * Idempotency: if the same (phone, called, group, status) arrives again within
 * 60 seconds we treat it as a webhook retry and skip the DB write.
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
  const t0 = Date.now();
  res.sendStatus(200);
  console.log('[link/timing] ① 200 sent —', Date.now() - t0, 'ms');

  const callerStr    = firstStr(req.query.caller);
  const calledStr    = firstStrOrNull(req.query.called);
  const groupStr     = firstStrOrNull(req.query.group);
  const extensionStr = firstStrOrNull(req.query.extension);
  const callidStr    = firstStrOrNull(req.query.callid);
  const statusStr    = firstStr(req.query.status);
  const recordStr    = firstStrOrNull(req.query.record);
  const rawDuration  = firstStrOrNull(req.query.duration);
  const durationSecs = rawDuration !== null ? parseInt(rawDuration, 10) : null;

  console.log(
    '[link/call] Webhook received —',
    'caller:', callerStr || '(empty)',
    '| called:', calledStr ?? '—',
    '| group:', groupStr ?? '—',
    '| status:', statusStr || '(empty)',
    '| callid:', callidStr ?? '—',
    '| duration:', durationSecs ?? '—',
    '| hasRecord:', recordStr !== null,
  );

  // Minimal payload validation — caller and status are required for a meaningful record.
  if (!callerStr || !statusStr) {
    console.warn('[link/call] Malformed payload — missing caller or status. Dropping.');
    return;
  }

  // ── Routing resolution ──────────────────────────────────────────────────────
  const groupRoute: GroupRoute | undefined = groupStr ? LINK_GROUP_ROUTES[groupStr] : undefined;

  // Slug lookup is the primary path for known groups — slug is immutable and unique,
  // so it is immune to restaurant renames. DNIS (linkPhone) is the fallback for both
  // unknown groups and slug-miss edge cases (e.g. restaurant not yet in DB).
  const restaurantLookup: Promise<{ id: string } | null> = groupRoute
    ? prisma.restaurant
        .findUnique({ where: { slug: groupRoute.restaurantSlug }, select: { id: true } })
        .then(r => {
          if (r) return r;
          if (calledStr) {
            console.warn('[link/call] Group', groupStr, '→ slug lookup missed for', groupRoute.restaurantSlug, '; trying DNIS fallback on', calledStr);
            return prisma.restaurant.findUnique({ where: { linkPhone: calledStr }, select: { id: true } });
          }
          return null;
        })
    : calledStr
      ? prisma.restaurant.findUnique({ where: { linkPhone: calledStr }, select: { id: true } })
      : Promise.resolve(null);

  restaurantLookup
    .then(async restaurant => {
      console.log('[link/timing] ② restaurant resolved —', Date.now() - t0, 'ms total');

      // ── Resolution logging ──────────────────────────────────────────────────
      if (groupRoute) {
        if (restaurant) {
          console.log(
            '[link/call] Resolution: group', groupStr,
            '→ slug:', groupRoute.restaurantSlug,
            '| restaurantId:', restaurant.id,
            '| category:', groupRoute.category,
            '| channel:', groupRoute.channel,
          );
        } else {
          console.warn(
            '[link/call] Resolution failed: group', groupStr,
            '→ slug "' + groupRoute.restaurantSlug + '" not found in DB.',
            'Persisting without restaurantId.',
          );
        }
      } else if (calledStr) {
        if (restaurant) {
          console.log('[link/call] Resolution: DNIS', calledStr, '→ restaurantId:', restaurant.id);
        } else {
          console.warn('[link/call] Resolution failed: DNIS', calledStr, '| group:', groupStr ?? '(none)', '— no restaurant match.');
        }
      } else if (groupStr) {
        console.warn('[link/call] Unknown group', groupStr, '— not in LINK_GROUP_ROUTES and no DNIS fallback. Persisting as unrouted.');
      } else {
        console.warn('[link/call] No routing signal — neither group nor DNIS (called) param present. Persisting as unrouted.');
      }

      // ── Idempotency check + guest lookup — run in parallel ──────────────────
      // When the provider sends a callid we deduplicate on (callid, status) so that
      // each call lifecycle step (ring, answered, missed) creates exactly one record
      // regardless of retries or multi-extension fan-out.
      // Fallback for legacy webhooks without callid: time-window guard on
      // (phone, called, group, status) within 60 s.
      const tParallelStart = Date.now();
      const dupWhere = callidStr
        ? { callid: callidStr, status: statusStr }
        : (() => {
            const cutoff = new Date(Date.now() - 60_000);
            return { phone: callerStr, called: calledStr, group: groupStr, status: statusStr, createdAt: { gte: cutoff } };
          })();
      const [duplicate, guestMatch] = await Promise.all([
        prisma.callLog.findFirst({
          where: dupWhere,
          select: { id: true },
        }),
        // Guest lookup: only when a restaurant is resolved; uses dual-format OR
        // query to match both +972 and 05 storage formats without false misses.
        restaurant?.id
          ? lookupGuestByPhone(restaurant.id, callerStr)
          : Promise.resolve(null),
      ]);

      console.log('[link/timing] ③ parallel (dup+guest) —', Date.now() - tParallelStart, 'ms |', Date.now() - t0, 'ms total');

      if (duplicate) {
        console.log('[link/call] Duplicate webhook — skipping create. Existing id:', duplicate.id);
        return null;
      }

      const guestName = guestMatch
        ? `${guestMatch.firstName} ${guestMatch.lastName}`.trim() || null
        : null;
      if (guestName) console.log('[link/call] Guest matched —', guestName);

      const tCreate = Date.now();
      const created = await prisma.callLog.create({
        data: {
          restaurantId:  restaurant?.id ?? null,
          phone:         callerStr,
          called:        calledStr,
          group:         groupStr,
          extension:     extensionStr,
          callid:        callidStr,
          status:        statusStr,
          duration:      durationSecs !== null && !isNaN(durationSecs) ? durationSecs : null,
          recordUrl:     recordStr,
          routingStatus:  groupRoute ? 'resolved'                : 'unresolved',
          category:       groupRoute ? groupRoute.category       : null,
          channel:        groupRoute ? groupRoute.channel        : null,
          restaurantName: groupRoute ? groupRoute.restaurantName : null,
          guestName,
        },
      });
      console.log('[link/timing] ④ callLog.create —', Date.now() - tCreate, 'ms |', Date.now() - t0, 'ms total');
      return created;
    })
    .then(log => {
      if (!log) return; // duplicate — already logged above

      console.log(
        '[link/call] Persisted — id:', log.id,
        '| phone:', log.phone,
        '| restaurantId:', log.restaurantId ?? '(unrouted)',
        '| routingStatus:', log.routingStatus ?? 'pre-128',
        '| channel:', log.channel ?? '—',
      );

      if (!log.restaurantId) {
        // Unrouted calls are persisted for audit but not broadcast.
        // The SSE relay would drop them anyway; we log explicitly for observability.
        console.warn(
          '[link/call] SSE broadcast suppressed — call has no restaurantId (unrouted).',
          'id:', log.id,
        );
        return;
      }

      const payload = {
        id:            log.id,
        phone:         log.phone,
        restaurantId:  log.restaurantId,
        createdAt:     log.createdAt.toISOString(),
        callid:        log.callid,
        status:        log.status,
        duration:      log.duration,
        recordUrl:     log.recordUrl,
        group:         log.group,
        restaurantName: log.restaurantName,
        routingStatus: log.routingStatus,
        guestName:     log.guestName,
      };

      console.log('[link/timing] ⑤ SSE emit —', Date.now() - t0, 'ms total ← HOST AWARENESS POINT');
      eventBus.emit('incoming_call', payload);

      const activeSessions = eventBus.listenerCount('incoming_call');
      console.log(
        '[link/call] SSE broadcast — restaurantId:', log.restaurantId,
        '| active sessions:', activeSessions,
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[link/call] Pipeline error:', message);
    });
});

export default router;
