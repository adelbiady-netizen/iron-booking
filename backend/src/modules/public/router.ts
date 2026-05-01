import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// ─── DB lookup ───────────────────────────────────────────────────────────────
async function findReservation(token: string) {
  return prisma.reservation.findUnique({
    where: { confirmationToken: token },
    include: { restaurant: { select: { name: true } } },
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
      guestName:         r.guestName,
      restaurantName:    r.restaurant.name,
      date:              r.date.toISOString().split('T')[0],
      time:              r.time,
      partySize:         r.partySize,
      status:            r.status,
      isConfirmedByGuest: r.isConfirmedByGuest,
      isRunningLate:     r.isRunningLate,
      occasion:          r.occasion,
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
