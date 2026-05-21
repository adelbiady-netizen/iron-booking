import { prisma } from '../../lib/prisma';
import { Prisma, ReservationStatus } from '@prisma/client';
import { addMinutes } from 'date-fns';
import { NotFoundError, BusinessRuleError, ConflictError } from '../../lib/errors';
import { suggestTables } from '../../engine/tableMatcher';
import { parseTimeOnDate, ACTIVE_STATUSES, reservationIsUpcoming, RESERVED_SOON_MINUTES, NO_SHOW_AFTER_MINUTES } from '../../engine/occupancy';

// ─── Floor State ─────────────────────────────────────────────────────────────
// Returns all tables with their live status for a given date/time.
// This is what powers the host's table board.

export async function getFloorState(restaurantId: string, date: Date, time: string) {
  // Hoist slotTime so the blocks query can use the correct interval window.
  // Using a conservative lookahead (max turn 120 min + buffer 15 min = 135 min)
  // ensures we capture any blocked period that a new assignment would overlap,
  // matching getTableAvailability() semantics.  Per-table filtering below uses
  // the real settings to avoid false positives.
  const slotTime = parseTimeOnDate(date, time);

  const [tables, reservations, blocks, restaurantRow] = await Promise.all([
    prisma.table.findMany({
      where: { restaurantId, isActive: true },
      include: { section: true },
      orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date,
        status: { in: [...ACTIVE_STATUSES] as ReservationStatus[] },
      },
      select: {
        id: true,
        restaurantId: true,
        tableId: true,
        combinedTableIds: true,
        guestName: true,
        partySize: true,
        date: true,
        time: true,
        duration: true,
        status: true,
        source: true,
        seatedAt: true,
        isArrived: true,
        returnedToListAt: true,
        reorganizeAt: true,
        reorganizeFromTableId: true,
        reorganizeBySeatingId: true,
        guestId: true,
        guest: { select: { id: true, firstName: true, lastName: true, isVip: true } },
      },
    }),
    // Fetch blocks that could overlap any turn starting at slotTime.
    // This is an interval check (not a point-in-time check) so a block that
    // starts after slotTime but within a normal turn's window is also captured,
    // aligning with getTableAvailability()'s effective-slot overlap check.
    prisma.blockedPeriod.findMany({
      where: {
        restaurantId,
        startTime: { lt: addMinutes(slotTime, 135) },  // 120 max turn + 15 buffer
        endTime:   { gt: addMinutes(slotTime, -15) },  // 15 min pre-slot buffer
      },
    }),
    prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { settings: true, timezone: true },
    }),
  ]);

  const settings        = (restaurantRow?.settings as Record<string, unknown>) ?? {};
  const bufferMinutes   = (settings.bufferBetweenTurnsMinutes as number) ?? 15;
  const defaultDuration = (settings.defaultTurnMinutes       as number) ?? 90;
  // Use restaurant timezone for the real-now comparison — the server runs in UTC
  // on Render, so new Date().getHours() returns UTC, not restaurant-local time.
  // Without this fix, slotTime > realNowVirtual is true during live service for
  // any UTC+ restaurant, causing releasedForPlanning to fire incorrectly and
  // releasing still-occupied SEATED tables as AVAILABLE on the live board.
  const timezone        = (restaurantRow?.timezone as string) ?? 'UTC';
  const realNowStr      = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const realNowVirtual  = parseTimeOnDate(date, realNowStr);

  // Stale-board detection: is the board date strictly before today in the restaurant's timezone?
  // Used below to surface forgotten SEATED reservations as STALE_OCCUPIED rather than emergency red.
  const todayLocal     = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  const boardDateStr   = (date instanceof Date ? date : new Date(String(date))).toISOString().slice(0, 10);
  const isStaleBoardDate = boardDateStr < todayLocal;

  // A table is "placed" only when BOTH axes are meaningfully positioned (> 5 px).
  // Using AND (not OR) prevents a table dragged along one axis only — e.g. (100, 0)
  // — from passing the filter and ghosting onto the canvas.
  const positionedTables = tables.filter(t => t.posX > 5 && t.posY > 5);
  const effectiveTables  = positionedTables.length > 0 ? positionedTables : tables;

  const requiredGapMinutes = defaultDuration + bufferMinutes;

  // Pre-index reservations by table ID (primary + combined) so each per-table
  // lookup below is O(1) rather than a full O(m) scan through all reservations.
  type TableRes = (typeof reservations)[number];
  const resByTableId = new Map<string, TableRes[]>();
  for (const r of reservations) {
    const ids: string[] = [];
    if (r.tableId) ids.push(r.tableId);
    for (const cid of r.combinedTableIds) ids.push(cid);
    for (const id of ids) {
      const list = resByTableId.get(id);
      if (list) list.push(r); else resByTableId.set(id, [r]);
    }
  }

  return effectiveTables.map((table) => {
    // Respect lockedUntil expiry without a DB write
    const effectiveLocked = table.locked && (!table.lockedUntil || table.lockedUntil > slotTime);

    const tableReservations = resByTableId.get(table.id) ?? [];

    // Gap analysis: next non-SEATED reservation starting strictly after slotTime.
    // Used by the frontend scoring layer to gate "Best fit" on canFitIncomingTurn.
    const nextFutureRes = tableReservations
      .filter(r => r.status !== 'SEATED' && parseTimeOnDate(date, r.time) > slotTime)
      .sort((a, b) => a.time.localeCompare(b.time))[0] ?? null;
    const nextReservationStart = nextFutureRes
      ? parseTimeOnDate(date, nextFutureRes.time).toISOString()
      : null;
    const effectiveGapMinutes = nextFutureRes
      ? Math.round((parseTimeOnDate(date, nextFutureRes.time).getTime() - slotTime.getTime()) / 60_000)
      : null;
    const canFitIncomingTurn = effectiveGapMinutes === null || effectiveGapMinutes >= requiredGapMinutes;

    // Check blocks: does any block overlap the effective assignment window?
    const effectiveBlockStart = addMinutes(slotTime, -bufferMinutes);
    const effectiveBlockEnd   = addMinutes(slotTime, defaultDuration + bufferMinutes);
    const block = blocks.find(
      (b) => (b.tableId === table.id || b.tableId === null)
          && b.startTime < effectiveBlockEnd
          && b.endTime   > effectiveBlockStart
    );
    if (block) {
      return {
        ...table,
        locked: effectiveLocked,
        liveStatus: 'BLOCKED' as const,
        blockReason: block.reason,
        blockType: block.type,
        currentReservation: null,
        upcomingReservations: [],
        nextReservationStart,
        effectiveGapMinutes,
        requiredGapMinutes,
        canFitIncomingTurn,
      };
    }

    // A SEATED reservation keeps the table OCCUPIED until the host manually
    // completes it — time expiry never auto-clears the table on the live board.
    // For future-planning boardTimes (slotTime is ≥5 min ahead of real wall-clock
    // AND past the turn's scheduled end+buffer) the table is released so hosts
    // can plan ahead. The 5-minute threshold prevents 1-min HH:mm rounding jitter
    // from releasing a SEATED table during live service (ghost-SEATED bug).
    const seated = tableReservations.find(r => r.status === 'SEATED');
    if (seated) {
      const seatedScheduledEnd  = addMinutes(parseTimeOnDate(date, seated.time), seated.duration);

      // Previous-service stale: the board is showing a past date and this SEATED
      // reservation was never completed.  Do NOT show it as emergency red —
      // return STALE_OCCUPIED so the frontend can render a low-urgency amber state.
      // No DB write; the reservation stays SEATED for the host to manually resolve.
      if (isStaleBoardDate) {
        return {
          ...table,
          locked: effectiveLocked,
          liveStatus: 'STALE_OCCUPIED' as const,
          currentReservation: {
            ...seated,
            minutesRemaining: 0,
            expectedEndTime: seatedScheduledEnd.toISOString(),
            isOverdue: false,
          },
          upcomingReservations: [],
          nextReservationStart,
          effectiveGapMinutes,
          requiredGapMinutes,
          canFitIncomingTurn,
        };
      }
      // Mirror reservationConflicts() backward boundary: resEnd ≤ slotTime − buffer → no conflict.
      const seatedClearedBuffer = seatedScheduledEnd <= addMinutes(slotTime, -bufferMinutes);
      // Require slotTime ≥ realNow + 5 min to enter planning mode — prevents live-board jitter.
      const releasedForPlanning = seatedClearedBuffer && slotTime >= addMinutes(realNowVirtual, 5);

      if (!releasedForPlanning) {
        const seatedAtMs    = new Date(seated.seatedAt!).getTime();
        const expectedEndMs = seatedAtMs + seated.duration * 60_000;
        const minutesRemaining = Math.round((expectedEndMs - Date.now()) / 60_000);
        const isOverdue = minutesRemaining < 0;
        return {
          ...table,
          locked: effectiveLocked,
          liveStatus: 'OCCUPIED' as const,
          currentReservation: {
            ...seated,
            minutesRemaining,
            expectedEndTime: new Date(expectedEndMs).toISOString(),
            isOverdue,
          },
          upcomingReservations: [],
          nextReservationStart,
          effectiveGapMinutes,
          requiredGapMinutes,
          canFitIncomingTurn,
        };
      }
      // releasedForPlanning=true: fall through to upcoming / AVAILABLE logic.
      // The upcoming filter below excludes SEATED status, so this turn won't
      // reappear there; the next PENDING/CONFIRMED reservation (if any) surfaces
      // correctly as RESERVED or RESERVED_SOON.
    }

    // Find all non-SEATED reservations that should mark this table non-AVAILABLE.
    // Use a full 24-hour planning horizon instead of defaultDuration so that ALL
    // of today's future reservations are consistently visible at any board time.
    // The old defaultDuration cap (e.g. 240 min) created a hard horizon: a 19:30
    // reservation silently disappeared at board time 15:00 while a 19:00 one
    // still showed — purely because it fell 15 minutes past the cutoff. Reservations
    // are already date-scoped by the caller, so 1440 min covers any service day.
    const upcoming = tableReservations
      .filter(r => r.status !== 'SEATED' && reservationIsUpcoming(r, date, slotTime, bufferMinutes, 24 * 60))
      .sort((a, b) => a.time.localeCompare(b.time));

    const nextRes = upcoming[0];
    if (nextRes) {
      const nextTime = parseTimeOnDate(date, nextRes.time);
      const minutesUntil = Math.round(
        (nextTime.getTime() - slotTime.getTime()) / 60000
      );
      return {
        ...table,
        locked: effectiveLocked,
        liveStatus: minutesUntil <= RESERVED_SOON_MINUTES ? ('RESERVED_SOON' as const) : ('RESERVED' as const),
        currentReservation: null,
        upcomingReservations: upcoming.slice(0, 3).map((r) => ({
          ...r,
          minutesUntil: Math.round(
            (parseTimeOnDate(date, r.time).getTime() - slotTime.getTime()) / 60000
          ),
        })),
        nextReservationStart,
        effectiveGapMinutes,
        requiredGapMinutes,
        canFitIncomingTurn,
      };
    }

    return {
      ...table,
      locked: effectiveLocked,
      liveStatus: 'AVAILABLE' as const,
      currentReservation: null,
      upcomingReservations: [],
      nextReservationStart,
      effectiveGapMinutes,
      requiredGapMinutes,
      canFitIncomingTurn,
    };
  });
}

