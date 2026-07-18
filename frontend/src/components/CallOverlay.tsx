import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api';
import { useT } from '../i18n/useT';
import type { CallbackItem, CallbackUndoDescriptor } from '../types';
import { buildOverlaySections, type OverlaySections } from '../utils/callOverlay';
import {
  shouldShowClearAll, isActionDisabled, hasUndoableItems, isUndoConflict,
  runClearAll, runUndo, UNDO_WINDOW_MS,
} from '../utils/callbackActions';

// Compact communication overlay (P2). A floating panel opened from the phone FAB
// that shows the callback queue as: (1) requires attention, (2) recently handled,
// (3) full history on demand. It is a second VIEW of the same server-authoritative
// data (GET /call-logs/callbacks) — no parallel data model. Actions reuse the
// existing safe endpoints only (complete / cancel / call / open guest).

interface Props {
  /** Bumps on every callback_updated (and new incoming call) → silent refetch. */
  refreshKey: number;
  /** SSE health — false shows a subtle "reconnecting" note. */
  connectionOk?: boolean;
  onClose: () => void;
  /** Opens the existing detailed call-log drawer (secondary history/detail). */
  onViewFullHistory: () => void;
  onFindGuest: (phone: string) => void;
}

const EMPTY: OverlaySections = { active: [], recentHandled: [], activeCount: 0, isEmpty: true };

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

