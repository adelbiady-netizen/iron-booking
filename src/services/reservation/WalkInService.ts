/**
 * Walk-in service — handles guests who arrive without a reservation.
 * Creates a WalkIn record, attempts immediate table assignment,
 * and falls back to the waitlist if nothing is available.
 */

import { prisma } from '../../lib/prisma';
import type { ZoneType } from '@prisma/client';
import { ConflictDetector } from '../availability/ConflictDetector';
import { TableAssignmentService } from '../assignment/TableAssignmentService';
import { addMinutes, nowUTC } from '../../utils/datetime';
import { NotFoundError } from '../../utils/errors';

export interface CreateWalkInInput {
  restaurantId: string;
  guestName?: string;
  guestPhone?: string;
  guestCount: number;
  zonePreference?: ZoneType;
  customerId?: string;
  staffNotes?: string;
}

export interface WalkInResult {
  walkInId: string;
  status: 'SEATED' | 'WAITING';
  assignedTables?: string[]; // tableNumbers if seated
  estimatedWaitMin?: number; // if waiting
}

export class WalkInService {
  async arrive(input: CreateWalkInInput): Promise<WalkInResult> {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: input.restaurantId },
      select: { defaultDuration: true, bufferMin: true },
    });

    const now = nowUTC();
    const endTime = addMinutes(now, restaurant.defaultDuration);

    // Check current table availability
    const occupied = await ConflictDetector.getOccupiedTableIds(
      input.restaurantId,
      now,
      endTime,
      restaurant.bufferMin,
    );

    const assignmentResult = await TableAssignmentService.assign({
      restaurantId: input.restaurantId,
      guestCount: input.guestCount,
      occupiedTableIds: occupied,
      preferredZone: input.zonePreference,
      isVIP: false,
    });

    if (assignmentResult) {
      // Seat immediately
      const walkIn = await prisma.$transaction(async (tx) => {
        const created = await tx.walkIn.create({
          data: {
            restaurantId: input.restaurantId,
            customerId: input.customerId,
            guestName: input.guestName,
            guestPhone: input.guestPhone,
            guestCount: input.guestCount,
            zonePreference: input.zonePreference,
            status: 'SEATED',
            seatedAt: now,
            tables: {
              create: assignmentResult.best.tables.map((t) => ({
                tableId: t.tableId,
                isPrimary: t.isPrimary,
              })),
            },
          },
          include: { tables: { include: { table: true } } },
        });
        return created;
      });

      return {
        walkInId: walkIn.id,
        status: 'SEATED',
        assignedTables: walkIn.tables.map((wt) => wt.table.tableNumber),
      };
    }

    // No table available — create waiting walk-in
    const walkIn = await prisma.walkIn.create({
      data: {
        restaurantId: input.restaurantId,
        customerId: input.customerId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        guestCount: input.guestCount,
        zonePreference: input.zonePreference,
        status: 'WAITING',
      },
    });

    return {
      walkInId: walkIn.id,
      status: 'WAITING',
    };
  }

  async seatWalkIn(walkInId: string, tableIds: string[]): Promise<void> {
    const walkIn = await prisma.walkIn.findUnique({ where: { id: walkInId } });
    if (!walkIn) throw new NotFoundError('WalkIn', walkInId);

    await prisma.$transaction(async (tx) => {
      await tx.walkInTable.createMany({
        data: tableIds.map((tableId, i) => ({
          walkInId,
          tableId,
          isPrimary: i === 0,
        })),
      });

      await tx.walkIn.update({
        where: { id: walkInId },
        data: { status: 'SEATED', seatedAt: nowUTC() },
      });
    });
  }

  async departWalkIn(walkInId: string): Promise<void> {
    const walkIn = await prisma.walkIn.findUnique({ where: { id: walkInId } });
    if (!walkIn) throw new NotFoundError('WalkIn', walkInId);

    await prisma.walkIn.update({
      where: { id: walkInId },
      data: { status: 'DEPARTED', departedAt: nowUTC() },
    });
  }

  async getWaiting(restaurantId: string) {
    return prisma.walkIn.findMany({
      where: { restaurantId, status: 'WAITING' },
      orderBy: { arrivedAt: 'asc' },
    });
  }
}