// ─── Table CRUD ───────────────────────────────────────────────────────────────

export async function listTables(restaurantId: string) {
  return prisma.table.findMany({
    where: { restaurantId, isActive: true },
    include: { section: true },
    orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
}

export async function getTable(restaurantId: string, tableId: string) {
  const t = await prisma.table.findUnique({ where: { id: tableId }, include: { section: true } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return t;
}

export async function createTable(restaurantId: string, data: {
  name: string;
  sectionId?: string;
  minCovers: number;
  maxCovers: number;
  shape?: string;
  isCombinable?: boolean;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  rotation?: number;
  turnTimeMinutes?: number;
  notes?: string;
}) {
  return prisma.table.create({
    data: {
      restaurantId,
      name: data.name,
      sectionId: data.sectionId ?? null,
      minCovers: data.minCovers,
      maxCovers: data.maxCovers,
      shape: (data.shape as any) ?? 'RECTANGLE',
      isCombinable: data.isCombinable ?? false,
      posX: data.posX ?? 0,
      posY: data.posY ?? 0,
      width: data.width ?? 80,
      height: data.height ?? 80,
      rotation: data.rotation ?? 0,
      turnTimeMinutes: data.turnTimeMinutes ?? null,
      notes: data.notes ?? null,
    },
    include: { section: true },
  });
}

export async function updateTable(restaurantId: string, tableId: string, data: Prisma.TableUpdateInput) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return prisma.table.update({ where: { id: tableId }, data, include: { section: true } });
}

export async function deleteTable(restaurantId: string, tableId: string) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);

  // Check for active reservations
  const active = await prisma.reservation.count({
    where: { tableId, status: { in: [...ACTIVE_STATUSES] as ReservationStatus[] } },
  });
  if (active > 0) {
    throw new BusinessRuleError('Cannot delete table with active reservations');
  }

  return prisma.table.delete({ where: { id: tableId } });
}

// ─── Block / Unblock ─────────────────────────────────────────────────────────

export async function blockTable(restaurantId: string, data: {
  tableId?: string;
  reason: string;
  type: string;
  startTime: Date;
  endTime: Date;
  createdBy: string;
}) {
  if (data.tableId) {
    const t = await prisma.table.findUnique({ where: { id: data.tableId } });
    if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', data.tableId);
  }

  return prisma.blockedPeriod.create({
    data: {
      restaurantId,
      tableId: data.tableId ?? null,
      reason: data.reason,
      type: data.type as any,
      startTime: data.startTime,
      endTime: data.endTime,
      createdBy: data.createdBy,
    },
  });
}

export async function unblockTable(restaurantId: string, blockId: string) {
  const block = await prisma.blockedPeriod.findUnique({ where: { id: blockId } });
  if (!block || block.restaurantId !== restaurantId) throw new NotFoundError('Block', blockId);
  return prisma.blockedPeriod.delete({ where: { id: blockId } });
}

export async function listBlocks(restaurantId: string, tableId?: string) {
  return prisma.blockedPeriod.findMany({
    where: {
      restaurantId,
      ...(tableId ? { tableId } : {}),
      endTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
  });
}

// ─── Lock / Unlock ───────────────────────────────────────────────────────────

export async function lockTable(restaurantId: string, tableId: string, data: {
  reason?: string | null;
  lockedUntil?: Date | null;
}) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return prisma.table.update({
    where: { id: tableId },
    data: { locked: true, lockReason: data.reason ?? null, lockedUntil: data.lockedUntil ?? null },
    include: { section: true },
  });
}

export async function unlockTable(restaurantId: string, tableId: string) {
  const t = await prisma.table.findUnique({ where: { id: tableId } });
  if (!t || t.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);
  return prisma.table.update({
    where: { id: tableId },
    data: { locked: false, lockReason: null, lockedUntil: null },
    include: { section: true },
  });
}

// ─── Table Suggestions ───────────────────────────────────────────────────────

export async function getTableSuggestions(restaurantId: string, query: {
  date: string;
  time: string;
  partySize: number;
  duration?: number;
  occasion?: string;
  guestIsVip?: boolean;
  excludeReservationId?: string;
}) {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { settings: true },
  });
  const s = restaurant.settings as Record<string, any>;
  const duration = query.duration ?? (query.partySize >= 3 ? 120 : 90);
  const buffer = (s.bufferBetweenTurnsMinutes as number) ?? 15;

  return suggestTables({
    restaurantId,
    date: new Date(query.date + 'T00:00:00.000Z'),
    time: query.time,
    partySize: query.partySize,
    durationMinutes: duration,
    bufferMinutes: buffer,
    excludeReservationId: query.excludeReservationId,
  });
}

