import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { writeHostAudit } from '../../lib/hostAudit';
import { readOnlineReservationSettings } from '../../lib/onlineSettings';

// Operational settings that a restaurant manager may change from the Host app
// during service. Any authenticated Host-app user may read/write these — they
// are considered routine operational actions, not owner-only administration.
// Every change is audited (actor, timestamp, previous value, new value).
const router = Router();
router.use(authenticate);

// Defaults are owned by lib/onlineSettings so the public booking guard and this
// endpoint can never disagree about what an absent key means.
const readOnlineSettings = readOnlineReservationSettings;

const UpdateSchema = z
  .object({
    onlineReservationsEnabled: z.boolean().optional(),
    maxOnlinePartySize: z.number().int().min(1).max(100).optional(),
  })
  .refine((b) => b.onlineReservationsEnabled !== undefined || b.maxOnlinePartySize !== undefined, {
    message: 'No changes provided',
  });

// GET /api/host-settings/online-reservations
router.get('/online-reservations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.auth.restaurantId },
      select: { settings: true },
    });
    if (!restaurant) throw new NotFoundError('Restaurant not found');
    res.json(readOnlineSettings(restaurant.settings));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/host-settings/online-reservations
router.patch(
  '/online-reservations',
  validate(UpdateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: req.auth.restaurantId },
        select: { settings: true },
      });
      if (!restaurant) throw new NotFoundError('Restaurant not found');

      const before = readOnlineSettings(restaurant.settings);
      // Shallow-merge into the settings JSON so unrelated keys are preserved.
      const merged = { ...(restaurant.settings as object), ...req.body };
      const updated = await prisma.restaurant.update({
        where: { id: req.auth.restaurantId },
        data: { settings: merged },
        select: { settings: true },
      });
      const after = readOnlineSettings(updated.settings);

      // Audit each field that actually changed (actor + old -> new).
      if (
        req.body.onlineReservationsEnabled !== undefined &&
        before.onlineReservationsEnabled !== after.onlineReservationsEnabled
      ) {
        writeHostAudit(req.auth, 'settings.online_reservations.toggled', {
          from: before.onlineReservationsEnabled,
          to: after.onlineReservationsEnabled,
        });
      }
      if (
        req.body.maxOnlinePartySize !== undefined &&
        before.maxOnlinePartySize !== after.maxOnlinePartySize
      ) {
        writeHostAudit(req.auth, 'settings.max_online_party_size.changed', {
          from: before.maxOnlinePartySize,
          to: after.maxOnlinePartySize,
        });
      }

      res.json(after);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
