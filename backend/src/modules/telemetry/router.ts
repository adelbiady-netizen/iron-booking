import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { Prisma } from '@prisma/client';

const router = Router();

const EventSchema = z.object({
  event:      z.string().max(100),
  properties: z.record(z.string(), z.unknown()).optional(),
  sessionId:  z.string().max(64).optional(),
});

// POST /api/telemetry/events — fire-and-forget from frontend, always returns 204
router.post('/events', authenticate, validate(EventSchema, 'body'), (req: Request, res: Response) => {
  // Respond immediately — do not block on DB write
  res.status(204).end();
  const { event, properties, sessionId } = req.body as z.infer<typeof EventSchema>;
  prisma.hostEvent.create({
    data: {
      restaurantId: req.auth.restaurantId,
      hostName:     `${req.auth.firstName} ${req.auth.lastName}`.trim() || req.auth.email,
      event,
      properties:   (properties ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      sessionId:    sessionId ?? null,
    },
  }).catch(err => {
    // Never surface telemetry errors to the client
    console.error('[telemetry] write failed:', err);
  });
});

export default router;