// ─── Best Table (Phase 1 auto-allocation) ────────────────────────────────────
// Returns the highest-scoring single table or table combination for a slot,
// or null when no arrangement fits.
//
// Phase 1 rules:
//   1. Prefer a single table (smallest that fits, best score)
//   2. If no single table fits the party, try all 2-table combos (nC2)
//   3. If no pair fits, try all 3-table combos (nC3)
//
// TODO: Phase 2 — full-night optimization across all turns
// TODO: honor owner-defined forbidden combinations
// TODO: preferred combination groups
// TODO: block combinations that cross walking paths
// TODO: zone strategy (keep combinations within one zone)

export type BestTableResult = {
  type: 'single' | 'combined';
  tableIds: string[];
  tableNames: string[];
  score: number;
  reason: string;
};

interface CombinableTable {
  id: string;
  name: string;
  sectionId: string | null;
  maxCovers: number;
  posX: number;
  posY: number;
}

function scoreCombination(tables: CombinableTable[], partySize: number, tableCount: 2 | 3): number {
  const totalMax = tables.reduce((sum, t) => sum + t.maxCovers, 0);
  if (totalMax < partySize) return -1;

  let score = 0;

  // Same section bonus
  const sections = new Set(tables.map(t => t.sectionId));
  if (sections.size === 1) score += 20;

  // Physical distance penalty: max pairwise Euclidean distance, mapped 0–20
  let maxDist = 0;
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const dx = tables[i].posX - tables[j].posX;
      const dy = tables[i].posY - tables[j].posY;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
    }
  }
  score += Math.max(0, 20 - Math.round(maxDist / 15));

  // Minimal capacity waste bonus (0–20)
  const waste = totalMax - partySize;
  score += Math.max(0, 20 - Math.floor(waste / 2));

  // Fewer tables bonus
  if (tableCount === 2) score += 10;

  return score;
}

