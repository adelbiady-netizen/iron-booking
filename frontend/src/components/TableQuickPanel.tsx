import { useState, useRef, useEffect, useCallback } from 'react';
import type { FloorTable, Reservation, ReservationStatus, Table } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { arrivalState, minutesUntilRes } from '../utils/arrival';
import { formatReservationSource } from '../utils/displayHelpers';
import { fmtHostTime, normalizeTime } from '../utils/time';

const STATUS_DOT: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-400',
  CONFIRMED: 'bg-blue-400',
  SEATED:    'bg-emerald-400',
  COMPLETED: 'bg-iron-muted/50',
  CANCELLED: 'bg-red-400',
  NO_SHOW:   'bg-orange-400',
};

interface Props {
  floorTable: FloorTable;
  reservation: Reservation | null;
  allTables: Table[];
  isFutureDate: boolean;
  nowTime: string;
  isLiveView: boolean;
  onClose: () => void;
  onViewFull: (res: Reservation) => void;
  onSeat: (res: Reservation) => void;
  onMoveTable: (res: Reservation) => void;
  onChangeTable: (res: Reservation) => void;
  onLock: (table: FloorTable) => void;
  onUnlock: (tableId: string) => void;
  onOpenCreate: (tableId: string) => void;
  onOpenWalkin: (tableId: string) => void;
  onUpdated: (res: Reservation) => void;
  onSuccess: (msg: string) => void;
  inFlightIds?: ReadonlySet<string>;
}

