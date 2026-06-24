import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useIsDesktop } from '../hooks/useIsDesktop';
import type { BackendTableSuggestion, BestTableResult, FloorObjectData, GuestLookupResult, Reservation, Table } from '../types';
import { api, ApiError } from '../api';
import ReorganizeConflictModal, { type ReorganizeConflict } from './ReorganizeConflictModal';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import FloorTablePicker from './FloorTablePicker';
import { getDefaultDuration } from '../utils/duration';
import { isCrmImportWithNoHistory, CRM_NO_HISTORY_LABEL } from '../utils/displayHelpers';
import MiniCalendar from './MiniCalendar';

type Mode = 'reservation' | 'walkin';

interface GapHint {
  tableId: string;
  tableName: string;
  startTime: string;
  endTime: string;
  durationMins: number;
  minCovers: number;
  maxCovers: number;
}

interface Props {
  initialMode: Mode;
  defaultDate: string;
  defaultTime: string;
  tables: Table[];
  preselectedTableId?: string;
  preselectedCombinedTableIds?: string[];
  floorObjs?: FloorObjectData[];
  initialData?: { guestName?: string; partySize?: number; guestPhone?: string };
  gapHint?: GapHint;
  defaultTurnMinutes?: number;
  /** When set, the drawer is in standby-edit mode: pre-fills from this reservation and PATCHes on save */
  standbyReservation?: Reservation;
  onClose: () => void;
  onCreated: (r: Reservation) => void;
  /** Called after a successful standby update (only when standbyReservation is set) */
  onUpdated?: (r: Reservation) => void;
  onPickTables?: (currentIds: string[], suggestions: BackendTableSuggestion[], callback: (ids: string[] | null) => void, action?: 'seat' | 'move' | 'change-table', guestName?: string, walkIn?: boolean, time?: string) => void;
  onPickTablesCancel?: () => void;
  onUpdatePickSuggestions?: (suggestions: BackendTableSuggestion[]) => void;
  /** True when HostDashboard's tablePickMode is active — suppresses backdrop so the floor is clickable. */
  mapPickActive?: boolean;
  /** New-reservation always-armed map mode: map visible at all times, no backdrop. */
  newResPickMode?: boolean;
  /** Table IDs currently toggle-selected on the map by the host. */
  externalResTableIds?: string[];
  /** Called when the table selection changes from within the drawer so HostDashboard can sync. */
  onResTableChange?: (ids: string[]) => void;
  /** Called whenever the reservation date or time changes so the parent can keep
   *  the floor board in sync with the drawer. */
  onDateTimeChange?: (date: string, time: string) => void;
  /** Called when the host wants to add the current guest to the waitlist instead. */
  onAddToWaitlist?: (data: { guestName: string; partySize: number; guestPhone?: string; date: string; time?: string }) => void;
}

// ─── Shared field components ──────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-1">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors ${props.className ?? ''}`}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors resize-none ${props.className ?? ''}`}
    />
  );
}

// ─── Time slot constants ──────────────────────────────────────────────────────