async function findBestCombination(
  restaurantId: string,
  availableTableIds: string[],
  partySize: number
): Promise<BestTableResult | null> {
  if (availableTableIds.length < 2) return null;

  const tables = await prisma.table.findMany({
    where: { restaurantId, isActive: true, id: { in: availableTableIds } },
    select: { id: true, name: true, sectionId: true, maxCovers: true, posX: true, posY: true },
  });

  if (tables.length < 2) return null;

  let bestResult: BestTableResult | null = null;
  let bestScore = -1;

  // Try all pairs; exit early when a clearly optimal pair is found.
  // Score ceiling for a pair is 70 (same section=20, max distance bonus=20,
  // zero waste=20, pair bonus=10). A score ≥ 65 means same section + close
  // proximity + near-exact fit — no remaining pair can practically score higher.
  const PAIR_EARLY_EXIT = 65;
  let earlyExited = false;
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const pair = [tables[i], tables[j]];
      const score = scoreCombination(pair, partySize, 2);
      if (score < 0) continue;
      if (score > bestScore) {
        bestScore = score;
        bestResult = {
          type: 'combined',
          tableIds: pair.map(t => t.id),
          tableNames: pair.map(t => t.name),
          score,
          reason: 'COMBINED_PAIR',
        };
        if (bestScore >= PAIR_EARLY_EXIT) { earlyExited = true; break; }
      }
    }
    if (earlyExited) break;
  }

  if (bestResult) return bestResult;

  // No pair fits — try triples
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      for (let k = j + 1; k < tables.length; k++) {
        const triple = [tables[i], tables[j], tables[k]];
        const score = scoreCombination(triple, partySize, 3);
        if (score < 0) continue;
        if (score > bestScore) {
          bestScore = score;
          bestResult = {
            type: 'combined',
            tableIds: triple.map(t => t.id),
            tableNames: triple.map(t => t.name),
            score,
            reason: 'COMBINED_TRIPLE',
          };
        }
      }
    }
  }

  return bestResult;
}

