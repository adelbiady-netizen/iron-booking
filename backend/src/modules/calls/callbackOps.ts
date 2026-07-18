// P3 callback operations (mark-handled, Clear All, Undo) as pure orchestration
// over a narrow storage seam. The router wires the Prisma-backed store (which
// keeps real atomicity: `SELECT … FOR UPDATE` for Clear All, compare-and-swap
// for Undo); tests drive an in-memory store. Keeping the decision logic here —
// and out of the HTTP handlers — is what makes the concurrency and audit
// semantics unit-testable without a database, matching this module's
// DB-free companion `callbackState.ts`.

import { Prisma } from '@prisma/client';
import type { CallbackStatus } from './callbackState';
import { OPEN_STATUSES } from './callbackState';

// A callback can only ever be restored TO an open state — never a closed one.
export type OpenStatus = 'PENDING_CALLBACK' | 'CALLBACK_IN_PROGRESS';

// The projection every callback endpoint returns to the client.
export const CALLBACK_SELECT = {
  id: true, phone: true, status: true, createdAt: true, guestName: true,
  restaurantName: true, queueStatus: true, callbackNote: true,
  handledBy: true, claimedAt: true, callbackCompletedAt: true,
} as const;

export interface CallbackRow {
  id: string;
  phone: string;
  status: string;
  createdAt: Date;
  guestName: string | null;
  restaurantName: string | null;
  queueStatus: CallbackStatus | null;
  callbackNote: string | null;
  handledBy: string | null;
  claimedAt: Date | null;
  callbackCompletedAt: Date | null;
}

// Self-contained token the client echoes back to Undo an operation. Safety does
// NOT rely on trusting the client: Undo re-validates every item with a
// compare-and-swap on (queueStatus = COMPLETED AND callbackCompletedAt = token).
// `callbackCompletedAt` acts as the per-row version — any independent change
// (reopen, re-complete, cancel) moves it, so a stale Undo can never overwrite a
// newer state. No `version` column, hence no migration, is required.
export interface UndoDescriptor {
  operationId: string;
  completedAt: Date | null;
  items: Array<{ id: string; previousStatus: OpenStatus }>;
}

export interface AuditEntry {
  event: string;
  properties: Record<string, unknown>;
}

// What the caller applies AFTER the DB work commits: append-only audit rows and
// whether to broadcast `callback_updated` to other devices.
export interface Effects {
  audits: AuditEntry[];
  emit: boolean;
}

// Storage boundary. Methods that must be atomic together (lockOpen+completeMany;
// the Undo CAS loop) are always invoked by the caller inside one transaction.
export interface CallbackStore {
  // undefined = row absent for this tenant; null = row exists but isn't a callback.
  getStatus(restaurantId: string, id: string): Promise<CallbackStatus | null | undefined>;
  getRow(restaurantId: string, id: string): Promise<CallbackRow | null>;
  // CAS OPEN → closed. Returns rows changed (0 or 1).
  closeIfOpen(
    restaurantId: string,
    id: string,
    to: 'CALLBACK_COMPLETED' | 'CALLBACK_CANCELLED',
    at: Date,
    handledBy: string,
    note: string | undefined,
  ): Promise<number>;
  // Lock + capture the current open set (FIFO). Prisma: SELECT … FOR UPDATE.
  lockOpen(restaurantId: string): Promise<Array<{ id: string; previousStatus: OpenStatus }>>;
  completeMany(restaurantId: string, ids: string[], at: Date, handledBy: string): Promise<void>;
  // CAS restore a COMPLETED@token row to previousStatus. True if restored, false = conflict.
  casRestore(restaurantId: string, id: string, token: Date, previousStatus: OpenStatus): Promise<boolean>;
}

