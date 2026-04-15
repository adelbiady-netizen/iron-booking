/**
 * Waitlist management service.
 * Handles future-date waitlist entries (not same-day walk-in queue — see WalkInService).
 */

import { prisma } from '../../lib/prisma';
import { addMinutes, nowUTC } from '../../utils/datetime';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { WAITLIST } from '../../config/constants';
import type { AddToWaitlistInput, WaitlistEntryView, WaitTimeEstimate } from '../../types/waitlist.types';

export class WaitlistService {
  async add(input: AddToWaitlistInput): Promise<WaitlistEntryView> {
    // Get current queue position for this date
    const existingCount = await prisma.waitlistEntry.count({
      where: {
        restaurantId: input.restaurantId,
        requestedDate: new Date(input.requestedDate + 'T12:00:00Z'),
        status: { in: ['WAITING', 'NOTIFIED'] },
      },
    });

    const entry = await prisma.waitlistEntry.create({
      data: {
        restaurantId: input.restaurantId,
        customerId: input.customerId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        guestCount: input.guestCount,
        requestedDate: new Date(input.requestedDate + 'T12:00:00Z'),
        preferredPeriod: input.preferredPeriod,
        preferredZone: input.preferredZone,
        status: 'WAITING',
        position: existingCount + 1,
      },
    });

    return this.toView(entry);
  }

  /**
   * Notify a guest that a table has opened — starts the expiry clock.
   */
  async notify(id: string): Promise<WaitlistEntryView> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundError('WaitlistEntry', id);
    if (entry.status !== 'WAITING') {
      throw new ValidationError(`Cannot notify entry with status ${entry.status}`);
    }

    const now = nowUTC();
    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: {
        status: 'NOTIFIED',
        notifiedAt: now,
        expiresAt: addMinutes(now, WAITLIST.NOTIFY_EXPIRY_MIN),
      },
    });

    return this.toView(updated);
  }

  /**
   * Guest confirmed — they're coming in. Remove from waitlist.
   */
  async confirm(id: string): Promise<WaitlistEntryView> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundError('WaitlistEntry', id);
    if (entry.status !== 'NOTIFIED') {
      throw new ValidationError('Can only confirm a NOTIFIED waitlist entry');
    }

    const now = nowUTC();
    if (entry.expiresAt && entry.expiresAt < now) {
      throw new ValidationError('Waitlist offer has expired');
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: { status: 'CONFIRMED', seatedAt: now },
    });

    return this.toView(updated);
  }

  async remove(id: string): Promise<void> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundError('WaitlistEntry', id);
    await prisma.waitlistEntry.update({
      where: { id },
      data: { status: 'REMOVED' },
    });
  }

  /**
   * Expire all NOTIFIED entries whose expiresAt has passed.
   * Called periodically (e.g., every minute by a cron job).
   */
  async expireStale(): Promise<number> {
    const result = await prisma.waitlistEntry.updateMany({
      where: {
        status: 'NOTIFIED',
        expiresAt: { lt: nowUTC() },
      },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  async listForDate(restaurantId: string, date: string) {
    return prisma.waitlistEntry.findMany({
      where: {
        restaurantId,
        requestedDate: new Date(date + 'T12:00:00Z'),
        status: { in: ['WAITING', 'NOTIFIED'] },
      },
      include: { customer: true },
      orderBy: { position: 'asc' },
    });
  }

  async estimateWait(
    restaurantId: string,
    date: string,
    guestCount: number,
  ): Promise<WaitTimeEstimate> {
    const partiesAhead = await prisma.waitlistEntry.count({
      where: {
        restaurantId,
        requestedDate: new Date(date + 'T12:00:00Z'),
        status: { in: ['WAITING', 'NOTIFIED'] },
        guestCount: { lte: guestCount + 2, gte: Math.max(1, guestCount - 2) },
      },
    });

    // Average turn duration from recent completed reservations
    const lookbackDate = new Date(Date.now() - WAITLIST.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const completedReservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        status: 'COMPLETED',
        seatedAt: { not: null },
        departedAt: { not: null },
        createdAt: { gte: lookbackDate },
      },
      select: { seatedAt: true, departedAt: true },
      take: 200,
    });

    let avgTurnMin = 90; // fallback
    if (completedReservations.length >= WAITLIST.MIN_SAMPLES) {
      const durations = completedReservations
        .filter((r) => r.seatedAt && r.departedAt)
        .map((r) => (r.departedAt!.getTime() - r.seatedAt!.getTime()) / 60_000);
      avgTurnMin = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    }

    // Cancellation rate
    const totalRecent = await prisma.reservation.count({
      where: { restaurantId, createdAt: { gte: lookbackDate } },
    });
    const cancelledRecent = await prisma.reservation.count({
      where: {
        restaurantId,
        status: { in: ['CANCELLED', 'NO_SHOW'] },
        createdAt: { gte: lookbackDate },
      },
    });
    const cancellationRate = totalRecent > 0 ? cancelledRecent / totalRecent : 0.1;

    // Tables that can seat this party size
    const eligibleTables = await prisma.table.count({
      where: { restaurantId, isActive: true, maxCapacity: { gte: guestCount } },
    });

    const effectivePartiesAhead = partiesAhead * (1 - cancellationRate);
    const estimatedMin = Math.round(
      (effectivePartiesAhead / Math.max(eligibleTables, 1)) * avgTurnMin,
    );

    const confidence =
      completedReservations.length < WAITLIST.MIN_SAMPLES
        ? 'LOW'
        : cancellationRate > 0.3
          ? 'MEDIUM'
          : 'HIGH';

    return {
      estimatedMin,
      confidence,
      partiesAhead,
      avgTurnMin,
      cancellationRate,
    };
  }

  private toView(entry: {
    id: string;
    guestName: string;
    guestPhone: string | null;
    guestCount: number;
    requestedDate: Date;
    preferredPeriod: import('@prisma/client').ServicePeriod | null;
    preferredZone: import('@prisma/client').ZoneType | null;
    status: import('@prisma/client').WaitlistStatus;
    position: number;
    estimatedWaitMin: number | null;
    notifiedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  }): WaitlistEntryView {
    return {
      id: entry.id,
      guestName: entry.guestName,
      guestPhone: entry.guestPhone ?? undefined,
      guestCount: entry.guestCount,
      requestedDate: entry.requestedDate.toISOString().slice(0, 10),
      preferredPeriod: entry.preferredPeriod ?? undefined,
      preferredZone: entry.preferredZone ?? undefined,
      status: entry.status,
      position: entry.position,
      estimatedWaitMin: entry.estimatedWaitMin ?? undefined,
      notifiedAt: entry.notifiedAt ?? undefined,
      expiresAt: entry.expiresAt ?? undefined,
      createdAt: entry.createdAt,
    };
  }
}
