/**
 * Core availability engine for Iron Booking.
 *
 * Given a date and party size, returns all bookable time slots with pre-scored
 * table assignments. This is read-only — no writes happen here.
 */

import { prisma } from '../../lib/prisma';

type CheckReservationConflictInput = {
  restaurantId: string;
  startTime: Date;
  endTime: Date;
};

export class ConflictDetector {
  async ensureNoOverlap(input: CheckReservationConflictInput) {
    console.log('🟡 ConflictDetector called');
    console.log('[CONFLICT CHECK] restaurantId:', input.restaurantId);
    console.log('[CONFLICT CHECK] startTime:', input.startTime.toISOString());
    console.log('[CONFLICT CHECK] endTime:', input.endTime.toISOString());

    const conflict = await prisma.reservation.findFirst({
      where: {
        restaurantId: input.restaurantId,
        startTime: {
          lt: input.endTime,
        },
        endTime: {
          gt: input.startTime,
        },
      },
      orderBy: {
        startTime: 'asc',
      },
    });

    console.log('[CONFLICT CHECK] found conflict:', conflict);

    if (conflict) {
      throw Object.assign(
        new Error(
          `Time conflict: reservation already exists between ${conflict.startTime.toISOString()} and ${conflict.endTime.toISOString()}`
        ),
        {
          code: 'RESERVATION_CONFLICT',
          statusCode: 409,
        }
      );
    }
  }
}