export default function CallOverlay({
  refreshKey, connectionOk = true, onClose, onViewFullHistory, onFindGuest,
}: Props) {
  const T = useT();
  const [sections, setSections] = useState<OverlaySections>(EMPTY);
  const [error,   setError]   = useState(false);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  // P3 — Clear All + Undo. `undoToast` holds the token for the LAST operation; it
  // auto-dismisses after a short window (dismissal deletes no server record).
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing,     setClearing]     = useState(false);
  const [undoToast,    setUndoToast]    = useState<CallbackUndoDescriptor | null>(null);
  const [undoing,      setUndoing]      = useState(false);
  const [conflict,     setConflict]     = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.callLogs.callbacks();
      setSections(buildOverlaySections(r));
      setError(false);
    } catch {
      setError(true);
    } finally {
      loadedRef.current = true;
      setLoading(false);
    }
  }, []);

  // Load on open + silent refetch whenever the callback state changes anywhere
  // (refreshKey is bumped by the repaired callback_updated SSE path). Never
  // optimistic — the list + count stay server-authoritative.
  useEffect(() => { load(); }, [load, refreshKey]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(id: string, fn: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(id);
    try {
      await fn();
    } catch (err) {
      // 409 (already handled elsewhere) or transient — refetch reconciles either way.
      if (!(err instanceof ApiError)) { /* swallow */ }
    } finally {
      setBusyId(null);
      load();
    }
  }

  // Show an Undo toast for the just-completed operation; it auto-dismisses.
  function showUndo(undo: CallbackUndoDescriptor) {
    setConflict(false);
    setUndoToast(undo);
  }
  useEffect(() => {
    if (!undoToast) return;
    const t = setTimeout(() => setUndoToast(null), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [undoToast]);
  useEffect(() => {
    if (!conflict) return;
    const t = setTimeout(() => setConflict(false), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [conflict]);

  // Mark one handled. Server-authoritative: never remove optimistically — we
  // refetch after success and offer Undo from the returned token.
  async function handleComplete(id: string) {
    if (busyId || clearing) return;
    setBusyId(id);
    try {
      const res = await api.callLogs.callbackComplete(id);
      if (hasUndoableItems(res.undo)) showUndo(res.undo);
    } catch {
      // 409 / transient — refetch reconciles.
    } finally {
      setBusyId(null);
      load();
    }
  }

  // Clear All — confirmed bulk mark-handled over the current unresolved set.
  async function handleClearAll() {
    if (clearing || busyId) return;
    setConfirmClear(false);
    setClearing(true);
    try {
      const { undo } = await runClearAll({ clearAll: () => api.callLogs.callbackClearAll(), refetch: load });
      if (undo) showUndo(undo);
    } catch {
      // refetch already ran inside runClearAll.
    } finally {
      setClearing(false);
    }
  }

  // Undo the last operation. Server re-validates; a conflict shows a calm notice.
  async function handleUndo() {
    if (!undoToast || undoing) return;
    const descriptor = undoToast;
    setUndoing(true);
    try {
      const { outcome } = await runUndo({ undo: (p) => api.callLogs.callbackUndo(p), refetch: load }, descriptor);
      setUndoToast(null);
      if (isUndoConflict(outcome)) setConflict(true);
    } catch {
      // Unknown result — clear the toast and let the refetch show the true state.
      setUndoToast(null);
    } finally {
      setUndoing(false);
    }
  }

  function statusChip(cb: CallbackItem, closed: boolean) {
    if (closed) {
      const label = cb.queueStatus === 'CALLBACK_CANCELLED' ? T.callLog.cbCancelled : T.callLog.cbCompleted;
      return (
        <span className="text-[11px] text-iron-muted">
          {label}{cb.handledBy ? ` · ${T.callLog.cbHandledBy(cb.handledBy)}` : ''}
        </span>
      );
    }
    if (cb.queueStatus === 'CALLBACK_IN_PROGRESS') {
      return (
        <span className="text-[11px] text-status-warning">
          {cb.handledBy ? T.callLog.cbInProgressBy(cb.handledBy) : T.callLog.cbInProgress}
        </span>
      );
    }
    return <span className="text-[11px] text-iron-green-light">{T.callLog.cbPending}</span>;
  }

  function activeRow(cb: CallbackItem) {
    const busy = busyId === cb.id;
    const mins = minutesSince(cb.createdAt);
    return (
      <div key={cb.id} className="border-s-2 border-s-status-danger/50 bg-iron-bg/40 rounded-lg p-2.5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-iron-text leading-tight truncate">
              {cb.guestName || <span dir="ltr">{cb.phone}</span>}
            </p>
            {cb.guestName && <p className="text-xs text-iron-muted" dir="ltr">{cb.phone}</p>}
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            {typeof cb.position === 'number' && <span className="text-[10px] text-iron-muted">#{cb.position}</span>}
            <span className="text-[11px] text-iron-muted whitespace-nowrap">{T.callLog.waitingFor(mins)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          {statusChip(cb, false)}
          <div className="flex items-center gap-1">
            <a
              href={`tel:${cb.phone}`}
              className="text-xs text-iron-green-light border border-iron-green/30 hover:bg-iron-green/10 rounded px-2 py-1 transition-colors"
            >
              {T.callLog.cbCall}
            </a>
            <button
              disabled={busy || clearing}
              onClick={() => handleComplete(cb.id)}
              className="text-xs text-iron-text/85 border border-iron-border hover:border-iron-text/30 rounded px-2 py-1 disabled:opacity-50 transition-colors"
            >
              {T.callLog.cbComplete}
            </button>
            <button
              disabled={busy || clearing}
              onClick={() => run(cb.id, () => api.callLogs.callbackCancel(cb.id))}
              className="text-xs text-iron-muted hover:text-status-danger border border-iron-border rounded px-2 py-1 disabled:opacity-50 transition-colors"
            >
              {T.callLog.cbCancel}
            </button>
            <button
              onClick={() => { onFindGuest(cb.phone); onClose(); }}
              className="text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-1 transition-colors"
            >
              {T.callLog.findGuest}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const body = (
    <div
      dir="rtl"
      className="fixed bottom-4 inset-inline-end-4 z-[70] w-[360px] max-w-[calc(100vw-2rem)] max-h-[70vh] bg-iron-card border border-iron-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.6)' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-iron-border flex-shrink-0">
        <h2 className="text-iron-text font-semibold text-sm flex-1">{T.callOverlay.title}</h2>
        {sections.activeCount > 0 && (
          <span className="text-[11px] font-bold text-white bg-iron-green rounded-full min-w-[20px] h-5 leading-5 text-center px-1 tabular-nums" dir="ltr">
            {sections.activeCount > 99 ? '99+' : sections.activeCount}
          </span>
        )}
        <button onClick={onClose} aria-label={T.callOverlay.close} className="text-iron-muted hover:text-iron-text text-lg leading-none px-1">
          ×
        </button>
      </div>

      {!connectionOk && (
        <div className="px-4 py-1.5 text-[11px] text-status-warning bg-status-warning/10 border-b border-iron-border flex-shrink-0">
          {T.callOverlay.reconnecting}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading && !loadedRef.current ? (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-status-danger text-sm">{T.callLog.loadError}</p>
            <button onClick={() => { setLoading(true); load(); }} className="text-xs border border-iron-border text-iron-text px-3 py-1.5 rounded-lg hover:bg-iron-border/20 transition-colors">
              {T.callOverlay.retry}
            </button>
          </div>
        ) : (
          <>
            {/* 1 — Requires attention (primary) */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-iron-muted">{T.callOverlay.requiresAttention}</p>
                {shouldShowClearAll(sections.activeCount) && !confirmClear && (
                  <button
                    disabled={isActionDisabled(clearing || busyId !== null)}
                    onClick={() => setConfirmClear(true)}
                    className="text-[11px] text-iron-muted hover:text-iron-text underline underline-offset-2 disabled:opacity-50 transition-colors"
                  >
                    {T.callOverlay.clearAll}
                  </button>
                )}
              </div>
              {confirmClear && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-iron-bg/60 border border-iron-border px-2.5 py-2">
                  <span className="text-xs text-iron-text">{T.callOverlay.clearAllConfirm(sections.activeCount)}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button disabled={clearing} onClick={handleClearAll} className="text-xs text-white bg-iron-green/90 hover:bg-iron-green rounded px-2 py-1 disabled:opacity-50 transition-colors">
                      {T.callOverlay.confirm}
                    </button>
                    <button disabled={clearing} onClick={() => setConfirmClear(false)} className="text-xs text-iron-muted border border-iron-border rounded px-2 py-1 disabled:opacity-50 transition-colors">
                      {T.callOverlay.cancel}
                    </button>
                  </div>
                </div>
              )}
              {sections.isEmpty ? (
                <div className="text-center py-6">
                  <div className="w-9 h-9 mx-auto mb-2 rounded-full bg-iron-green/10 border border-iron-green/30 flex items-center justify-center text-iron-green-light">✓</div>
                  <p className="text-iron-text text-sm">{T.callLog.queueEmpty}</p>
                </div>
              ) : (
                sections.active.map(activeRow)
              )}
            </section>

            {/* 2 — Recently handled (secondary, quieter) */}
            <section className="space-y-1.5 opacity-80">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-iron-muted">{T.callLog.cbClosedRecently}</p>
              {sections.recentHandled.length === 0 ? (
                <p className="text-xs text-iron-muted px-1">{T.callOverlay.noRecent}</p>
              ) : (
                sections.recentHandled.map(cb => (
                  <div key={cb.id} className="flex items-center justify-between gap-2 px-1 py-1.5 border-b border-iron-border/40 last:border-0">
                    <p className="text-xs text-iron-text/80 truncate">
                      {cb.guestName || <span dir="ltr">{cb.phone}</span>}
                    </p>
                    {statusChip(cb, true)}
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>

      {/* Undo toast / conflict notice for the last operation. */}
      {(undoToast || conflict) && (
        <div className="border-t border-iron-border px-3 py-2 flex-shrink-0">
          {undoToast ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-iron-text">{T.callOverlay.undoDone}</span>
              <button
                disabled={undoing}
                onClick={handleUndo}
                className="text-xs font-medium text-iron-green-light hover:text-iron-green underline underline-offset-2 disabled:opacity-50 transition-colors"
              >
                {T.callOverlay.undo}
              </button>
            </div>
          ) : (
            <p className="text-xs text-status-warning">{T.callOverlay.undoConflict}</p>
          )}
        </div>
      )}

      {/* 3 — Full history on demand */}
      <div className="border-t border-iron-border p-2.5 flex-shrink-0">
        <button
          onClick={() => { onViewFullHistory(); onClose(); }}
          className="w-full text-center text-xs text-iron-muted hover:text-iron-text py-2 rounded-lg hover:bg-iron-border/20 transition-colors"
        >
          {T.callOverlay.viewFullHistory} →
        </button>
      </div>
    </div>
  );

  return createPortal(
    <>
      {/* Transparent click-catcher — closes on outside click without dimming the
          map (the overlay must not cover the whole floor). */}
      <div className="fixed inset-0 z-[69]" onClick={onClose} />
      {body}
    </>,
    document.body,
  );
}
