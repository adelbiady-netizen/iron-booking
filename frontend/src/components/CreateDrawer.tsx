import { useState, useEffect, useRef } from 'react';
import type { BackendTableSuggestion, BestTableResult, FloorObjectData, GuestLookupResult, GuestSearchResult, Reservation, Table } from '../types';
import { api, ApiError } from '../api';
import ReorganizeConflictModal, { type ReorganizeConflict } from './ReorganizeConflictModal';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import FloorTablePicker from './FloorTablePicker';
import { getDefaultDuration } from '../utils/duration';

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
  onClose: () => void;
  onCreated: (r: Reservation) => void;
  onPickTables?: (currentIds: string[], suggestions: BackendTableSuggestion[], callback: (ids: string[] | null) => void) => void;
  onPickTablesCancel?: () => void;
  /** Called whenever the reservation date or time changes so the parent can keep
   *  the floor board in sync with the drawer. */
  onDateTimeChange?: (date: string, time: string) => void;
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

// ─── Table picker grid (walk-in mode) ─────────────────────────────────────────

interface TablePickerProps {
  tables: Table[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}

function TableGrid({ tables, value, onChange, label }: TablePickerProps) {
  const T = useT();
  const active = tables.filter(t => t.isActive);
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`text-xs p-2 rounded-lg border transition-colors text-center ${
            value === ''
              ? 'border-iron-green bg-iron-green/15 text-iron-green-light'
              : 'border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text'
          }`}
        >
          <div className="font-medium">{T.createDrawer.tableNone}</div>
        </button>
        {active.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`text-xs p-2 rounded-lg border transition-colors text-center ${
              value === t.id
                ? 'border-iron-green bg-iron-green/15 text-iron-green-light'
                : 'border-iron-border text-iron-text hover:border-iron-green'
            }`}
          >
            <div className="font-semibold">{t.name}</div>
            <div className="text-[10px] text-iron-muted">{t.minCovers}–{t.maxCovers}</div>
          </button>
        ))}
      </div>
    </div>
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
  initialData, gapHint, defaultTurnMinutes, onClose, onCreated,
  onPickTables, onPickTablesCancel,
  onDateTimeChange,
}: Props) {
  const T = useT();
  const { locale } = useLocale();
  const [mode, setMode] = useState<Mode>(gapHint ? 'reservation' : initialMode);

  // Reservation fields
  const [resName,      setResName]      = useState('');
  const [resPhone,     setResPhone]     = useState(initialData?.guestPhone ?? '');
  const [resParty,     setResParty]     = useState(2);
  const [resDate,      setResDate]      = useState(defaultDate);
  const [resTime,      setResTime]      = useState(snapToSlot(gapHint?.startTime ?? defaultTime));
  const [resDuration,  setResDuration]  = useState(
    gapHint ? String(gapHint.durationMins) : String(getDefaultDuration(2))
  );
  // durationManual: host has explicitly chosen a duration → suppress auto-defaults.
  // Starts true when a gap hint pre-fills the slot duration; false otherwise so
  // party-size changes continue to update the default automatically.
  const [durationManual, setDurationManual] = useState(!!gapHint);
  const [resGuestNote, setResGuestNote] = useState('');
  const [resHostNote,  setResHostNote]  = useState('');
  const [resSource,    setResSource]    = useState<'PHONE' | 'INTERNAL'>('PHONE');
  const [resTable,     setResTable]     = useState(gapHint?.tableId ?? preselectedTableId ?? '');

  // Walk-in fields
  const [wiName,          setWiName]          = useState(initialData?.guestName  ?? '');
  const [wiPhone,         setWiPhone]         = useState(initialData?.guestPhone ?? '');
  const [wiParty,         setWiParty]         = useState(initialData?.partySize  ?? 2);
  const [wiDuration,      setWiDuration]      = useState(String(defaultTurnMinutes ?? getDefaultDuration(initialData?.partySize ?? 2)));
  const [wiDurationManual, setWiDurationManual] = useState(false);
  const [wiNotes,         setWiNotes]         = useState('');
  const [wiTable,         setWiTable]         = useState(preselectedTableId ?? '');
  const [wiGuestHint,     setWiGuestHint]     = useState<GuestLookupResult | null>(null);
  const [wiHintDismissed, setWiHintDismissed] = useState(false);

  // Guest CRM hints
  const [guestHint,      setGuestHint]      = useState<GuestLookupResult | null>(null);
  const [hintDismissed,  setHintDismissed]  = useState(false);
  const [nameResults,    setNameResults]    = useState<GuestSearchResult[]>([]);
  const [showNameDrop,   setShowNameDrop]   = useState(false);

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
  const wiReorganizeKeyRef = useRef(0);
  const [wiReorganize, setWiReorganize] = useState<{
    conflicts: ReorganizeConflict[];
    reservationId: string;
    tableId: string;
    busy: boolean;
    _key: number;
  } | null>(null);
  const [phoneWarning, setPhoneWarning] = useState(false);
  const [pendingSeat,  setPendingSeat]  = useState(false);

  // Debounced guest lookup by phone
  useEffect(() => {
    if (!resPhone.trim()) { setGuestHint(null); setHintDismissed(false); return; }
    const t = setTimeout(async () => {
      try {
        const { guest } = await api.guests.lookupByPhone(resPhone);
        setGuestHint(guest);
        setHintDismissed(false);
        if (guest) setResName(prev => prev === '' ? `${guest.firstName} ${guest.lastName}` : prev);
      } catch { /* non-fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [resPhone]);

  // Debounced guest search by name
  useEffect(() => {
    const q = resName.trim();
    if (q.length < 2 || (guestHint && !hintDismissed)) {
      setNameResults([]); setShowNameDrop(false); return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.guests.search(q, 6);
        setNameResults(data);
        setShowNameDrop(data.length > 0);
      } catch { /* non-fatal */ }
    }, 300);
    return () => clearTimeout(t);
  }, [resName, guestHint, hintDismissed]);

  // Walk-in mode: debounced guest lookup by phone — same logic as reservation mode
  useEffect(() => {
    if (!wiPhone.trim()) { setWiGuestHint(null); setWiHintDismissed(false); return; }
    const t = setTimeout(async () => {
      try {
        const { guest } = await api.guests.lookupByPhone(wiPhone);
        setWiGuestHint(guest);
        setWiHintDismissed(false);
        if (guest) setWiName(prev => prev === '' ? `${guest.firstName} ${guest.lastName}` : prev);
      } catch { /* non-fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [wiPhone]);

  // ── Auto-allocation + suggestion fetch ───────────────────────────────────────
  // Fires when booking params change. Fetches suggestions + best result in parallel.
  // When params change (new date/time/party), clears the override so the system
  // re-evaluates — except when a table was explicitly pre-selected on open.
  useEffect(() => {
    if (mode !== 'reservation' || !resDate || !resTime || resParty < 1) return;

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
        setResSuggestions([]);
        setAutoResult(null);
        if (!manualOverrideRef.current) {
          setResCombinedTableIds([]);
        }
      } finally {
        setSuggestBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resDate, resTime, resParty, resDuration, mode]);

  // Auto-default duration when party size changes, unless the host already made
  // a manual choice. Runs on mount and every time resParty changes.
  useEffect(() => {
    if (durationManual) return;
    setResDuration(String(getDefaultDuration(resParty)));
  }, [resParty, durationManual]);

  // Same logic for walk-in duration.
  useEffect(() => {
    if (wiDurationManual) return;
    setWiDuration(String(defaultTurnMinutes ?? getDefaultDuration(wiParty)));
  }, [wiParty, wiDurationManual, defaultTurnMinutes]);

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
  function resolveTableName(id: string) {
    return tables.find(t => t.id === id)?.name ?? id;
  }

  async function openMapPicker() {
    setPickingOnMap(true);
    setShowPicker(false);
    // Suggestions may be empty (debounce hasn't fired) or stale (time just changed).
    // Fetch fresh ones so the picker always shows correct availability.
    let sug = resSuggestions;
    if (suggestBusy || sug.length === 0) {
      try {
        const dur = resDuration ? parseInt(resDuration, 10) : undefined;
        sug = await api.tables.suggest({ date: resDate, time: resTime, partySize: resParty, duration: dur });
      } catch { /* fall back to cached */ }
    }
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
    );
  }

  async function doSubmitReservation() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.reservations.create({
        guestName:        resName.trim(),
        guestPhone:       resPhone.trim() || undefined,
        partySize:        resParty,
        date:             resDate,
        time:             resTime,
        duration:         resDuration ? parseInt(resDuration, 10) : undefined,
        guestNotes:       resGuestNote.trim() || undefined,
        hostNotes:        resHostNote.trim() || undefined,
        tableId:          resTable || undefined,
        combinedTableIds: resCombinedTableIds.length > 0 ? resCombinedTableIds : undefined,
        source:           resSource,
        lang:             locale,
      });
      onCreated(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create reservation');
    } finally {
      setBusy(false);
    }
  }

  async function submitReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!resPhone.trim()) { setPhoneWarning(true); return; }
    await doSubmitReservation();
  }

  async function doSubmitWalkIn(seatNow: boolean) {
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
          r = await api.reservations.seat(r.id, wiTable);
        } catch (seatErr: unknown) {
          if (seatErr instanceof ApiError && seatErr.code === 'CONFLICT') {
            const det = seatErr.details as { code?: string; conflicts?: ReorganizeConflict[] } | null;
            if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
              // Walk-in created but not seated — show reorganize modal before proceeding
              setWiReorganize({ conflicts: det.conflicts, reservationId: r.id, tableId: wiTable, busy: false, _key: ++wiReorganizeKeyRef.current });
              onCreated(r);
              return;
            }
          }
          throw seatErr;
        }
      } else if (r.status === 'PENDING') {
        r = await api.reservations.confirm(r.id);
      }
      onCreated(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create walk-in');
    } finally {
      setBusy(false);
    }
  }

  async function submitWalkIn(seatNow: boolean) {
    if (!wiPhone.trim()) { setPendingSeat(seatNow); setPhoneWarning(true); return; }
    await doSubmitWalkIn(seatNow);
  }

  // ── Confirm button label ──────────────────────────────────────────────────────
  // Shows which table(s) will be used so the host can confirm at a glance.
  function confirmLabel(): string {
    if (busy) return T.createDrawer.submitCreateBusy;
    if (suggestBusy && !resTable) return T.createDrawer.confirmChecking;

    if (manualOverride) {
      const allIds = [resTable, ...resCombinedTableIds].filter(Boolean);
      if (allIds.length > 1) return T.createDrawer.confirmWithTables(allIds.map(resolveTableName).join(' + '));
      if (allIds.length === 1) return T.createDrawer.confirmWithTable(resolveTableName(allIds[0]));
      return T.createDrawer.confirmNoTable;
    }

    if (autoResult?.type === 'combined') return T.createDrawer.confirmWithTables(autoResult.tableNames.join(' + '));
    const name = resTable ? (autoResult ? autoResult.tableNames[0] : resolveTableName(resTable)) : null;
    if (name) return T.createDrawer.confirmWithTable(name);
    return T.createDrawer.confirmNoTable;
  }

  return (
    <>
      {/* Backdrop — hidden during map pick so the floor is accessible */}
      {!pickingOnMap && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />}

      {/* Drawer — hidden during map pick so the FloorBoard action bar is fully accessible */}
      <aside className={`fixed right-0 top-0 h-full w-[420px] bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl${pickingOnMap ? ' hidden' : ''}`}>

        {/* Header */}
        <div className="p-4 border-b border-iron-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-iron-text font-semibold text-base">
              {mode === 'reservation' ? T.createDrawer.titleReservation : T.createDrawer.titleWalkIn}
            </h2>
            <button
              onClick={onClose}
              className="text-iron-muted hover:text-iron-text text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 bg-iron-bg rounded-lg p-1">
            <button
              type="button"
              onClick={() => { setResTable(prev => prev || wiTable); setMode('reservation'); setError(null); setPhoneWarning(false); }}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                mode === 'reservation' ? 'bg-iron-green text-white' : 'text-iron-muted hover:text-iron-text'
              }`}
            >
              {T.createDrawer.tabReservation}
            </button>
            <button
              type="button"
              onClick={() => { setWiTable(prev => prev || resTable); setMode('walkin'); setError(null); setPhoneWarning(false); }}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                mode === 'walkin' ? 'bg-iron-green text-white' : 'text-iron-muted hover:text-iron-text'
              }`}
            >
              {T.createDrawer.tabWalkIn}
            </button>
          </div>
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
                <div className="flex items-start gap-2.5 bg-indigo-950/40 border border-indigo-500/30 rounded-lg px-3 py-2.5">
                  <span className="text-indigo-400 mt-0.5 shrink-0" style={{ fontSize: 13 }}>◈</span>
                  <div className="min-w-0">
                    <p className="text-indigo-300 text-xs font-semibold">
                      Available slot: {gapHint.startTime}–{gapHint.endTime}
                    </p>
                    <p className="text-indigo-400/70 text-[10px] mt-0.5">
                      {gapHint.tableName} · seats {gapHint.minCovers}–{gapHint.maxCovers} · {gapHint.durationMins}m window
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {/* Guest name with autocomplete */}
                <div className="col-span-2 relative">
                  <Label>{T.createDrawer.fieldGuestName}</Label>
                  <Input
                    type="text"
                    value={resName}
                    onChange={e => setResName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') setShowNameDrop(false); }}
                    onBlur={() => setShowNameDrop(false)}
                    placeholder={T.createDrawer.placeholderName}
                    required
                    autoFocus
                  />
                  {showNameDrop && nameResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-iron-card border border-iron-border rounded-lg shadow-xl z-50 overflow-hidden">
                      {nameResults.map(g => (
                        <button
                          key={g.id}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setResName(`${g.firstName} ${g.lastName}`);
                            setResPhone(g.phone ?? '');
                            setShowNameDrop(false);
                            setNameResults([]);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-iron-bg/60 text-left transition-colors border-b border-iron-border/30 last:border-0"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-iron-text">{g.firstName} {g.lastName}</span>
                              {g.isVip && <span className="text-[9px] font-semibold text-amber-400">VIP</span>}
                            </div>
                            <div className="text-[10px] text-iron-muted mt-0.5 flex items-center gap-1.5">
                              {g.phone && <span>{g.phone}</span>}
                              {g.visitCount > 0 && <span className="text-iron-muted/60">{g.visitCount} visit{g.visitCount !== 1 ? 's' : ''}</span>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
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
                          {guestHint.isVip && <span className="text-[10px] font-semibold text-amber-400">VIP</span>}
                        </div>
                        <button type="button" onClick={() => setHintDismissed(true)} className="text-iron-muted hover:text-iron-text text-base leading-none px-0.5">×</button>
                      </div>
                      <div className="text-[11px] text-iron-muted space-y-0.5">
                        <div>
                          {guestHint.visitCount} visit{guestHint.visitCount !== 1 ? 's' : ''}
                          {guestHint.noShowCount > 0 && <span className="text-orange-400"> · {guestHint.noShowCount} no-show{guestHint.noShowCount !== 1 ? 's' : ''}</span>}
                          {guestHint.lastVisitAt && <span> · last {new Date(guestHint.lastVisitAt).toLocaleDateString()}</span>}
                        </div>
                        {guestHint.allergies.length > 0 && <div className="text-red-400">⚠ {guestHint.allergies.join(', ')}</div>}
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
                    max={30}
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
                              ? 'bg-indigo-500/25 border-indigo-400/60 text-indigo-300'
                              : 'border-iron-border text-iron-muted hover:border-indigo-400/50 hover:text-indigo-300'
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
                <div>
                  <Label>{T.createDrawer.fieldDate}</Label>
                  <Input
                    type="date"
                    value={resDate}
                    onChange={e => {
                      const d = e.target.value;
                      setResDate(d);
                      onDateTimeChange?.(d, resTime);
                    }}
                    required
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

                {/* Picking on map banner */}
                {pickingOnMap && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                    <span className="text-blue-300 text-xs flex-1">{T.createDrawer.tablePickingOnMap}</span>
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
                {!pickingOnMap && suggestBusy && (
                  <div className="flex items-center gap-2 py-2 text-iron-muted">
                    <div className="w-3 h-3 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
                    <span className="text-xs">{T.createDrawer.tableSearching}</span>
                  </div>
                )}

                {/* Auto-selected, no override, picker hidden */}
                {!pickingOnMap && !suggestBusy && autoResult && !manualOverride && !showPicker && (
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
                      onClick={() => { setShowPicker(true); setManualOverride(true); }}
                      className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors shrink-0"
                    >
                      {T.createDrawer.tableChangeBtn}
                    </button>
                    {onPickTables && (
                      <button
                        type="button"
                        onClick={openMapPicker}
                        className="text-xs px-2.5 py-2 rounded-lg border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors shrink-0"
                      >
                        {T.createDrawer.tableSelectOnMap}
                      </button>
                    )}
                  </div>
                )}

                {/* Manual override selected, picker hidden */}
                {!pickingOnMap && !suggestBusy && manualOverride && !showPicker && (() => {
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
                        onClick={() => setShowPicker(true)}
                        className="text-xs px-2.5 py-2 rounded-lg border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors shrink-0"
                      >
                        {T.createDrawer.tableChangeBtn}
                      </button>
                      {onPickTables && (
                        <button
                          type="button"
                          onClick={openMapPicker}
                          className="text-xs px-2.5 py-2 rounded-lg border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors shrink-0"
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
                {!pickingOnMap && !suggestBusy && !autoResult && !manualOverride && !showPicker && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-amber-500/20">
                    <span className="text-amber-400 text-xs flex-1">{T.createDrawer.tableNoAvailable}</span>
                    <button
                      type="button"
                      onClick={() => { setShowPicker(true); setManualOverride(true); }}
                      className="text-xs px-2 py-1 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors shrink-0"
                    >
                      {T.createDrawer.tableShowAll}
                    </button>
                    {onPickTables && (
                      <button
                        type="button"
                        onClick={openMapPicker}
                        className="text-xs px-2 py-1 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors shrink-0"
                      >
                        {T.createDrawer.tableSelectOnMap}
                      </button>
                    )}
                  </div>
                )}

                {/* Override picker — floor map (falls back to grid when no positions) */}
                {showPicker && (
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
                          className="text-xs text-iron-muted hover:text-red-400 transition-colors"
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
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-amber-500/25">
                    <span className="text-amber-400 shrink-0 mt-0.5">⚠</span>
                    <p className="text-amber-400 text-xs">{T.createDrawer.tableCapacityWarn(totalMax, resParty)}</p>
                  </div>
                );
              })()}

              {error && (
                <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </form>

            {/* ── Sticky confirm footer ── */}
            <div className="p-3 border-t border-iron-border shrink-0">
              {phoneWarning ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-900/10 p-3 space-y-2.5">
                  <div>
                    <p className="text-amber-400 text-xs font-semibold">{T.createDrawer.phoneWarnTitle}</p>
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
                      onClick={() => { setPhoneWarning(false); doSubmitReservation(); }}
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
                  disabled={busy || (suggestBusy && !resTable)}
                  className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-3 rounded-lg text-sm transition-colors"
                >
                  {confirmLabel()}
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
                        {wiGuestHint.isVip && <span className="text-[10px] font-semibold text-amber-400">VIP</span>}
                      </div>
                      <button type="button" onClick={() => setWiHintDismissed(true)} className="text-iron-muted hover:text-iron-text text-base leading-none px-0.5">×</button>
                    </div>
                    <div className="text-[11px] text-iron-muted space-y-0.5">
                      <div>
                        {wiGuestHint.visitCount} visit{wiGuestHint.visitCount !== 1 ? 's' : ''}
                        {wiGuestHint.noShowCount > 0 && <span className="text-orange-400"> · {wiGuestHint.noShowCount} no-show{wiGuestHint.noShowCount !== 1 ? 's' : ''}</span>}
                        {wiGuestHint.lastVisitAt && <span> · last {new Date(wiGuestHint.lastVisitAt).toLocaleDateString()}</span>}
                      </div>
                      {wiGuestHint.allergies.length > 0 && <div className="text-red-400">⚠ {wiGuestHint.allergies.join(', ')}</div>}
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
                  max={30}
                  value={wiParty}
                  onChange={e => setWiParty(parseInt(e.target.value, 10) || 1)}
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

            <TableGrid
              tables={tables}
              value={wiTable}
              onChange={setWiTable}
              label={T.createDrawer.fieldWalkInTable}
            />

            <p className="text-iron-muted text-xs border border-iron-border rounded-lg px-3 py-2">
              {wiTable
                ? T.createDrawer.walkInTableSelected(tables.find(t => t.id === wiTable)?.name ?? '')
                : T.createDrawer.walkInNoTable}
            </p>

            {error && (
              <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="space-y-2">
              {phoneWarning ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-900/10 p-3 space-y-2.5">
                  <div>
                    <p className="text-amber-400 text-xs font-semibold">{T.createDrawer.phoneWarnTitle}</p>
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
                      onClick={() => { setPhoneWarning(false); doSubmitWalkIn(pendingSeat); }}
                      className="flex-1 text-xs py-2 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
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

      {wiReorganize && (
        <ReorganizeConflictModal
          key={wiReorganize._key}
          conflicts={wiReorganize.conflicts}
          busy={wiReorganize.busy}
          onCancel={() => setWiReorganize(null)}
          onConfirm={async (selectedIds) => {
            const { reservationId, tableId } = wiReorganize;
            setWiReorganize(prev => prev ? { ...prev, busy: true } : null);
            try {
              const seated = await api.reservations.seat(reservationId, tableId, true, [], selectedIds);
              setWiReorganize(null);
              onCreated(seated);
            } catch (err: unknown) {
              setWiReorganize(null);
              setError(err instanceof Error ? err.message : 'Failed to seat walk-in');
            }
          }}
        />
      )}
    </>
  );
}
