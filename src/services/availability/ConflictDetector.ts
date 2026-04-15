import { prisma } from '../../lib/prisma';

type CheckReservationConflictInput = {
  restaurantId: string;
  startTime: Date;
  endTime: Date;
};

export class ConflictDetector {
  async ensureNoOverlap(input: CheckReservationConflictInput) {
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