export function toOpenStatus(status: CallbackStatus | null | undefined): OpenStatus {
  // Complete/cancel/clear-all only ever act on an OPEN row, so previousStatus is
  // always PENDING or IN_PROGRESS. Default defensively to PENDING (the canonical
  // actionable state) if a status was lost to a race.
  return status === 'CALLBACK_IN_PROGRESS' ? 'CALLBACK_IN_PROGRESS' : 'PENDING_CALLBACK';
}

// ── Mark handled (single) ────────────────────────────────────────────────────

export type ResolveResult =
  | { ok: true; row: CallbackRow; undo: UndoDescriptor; effects: Effects }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'CONFLICT'; row: CallbackRow };

async function planResolve(
  store: CallbackStore,
  to: 'CALLBACK_COMPLETED' | 'CALLBACK_CANCELLED',
  auditEvent: 'callback.complete' | 'callback.cancel',
  args: { restaurantId: string; id: string; hostName: string; note?: string; operationId: string; now: Date },
): Promise<ResolveResult> {
  const { restaurantId, id, hostName, note, operationId, now } = args;

  // Capture the pre-transition status for the audit trail + Undo restore.
  const previousStatus = (await store.getStatus(restaurantId, id)) ?? null;
  const changed = await store.closeIfOpen(restaurantId, id, to, now, hostName, note);
  const row = await store.getRow(restaurantId, id);

  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (changed === 0) return { ok: false, code: 'CONFLICT', row };

  const undo: UndoDescriptor = {
    operationId,
    completedAt: row.callbackCompletedAt,
    items: [{ id: row.id, previousStatus: toOpenStatus(previousStatus) }],
  };
  const effects: Effects = {
    audits: [{ event: auditEvent, properties: { callbackId: id, from: previousStatus, to } }],
    emit: true,
  };
  return { ok: true, row, undo, effects };
}

export function planComplete(
  store: CallbackStore,
  args: { restaurantId: string; id: string; hostName: string; note?: string; operationId: string; now: Date },
): Promise<ResolveResult> {
  return planResolve(store, 'CALLBACK_COMPLETED', 'callback.complete', args);
}

export function planCancel(
  store: CallbackStore,
  args: { restaurantId: string; id: string; hostName: string; note?: string; operationId: string; now: Date },
): Promise<ResolveResult> {
  return planResolve(store, 'CALLBACK_CANCELLED', 'callback.cancel', args);
}

// ── Clear All (bulk mark-handled) ────────────────────────────────────────────

export interface ClearAllResult {
  count: number;
  undo: UndoDescriptor;
  effects: Effects;
}

export async function planClearAll(
  store: CallbackStore,
  args: { restaurantId: string; hostName: string; operationId: string; now: Date },
): Promise<ClearAllResult> {
  const { restaurantId, hostName, operationId, now } = args;

  // The locked snapshot IS the affected set: callbacks created after this point
  // are not in it, and only PENDING/IN_PROGRESS rows are returned.
  const items = await store.lockOpen(restaurantId);
  if (items.length === 0) {
    // Nothing unresolved — a safe, idempotent no-op (e.g. a second Clear All).
    return {
      count: 0,
      undo: { operationId, completedAt: null, items: [] },
      effects: { audits: [], emit: false },
    };
  }

  await store.completeMany(restaurantId, items.map((i) => i.id), now, hostName);

  // One parent bulk-audit entry, plus a per-item transition so every callback
  // stays individually traceable (linked via bulkId).
  const audits: AuditEntry[] = [
    { event: 'callback.clear_all', properties: { bulkId: operationId, count: items.length, callbackIds: items.map((i) => i.id) } },
    ...items.map((it) => ({
      event: 'callback.complete',
      properties: { callbackId: it.id, from: it.previousStatus, to: 'CALLBACK_COMPLETED', bulkId: operationId },
    })),
  ];

  return {
    count: items.length,
    undo: { operationId, completedAt: now, items },
    effects: { audits, emit: true },
  };
}

// ── Undo (reverse a complete or Clear All) ───────────────────────────────────

export interface UndoResult {
  restored: string[];
  conflicted: string[];
  effects: Effects;
}

