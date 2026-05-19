import { useState, useEffect, useRef } from 'react';
import type { BackendTableSuggestion, Reservation, ReservationStatus, Table } from '../types';
import { api, ApiError } from '../api';
import ReorganizeConflictModal from './ReorganizeConflictModal';
import SmartTablePicker from './SmartTablePicker';
import type React from 'react';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatReservationSource } from '../utils/displayHelpers';
import { arrivalState, minutesUntilRes } from '../utils/arrival';
import { fmtHostTime, normalizeTime } from '../utils/time';

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

const STATUS_PILL: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  CONFIRMED: 'bg-blue-500/12 text-blue-300/90 border border-blue-500/25',
  SEATED:    'bg-iron-green/22 text-iron-green-light border border-iron-green/35',
  COMPLETED: 'bg-iron-border/18 text-iron-muted/75 border border-iron-border/25',
  CANCELLED: 'bg-red-900/15 text-red-400 border border-red-900/25',
  NO_SHOW:   'bg-orange-900/15 text-orange-400 border border-orange-900/25',
};

interface RowProps { label: string; value: string; accent?: boolean; warn?: boolean }
function Row({ label, value, accent, warn }: RowProps) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-iron-muted/70 text-[13px] font-medium shrink-0">{label}</span>
      <span className={`text-[13px] text-right font-semibold ${warn ? 'text-orange-400' : accent ? 'text-iron-green-light' : 'text-iron-text'}`}>
        {value}
      </span>
    </div>
  );
}

function Ts({ label, ts }: { label: string; ts: string }) {
  const t = fmtHostTime(ts);
  return (
    <div className="flex justify-between">
      <span className="text-iron-muted/70 text-xs font-medium">{label}</span>
      <span className="text-iron-text text-xs font-semibold tabular-nums">{t}</span>
    </div>
  );
}

// ─── Table picker ─────────────────────────────────────────────────────────────

interface TablePickerProps {
  tables: Table[];
  excludeId?: string | null;
  label: string;
  busy: boolean;
  onPick: (tableId: string) => void;
  onBack: () => void;
}

