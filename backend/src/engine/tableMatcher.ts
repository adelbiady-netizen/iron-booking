import { prisma } from '../lib/prisma';
import { parseTimeOnDate } from './availability';
import { addMinutes, areIntervalsOverlapping } from 'date-fns';
import { Table, Section } from '@prisma/client';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ScoredReason =
  | { code: 'CONFLICT'; at?: string }
  | { code: 'TOO_SMALL' }
  | { code: 'TABLE_BLOCKED' }
  | { code: 'PERFECT_FIT' }
  | { code: 'GOOD_FIT' }
  | { code: 'LARGE_TABLE'; excess: number; partySize: number }
  | { code: 'GAP_BEFORE_TIGHT'; prevTime: string; gapMins: number }
  | { code: 'GAP_AFTER_TIGHT'; nextTime: string; gapMins: number }
  | { code: 'GAP_BEFORE_WARN'; prevTime: string }
  | { code: 'GAP_AFTER_WARN'; nextTime: string };

export type TablePickerStatus = 'recommended' | 'possible' | 'tight' | 'blocked';

export interface TableSuggestion {
  type: 'single';
  tableId: string;
  tableName: string;
  sectionName: string;
  minCovers: number;
  maxCovers: number;
  score: number;
  status: TablePickerStatus;
  reasons: ScoredReason[];
  prevRes?: { guestName: string; time: string; partySize: number };
  nextRes?: { guestName: string; time: string; partySize: number };
}

interface MatchContext {
  restaurantId: string;
  date: Date;
  time: string;
  partySize: number;
  durationMinutes: number;
  bufferMinutes: number;
  excludeReservationId?: string;
}

type TableWithSection = Table & { section: Section | null };

const STATUS_ORDER: Record<TablePickerStatus, number> = {
  recommended: 0,
  possible: 1,
  tight: 2,
  blocked: 3,
};

/**
 * Returns scored table suggestions for a given reservation context.
 *
 * All active tables are returned (including blocked/tight) so the host
 * can see every option with a clear explanation. The caller must sort/filter.
 *
 * Scoring factors:
 *   - Capacity fit (exact = best, excess ≥ 4 = penalty)
 *   - Conflict detection with buffer
 *   - Turn gap analysis: physical gap to prev/next reservation at this table
 *     - < 15 min gap → "tight"
 *     - < 30 min gap → "possible" (warn)
 *     - ≥ 30 min gap → no penalty (healthy turn window)
 */
