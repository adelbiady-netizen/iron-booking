import { Router, Request, Response, NextFunction } from 'express';
import { addMinutes, areIntervalsOverlapping } from 'date-fns';
import { prisma } from '../../lib/prisma';
import { parseTimeOnDate } from '../../engine/availability';
import { config } from '../../config';
import bookingRouter from './booking.router';

const router = Router();

router.use('/book', bookingRouter);

// ─── GET /api/public/restaurant/:slug ───────────────────────────────────────
// Minimal read-only lookup used by the tenant entry page to validate a slug
// before showing the login form. Returns only safe display fields — no PII,
// no settings, no internal IDs beyond the restaurant UUID needed for PIN login.
router.get('/restaurant/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = typeof req.params['slug'] === 'string' ? req.params['slug'] : '';
    if (!slug) {
      return res.status(400).json({ error: { code: 'MISSING_PARAM', message: 'slug required' } });
    }
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true },
    });
    if (!restaurant) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Restaurant not found' } });
    }
    res.json(restaurant);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/public/hosts?restaurantId=xxx ──────────────────────────────────
// Returns active hosts that have a PIN set — used by the Host Selection Screen.
// No authentication required; returns only display fields (no PINs or emails).
router.get('/hosts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurantId = typeof req.query['restaurantId'] === 'string' ? req.query['restaurantId'] : '';
    if (!restaurantId) {
      return res.status(400).json({ error: { code: 'MISSING_PARAM', message: 'restaurantId is required' } });
    }

    const hosts = await prisma.user.findMany({
      where: {
        restaurantId,
        isActive: true,
        pin: { not: null },
      },
      select: {
        id: true, firstName: true, lastName: true, avatarUrl: true, role: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return res.json(hosts);
  } catch (err) { next(err); }
});

// ─── DB lookup ───────────────────────────────────────────────────────────────
async function findReservation(token: string) {
  return prisma.reservation.findUnique({
    where: { confirmationToken: token },
    include: {
      restaurant: {
        select: {
          name: true,
          address: true,
          phone: true,
          logoUrl: true,
          coverImageUrl: true,
          googleMapsUrl: true,
          wazeUrl: true,
          websiteUrl: true,
          instagramUrl: true,
          parkingNotes: true,
          cancellationPolicy: true,
          specialInstructions: true,
          primaryColor: true,
          accentColor: true,
          publicThemePreset: true,
          buttonStyle: true,
          cardStyle: true,
          backgroundMood: true,
          backgroundColorHex: true,
          backgroundGradientHex: true,
        },
      },
    },
  });
}

type ResolvedReservation = NonNullable<Awaited<ReturnType<typeof findReservation>>>;

// ─── Token validation helper ─────────────────────────────────────────────────
// Returns the reservation if the token is valid and still actionable.
// "Expired" = reservation datetime + 4-hour grace window has passed.
async function resolveToken(token: string): Promise<
  { ok: false; status: number; code: string; message: string } |
  { ok: true; reservation: ResolvedReservation }
> {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return { ok: false, status: 400, code: 'INVALID_TOKEN', message: 'Invalid or missing confirmation token.' };
  }

  const reservation = await findReservation(token);

  if (!reservation) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'This confirmation link is invalid or has already been used.' };
  }

  // Terminal states — no further guest actions allowed
  if (reservation.status === 'COMPLETED' || reservation.status === 'NO_SHOW') {
    return { ok: false, status: 410, code: 'CLOSED', message: `This reservation is ${reservation.status.toLowerCase().replace('_', ' ')}.` };
  }

  // Expiry check: reservation datetime + 4-hour grace window
  const [h, m] = reservation.time.split(':').map(Number);
  const resDateTime = new Date(reservation.date);
  resDateTime.setUTCHours(h, m, 0, 0);
  const expiresAt = new Date(resDateTime.getTime() + 4 * 60 * 60 * 1000);
  if (new Date() > expiresAt) {
    return { ok: false, status: 410, code: 'EXPIRED', message: 'This confirmation link has expired.' };
  }

  return { ok: true, reservation };
}

