import type { FloorTable, WaitlistEntry } from '../types';
import { minutesUntilEnd } from './time';

export interface TableSuggestion {
  tableId: string;
  tableName: string;
  score: number;
  label: 'Best fit' | 'Available soon' | 'Tight fit';
  labelColor: string;
  hasConflict: boolean;
  conflictMin: number | null;   // minutes until next reservation, if conflict
  minutesUntilFree: number | null; // 0 if already free, null if unknown
}

const ASSUMED_DURATION_MIN = 90;

function freeInMins(table: FloorTable, operationalNow: number): number | null {
  if (table.liveStatus === 'AVAILABLE') return 0;
  if (table.liveStatus === 'OCCUPIED' && table.currentReservation) {
    // Never return 0 for an occupied table — 0 is reserved exclusively for AVAILABLE.
    // Even if the turn is overdue the host hasn't cleared the table yet.
    return Math.max(1, Math.round(minutesUntilEnd(table.currentReservation.expectedEndTime, operationalNow)));
  }
  return null;
}

export function scoreTable(
  entry: WaitlistEntry,
  table: FloorTable,
  operationalNow: number,
): TableSuggestion | null {
  if (entry.partySize > table.maxCovers) return null;
  if (!table.isActive) return null;
  if (table.liveStatus === 'BLOCKED') return null;

  let score = 0;

  // 1. Capacity fit
  if (entry.partySize >= table.minCovers && entry.partySize <= table.maxCovers) score += 50;
  else score += 20; // under minimum covers

  // 2. Availability
  const freeIn = freeInMins(table, operationalNow);
  if (table.liveStatus === 'AVAILABLE' && !table.locked) {
    score += 40;
  } else if (table.liveStatus === 'AVAILABLE' && table.locked) {
    score += 5;
  } else if (table.liveStatus === 'OCCUPIED') {
    if (freeIn !== null && freeIn <= 20)      score += 28;
    else if (freeIn !== null && freeIn <= 40) score += 15;
    else                                       score += 3;
  } else if (table.liveStatus === 'RESERVED_SOON') {
    score -= 15;
  } else if (table.liveStatus === 'RESERVED') {
    score -= 25;
  }

  // 3. Upcoming conflict: does seating now clash with next reservation?
  const nextRes = table.upcomingReservations[0];
  let hasConflict = false;
  let conflictMin: number | null = null;
  if (nextRes && nextRes.minutesUntil < ASSUMED_DURATION_MIN) {
    hasConflict = true;
    conflictMin = nextRes.minutesUntil;
    score += nextRes.minutesUntil < 45 ? -40 : -20;
  }

  // 4. Seniority boost: reward guests who've been waiting longer
  const waitedMins = (operationalNow - new Date(entry.addedAt).getTime()) / 60_000;
  score += Math.min(15, Math.round(Math.max(0, waitedMins) * 0.5));

  if (score <= 0) return null;

  // Label
  const goodFit  = entry.partySize >= table.minCovers;
  const readyNow = table.liveStatus === 'AVAILABLE' && !table.locked;
  let label: TableSuggestion['label'];
  let labelColor: string;
  if (goodFit && readyNow && !hasConflict) {
    label = 'Best fit';       labelColor = '#22c55e';
  } else if (freeIn !== null && freeIn > 0 && freeIn <= 25) {
    label = 'Available soon'; labelColor = '#f59e0b';
  } else {
    label = 'Tight fit';      labelColor = '#94a3b8';
  }

  return { tableId: table.id, tableName: table.name, score, label, labelColor, hasConflict, conflictMin, minutesUntilFree: freeIn };
}

export function getTopSuggestions(
  entry: WaitlistEntry,
  tables: FloorTable[],
  operationalNow: number,
  maxCount = 3,
): TableSuggestion[] {
  const results: TableSuggestion[] = [];
  for (const table of tables) {
    const s = scoreTable(entry, table, operationalNow);
    if (s) results.push(s);
  }
  return results.sort((a, b) => b.score - a.score).slice(0, maxCount);
}
