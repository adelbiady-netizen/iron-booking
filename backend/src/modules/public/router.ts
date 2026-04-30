import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// GET /api/public/confirm?token=xxx
// No auth — called by the guest via SMS link.
router.get('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.query['token'];
    if (!token || typeof token !== 'string') {
      return res.status(400).send(confirmPage('Invalid Link', 'This confirmation link is missing a token.', false));
    }

    const reservation = await prisma.reservation.findUnique({
      where: { confirmationToken: token },
    });

    if (!reservation) {
      return res.status(404).send(confirmPage('Link Not Found', 'This confirmation link is invalid or has already been used.', false));
    }

    if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status)) {
      return res.status(410).send(confirmPage('Reservation Closed', `This reservation is ${reservation.status.toLowerCase()} and can no longer be confirmed.`, false));
    }

    if (reservation.isConfirmedByGuest) {
      return res.send(confirmPage('Already Confirmed', `Your reservation for ${reservation.partySize} guests on ${reservation.date.toISOString().split('T')[0]} at ${reservation.time} is already confirmed. See you soon!`, true));
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        isConfirmedByGuest: true,
        confirmedAt: reservation.confirmedAt ?? new Date(),
        status: reservation.status === 'PENDING' ? 'CONFIRMED' : reservation.status,
      },
    });

    return res.send(confirmPage(
      'Confirmed!',
      `Thank you, ${reservation.guestName}! Your reservation for ${reservation.partySize} guests on ${reservation.date.toISOString().split('T')[0]} at ${reservation.time} has been confirmed. We look forward to seeing you!`,
      true
    ));
  } catch (err) { next(err); }
});

function confirmPage(title: string, message: string, success: boolean): string {
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