export default function TableQuickPanel({
  floorTable,
  reservation: res,
  isFutureDate,
  nowTime,
  isLiveView,
  onClose,
  onViewFull,
  onSeat,
  onMoveTable,
  onChangeTable,
  onLock,
  onUnlock,
  onOpenCreate,
  onOpenWalkin,
  onUpdated,
  onSuccess,
  inFlightIds,
}: Props) {
  const T = useT();
  const { locale } = useLocale();

  // ── Loading state ──────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous guard against double-submit
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show spinner only after 300 ms to avoid flicker on fast responses
  useEffect(() => {
    if (busy) {
      spinnerTimer.current = setTimeout(() => setShowSpinner(true), 300);
    } else {
      if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
      setShowSpinner(false);
    }
    return () => { if (spinnerTimer.current) clearTimeout(spinnerTimer.current); };
  }, [busy]);

  const [error, setError] = useState<string | null>(null);

  // ── Inline covers stepper ──────────────────────────────────────────────────
  const [editingCovers, setEditingCovers] = useState(false);
  const [coversDraft, setCoversDraft] = useState(res?.partySize ?? 2);
  const coversInputRef = useRef<HTMLInputElement>(null);

  // ── Inline host note ───────────────────────────────────────────────────────
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(res?.hostNotes ?? '');
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // ── Unseat confirmation ────────────────────────────────────────────────────
  const [unseatPending, setUnseatPending] = useState(false);

  // ── SMS flash ─────────────────────────────────────────────────────────────
  const [smsSent, setSmsSent] = useState(false);
  const smsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escape key closes inline editors, then closes panel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (editingCovers) { e.preventDefault(); setEditingCovers(false); return; }
      if (editingNote)   { e.preventDefault(); setEditingNote(false);   return; }
      if (unseatPending) { e.preventDefault(); setUnseatPending(false); return; }
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingCovers, editingNote, unseatPending, onClose]);

  // Auto-focus when inline editors open
  useEffect(() => { if (editingCovers) coversInputRef.current?.focus(); }, [editingCovers]);
  useEffect(() => { if (editingNote)   noteRef.current?.focus();        }, [editingNote]);

  // Sync draft values when reservation changes (SSE push)
  useEffect(() => { if (!editingCovers) setCoversDraft(res?.partySize ?? 2); }, [res?.partySize, editingCovers]);
  useEffect(() => { if (!editingNote)   setNoteDraft(res?.hostNotes ?? '');  }, [res?.hostNotes, editingNote]);

  const STATUS_LABEL: Record<ReservationStatus, string> = {
    PENDING:   T.reservationStatus.PENDING,
    CONFIRMED: T.reservationStatus.CONFIRMED,
    SEATED:    T.reservationStatus.SEATED,
    COMPLETED: T.reservationStatus.COMPLETED,
    CANCELLED: T.reservationStatus.CANCELLED,
    NO_SHOW:   T.reservationStatus.NO_SHOW,
  };

  // ── Core action helper ─────────────────────────────────────────────────────
  // keepOpen=true: panel stays open after success (non-destructive actions).
  // keepOpen=false (default): panel closes — for status-changing actions.
  const quick = useCallback(async (fn: () => Promise<Reservation>, msg?: string, keepOpen = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const updated = await fn();
      onUpdated(updated);
      if (msg) onSuccess(msg);
      if (!keepOpen) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [onUpdated, onSuccess, onClose, T.guestDrawer.actionFailed]);

  async function handleSendSms() {
    if (!res || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const updated = await api.reservations.sendConfirmation(res.id);
      onUpdated(updated);
      if (smsTimer.current) clearTimeout(smsTimer.current);
      setSmsSent(true);
      smsTimer.current = setTimeout(() => setSmsSent(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleSaveCovers() {
    if (!res) return;
    await quick(
      () => api.reservations.update(res.id, { partySize: coversDraft }),
      undefined,
      true,
    );
    setEditingCovers(false);
  }

  async function handleSaveNote() {
    if (!res) return;
    await quick(
      () => api.reservations.update(res.id, { hostNotes: noteDraft }),
      undefined,
      true,
    );
    setEditingNote(false);
  }

  async function handleExtend(mins: number) {
    if (!res) return;
    await quick(
      () => api.reservations.update(res.id, { duration: res.duration + mins }),
      undefined,
      true,
    );
  }

  async function handleUnseat() {
    if (!res) return;
    await quick(() => api.reservations.unseat(res.id), T.guestDrawer.toastUndone);
  }

  // ── Button styles ──────────────────────────────────────────────────────────
  const base        = 'text-xs font-semibold px-3.5 py-3 rounded-xl border transition-[background-color,border-color,color,transform] duration-100 disabled:opacity-40 active:scale-[0.97]';
  const basePrimary = 'text-sm font-semibold px-4 py-4 rounded-xl border transition-[background-color,border-color,transform,opacity] duration-150 disabled:opacity-40 min-h-[52px] flex items-center justify-center w-full active:scale-[0.97]';
  const btnGreen   = `${basePrimary} bg-iron-green/22 border-iron-green/45 text-iron-green-light hover:bg-iron-green/32`;
  const btnBlue    = `${basePrimary} bg-blue-500/15 border-blue-500/32 text-blue-400 hover:bg-blue-500/26`;
  const btnAmber   = `${base} bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25`;
  const btnRed     = `${base} bg-red-900/15 border-red-900/25 text-red-400 hover:bg-red-900/25`;
  const btnNeutral = `${base} bg-iron-border/20 border-iron-border/40 text-iron-text hover:bg-iron-border/30`;

  function Btn({ label, cls, onClick, disabled, style }: { label: string; cls: string; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }) {
    return (
      <button onClick={onClick} disabled={disabled || busy} className={cls} style={style}>
        {label}
      </button>
    );
  }

  const primaryShadow: React.CSSProperties = { boxShadow: '0 1px 4px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.06)' };

  // ── Status pill ────────────────────────────────────────────────────────────
  const statusConfig = (() => {
    if (floorTable.locked) {
      return { cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400', dot: 'bg-amber-400', label: T.tableQuickPanel.locked };
    }
    if (floorTable.liveStatus === 'OCCUPIED') {
      const mr = floorTable.currentReservation?.minutesRemaining;
      const isOverdue = mr !== undefined && mr < 0;
      if (isOverdue) {
        const label = T.tableQuickPanel.minOver(Math.abs(mr!));
        return { cls: 'bg-red-900/20 border-red-700/30 text-red-400', dot: 'bg-red-400', label };
      }
      let label = T.tableQuickPanel.statusOccupied;
      if (mr !== undefined && isLiveView) {
        label = mr > 0 ? T.tableQuickPanel.minLeft(mr) : T.tableQuickPanel.statusOccupied;
      }
      return { cls: 'bg-iron-green/10 border-iron-green/25 text-iron-green-light', dot: 'bg-iron-green', label };
    }
    if (floorTable.liveStatus === 'RESERVED' && res && isLiveView) {
      const a = arrivalState(res.time, res.status, nowTime);
      if (a === 'NO_SHOW_RISK')   return { cls: 'bg-red-900/15 border-red-900/25 text-red-400',         dot: 'bg-red-400',    label: T.tableQuickPanel.arrivalNoShowRisk };
      if (a === 'LATE')           return { cls: 'bg-orange-500/15 border-orange-500/25 text-orange-400', dot: 'bg-orange-400', label: T.tableQuickPanel.arrivalLate };
      if (a === 'DUE_NOW')        return { cls: 'bg-blue-500/15 border-blue-500/25 text-blue-300',       dot: 'bg-blue-300',   label: T.tableQuickPanel.arrivalDueNow };
      if (a === 'ARRIVING_SOON')  return { cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400',       dot: 'bg-blue-400',   label: T.tableQuickPanel.arrivalSoon };
    }
    if (floorTable.liveStatus === 'RESERVED') {
      return { cls: 'bg-blue-500/10 border-blue-500/25 text-blue-400', dot: 'bg-blue-400', label: T.tableQuickPanel.statusReserved };
    }
    return { cls: 'bg-iron-bg border-iron-border text-iron-muted', dot: 'bg-iron-muted/50', label: T.tableQuickPanel.available };
  })();

  const minsUntil = res && isLiveView ? minutesUntilRes(res.time, nowTime) : null;
  const isClosed  = res && ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status);

  return (
    <aside className="h-full w-full bg-iron-bg flex flex-col">

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="px-4 pt-4 pb-3.5 border-b border-iron-border/50 shrink-0" style={{ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.022) 0%, transparent 100%)', boxShadow: '0 1px 0 rgba(255,255,255,0.07), 0 6px 22px rgba(0,0,0,0.32)' }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-iron-text font-bold text-2xl tracking-tight">{floorTable.name}</span>
                {floorTable.locked && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400 font-semibold">
                    {T.tableQuickPanel.locked}
                  </span>
                )}
              </div>
              <p className="text-iron-muted/70 text-xs mt-0.5 font-medium">
                {floorTable.minCovers}–{floorTable.maxCovers}
                {floorTable.section?.name ? ` · ${floorTable.section.name}` : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-iron-muted/50 hover:text-iron-text text-2xl leading-none -mt-0.5 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-iron-border/20 transition-colors"
              aria-label="Close"
            >×</button>
          </div>

          {/* Status pill */}
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border ${statusConfig.cls}`} style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.14)' }}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusConfig.dot}`} />
            <span>
              {statusConfig.label}
              {floorTable.locked && floorTable.lockReason ? ` · ${floorTable.lockReason}` : ''}
            </span>
          </div>
        </div>

        {/* ── BODY ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {res && (
            <div className="space-y-4">

              {/* ── GUEST IDENTITY ─────────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-iron-text font-bold text-[22px] leading-tight tracking-tight">{res.guestName}</span>
                  {res.guest?.isVip && (
                    <span className="text-amber-400 text-[10px] font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                      {T.common.vip}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[res.status]}`} />
                  <span className="text-iron-muted/75 text-xs">{STATUS_LABEL[res.status]}</span>
                  {res.isConfirmedByGuest && (
                    <span className="text-emerald-400 text-[10px]">· {T.guestDrawer.guestConfirmed}</span>
                  )}
                  {res.isRunningLate && (
                    <span className="text-orange-400 text-[10px]">· {T.guestDrawer.runningLate}</span>
                  )}
                  {minsUntil !== null && res.status === 'PENDING' && minsUntil > 0 && minsUntil <= 30 && (
                    <span className="text-amber-400 text-[10px]">· in {minsUntil}m</span>
                  )}
                </div>
              </div>

              {/* ── PHONE ──────────────────────────────────────────────────── */}
              {res.guestPhone && (
                <a
                  href={`tel:${res.guestPhone}`}
                  className="flex items-center gap-2 text-[15px] font-mono font-semibold text-iron-text hover:text-iron-green-light transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="text-iron-muted text-[11px]">📞</span>
                  {(() => {
                    const d = res.guestPhone!.replace(/\D/g, '');
                    if (d.length === 12 && d.startsWith('972')) return `+972 ${d.slice(3,5)} · ${d.slice(5,8)} · ${d.slice(8)}`;
                    if (d.length === 10 && d.startsWith('0'))   return `${d.slice(0,3)} · ${d.slice(3,6)} · ${d.slice(6)}`;
                    return res.guestPhone;
                  })()}
                </a>
              )}

              {/* ── CORE DETAILS ───────────────────────────────────────────── */}
              <div className="rounded-xl bg-iron-bg/50 border border-iron-border/30 px-3 py-2.5 space-y-1.5" style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.18), 0 1px 0 rgba(255,255,255,0.04)' }}>
                <div className="flex justify-between text-[13px]">
                  <span className="text-iron-muted/70">{T.tableQuickPanel.labelTime}</span>
                  <span className="text-iron-text font-semibold tabular-nums">{normalizeTime(res.time)}</span>
                </div>

                {/* Covers — inline number editor */}
                {editingCovers ? (
                  <div className="space-y-1.5 py-1">
                    <div className="flex items-center gap-2">
                      <span className="text-iron-muted text-[13px] flex-1">{T.tableQuickPanel.editCovers}</span>
                      <input
                        ref={coversInputRef}
                        type="number"
                        min={1}
                        max={30}
                        value={coversDraft}
                        onChange={e => setCoversDraft(Math.max(1, Number(e.target.value)))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveCovers(); }
                          // Escape handled globally above
                        }}
                        className="w-16 text-center text-sm text-iron-text bg-iron-bg border border-iron-border rounded px-1.5 py-0.5 focus:outline-none focus:border-iron-green/60 tabular-nums"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Btn label={T.tableQuickPanel.saveNote} cls={btnGreen} onClick={handleSaveCovers} />
                      <Btn label={T.tableQuickPanel.cancelEdit} cls={btnNeutral}
                        onClick={() => { setEditingCovers(false); setCoversDraft(res.partySize); }} />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingCovers(true); setCoversDraft(res.partySize); }}
                    className="flex justify-between text-[13px] w-full hover:bg-iron-border/10 rounded px-0.5 -mx-0.5 py-0.5 transition-colors group"
                    title="Click to edit covers"
                  >
                    <span className="text-iron-muted/70">{T.tableQuickPanel.labelGuests}</span>
                    <span className="text-iron-text font-medium group-hover:underline underline-offset-2">{res.partySize}</span>
                  </button>
                )}

                <div className="flex justify-between text-[13px]">
                  <span className="text-iron-muted/70">{T.tableQuickPanel.labelDuration}</span>
                  <span className="text-iron-text font-medium">{T.guestDrawer.durationValue(res.duration)}</span>
                </div>
                {res.source && (
                  <div className="flex justify-between text-[13px]">
                    <span className="text-iron-muted/70">{T.tableQuickPanel.labelSource}</span>
                    <span className="text-iron-text font-medium">{formatReservationSource(res.source, locale)}</span>
                  </div>
                )}
              </div>

              {/* ── TURN TIMING ────────────────────────────────────────────── */}
              {floorTable.liveStatus === 'OCCUPIED' && res.status === 'SEATED' && isLiveView && floorTable.currentReservation && (() => {
                const cr = floorTable.currentReservation!;
                const mr = cr.minutesRemaining;
                const freeAt = fmtHostTime(cr.expectedEndTime);
                const cardCls = cr.isOverdue
                  ? 'rounded-xl bg-red-900/10 border border-red-500/20 px-3 py-2 flex justify-between text-[13px]'
                  : mr <= 20
                  ? 'rounded-xl bg-amber-900/10 border border-amber-500/20 px-3 py-2 flex justify-between text-[13px]'
                  : 'rounded-xl bg-iron-bg/50 border border-iron-border/30 px-3 py-2 flex justify-between text-[13px]';
                return (
                  <div className={cardCls} style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.14)' }}>
                    {cr.isOverdue ? (
                      <>
                        <span className="text-red-400/75">Turn</span>
                        <span className="text-red-400/85 tabular-nums font-medium">~{Math.abs(mr)} min over · was {freeAt}</span>
                      </>
                    ) : mr <= 20 ? (
                      <>
                        <span className="text-amber-400/75">Turn</span>
                        <span className="text-amber-300/85 tabular-nums font-medium">Free in ~{mr} min · {freeAt}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-iron-muted">Turn</span>
                        <span className="text-iron-text/65 tabular-nums">Free around {freeAt}</span>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ── NOTES ──────────────────────────────────────────────────── */}
              <div className="space-y-1.5">
                {/* Host note — tap to edit */}
                {res.hostNotes && !editingNote && (
                  <button
                    onClick={() => { setEditingNote(true); setNoteDraft(res.hostNotes ?? ''); }}
                    className="w-full text-left px-2.5 py-2 rounded-lg bg-amber-900/8 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                    style={{ borderLeftWidth: '2px', borderLeftColor: 'rgba(217,119,6,0.72)' }}
                  >
                    <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider mb-0.5">{T.tableQuickPanel.hostNote}</p>
                    <p className="text-amber-100/85 text-xs">{res.hostNotes}</p>
                  </button>
                )}

                {/* Inline note editor */}
                {editingNote && (
                  <div className="space-y-1.5">
                    <textarea
                      ref={noteRef}
                      value={noteDraft}
                      onChange={e => setNoteDraft(e.target.value)}
                      rows={3}
                      placeholder={T.tableQuickPanel.addNote}
                      onKeyDown={e => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSaveNote(); }
                        // Escape handled globally above
                      }}
                      className="w-full text-xs rounded-lg border border-iron-border bg-iron-bg text-iron-text px-2.5 py-1.5 resize-none focus:outline-none focus:border-iron-green/60"
                    />
                    <p className="text-[10px] text-iron-muted/60">⌘↵ / Ctrl↵ to save</p>
                    <div className="flex gap-2">
                      <Btn label={T.tableQuickPanel.saveNote} cls={btnGreen} onClick={handleSaveNote} />
                      <Btn label={T.tableQuickPanel.cancelEdit} cls={btnNeutral} onClick={() => setEditingNote(false)} />
                    </div>
                  </div>
                )}

                {/* Add note link */}
                {!res.hostNotes && !editingNote && (
                  <button
                    onClick={() => { setEditingNote(true); setNoteDraft(''); }}
                    className="text-xs text-iron-muted hover:text-iron-text border border-dashed border-iron-border/60 hover:border-iron-border rounded-lg px-2.5 py-1.5 w-full text-left transition-colors"
                  >
                    + {T.tableQuickPanel.addNote}
                  </button>
                )}

                {/* Guest note (read-only) */}
                {res.guestNotes && (
                  <div className="px-2.5 py-2 rounded-lg bg-iron-card/70 border border-iron-border/70">
                    <p className="text-[10px] text-iron-muted/70 font-semibold uppercase tracking-wider mb-0.5">{T.tableQuickPanel.guestNote}</p>
                    <p className="text-iron-text/90 text-xs">{res.guestNotes}</p>
                  </div>
                )}

                {/* Occasion */}
                {res.occasion && (
                  <div className="px-2.5 py-2 rounded-lg bg-iron-green/10 border border-iron-green/25">
                    <p className="text-iron-green-light text-xs font-semibold">{res.occasion}</p>
                  </div>
                )}
              </div>

              {/* ── ACTIONS ────────────────────────────────────────────────── */}
              {!isClosed && (
                <div className="space-y-2.5">

                  {/* PRIMARY */}
                  <div className="flex flex-col gap-2">
                    {res.status === 'PENDING' && (<>
                      <Btn label={T.guestDrawer.actionSeat} cls={btnGreen} style={primaryShadow}
                        onClick={() => { onSeat({ ...res, tableId: floorTable.id }); onClose(); }}
                        disabled={isFutureDate || !!inFlightIds?.has(res.id)} />
                      <Btn label={T.guestDrawer.actionConfirm} cls={btnBlue} style={primaryShadow}
                        onClick={() => quick(() => api.reservations.confirm(res.id), T.guestDrawer.toastConfirmed, true)} />
                    </>)}

                    {res.status === 'CONFIRMED' && (
                      <Btn label={T.guestDrawer.actionSeat} cls={btnGreen} style={primaryShadow}
                        onClick={() => { onSeat({ ...res, tableId: floorTable.id }); onClose(); }}
                        disabled={isFutureDate || !!inFlightIds?.has(res.id)} />
                    )}

                    {res.status === 'SEATED' && (<>
                      <Btn label={T.guestDrawer.actionComplete} cls={btnGreen} style={primaryShadow}
                        onClick={() => quick(() => api.reservations.complete(res.id), T.guestDrawer.toastCompleted)} />
                      <Btn label={T.guestDrawer.actionMoveTable} cls={btnNeutral}
                        onClick={() => { onMoveTable(res); }} />
                    </>)}
                  </div>

                  {/* SECONDARY */}
                  <div className="flex flex-wrap gap-2">
                    {['PENDING', 'CONFIRMED'].includes(res.status) && (<>
                      <Btn
                        label={
                          !res.tableId
                            ? T.guestDrawer.actionChooseTable
                            : (res.combinedTableIds?.length ?? 0) > 0
                              ? T.guestDrawer.actionChangeCombination
                              : T.guestDrawer.actionChangeTable
                        }
                        cls={btnNeutral}
                        onClick={() => { onChangeTable(res); onClose(); }} />
                      {res.guestPhone && (
                        <Btn
                          label={smsSent ? T.tableQuickPanel.smsSent : T.guestDrawer.actionSendSms}
                          cls={smsSent ? btnGreen : btnNeutral}
                          onClick={handleSendSms}
                        />
                      )}
                    </>)}

                    {res.status === 'SEATED' && (<>
                      <Btn label={T.tableQuickPanel.extend15} cls={btnNeutral} onClick={() => handleExtend(15)} />
                      <Btn label={T.tableQuickPanel.extend30} cls={btnNeutral} onClick={() => handleExtend(30)} />
                    </>)}
                  </div>

                  {/* DANGEROUS — visually separated */}
                  <div className="pt-2 border-t border-iron-border/40 flex flex-wrap gap-2">
                    {['PENDING', 'CONFIRMED'].includes(res.status) && (<>
                      <Btn label={T.guestDrawer.actionNoShow} cls={btnAmber}
                        onClick={() => quick(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)} />
                      <Btn label={T.guestDrawer.actionCancel} cls={btnRed}
                        onClick={() => quick(() => api.reservations.cancel(res.id))} />
                    </>)}

                    {res.status === 'SEATED' && (
                      !unseatPending ? (
                        <>
                          <Btn label={T.guestDrawer.actionUnseat} cls={btnAmber}
                            onClick={() => setUnseatPending(true)} />
                          <Btn label={T.guestDrawer.actionCancel} cls={btnRed}
                            onClick={() => quick(() => api.reservations.cancel(res.id))} />
                        </>
                      ) : (
                        <div className="w-full space-y-1.5">
                          <p className="text-amber-400 text-xs font-medium">{T.tableQuickPanel.unseatConfirm}</p>
                          <div className="flex gap-2">
                            <Btn label={T.tableQuickPanel.unseatConfirmYes} cls={btnAmber} onClick={handleUnseat} />
                            <Btn label={T.tableQuickPanel.cancelEdit} cls={btnNeutral}
                              onClick={() => setUnseatPending(false)} />
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Closed state */}
              {isClosed && (
                <Btn label={T.guestDrawer.actionUndo} cls={btnNeutral}
                  onClick={() => quick(() => api.reservations.undo(res.id), T.guestDrawer.toastUndone)} />
              )}
            </div>
          )}

          {/* ── AVAILABLE TABLE ─────────────────────────────────────────────── */}
          {!res && !floorTable.locked && (
            <div className="space-y-2">
              <p className="text-iron-muted/70 text-xs font-medium">{T.tableQuickPanel.available}</p>
              <div className="flex flex-col gap-2">
                <Btn label={T.tableQuickPanel.newReservation} cls={btnGreen}
                  onClick={() => { onOpenCreate(floorTable.id); onClose(); }} />
                <Btn label={T.tableQuickPanel.walkIn} cls={btnNeutral}
                  onClick={() => { onOpenWalkin(floorTable.id); onClose(); }} />
              </div>
              <div className="pt-2 border-t border-iron-border/40">
                <Btn label={T.guestDrawer.lockTableButton} cls={btnAmber}
                  onClick={() => { onLock(floorTable); onClose(); }} />
              </div>
            </div>
          )}

          {/* ── LOCKED TABLE ────────────────────────────────────────────────── */}
          {!res && floorTable.locked && (
            <div className="space-y-2">
              {floorTable.lockReason && (
                <div className="px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
                  <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider mb-0.5">{T.tableQuickPanel.lockedTitle}</p>
                  <p className="text-amber-300 text-xs">{floorTable.lockReason}</p>
                </div>
              )}
              <Btn label={T.guestDrawer.unlockButton} cls={btnNeutral}
                onClick={() => { onUnlock(floorTable.id); onClose(); }} />
            </div>
          )}

          {/* ── ERROR ───────────────────────────────────────────────────────── */}
          {error && (
            <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* ── SPINNER (delayed 300ms) ──────────────────────────────────────── */}
          {showSpinner && (
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
              <span className="text-iron-muted text-xs">{T.common.processing}</span>
            </div>
          )}
        </div>

        {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
        {res && (
          <div className="p-4 border-t border-iron-border/40 shrink-0" style={{ backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.10) 0%, transparent 100%)' }}>
            <button
              onClick={() => { onViewFull(res); onClose(); }}
              className="w-full text-sm font-semibold text-iron-green-light hover:text-white bg-iron-green/14 hover:bg-iron-green/28 border border-iron-green/40 hover:border-iron-green/65 rounded-xl px-3 py-3.5 transition-[background-color,border-color,color] duration-150 active:scale-[0.98]"
              style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.07)' }}
            >
              {T.tableQuickPanel.viewFullDetails} →
            </button>
          </div>
        )}
    </aside>
  );
}
