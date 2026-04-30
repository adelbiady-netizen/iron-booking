import type { FloorTable, Reservation, WaitlistEntry } from '../types';
import type { TableSuggestion } from './seating';
import { minutesUntilEnd } from './time';
import { minutesUntilRes } from './arrival';

export type PressureLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PressureInfo {
  level: PressureLevel;
  arrivingSoonCount: number;
  freeingSoonCount: number;
  label: string;
}

export type Urgency = 'normal' | 'high' | 'critical';

export interface PriorityEntry {
  entry: WaitlistEntry;
  priorityScore: number;
  urgency: Urgency;
  bestSuggestion: TableSuggestion | null;
  waitedMins: number;
  rank: number; // 1-based
}

// Tables becoming free within this window are "freeing soon"
const FREE_HORIZON_MINS = 20;
// Reservations arriving within this window drive pressure
const ARRIVE_HORIZON_MINS = 30;

export function computePressure(
  tables: FloorTable[],
  reservations: Reservation[],
  nowTime: string,
  operationalNow: number,
): PressureInfo {
  const arrivingSoonCount = reservations.filter(r => {
    if (r.status !== 'CONFIRMED') return false;
    const m = minutesUntilRes(r.time, nowTime);
    return m >= 0 && m <= ARRIVE_HORIZON_MINS;
  }).length;

  const freeingSoonCount = tables.filter(t => {
    if (t.liveStatus !== 'OCCUPIED' || !t.currentReservation) return false;
    const m = minutesUntilEnd(t.currentReservation.expectedEndTime, operationalNow);
    return m >= 0 && m <= FREE_HORIZON_MINS;
  }).length;

  const activeCount  = tables.filter(t => t.isActive).length;
  const freeCount    = tables.filter(t => t.liveStatus === 'AVAILABLE' && !t.locked).length;

  let level: PressureLevel;
  if (arrivingSoonCount >= 3 && freeCount <= 2) {
    level = 'HIGH';
  } else if (arrivingSoonCount >= 2 || (freeCount <= 1 && freeingSoonCount === 0 && activeCount > 2)) {
    level = 'MEDIUM';
  } else {
    level = 'LOW';
  }

  const parts: string[] = [];
  if (arrivingSoonCount > 0) parts.push(`${arrivingSoonCount} arriving`);
  if (freeingSoonCount > 0)  parts.push(`${freeingSoonCount} freeing`);

  return { level, arrivingSoonCount, freeingSoonCount, label: parts.join(' · ') };
}

export function prioritizeQueue(
  entries: WaitlistEntry[],
  entrySuggestions: Map<string, TableSuggestion[]>,
  operationalNow: number,
): PriorityEntry[] {
  const active = entries.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED');
  const scored = active.map(entry => {
    const waitedMins = Math.max(0, (operationalNow - new Date(entry.addedAt).getTime()) / 60_000);
    const sugs = entrySuggestions.get(entry.id) ?? [];
    const bestSuggestion = sugs[0] ?? null;

    let score = 0;
    score += Math.min(60, waitedMins * 2);                                               // wait: up to 60pts
    if (bestSuggestion?.minutesUntilFree === 0)               score += 40;              // table ready now
    else if ((bestSuggestion?.minutesUntilFree ?? 999) <= 20) score += 20;              // freeing soon
    score += Math.max(0, 6 - entry.partySize) * 2;                                      // smaller = easier to seat

    const urgency: Urgency = waitedMins >= 45 ? 'critical' : waitedMins >= 25 ? 'high' : 'normal';

    return { entry, priorityScore: score, urgency, bestSuggestion, waitedMins: Math.floor(waitedMins), rank: 0 };
  });

  return scored
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .map((pe, i) => ({ ...pe, rank: i + 1 }));
}

// Build a soft-hold map: tableId → WaitlistEntry.
// Only holds tables that are immediately free for the top-ranked guests.
export function buildSoftHolds(
  priorityQueue: PriorityEntry[],
): Record<string, WaitlistEntry> {
  const holds: Record<string, WaitlistEntry> = {};
  const usedTables = new Set<string>();
  // Assign holds to top guests in priority order, skipping conflicts
  for (const pe of priorityQueue) {
    if (!pe.bestSuggestion) continue;
    if (pe.bestSuggestion.minutesUntilFree !== 0) continue; // only immediately-free tables
    if (pe.bestSuggestion.hasConflict) continue;
    if (usedTables.has(pe.bestSuggestion.tableId)) continue;
    holds[pe.bestSuggestion.tableId] = pe.entry;
    usedTables.add(pe.bestSuggestion.tableId);
    if (Object.keys(holds).length >= 3) break; // cap at 3 concurrent holds
  }
  return holds;
}

export function logOverride(tableId: string, heldEntry: WaitlistEntry): void {
  try {
    const key = 'flowControl.overrides';
    const existing: unknown[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    existing.push({
      tableId,
      heldEntryId:   heldEntry.id,
      heldEntryName: heldEntry.guestName,
      partySize:     heldEntry.partySize,
      at:            new Date().toISOString(),
    });
    localStorage.setItem(key, JSON.stringify(existing.slice(-100)));
  } catch { /* storage not available */ }
}