export async function suggestTables(ctx: MatchContext): Promise<TableSuggestion[]> {
  const slotStart = parseTimeOnDate(ctx.date, ctx.time);
  const slotEnd = addMinutes(slotStart, ctx.durationMinutes);
  const bufferedStart = addMinutes(slotStart, -ctx.bufferMinutes);
  const bufferedEnd = addMinutes(slotEnd, ctx.bufferMinutes);

  const [tables, dayReservations, blocks] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId: ctx.restaurantId, isActive: true },
      include: { section: true },
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId: ctx.restaurantId,
        date: ctx.date,
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
        tableId: { not: null },
        ...(ctx.excludeReservationId ? { id: { not: ctx.excludeReservationId } } : {}),
      },
      select: {
        id: true,
        tableId: true,
        combinedTableIds: true,
        time: true,
        duration: true,
        guestName: true,
        partySize: true,
        status: true,
      },
    }),
    prisma.blockedPeriod.findMany({
      where: {
        restaurantId: ctx.restaurantId,
        startTime: { lt: bufferedEnd },
        endTime: { gt: bufferedStart },
      },
    }),
  ]);

  const suggestions: TableSuggestion[] = [];

  for (const table of tables as TableWithSection[]) {
    const base = {
      type: 'single' as const,
      tableId: table.id,
      tableName: table.name,
      sectionName: table.section?.name ?? '',
      minCovers: table.minCovers,
      maxCovers: table.maxCovers,
    };

    // ── Capacity gate ──────────────────────────────────────────────────────────
    if (table.maxCovers < ctx.partySize) {
      suggestions.push({ ...base, score: 0, status: 'blocked', reasons: [{ code: 'TOO_SMALL' }] });
      continue;
    }

    // ── Block gate ────────────────────────────────────────────────────────────
    const block = blocks.find(b => b.tableId === table.id || b.tableId === null);
    if (block) {
      suggestions.push({ ...base, score: 0, status: 'blocked', reasons: [{ code: 'TABLE_BLOCKED' }] });
      continue;
    }

    // ── Reservations for this table, sorted by start time ─────────────────────
    const tableResv = dayReservations
      .filter(r => r.tableId === table.id || r.combinedTableIds.includes(table.id))
      .map(r => {
        const startDate = parseTimeOnDate(ctx.date, r.time);
        const endDate = addMinutes(startDate, r.duration);
        return { ...r, startMs: startDate.getTime(), endMs: endDate.getTime() };
      })
      .sort((a, b) => a.startMs - b.startMs);

    // ── Conflict check (with buffer) ───────────────────────────────────────────
    const conflict = tableResv.find(r => {
      const rStart = parseTimeOnDate(ctx.date, r.time);
      const rEnd = addMinutes(rStart, r.duration + ctx.bufferMinutes);
      return areIntervalsOverlapping(
        { start: bufferedStart, end: bufferedEnd },
        { start: rStart, end: rEnd },
      );
    });

    if (conflict) {
      suggestions.push({
        ...base,
        score: 0,
        status: 'blocked',
        reasons: [{ code: 'CONFLICT', at: conflict.time }],
      });
      continue;
    }

    // ── Gap analysis ──────────────────────────────────────────────────────────
    const slotStartMs = slotStart.getTime();
    const slotEndMs = slotEnd.getTime();

    // Previous: latest reservation ending at or before slot start
    const prevR = tableResv.filter(r => r.endMs <= slotStartMs).at(-1);
    // Next: earliest reservation starting at or after slot end
    const nextR = tableResv.find(r => r.startMs >= slotEndMs);

    const reasons: ScoredReason[] = [];
    let status: TablePickerStatus = 'recommended';
    let score = 100;

    // Capacity scoring
    const excess = table.maxCovers - ctx.partySize;
    if (excess === 0) {
      reasons.push({ code: 'PERFECT_FIT' });
      score += 20;
    } else if (excess <= 2) {
      reasons.push({ code: 'GOOD_FIT' });
      score += 10;
    } else if (excess >= 4) {
      reasons.push({ code: 'LARGE_TABLE', excess, partySize: ctx.partySize });
      score -= excess * 5;
      if (status === 'recommended') status = 'possible';
    }

    // Gap before (physical gap, no buffer)
    if (prevR) {
      const gapMins = Math.round((slotStartMs - prevR.endMs) / 60_000);
      if (gapMins < 15) {
        reasons.push({ code: 'GAP_BEFORE_TIGHT', prevTime: prevR.time, gapMins });
        status = 'tight';
        score -= 40;
      } else if (gapMins < 30) {
        reasons.push({ code: 'GAP_BEFORE_WARN', prevTime: prevR.time });
        score -= 10;
        if (status === 'recommended') status = 'possible';
      }
    }

    // Gap after (physical gap, no buffer)
    if (nextR) {
      const gapMins = Math.round((nextR.startMs - slotEndMs) / 60_000);
      if (gapMins < 15) {
        reasons.push({ code: 'GAP_AFTER_TIGHT', nextTime: nextR.time, gapMins });
        status = 'tight';
        score -= 40;
      } else if (gapMins < 30) {
        reasons.push({ code: 'GAP_AFTER_WARN', nextTime: nextR.time });
        score -= 10;
        if (status === 'recommended') status = 'possible';
      }
    }

    suggestions.push({
      ...base,
      score,
      status,
      reasons,
      prevRes: prevR ? { guestName: prevR.guestName, time: prevR.time, partySize: prevR.partySize } : undefined,
      nextRes: nextR ? { guestName: nextR.guestName, time: nextR.time, partySize: nextR.partySize } : undefined,
    });
  }

  return suggestions.sort((a, b) => {
    const od = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return od !== 0 ? od : b.score - a.score;
  });
}
