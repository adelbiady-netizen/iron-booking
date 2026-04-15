/**
 * Finds valid table combinations for a given party size from a set of free tables.
 * Combinations are tried smallest-first to minimize wasted capacity.
 */

import type { TableWithZone, TableCombinationCandidate } from '../../types/table.types';
import { COMBO } from '../../config/constants';

export class TableCombinator {
  /**
   * Generate all valid table combinations from freeTables that can seat guestCount.
   * Results are sorted by combined capacity ascending (tightest fit first),
   * then by adjacency score descending.
   */
  static findCombinations(
    freeTables: TableWithZone[],
    guestCount: number,
    maxTables: number = COMBO.MAX_TABLES,
  ): TableCombinationCandidate[] {
    const combinable = freeTables.filter((t) => t.isCombinable);
    const results: TableCombinationCandidate[] = [];

    for (let size = 2; size <= Math.min(maxTables, combinable.length); size++) {
      const subsets = this.subsetsOfSize(combinable, size);
      for (const subset of subsets) {
        const combinedMax = subset.reduce((s, t) => s + t.maxCapacity, 0);
        if (combinedMax < guestCount) continue;

        results.push({
          tables: subset,
          combinedMinCapacity: subset.reduce((s, t) => s + t.minCapacity, 0),
          combinedMaxCapacity: combinedMax,
          adjacencyScore: this.computeAdjacency(subset),
          isSameCombineGroup: this.allSameGroup(subset),
        });
      }
    }

    return results.sort((a, b) => {
      if (a.combinedMaxCapacity !== b.combinedMaxCapacity) {
        return a.combinedMaxCapacity - b.combinedMaxCapacity; // tightest fit first
      }
      return b.adjacencyScore - a.adjacencyScore; // then closest together
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /** Euclidean adjacency score (0–1) based on floor plan coordinates. */
  private static computeAdjacency(tables: TableWithZone[]): number {
    const hasCoords = tables.every((t) => t.posX != null && t.posY != null);

    if (!hasCoords) {
      // Fall back: same combineGroup implies physical adjacency
      return this.allSameGroup(tables) ? 0.8 : 0.3;
    }

    let maxDist = 0;
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const dx = (tables[i].posX ?? 0) - (tables[j].posX ?? 0);
        const dy = (tables[i].posY ?? 0) - (tables[j].posY ?? 0);
        maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
      }
    }

    if (maxDist <= COMBO.NEAR_THRESHOLD) return 1.0;
    if (maxDist >= COMBO.FAR_THRESHOLD) return 0.0;
    return 1.0 - (maxDist - COMBO.NEAR_THRESHOLD) / (COMBO.FAR_THRESHOLD - COMBO.NEAR_THRESHOLD);
  }

  private static allSameGroup(tables: TableWithZone[]): boolean {
    const group = tables[0].combineGroup;
    if (!group) return false;
    return tables.every((t) => t.combineGroup === group);
  }

  /** Generate all subsets of exactly `size` elements from `arr`. */
  private static subsetsOfSize<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];

    const recurse = (start: number, current: T[]): void => {
      if (current.length === size) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i]);
        recurse(i + 1, current);
        current.pop();
      }
    };

    recurse(0, []);
    return result;
  }
}