function TablePicker({ tables, excludeId, label, busy, onPick, onBack }: TablePickerProps) {
  const T = useT();
  const candidates = tables.filter(t => t.isActive && t.id !== excludeId);

  return (
    <div>
      <p className="text-iron-muted text-xs mb-2">{label}</p>
      {candidates.length === 0 && (
        <p className="text-iron-muted text-xs italic">{T.guestDrawer.noTablesAvailable}</p>
      )}
      <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-1">
        {candidates.map(t => (
          <button
            key={t.id}
            disabled={busy}
            onClick={() => onPick(t.id)}
            className="text-xs p-2 rounded-lg border border-iron-border hover:border-iron-green text-iron-text text-center transition-colors disabled:opacity-40"
          >
            <div className="font-semibold">{t.name}</div>
            <div className="text-iron-muted text-[11px]">
              {t.minCovers}–{t.maxCovers}
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={onBack}
        className="mt-2 text-iron-muted text-xs hover:text-iron-text transition-colors"
      >
        {T.guestDrawer.backLink}
      </button>
    </div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

interface ActionBtnProps {
  label: string;
  cls: string;
  onClick: () => void;
  disabled: boolean;
  title?: string;
  primary?: boolean;
}

function ActionBtn({ label, cls, onClick, disabled, title, primary }: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-xl border transition-[color,background-color,border-color,opacity,transform] duration-100 disabled:opacity-40 active:scale-[0.96] touch-manipulation ${
        primary ? 'text-sm font-semibold px-4 py-3.5' : 'text-xs font-medium px-3 py-2'
      } ${cls}`}
    >
      {label}
    </button>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  children: React.ReactNode;
}
function Field({ label, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-iron-muted text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-iron-bg border border-iron-border/80 rounded-lg px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted/80 focus:outline-none focus:border-iron-green/70 transition-colors';

// ─── Suggestion reason chips ──────────────────────────────────────────────────

function SuggestionChips({ s, T }: { s: BackendTableSuggestion; T: ReturnType<typeof import('../i18n/useT').useT> }) {
  const chips: string[] = [];
  if (s.reasons.some(r => r.code === 'PERFECT_FIT')) chips.push(T.guestDrawer.suggestReasonPerfectFit);
  if (s.status === 'recommended') chips.push(T.guestDrawer.suggestReasonAvailable);
  if (!s.reasons.some(r => ['CONFLICT', 'GAP_BEFORE_TIGHT', 'GAP_AFTER_TIGHT'].includes(r.code))) {
    chips.push(T.guestDrawer.suggestReasonNoConflicts);
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(chip => (
        <span key={chip} className="text-[11px] px-2 py-0.5 rounded-full bg-iron-green/15 border border-iron-green/25 text-iron-green-light font-medium">
          {chip}
        </span>
      ))}
    </div>
  );
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

type Mode = 'view' | 'edit' | 'seat' | 'move' | 'change-table' | 'cancel' | 'lock' | 'delete';

type SmartSuggestion =
  | { mode: 'assign'; suggestion: BackendTableSuggestion }
  | { mode: 'upgrade'; current: BackendTableSuggestion | null; suggestion: BackendTableSuggestion }
  | null;

function isMeaningfulUpgrade(
  current: BackendTableSuggestion | null,
  suggestion: BackendTableSuggestion,
): boolean {
  const curCodes = (current?.reasons ?? []).map(r => r.code);

  // Current table is blocked for any reason (conflict, too small, table lock)
  if (current?.status === 'blocked') return true;

  // Overlapping reservation on current table
  if (curCodes.includes('CONFLICT')) return true;

  // Current table is oversized (≥4 excess covers); suggestion fits the party better
  if (curCodes.includes('LARGE_TABLE') &&
      suggestion.reasons.some(r => r.code === 'PERFECT_FIT' || r.code === 'GOOD_FIT')) return true;

  // Current has a tight gap (< 15 min before or after); suggestion avoids it
  const curTight = curCodes.includes('GAP_BEFORE_TIGHT') || curCodes.includes('GAP_AFTER_TIGHT');
  const sugTight = suggestion.reasons.some(r => r.code === 'GAP_BEFORE_TIGHT' || r.code === 'GAP_AFTER_TIGHT');
  if (curTight && !sugTight) return true;

  return false;
}

interface Props {
  reservation: Reservation;
  tables: Table[];
  allReservations?: Reservation[];
  onClose: () => void;
  onUpdated: (r: Reservation) => void;
  onSuccess?: (message: string) => void;
  onTableLockChange?: () => void;
  nowTime?: string;
  isLiveView?: boolean;
  onPickTables?: (currentIds: string[], suggestions: BackendTableSuggestion[], callback: (ids: string[] | null) => void, action?: 'seat' | 'move' | 'change-table', guestName?: string) => void;
  onPickTablesCancel?: () => void;
  /** Called when the host changes the date/time in edit mode so the floor board
   *  can reload for the same date and stay in sync with the drawer. */
  onDateTimeChange?: (date: string, time: string) => void;
}

export default function GuestDrawer({ reservation: init, tables, allReservations, onClose, onUpdated, onSuccess, onTableLockChange, nowTime, isLiveView, onPickTables, onPickTablesCancel, onDateTimeChange }: Props) {
  const T = useT();
  const { locale } = useLocale();
  const STATUS_LABEL: Record<ReservationStatus, string> = {
    PENDING:   T.reservationStatus.PENDING,
    CONFIRMED: T.reservationStatus.CONFIRMED,
    SEATED:    T.reservationStatus.SEATED,
    COMPLETED: T.reservationStatus.COMPLETED,
    CANCELLED: T.reservationStatus.CANCELLED,
    NO_SHOW:   T.reservationStatus.NO_SHOW,
  };
  const LOCK_QUICK_REASONS = T.guestDrawer.quickLockReasons;
  const [res, setRes] = useState<Reservation>(init);
  const [mode, setMode] = useState<Mode>('view');

  // Cross-date seating is forbidden. Same-day early arrivals are always allowed.
  const _todayStr = new Date().toISOString().slice(0, 10);
  const isFutureReservation = res.date.slice(0, 10) > _todayStr;
  const [cancelReason,  setCancelReason]  = useState('');
  const [unseatConfirm, setUnseatConfirm] = useState(false);
  const [phoneCopied,   setPhoneCopied]   = useState(false);
  const [lockReason,   setLockReason]   = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reorganizeKeyRef = useRef(0);
  const inflightRef = useRef(false);
  const actionsRef = useRef<HTMLElement>(null);
  const prevIsArrivedRef = useRef(res.isArrived);
  const [reorganizeModal, setReorganizeModal] = useState<{
    conflicts: Array<{ id: string; guestName: string; time: string; partySize: number; minutesUntil: number }>;
    pendingTableId: string;
    pendingCombinedIds: string[];
    pendingToast: string;
    _key: number;
  } | null>(null);

  // Edit form state — initialised when entering edit mode
  const [editName,       setEditName]       = useState('');
  const [editPhone,      setEditPhone]      = useState('');
  const [editDate,       setEditDate]       = useState('');
  const [editTime,       setEditTime]       = useState('');
  const [editParty,      setEditParty]      = useState('');
  const [editDuration,   setEditDuration]   = useState(0);
  const [originalDuration, setOriginalDuration] = useState(0);
  const [editOccasion,   setEditOccasion]   = useState('');
  const [editNotes,      setEditNotes]      = useState('');
  const [editHostNotes,  setEditHostNotes]  = useState('');
  const [editTableId,         setEditTableId]         = useState<string | null>(null);
  const [editCombinedTableIds, setEditCombinedTableIds] = useState<string[]>([]);
  const [pickingOnMap,         setPickingOnMap]         = useState(false);
  const [pickingForAction,     setPickingForAction]     = useState<'seat' | 'move' | 'change-table' | null>(null);
  const [showTablePicker,      setShowTablePicker]      = useState(false);
  const [tableSuggestions,     setTableSuggestions]     = useState<BackendTableSuggestion[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [smartSuggestion, setSmartSuggestion] = useState<SmartSuggestion>(null);
  const [smartLoading, setSmartLoading] = useState(false);

  useEffect(() => {
    if (!['PENDING', 'CONFIRMED'].includes(res.status) || res.returnedToListAt) {
      setSmartSuggestion(null);
      return;
    }
    let cancelled = false;
    setSmartLoading(true);
    setSmartSuggestion(null);
    api.tables.suggest({
      date: res.date, time: res.time, partySize: res.partySize,
      duration: res.duration, excludeReservationId: res.id,
    }).then(list => {
      if (cancelled) return;
      const currentEntry = res.tableId ? (list.find(s => s.tableId === res.tableId) ?? null) : null;
      const bestOther = list.filter(s => s.tableId !== res.tableId).find(s => !!s.tableId) ?? null;

      if (!res.tableId) {
        setSmartSuggestion(bestOther ? { mode: 'assign', suggestion: bestOther } : null);
      } else {
        if (!bestOther) { setSmartSuggestion(null); return; }
        if (isMeaningfulUpgrade(currentEntry, bestOther)) {
          setSmartSuggestion({ mode: 'upgrade', current: currentEntry, suggestion: bestOther });
        } else {
          setSmartSuggestion(null);
        }
      }
    }).catch(() => {
      if (!cancelled) setSmartSuggestion(null);
    }).finally(() => {
      if (!cancelled) setSmartLoading(false);
    });
    return () => { cancelled = true; };
  }, [res.id, res.status, res.tableId]);

  // Scroll to the seating actions when a guest is just marked arrived,
  // so the host's next step (Seat) is immediately in view.
  useEffect(() => {
    if (res.isArrived && !prevIsArrivedRef.current) {
      actionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevIsArrivedRef.current = res.isArrived;
  }, [res.isArrived]);

  function enterEdit() {
    setEditName(res.guestName);
    setEditPhone(res.guestPhone ?? '');
    setEditDate(res.date.slice(0, 10)); // normalize ISO "2026-05-19T00:00:00.000Z" → "2026-05-19"
    setEditTime(res.time);
    setEditParty(String(res.partySize));
    setEditDuration(res.duration);
    setOriginalDuration(res.duration);
    setEditOccasion(res.occasion ?? '');
    setEditNotes(res.guestNotes ?? '');
    setEditHostNotes(res.hostNotes ?? '');
    setEditTableId(res.tableId ?? null);
    setEditCombinedTableIds(res.combinedTableIds ?? []);
    setPickingOnMap(false);
    setShowTablePicker(false);
    setTableSuggestions([]);
    setError(null);
    setMode('edit');
  }

  function adjustDuration(delta: number) {
    setEditDuration(prev => Math.min(480, Math.max(30, prev + delta)));
  }

  async function fetchTableSuggestions() {
    const partySize = parseInt(editParty, 10);
    if (!editDate || !editTime || isNaN(partySize) || partySize < 1) return;
    setSuggestBusy(true);
    try {
      const suggestions = await api.tables.suggest({
        date: editDate, time: editTime, partySize, duration: editDuration,
        excludeReservationId: res.id,
      });
      setTableSuggestions(suggestions);
    } catch {
      setTableSuggestions([]);
    } finally {
      setSuggestBusy(false);
    }
  }

  async function openMapPicker() {
    setPickingOnMap(true);
    setShowTablePicker(false);
    // tableSuggestions is only populated when the inline picker opens first;
    // direct "Select on map" clicks bypass that, so fetch fresh here if needed.
    let sug = tableSuggestions;
    if (sug.length === 0) {
      const partySize = parseInt(editParty, 10);
      if (editDate && editTime && !isNaN(partySize) && partySize >= 1) {
        try {
          sug = await api.tables.suggest({
            date: editDate, time: editTime, partySize, duration: editDuration,
            excludeReservationId: res.id,
          });
          setTableSuggestions(sug);
        } catch { /* fall back to empty */ }
      }
    }
    onPickTables?.(
      [editTableId, ...editCombinedTableIds].filter(Boolean) as string[],
      sug,
      (ids) => {
        setPickingOnMap(false);
        if (ids !== null) {
          setEditTableId(ids[0] ?? null);
          setEditCombinedTableIds(ids.slice(1));
        }
      },
    );
  }

  async function openActionMapPicker(action: 'seat' | 'move' | 'change-table') {
    const currentIds = [res.tableId, ...(res.combinedTableIds ?? [])].filter(Boolean) as string[];
    setPickingForAction(action);
    // tableSuggestions is never auto-fetched for action pickers (Seat/Move/Change Table
    // in view mode); always fetch fresh to ensure combined-table conflicts are visible.
    let sug = tableSuggestions;
    if (sug.length === 0) {
      try {
        sug = await api.tables.suggest({
          date: res.date, time: res.time, partySize: res.partySize,
          duration: res.duration, excludeReservationId: res.id,
        });
      } catch { /* fall back to empty */ }
    }
    onPickTables?.(
      currentIds,
      sug,
      (ids) => {
        setPickingForAction(null);
        if (ids === null || ids.length === 0) return;
        const [primaryId, ...secondaryIds] = ids;
        if (action === 'seat') {
          seatWithReorganizeCheck(primaryId, secondaryIds, T.guestDrawer.toastSeated(res.guestName, tableName(primaryId)));
        } else if (action === 'move') {
          run(
            () => api.reservations.move(res.id, primaryId, undefined, secondaryIds),
            T.guestDrawer.toastMoved(tableName(primaryId)),
          );
        } else {
          run(
            () => api.reservations.update(res.id, { tableId: primaryId, combinedTableIds: secondaryIds }),
            T.guestDrawer.toastTableAssigned(tableName(primaryId)),
          );
        }
      },
      action,
      res.guestName,
    );
  }

  async function saveEdit() {
    const isSeated = res.status === 'SEATED';
    const partySize = parseInt(editParty, 10);
    if (!editName.trim()) { setError(T.guestDrawer.fieldGuestName + ' is required'); return; }
    if (isNaN(partySize) || partySize < 1) { setError(T.guestDrawer.fieldPartySize + ' must be at least 1'); return; }
    if (editDuration < 30) { setError(T.guestDrawer.fieldDuration + ' must be at least 30 minutes'); return; }
    if (!isSeated && !editDate) { setError(T.guestDrawer.fieldDate + ' is required'); return; }
    if (!isSeated && !editTime) { setError(T.guestDrawer.fieldTime + ' is required'); return; }

    const tableChanged = editTableId !== res.tableId ||
      JSON.stringify([...editCombinedTableIds].sort()) !== JSON.stringify([...(res.combinedTableIds ?? [])].sort());

    await run(
      () => api.reservations.update(res.id, {
        guestName:  editName.trim(),
        guestPhone: editPhone.trim() || undefined,
        partySize,
        ...(isSeated ? {} : {
          date:     editDate !== res.date.slice(0, 10) ? editDate : undefined,
          time:     editTime !== res.time ? editTime : undefined,
          ...(tableChanged ? { tableId: editTableId, combinedTableIds: editCombinedTableIds } : {}),
        }),
        duration:   editDuration,
        // Only include when changed; empty string clears an existing value
        ...(editOccasion.trim() !== (res.occasion ?? '')        ? { occasion:   editOccasion.trim() }  : {}),
        ...(editNotes.trim() !== (res.guestNotes ?? '')         ? { guestNotes: editNotes.trim() }     : {}),
        ...(editHostNotes.trim() !== (res.hostNotes ?? '')      ? { hostNotes:  editHostNotes.trim() } : {}),
      }),
      T.guestDrawer.toastUpdated
    );
  }

  async function run(fn: () => Promise<Reservation>, successMsg?: string) {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const updated = await fn();
      setRes(updated);
      onUpdated(updated);
      setMode('view');
      setUnseatConfirm(false);
      if (successMsg) onSuccess?.(successMsg);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
    } finally {
      setBusy(false);
      inflightRef.current = false;
    }
  }

  async function seatWithReorganizeCheck(tableId: string, combinedIds: string[], toastMsg: string) {
    // Hard guard: never fire the seat API without a valid table.
    // Routes to picker instead so the host can assign one.
    if (!tableId) {
      if (onPickTables) openActionMapPicker('seat');
      else setMode('seat');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const updated = await api.reservations.seat(res.id, tableId, false, combinedIds);
      setRes(updated); onUpdated(updated); setMode('view'); setUnseatConfirm(false);
      onSuccess?.(toastMsg);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const det = err.details as { code?: string; conflicts?: Array<{ id: string; guestName: string; time: string; partySize: number; minutesUntil: number }> } | null;
        if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
          setReorganizeModal({ conflicts: det.conflicts, pendingTableId: tableId, pendingCombinedIds: combinedIds, pendingToast: toastMsg, _key: ++reorganizeKeyRef.current });
          return;
        }
      }
      setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  // ─── Action buttons per status ──────────────────────────────────────────────

  const btnGreen  = 'bg-iron-green/20 border-iron-green/40 text-iron-green-light hover:bg-iron-green/30';
  const btnBlue   = 'bg-blue-500/15 border-blue-500/30 text-blue-400 hover:bg-blue-500/25';
  const btnAmber  = 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25';
  const btnRed    = 'bg-red-900/15 border-red-900/25 text-red-400 hover:bg-red-900/25';
  const btnNeutral= 'bg-iron-border/20 border-iron-border/40 text-iron-text hover:bg-iron-border/30';

  const assignedTable   = res.tableId ? tables.find(t => t.id === res.tableId) ?? null : null;
  const tableIsLocked   = assignedTable?.locked ?? false;

  async function handleLockTable() {
    if (!assignedTable) return;
    setError(null); setBusy(true);
    try {
      await api.tables.lock(assignedTable.id, { reason: lockReason.trim() || null });
      setMode('view'); setLockReason('');
      onSuccess?.(T.guestDrawer.toastLocked(assignedTable.name));
      onTableLockChange?.();
    } catch (err) { setError(err instanceof Error ? err.message : T.lockModal.errorFailed); }
    finally { setBusy(false); }
  }

  async function handleUnlockTable() {
    if (!assignedTable) return;
    setError(null); setBusy(true);
    try {
      await api.tables.unlock(assignedTable.id);
      onSuccess?.(T.guestDrawer.toastUnlocked(assignedTable.name));
      onTableLockChange?.();
    } catch (err) { setError(err instanceof Error ? err.message : T.hostDashboard.toastUnlockFail); }
    finally { setBusy(false); }
  }

  function tableName(id: string) {
    return tables.find(t => t.id === id)?.name ?? 'table';
  }

  function ConfirmationSection() {
    const isClosed = ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(res.status);

    // "Needs reminder" — within 60 min, not yet confirmed, initial SMS already sent, <2 reminders
    const needsReminder = (() => {
      if (res.isConfirmedByGuest || !res.confirmationSentAt || res.reminderCount >= 2) return false;
      if (!nowTime) return false;
      const [rh, rm] = res.time.split(':').map(Number);
      const [nh, nm] = nowTime.split(':').map(Number);
      const minsUntil = (rh * 60 + rm) - (nh * 60 + nm);
      return minsUntil > 0 && minsUntil <= 60;
    })();

    const fmtTime = fmtHostTime;

    return (
      <section className="border-t border-iron-border pt-4 space-y-2.5">
        <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider">
          {T.guestDrawer.confirmationSection}
        </p>

        {/* Confirmation status */}
        {res.isArrived && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
            <span className="text-teal-400 text-xs font-medium">{T.guestDrawer.guestArrived}</span>
          </div>
        )}
        {res.isRunningLate && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
            <span className="text-orange-400 text-xs font-medium">{T.guestDrawer.guestRunningLate}</span>
          </div>
        )}
        {res.isConfirmedByGuest ? (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-iron-green-light/60 shrink-0" />
            <span className="text-iron-green-light text-xs">{T.guestDrawer.guestConfirmed}</span>
            {res.confirmationSentAt && (
              <span className="text-iron-muted text-xs">· {T.guestDrawer.viaSms} {fmtTime(res.confirmationSentAt)}</span>
            )}
          </div>
        ) : res.confirmationSentAt ? (
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${needsReminder ? 'bg-amber-400' : 'bg-blue-400'}`} />
            <span className={`text-xs ${needsReminder ? 'text-amber-400 font-medium' : 'text-blue-400'}`}>
              {needsReminder ? T.guestDrawer.needsReminder : T.guestDrawer.smsSentAwaiting(fmtTime(res.confirmationSentAt))}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-iron-muted/50 shrink-0" />
            <span className="text-iron-muted text-xs">{T.guestDrawer.noConfirmationSent}</span>
          </div>
        )}

        {/* Reminder status */}
        {res.remindedAt && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-iron-muted/40 shrink-0" />
            <span className="text-iron-muted text-xs">
              {T.guestDrawer.reminderSentAt} {fmtTime(res.remindedAt)}
              {res.reminderCount > 1 && ` (×${res.reminderCount})`}
              {res.reminderCount >= 2 && ` · ${T.guestDrawer.maxRemindersReached}`}
            </span>
          </div>
        )}

        {/* Buttons */}
        {!isClosed && (
          <div className="flex flex-wrap gap-2">
            {res.guestPhone ? (
              <>
                {/* Confirmation SMS */}
                {!res.isConfirmedByGuest && (
                  <ActionBtn
                    label={res.confirmationSentAt ? T.guestDrawer.resendConfirmation : T.guestDrawer.sendConfirmation}
                    cls={res.confirmationSentAt ? btnNeutral : btnBlue}
                    onClick={() => run(
                      () => api.reservations.sendConfirmation(res.id),
                      res.confirmationSentAt ? T.guestDrawer.confirmationResent : T.guestDrawer.confirmationSent
                    )}
                    disabled={busy}
                  />
                )}
                {res.isConfirmedByGuest && (
                  <ActionBtn
                    label={T.guestDrawer.resendConfirmation}
                    cls={btnNeutral}
                    onClick={() => run(() => api.reservations.sendConfirmation(res.id), T.guestDrawer.confirmationResent)}
                    disabled={busy}
                  />
                )}

                {/* Reminder button — only when eligible */}
                {!res.isConfirmedByGuest && res.confirmationSentAt && res.reminderCount < 2 && (
                  <ActionBtn
                    label={needsReminder ? T.guestDrawer.sendReminderNow : T.guestDrawer.sendReminder}
                    cls={needsReminder ? btnAmber : btnNeutral}
                    onClick={() => run(() => api.reservations.sendReminder(res.id), T.guestDrawer.reminderSentToast)}
                    disabled={busy}
                  />
                )}
              </>
            ) : (
              <ActionBtn
                label={T.guestDrawer.noPhone}
                cls="bg-iron-border/10 border-iron-border/30 text-iron-muted cursor-not-allowed"
                onClick={() => {}}
                disabled={true}
              />
            )}

            {!res.isConfirmedByGuest && (
              <ActionBtn
                label={T.guestDrawer.markAsConfirmed}
                cls={btnNeutral}
                onClick={() => run(() => api.reservations.markConfirmedByGuest(res.id), T.guestDrawer.markedAsConfirmed)}
                disabled={busy}
              />
            )}
          </div>
        )}
      </section>
    );
  }

  function Actions() {
    if (res.status === 'PENDING') return (
      <>
        {/* Primary */}
        <div className="flex gap-2">
          <ActionBtn label={T.guestDrawer.actionConfirm} cls={btnBlue} onClick={() => run(() => api.reservations.confirm(res.id), T.guestDrawer.toastConfirmed)} disabled={busy} primary />
          <ActionBtn
            label={T.guestDrawer.actionSeat}
            cls={btnGreen}
            primary
            onClick={() => {
              if (!res.tableId) {
                // No table assigned — must pick one before seating
                if (onPickTables) openActionMapPicker('seat');
                else setMode('seat');
              } else {
                // Table assigned — seat immediately; conflict guard fires if needed
                seatWithReorganizeCheck(res.tableId, res.combinedTableIds ?? [], T.guestDrawer.toastSeated(res.guestName, tableName(res.tableId)));
              }
            }}
            disabled={busy || isFutureReservation}
            title={isFutureReservation ? T.guestDrawer.seatFutureDisabled : undefined}
          />
        </div>
        {isFutureReservation && (
          <p className="text-xs text-iron-muted mt-1.5 px-0.5">{T.guestDrawer.seatFutureDisabled}</p>
        )}
        {/* Secondary */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ActionBtn
            label={
              !res.tableId
                ? T.guestDrawer.actionChooseTable
                : (res.combinedTableIds?.length ?? 0) > 0
                  ? T.guestDrawer.actionChangeCombination
                  : T.guestDrawer.actionChangeTable
            }
            cls={btnNeutral}
            onClick={() => onPickTables ? openActionMapPicker('change-table') : setMode('change-table')}
            disabled={busy}
          />
          {res.guestPhone && !res.isConfirmedByGuest && (
            <ActionBtn
              label={T.guestDrawer.actionSendSms}
              cls={btnNeutral}
              onClick={() => run(() => api.reservations.sendConfirmation(res.id), res.confirmationSentAt ? T.guestDrawer.confirmationResent : T.guestDrawer.confirmationSent)}
              disabled={busy}
            />
          )}
          {!res.isArrived && (
            <ActionBtn
              label={T.guestDrawer.actionMarkArrived}
              cls={btnNeutral}
              onClick={() => run(() => api.reservations.markArrived(res.id), T.guestDrawer.toastArrived)}
              disabled={busy}
            />
          )}
          {res.isArrived && (
            <ActionBtn
              label={T.guestDrawer.actionUndoArrival}
              cls={btnNeutral}
              onClick={() => run(() => api.reservations.unmarkArrived(res.id), T.guestDrawer.actionUndoArrival)}
              disabled={busy}
            />
          )}
        </div>
        {/* Destructive */}
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-iron-border/30">
          <ActionBtn label={T.guestDrawer.actionNoShow} cls={btnAmber} onClick={() => run(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)} disabled={busy} />
          <ActionBtn label={T.guestDrawer.actionCancel} cls={btnRed}   onClick={() => setMode('cancel')} disabled={busy} />
        </div>
      </>
    );

    if (res.status === 'CONFIRMED') return (
      <>
        {/* Primary */}
        <div className="flex gap-2">
          <ActionBtn
            label={T.guestDrawer.actionSeat}
            cls={btnGreen}
            primary
            onClick={() => {
              if (!res.tableId) {
                // No table assigned — must pick one before seating
                if (onPickTables) openActionMapPicker('seat');
                else setMode('seat');
              } else {
                // Table assigned — seat immediately; conflict guard fires if needed
                seatWithReorganizeCheck(res.tableId, res.combinedTableIds ?? [], T.guestDrawer.toastSeated(res.guestName, tableName(res.tableId)));
              }
            }}
            disabled={busy || isFutureReservation}
            title={isFutureReservation ? T.guestDrawer.seatFutureDisabled : undefined}
          />
        </div>
        {isFutureReservation && (
          <p className="text-xs text-iron-muted mt-1.5 px-0.5">{T.guestDrawer.seatFutureDisabled}</p>
        )}
        {/* Secondary */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ActionBtn
            label={
              !res.tableId
                ? T.guestDrawer.actionChooseTable
                : (res.combinedTableIds?.length ?? 0) > 0
                  ? T.guestDrawer.actionChangeCombination
                  : T.guestDrawer.actionChangeTable
            }
            cls={btnNeutral}
            onClick={() => onPickTables ? openActionMapPicker('change-table') : setMode('change-table')}
            disabled={busy}
          />
          {res.guestPhone && !res.isConfirmedByGuest && (
            <ActionBtn
              label={T.guestDrawer.actionSendSms}
              cls={btnNeutral}
              onClick={() => run(() => api.reservations.sendConfirmation(res.id), res.confirmationSentAt ? T.guestDrawer.confirmationResent : T.guestDrawer.confirmationSent)}
              disabled={busy}
            />
          )}
          {!res.isArrived && (
            <ActionBtn
              label={T.guestDrawer.actionMarkArrived}
              cls={btnNeutral}
              onClick={() => run(() => api.reservations.markArrived(res.id), T.guestDrawer.toastArrived)}
              disabled={busy}
            />
          )}
          {res.isArrived && (
            <ActionBtn
              label={T.guestDrawer.actionUndoArrival}
              cls={btnNeutral}
              onClick={() => run(() => api.reservations.unmarkArrived(res.id), T.guestDrawer.actionUndoArrival)}
              disabled={busy}
            />
          )}
          <ActionBtn label={T.guestDrawer.actionUnconfirm} cls={btnAmber} onClick={() => run(() => api.reservations.unconfirm(res.id), T.guestDrawer.toastUnconfirmed)} disabled={busy} />
        </div>
        {/* Destructive */}
        <div className="flex gap-1.5 mt-2.5 pt-2.5 border-t border-iron-border/30">
          <ActionBtn label={T.guestDrawer.actionNoShow} cls={btnAmber} onClick={() => run(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)} disabled={busy} />
          <ActionBtn label={T.guestDrawer.actionCancel} cls={btnRed}   onClick={() => setMode('cancel')} disabled={busy} />
        </div>
      </>
    );

    if (res.status === 'SEATED') return (
      <>
        {/* Primary */}
        <div className="flex gap-2">
          <ActionBtn label={T.guestDrawer.actionComplete} cls={btnGreen} onClick={() => run(() => api.reservations.complete(res.id), T.guestDrawer.toastCompleted)} disabled={busy} primary />
        </div>
        {/* Secondary */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ActionBtn
            label={T.guestDrawer.actionMoveTable}
            cls={btnNeutral}
            onClick={() => onPickTables ? openActionMapPicker('move') : setMode('move')}
            disabled={busy}
          />
          {unseatConfirm ? (
            <div className="flex flex-col gap-1.5 w-full">
              <span className="text-xs text-iron-muted">{T.guestDrawer.unseatConfirmText}</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => { setUnseatConfirm(false); run(() => api.reservations.unseat(res.id), T.guestDrawer.toastUnseated); }}
                  disabled={busy}
                  className="text-xs font-medium px-3 py-2 rounded-lg border border-iron-border/60 text-iron-text bg-iron-border/20 hover:bg-iron-border/35 transition-colors disabled:opacity-40 touch-manipulation"
                >
                  {T.guestDrawer.actionUnseat}
                </button>
                <button
                  onClick={() => setUnseatConfirm(false)}
                  disabled={busy}
                  className="text-xs text-iron-muted hover:text-iron-text transition-colors py-2 px-1 touch-manipulation"
                >
                  {T.guestDrawer.backLink}
                </button>
              </div>
            </div>
          ) : (
            <ActionBtn label={T.guestDrawer.actionUnseat} cls={btnNeutral} onClick={() => setUnseatConfirm(true)} disabled={busy} />
          )}
        </div>
        {/* Destructive */}
        <div className="flex gap-1.5 mt-2.5 pt-2.5 border-t border-iron-border/30">
          <ActionBtn label={T.guestDrawer.actionCancel} cls={btnRed} onClick={() => setMode('cancel')} disabled={busy} />
        </div>
      </>
    );

    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status)) return (
      <>
        <ActionBtn label={T.guestDrawer.actionUndo} cls={btnNeutral} onClick={() => run(() => api.reservations.undo(res.id), T.guestDrawer.toastUndone)} disabled={busy} />
      </>
    );

    return null;
  }

  return (
    <>
      {/* Backdrop — hidden during map pick so the floor is accessible */}
      {!(pickingOnMap || pickingForAction) && (
        <div
          className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in"
          onClick={onClose}
        />
      )}

      {/* Reorganize confirmation modal */}
      {reorganizeModal && (
        <ReorganizeConflictModal
          key={reorganizeModal._key}
          conflicts={reorganizeModal.conflicts}
          busy={busy}
          onCancel={() => setReorganizeModal(null)}
          onConfirm={async (selectedIds) => {
            const { pendingTableId, pendingCombinedIds, pendingToast } = reorganizeModal;
            setReorganizeModal(null);
            setError(null);
            setBusy(true);
            try {
              const updated = await api.reservations.seat(res.id, pendingTableId, true, pendingCombinedIds, selectedIds);
              setRes(updated); onUpdated(updated); setMode('view'); setUnseatConfirm(false);
              onSuccess?.(pendingToast);
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {/* Drawer panel — hidden during map pick so the FloorBoard action bar is fully accessible */}
      <aside className={`fixed right-0 top-0 h-full w-96 bg-iron-elevated border-l border-iron-border/50 z-50 flex flex-col animate-drawer-in${(pickingOnMap || pickingForAction) ? ' hidden' : ''}`} style={{ boxShadow: '-1px 0 0 rgba(255,255,255,0.06), -3px 0 0 rgba(0,0,0,0.14), -24px 0 64px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.04)' }}>

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-iron-border shrink-0" style={{ backgroundImage: 'linear-gradient(180deg, rgba(111,138,60,0.07) 0%, transparent 80%)', boxShadow: '0 1px 0 rgba(255,255,255,0.05), 0 4px 18px rgba(0,0,0,0.32)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pe-3">
              {/* Name + VIP + reservation time */}
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="text-iron-text font-bold text-2xl tracking-tight leading-tight truncate">{res.guestName}</h2>
                <span className="text-iron-green-light text-xl font-bold tabular-nums shrink-0">{normalizeTime(res.time)}</span>
                {res.guest?.isVip && (
                  <span className="text-amber-400 text-xs font-semibold bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 shrink-0">
                    {T.common.vip}
                  </span>
                )}
              </div>

              {/* Phone — prominent, clickable, copyable */}
              <div className="flex items-center gap-2 mt-1">
                {res.guestPhone ? (
                  <>
                    <a
                      href={`tel:${res.guestPhone}`}
                      className="text-[15px] font-mono font-semibold text-iron-text hover:text-iron-green-light transition-colors"
                      onClick={e => e.stopPropagation()}
                    >
                      {(() => {
                        const d = res.guestPhone!.replace(/\D/g, '');
                        if (d.length === 12 && d.startsWith('972')) return `+972 ${d.slice(3,5)} · ${d.slice(5,8)} · ${d.slice(8)}`;
                        if (d.length === 10 && d.startsWith('0'))   return `${d.slice(0,3)} · ${d.slice(3,6)} · ${d.slice(6)}`;
                        return res.guestPhone;
                      })()}
                    </a>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(res.guestPhone!);
                        setPhoneCopied(true);
                        setTimeout(() => setPhoneCopied(false), 1500);
                      }}
                      className={`text-xs transition-colors px-2 py-1 rounded touch-manipulation ${phoneCopied ? 'text-iron-green-light' : 'text-iron-muted hover:text-iron-text'}`}
                      title="Copy phone"
                    >
                      {phoneCopied ? 'Copied' : 'Copy'}
                    </button>
                  </>
                ) : (
                  <span className="text-iron-muted/70 text-xs font-medium">No phone</span>
                )}
              </div>

              {/* Status + badges */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[res.status]}`}>
                  {STATUS_LABEL[res.status]}
                </span>
                {res.returnedToListAt && (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-purple-500/10 border-purple-500/30 text-purple-400 font-medium">
                    {T.guestDrawer.returnedToList}
                  </span>
                )}
                {res.reorganizeAt && (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-500/10 border-amber-500/30 text-amber-400 font-medium">
                    {T.guestDrawer.reorganizeBadge}
                  </span>
                )}
                {res.isRunningLate && res.status !== 'SEATED' && (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-500/10 border-orange-500/30 text-orange-400 font-medium">
                    {T.guestDrawer.runningLate}
                  </span>
                )}
                {res.isConfirmedByGuest && (
                  <span className="text-[11px] px-1.5 py-px rounded border bg-iron-green/15 border-iron-green/30 text-iron-green-light font-medium">
                    {T.guestDrawer.guestConfirmed}
                  </span>
                )}
              </div>

              {/* Party + table — compact secondary line */}
              <div className="flex items-center gap-1.5 mt-1.5 text-iron-text/85 text-sm font-medium">
                <span>{T.common.guests(res.partySize)}</span>
                {res.table && (
                  <>
                    <span className="text-iron-muted/75">·</span>
                    <span>
                      {res.combinedTableIds.length
                        ? [res.table.name, ...res.combinedTableIds.map(id => tables.find(t => t.id === id)?.name ?? id)].join(' + ')
                        : res.table.name}
                    </span>
                  </>
                )}
                <span className="text-iron-muted/75">·</span>
                <span className="text-iron-muted/85">{formatReservationSource(res.source, locale)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {mode === 'view' && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status) && (
                <button
                  onClick={enterEdit}
                  className="text-xs font-medium px-3 py-1.5 rounded-md border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors touch-manipulation"
                >
                  {T.guestDrawer.editButton}
                </button>
              )}
              <button
                onClick={onClose}
                className="text-iron-muted hover:text-iron-text text-xl leading-none p-2 -m-2 rounded touch-manipulation"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">

          {/* Arrival state banner — contextual quick action surfaces the most urgent next step */}
          {(() => {
            if (!nowTime || !isLiveView) return null;
            const aState = arrivalState(res.time, res.status, nowTime);
            if (!aState) return null;
            const minsLate = Math.abs(minutesUntilRes(res.time, nowTime));
            const config = {
              ARRIVING_SOON: { cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400',    dot: 'bg-amber-400',  label: T.arrival.arrivingSoon },
              DUE_NOW:       { cls: 'bg-amber-500/20 border-amber-400/40 text-amber-300',    dot: 'bg-amber-300',  label: T.arrival.dueNow },
              LATE:          { cls: 'bg-orange-900/15 border-orange-500/30 text-orange-400', dot: 'bg-orange-500', label: T.arrival.lateMin(minsLate) },
              NO_SHOW_RISK:  { cls: 'bg-red-900/20 border-red-500/30 text-red-400',          dot: 'bg-red-500',    label: T.arrival.noShowRisk },
            }[aState];
            const canAct = ['PENDING', 'CONFIRMED'].includes(res.status) && !busy;
            return (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${config.cls}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
                <span className="text-xs font-semibold flex-1">{config.label}</span>
                {/* LATE: guest might have just walked in — surface Arrived one tap away */}
                {aState === 'LATE' && !res.isArrived && canAct && (
                  <button
                    onClick={() => run(() => api.reservations.markArrived(res.id), T.guestDrawer.toastArrived)}
                    disabled={busy}
                    className="text-xs font-medium text-orange-400/80 hover:text-orange-300 transition-colors shrink-0 disabled:opacity-40"
                  >
                    {T.guestDrawer.actionMarkArrived}
                  </button>
                )}
                {/* NO_SHOW_RISK: table is likely needed — surface the release action */}
                {aState === 'NO_SHOW_RISK' && canAct && (
                  <button
                    onClick={() => run(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)}
                    disabled={busy}
                    className="text-xs font-medium px-2 py-0.5 rounded border border-red-500/35 text-red-400 hover:bg-red-900/20 transition-colors shrink-0 disabled:opacity-40"
                  >
                    {T.guestDrawer.actionNoShow}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Operational context — host notes, guest notes, occasion */}
          {(res.hostNotes || res.guestNotes || res.occasion) && (
            <section className="space-y-2">
              {res.hostNotes && (
                <div className="px-3 py-2.5 rounded-lg bg-amber-900/8 border border-amber-500/20" style={{ borderLeftWidth: '2px', borderLeftColor: 'rgba(217,119,6,0.72)' }}>
                  <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider mb-0.5">Host note</p>
                  <p className="text-amber-100/85 text-[13px] leading-relaxed">{res.hostNotes}</p>
                </div>
              )}
              {res.guestNotes && (
                <div className="px-3 py-2.5 rounded-lg bg-iron-card/70 border border-iron-border/70">
                  <p className="text-[10px] text-iron-muted/70 font-semibold uppercase tracking-wider mb-0.5">Guest note</p>
                  <p className="text-iron-text/90 text-[13px]">{res.guestNotes}</p>
                </div>
              )}
              {res.occasion && (
                <div className="px-3 py-2 rounded-lg bg-iron-green/10 border border-iron-green/25">
                  <p className="text-iron-green-light text-xs font-semibold">{res.occasion}</p>
                </div>
              )}
            </section>
          )}

          {/* Smart table suggestion */}
          {mode === 'view' && ['PENDING', 'CONFIRMED'].includes(res.status) && (smartLoading || smartSuggestion) && (
            <section className={`rounded-xl border p-3.5 space-y-3 ${
              smartSuggestion?.mode === 'upgrade'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-iron-green/30 bg-iron-green/5'
            }`}>
              <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider">
                {smartSuggestion?.mode === 'upgrade'
                  ? T.guestDrawer.sectionSmartUpgrade
                  : T.guestDrawer.sectionSmartSuggest}
              </p>

              {smartLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                  <span className="text-iron-muted text-xs">{T.common.processing}</span>
                </div>
              ) : smartSuggestion?.mode === 'assign' ? (
                <>
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-iron-text font-bold text-base leading-tight">{smartSuggestion.suggestion.tableName}</span>
                    <span className="text-iron-muted text-xs">
                      {T.guestDrawer.suggestCapacity(smartSuggestion.suggestion.minCovers, smartSuggestion.suggestion.maxCovers)}
                    </span>
                  </div>

                  <SuggestionChips s={smartSuggestion.suggestion} T={T} />

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => seatWithReorganizeCheck(smartSuggestion.suggestion.tableId!, [], T.guestDrawer.toastSeated(res.guestName, smartSuggestion.suggestion.tableName))}
                      disabled={busy}
                      className="flex-1 text-xs font-semibold py-2 rounded-lg bg-iron-green/25 border border-iron-green/50 text-iron-green-light hover:bg-iron-green/35 transition-colors disabled:opacity-40 active:scale-[0.97]"
                    >
                      {T.guestDrawer.suggestSeatNow}
                    </button>
                    <button
                      onClick={() => setMode('seat')}
                      disabled={busy}
                      className="text-xs text-iron-muted hover:text-iron-text transition-colors shrink-0"
                    >
                      {T.guestDrawer.suggestChooseOther}
                    </button>
                  </div>
                </>
              ) : smartSuggestion?.mode === 'upgrade' ? (
                <>
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <span className="text-iron-muted shrink-0">{T.guestDrawer.suggestCurrentLabel}:</span>
                    <span className="text-iron-text font-semibold">{smartSuggestion.current?.tableName ?? res.table?.name ?? '—'}</span>
                    <span className="text-iron-muted">→</span>
                    <span className="text-iron-muted shrink-0">{T.guestDrawer.suggestBetterLabel}:</span>
                    <span className="text-amber-300 font-semibold">{smartSuggestion.suggestion.tableName}</span>
                    <span className="text-iron-muted">
                      {T.guestDrawer.suggestCapacity(smartSuggestion.suggestion.minCovers, smartSuggestion.suggestion.maxCovers)}
                    </span>
                  </div>

                  <SuggestionChips s={smartSuggestion.suggestion} T={T} />

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => run(
                        () => api.reservations.update(res.id, { tableId: smartSuggestion.suggestion.tableId! }),
                        T.guestDrawer.toastTableReassigned(smartSuggestion.suggestion.tableName),
                      )}
                      disabled={busy}
                      className="flex-1 text-xs font-semibold py-2 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40 active:scale-[0.97]"
                    >
                      {T.guestDrawer.suggestSwapTable}
                    </button>
                    <button
                      onClick={() => setSmartSuggestion(null)}
                      disabled={busy}
                      className="text-xs text-iron-muted hover:text-iron-text transition-colors shrink-0"
                    >
                      {T.guestDrawer.suggestKeepCurrent}
                    </button>
                  </div>
                </>
              ) : null}
            </section>
          )}

          {/* Reservation details — visual timing grid */}
          <section className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center px-2 py-3 rounded-xl bg-iron-bg border border-iron-border/60" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                <p className="text-iron-green-light font-bold text-xl tabular-nums leading-none">{normalizeTime(res.time)}</p>
                <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-wider mt-1.5">{T.guestDrawer.rowTime}</p>
              </div>
              <div className="flex flex-col items-center px-2 py-3 rounded-xl bg-iron-bg border border-iron-border/60" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                <p className="text-iron-text font-bold text-sm tabular-nums leading-none">{res.date.slice(0, 10)}</p>
                <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-wider mt-1.5">{T.guestDrawer.rowDate}</p>
              </div>
              <div className="flex flex-col items-center px-2 py-3 rounded-xl bg-iron-bg border border-iron-border/60" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                <p className="text-iron-text font-bold text-xl tabular-nums leading-none">{res.duration}<span className="text-sm font-medium text-iron-muted">m</span></p>
                <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-wider mt-1.5">{T.guestDrawer.rowDuration}</p>
              </div>
            </div>

            {res.status === 'SEATED' && res.seatedAt && (
              <Ts label={T.guestDrawer.rowSeatedAt} ts={res.seatedAt} />
            )}

            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-iron-bg border border-iron-border/60" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
              <span className="text-iron-muted text-xs font-semibold uppercase tracking-wider">{T.guestDrawer.rowTable}</span>
              <span className="text-iron-text text-sm font-semibold">
                {(() => {
                  if (!res.table) return res.tableId ? '…' : T.guestDrawer.tableUnassigned;
                  if (!res.combinedTableIds.length) return res.table.name;
                  const secondaryNames = res.combinedTableIds.map(id => tables.find(t => t.id === id)?.name ?? id);
                  return [res.table.name, ...secondaryNames].join(' + ');
                })()}
              </span>
            </div>
          </section>

          {/* Other reservations at the same table */}
          {(() => {
            if (!res.tableId || !allReservations) return null;
            const others = allReservations
              .filter(r =>
                r.tableId === res.tableId &&
                r.id !== res.id &&
                !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(r.status)
              )
              .sort((a, b) => a.time.localeCompare(b.time));
            if (others.length === 0) return null;
            return (
              <section className="border-t border-iron-border pt-4 space-y-1.5">
                <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider mb-2">
                  {T.guestDrawer.sectionTableUpcoming(res.table?.name ?? '')}
                </p>
                {others.map(r => (
                  <div key={r.id} className="flex items-center gap-2 py-0.5">
                    <span className="text-iron-text text-xs font-bold tabular-nums w-10 shrink-0">{normalizeTime(r.time)}</span>
                    <span className="text-iron-muted/50 text-xs">·</span>
                    <span className="text-iron-text text-xs font-medium truncate flex-1">{r.guestName}</span>
                    <span className="text-iron-muted text-[11px] font-medium shrink-0">{T.common.guests(r.partySize)}</span>
                    <span className={`text-[10px] px-1.5 py-px rounded font-medium shrink-0 ${
                      r.status === 'CONFIRMED' ? 'bg-iron-border/15 text-iron-muted' :
                      r.status === 'SEATED'    ? 'bg-iron-green/20 text-iron-green-light' :
                                                 'bg-iron-border/20 text-iron-muted'
                    }`}>
                      {r.status === 'CONFIRMED' ? T.reservationStatus.CONFIRMED :
                       r.status === 'SEATED'    ? T.reservationStatus.SEATED :
                                                  T.reservationStatus.PENDING}
                    </span>
                  </div>
                ))}
              </section>
            );
          })()}

          {/* Guest CRM */}
          {res.guest && (
            <section className="border-t border-iron-border pt-4 space-y-2">
              <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider mb-2">
                {T.guestDrawer.sectionGuestProfile}
              </p>
              <Row label={T.guestDrawer.rowName}     value={`${res.guest.firstName} ${res.guest.lastName}`} />
              {res.guest.visitCount != null && (
                <Row label={T.guestDrawer.rowVisits}   value={String(res.guest.visitCount)} />
              )}
              {res.guest.noShowCount != null && res.guest.noShowCount > 0 && (
                <Row label={T.guestDrawer.rowNoShows} value={String(res.guest.noShowCount)} warn />
              )}
              {res.guest.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {res.guest.tags.map(tag => (
                    <span
                      key={tag}
                      className="text-[11px] px-1.5 py-0.5 bg-iron-bg border border-iron-border rounded-md text-iron-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Confirmation — hidden once guest is physically present or turn is closed */}
          {!['SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status) && <ConfirmationSection />}

          {/* Actions */}
          <section ref={actionsRef} className="border-t border-iron-border pt-4">
            <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider mb-3">
              {T.guestDrawer.sectionActions}
            </p>

            {mode === 'view' && (
              pickingForAction ? (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-900/20 border border-blue-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  <span className="text-blue-300 text-xs flex-1">{T.guestDrawer.pickingOnMap}</span>
                  <button
                    type="button"
                    onClick={() => { setPickingForAction(null); onPickTablesCancel?.(); }}
                    className="text-xs text-iron-muted hover:text-iron-text transition-colors shrink-0"
                  >
                    {T.common.cancel}
                  </button>
                </div>
              ) : (
                <div>
                  <Actions />
                </div>
              )
            )}

            {mode === 'edit' && (
              <div className="space-y-3">
                <Field label={T.guestDrawer.fieldGuestName}>
                  <input
                    className={inputCls}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder={T.guestDrawer.placeholderName}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldPhone}>
                  <input
                    className={inputCls}
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    placeholder={T.guestDrawer.placeholderPhone}
                  />
                </Field>

                <Field label={T.guestDrawer.fieldPartySize}>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    max={30}
                    value={editParty}
                    onChange={e => setEditParty(e.target.value)}
                  />
                </Field>

                {/* Capacity advisory warning — shown for all statuses when a table is assigned */}
                {(() => {
                  const allIds = [editTableId, ...editCombinedTableIds].filter(Boolean) as string[];
                  if (allIds.length === 0) return null;
                  const party = parseInt(editParty, 10);
                  if (isNaN(party) || party < 1) return null;
                  const totalMax = allIds.reduce((sum, id) => {
                    const t = tables.find(t => t.id === id);
                    return sum + (t?.maxCovers ?? 0);
                  }, 0);
                  if (totalMax >= party) return null;
                  return (
                    <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-amber-900/10 border border-amber-500/25">
                      <span className="text-amber-400 shrink-0">⚠</span>
                      <p className="text-amber-400 text-xs">{T.guestDrawer.tableCapacityWarn(totalMax, party)}</p>
                    </div>
                  );
                })()}

                {/* Date / time / table — locked while seated */}
                {res.status === 'SEATED' ? (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    {T.guestDrawer.seatedEditNote}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={T.guestDrawer.fieldDate}>
                        <input
                          className={inputCls}
                          type="date"
                          value={editDate}
                          onChange={e => {
                            const d = e.target.value;
                            setEditDate(d);
                            onDateTimeChange?.(d, editTime);
                          }}
                        />
                      </Field>
                      <Field label={T.guestDrawer.fieldTime}>
                        <input
                          className={inputCls}
                          type="time"
                          value={editTime}
                          onChange={e => {
                            const t = e.target.value;
                            setEditTime(t);
                            onDateTimeChange?.(editDate, t);
                          }}
                        />
                      </Field>
                    </div>

                    {/* Table reassignment */}
                    <Field label={T.guestDrawer.fieldTable}>
                      <div className="space-y-2">

                        {/* Picking on map banner */}
                        {pickingOnMap && (
                          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-900/20 border border-blue-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                            <span className="text-blue-300 text-xs flex-1">{T.guestDrawer.pickingOnMap}</span>
                            <button
                              type="button"
                              onClick={() => { setPickingOnMap(false); onPickTablesCancel?.(); }}
                              className="text-xs text-iron-muted hover:text-iron-text transition-colors shrink-0"
                            >
                              {T.common.cancel}
                            </button>
                          </div>
                        )}

                        {/* Current assignment row */}
                        {!pickingOnMap && (
                          <div className="flex items-center gap-2">
                            {editTableId ? (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/35 text-iron-green-light flex-1 truncate">
                                {[editTableId, ...editCombinedTableIds]
                                  .map(id => tables.find(t => t.id === id)?.name ?? id)
                                  .join(' + ')}
                              </span>
                            ) : (
                              <span className="text-xs text-iron-muted italic flex-1">
                                {T.guestDrawer.tableUnassigned}
                              </span>
                            )}
                            {editTableId && !showTablePicker && (
                              <button
                                type="button"
                                onClick={() => { setEditTableId(null); setEditCombinedTableIds([]); }}
                                className="text-xs text-iron-muted hover:text-red-400 border border-iron-border/50 hover:border-red-900/40 px-2 py-1 rounded-md transition-colors shrink-0"
                              >
                                {T.guestDrawer.clearTable}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const next = !showTablePicker;
                                setShowTablePicker(next);
                                if (next) fetchTableSuggestions();
                              }}
                              className={`text-xs font-semibold px-3 py-1 rounded-md border transition-colors shrink-0 ${
                                showTablePicker
                                  ? 'text-iron-muted border-iron-border/50 hover:text-iron-text'
                                  : 'bg-iron-green/20 border-iron-green/40 text-iron-green-light hover:bg-iron-green/30'
                              }`}
                            >
                              {showTablePicker ? T.guestDrawer.backLink : T.guestDrawer.changeTable}
                            </button>
                            {onPickTables && !showTablePicker && (
                              <button
                                type="button"
                                onClick={openMapPicker}
                                className="text-xs px-2.5 py-1 rounded-md border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors shrink-0"
                              >
                                {T.guestDrawer.selectOnMap}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Inline picker */}
                        {showTablePicker && (
                          <SmartTablePicker
                            tables={tables}
                            suggestions={tableSuggestions}
                            suggestBusy={suggestBusy}
                            selectedId={editTableId}
                            onPick={id => { setEditTableId(id); setEditCombinedTableIds([]); setShowTablePicker(false); }}
                          />
                        )}
                      </div>
                    </Field>

                    {editTableId && editTableId === res.tableId && (editDate !== res.date.slice(0, 10) || editTime !== res.time || editParty !== String(res.partySize)) && (
                      <p className="text-xs text-iron-muted bg-iron-bg border border-iron-border rounded-lg px-3 py-2">
                        {T.guestDrawer.tableConflictNote}
                      </p>
                    )}
                  </>
                )}

                <Field label={T.guestDrawer.fieldDuration}>
                  {/* Quick adjust */}
                  <div className="flex gap-1.5 mb-2">
                    {([-15, +15, +30] as const).map(delta => (
                      <button
                        key={delta}
                        type="button"
                        disabled={busy}
                        onClick={() => adjustDuration(delta)}
                        className={`flex-1 text-xs py-1.5 rounded-md border transition-colors disabled:opacity-40 ${
                          delta < 0
                            ? 'border-red-900/30 text-red-400 hover:bg-red-900/15 active:bg-red-900/25'
                            : 'border-iron-green/30 text-iron-green-light hover:bg-iron-green/10 active:bg-iron-green/20'
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta}m
                      </button>
                    ))}
                  </div>

                  {/* Current duration + delta */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-iron-bg border border-iron-border mb-1.5">
                    <span className="text-iron-text text-sm font-semibold tabular-nums">
                      {editDuration} min
                    </span>
                    {editDuration !== originalDuration && (
                      <div className="flex items-center gap-2">
                        <span className="text-iron-muted text-[11px]">{T.guestDrawer.wasNMin(originalDuration)}</span>
                        <span className={`text-xs font-semibold ${
                          editDuration > originalDuration ? 'text-iron-green-light' : 'text-red-400'
                        }`}>
                          {editDuration > originalDuration
                            ? `+${editDuration - originalDuration}m`
                            : `${editDuration - originalDuration}m`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Manual fallback */}
                  <input
                    className={inputCls}
                    type="number"
                    min={30}
                    max={480}
                    step={15}
                    value={editDuration}
                    onChange={e => {
                      const v = e.target.valueAsNumber;
                      if (!isNaN(v) && v > 0) setEditDuration(Math.min(480, Math.max(30, v)));
                    }}
                    placeholder={T.guestDrawer.placeholderMinutes}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldGuestNotes}>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={2}
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder={T.guestDrawer.placeholderNotes}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldHostNotes}>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={2}
                    value={editHostNotes}
                    onChange={e => setEditHostNotes(e.target.value)}
                    placeholder={T.guestDrawer.placeholderHostNotes}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldOccasion}>
                  <input
                    type="text"
                    className={inputCls}
                    value={editOccasion}
                    onChange={e => setEditOccasion(e.target.value)}
                    placeholder={T.guestDrawer.placeholderOccasion}
                  />
                </Field>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveEdit}
                    disabled={busy}
                    className="flex-1 text-sm font-semibold py-2.5 rounded-xl bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors disabled:opacity-40 active:scale-[0.97]"
                    style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.06)' }}
                  >
                    {T.guestDrawer.saveChanges}
                  </button>
                  <button
                    onClick={() => setMode('view')}
                    disabled={busy}
                    className="text-iron-muted text-xs hover:text-iron-text px-3 transition-colors"
                  >
                    {T.common.cancel}
                  </button>
                </div>
              </div>
            )}

            {mode === 'seat' && (
              <TablePicker
                tables={tables}
                excludeId={null}
                label={T.guestDrawer.seatPickerLabel}
                busy={busy}
                onPick={tableId => seatWithReorganizeCheck(tableId, [], T.guestDrawer.toastSeated(res.guestName, tableName(tableId)))}
                onBack={() => setMode('view')}
              />
            )}

            {mode === 'move' && (
              <TablePicker
                tables={tables}
                excludeId={res.tableId}
                label={T.guestDrawer.movePickerLabel}
                busy={busy}
                onPick={tableId => run(() => api.reservations.move(res.id, tableId, undefined, []), T.guestDrawer.toastMoved(tableName(tableId)))}
                onBack={() => setMode('view')}
              />
            )}

            {mode === 'change-table' && (
              <TablePicker
                tables={tables}
                excludeId={res.tableId}
                label={T.guestDrawer.changeTablePickerLabel}
                busy={busy}
                onPick={tableId => run(() => api.reservations.update(res.id, { tableId, combinedTableIds: [] }), T.guestDrawer.toastTableAssigned(tableName(tableId)))}
                onBack={() => setMode('view')}
              />
            )}

            {mode === 'cancel' && (
              <div className="space-y-2">
                <p className="text-iron-muted text-xs">{T.guestDrawer.cancelReasonLabel}</p>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder={T.guestDrawer.cancelReasonPh}
                  className="w-full bg-iron-bg border border-iron-border rounded-lg px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-red-500 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => run(() => api.reservations.cancel(res.id, cancelReason || undefined))}
                    disabled={busy}
                    className="flex-1 text-xs py-1.5 rounded-lg bg-red-900/20 border border-red-900/30 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40"
                  >
                    {T.guestDrawer.confirmCancel}
                  </button>
                  <button
                    onClick={() => setMode('view')}
                    className="text-iron-muted text-xs hover:text-iron-text px-3 transition-colors"
                  >
                    {T.guestDrawer.backButton}
                  </button>
                </div>
              </div>
            )}

            {/* Feedback */}
            {error && (
              <p className="mt-3 text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {busy && (
              <div className="mt-3 flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                <span className="text-iron-muted text-xs">{T.common.processing}</span>
              </div>
            )}
          </section>

          {/* Table lock */}
          {assignedTable && mode !== 'lock' && (
            <section className="border-t border-iron-border pt-4">
              <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider mb-3">{T.guestDrawer.sectionTableLock}</p>
              {tableIsLocked ? (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400">
                      {T.tableCard.locked}{assignedTable.lockReason ? ` · ${assignedTable.lockReason}` : ''}
                    </span>
                  </div>
                  <ActionBtn label={T.guestDrawer.unlockButton} cls={btnNeutral} onClick={handleUnlockTable} disabled={busy} />
                </div>
              ) : (
                <ActionBtn label={T.guestDrawer.lockTableButton} cls={btnAmber} onClick={() => { setMode('lock'); setLockReason(''); }} disabled={busy} />
              )}
            </section>
          )}

          {mode === 'lock' && assignedTable && (
            <section className="border-t border-iron-border pt-4 space-y-3">
              <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider">{T.lockModal.title(assignedTable.name)}</p>
              <div className="flex flex-wrap gap-1.5">
                {LOCK_QUICK_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setLockReason(prev => prev === r ? '' : r)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      lockReason === r
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                        : 'border-iron-border text-iron-muted hover:text-iron-text'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={lockReason}
                onChange={e => setLockReason(e.target.value)}
                placeholder={T.guestDrawer.lockReasonPh}
                className={inputCls}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleLockTable}
                  disabled={busy}
                  className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40"
                >
                  {busy ? T.guestDrawer.lockTableBusy : T.guestDrawer.lockTableConfirm}
                </button>
                <button onClick={() => setMode('view')} className="text-iron-muted text-xs hover:text-iron-text px-3">{T.common.cancel}</button>
              </div>
            </section>
          )}

          {/* Lifecycle timestamps */}
          <section className="border-t border-iron-border pt-4 space-y-2">
            <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider mb-2">
              {T.guestDrawer.sectionTimeline}
            </p>
            {!res.confirmedAt && !res.seatedAt && !res.completedAt && !res.cancelledAt && !res.noShowAt && (
              <p className="text-iron-muted text-xs italic">{T.guestDrawer.timelineEmpty}</p>
            )}
            {res.confirmedAt && <Ts label={T.guestDrawer.tsConfirmed}  ts={res.confirmedAt} />}
            {res.seatedAt    && <Ts label={T.guestDrawer.tsSeated}     ts={res.seatedAt} />}
            {res.completedAt && <Ts label={T.guestDrawer.tsCompleted}  ts={res.completedAt} />}
            {res.cancelledAt && <Ts label={T.guestDrawer.tsCancelled}  ts={res.cancelledAt} />}
            {res.noShowAt    && <Ts label={T.guestDrawer.tsNoShow}     ts={res.noShowAt} />}

            {/* Host attribution */}
            {(res.createdByName || res.updatedByName || res.seatedByName || res.cancelledByName || res.movedByName) && (
              <div className="mt-3 pt-3 border-t border-iron-border/50 space-y-1.5">
                {res.createdByName  && <Row label={T.guestDrawer.attrCreatedBy}   value={res.createdByName} />}
                {res.seatedByName   && <Row label={T.guestDrawer.attrSeatedBy}    value={res.seatedByName} />}
                {res.movedByName    && <Row label={T.guestDrawer.attrMovedBy}     value={res.movedByName} />}
                {res.cancelledByName && <Row label={T.guestDrawer.attrCancelledBy} value={res.cancelledByName} />}
                {res.updatedByName  && <Row label={T.guestDrawer.attrUpdatedBy}   value={res.updatedByName} />}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
