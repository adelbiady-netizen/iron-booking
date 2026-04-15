/**
 * Host dashboard service — floor status, upcoming arrivals, timeline view.
 *
 * All queries are read-only. The dashboard is a snapshot of the current
 * operational state at a given moment in time.
 */

import { prisma } from '../../lib/prisma';
import { addMinutes, nowUTC } from '../../utils/datetime';
import { DASHBOARD } from '../../config/constants';
import type {
  FloorStatus,
  FloorSummary,
  ZoneStatus,
  TableStatus,
  TableStatusType,
  OccupantInfo,
  NextReservationInfo,
  UpcomingView,
  TimelineView,
  TimelineRow,
  TimelineEvent,
} from '../../types/dashboard.types';

export class DashboardService {
  /**
   * Full floor status snapshot — the main host dashboard view.
   * Returns every table's current state with occupant and next-reservation info.
   */
  async getFloorStatus(restaurantId: string, asOf?: Date): Promise<FloorStatus> {
    const now = asOf ?? nowUTC();
    const soonThreshold = addMinutes(now, DASHBOARD.RESERVED_SOON_MIN);

    const [zones, activeReservations, seatedWalkIns, upcomingReservations, waitlistCount, walkInWaitingCount] =
      await Promise.all([
        prisma.zone.findMany({
          where: { restaurantId, isActive: true },
          include: {
            tables: {
              where: { isActive: true },
              orderBy: { tableNumber: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        }),

        // Currently seated reservations
        prisma.reservation.findMany({
          where: {
            restaurantId,
            status: 'SEATED',
          },
          include: { tables: { select: { tableId: true, isPrimary: true } } },
        }),

        // Currently seated walk-ins
        prisma.walkIn.findMany({
          where: { restaurantId, status: 'SEATED', departedAt: null },
          include: { tables: { select: { tableId: true, isPrimary: true } } },
        }),

        // Next reservations (confirmed, not yet seated) starting within next 4 hours
        prisma.reservation.findMany({
          where: {
            restaurantId,
            status: { in: ['CONFIRMED', 'PENDING'] },
            startTime: { gte: now, lte: addMinutes(now, 240) },
          },
          include: { tables: { select: { tableId: true } } },
          orderBy: { startTime: 'asc' },
        }),

        prisma.waitlistEntry.count({
          where: { restaurantId, status: { in: ['WAITING', 'NOTIFIED'] } },
        }),

        prisma.walkIn.count({
          where: { restaurantId, status: 'WAITING' },
        }),
      ]);

    // Build lookup maps for O(1) table status resolution
    const seatedTableMap = new Map<string, { type: 'reservation' | 'walkin'; id: string; guestName: string; guestCount: number; seatedAt: Date; endTime: Date }>();

    for (const r of activeReservations) {
      for (const rt of r.tables) {
        seatedTableMap.set(rt.tableId, {
          type: 'reservation',
          id: r.id,
          guestName: r.guestName,
          guestCount: r.guestCount,
          seatedAt: r.seatedAt ?? now,
          endTime: r.endTime,
        });
      }
    }

    for (const w of seatedWalkIns) {
      for (const wt of w.tables) {
        seatedTableMap.set(wt.tableId, {
          type: 'walkin',
          id: w.id,
          guestName: w.guestName ?? 'Walk-in',
          guestCount: w.guestCount,
          seatedAt: w.seatedAt ?? now,
          endTime: addMinutes(w.seatedAt ?? now, 90), // estimated departure
        });
      }
    }

    // Next reservation by table
    const nextResMap = new Map<string, typeof upcomingReservations[0]>();
    for (const r of upcomingReservations) {
      for (const rt of r.tables) {
        if (!nextResMap.has(rt.tableId)) {
          nextResMap.set(rt.tableId, r); // already ordered by startTime asc
        }
      }
    }

    // Build zone/table statuses
    let totalTables = 0;
    let occupiedTables = 0;
    let currentCovers = 0;
    let totalCapacity = 0;

    const zoneStatuses: ZoneStatus[] = zones.map((zone) => {
      const tableStatuses: TableStatus[] = zone.tables.map((table) => {
        totalTables++;
        totalCapacity += table.maxCapacity;

        const occupant = seatedTableMap.get(table.id);
        const nextRes = nextResMap.get(table.id);

        let status: TableStatusType;
        let occupantInfo: OccupantInfo | undefined;
        let nextReservationInfo: NextReservationInfo | undefined;
        let minutesUntilNext: number | undefined;

        if (occupant) {
          occupiedTables++;
          currentCovers += occupant.guestCount;

          const isOverTime = now > occupant.endTime;
          status = isOverTime ? 'NEEDS_BUSSING' : 'OCCUPIED';

          occupantInfo = {
            type: occupant.type,
            id: occupant.id,
            guestName: occupant.guestName,
            guestCount: occupant.guestCount,
            seatedAt: occupant.seatedAt,
            scheduledDepartureAt: occupant.endTime,
            isOverTime,
            overtimeMin: isOverTime
              ? Math.round((now.getTime() - occupant.endTime.getTime()) / 60_000)
              : undefined,
          };
        } else if (nextRes) {
          const minsUntil = Math.round((nextRes.startTime.getTime() - now.getTime()) / 60_000);
          minutesUntilNext = minsUntil;
          status = nextRes.startTime <= soonThreshold ? 'RESERVED_SOON' : 'RESERVED_LATER';

          nextReservationInfo = {
            reservationId: nextRes.id,
            guestName: nextRes.guestName,
            guestCount: nextRes.guestCount,
            startTime: nextRes.startTime,
            isVIP: nextRes.isVIP,
          };
        } else {
          status = 'AVAILABLE';
        }

        return {
          tableId: table.id,
          tableNumber: table.tableNumber,
          zoneType: zone.type,
          minCapacity: table.minCapacity,
          maxCapacity: table.maxCapacity,
          status,
          currentOccupant: occupantInfo,
          nextReservation: nextReservationInfo,
          minutesUntilNextReservation: minutesUntilNext,
        };
      });

      return {
        zoneId: zone.id,
        zoneName: zone.name,
        zoneType: zone.type,
        tables: tableStatuses,
      };
    });

    const summary: FloorSummary = {
      totalTables,
      occupiedTables,
      availableTables: totalTables - occupiedTables,
      currentCovers,
      totalCapacity,
      occupancyPercent: totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0,
      waitlistCount,
      walkInWaitingCount,
    };

    return {
      restaurantId,
      asOf: now,
      zones: zoneStatuses,
      summary,
    };
  }

  /**
   * Upcoming arrivals within the next N minutes — the host's action list.
   */
  async getUpcoming(
    restaurantId: string,
    lookaheadMin: number = DASHBOARD.UPCOMING_LOOKAHEAD_MIN,
    asOf?: Date,
  ): Promise<UpcomingView> {
    const now = asOf ?? nowUTC();
    const until = addMinutes(now, lookaheadMin);

    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        startTime: { gte: now, lte: until },
      },
      include: { tables: { include: { table: { select: { tableNumber: true } } } } },
      orderBy: { startTime: 'asc' },
    });

    return {
      lookaheadMin,
      asOf: now,
      reservations: reservations.map((r) => ({
        reservationId: r.id,
        confirmationCode: r.confirmationCode,
        guestName: r.guestName,
        guestCount: r.guestCount,
        startTime: r.startTime,
        minutesUntilArrival: Math.max(
          0,
          Math.round((r.startTime.getTime() - now.getTime()) / 60_000),
        ),
        status: r.status,
        assignedTables: r.tables.map((rt) => rt.table.tableNumber),
        isVIP: r.isVIP,
        guestNotes: r.guestNotes ?? undefined,
      })),
    };
  }