// ─── GET /api/public/reservation?token=xxx ───────────────────────────────────
// Read-only. Returns reservation details for the guest confirmation page.
// Never mutates state.
router.get('/reservation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
    const result = await resolveToken(token);

    if (!result.ok) {
      return res.status(result.status).json({ error: { code: result.code, message: result.message } });
    }

    const r = result.reservation;
    return res.json({
      guestName:                    r.guestName,
      restaurantName:               r.restaurant.name,
      restaurantAddress:            r.restaurant.address,
      restaurantPhone:              r.restaurant.phone,
      restaurantLogoUrl:            r.restaurant.logoUrl,
      restaurantCoverImageUrl:      r.restaurant.coverImageUrl,
      restaurantGoogleMapsUrl:      r.restaurant.googleMapsUrl,
      restaurantWazeUrl:            r.restaurant.wazeUrl,
      restaurantWebsiteUrl:         r.restaurant.websiteUrl,
      restaurantInstagramUrl:       r.restaurant.instagramUrl,
      restaurantParkingNotes:       r.restaurant.parkingNotes,
      restaurantCancellationPolicy:  r.restaurant.cancellationPolicy,
      restaurantSpecialInstructions: r.restaurant.specialInstructions,
      restaurantPrimaryColor:        r.restaurant.primaryColor,
      restaurantAccentColor:         r.restaurant.accentColor,
      restaurantPublicThemePreset:   r.restaurant.publicThemePreset,
      restaurantButtonStyle:          r.restaurant.buttonStyle,
      restaurantCardStyle:            r.restaurant.cardStyle,
      restaurantBackgroundMood:       r.restaurant.backgroundMood,
      restaurantBackgroundColorHex:   r.restaurant.backgroundColorHex,
      restaurantBackgroundGradientHex: r.restaurant.backgroundGradientHex,
      date:                          r.date.toISOString().split('T')[0],
      time:                         r.time,
      partySize:                    r.partySize,
      status:                       r.status,
      isConfirmedByGuest:           r.isConfirmedByGuest,
      isRunningLate:                r.isRunningLate,
      occasion:                     r.occasion,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/public/confirm ────────────────────────────────────────────────
// Guest explicitly confirms attendance. Idempotent — safe to call multiple times.
router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const result = await resolveToken(token);

    if (!result.ok) {
      return res.status(result.status).json({ error: { code: result.code, message: result.message } });
    }

    const r = result.reservation;

    // Already cancelled — not allowed
    if (r.status === 'CANCELLED') {
      return res.status(409).json({ error: { code: 'CANCELLED', message: 'This reservation has been cancelled.' } });
    }

    // Cannot confirm once already seated
    if (r.status === 'SEATED') {
      return res.status(409).json({ error: { code: 'ALREADY_SEATED', message: 'You have already been seated — no confirmation needed.' } });
    }

    // Idempotent — already confirmed is fine
    if (r.isConfirmedByGuest) {
      return res.json({ status: r.status, isConfirmedByGuest: true, alreadyConfirmed: true });
    }

    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        isConfirmedByGuest: true,
        confirmedAt: new Date(),
        status: r.status === 'PENDING' ? 'CONFIRMED' : r.status,
      },
    });

    return res.json({ status: r.status === 'PENDING' ? 'CONFIRMED' : r.status, isConfirmedByGuest: true });
  } catch (err) { next(err); }
});

// ─── POST /api/public/cancel ─────────────────────────────────────────────────
// Guest cancels their reservation via the confirmation link.
router.post('/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const result = await resolveToken(token);

    if (!result.ok) {
      return res.status(result.status).json({ error: { code: result.code, message: result.message } });
    }

    const r = result.reservation;

    // Cannot cancel once seated or completed (already handled by resolveToken for COMPLETED)
    if (r.status === 'SEATED') {
      return res.status(409).json({ error: { code: 'ALREADY_SEATED', message: 'Your table is ready — please speak to staff to cancel.' } });
    }

    // Idempotent — already cancelled
    if (r.status === 'CANCELLED') {
      return res.json({ status: 'CANCELLED', alreadyCancelled: true });
    }

    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        status:      'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    return res.json({ status: 'CANCELLED' });
  } catch (err) { next(err); }
});

// ─── POST /api/public/late ───────────────────────────────────────────────────
// Guest self-reports they are running late. Sets flag for the host dashboard.
// Does NOT change reservation status — the host still controls seating/no-show.
router.post('/late', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const result = await resolveToken(token);

    if (!result.ok) {
      return res.status(result.status).json({ error: { code: result.code, message: result.message } });
    }

    const r = result.reservation;

    if (r.status === 'CANCELLED') {
      return res.status(409).json({ error: { code: 'CANCELLED', message: 'This reservation has been cancelled.' } });
    }

    if (r.status === 'SEATED') {
      return res.status(409).json({ error: { code: 'ALREADY_SEATED', message: 'You have already been seated.' } });
    }

    // Idempotent
    if (r.isRunningLate) {
      return res.json({ isRunningLate: true, alreadyNotified: true });
    }

    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        isRunningLate:  true,
        lateNotifiedAt: new Date(),
      },
    });

    return res.json({ isRunningLate: true });
  } catch (err) { next(err); }
});