export async function getBestTable(
  restaurantId: string,
  query: {
    date: string;
    time: string;
    partySize: number;
    duration?: number;
    excludeReservationId?: string;
  }
): Promise<BestTableResult | null> {
  const suggestions = await getTableSuggestions(restaurantId, query);

  // Single table: prefer recommended → possible → tight, skip blocked
  const best = suggestions.find(s => s.tableId && s.status !== 'blocked');
  if (best?.tableId) {
    return {
      type: 'single',
      tableIds:   [best.tableId],
      tableNames: [best.tableName],
      score:      best.score,
      reason:     best.reasons[0]?.code ?? 'AVAILABLE',
    };
  }

  // No single table fits — build combination pool from time-available tables.
  // Include tables that are TOO_SMALL (time-available but undersized individually).
  // Exclude tables with CONFLICT or TABLE_BLOCKED (genuinely unavailable).
  const combinationPool = suggestions
    .filter(s => !s.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED'))
    .map(s => s.tableId)
    .filter(Boolean) as string[];

  return findBestCombination(restaurantId, combinationPool, query.partySize);
}

// ─── Floor Suggestions ───────────────────────────────────────────────────────
// For each AVAILABLE table, find the best-matching unassigned PENDING/CONFIRMED
// reservation based on party size fit, time proximity, and status.

export interface FloorSuggestion {
  tableId: string;
  suggestedReservationId: string;
  score: number;
  reason: string;
  reservation: {
    guestName: string;
    partySize: number;
    time: string;
    status: string;
  };
}

export async function getFloorSuggestions(
  restaurantId: string,
  date: string,
  time: string
): Promise<FloorSuggestion[]> {
  const dateObj = new Date(date + 'T00:00:00.000Z');

  const [floorState, reservations] = await Promise.all([
    getFloorState(restaurantId, dateObj, time),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date: dateObj,
        status: { in: ['PENDING', 'CONFIRMED'] as ReservationStatus[] },
        tableId: null,
      },
      select: { id: true, guestName: true, partySize: true, time: true, status: true },
    }),
  ]);

  const availableTables = floorState.filter((t) => t.liveStatus === 'AVAILABLE' && !t.locked);
  if (availableTables.length === 0 || reservations.length === 0) return [];

  const [nowH, nowM] = time.split(':').map(Number);
  const nowMinutes = nowH * 60 + nowM;

  const suggestions: FloorSuggestion[] = [];

  for (const table of availableTables) {
    let bestId: string | null = null;
    let bestScore = -1;
    let bestReason = '';
    let bestRes: (typeof reservations)[0] | null = null;

    for (const res of reservations) {
      if (res.partySize > table.maxCovers) continue; // can't seat — hard skip

      // Party size fit (0–40)
      let partySizeScore: number;
      if (res.partySize >= table.minCovers && res.partySize <= table.maxCovers) {
        const slack = table.maxCovers - res.partySize;
        partySizeScore = slack === 0 ? 40 : slack === 1 ? 35 : slack <= 2 ? 28 : 20;
      } else {
        partySizeScore = 5; // under minCovers — possible but non-ideal
      }

      // Time proximity (0–40)
      const [rH, rM] = res.time.split(':').map(Number);
      const diff = rH * 60 + rM - nowMinutes;
      const timeScore =
        diff >= 0 && diff <= 30  ? 40 :
        diff > 30 && diff <= 60  ? 30 :
        diff > 60 && diff <= 120 ? 20 :
        diff > 120               ? 10 :
        diff >= -30              ? 25 : // slightly late, still relevant
                                    5;

      // Status (0–20)
      const statusScore = res.status === 'CONFIRMED' ? 20 : 10;

      const score = partySizeScore + timeScore + statusScore;
      if (score <= bestScore) continue;

      // Reason describes the fit — time is shown separately in the UI
      const fit = res.partySize >= table.minCovers && res.partySize <= table.maxCovers;
      const slack = table.maxCovers - res.partySize;
      const fitLabel = fit
        ? (slack <= 1 ? `Perfect fit for ${table.minCovers}–${table.maxCovers} covers`
                      : `Good fit for ${table.minCovers}–${table.maxCovers} covers`)
        : `Works for party of ${res.partySize}`;
      const reason = res.status === 'CONFIRMED' ? `${fitLabel} · confirmed` : fitLabel;

      bestId    = res.id;
      bestScore = score;
      bestReason = reason;
      bestRes   = res;
    }

    if (bestId && bestRes) {
      suggestions.push({
        tableId: table.id,
        suggestedReservationId: bestId,
        score: bestScore,
        reason: bestReason,
        reservation: {
          guestName: bestRes.guestName,
          partySize: bestRes.partySize,
          time: bestRes.time,
          status: bestRes.status,
        },
      });
    }
  }

  return suggestions;
}