export async function planUndo(
  store: CallbackStore,
  args: {
    restaurantId: string;
    operationId?: string;
    token: Date;
    items: Array<{ id: string; previousStatus: OpenStatus }>;
  },
): Promise<UndoResult> {
  const { restaurantId, operationId, token, items } = args;
  const restored: string[] = [];
  const conflicted: string[] = [];

  for (const it of items) {
    const ok = await store.casRestore(restaurantId, it.id, token, it.previousStatus);
    if (ok) restored.push(it.id);
    else conflicted.push(it.id);
  }

  const audits: AuditEntry[] = [];
  if (restored.length > 0) {
    audits.push({
      event: 'callback.undo',
      properties: { reversedOperationId: operationId ?? null, restoredIds: restored, conflictedIds: conflicted },
    });
    const restoredSet = new Set(restored);
    for (const it of items) {
      if (!restoredSet.has(it.id)) continue;
      audits.push({
        event: 'callback.reopen',
        properties: { callbackId: it.id, from: 'CALLBACK_COMPLETED', to: it.previousStatus, reversedOperationId: operationId ?? null },
      });
    }
  }

  return { restored, conflicted, effects: { audits, emit: restored.length > 0 } };
}

// ── Prisma-backed store ──────────────────────────────────────────────────────
// `db` is either the root client or a transaction client; both satisfy the
// methods used. Clear All / Undo pass a transaction client so their locking and
// compare-and-swap are atomic.

export function makePrismaCallbackStore(db: Prisma.TransactionClient): CallbackStore {
  return {
    async getStatus(restaurantId, id) {
      const row = await db.callLog.findFirst({ where: { id, restaurantId }, select: { queueStatus: true } });
      return row ? row.queueStatus : undefined;
    },
    async getRow(restaurantId, id) {
      return db.callLog.findFirst({ where: { id, restaurantId }, select: CALLBACK_SELECT });
    },
    async closeIfOpen(restaurantId, id, to, at, handledBy, note) {
      const r = await db.callLog.updateMany({
        where: { id, restaurantId, queueStatus: { in: [...OPEN_STATUSES] } },
        data: {
          queueStatus: to,
          handledBy,
          callbackCompletedAt: at,
          ...(note !== undefined ? { callbackNote: note } : {}),
        },
      });
      return r.count;
    },
    async lockOpen(restaurantId) {
      const locked = await db.$queryRaw<Array<{ id: string; queueStatus: string }>>`
        SELECT id, "queueStatus"::text AS "queueStatus"
        FROM call_logs
        WHERE "restaurantId" = ${restaurantId}
          AND "queueStatus"::text IN ('PENDING_CALLBACK', 'CALLBACK_IN_PROGRESS')
        ORDER BY "createdAt" ASC
        FOR UPDATE`;
      return locked.map((r) => ({ id: r.id, previousStatus: toOpenStatus(r.queueStatus as CallbackStatus) }));
    },
    async completeMany(restaurantId, ids, at, handledBy) {
      if (ids.length === 0) return;
      await db.callLog.updateMany({
        where: { id: { in: ids }, restaurantId },
        data: { queueStatus: 'CALLBACK_COMPLETED', handledBy, callbackCompletedAt: at },
      });
    },
    async casRestore(restaurantId, id, token, previousStatus) {
      const r = await db.callLog.updateMany({
        // Still COMPLETED at the exact instant this operation set it, or nothing.
        where: { id, restaurantId, queueStatus: 'CALLBACK_COMPLETED', callbackCompletedAt: token },
        data:
          previousStatus === 'PENDING_CALLBACK'
            ? { queueStatus: 'PENDING_CALLBACK', callbackCompletedAt: null, handledBy: null, claimedAt: null }
            : { queueStatus: 'CALLBACK_IN_PROGRESS', callbackCompletedAt: null },
      });
      return r.count === 1;
    },
  };
}
