import { prisma } from '../lib/prisma';
import { getTableAvailability, parseTimeOnDate } from './availability';
import { addMinutes } from 'date-fns';
import { Table, TableCombination, Section } from '@prisma/client';

export interface TableSuggestion {
  type: 'single' | 'combination';
  tableId?: string;
  combinationId?: string;
  tableName: string;
  sectionName: string;
  minCovers: number;
  maxCovers: number;
  score: number;
  reasons: string[];
  warnings: string[];
}

interface MatchContext {
  restaurantId: string;
  date: Date;
  time: string;
  partySize: number;
  durationMinutes: number;
  bufferMinutes: number;
  occasion?: string;
  preferenceNotes?: string;
  guestIsVip?: boolean;
}

type TableWithSection = Table & { section: Section | null };
type CombinationWithTables = TableCombination & {
  tableA: TableWithSection;
  tableB: TableWithSection;
};

/**
 * Returns ranked table suggestions for a given reservation context.
 * Scoring factors:
 *   - Capacity fit (prefer tables closest to party size without excess)
 *   - Availability (no conflicts)
 *   - VIP preference (better positioned tables score higher for VIPs)
 *   - Occasion bonuses (booths for birthdays, window seats for anniversaries)
 *   - Turn utilization (prefer tables that won't leave awkward gaps)
 */
export async function suggestTables(ctx: MatchContext): Promise<TableSuggestion[]> {
  const [tables, combinations, restaurantSettings] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId: ctx.restaurantId, isActive: true },
      include: { section: true },
    }),
    prisma.tableCombination.findMany({
      where: { restaurantId: ctx.restaurantId, isActive: true },
      include: {
        tableA: { include: { section: true } },
        tableB: { include: { section: true } },
      },
    }),
    prisma.restaurant.findUniqueOrThrow({
      where: { id: ctx.restaurantId },
      select: { settings: true },
    }),
  ]);

  const availability = await getTableAvailability(
    ctx.restaurantId,
    ctx.date,
    ctx.time,
    ctx.durationMinutes,
    ctx.bufferMinutes
  );

  const availableIds = new Set(
    availability.filter((a) => a.isAvailable).map((a) => a.tableId)
  );

  const suggestions: TableSuggestion[] = [];

  // Score single tables
  for (const table of tables as TableWithSection[]) {
    if (table.minCovers > ctx.partySize || table.maxCovers < ctx.partySize) continue;
    if (!availableIds.has(table.id)) continue;

    const { score, reasons, warnings } = scoreTable(table, ctx);
    suggestions.push({
      type: 'single',
      tableId: table.id,
      tableName: table.name,
      sectionName: table.section?.name ?? 'Unknown',
      minCovers: table.minCovers,
      maxCovers: table.maxCovers,
      score,
      reasons,
      warnings,
    });
  }

  // Score table combinations
  for (const combo of combinations as CombinationWithTables[]) {
    if (combo.minCovers > ctx.partySize || combo.maxCovers < ctx.partySize) continue;
    if (!availableIds.has(combo.tableAId) || !availableIds.has(combo.tableBId)) continue;

    const { score, reasons, warnings } = scoreCombo(combo, ctx);
    suggestions.push({
      type: 'combination',
      combinationId: combo.id,
      tableName: combo.name,
      sectionName: combo.tableA.section?.name ?? 'Unknown',
      minCovers: combo.minCovers,
      maxCovers: combo.maxCovers,
      score,
      reasons,
      warnings,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score);
}

function scoreTable(
  table: TableWithSection,
  ctx: MatchContext
): { score: number; reasons: string[]; warnings: string[] } {
  let score = 100;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Capacity fit: perfect fit = bonus, over-seated = penalty
  const excess = table.maxCovers - ctx.partySize;
  if (excess === 0) {
    score += 20;
    reasons.push('Perfect capacity fit');
  } else if (excess <= 1) {
    score += 10;
    reasons.push('Good capacity fit');
  } else if (excess >= 3) {
    score -= excess * 5;
    warnings.push(`Table seats ${table.maxCovers} — ${excess} seats will be empty`);
  }

  // VIP gets best placement (scored tables in "good" sections)
  if (ctx.guestIsVip) {
    if (table.section?.name?.toLowerCase().includes('main')) {
      score += 15;
      reasons.push('Prime section for VIP');
    }
    if (table.section?.name?.toLowerCase().includes('private')) {
      score += 25;
      reasons.push('Private section for VIP');
    }
  }

  // Occasion-specific bonuses
  if (ctx.occasion) {
    if (ctx.occasion === 'birthday' && table.shape === 'BOOTH') {
      score += 15;
      reasons.push('Booth preferred for celebrations');
    }
    if (ctx.occasion === 'anniversary') {
      if (table.notes?.toLowerCase().includes('window')) {
        score += 20;
        reasons.push('Window table for anniversary');
      }
    }
  }

  // Patio in summer (basic heuristic — can be enhanced with season config)
  const month = ctx.date.getMonth();
  const isSummerMonth = month >= 4 && month <= 9;
  if (table.section?.name?.toLowerCase().includes('patio') && isSummerMonth) {
    score += 5;
    reasons.push('Patio available in season');
  }

  // Bar section slight penalty for large parties
  if (table.section?.name?.toLowerCase().includes('bar') && ctx.partySize > 4) {
    score -= 10;
    warnings.push('Bar section may not be ideal for large groups');
  }

  return { score, reasons, warnings };
}

function scoreCombo(
  combo: CombinationWithTables,
  ctx: MatchContext
): { score: number; reasons: string[]; warnings: string[] } {
  let score = 80; // combinations are slightly penalized vs single tables
  const reasons: string[] = ['Combined table setup'];
  const warnings: string[] = ['Requires staff to combine tables before seating'];

  const excess = combo.maxCovers - ctx.partySize;
  if (excess === 0) {
    score += 15;
    reasons.push('Perfect capacity fit');
  } else if (excess >= 3) {
    score -= excess * 3;
    warnings.push(`Combination seats ${combo.maxCovers} — ${excess} seats will be empty`);
  }

  if (ctx.guestIsVip && combo.tableA.section?.name?.toLowerCase().includes('private')) {
    score += 20;
    reasons.push('Private section for VIP');
  }

  return { score, reasons, warnings };
}