// ─── Unified Host Intelligence ───────────────────────────────────────────────
// Single pass over all tables + unassigned reservations to produce a ranked
// list of insights the host should act on.

export interface FloorInsight {
  type: 'SEAT_NOW' | 'LATE_GUEST' | 'ENDING_SOON';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  tableId: string;
  reservationId?: string;
  message: string;
  // Populated for SEAT_NOW — used by the click-to-seat badge in the UI
  reservation?: { guestName: string; partySize: number; time: string; status: string };
  reason?: string;
}

export async function getFloorInsights(
  restaurantId: string,
  date: string,
  time: string
): Promise<FloorInsight[]> {
  const dateObj = new Date(date + 'T00:00:00.000Z');

  const [floorState, unassigned] = await Promise.all([
    getFloorState(restaurantId, dateObj, time),
    prisma.reservation.findMany({
      where: {
        restaurantId,
        date: dateObj,
        status: { in: ['PENDING', 'CONFIRMED'] as ReservationStatus[] },
        tableId: null,
        returnedToListAt: null,
        reorganizeAt: null,
      },
      select: { id: true, guestName: true, partySize: true, time: true, status: true },
    }),
  ]);

  const [nowH, nowM] = time.split(':').map(Number);
  const nowMinutes = nowH * 60 + nowM;

  // Operational alerts (LATE_GUEST, ENDING_SOON) are live-service alerts only.
  // They must never fire for future dates because the service day hasn't started.
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday  = date === todayStr;

  // SEAT_NOW only fires for unassigned reservations that are imminent (within
  // RESERVED_SOON_MINUTES) or already late (up to 30 min). Far-future
  // reservations are excluded so guest names don't appear on AVAILABLE table
  // cards hours before the turn.
  const imminentUnassigned = unassigned.filter(res => {
    const [rH, rM] = res.time.split(':').map(Number);
    const diff = rH * 60 + rM - nowMinutes;
    return diff >= -NO_SHOW_AFTER_MINUTES && diff <= RESERVED_SOON_MINUTES;
  });

  const insights: FloorInsight[] = [];

  for (const table of floorState) {

    // ── ENDING_SOON: occupied table where turn is nearly up ──────────────────
    if (isToday && table.liveStatus === 'OCCUPIED' && table.currentReservation) {
      const expectedEnd = (table.currentReservation as { expectedEndTime: string }).expectedEndTime;
      const mr = Math.round((new Date(expectedEnd).getTime() - Date.now()) / 60_000);
      if (mr < 10) {
        insights.push({
          type: 'ENDING_SOON',
          priority: 'MEDIUM',
          tableId: table.id,
          message: mr > 0
            ? `Table ${table.name} ends in ${mr}m`
            : `Table ${table.name} — over by ${Math.abs(mr)}m`,
        });
      }
    }

    // ── LATE_GUEST: assigned reservation whose time has already passed ───────
    if (isToday && table.liveStatus === 'RESERVED_SOON') {
      type UpcomingRes = { id: string; guestName: string; minutesUntil: number };
      const nextRes = (table.upcomingReservations as UpcomingRes[])[0];
      if (nextRes && nextRes.minutesUntil < 0) {
        insights.push({
          type: 'LATE_GUEST',
          priority: 'HIGH',
          tableId: table.id,
          reservationId: nextRes.id,
          message: `${nextRes.guestName} is ${Math.abs(nextRes.minutesUntil)}m late`,
        });
      }
    }

    // ── SEAT_NOW: available table + best-scoring unassigned reservation ──────
    if (table.liveStatus === 'AVAILABLE' && !table.locked && imminentUnassigned.length > 0) {
      let bestRes: (typeof imminentUnassigned)[0] | null = null;
      let bestScore = -1;

      for (const res of imminentUnassigned) {
        if (res.partySize > table.maxCovers) continue;

        const fit = res.partySize >= table.minCovers && res.partySize <= table.maxCovers;
        const slack = table.maxCovers - res.partySize;
        const partySizeScore = fit
          ? (slack === 0 ? 40 : slack === 1 ? 35 : slack <= 2 ? 28 : 20)
          : 5;

        const [rH, rM] = res.time.split(':').map(Number);
        const diff = rH * 60 + rM - nowMinutes;
        const timeScore =
          diff >= 0 && diff <= 30  ? 40 :
          diff > 30 && diff <= 60  ? 30 :
          diff > 60 && diff <= 120 ? 20 :
          diff > 120               ? 10 :
          diff >= -30              ? 25 : 5;

        const statusScore = res.status === 'CONFIRMED' ? 20 : 10;
        const score = partySizeScore + timeScore + statusScore;
        if (score > bestScore) { bestScore = score; bestRes = res; }
      }

      if (bestRes) {
        const [rH, rM] = bestRes.time.split(':').map(Number);
        const diff = rH * 60 + rM - nowMinutes;
        const fit = bestRes.partySize >= table.minCovers && bestRes.partySize <= table.maxCovers;
        const reason = fit
          ? `Good fit for ${table.minCovers}–${table.maxCovers} covers`
          : `Works for party of ${bestRes.partySize}`;

        insights.push({
          type: 'SEAT_NOW',
          priority: 'HIGH',
          tableId: table.id,
          reservationId: bestRes.id,
          message: diff < 0
            ? `Seat ${bestRes.guestName} now — ${Math.abs(diff)}m late`
            : `Seat ${bestRes.guestName} at ${table.name}`,
          reservation: {
            guestName: bestRes.guestName,
            partySize: bestRes.partySize,
            time: bestRes.time,
            status: bestRes.status,
          },
          reason,
        });
      }
    }
  }

  // SEAT_NOW deduplication: each unassigned reservation must appear on at most
  // one table card. The first table that scores it (floorState order) keeps it.
  const seenSeatNowRes = new Set<string>();
  return insights.filter(ins => {
    if (ins.type !== 'SEAT_NOW' || !ins.reservationId) return true;
    if (seenSeatNowRes.has(ins.reservationId)) return false;
    seenSeatNowRes.add(ins.reservationId);
    return true;
  });
}

