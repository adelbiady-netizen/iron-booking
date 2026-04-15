/**
 * Orchestrates table selection for a booking request.
 * Fetches candidate tables from DB, runs scoring, returns ranked assignments.
 */

import type { ZoneType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { TableWithZone } from '../../types/table.types';
import type { TableAssignment } from '../../types/reservation.types';
import { TableScorer } from './TableScorer';
import { TableCombinator } from './TableCombinator';

export interface AssignmentRequest {
  restaurantId: string;
  guestCount: number;
  occupiedTableIds: Set<string>;
  preferredZone?: ZoneType;
  preferredTableId?: string;
  isVIP: boolean;
}

export class TableAssignmentService {
  /**
   * Returns the best TableAssignment (and up to 4 alternatives) for the request.
   * Returns null if no table/combination can seat the party.
   */
  static async assign(req: AssignmentRequest): Promise<{
    best: TableAssignment;
    alternatives: TableAssignment[];
  } | null> {
    const allTables = await this.loadTables(req.restaurantId);
    const freeTables = allTables.filter((t) => !req.occupiedTableIds.has(t.id));

    // Occupancy fractions for scoring
    const { restaurantOccupancy, zoneOccupancyMap } = this.computeOccupancy(
      allTables,
      req.occupiedTableIds,
    );

    const ctx = {
      guestCount: req.guestCount,
      preferredZone: req.preferredZone,
      preferredTableId: req.preferredTableId,
      isVIP: req.isVIP,
      restaurantMaxPartySize: Math.max(...allTables.map((t) => t.maxCapacity), 1),
      currentOccupancyFraction: restaurantOccupancy,
      zoneOccupancyFraction: req.preferredZone ? (zoneOccupancyMap[req.preferredZone] ?? 0) : 0,
    };

    const candidates: TableAssignment[] = [];

    // 1. Single tables that fit
    for (const table of freeTables) {
      if (table.maxCapacity >= req.guestCount) {
        candidates.push(TableScorer.scoreSingleTable(table, ctx));
      }
    }

    // 2. Combinations if no single table fits (or if combos score higher)
    if (candidates.length === 0) {
      const combos = TableCombinator.findCombinations(freeTables, req.guestCount);
      for (const combo of combos) {
        // Use the zone of the first (primary) table for zone-scoring
        const primaryZone = combo.tables[0].zoneType;
        const comboCtx = {
          ...ctx,
          zoneOccupancyFraction: zoneOccupancyMap[primaryZone] ?? 0,
        };
        candidates.push(TableScorer.scoreCombination(combo, comboCtx));
      }
    }

    if (candidates.length === 0) return null;

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    return {
      best: candidates[0],
      alternatives: candidates.slice(1, 5),
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private static async loadTables(restaurantId: string): Promise<TableWithZone[]> {
    const rows = await prisma.table.findMany({
      where: { restaurantId, isActive: true },
      include: { zone: { select: { type: true } } },
    });

    return rows.map((t) => ({
      id: t.id,
      restaurantId: t.restaurantId,
      zoneId: t.zoneId,
      zoneType: t.zone.type,
      tableNumber: t.tableNumber,
      shape: t.shape,
      minCapacity: t.minCapacity,
      idealCapacity: t.idealCapacity,
      maxCapacity: t.maxCapacity,
      isCombinable: t.isCombinable,
      combineGroup: t.combineGroup,
      posX: t.posX,
      posY: t.posY,
      isActive: t.isActive,
    }));
  }

  private static computeOccupancy(
    allTables: TableWithZone[],
    occupiedIds: Set<string>,
  ): { restaurantOccupancy: number; zoneOccupancyMap: Partial<Record<ZoneType, number>> } {
    if (allTables.length === 0) {
      return { restaurantOccupancy: 0, zoneOccupancyMap: {} };
    }

    const restaurantOccupancy = occupiedIds.size / allTables.length;

    const zoneMap: Partial<Record<ZoneType, { total: number; occupied: number }>> = {};
    for (const t of allTables) {
      const z = zoneMap[t.zoneType] ?? { total: 0, occupied: 0 };
      z.total++;
      if (occupiedIds.has(t.id)) z.occupied++;
      zoneMap[t.zoneType] = z;
    }

    const zoneOccupancyMap: Partial<Record<ZoneType, number>> = {};
    for (const [zone, counts] of Object.entries(zoneMap)) {
      zoneOccupancyMap[zone as ZoneType] = counts.total > 0 ? counts.occupied / counts.total : 0;
    }

    return { restaurantOccupancy, zoneOccupancyMap };
  }
}
