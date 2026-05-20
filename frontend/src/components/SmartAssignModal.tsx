import { useState, useEffect, useRef } from 'react';
import type { Reservation, Table } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { normalizeTime } from '../utils/time';

// ─── Types ────────────────────────────────────────────────────────────────────

type PreviewStatus = 'loading' | 'ready' | 'no_table';
type ExecStatus    = 'idle' | 'running' | 'success' | 'failed';
type ModalPhase    = 'preview' | 'executing' | 'done';

interface PreviewItem {
  reservation:        Reservation;
  suggestedTableId:   string | null;
  suggestedTableName: string | null;
  sectionName:        string | null;
  isTight:            boolean;
  previewStatus:      PreviewStatus;
  selected:           boolean;
}

interface ExecItem extends PreviewItem {
  execStatus: ExecStatus;
  error:      string | null;
}

export interface SmartAssignResult {
  reservationId:   string;
  assignedTableId: string;
}

interface Props {
  reservations: Reservation[];
  tables:       Table[];
  date:         string;
  onClose:      () => void;
  onApply:      () => void;
  onUpdated:    (r: Reservation) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SmartAssignModal({ reservations, date, onClose, onApply, onUpdated }: Props) {
  const T         = useT();
  const { dir }   = useLocale();

  const [phase,     setPhase]     = useState<ModalPhase>('preview');
  const [items,     setItems]     = useState<PreviewItem[]>([]);
  const [execItems, setExecItems] = useState<ExecItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const abortedRef = useRef(false);

  // Latest reservations from parent — used by UndoButton for safety check.
  // We store this in a ref so UndoButton always sees the freshest list without
  // needing it in its own closure.
  const reservationsRef = useRef(reservations);
  useEffect(() => { reservationsRef.current = reservations; }, [reservations]);

  // ── Candidates: PENDING|CONFIRMED, tableId null ──────────────────────────────
  const candidates = reservations
    .filter(r => ['PENDING', 'CONFIRMED'].includes(r.status) && r.tableId === null)
    .sort((a, b) => a.time.localeCompare(b.time));

  // ── Preview generation — sequential to avoid engine race conditions ───────────
  useEffect(() => {
    abortedRef.current = false;

    async function generatePreview() {
      setLoading(true);
      const results: PreviewItem[] = [];

      for (const res of candidates) {
        if (abortedRef.current) break;
        try {
          const suggestions = await api.tables.suggest({
            date,
            time:                 res.time,
            partySize:            res.partySize,
            duration:             res.duration,
            excludeReservationId: res.id,
          });
          // Only single-table suggestions that are not blocked
          const best = suggestions.find(s => s.type === 'single' && s.status !== 'blocked');
          if (best && best.tableId) {
            results.push({
              reservation:        res,
              suggestedTableId:   best.tableId,
              suggestedTableName: best.tableName,
              sectionName:        best.sectionName || null,
              isTight:            best.status === 'tight',
              previewStatus:      'ready',
              selected:           true,
            });
          } else {
            results.push({
              reservation:        res,
              suggestedTableId:   null,
              suggestedTableName: null,
              sectionName:        null,
              isTight:            false,
              previewStatus:      'no_table',
              selected:           false,
            });
          }
        } catch {
          results.push({
            reservation:        res,
            suggestedTableId:   null,
            suggestedTableName: null,
            sectionName:        null,
            isTight:            false,
            previewStatus:      'no_table',
            selected:           false,
          });
        }
        if (!abortedRef.current) setItems([...results]);
      }
      if (!abortedRef.current) setLoading(false);
    }

    generatePreview();
    return () => { abortedRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Execute assignments — sequential ─────────────────────────────────────────
  async function executeAssignments() {
    const selected = items.filter(i => i.previewStatus === 'ready' && i.selected);
    if (selected.length === 0) return;

    setExecItems(items.map(i => ({ ...i, execStatus: 'idle' as ExecStatus, error: null })));
    setPhase('executing');

    const successLog: SmartAssignResult[] = [];

    for (const item of selected) {
      if (!item.suggestedTableId) continue;

      setExecItems(prev => prev.map(e =>
        e.reservation.id === item.reservation.id ? { ...e, execStatus: 'running' } : e
      ));

      try {
        const updated = await api.reservations.update(item.reservation.id, {
          tableId:          item.suggestedTableId,
          combinedTableIds: [],
        });
        onUpdated(updated);
        successLog.push({ reservationId: item.reservation.id, assignedTableId: item.suggestedTableId });
        setExecItems(prev => prev.map(e =>
          e.reservation.id === item.reservation.id ? { ...e, execStatus: 'success' } : e
        ));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed';
        setExecItems(prev => prev.map(e =>
          e.reservation.id === item.reservation.id ? { ...e, execStatus: 'failed', error: msg } : e
        ));
        // Never abort the full run on a single failure
      }
    }

    onApply();
    setPhase('done');
  }

  // ── Toggle selection ──────────────────────────────────────────────────────────
  function toggleItem(id: string) {
    setItems(prev => prev.map(i =>
      i.reservation.id === id && i.previewStatus === 'ready'
        ? { ...i, selected: !i.selected }
        : i
    ));
  }

  const readySelected = items.filter(i => i.previewStatus === 'ready' && i.selected).length;
  const readyCount    = items.filter(i => i.previewStatus === 'ready').length;
  const noTableCount  = items.filter(i => i.previewStatus === 'no_table').length;
  const successCount  = execItems.filter(i => i.execStatus === 'success').length;
  const failedCount   = execItems.filter(i => i.execStatus === 'failed').length;

  const displayItems = phase === 'preview' ? items : execItems;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/55"
        style={{ backdropFilter: 'blur(3px)' }}
        onClick={phase === 'executing' ? undefined : onClose}
      />

      {/* Modal panel */}
      <div
        dir={dir}
        className="relative w-full max-w-md mx-4 rounded-2xl flex flex-col"
        style={{
          background:  'rgba(28,30,26,0.97)',
          border:      '1px solid rgba(255,255,255,0.09)',
          boxShadow:   '0 24px 80px rgba(0,0,0,0.72), 0 2px 0 rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.07)',
          maxHeight:   '82vh',
        }}
      >
        {/* Header */}
        <div
          className="px-5 pt-5 pb-4 shrink-0 border-b border-white/[0.06]"
          style={{ backgroundImage: 'linear-gradient(180deg, rgba(111,138,60,0.10) 0%, transparent 100%)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-iron-text font-bold text-[18px] tracking-tight leading-tight">
                {T.smartAssign.modalTitle}
              </h2>
              <p className="text-iron-muted/65 text-[12px] mt-0.5">
                {T.smartAssign.modalSubtitle(candidates.length)}
              </p>
            </div>
            {phase !== 'executing' && (
              <button
                onClick={onClose}
                className="text-iron-muted/45 hover:text-iron-text w-8 h-8 flex items-center justify-center rounded-xl hover:bg-iron-border/20 transition-colors text-lg leading-none shrink-0 touch-manipulation"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>

          {/* Done-phase summary in header */}
          {phase === 'done' && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {successCount > 0 && (
                <span className="text-[12px] font-semibold text-iron-green-light">
                  {T.smartAssign.resultAssigned(successCount)}
                </span>
              )}
              {successCount > 0 && failedCount > 0 && (
                <span className="text-iron-border/40 text-[12px]">·</span>
              )}
              {failedCount > 0 && (
                <span className="text-[12px] font-medium text-orange-400/80">
                  {T.smartAssign.resultFailed(failedCount)}
                </span>
              )}
              {successCount === 0 && failedCount === 0 && (
                <span className="text-[12px] text-iron-muted/65">{T.smartAssign.resultNone}</span>
              )}
            </div>
          )}
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-6">
              <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-iron-muted/65 text-[13px]">{T.smartAssign.previewLoading}</span>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {displayItems.map(item => (
                <PreviewRow
                  key={item.reservation.id}
                  item={item as ExecItem}
                  phase={phase}
                  onToggle={toggleItem}
                  T={T}
                />
              ))}
              {/* Progressive loading indicator while fetching remaining suggestions */}
              {loading && items.length > 0 && items.length < candidates.length && (
                <div className="flex items-center gap-2 px-5 py-3">
                  <div className="w-3 h-3 border-2 border-iron-green/50 border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="text-iron-muted/45 text-[11px]">{T.smartAssign.previewLoading}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 shrink-0 border-t border-white/[0.06]"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}
        >
          {phase === 'preview' && (
            <>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="text-[13px] font-medium px-4 py-2.5 rounded-xl border border-iron-border/40 text-iron-muted/70 hover:text-iron-text hover:border-iron-border/65 transition-colors disabled:opacity-40 touch-manipulation"
                >
                  {T.smartAssign.cancelBtn}
                </button>
                <button
                  onClick={executeAssignments}
                  disabled={loading || readySelected === 0}
                  className="flex-1 text-[13px] font-semibold px-4 py-2.5 rounded-xl bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors disabled:opacity-35 disabled:cursor-not-allowed touch-manipulation active:scale-[0.98]"
                  style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.24)' }}
                >
                  {readySelected > 0
                    ? `${T.smartAssign.applyBtn} · ${readySelected}`
                    : T.smartAssign.applyBtn}
                </button>
              </div>
              {!loading && (
                <p className="text-[11px] text-iron-muted/40 mt-2 text-center">
                  {readyCount > 0 && noTableCount === 0 && `${readyCount} suggestions ready`}
                  {readyCount > 0 && noTableCount > 0 && `${readyCount} suggestions · ${noTableCount} no table found`}
                  {readyCount === 0 && T.smartAssign.resultNone}
                </p>
              )}
            </>
          )}

          {phase === 'executing' && (
            <div className="flex items-center gap-2.5 text-iron-muted/55 text-[12px]">
              <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
              <span>{T.smartAssign.executingLabel}</span>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex items-center gap-2.5">
              {successCount > 0 && (
                <UndoButton
                  execItems={execItems}
                  reservationsRef={reservationsRef}
                  onUpdated={onUpdated}
                  T={T}
                />
              )}
              <button
                onClick={onClose}
                className="flex-1 text-[13px] font-semibold px-4 py-2.5 rounded-xl border border-iron-border/40 text-iron-text hover:border-iron-border/65 transition-colors touch-manipulation"
              >
                {T.smartAssign.doneBtn}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Preview / Exec row ───────────────────────────────────────────────────────

function PreviewRow({
  item,
  phase,
  onToggle,
  T,
}: {
  item:     ExecItem;
  phase:    ModalPhase;
  onToggle: (id: string) => void;
  T:        ReturnType<typeof import('../i18n/useT').useT>;
}) {
  const res       = item.reservation;
  const isReady   = item.previewStatus === 'ready';
  const isNoTable = item.previewStatus === 'no_table';
  const execStatus = item.execStatus;

  const dimmed = isNoTable || (phase === 'preview' && isReady && !item.selected);

  return (
    <div className={`flex items-center gap-3 px-4 py-3 transition-opacity ${dimmed ? 'opacity-45' : ''}`}>
      {/* Selection toggle — preview only, ready items only */}
      {phase === 'preview' && (
        <div className="shrink-0 w-4 flex items-center justify-center">
          {isReady ? (
            <button
              onClick={() => onToggle(res.id)}
              className={`w-4 h-4 rounded border transition-colors flex items-center justify-center ${
                item.selected
                  ? 'bg-iron-green/25 border-iron-green/55'
                  : 'bg-transparent border-iron-border/45 hover:border-iron-border/75'
              }`}
              aria-label={item.selected ? 'Deselect' : 'Select'}
            >
              {item.selected && (
                <svg viewBox="0 0 10 8" fill="none" className="w-2.5 h-2.5">
                  <path d="M1 4l2.5 2.5L9 1" stroke="rgb(180,210,120)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ) : (
            <span className="w-4 h-4 rounded border border-iron-border/20" />
          )}
        </div>
      )}

      {/* Exec status indicator */}
      {phase !== 'preview' && (
        <div className="shrink-0 w-4 flex items-center justify-center">
          {execStatus === 'running' && (
            <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
          )}
          {execStatus === 'success' && (
            <span className="text-iron-green-light text-[14px] leading-none">✓</span>
          )}
          {execStatus === 'failed' && (
            <span className="text-red-400/80 text-[13px] leading-none">✗</span>
          )}
          {execStatus === 'idle' && (
            <span className="w-1.5 h-1.5 rounded-full bg-iron-border/35 mx-auto" />
          )}
        </div>
      )}

      {/* Reservation info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[13px] font-semibold truncate leading-tight ${isNoTable ? 'text-iron-muted/55' : 'text-iron-text'}`}>
            {res.guestName}
          </span>
          <span className="text-iron-muted/40 text-[11px] shrink-0 tabular-nums">{normalizeTime(res.time)}</span>
          <span className="text-iron-muted/40 text-[11px] shrink-0">· {res.partySize}p</span>
          {res.reorganizeAt && (
            <span className="text-[10px] px-1.5 py-px rounded border bg-purple-500/10 border-purple-500/28 text-purple-400/80 font-medium shrink-0">
              {T.smartAssign.displacedBadge}
            </span>
          )}
        </div>

        {/* Suggestion / status line */}
        {isNoTable ? (
          <span className="text-iron-muted/40 text-[11px] italic">{T.smartAssign.noTableLabel}</span>
        ) : isReady && item.suggestedTableName ? (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className="text-iron-muted/35 text-[11px]">→</span>
            <span className="text-iron-text/85 text-[12px] font-semibold">{item.suggestedTableName}</span>
            {item.sectionName && (
              <span className="text-iron-muted/38 text-[11px]">· {item.sectionName}</span>
            )}
            {item.isTight && (
              <span className="text-[10px] px-1.5 py-px rounded border bg-amber-500/8 border-amber-500/18 text-amber-500/65 font-medium shrink-0">
                {T.smartAssign.tightWarning}
              </span>
            )}
          </div>
        ) : null}

        {/* Exec error */}
        {phase !== 'preview' && execStatus === 'failed' && item.error && (
          <span className="text-red-400/65 text-[11px]">{item.error}</span>
        )}
      </div>
    </div>
  );
}

// ─── Undo button ──────────────────────────────────────────────────────────────
// Self-contained with its own busy state.
// Safety check: reads current reservation state from reservationsRef before
// each undo call. If the host manually reassigned the table after Smart Assign,
// the current tableId won't match what Smart Assign set — that item is skipped.

function UndoButton({
  execItems,
  reservationsRef,
  onUpdated,
  T,
}: {
  execItems:       ExecItem[];
  reservationsRef: React.MutableRefObject<Reservation[]>;
  onUpdated:       (r: Reservation) => void;
  T:               ReturnType<typeof import('../i18n/useT').useT>;
}) {
  const [undoBusy,   setUndoBusy]   = useState(false);
  const [undoDone,   setUndoDone]   = useState(false);
  const [undoResult, setUndoResult] = useState<string | null>(null);

  async function handleUndo() {
    setUndoBusy(true);
    const successful = execItems.filter(i => i.execStatus === 'success' && i.suggestedTableId);
    let cleared = 0;
    let skipped = 0;

    // Reverse order: undo last assignment first
    for (const item of [...successful].reverse()) {
      // Safety check against the live reservation list from the parent
      const current = reservationsRef.current.find(r => r.id === item.reservation.id);

      if (!current) {
        skipped++;
        continue;
      }

      // If the host manually changed the table after Smart Assign, preserve their work
      if (current.tableId !== item.suggestedTableId) {
        skipped++;
        continue;
      }

      try {
        const updated = await api.reservations.update(item.reservation.id, {
          tableId:          null,
          combinedTableIds: [],
        });
        onUpdated(updated);
        cleared++;
      } catch {
        skipped++;
      }
    }

    const parts: string[] = [];
    if (cleared > 0) parts.push(T.smartAssign.undoCleared(cleared));
    if (skipped > 0) parts.push(T.smartAssign.undoSkipped(skipped));
    setUndoResult(parts.join(' · ') || T.smartAssign.resultNone);
    setUndoBusy(false);
    setUndoDone(true);
  }

  if (undoDone) {
    return <span className="text-[11px] text-iron-muted/50 flex-1">{undoResult}</span>;
  }

  return (
    <button
      onClick={handleUndo}
      disabled={undoBusy}
      className="text-[12px] font-medium px-3.5 py-2.5 rounded-xl border border-iron-border/35 text-iron-muted/65 hover:text-iron-text hover:border-iron-border/55 transition-colors disabled:opacity-40 touch-manipulation shrink-0"
    >
      {undoBusy ? T.smartAssign.undoInProgress : T.smartAssign.undoBtn}
    </button>
  );
}
