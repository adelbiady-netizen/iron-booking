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

// ─── Normalise body for POST webhooks ────────────────────────────────────────
// Link may send a form-encoded body (application/x-www-form-urlencoded or
// text/plain) — and sometimes with the wrong Content-Type header.  The global
// express.text({ type: '*/*' }) parser (mounted in app.ts before express.json)
// captures the raw body as a string so the JSON parser never sees it.
// We parse that string here and merge with query params; query takes precedence
// since Link puts the caller ANI in the query string for POST calls.
function parseBodyParams(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof body === 'string' && body.length > 0) {
    new URLSearchParams(body).forEach((val, key) => { out[key] = val; });
  } else if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

// ─── Shared call webhook pipeline ────────────────────────────────────────────
// Called by both GET and POST handlers after param extraction.
// t0 is the request-start timestamp for timing logs.
async function processCallWebhook(
  params: Record<string, unknown>,
  t0: number,
  method: string,
): Promise<void> {
  const callerStr    = firstStr(params.caller);
  const calledStr    = firstStrOrNull(params.called);
  const groupStr     = firstStrOrNull(params.group);
  const extensionStr = firstStrOrNull(params.extension);
  const callidStr    = firstStrOrNull(params.callid);
  const statusStr    = firstStr(params.status);
  const recordStr    = firstStrOrNull(params.record);
  const rawDuration  = firstStrOrNull(params.duration);
  const durationSecs = rawDuration !== null ? parseInt(rawDuration, 10) : null;

  console.log(
    `[link/call:${method}] Webhook received —`,
    'caller:', callerStr || '(empty)',
    '| called:', calledStr ?? '—',
    '| group:', groupStr ?? '—',
    '| status:', statusStr || '(empty)',
    '| callid:', callidStr ?? '—',
    '| duration:', durationSecs ?? '—',
    '| hasRecord:', recordStr !== null,
  );

  if (!callerStr || !statusStr) {
    console.warn(`[link/call:${method}] Malformed payload — missing caller or status. Dropping.`);
    return;
  }

  const groupRoute: GroupRoute | undefined = groupStr ? LINK_GROUP_ROUTES[groupStr] : undefined;

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

  const restaurant = await restaurantLookup;
  console.log('[link/timing] ② restaurant resolved —', Date.now() - t0, 'ms total');

  if (groupRoute) {
    if (restaurant) {
      console.log('[link/call] Resolution: group', groupStr, '→ slug:', groupRoute.restaurantSlug, '| restaurantId:', restaurant.id, '| category:', groupRoute.category, '| channel:', groupRoute.channel);
    } else {
      console.warn('[link/call] Resolution failed: group', groupStr, '→ slug "' + groupRoute.restaurantSlug + '" not found in DB. Persisting without restaurantId.');
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

  const tParallelStart = Date.now();
  const dupWhere = callidStr
    ? { callid: callidStr, status: statusStr }
    : (() => {
        const cutoff = new Date(Date.now() - 60_000);
        return { phone: callerStr, called: calledStr, group: groupStr, status: statusStr, createdAt: { gte: cutoff } };
      })();
  const [duplicate, guestMatch] = await Promise.all([
    prisma.callLog.findFirst({ where: dupWhere, select: { id: true } }),
    restaurant?.id ? lookupGuestByPhone(restaurant.id, callerStr) : Promise.resolve(null),
  ]);
  console.log('[link/timing] ③ parallel (dup+guest) —', Date.now() - tParallelStart, 'ms |', Date.now() - t0, 'ms total');

  if (duplicate) {
    console.log('[link/call] Duplicate webhook — skipping create. Existing id:', duplicate.id);
    return;
  }

  const guestName = guestMatch ? `${guestMatch.firstName} ${guestMatch.lastName}`.trim() || null : null;
  if (guestName) console.log('[link/call] Guest matched —', guestName);

  const tCreate = Date.now();
  const created = await prisma.callLog.create({
    data: {
      restaurantId:   restaurant?.id ?? null,
      phone:          callerStr,
      called:         calledStr,
      group:          groupStr,
      extension:      extensionStr,
      callid:         callidStr,
      status:         statusStr,
      duration:       durationSecs !== null && !isNaN(durationSecs) ? durationSecs : null,
      recordUrl:      recordStr,
      routingStatus:  groupRoute ? 'resolved'                : 'unresolved',
      category:       groupRoute ? groupRoute.category       : null,
      channel:        groupRoute ? groupRoute.channel        : null,
      restaurantName: groupRoute ? groupRoute.restaurantName : null,
      guestName,
    },
  });
  console.log('[link/timing] ④ callLog.create —', Date.now() - tCreate, 'ms |', Date.now() - t0, 'ms total');

  console.log('[link/call] Persisted — id:', created.id, '| phone:', created.phone, '| restaurantId:', created.restaurantId ?? '(unrouted)', '| routingStatus:', created.routingStatus ?? 'pre-128', '| channel:', created.channel ?? '—');

  if (!created.restaurantId) {
    console.warn('[link/call] SSE broadcast suppressed — call has no restaurantId (unrouted). id:', created.id);
    return;
  }

  const payload = {
    id:             created.id,
    phone:          created.phone,
    restaurantId:   created.restaurantId,
    createdAt:      created.createdAt.toISOString(),
    callid:         created.callid,
    status:         created.status,
    duration:       created.duration,
    recordUrl:      created.recordUrl,
    group:          created.group,
    restaurantName: created.restaurantName,
    routingStatus:  created.routingStatus,
    guestName:      created.guestName,
  };

  console.log('[link/timing] ⑤ SSE emit —', Date.now() - t0, 'ms total ← HOST AWARENESS POINT');
  eventBus.emit('incoming_call', payload);
  console.log('[link/call] SSE broadcast — restaurantId:', created.restaurantId, '| active sessions:', eventBus.listenerCount('incoming_call'));
}

/**
 * GET /api/integrations/link/call
 *
 * Webhook called by Link telephony on every call event (legacy GET format).
 * All params arrive in the query string.
 */
router.get('/call', (req, res) => {
  const t0 = Date.now();
  res.sendStatus(200);
  console.log('[link/timing] ① 200 sent —', Date.now() - t0, 'ms');
  processCallWebhook(req.query as Record<string, unknown>, t0, 'GET').catch((err: unknown) => {
    console.error('[link/call:GET] Pipeline error:', err instanceof Error ? err.message : String(err));
  });
});

/**
 * POST /api/integrations/link/call
 *
 * Webhook called by Link telephony when the caller param arrives in the query
 * string and call details (status, extension, group, callid) arrive in the body
 * as application/x-www-form-urlencoded (or similar form-encoded format).
 *
 * Body is pre-captured as a string by the express.text(type=any) parser
 * mounted in app.ts before express.json(), preventing the 400 entity.parse.failed
 * rejection that would otherwise occur when the Content-Type is mismatched.
 */
router.post('/call', (req, res) => {
  const t0 = Date.now();
  res.sendStatus(200);
  console.log('[link/timing] ① 200 sent —', Date.now() - t0, 'ms');

  // Merge body params (from form-encoded string) with query params.
  // Query takes precedence — Link puts caller (ANI) in the query string.
  const bodyParams = parseBodyParams(req.body);
  const params: Record<string, unknown> = { ...bodyParams, ...req.query };
  console.log('[link/call:POST] normalized params —', params);

  processCallWebhook(params, t0, 'POST').catch((err: unknown) => {
    console.error('[link/call:POST] Pipeline error:', err instanceof Error ? err.message : String(err));
  });
});

export default router;