// ─── GET /api/public/confirm?token=xxx (LEGACY) ──────────────────────────────
// Kept for backward compatibility with confirmation links already sent via SMS
// before the frontend confirmation page was deployed.
// New reservations send links to the frontend /confirm page instead.
router.get('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.query['token'] === 'string' ? req.query['token'] : '';
    if (!token) {
      return res.status(400).send(legacyHtml('Invalid Link', 'This confirmation link is missing a token.', false));
    }

    const reservation = await prisma.reservation.findUnique({
      where: { confirmationToken: token },
    });

    if (!reservation) {
      return res.status(404).send(legacyHtml('Link Not Found', 'This confirmation link is invalid or has already been used.', false));
    }

    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status)) {
      return res.status(410).send(legacyHtml('Reservation Closed', `This reservation is ${reservation.status.toLowerCase()} and can no longer be confirmed.`, false));
    }

    // Check expiry
    const [h, m] = reservation.time.split(':').map(Number);
    const resDateTime = new Date(reservation.date);
    resDateTime.setUTCHours(h, m, 0, 0);
    if (new Date() > new Date(resDateTime.getTime() + 4 * 60 * 60 * 1000)) {
      return res.status(410).send(legacyHtml('Link Expired', 'This confirmation link has expired.', false));
    }

    if (reservation.isConfirmedByGuest) {
      return res.send(legacyHtml('Already Confirmed', `Your reservation for ${reservation.partySize} guests on ${reservation.date.toISOString().split('T')[0]} at ${reservation.time} is already confirmed. See you soon!`, true));
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        isConfirmedByGuest: true,
        confirmedAt: new Date(),
        status: reservation.status === 'PENDING' ? 'CONFIRMED' : reservation.status,
      },
    });

    return res.send(legacyHtml(
      'Confirmed!',
      `Thank you, ${reservation.guestName}! Your reservation for ${reservation.partySize} guests on ${reservation.date.toISOString().split('T')[0]} at ${reservation.time} has been confirmed. We look forward to seeing you!`,
      true
    ));
  } catch (err) { next(err); }
});