const TIME_SLOTS: string[] = Array.from({ length: 28 }, (_, i) => {
  const h = Math.floor(i / 2) + 10;
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

function snapToSlot(time: string): string {
  if (TIME_SLOTS.includes(time)) return time;
  const [hStr, mStr] = time.split(':');
  const total = parseInt(hStr, 10) * 60 + parseInt(mStr ?? '0', 10);
  return TIME_SLOTS.reduce((best, slot) => {
    const [sh, sm] = slot.split(':');
    const slotTotal = parseInt(sh, 10) * 60 + parseInt(sm, 10);
    const [bh, bm] = best.split(':');
    const bestTotal = parseInt(bh, 10) * 60 + parseInt(bm, 10);
    return Math.abs(total - slotTotal) < Math.abs(total - bestTotal) ? slot : best;
  }, TIME_SLOTS[0]);
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export default function CreateDrawer({
  initialMode, defaultDate, defaultTime, tables,
  preselectedTableId, preselectedCombinedTableIds, floorObjs,
  initialData, gapHint, standbyReservation, onClose, onCreated, onUpdated,
  onPickTables, onPickTablesCancel, onUpdatePickSuggestions,
  mapPickActive,
  newResPickMode = false,
  externalResTableIds,
  onResTableChange,
  onDateTimeChange,
  onAddToWaitlist,
}: Props) {
  const isEditingStandby = !!standbyReservation;
  const T = useT();
  const { locale, intlLocale } = useLocale();
  const isDesktop = useIsDesktop();
  const [mode, setMode] = useState<Mode>(gapHint ? 'reservation' : initialMode);

  // Reservation fields — seeded from standbyReservation when in edit-standby mode
  const sb = standbyReservation;
  const [resName,      setResName]      = useState(sb?.guestName ?? '');
  const [resPhone,     setResPhone]     = useState(sb?.guestPhone ?? initialData?.guestPhone ?? '');
  const [resParty,     setResParty]     = useState(sb?.partySize ?? 2);
  const [resDate,      setResDate]      = useState(sb ? sb.date.slice(0, 10) : defaultDate);
  const [resTime,      setResTime]      = useState(sb ? sb.time.slice(0, 5) : snapToSlot(gapHint?.startTime ?? defaultTime));
  const [resDuration,  setResDuration]  = useState(
    sb ? String(sb.duration) : gapHint ? String(gapHint.durationMins) : String(getDefaultDuration(2))
  );
  // durationManual: host has explicitly chosen a duration → suppress auto-defaults.
  // Starts true when a gap hint pre-fills the slot duration; false otherwise so
  // party-size changes continue to update the default automatically.
  const [durationManual, setDurationManual] = useState(!!(gapHint || sb));
  const [resGuestNote, setResGuestNote] = useState(sb?.guestNotes ?? '');
  const [resHostNote,  setResHostNote]  = useState(sb?.hostNotes ?? '');
  const [resSource,    setResSource]    = useState<'PHONE' | 'INTERNAL'>('PHONE');
  const [resTable,     setResTable]     = useState(gapHint?.tableId ?? preselectedTableId ?? '');
  const [isStandby,    setIsStandby]    = useState(false);

  // Walk-in fields
  const [wiName,          setWiName]          = useState(initialData?.guestName  ?? '');
  const [wiPhone,         setWiPhone]         = useState(initialData?.guestPhone ?? '');
  const [wiParty,         setWiParty]         = useState(initialData?.partySize  ?? 2);
  const [wiDuration,      setWiDuration]      = useState(String(getDefaultDuration(initialData?.partySize ?? 2)));
  const [wiDurationManual, setWiDurationManual] = useState(false);
  const [wiNotes,         setWiNotes]         = useState('');
  const [wiTable,            setWiTable]            = useState(preselectedTableId ?? '');
  const [wiCombinedTableIds, setWiCombinedTableIds] = useState<string[]>([]);
  const [wiAutoResult,       setWiAutoResult]       = useState<BestTableResult | null>(null);
  const [wiSuggestions,      setWiSuggestions]      = useState<BackendTableSuggestion[]>([]);
  const [wiSuggestBusy,      setWiSuggestBusy]      = useState(false);
  const [wiShowPicker,       setWiShowPicker]       = useState(false);
  const [wiPickingOnMap,     setWiPickingOnMap]     = useState(false);
  const wiManualOverrideRef = useRef(!!preselectedTableId);
  const [wiManualOverride, _setWiManualOverride] = useState(!!preselectedTableId);
  function setWiManualOverride(v: boolean) {
    wiManualOverrideRef.current = v;
    _setWiManualOverride(v);
  }
  const [wiGuestHint,        setWiGuestHint]        = useState<GuestLookupResult | null>(null);
  const [wiHintDismissed,    setWiHintDismissed]    = useState(false);

  // Guest CRM hints
  const [guestHint,      setGuestHint]      = useState<GuestLookupResult | null>(null);
  const [hintDismissed,  setHintDismissed]  = useState(false);

  // Table suggestions (for SmartTablePicker override grid)
  const [resSuggestions, setResSuggestions] = useState<BackendTableSuggestion[]>([]);
  const [suggestBusy,    setSuggestBusy]    = useState(false);

  // ── Auto-allocation state ────────────────────────────────────────────────────
  // autoResult: system's best table or combination from /tables/best
  // resCombinedTableIds: secondary tables when autoResult.type === 'combined'
  // manualOverride: host explicitly chose a different table → don't auto-update
  // showPicker: full SmartTablePicker grid is visible (override mode)
  //
  // If the drawer opened with a pre-selected table (floor click or gap hint),
  // treat it as a manual selection from the start.
  const hasPreselection = !!(gapHint?.tableId || preselectedTableId || (preselectedCombinedTableIds?.length ?? 0) > 0);
  const [autoResult,          setAutoResult]          = useState<BestTableResult | null>(null);
  const [resCombinedTableIds, setResCombinedTableIds] = useState<string[]>(preselectedCombinedTableIds ?? []);
  const [showPicker,          setShowPicker]          = useState(false);
  const [pickingOnMap,        setPickingOnMap]        = useState(false);
  // Ref keeps manualOverride readable inside async effects without stale closures
  const manualOverrideRef = useRef(hasPreselection);
  const [manualOverride, _setManualOverride] = useState(hasPreselection);
  function setManualOverride(v: boolean) {
    manualOverrideRef.current = v;
    _setManualOverride(v);
  }

  const [error,        setError]        = useState<string | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [wiConflictWarning, setWiConflictWarning] = useState<{
    unseatedReservation: Reservation;
    reservationId: string;
    tableId: string;
    combinedTableIds: string[];
    conflictTime: string;
    tableName: string;
  } | null>(null);
  const [resConflictWarning, setResConflictWarning] = useState<{
    conflicts: ReorganizeConflict[];
    tableId: string;
    combinedTableIds: string[];
    busy: boolean;
  } | null>(null);
  const [seatAnywayBusy, setSeatAnywayBusy] = useState(false);
  const [phoneWarning, setPhoneWarning] = useState(false);
  const [pendingSeat,  setPendingSeat]  = useState(false);
  const [pendingResConfirm, setPendingResConfirm] = useState(false);
  const submitInFlightRef = useRef(false);

  // Refs for unmount cleanup — stale closures can't read state reliably
  const pickingOnMapRef   = useRef(false);
  const wiPickingOnMapRef = useRef(false);
  const cancelPickRef     = useRef(onPickTablesCancel);
  useEffect(() => { pickingOnMapRef.current   = pickingOnMap;        }, [pickingOnMap]);
  useEffect(() => { wiPickingOnMapRef.current = wiPickingOnMap;      }, [wiPickingOnMap]);
  useEffect(() => { cancelPickRef.current     = onPickTablesCancel;  }, [onPickTablesCancel]);

  // On unmount: if the user closed the drawer while the map was armed, cancel pick mode
  useEffect(() => {
    return () => {
      if (pickingOnMapRef.current || wiPickingOnMapRef.current) {
        cancelPickRef.current?.();
      }
    };
  }, []);

  // Debounced guest lookup by phone
  useEffect(() => {
    if (!resPhone.trim()) { setGuestHint(null); setHintDismissed(false); return; }
    const t = setTimeout(async () => {
      try {
        const { guest } = await api.guests.lookupByPhone(resPhone);
        setGuestHint(guest);
        setHintDismissed(false);
        if (guest) setResName(prev => prev === '' ? `${guest.firstName} ${guest.lastName}`.trim() : prev);
      } catch { /* non-fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [resPhone]);

  // Walk-in mode: debounced guest lookup by phone — same logic as reservation mode
  useEffect(() => {
    if (!wiPhone.trim()) { setWiGuestHint(null); setWiHintDismissed(false); return; }
    const t = setTimeout(async () => {
      try {
        const { guest } = await api.guests.lookupByPhone(wiPhone);
        setWiGuestHint(guest);
        setWiHintDismissed(false);
        if (guest) setWiName(prev => prev === '' ? `${guest.firstName} ${guest.lastName}`.trim() : prev);
      } catch { /* non-fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [wiPhone]);

  // Sync board date/time with the form's date/time so the floor board shows
  // live status for the reservation slot being created, not the previous board time.
  const onDateTimeChangeRef = useRef(onDateTimeChange);
  useEffect(() => { onDateTimeChangeRef.current = onDateTimeChange; }, [onDateTimeChange]);
  useEffect(() => {
    onDateTimeChangeRef.current?.(resDate, resTime);
  }, [resDate, resTime]);

  // In newResPickMode: clear the selected table whenever booking params change
  // so the user must re-select after changing time/date/duration/party size.
  // Skip the initial mount render to preserve tables pre-selected at open time.
  const newResParamMountedRef = useRef(false);
  const onResTableChangeRef = useRef(onResTableChange);
  useEffect(() => { onResTableChangeRef.current = onResTableChange; }, [onResTableChange]);
  useEffect(() => {
    if (!newResParamMountedRef.current) { newResParamMountedRef.current = true; return; }
    if (!newResPickMode) return;
    setResTable('');
    setResCombinedTableIds([]);
    setManualOverride(false);
    onResTableChangeRef.current?.([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resDate, resTime, resDuration, resParty]);

  // Generation counter: incremented each time suggestion params change.
  // Async callbacks check the counter so stale API responses are discarded
  // (prevents a slow 14:00 response from overwriting a fast 16:00 response).
  const suggestGenRef = useRef(0);

  // ── Auto-allocation + suggestion fetch ───────────────────────────────────────
  // Fires when booking params change. Fetches suggestions + best result in parallel.
  // When params change (new date/time/party), clears the override so the system
  // re-evaluates — except when a table was explicitly pre-selected on open.
  useEffect(() => {
    if (mode !== 'reservation' || !resDate || !resTime || resParty < 1) return;

    const gen = ++suggestGenRef.current;

    // Reset override only when params change post-open (not for pre-selections)
    if (!hasPreselection) {
      setManualOverride(false);
      setShowPicker(false);
    }

    setSuggestBusy(true);
    const t = setTimeout(async () => {
      try {
        const dur = resDuration ? parseInt(resDuration, 10) : undefined;
        const params = { date: resDate, time: resTime, partySize: resParty, duration: dur };
        const [s, best] = await Promise.all([
          api.tables.suggest(params),
          api.tables.best(params),
        ]);
        // Discard if a newer param change has already fired
        if (gen !== suggestGenRef.current) return;
        setResSuggestions(s);
        setAutoResult(best);

        // Apply auto-selection only when host hasn't manually chosen
        if (!manualOverrideRef.current) {
          if (best) {
            setResTable(best.tableIds[0]);
            setResCombinedTableIds(best.tableIds.slice(1));
          } else {
            setResTable('');
            setResCombinedTableIds([]);
          }
        }
      } catch {
        if (gen !== suggestGenRef.current) return;
        setResSuggestions([]);
        setAutoResult(null);
        if (!manualOverrideRef.current) {
          setResCombinedTableIds([]);
        }
      } finally {
        if (gen === suggestGenRef.current) setSuggestBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resDate, resTime, resParty, resDuration, mode]);

  // Push updated suggestions to the full-screen map picker (or always-armed new-res map).
  useEffect(() => {
    if ((pickingOnMap || newResPickMode) && !suggestBusy) onUpdatePickSuggestions?.(resSuggestions);
  }, [pickingOnMap, newResPickMode, suggestBusy, resSuggestions, onUpdatePickSuggestions]);
  useEffect(() => {
    if (wiPickingOnMap && !wiSuggestBusy) onUpdatePickSuggestions?.(wiSuggestions);
  }, [wiPickingOnMap, wiSuggestBusy, wiSuggestions, onUpdatePickSuggestions]);

  // Sync map-selected tables into resTable + resCombinedTableIds (always-armed new-res mode).
  // externalResTableIds is owned by HostDashboard; primary=first, secondaries=rest.
  useEffect(() => {
    if (!newResPickMode) return;
    const [primary = '', ...secondaries] = externalResTableIds ?? [];
    if (primary === resTable && secondaries.join(',') === resCombinedTableIds.join(',')) return;
    setResTable(primary);
    setResCombinedTableIds(secondaries);
    if (primary) setManualOverride(true);
    else setManualOverride(false);
  // intentionally exclude resTable / resCombinedTableIds to avoid loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalResTableIds, newResPickMode]);

  // Revalidate selected table when suggestions update — clear if now hard-blocked.
  useEffect(() => {
    if (!newResPickMode || !resTable || resSuggestions.length === 0) return;
    const isHardBlocked = (tableId: string) => {
      const sug = resSuggestions.find(s => s.tableId === tableId);
      if (!sug) return false;
      return sug.reasons.some(r => r.code === 'TABLE_BLOCKED') ||
             sug.reasons.some(r => r.code === 'CONFLICT' && r.occupied);
    };
    if (isHardBlocked(resTable)) {
      setResTable('');
      setResCombinedTableIds([]);
      setManualOverride(false);
      onResTableChange?.([]);
      return;
    }
    const validSecondaries = resCombinedTableIds.filter(id => !isHardBlocked(id));
    if (validSecondaries.length !== resCombinedTableIds.length) {
      setResCombinedTableIds(validSecondaries);
      onResTableChange?.([resTable, ...validSecondaries]);
    }
  }, [resSuggestions, newResPickMode, resTable, resCombinedTableIds, onResTableChange]);

  // Walk-in auto-allocation — mirrors reservation logic but always uses today + now.
  // Fires when party size or duration changes in walk-in mode.
  useEffect(() => {
    if (mode !== 'walkin' || wiParty < 1) return;
    if (!preselectedTableId) {
      setWiManualOverride(false);
      setWiShowPicker(false);
    }
    setWiSuggestBusy(true);
    const t = setTimeout(async () => {
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      try {
        const dur = wiDuration ? parseInt(wiDuration, 10) : undefined;
        const params = { date, time, partySize: wiParty, duration: dur };
        const [s, best] = await Promise.all([
          api.tables.suggest(params),
          api.tables.best(params),
        ]);
        setWiSuggestions(s);
        setWiAutoResult(best);
        if (!wiManualOverrideRef.current) {
          setWiTable(best?.tableIds[0] ?? '');
          setWiCombinedTableIds(best?.tableIds.slice(1) ?? []);
        }
      } catch {
        setWiSuggestions([]);
        setWiAutoResult(null);
        if (!wiManualOverrideRef.current) setWiCombinedTableIds([]);
      } finally {
        setWiSuggestBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiParty, wiDuration, mode]);

  // Auto-default duration when party size changes, unless the host already made
  // a manual choice.
  useEffect(() => {
    if (durationManual) return;
    setResDuration(String(getDefaultDuration(resParty)));
  }, [resParty, durationManual]);

  // Same logic for walk-in duration.
  useEffect(() => {
    if (wiDurationManual) return;
    setWiDuration(String(getDefaultDuration(wiParty)));
  }, [wiParty, wiDurationManual]);

  // Board → drawer: when the host navigates to a different date on the top bar,
  // pull the new date into the reservation form so board and drawer stay on the
  // same day. Time is intentionally NOT synced here — the booking slot chosen by
  // the host should not be overwritten by the board's 60-second auto-refresh ticks.
  useEffect(() => {
    if (mode !== 'reservation') return;
    setResDate(defaultDate);
  }, [defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps

  function nowStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  function resolveTableName(id: string): string {
    return tables.find(t => t.id === id)?.name ?? '';
  }

  // On desktop: go straight to full-screen map. On mobile/tablet: show inline picker.
  function openTablePicker() {
    if (isDesktop && onPickTables) {
      openMapPicker();
    } else {
      setShowPicker(true);
      setManualOverride(true);
    }
  }

  function openMapPicker() {
    const sug = suggestBusy ? [] : resSuggestions;
    setPickingOnMap(true);
    setShowPicker(false);
    onPickTables?.(
      [resTable, ...resCombinedTableIds].filter(Boolean),
      sug,
      (ids) => {
        setPickingOnMap(false);
        if (ids !== null) {
          setResTable(ids[0] ?? '');
          setResCombinedTableIds(ids.slice(1));
          setManualOverride(true);
        }
      },
      'change-table',
      undefined,
      false,
      resTime,
    );
  }

  function openWiTablePicker() {
    if (isDesktop && onPickTables) {
      openWiMapPicker();
    } else {
      setWiShowPicker(true);
      setWiManualOverride(true);
    }
  }

  function openWiMapPicker() {
    const sug = wiSuggestBusy ? [] : wiSuggestions;
    setWiPickingOnMap(true);
    setWiShowPicker(false);
    onPickTables?.(
      [wiTable, ...wiCombinedTableIds].filter(Boolean),
      sug,
      (ids) => {
        setWiPickingOnMap(false);
        if (ids !== null) {
          setWiTable(ids[0] ?? '');
          setWiCombinedTableIds(ids.slice(1));
          setWiManualOverride(true);
        }
      },
      'change-table',
      undefined,
      true,
    );
  }

  // Returns the saved reservation on success, null on conflict/error.
  // Does NOT call onCreated/onUpdated — callers must do that AFTER all local cleanup.
  async function doSubmitReservation(overrideConflicts = false, reorganizeIds: string[] = []): Promise<Reservation | null> {
    setError(null);
    setBusy(true);
    try {
      // Edit-standby mode: PATCH the existing reservation
      if (isEditingStandby && standbyReservation) {
        const tableId = resTable || undefined;
        const r = await api.reservations.update(standbyReservation.id, {
          guestName:        resName.trim(),
          guestPhone:       resPhone.trim() || undefined,
          partySize:        resParty,
          date:             resDate,
          time:             resTime,
          duration:         resDuration ? parseInt(resDuration, 10) : undefined,
          guestNotes:       resGuestNote.trim() || undefined,
          hostNotes:        resHostNote.trim() || undefined,
          tableId:          tableId ?? null,
          combinedTableIds: resCombinedTableIds.length > 0 ? resCombinedTableIds : [],
          overrideConflicts: overrideConflicts || undefined,
          reorganizeIds:     reorganizeIds.length > 0 ? reorganizeIds : undefined,
          // Assign table → confirm; no table → keep as STANDBY
          status:           tableId ? 'CONFIRMED' : 'STANDBY',
        });
        return r;
      }

      const r = await api.reservations.create({
        guestName:        resName.trim(),
        guestPhone:       resPhone.trim() || undefined,
        partySize:        resParty,
        date:             resDate,
        time:             resTime,
        duration:         resDuration ? parseInt(resDuration, 10) : undefined,
        guestNotes:       resGuestNote.trim() || undefined,
        hostNotes:        resHostNote.trim() || undefined,
        // Standby: no table, no conflict checks
        tableId:          isStandby ? undefined : (resTable || undefined),
        combinedTableIds: isStandby ? undefined : (resCombinedTableIds.length > 0 ? resCombinedTableIds : undefined),
        source:           resSource,
        lang:             locale,
        overrideConflicts: isStandby ? undefined : (overrideConflicts || undefined),
        reorganizeIds:     isStandby ? undefined : (reorganizeIds.length > 0 ? reorganizeIds : undefined),
        status:           isStandby ? 'STANDBY' : undefined,
      });
      return r;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'CONFLICT' && resTable) {
        const det = err.details as { code?: string; conflicts?: ReorganizeConflict[] } | null;
        if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
          setResConflictWarning({
            conflicts:        det.conflicts,
            tableId:          resTable,
            combinedTableIds: resCombinedTableIds,
            busy:             false,
          });
          return null;
        }
      }
      setError(err instanceof Error ? err.message : isEditingStandby ? 'Failed to update reservation' : 'Failed to create reservation');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitReservation(e: React.FormEvent) {
    e.preventDefault();
    // In edit-standby mode, phone is already known — skip the confirmation guard
    if (!isEditingStandby && !resPhone.trim()) { setPhoneWarning(true); return; }
    setPendingResConfirm(true);
  }

  async function confirmAndSave() {
    const r = await doSubmitReservation();
    // Clear local state BEFORE calling the callback — it unmounts this component,
    // so any setState after it is a silent no-op in React 18.
    setPendingResConfirm(false);
    setBusy(false);
    if (r) {
      if (isEditingStandby) onUpdated?.(r);
      else onCreated(r);
    }
  }

  async function doSubmitWalkIn(seatNow: boolean) {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setError(null);
    setBusy(true);
    try {
      let r = await api.reservations.create({
        guestName:  wiName.trim() || 'Walk-in Guest',
        guestPhone: wiPhone.trim() || undefined,
        partySize:  wiParty,
        date:       todayStr(),
        time:       nowStr(),
        duration:   wiDuration ? parseInt(wiDuration, 10) : undefined,
        guestNotes: wiNotes.trim() || undefined,
        source:     'WALK_IN',
      });
      if (seatNow && wiTable) {
        try {
          r = await api.reservations.seat(r.id, wiTable, false, wiCombinedTableIds);
        } catch (seatErr: unknown) {
          if (seatErr instanceof ApiError && seatErr.code === 'CONFLICT') {
            const det = seatErr.details as { code?: string; conflicts?: ReorganizeConflict[] } | null;
            if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
              // Walk-in created but not seated — show soft warning so host can override.
              // Do NOT call onCreated here: handleCreated calls setCreateMode(null) which
              // unmounts CreateDrawer before the dialog can render. onCreated is called
              // only after the host confirms or cancels.
              setWiConflictWarning({
                unseatedReservation: r,
                reservationId:       r.id,
                tableId:             wiTable,
                combinedTableIds:    wiCombinedTableIds,
                conflictTime:        det.conflicts[0].time,
                tableName:           resolveTableName(wiTable),
              });
              return;
            }
          }
          // Reservation was created; seat failed for an unexpected reason.
          // Close drawer with the unseated walk-in rather than leaving it open
          // and risking a duplicate submission.
          onCreated(r);
          return;
        }
      } else if (r.status === 'PENDING') {
        r = await api.reservations.confirm(r.id);
      }
      onCreated(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create walk-in');
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function submitWalkIn(seatNow: boolean) {
    if (!wiPhone.trim()) { setPendingSeat(seatNow); setPhoneWarning(true); return; }
    await doSubmitWalkIn(seatNow);
  }

  // ── Booking subtext: time · party · date ─────────────────────────────────────
  function bookingSubtext(): string {
    if (!resDate || !resTime) return '';
    const parts = resDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return '';
    const fmtDate = new Intl.DateTimeFormat(intlLocale, {
      weekday: intlLocale === 'he-IL' ? 'long' : 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(parts[0], parts[1] - 1, parts[2]));
    const guestW = locale === 'he'
      ? (resParty === 1 ? 'אורח' : 'אורחים')
      : (resParty === 1 ? 'guest' : 'guests');
    return `${resTime} · ${resParty} ${guestW} · ${fmtDate}`;
  }

  // ── Confirm button label ──────────────────────────────────────────────────────
  // Shows which table(s) will be used so the host can confirm at a glance.
  function confirmLabel(): string {
    if (busy) return T.createDrawer.submitCreateBusy;
    if (isEditingStandby) {
      // Show "Confirm reservation" when table is selected, otherwise "Save"
      if (resTable) return T.createDrawer.confirmStandby;
      return T.createDrawer.saveStandby;
    }
    if (isStandby) return T.createDrawer.saveStandby;
    if (suggestBusy && !resTable) return T.createDrawer.confirmChecking;

    if (manualOverride) {
      const allIds = [resTable, ...resCombinedTableIds].filter(Boolean);
      const names = allIds.map(resolveTableName).filter(Boolean);
      if (names.length > 1) return T.createDrawer.confirmWithTables(names.join(' + '));
      if (names.length === 1) return T.createDrawer.confirmWithTable(names[0]);
      // IDs present but names not yet resolved (tables not loaded) → safe fallback
      if (allIds.length > 0) return T.createDrawer.confirmNoTable;
      return T.createDrawer.confirmNoTable;
    }

    if (autoResult?.type === 'combined') return T.createDrawer.confirmWithTables(autoResult.tableNames.join(' + '));
    const name = resTable ? (autoResult ? autoResult.tableNames[0] : resolveTableName(resTable)) : null;
    if (name) return T.createDrawer.confirmWithTable(name);
    return T.createDrawer.confirmNoTable;
  }

  return (
    <>
      {/* Backdrop — hidden in new-res pick mode (map always accessible) and during old-style map pick */}
      {!pickingOnMap && !wiPickingOnMap && !mapPickActive && !newResPickMode && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={isDesktop && onPickTables ? (mode === 'walkin' ? openWiMapPicker : openMapPicker) : undefined}
          style={isDesktop && onPickTables ? { cursor: 'crosshair' } : undefined}
        />
      )}

      {/* Drawer — stays visible during map pick so the host sees the form alongside the floor */}
      <aside className="fixed right-0 top-0 h-full w-[420px] bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="p-4 border-b border-iron-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-iron-text font-semibold text-base">
              {isEditingStandby
                ? (locale === 'he' ? 'עריכת סטנדביי' : 'Edit Standby')
                : mode === 'reservation' ? T.createDrawer.titleReservation : T.createDrawer.titleWalkIn}
            </h2>
            <button
              onClick={() => {
                if (pickingOnMap || wiPickingOnMap) {
                  setPickingOnMap(false);
                  setWiPickingOnMap(false);
                  onPickTablesCancel?.();
                }
                onClose();
              }}
              className="text-iron-muted hover:text-iron-text text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Mode tabs — hidden when editing an existing standby */}
          {!isEditingStandby && (
            <div className="flex gap-1 bg-iron-bg rounded-lg p-1">
              <button
                type="button"
                onClick={() => {
                  if (wiPickingOnMap) { setWiPickingOnMap(false); onPickTablesCancel?.(); }
                  setResTable(prev => prev || wiTable); setMode('reservation'); setError(null); setPhoneWarning(false);
                }}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                  mode === 'reservation' ? 'bg-iron-green text-white' : 'text-iron-muted hover:text-iron-text'
                }`}
              >
                {T.createDrawer.tabReservation}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pickingOnMap) { setPickingOnMap(false); onPickTablesCancel?.(); }
                  setWiTable(prev => prev || resTable); setMode('walkin'); setError(null); setPhoneWarning(false);
                }}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                  mode === 'walkin' ? 'bg-iron-green text-white' : 'text-iron-muted hover:text-iron-text'
                }`}
              >
                {T.createDrawer.tabWalkIn}
              </button>
            </div>
          )}
        </div>

        {/* ── Reservation form ── */}
        {mode === 'reservation' && (
          <>
            {/* Scrollable body — form tag scoped here; submit button is in the sticky footer */}
            <form
              id="create-res-form"
              onSubmit={submitReservation}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >

              {/* Gap suggestion banner */}
              {gapHint && (
                <div className="flex items-start gap-2.5 bg-indigo-950/40 border border-status-info/30 rounded-lg px-3 py-2.5">
                  <span className="text-status-info mt-0.5 shrink-0" style={{ fontSize: 13 }}>◈</span>
                  <div className="min-w-0">
                    <p className="text-status-info text-xs font-semibold">
                      Available slot: {gapHint.startTime}–{gapHint.endTime}
                    </p>
                    <p className="text-status-info/70 text-[10px] mt-0.5">
                      {gapHint.tableName} · seats {gapHint.minCovers}–{gapHint.maxCovers} · {gapHint.durationMins}m window
                    </p>
                  </div>
                </div>
              )}

              {/* Reservation / Standby toggle — hidden when editing an existing standby */}
              {!isEditingStandby && (
                <>
                  <div className="flex rounded-lg overflow-hidden border border-iron-border text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setIsStandby(false)}
                      className={`flex-1 py-1.5 transition-colors ${!isStandby ? 'bg-iron-green text-white' : 'text-iron-muted hover:text-iron-text'}`}
                    >
                      {T.createDrawer.toggleReservation}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsStandby(true)}
                      className={`flex-1 py-1.5 transition-colors ${isStandby ? 'bg-amber-600 text-white' : 'text-iron-muted hover:text-iron-text'}`}
                    >
                      {T.createDrawer.toggleStandby}
                    </button>
                  </div>
                  {isStandby && (
                    <p className="text-[11px] text-amber-400/80 -mt-2">{T.createDrawer.standbyHint}</p>
                  )}
                </>
              )}
              {isEditingStandby && (
                <p className="text-[11px] text-amber-400/70">{T.createDrawer.standbyHint}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {/* Guest name — manual input only; lookup is phone-driven */}
                <div className="col-span-2">
                  <Label>{T.createDrawer.fieldGuestName}</Label>
                  <Input
                    type="text"
                    value={resName}
                    onChange={e => setResName(e.target.value)}
                    placeholder={T.createDrawer.placeholderName}
                    autoComplete="off"
                    required
                    autoFocus
                  />
                </div>

                {/* Phone + guest hint */}
                <div>
                  <Label>{T.createDrawer.fieldPhone}</Label>
                  <Input
                    type="tel"
                    value={resPhone}
                    onChange={e => setResPhone(e.target.value)}
                    placeholder={T.createDrawer.placeholderPhone}
                  />
                  {guestHint && !hintDismissed && (
                    <div className="mt-1.5 rounded-lg border border-iron-green/30 bg-iron-green/5 px-2.5 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-iron-green-light text-xs font-medium">{guestHint.firstName} {guestHint.lastName}</span>
                          {guestHint.isVip && <span className="text-[10px] font-semibold text-status-warning">VIP</span>}
                        </div>
                        <button type="button" onClick={() => setHintDismissed(true)} className="text-iron-muted hover:text-iron-text text-base leading-none px-0.5">×</button>
                      </div>
                      <div className="text-[11px] text-iron-muted space-y-0.5">
                        <div>
                          {isCrmImportWithNoHistory(guestHint.visitCount, guestHint.tags, guestHint.internalNotes)
                            ? <span className="italic text-iron-muted/60">{CRM_NO_HISTORY_LABEL}</span>
                            : <>{guestHint.visitCount} visit{guestHint.visitCount !== 1 ? 's' : ''}</>}
                          {guestHint.noShowCount > 0 && <span className="text-orange-400"> · {guestHint.noShowCount} no-show{guestHint.noShowCount !== 1 ? 's' : ''}</span>}
                          {guestHint.lastVisitAt && <span> · last {new Date(guestHint.lastVisitAt).toLocaleDateString()}</span>}
                        </div>
                        {guestHint.allergies.length > 0 && <div className="text-status-danger">⚠ {guestHint.allergies.join(', ')}</div>}
                        {guestHint.internalNotes && <div className="text-iron-muted/70 italic truncate">{guestHint.internalNotes}</div>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Party size */}
                <div>
                  <Label>{T.createDrawer.fieldPartySize}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={resParty}
                    onChange={e => setResParty(parseInt(e.target.value, 10) || 1)}
                    required
                  />
                  {gapHint && (
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      {Array.from(
                        { length: Math.min(gapHint.maxCovers, 20) - gapHint.minCovers + 1 },
                        (_, i) => gapHint.minCovers + i,
                      ).map(n => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setResParty(n)}
                          className={`text-[10px] w-6 h-6 rounded border font-semibold transition-colors ${
                            resParty === n
                              ? 'bg-status-info/25 border-status-info/60 text-status-info'
                              : 'border-iron-border text-iron-muted hover:border-status-info/50 hover:text-status-info'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                      <span className="text-[10px] text-iron-muted/60 ml-0.5">fits {gapHint.minCovers}–{gapHint.maxCovers}</span>
                    </div>
                  )}
                </div>

                {/* Date */}
                <div className="col-span-2">
                  <Label>{T.createDrawer.fieldDate}</Label>
                  <MiniCalendar
                    value={resDate}
                    onValueChange={d => {
                      setResDate(d);
                      onDateTimeChange?.(d, resTime);
                    }}
                  />
                </div>

                {/* Time */}
                <div>
                  <Label>{T.createDrawer.fieldTime}</Label>
                  <select
                    value={resTime}
                    onChange={e => {
                      const t = e.target.value;
                      setResTime(t);
                      onDateTimeChange?.(resDate, t);
                    }}
                    required
                    className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green transition-colors"
                  >
                    {TIME_SLOTS.map(slot => (
                      <option key={slot} value={slot}>{slot}</option>
                    ))}
                  </select>
                </div>

                {/* Duration */}
                <div>
                  <Label>{T.createDrawer.fieldDuration}</Label>
                  <div className="flex gap-1 mt-0.5 mb-1.5">
                    {([90, 120] as const).map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setResDuration(String(preset));
                          setDurationManual(true);
                        }}
                        className={`flex-1 text-xs py-2 rounded-lg border font-medium transition-colors ${
                          resDuration === String(preset)
                            ? 'bg-iron-green/20 border-iron-green/50 text-iron-green-light'
                            : 'border-iron-border text-iron-muted hover:text-iron-text'
                        }`}
                      >
                        {preset === 90 ? T.createDrawer.durationPreset90 : T.createDrawer.durationPreset120}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    min={30}
                    max={480}
                    step={15}
                    value={resDuration}
                    onChange={e => {
                      setResDuration(e.target.value);
                      setDurationManual(true);
                    }}
                    placeholder={T.createDrawer.placeholderDuration}
                  />
                </div>

                {/* Source */}
                <div>
                  <Label>{T.createDrawer.fieldSource}</Label>
                  <div className="flex gap-1 mt-0.5">
                    {(['PHONE', 'INTERNAL'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setResSource(s)}
                        className={`flex-1 text-xs py-2 rounded-lg border font-medium transition-colors ${
                          resSource === s
                            ? 'bg-iron-green/20 border-iron-green/50 text-iron-green-light'
                            : 'border-iron-border text-iron-muted hover:text-iron-text'
                        }`}
                      >
                        {s === 'PHONE' ? T.createDrawer.sourcePhone : T.createDrawer.sourceInternal}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label>{T.createDrawer.fieldGuestNotes}</Label>
                <TextArea
                  value={resGuestNote}
                  onChange={e => setResGuestNote(e.target.value)}
                  placeholder={T.createDrawer.placeholderGuestNotes}
                />
              </div>

              <div>
                <Label>{T.createDrawer.fieldHostNotes}</Label>
                <TextArea
                  value={resHostNote}
                  onChange={e => setResHostNote(e.target.value)}
                  placeholder={T.createDrawer.placeholderHostNotes}
                />
              </div>

              {/* ── Table allocation ── */}
              <div>
                <Label>{T.createDrawer.fieldTable}</Label>

                {/* New-reservation always-armed toggle-select display */}
                {newResPickMode && !pickingOnMap && (
                  resTable ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2.5 rounded-lg bg-iron-green/10 border border-iron-green/35">
                        <span className="text-iron-green-light font-semibold text-sm">
                          {[resTable, ...resCombinedTableIds]
                            .map(id => resolveTableName(id) || id)
                            .join(' + ')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setResTable(''); setResCombinedTableIds([]); setManualOverride(false); onResTableChange?.([]); }}
                        className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text transition-colors shrink-0"
                      >{T.createDrawer.clearSelection}</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-iron-bg border border-iron-border/60 text-iron-muted text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-iron-green/60 animate-pulse shrink-0" />
                      {T.createDrawer.newResPickHint}
                    </div>
                  )
                )}

                {/* Picking on map banner (old-style explicit pick) */}
                {pickingOnMap && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-status-reserved/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-reserved animate-pulse shrink-0" />
                    <span className="text-status-reserved text-xs flex-1">{T.createDrawer.tablePickingOnMap}</span>
                    <button
                      type="button"
                      onClick={() => { setPickingOnMap(false); onPickTablesCancel?.(); }}
                      className="text-xs text-iron-muted hover:text-iron-text transition-colors shrink-0"
                    >
                      {T.common.cancel}
                    </button>
                  </div>
                )}

                {/* Loading state */}
                {!newResPickMode && !pickingOnMap && suggestBusy && (
                  <div className="flex items-center gap-2 py-2 text-iron-muted">
                    <div className="w-3 h-3 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
                    <span className="text-xs">{T.createDrawer.tableSearching}</span>
                  </div>
                )}

                {/* Auto-selected, no override, picker hidden */}
                {!newResPickMode && !pickingOnMap && !suggestBusy && autoResult && !manualOverride && !showPicker && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-iron-green/10 border border-iron-green/35">
                      <span className="text-iron-green-light font-semibold text-sm">
                        {autoResult.type === 'combined'
                          ? T.createDrawer.tableAutoCombined(autoResult.tableNames.join(' + '))
                          : T.createDrawer.tableAutoSelected(autoResult.tableNames[0])}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-iron-green/25 border border-iron-green/40 text-iron-green-light font-bold shrink-0">
                        {T.createDrawer.autoLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={openTablePicker}
                      className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors shrink-0"
                    >
                      {T.createDrawer.tableChangeBtn}
                    </button>
                    {onPickTables && !isDesktop && (
                      <button
                        type="button"
                        onClick={openMapPicker}
                        className="text-xs px-2.5 py-2 rounded-lg border border-status-reserved/40 text-status-reserved hover:bg-status-reserved/10 transition-colors shrink-0"
                      >
                        {T.createDrawer.tableSelectOnMap}
                      </button>
                    )}
                  </div>
                )}

                {/* Manual override selected, picker hidden */}
                {!newResPickMode && !pickingOnMap && !suggestBusy && manualOverride && !showPicker && (() => {
                  const manualNames = [resTable, ...resCombinedTableIds].filter(Boolean).map(resolveTableName);
                  const autoIds = autoResult?.tableIds ?? [];
                  const currentIds = [resTable, ...resCombinedTableIds].filter(Boolean);
                  const differsFromAuto = autoIds.join(',') !== currentIds.join(',');
                  return (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-iron-border/15 border border-iron-border/50 min-w-0">
                        <span className="text-iron-text font-semibold text-sm truncate">
                          {manualNames.length > 0 ? manualNames.join(' + ') : T.createDrawer.tableNone}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={openTablePicker}
                        className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors shrink-0"
                      >
                        {T.createDrawer.tableChangeBtn}
                      </button>
                      {onPickTables && !isDesktop && (
                        <button
                          type="button"
                          onClick={openMapPicker}
                          className="text-xs px-2.5 py-2 rounded-lg border border-status-reserved/40 text-status-reserved hover:bg-status-reserved/10 transition-colors shrink-0"
                        >
                          {T.createDrawer.tableSelectOnMap}
                        </button>
                      )}
                      {autoResult && differsFromAuto && (
                        <button
                          type="button"
                          onClick={() => {
                            setManualOverride(false);
                            setResTable(autoResult.tableIds[0]);
                            setResCombinedTableIds(autoResult.tableIds.slice(1));
                            setShowPicker(false);
                          }}
                          className="text-xs text-iron-muted hover:text-iron-green-light transition-colors shrink-0"
                        >
                          {T.createDrawer.tableUseAuto}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* No table available, no picker */}
                {!newResPickMode && !pickingOnMap && !suggestBusy && !autoResult && !manualOverride && !showPicker && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-status-warning/20">
                      <span className="text-status-warning text-xs flex-1">{T.createDrawer.tableNoAvailable}</span>
                      <button
                        type="button"
                        onClick={openTablePicker}
                        className="text-xs px-2 py-1 rounded border border-status-warning/30 text-status-warning hover:bg-status-warning/10 transition-colors shrink-0"
                      >
                        {T.createDrawer.tableShowAll}
                      </button>
                      {onPickTables && !isDesktop && (
                        <button
                          type="button"
                          onClick={openMapPicker}
                          className="text-xs px-2 py-1 rounded border border-status-reserved/30 text-status-reserved hover:bg-status-reserved/10 transition-colors shrink-0"
                        >
                          {T.createDrawer.tableSelectOnMap}
                        </button>
                      )}
                    </div>
                    {onAddToWaitlist && (
                      <button
                        type="button"
                        onClick={() => { onAddToWaitlist({ guestName: resName.trim(), partySize: resParty, guestPhone: resPhone.trim() || undefined, date: resDate, time: resTime || undefined }); onClose(); }}
                        className="w-full text-xs px-3 py-2 rounded-lg border border-iron-green/40 text-iron-green-light hover:bg-iron-green/10 transition-colors font-medium"
                      >
                        {T.waitlistPanel.addToWaitlistButton}
                      </button>
                    )}
                  </div>
                )}

                {/* Override picker — floor map (falls back to grid when no positions) */}
                {!newResPickMode && showPicker && (
                  <div className="space-y-2">
                    <FloorTablePicker
                      tables={tables}
                      floorObjs={floorObjs ?? []}
                      suggestions={resSuggestions}
                      selectedIds={[resTable, ...resCombinedTableIds].filter(Boolean)}
                      onMultiPick={ids => {
                        setResTable(ids[0] ?? '');
                        setResCombinedTableIds(ids.slice(1));
                        setManualOverride(true);
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setShowPicker(false)}
                        className="text-iron-muted text-xs hover:text-iron-text transition-colors"
                      >
                        {T.guestDrawer.backLink}
                      </button>
                      {[resTable, ...resCombinedTableIds].some(Boolean) && (
                        <button
                          type="button"
                          onClick={() => { setResTable(''); setResCombinedTableIds([]); }}
                          className="text-xs text-iron-muted hover:text-status-danger transition-colors"
                        >
                          {T.createDrawer.tableClearSelection}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Capacity advisory warning */}
              {(() => {
                const allIds = [resTable, ...resCombinedTableIds].filter(Boolean);
                if (allIds.length === 0 || resParty < 1) return null;
                const totalMax = allIds.reduce((sum, id) => {
                  const t = tables.find(t => t.id === id);
                  return sum + (t?.maxCovers ?? 0);
                }, 0);
                if (totalMax >= resParty) return null;
                return (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-status-warning/25">
                    <span className="text-status-warning shrink-0 mt-0.5">⚠</span>
                    <p className="text-status-warning text-xs">{T.createDrawer.tableCapacityWarn(totalMax, resParty)}</p>
                  </div>
                );
              })()}

              {error && (
                <p className="text-status-danger text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </form>

            {/* ── Sticky confirm footer ── */}
            <div className="p-3 border-t border-iron-border shrink-0">
              {onPickTables && !pickingOnMap && !isDesktop && (
                <button
                  type="button"
                  onClick={openMapPicker}
                  className="w-full mb-2 py-2 text-sm font-medium rounded-lg border border-status-reserved/50 text-status-reserved hover:bg-status-reserved/10 transition-colors"
                >
                  {resTable ? T.createDrawer.tableChangeFromMap : T.createDrawer.tableSelectFromMap}
                </button>
              )}
              {phoneWarning ? (
                <div className="rounded-lg border border-status-warning/30 bg-amber-900/10 p-3 space-y-2.5">
                  <div>
                    <p className="text-status-warning text-xs font-semibold">{T.createDrawer.phoneWarnTitle}</p>
                    <p className="text-iron-muted text-[11px] mt-1 leading-relaxed">{T.createDrawer.phoneWarnBody}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPhoneWarning(false)}
                      className="flex-1 text-xs py-2 rounded-lg border border-iron-green/40 text-iron-green-light hover:bg-iron-green/10 transition-colors font-medium"
                    >
                      {T.createDrawer.phoneWarnAddPhone}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPhoneWarning(false); setPendingResConfirm(true); }}
                      className="flex-1 text-xs py-2 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
                    >
                      {T.createDrawer.phoneWarnContinue}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="submit"
                  form="create-res-form"
                  disabled={busy || (!isStandby && suggestBusy && !resTable)}
                  className={`w-full disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors leading-tight ${!isEditingStandby && isStandby ? 'bg-amber-600 hover:bg-amber-500' : 'bg-iron-green hover:bg-iron-green-light'}`}
                >
                  <span className="block">{confirmLabel()}</span>
                  {!busy && bookingSubtext() && (
                    <span className="block text-[10px] font-normal opacity-75 mt-0.5">{bookingSubtext()}</span>
                  )}
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Walk-in form ── */}
        {mode === 'walkin' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>{T.createDrawer.fieldWalkInName}</Label>
                <Input
                  type="text"
                  value={wiName}
                  onChange={e => setWiName(e.target.value)}
                  placeholder={T.createDrawer.placeholderWalkInName}
                  autoComplete="off"
                  autoFocus
                />
              </div>

              <div className="col-span-2">
                <Label>{T.createDrawer.fieldWalkInPhone}</Label>
                <Input
                  type="tel"
                  inputMode="tel"
                  value={wiPhone}
                  onChange={e => setWiPhone(e.target.value)}
                  placeholder={T.createDrawer.placeholderWalkInPhone}
                />
                {wiGuestHint && !wiHintDismissed && (
                  <div className="mt-1.5 rounded-lg border border-iron-green/30 bg-iron-green/5 px-2.5 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-iron-green-light text-xs font-medium">{wiGuestHint.firstName} {wiGuestHint.lastName}</span>
                        {wiGuestHint.isVip && <span className="text-[10px] font-semibold text-status-warning">VIP</span>}
                      </div>
                      <button type="button" onClick={() => setWiHintDismissed(true)} className="text-iron-muted hover:text-iron-text text-base leading-none px-0.5">×</button>
                    </div>
                    <div className="text-[11px] text-iron-muted space-y-0.5">
                      <div>
                        {isCrmImportWithNoHistory(wiGuestHint.visitCount, wiGuestHint.tags, wiGuestHint.internalNotes)
                          ? <span className="italic text-iron-muted/60">{CRM_NO_HISTORY_LABEL}</span>
                          : <>{wiGuestHint.visitCount} visit{wiGuestHint.visitCount !== 1 ? 's' : ''}</>}
                        {wiGuestHint.noShowCount > 0 && <span className="text-orange-400"> · {wiGuestHint.noShowCount} no-show{wiGuestHint.noShowCount !== 1 ? 's' : ''}</span>}
                        {wiGuestHint.lastVisitAt && <span> · last {new Date(wiGuestHint.lastVisitAt).toLocaleDateString()}</span>}
                      </div>
                      {wiGuestHint.allergies.length > 0 && <div className="text-status-danger">⚠ {wiGuestHint.allergies.join(', ')}</div>}
                      {wiGuestHint.internalNotes && <div className="text-iron-muted/70 italic truncate">{wiGuestHint.internalNotes}</div>}
                    </div>
                  </div>
                )}
              </div>

              <div className="col-span-2">
                <Label>{T.createDrawer.fieldWalkInParty}</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={wiParty}
                  onChange={e => setWiParty(parseInt(e.target.value, 10) || 1)}
                  onClick={openWiTablePicker}
                />
              </div>
            </div>

            {/* Duration */}
            <div>
              <Label>{T.createDrawer.fieldWalkInDuration}</Label>
              <div className="flex gap-1 mt-0.5 mb-1.5">
                {([60, 90, 120, 150] as const).map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => { setWiDuration(String(preset)); setWiDurationManual(true); }}
                    className={`flex-1 text-xs py-2 rounded-lg border font-medium transition-colors ${
                      wiDuration === String(preset)
                        ? 'bg-iron-green/20 border-iron-green/50 text-iron-green-light'
                        : 'border-iron-border text-iron-muted hover:text-iron-text'
                    }`}
                  >
                    {preset === 60  ? T.createDrawer.durationPreset60
                      : preset === 90  ? T.createDrawer.durationPreset90
                      : preset === 120 ? T.createDrawer.durationPreset120
                      : T.createDrawer.durationPreset150}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={30}
                max={480}
                step={15}
                value={wiDuration}
                onChange={e => { setWiDuration(e.target.value); setWiDurationManual(true); }}
                placeholder="90"
              />
              {(() => {
                const mins = parseInt(wiDuration, 10);
                if (!mins || isNaN(mins)) return null;
                const end = new Date();
                end.setMinutes(end.getMinutes() + mins);
                const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                return <p className="text-iron-muted text-[11px] mt-1">{T.createDrawer.walkInEndsAt(endStr)}</p>;
              })()}
            </div>

            <div>
              <Label>{T.createDrawer.fieldWalkInNotes}</Label>
              <TextArea
                value={wiNotes}
                onChange={e => setWiNotes(e.target.value)}
                placeholder={T.createDrawer.placeholderWalkInNotes}
              />
            </div>

            {/* ── Table allocation (same model as reservation) ── */}
            <div>
              <Label>{T.createDrawer.fieldWalkInTable}</Label>

              {/* Picking on map banner */}
              {wiPickingOnMap && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-status-reserved/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-reserved animate-pulse shrink-0" />
                  <span className="text-status-reserved text-xs flex-1">{T.createDrawer.tablePickingOnMap}</span>
                  <button
                    type="button"
                    onClick={() => { setWiPickingOnMap(false); onPickTablesCancel?.(); }}
                    className="text-xs text-iron-muted hover:text-iron-text transition-colors shrink-0"
                  >
                    {T.common.cancel}
                  </button>
                </div>
              )}

              {/* Loading */}
              {!wiPickingOnMap && wiSuggestBusy && (
                <div className="flex items-center gap-2 py-2 text-iron-muted">
                  <div className="w-3 h-3 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="text-xs">{T.createDrawer.tableSearching}</span>
                </div>
              )}

              {/* Auto-selected, no override */}
              {!wiPickingOnMap && !wiSuggestBusy && wiAutoResult && !wiManualOverride && !wiShowPicker && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-iron-green/10 border border-iron-green/35">
                    <span className="text-iron-green-light font-semibold text-sm">
                      {wiAutoResult.type === 'combined'
                        ? T.createDrawer.tableAutoCombined(wiAutoResult.tableNames.join(' + '))
                        : T.createDrawer.tableAutoSelected(wiAutoResult.tableNames[0])}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-iron-green/25 border border-iron-green/40 text-iron-green-light font-bold shrink-0">
                      {T.createDrawer.autoLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={openWiTablePicker}
                    className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors shrink-0"
                  >
                    {T.createDrawer.tableChangeBtn}
                  </button>
                  {onPickTables && !isDesktop && (
                    <button
                      type="button"
                      onClick={openWiMapPicker}
                      className="text-xs px-2.5 py-2 rounded-lg border border-status-reserved/40 text-status-reserved hover:bg-status-reserved/10 transition-colors shrink-0"
                    >
                      {T.createDrawer.tableSelectOnMap}
                    </button>
                  )}
                </div>
              )}

              {/* Manual override selected */}
              {!wiPickingOnMap && !wiSuggestBusy && wiManualOverride && !wiShowPicker && (() => {
                const names = [wiTable, ...wiCombinedTableIds].filter(Boolean).map(resolveTableName);
                const autoIds = wiAutoResult?.tableIds ?? [];
                const currentIds = [wiTable, ...wiCombinedTableIds].filter(Boolean);
                const differsFromAuto = autoIds.join(',') !== currentIds.join(',');
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-iron-border/15 border border-iron-border/50 min-w-0">
                      <span className="text-iron-text font-semibold text-sm truncate">
                        {names.length > 0 ? names.join(' + ') : T.createDrawer.tableNone}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={openWiTablePicker}
                      className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors shrink-0"
                    >
                      {T.createDrawer.tableChangeBtn}
                    </button>
                    {onPickTables && !isDesktop && (
                      <button
                        type="button"
                        onClick={openWiMapPicker}
                        className="text-xs px-2.5 py-2 rounded-lg border border-status-reserved/40 text-status-reserved hover:bg-status-reserved/10 transition-colors shrink-0"
                      >
                        {T.createDrawer.tableSelectOnMap}
                      </button>
                    )}
                    {wiAutoResult && differsFromAuto && (
                      <button
                        type="button"
                        onClick={() => {
                          setWiManualOverride(false);
                          setWiTable(wiAutoResult.tableIds[0]);
                          setWiCombinedTableIds(wiAutoResult.tableIds.slice(1));
                          setWiShowPicker(false);
                        }}
                        className="text-xs text-iron-muted hover:text-iron-green-light transition-colors shrink-0"
                      >
                        {T.createDrawer.tableUseAuto}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* No available table */}
              {!wiPickingOnMap && !wiSuggestBusy && !wiAutoResult && !wiManualOverride && !wiShowPicker && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-status-warning/20">
                    <span className="text-status-warning text-xs flex-1">{T.createDrawer.tableNoAvailable}</span>
                    <button
                      type="button"
                      onClick={openWiTablePicker}
                      className="text-xs px-2 py-1 rounded border border-status-warning/30 text-status-warning hover:bg-status-warning/10 transition-colors shrink-0"
                    >
                      {T.createDrawer.tableShowAll}
                    </button>
                    {onPickTables && !isDesktop && (
                      <button
                        type="button"
                        onClick={openWiMapPicker}
                        className="text-xs px-2 py-1 rounded border border-status-reserved/30 text-status-reserved hover:bg-status-reserved/10 transition-colors shrink-0"
                      >
                        {T.createDrawer.tableSelectOnMap}
                      </button>
                    )}
                  </div>
                  {onAddToWaitlist && (
                    <button
                      type="button"
                      onClick={() => { onAddToWaitlist({ guestName: wiName.trim(), partySize: wiParty, guestPhone: wiPhone.trim() || undefined, date: defaultDate }); onClose(); }}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-iron-green/40 text-iron-green-light hover:bg-iron-green/10 transition-colors font-medium"
                    >
                      {T.waitlistPanel.addToWaitlistButton}
                    </button>
                  )}
                </div>
              )}

              {/* Inline picker */}
              {wiShowPicker && (
                <div className="space-y-2">
                  <FloorTablePicker
                    tables={tables}
                    floorObjs={floorObjs ?? []}
                    suggestions={wiSuggestions}
                    selectedIds={[wiTable, ...wiCombinedTableIds].filter(Boolean)}
                    walkInMode={true}
                    onMultiPick={ids => {
                      setWiTable(ids[0] ?? '');
                      setWiCombinedTableIds(ids.slice(1));
                      setWiManualOverride(true);
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setWiShowPicker(false)}
                      className="text-iron-muted text-xs hover:text-iron-text transition-colors"
                    >
                      {T.guestDrawer.backLink}
                    </button>
                    {[wiTable, ...wiCombinedTableIds].some(Boolean) && (
                      <button
                        type="button"
                        onClick={() => { setWiTable(''); setWiCombinedTableIds([]); }}
                        className="text-xs text-iron-muted hover:text-status-danger transition-colors"
                      >
                        {T.createDrawer.tableClearSelection}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <p className="text-status-danger text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="space-y-2">
              {onPickTables && !wiPickingOnMap && !isDesktop && (
                <button
                  type="button"
                  onClick={openWiMapPicker}
                  className="w-full py-2 text-sm font-medium rounded-lg border border-status-reserved/50 text-status-reserved hover:bg-status-reserved/10 transition-colors"
                >
                  {wiTable ? T.createDrawer.tableChangeFromMap : T.createDrawer.tableSelectFromMap}
                </button>
              )}
              {phoneWarning ? (
                <div className="rounded-lg border border-status-warning/30 bg-amber-900/10 p-3 space-y-2.5">
                  <div>
                    <p className="text-status-warning text-xs font-semibold">{T.createDrawer.phoneWarnTitle}</p>
                    <p className="text-iron-muted text-[11px] mt-1 leading-relaxed">{T.createDrawer.phoneWarnBody}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPhoneWarning(false)}
                      className="flex-1 text-xs py-2 rounded-lg border border-iron-green/40 text-iron-green-light hover:bg-iron-green/10 transition-colors font-medium"
                    >
                      {T.createDrawer.phoneWarnAddPhone}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { setPhoneWarning(false); doSubmitWalkIn(pendingSeat); }}
                      className="flex-1 text-xs py-2 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text transition-colors disabled:opacity-50"
                    >
                      {T.createDrawer.phoneWarnContinue}
                    </button>
                  </div>
                </div>
              ) : wiTable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submitWalkIn(true)}
                  className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {busy ? T.createDrawer.submitSeatNowBusy : T.createDrawer.submitSeatNow}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submitWalkIn(false)}
                  className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {busy ? T.createDrawer.submitAddToListBusy : T.createDrawer.submitAddToList}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      {wiConflictWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div
            dir={locale === 'he' ? 'rtl' : 'ltr'}
            className="bg-iron-elevated border border-iron-border/50 rounded-xl p-5 mx-4 w-72 space-y-3"
            style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.40)' }}
          >
            <div>
              <p className="text-iron-text text-sm font-semibold">
                {T.createDrawer.conflictTitle(wiConflictWarning.tableName)}
              </p>
              <p className="text-iron-muted text-xs mt-0.5 leading-relaxed">
                {T.createDrawer.conflictBody(wiConflictWarning.tableName, wiConflictWarning.conflictTime)}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                disabled={seatAnywayBusy}
                className="w-full text-start text-xs px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/25 text-status-warning hover:bg-status-warning/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                onClick={async () => {
                  if (seatAnywayBusy) return;
                  setSeatAnywayBusy(true);
                  const { unseatedReservation, reservationId, tableId, combinedTableIds } = wiConflictWarning;
                  try {
                    const seated = await api.reservations.seat(reservationId, tableId, true, combinedTableIds);
                    setWiConflictWarning(null);
                    onCreated(seated);
                  } catch (err: unknown) {
                    setSeatAnywayBusy(false);
                    setWiConflictWarning(null);
                    onCreated(unseatedReservation);
                    setError(err instanceof Error ? err.message : 'Failed to seat walk-in');
                  }
                }}
              >
                {seatAnywayBusy && (
                  <span className="w-3 h-3 border-2 border-status-warning border-t-transparent rounded-full animate-spin shrink-0" />
                )}
                {seatAnywayBusy ? T.createDrawer.conflictSeatAnywayBusy : T.createDrawer.conflictSeatAnyway}
              </button>
              <button
                disabled={seatAnywayBusy}
                className="text-xs text-iron-muted hover:text-iron-text py-1.5 transition-colors disabled:opacity-40"
                onClick={() => {
                  const { unseatedReservation } = wiConflictWarning;
                  setWiConflictWarning(null);
                  onCreated(unseatedReservation);
                }}
              >
                {T.createDrawer.conflictCancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {resConflictWarning && (
        <ReorganizeConflictModal
          conflicts={resConflictWarning.conflicts}
          busy={resConflictWarning.busy}
          onCancel={() => setResConflictWarning(null)}
          onConfirm={async (selectedIds) => {
            setResConflictWarning(prev => prev ? { ...prev, busy: true } : null);
            const r = await doSubmitReservation(true, selectedIds);
            setResConflictWarning(null);
            if (r) onCreated(r);
          }}
        />
      )}

      {pendingResConfirm && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60">
          <div
            dir={locale === 'he' ? 'rtl' : 'ltr'}
            className="bg-iron-elevated border border-iron-border/50 rounded-xl p-5 mx-4 w-80 space-y-3"
            style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.40)' }}
          >
            <h3 className="text-iron-text font-semibold text-base">{T.createDrawer.confirmTitle}</h3>
            <div className="space-y-2 text-sm">
              {resName.trim() && (
                <div className="flex gap-2">
                  <span className="text-iron-muted shrink-0">{T.createDrawer.labelName}:</span>
                  <span className="text-iron-text font-medium">{resName.trim()}</span>
                </div>
              )}
              {resPhone.trim() && (
                <div className="flex gap-2">
                  <span className="text-iron-muted shrink-0">{T.createDrawer.labelPhone}:</span>
                  <span className="text-iron-text">{resPhone.trim()}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-iron-muted shrink-0">{T.createDrawer.labelDate}:</span>
                <span className="text-iron-text">{resDate}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-iron-muted shrink-0">{T.createDrawer.labelTime}:</span>
                <span className="text-iron-text">
                  {resTime}
                  {resDuration && (() => {
                    const [h, m] = resTime.split(':').map(Number);
                    const endMin = h * 60 + m + parseInt(resDuration, 10);
                    const eh = Math.floor(endMin / 60) % 24;
                    const em = endMin % 60;
                    return ` – ${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
                  })()}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-iron-muted shrink-0">{T.createDrawer.labelParty}:</span>
                <span className="text-iron-text">{resParty}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-iron-muted shrink-0">{T.createDrawer.labelTable}:</span>
                {(resTable || resCombinedTableIds.length > 0) ? (
                  <span className="text-iron-green-light font-semibold">
                    {[resTable, ...resCombinedTableIds].filter(Boolean).map(resolveTableName).join(' + ')}
                  </span>
                ) : (
                  <span className="text-iron-muted italic">{T.createDrawer.noTableSelected}</span>
                )}
              </div>
              {resGuestNote.trim() && (
                <div className="flex gap-2">
                  <span className="text-iron-muted shrink-0">{T.createDrawer.labelGuestNote}:</span>
                  <span className="text-iron-text">{resGuestNote.trim()}</span>
                </div>
              )}
              {resHostNote.trim() && (
                <div className="flex gap-2">
                  <span className="text-iron-muted shrink-0">{T.createDrawer.labelHostNote}:</span>
                  <span className="text-iron-text">{resHostNote.trim()}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => { void confirmAndSave(); }}
                className="flex-1 bg-iron-green hover:bg-iron-green/90 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {busy && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {T.common.ok}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingResConfirm(false)}
                className="px-4 py-2.5 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text text-sm transition-colors disabled:opacity-40"
              >
                {T.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