  /**
   * Timeline view for a time window — shows all table occupancies as a Gantt.
   * Used for the visual scheduling panel.
   */
  async getTimeline(
    restaurantId: string,
    windowStartUTC: Date,
    windowEndUTC: Date,
  ): Promise<TimelineView> {
    const [tables, reservations, walkIns] = await Promise.all([
      prisma.table.findMany({
        where: { restaurantId, isActive: true },
        include: { zone: { select: { type: true } } },
        orderBy: [{ zone: { sortOrder: 'asc' } }, { tableNumber: 'asc' }],
      }),

      prisma.reservation.findMany({
        where: {
          restaurantId,
          status: { notIn: ['CANCELLED'] },
          startTime: { lt: windowEndUTC },
          endTime: { gt: windowStartUTC },
        },
        include: { tables: { select: { tableId: true } } },
      }),

      prisma.walkIn.findMany({
        where: {
          restaurantId,
          status: { in: ['SEATED', 'DEPARTED'] },
          seatedAt: { lt: windowEndUTC, not: null },
        },
        include: { tables: { select: { tableId: true } } },
      }),
    ]);

    // Map tableId → events
    const eventMap = new Map<string, TimelineEvent[]>();
    tables.forEach((t) => eventMap.set(t.id, []));

    for (const r of reservations) {
      const event: TimelineEvent = {
        type: 'reservation',
        id: r.id,
        startTime: r.startTime,
        endTime: r.endTime,
        guestName: r.guestName,
        guestCount: r.guestCount,
        status: r.status,
        isVIP: r.isVIP,
      };
      for (const rt of r.tables) {
        eventMap.get(rt.tableId)?.push(event);
      }
    }

    for (const w of walkIns) {
      if (!w.seatedAt) continue;
      const event: TimelineEvent = {
        type: 'walkin',
        id: w.id,
        startTime: w.seatedAt,
        endTime: w.departedAt ?? addMinutes(w.seatedAt, 90),
        guestName: w.guestName ?? 'Walk-in',
        guestCount: w.guestCount,
      };
      for (const wt of w.tables) {
        eventMap.get(wt.tableId)?.push(event);
      }
    }

    const rows: TimelineRow[] = tables.map((t) => ({
      tableId: t.id,
      tableNumber: t.tableNumber,
      zoneType: t.zone.type,
      events: (eventMap.get(t.id) ?? []).sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      ),
    }));

    return { windowStart: windowStartUTC, windowEnd: windowEndUTC, rows };
  }
}