// ─── Sections ─────────────────────────────────────────────────────────────────

export async function listSections(restaurantId: string) {
  return prisma.section.findMany({
    where: { restaurantId },
    include: { tables: { where: { isActive: true } } },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function upsertSection(restaurantId: string, data: {
  name: string;
  color?: string;
  sortOrder?: number;
}) {
  return prisma.section.upsert({
    where: { restaurantId_name: { restaurantId, name: data.name } },
    create: { restaurantId, name: data.name, color: data.color ?? '#6366f1', sortOrder: data.sortOrder ?? 0 },
    update: { color: data.color, sortOrder: data.sortOrder },
  });
}

// ─── Floor Objects ────────────────────────────────────────────────────────────

export async function listFloorObjects(restaurantId: string) {
  return prisma.floorObject.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function batchSaveFloorObjects(
  restaurantId: string,
  objects: Array<{
    kind: string;
    label: string;
    posX: number;
    posY: number;
    width: number;
    height: number;
    rotation?: number;
    color?: string | null;
    variant?: string;
  }>
) {
  return prisma.$transaction(async (tx) => {
    await tx.floorObject.deleteMany({ where: { restaurantId } });
    if (objects.length === 0) return [];
    await tx.floorObject.createMany({
      data: objects.map((o) => ({
        restaurantId,
        kind: o.kind as import('@prisma/client').FloorObjKind,
        label: o.label,
        posX: o.posX,
        posY: o.posY,
        width: o.width,
        height: o.height,
        rotation: o.rotation ?? 0,
        color: o.color ?? null,
        variant: o.variant ?? null,
      })),
    });
    return tx.floorObject.findMany({ where: { restaurantId }, orderBy: { createdAt: 'asc' } });
  });
}

// ─── Rebuild Day ──────────────────────────────────────────────────────────────
// Lifts all CONFIRMED/PENDING reservations off a table for a given date into
// the reorganize queue. Used by Management Reorganize Mode. Never touches
// SEATED reservations — those must be completed or unseated by the host first.

export async function rebuildDay(
  restaurantId: string,
  tableId: string,
  input: { date: string; reason?: string; rebuildSessionId: string; actor: string }
) {
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  if (!table || table.restaurantId !== restaurantId) throw new NotFoundError('Table', tableId);

  const dateObj = new Date(input.date + 'T00:00:00.000Z');

  const toList = await prisma.reservation.findMany({
    where: {
      restaurantId,
      tableId,
      date: dateObj,
      status: { in: ['CONFIRMED', 'PENDING'] as ReservationStatus[] },
      reorganizeAt: null,
    },
  });

  if (toList.length === 0) return { lifted: 0, tableName: table.name };

  const now = new Date();
  const detailsJson = JSON.stringify({
    tableId,
    tableName: table.name,
    reason: input.reason ?? null,
    rebuildSessionId: input.rebuildSessionId,
  });

  await prisma.$transaction(async (tx) => {
    for (const r of toList) {
      await tx.reservation.update({
        where: { id: r.id },
        data: {
          tableId: null,
          combinedTableIds: [],
          reorganizeAt: now,
          reorganizeFromTableId: tableId,
          reorganizeBySeatingId: input.rebuildSessionId,
        },
      });
      const act = await tx.reservationActivity.create({
        data: { reservationId: r.id, action: 'REBUILD_TRIGGERED', actor: input.actor },
        select: { id: true },
      });
      await tx.$executeRaw`
        UPDATE reservation_activity
        SET details = ${detailsJson}::jsonb
        WHERE id = ${act.id}
      `;
    }
  });

  return { lifted: toList.length, tableName: table.name };
}
