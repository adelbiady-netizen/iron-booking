/**
 * Scores table assignments for a given reservation request.
 *
 * Scoring is deterministic and side-effect free — all inputs are passed in,
 * no database calls here. The service layer fetches data and then calls score().
 */

import type { ZoneType } from '@prisma/client';
import type { TableWithZone, TableCombinationCandidate } from '../../types/table.types';
import type { TableAssignment, ScoreBreakdown, AssignedTable } from '../../types/reservation.types';
import { SCORING_WEIGHTS, COMBO } from '../../config/constants';

interface ScoringContext {
  guestCount: number;
  preferredZone?: ZoneType;
  preferredTableId?: string;
  isVIP: boolean;
  restaurantMaxPartySize: number;
  /** 0.0–1.0 fraction of restaurant tables currently occupied */
  currentOccupancyFraction: number;
  /** 0.0–1.0 fraction of this zone currently occupied */
  zoneOccupancyFraction: number;
}

export class TableScorer {
  /**
   * Score a single-table assignment.
   */
  static scoreSingleTable(
    table: TableWithZone,
    ctx: ScoringContext,
  ): TableAssignment {
    const breakdown = this.buildBreakdown(
      [table],
      false,
      ctx,
    );
    return this.toAssignment([table], false, breakdown);
  }

  /**
   * Score a combination assignment.
   */
  static scoreCombination(
    combo: TableCombinationCandidate,
    ctx: ScoringContext,
  ): TableAssignment {
    const breakdown = this.buildBreakdown(combo.tables, true, ctx, combo);
    return this.toAssignment(combo.tables, true, breakdown);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private static buildBreakdown(
    tables: TableWithZone[],
    isCombination: boolean,
    ctx: ScoringContext,
    combo?: TableCombinationCandidate,
  ): ScoreBreakdown {
    const totalCapacity = tables.reduce((s, t) => s + t.maxCapacity, 0);
    const primaryTable = tables[0];

    const fitScore = this.computeFitScore(
      ctx.guestCount,
      tables.map((t) => t.idealCapacity).reduce((s, c) => s + c, 0),
      totalCapacity,
      ctx.restaurantMaxPartySize,
    );

    const zoneScore = this.computeZoneScore(primaryTable.zoneType, ctx.preferredZone);

    const vipScore = this.computeVIPScore(primaryTable.zoneType, ctx.isVIP);

    const comboScore = isCombination && combo
      ? this.computeComboScore(combo)
      : 0;

    const utilizationScore = this.computeUtilizationScore(
      ctx.currentOccupancyFraction,
      ctx.zoneOccupancyFraction,
    );

    const preferredBonus =
      ctx.preferredTableId && tables.some((t) => t.id === ctx.preferredTableId)
        ? SCORING_WEIGHTS.PREFERRED
        : 0;

    const total = Math.max(
      0,
      Math.min(
        100,
        fitScore + zoneScore + vipScore + comboScore + utilizationScore + preferredBonus,
      ),
    );

    return { fitScore, zoneScore, vipScore, comboScore, utilizationScore, preferredBonus, total };
  }

  private static computeFitScore(
    guestCount: number,
    combinedIdeal: number,
    combinedMax: number,
    maxPartySize: number,
  ): number {
    const W = SCORING_WEIGHTS.FIT;
    const wastage = combinedIdeal - guestCount;

    if (wastage < 0) {
      // Over-capacity squeeze — party > ideal but ≤ max (already enforced upstream)
      const overRatio = guestCount / combinedIdeal - 1; // 0.0 → N
      return Math.max(0, W - overRatio * 80);
    }

    if (wastage === 0) return W;

    // Under-capacity — mild penalty per wasted seat
    const penaltyPerSeat = W / maxPartySize;
    return Math.max(0, W - wastage * penaltyPerSeat);
  }

  private static computeZoneScore(tableZone: ZoneType, preferred?: ZoneType): number {
    const W = SCORING_WEIGHTS.ZONE;
    if (!preferred) return W / 2; // neutral: no preference expressed

    if (tableZone === preferred) return W;

    // Compatible zones — partial credit
    const compatible: Partial<Record<ZoneType, ZoneType[]>> = {
      OUTDOOR: ['PATIO'],
      PATIO: ['OUTDOOR'],
    };

    if (compatible[preferred]?.includes(tableZone)) return W / 2;
    return 0;
  }

  private static computeVIPScore(tableZone: ZoneType, isVIP: boolean): number {
    if (!isVIP) return 0;
    const W = SCORING_WEIGHTS.VIP;
    const ranking: Record<ZoneType, number> = {
      PRIVATE: W,
      INDOOR: Math.round(W * 0.67),
      PATIO: Math.round(W * 0.33),
      OUTDOOR: Math.round(W * 0.2),
      BAR: 0,
    };
    return ranking[tableZone];
  }

  private static computeComboScore(combo: TableCombinationCandidate): number {
    let score = SCORING_WEIGHTS.COMBO_BASE; // starts at -10

    if (combo.isSameCombineGroup) {
      score += COMBO.SAME_GROUP_RECOVERY; // → -5
    }

    // Adjacency bonus (0–3 pts)
    score += Math.round(combo.adjacencyScore * COMBO.MAX_ADJACENCY_BONUS);

    return score; // final range: -10 to -2
  }

  private static computeUtilizationScore(
    restaurantOccupancy: number,
    zoneOccupancy: number,
  ): number {
    const W = SCORING_WEIGHTS.UTILIZATION;
    if (restaurantOccupancy >= 0.8) return W; // full-house: every available table is precious
    if (restaurantOccupancy < 0.6) return Math.round(zoneOccupancy * W); // cluster strategy
    return Math.round(W * 0.5); // neutral band
  }

  private static toAssignment(
    tables: TableWithZone[],
    isCombination: boolean,
    breakdown: ScoreBreakdown,
  ): TableAssignment {
    const assigned: AssignedTable[] = tables.map((t, i) => ({
      tableId: t.id,
      tableNumber: t.tableNumber,
      zoneType: t.zoneType,
      minCapacity: t.minCapacity,
      idealCapacity: t.idealCapacity,
      maxCapacity: t.maxCapacity,
      isPrimary: i === 0,
    }));

    return {
      tables: assigned,
      totalCapacity: tables.reduce((s, t) => s + t.maxCapacity, 0),
      isCombination,
      score: breakdown.total,
      scoreBreakdown: breakdown,
    };
  }
}