// ─── GET /api/public/diag/availability ───────────────────────────────────────
// TEMPORARY diagnostic — operator-only, gated by X-Diag-Secret: <JWT_SECRET>.
// Returns the full availability decision trace for a given slug/date/partySize.
// Read-only. Remove after production audit is complete.
router.get('/diag/availability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.headers['x-diag-secret'] !== config.jwtSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const slug      = typeof req.query['slug']      === 'string' ? req.query['slug']      : '';
    const dateStr   = typeof req.query['date']      === 'string' ? req.query['date']      : '';
    const timeStr   = typeof req.query['time']      === 'string' ? req.query['time']      : '17:30';
    const partySize = parseInt(typeof req.query['partySize'] === 'string' ? req.query['partySize'] : '5', 10);

    if (!slug || !dateStr) {
      return res.status(400).json({ error: 'slug and date required' });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      include: { operatingHours: { orderBy: { dayOfWeek: 'asc' } } },
    });
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const s = (() => {
      const raw = (restaurant.settings ?? {}) as Record<string, unknown>;
      return {
        defaultTurnMinutes:        (raw['defaultTurnMinutes']        as number) ?? 90,
        bufferBetweenTurnsMinutes: (raw['bufferBetweenTurnsMinutes'] as number) ?? 15,
        maxOnlinePartySize:        (raw['maxOnlinePartySize']        as number) ?? 5,
      };
    })();

    const date    = new Date(dateStr + 'T00:00:00.000Z');
    const dayOfWeek = date.getUTCDay();
    const hours   = restaurant.operatingHours.find(h => h.dayOfWeek === dayOfWeek);
    const durationMinutes = s.defaultTurnMinutes;
    const bufferMinutes   = s.bufferBetweenTurnsMinutes;

    const slotStart   = parseTimeOnDate(date, timeStr);
    const slotEnd     = addMinutes(slotStart, durationMinutes);
    const effStart    = addMinutes(slotStart, -bufferMinutes);
    const effEnd      = addMinutes(slotEnd,   bufferMinutes);
    const slotInterval = { start: effStart, end: effEnd };

    const queryStart = addMinutes(slotStart, -bufferMinutes - 60);
    const queryEnd   = addMinutes(slotEnd,    bufferMinutes + 60);

    // Fetch every active table (no cover filter — show all for audit)
    const [allTables, allCombinations, reservations, blocks, restrictions] = await Promise.all([
      prisma.table.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        select: { id: true, name: true, minCovers: true, maxCovers: true, locked: true },
        orderBy: { name: 'asc' },
      }),
      prisma.tableCombination.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        select: {
          id: true, name: true, tableAId: true, tableBId: true, minCovers: true, maxCovers: true,
          tableA: { select: { id: true, name: true, isActive: true, locked: true } },
          tableB: { select: { id: true, name: true, isActive: true, locked: true } },
        },
      }),
      prisma.reservation.findMany({
        where: {
          restaurantId: restaurant.id,
          date,
          status: { in: ['CONFIRMED', 'SEATED', 'PENDING'] },
          tableId: { not: null },
        },
        select: { id: true, tableId: true, time: true, duration: true, partySize: true, status: true, guestName: true },
      }),
      prisma.blockedPeriod.findMany({
        where: {
          restaurantId: restaurant.id,
          startTime: { lt: queryEnd },
          endTime:   { gt: queryStart },
        },
        select: { tableId: true, startTime: true, endTime: true },
      }),
      prisma.onlineBookingRestriction.findMany({
        where: { restaurantId: restaurant.id, date: dateStr, isActive: true },
        select: { startTime: true, endTime: true, guestMessage: true },
      }),
    ]);

    // Capacity filter verdict for each table
    const tableDiag = allTables.map(t => {
      const passesCapacity = t.minCovers <= partySize && t.maxCovers >= partySize;
      const isLocked = t.locked;
      const tableBlocked = blocks.some(b =>
        b.tableId === t.id && areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime })
      );
      const conflictingRes = reservations.filter(r => {
        if (r.tableId !== t.id) return false;
        const rStart = parseTimeOnDate(date, r.time);
        const rEnd   = addMinutes(rStart, r.duration);
        return areIntervalsOverlapping(slotInterval, { start: rStart, end: rEnd });
      });
      const hasConflict = conflictingRes.length > 0;

      let rejectionReason: string | null = null;
      if (isLocked)          rejectionReason = 'TABLE_LOCKED';
      else if (!passesCapacity) rejectionReason = `CAPACITY_MISMATCH (minCovers=${t.minCovers}, maxCovers=${t.maxCovers}, partySize=${partySize})`;
      else if (tableBlocked) rejectionReason = 'BLOCKED_PERIOD';
      else if (hasConflict)  rejectionReason = `RESERVATION_CONFLICT (${conflictingRes.map(r => `${r.guestName} ${r.time} ps=${r.partySize} [${r.status}]`).join(', ')})`;

      return {
        id:              t.id,
        name:            t.name,
        minCovers:       t.minCovers,
        maxCovers:       t.maxCovers,
        locked:          t.locked,
        passesCapacity,
        tableBlocked,
        conflictingReservations: conflictingRes.map(r => ({ id: r.id, guestName: r.guestName, time: r.time, duration: r.duration, partySize: r.partySize, status: r.status })),
        available:       passesCapacity && !isLocked && !tableBlocked && !hasConflict,
        rejectionReason,
      };
    });

    // Combination audit
    const comboDiag = allCombinations.map(c => {
      const passesCapacity = c.minCovers <= partySize && c.maxCovers >= partySize;
      const tableAOk = c.tableA.isActive && !c.tableA.locked;
      const tableBOk = c.tableB.isActive && !c.tableB.locked;
      const componentIds = [c.tableAId, c.tableBId];

      const anyBlocked = componentIds.some(tid =>
        blocks.some(b => b.tableId === tid && areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime }))
      );
      const conflictingRes = reservations.filter(r =>
        componentIds.includes(r.tableId ?? '') &&
        (() => {
          const rStart = parseTimeOnDate(date, r.time);
          const rEnd   = addMinutes(rStart, r.duration);
          return areIntervalsOverlapping(slotInterval, { start: rStart, end: rEnd });
        })()
      );
      const hasConflict = conflictingRes.length > 0;

      let rejectionReason: string | null = null;
      if (!passesCapacity)       rejectionReason = `CAPACITY_MISMATCH (minCovers=${c.minCovers}, maxCovers=${c.maxCovers}, partySize=${partySize})`;
      else if (!tableAOk)        rejectionReason = `TABLE_A_INACTIVE_OR_LOCKED (${c.tableA.name})`;
      else if (!tableBOk)        rejectionReason = `TABLE_B_INACTIVE_OR_LOCKED (${c.tableB.name})`;
      else if (anyBlocked)       rejectionReason = 'COMPONENT_TABLE_BLOCKED';
      else if (hasConflict)      rejectionReason = `RESERVATION_CONFLICT (${conflictingRes.map(r => `${r.guestName} ${r.time} ps=${r.partySize} [${r.status}]`).join(', ')})`;

      return {
        id:         c.id,
        name:       c.name,
        tableA:     { id: c.tableAId, name: c.tableA.name, isActive: c.tableA.isActive, locked: c.tableA.locked },
        tableB:     { id: c.tableBId, name: c.tableB.name, isActive: c.tableB.isActive, locked: c.tableB.locked },
        minCovers:  c.minCovers,
        maxCovers:  c.maxCovers,
        passesCapacity,
        anyBlocked,
        conflictingReservations: conflictingRes.map(r => ({ id: r.id, guestName: r.guestName, time: r.time, duration: r.duration, partySize: r.partySize, status: r.status })),
        available:  passesCapacity && tableAOk && tableBOk && !anyBlocked && !hasConflict,
        rejectionReason,
      };
    });

    const availableSingleTables  = tableDiag.filter(t => t.available);
    const availableCombinations  = comboDiag.filter(c => c.available);
    const onlineRestriction      = restrictions.find(r => {
      if (!r.startTime || !r.endTime) return true;
      return timeStr >= r.startTime && timeStr < r.endTime;
    });

    const finalVerdict =
      onlineRestriction             ? `BLOCKED_BY_ONLINE_RESTRICTION (${onlineRestriction.guestMessage ?? 'no message'})` :
      !hours?.isOpen                ? 'RESTAURANT_CLOSED_THIS_DAY' :
      timeStr < (hours?.openTime ?? '') || timeStr > (hours?.lastSeating ?? '') ? `OUTSIDE_HOURS (open=${hours?.openTime}, lastSeating=${hours?.lastSeating})` :
      partySize > s.maxOnlinePartySize ? `EXCEEDS_MAX_ONLINE_PARTY_SIZE (limit=${s.maxOnlinePartySize})` :
      availableSingleTables.length > 0 ? `AVAILABLE via single table(s): ${availableSingleTables.map(t => t.name).join(', ')}` :
      availableCombinations.length  > 0 ? `AVAILABLE via combination(s): ${availableCombinations.map(c => c.name).join(', ')}` :
      'NO_AVAILABILITY';

    return res.json({
      query: { slug, date: dateStr, time: timeStr, partySize, dayOfWeek, dayName: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek] },
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      operatingHours: hours ?? null,
      settings: { defaultTurnMinutes: durationMinutes, bufferBetweenTurnsMinutes: bufferMinutes, maxOnlinePartySize: s.maxOnlinePartySize },
      slotWindow: { effStart: effStart.toISOString(), effEnd: effEnd.toISOString() },
      onlineRestriction: onlineRestriction ?? null,
      allReservationsOnDay: reservations.map(r => ({ tableId: r.tableId, guestName: r.guestName, time: r.time, duration: r.duration, partySize: r.partySize, status: r.status })),
      tables: tableDiag,
      combinations: comboDiag,
      summary: {
        totalActiveTables:     allTables.length,
        totalCombinations:     allCombinations.length,
        availableSingleTables: availableSingleTables.length,
        availableCombinations: availableCombinations.length,
        finalVerdict,
      },
    });
  } catch (err) { next(err); }
});

function legacyHtml(title: string, message: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444';
  const icon  = success ? '✓' : '✕';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
    .card{background:#1a1d27;border:1px solid #2d3348;border-radius:16px;padding:2.5rem 2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}
    .icon{width:56px;height:56px;border-radius:50%;background:${color}20;border:2px solid ${color}50;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;font-size:1.5rem;color:${color}}
    h1{font-size:1.25rem;font-weight:700;color:#f1f5f9;margin-bottom:.75rem}
    p{font-size:.875rem;color:#94a3b8;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
