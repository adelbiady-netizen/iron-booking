/**
 * Restaurant Operating Profile — runtime resolvers.
 *
 * Each function follows the same safety contract:
 *   - If no OP profile exists           → return null / fallback (old behavior)
 *   - If profile exists but no rule     → return null / fallback (old behavior)
 *   - If DB query throws                → swallow, return null / fallback (old behavior)
 *   - Inactive rules (isActive=false)   → always ignored
 *
 * The booking engine calls these BEFORE any transaction so a slow DB read
 * cannot extend the serializable window.
 */

import { prisma } from '../lib/prisma';

// ─── resolveTurnTime ─────────────────────────────────────────────────────────
// Returns the turn time (minutes) for a given party size by evaluating
// TurnTimeRules in sortOrder. Falls back to `fallback` when no rule matches.
//
// Safe to call on every booking request — one indexed query via the profile
// relation, evaluated in memory against a small rule set.

export async function resolveTurnTime(
  restaurantId: string,
  partySize: number,
  fallback: number,
): Promise<number> {
  try {
    const rule = await prisma.turnTimeRule.findFirst({
      where: {
        profile:      { restaurantId },
        isActive:     true,
        partySizeMin: { lte: partySize },
        partySizeMax: { gte: partySize },
      },
      orderBy: { sortOrder: 'asc' },
      select:  { durationMinutes: true },
    });
    return rule?.durationMinutes ?? fallback;
  } catch {
    return fallback;
  }
}

// ─── resolveTimeWindows ──────────────────────────────────────────────────────
// Returns an overriding {startTime, endTime} window for online slot generation
// on a given date, or null when no window rule applies (use full operating hours).
//
// specificDate rules always take precedence over dayOfWeek recurring rules.
// sourceScope filter: only ONLINE and ALL windows affect the public slot engine.

export async function resolveTimeWindows(
  restaurantId: string,
  dateStr: string,   // "YYYY-MM-DD"
  dayOfWeek: number, // 0=Sun … 6=Sat
): Promise<{ startTime: string; endTime: string } | null> {
  try {
    // Fetch both rule types in parallel — specificDate overrides dayOfWeek.
    const [specific, weekly] = await Promise.all([
      prisma.bookingTimeWindow.findFirst({
        where: {
          profile:      { restaurantId },
          isActive:     true,
          sourceScope:  { in: ['ONLINE', 'ALL'] },
          specificDate: dateStr,
        },
        orderBy: { sortOrder: 'asc' },
        select:  { startTime: true, endTime: true },
      }),
      prisma.bookingTimeWindow.findFirst({
        where: {
          profile:      { restaurantId },
          isActive:     true,
          sourceScope:  { in: ['ONLINE', 'ALL'] },
          specificDate: null,
          dayOfWeek,
        },
        orderBy: { sortOrder: 'asc' },
        select:  { startTime: true, endTime: true },
      }),
    ]);
    return specific ?? weekly ?? null;
  } catch {
    return null;
  }
}

// ─── resolveGroupConfig ──────────────────────────────────────────────────────
// Returns the active BookingGroupConfig for a party size, or null if none.
//
// MULTI_TABLE is deliberately excluded — the engine does not support it yet
// (TableCombination only links 2 tables) and activating it would always fail.
//
// Consumers must treat this as a PREFERENCE, not a constraint:
//   - If the preferred section has no available capacity, fall back to global.
//   - A null return means use existing behavior unchanged.

export interface GroupConfig {
  targetSectionId: string | null;
  allocationMode:  'SINGLE' | 'COMBINATION';
  tableCount:      number;
}

export async function resolveGroupConfig(
  restaurantId: string,
  partySize: number,
): Promise<GroupConfig | null> {
  try {
    const config = await prisma.bookingGroupConfig.findFirst({
      where: {
        profile:       { restaurantId },
        isActive:      true,
        allocationMode: { not: 'MULTI_TABLE' }, // v2 only — engine cannot fulfil it yet
        partySizeMin:  { lte: partySize },
        partySizeMax:  { gte: partySize },
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        targetSectionId: true,
        allocationMode:  true,
        tableCount:      true,
      },
    });
    if (!config) return null;
    return {
      targetSectionId: config.targetSectionId,
      allocationMode:  config.allocationMode as 'SINGLE' | 'COMBINATION',
      tableCount:      config.tableCount,
    };
  } catch {
    return null;
  }
}
