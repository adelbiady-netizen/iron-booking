import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AuthState, BackendTableSuggestion, FloorInsight, FloorObjectData, FloorTable, Reservation, Table, WaitlistEntry } from '../types';
import type { Theme } from '../App';
import { useT } from '../i18n/useT';
import { api, ApiError } from '../api';
import ReorganizeConflictModal, { type ReorganizeConflict } from '../components/ReorganizeConflictModal';
import { arrivalState, minutesUntilRes } from '../utils/arrival';
import { getTopSuggestions, type TableSuggestion } from '../utils/seating';
import { computePressure, prioritizeQueue, buildSoftHolds, type PressureInfo, type PriorityEntry } from '../utils/flowControl';
import TopBar from '../components/TopBar';
import FloorBoard from '../components/FloorBoard';
import ReservationPanel from '../components/ReservationPanel';
import GuestDrawer from '../components/GuestDrawer';
import CreateDrawer from '../components/CreateDrawer';
import ToastContainer, { type ToastMessage } from '../components/Toast';
import ActionBar from '../components/ActionBar';
import LayoutEditor from '../components/LayoutEditor';
import LockTableModal from '../components/LockTableModal';
import GuestsPage from './GuestsPage';
import { useServerEvents } from '../hooks/useServerEvents';
import CallDrawer from '../components/CallDrawer';
import { DrawerErrorBoundary, BoardErrorBoundary } from '../components/ErrorBoundary';

type CreateMode = 'reservation' | 'walkin';

interface GapHint {
  tableId: string;
  tableName: string;
  startTime: string;
  endTime: string;
  durationMins: number;
  minCovers: number;
  maxCovers: number;
}

// ─── Waitlist match scoring ───────────────────────────────────────────────────
// Returns a score for pairing a waitlist entry with an available table.
// Higher = better fit. Factors:
//   +50 perfect size (party within min–max covers)
//   +30 acceptable size (party ≤ maxCovers but below minCovers)
//   up to +40 for short ETA (40 − estimatedWaitMin, floored at 0)
//   up to +20 for time in queue (1 pt/min, capped at 20)
function scoreWaitlistMatch(entry: WaitlistEntry, table: FloorTable, operationalNow: number): number {
  let score = 0;
  if (entry.partySize >= table.minCovers && entry.partySize <= table.maxCovers) {
    score += 50;
  } else if (entry.partySize <= table.maxCovers) {
    score += 30;
  }
  const eta = entry.estimatedWaitMin ?? 60;
  score += Math.max(0, 40 - eta);
  const waitedMins = (operationalNow - new Date(entry.addedAt).getTime()) / 60000;
  score += Math.min(20, Math.round(Math.max(0, waitedMins)));
  return score;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function snapTo30(totalMinutes: number): string {
  const snapped = Math.round(totalMinutes / 30) * 30;
  const h = Math.floor(snapped / 60) % 24;
  const m = snapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nowTime() {
  const d = new Date();
  return snapTo30(d.getHours() * 60 + d.getMinutes());
}

function snapTimeStr(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  return snapTo30(h * 60 + m);
}

// Fallback used when restaurant settings don't specify an openingHour.
const SERVICE_START_FALLBACK = '11:30';

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function shiftTime(dateStr: string, timeStr: string, minutes: number): { date: string; time: string } {
  const [h, m] = timeStr.split(':').map(Number);
  let total = h * 60 + m + minutes;
  let newDate = dateStr;
  if (total < 0) { newDate = shiftDate(dateStr, -1); total += 24 * 60; }
  else if (total >= 24 * 60) { newDate = shiftDate(dateStr, 1); total -= 24 * 60; }
  return {
    date: newDate,
    time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
  };
}

interface Props {
  auth: AuthState;
  onLogout: () => void;
  zoom: number;
  zoomStep: number;
  onZoomChange: (v: number) => void;
  theme: Theme;
  onThemeChange: () => void;
  onAdminPortal?: () => void;
}

export default function HostDashboard({ auth, onLogout, zoom, zoomStep, onZoomChange, theme, onThemeChange, onAdminPortal }: Props) {
  const T = useT();
  const [date, setDate]             = useState(todayStr);
  const [time, setTime]             = useState(nowTime);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveMode, setLiveMode]     = useState(true);
  const liveModeRef    = useRef(true);
  // Tracks the last date for which data successfully loaded.
  // Empty string on mount so the very first load always shows the full spinner.
  // Stays equal to `date` on background polls so the list stays visible.
  const loadedDateRef  = useRef<string>('');

  const [floorTables,  setFloorTables]  = useState<FloorTable[]>([]);
  const [floorObjs,    setFloorObjs]    = useState<FloorObjectData[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [insights,     setInsights]     = useState<FloorInsight[]>([]);
  const [allTables,    setAllTables]    = useState<Table[]>([]);
  const [selectedRes,       setSelectedRes]       = useState<Reservation | null>(null);
  const [highlightId,       setHighlightId]       = useState<string | null>(null);
  const reorganizeKeyRef = useRef(0);
  const [reorganizeConflict, setReorganizeConflict] = useState<{
    conflicts: ReorganizeConflict[];
    pendingReservationId: string;
    pendingTableId: string;
    pendingCombinedIds: string[];
    tableName: string;
    busy: boolean;
    _key: number;
  } | null>(null);
  const [resLoading,        setResLoading]        = useState(false);
  const [loadError,         setLoadError]         = useState(false);
  const [errorPhase,        setErrorPhase]        = useState<'none' | 'reconnecting' | 'failed'>('none');
  const [toasts,            setToasts]            = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const [waitlist,            setWaitlist]            = useState<WaitlistEntry[]>([]);
  const [waitlistLoading,     setWaitlistLoading]     = useState(false);
  const [waitlistRefreshKey,  setWaitlistRefreshKey]  = useState(0);

  // null = closed, 'reservation' | 'walkin' = open in that mode
  const [activePage,                  setActivePage]                  = useState<'dashboard' | 'guests'>('dashboard');
  const [layoutMode,                  setLayoutMode]                  = useState(false);
  const [createMode,                  setCreateMode]                  = useState<CreateMode | null>(null);
  const [preselectedTableId,          setPreselectedTableId]          = useState<string | null>(null);
  const [preselectedCombinedTableIds, setPreselectedCombinedTableIds] = useState<string[]>([]);
  const [lockTarget,                  setLockTarget]                  = useState<FloorTable | null>(null);
  const [gapHint,                     setGapHint]                     = useState<GapHint | null>(null);
  // Combine-tables mode: host taps multiple available tables before creating a combined reservation
  const [combineMode,       setCombineMode]       = useState(false);
  const [combinedSelection, setCombinedSelection] = useState<string[]>([]);
  const [incomingCall,         setIncomingCall]         = useState<{ phone: string; createdAt: string } | null>(null);
  const [callNotification,     setCallNotification]     = useState<{ phone: string; createdAt: string } | null>(null);
  const [callHighlight,        setCallHighlight]        = useState(false);
  const [callPrefillPhone,     setCallPrefillPhone]     = useState('');
  const lastCallRef            = useRef<{ phone: string; at: number } | null>(null);
  const callHighlightTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Waitlist manual table assignment — two-step flow: select table then confirm seat
  const [waitlistAssignEntry,   setWaitlistAssignEntry]   = useState<WaitlistEntry | null>(null);
  const [waitlistAssignTableId, setWaitlistAssignTableId] = useState<string | null>(null);

  // Floor-map table pick mode — triggered by CreateDrawer or GuestDrawer
  const [tablePickMode,        setTablePickMode]        = useState(false);
  const [tablePickIds,         setTablePickIds]         = useState<string[]>([]);
  const [tablePickSuggestions, setTablePickSuggestions] = useState<BackendTableSuggestion[]>([]);
  const [tablePickAction,      setTablePickAction]      = useState<'seat' | 'move' | 'change-table' | undefined>(undefined);
  const [tablePickGuestName,   setTablePickGuestName]   = useState<string | undefined>(undefined);
  const tablePickCallbackRef   = useRef<((ids: string[] | null) => void) | null>(null);

  useServerEvents({
    incoming_call: (data) => {
      const d = data as { phone: string; createdAt: string };
      const now = Date.now();

      // 1. Deduplication — same phone within 10 s
      if (lastCallRef.current?.phone === d.phone && now - lastCallRef.current.at < 10_000) return;
      lastCallRef.current = { phone: d.phone, at: now };

      // 2. Drawer already open — update content + visual ping, no interruption
      if (incomingCall) {
        setIncomingCall(d);
        if (callHighlightTimer.current) clearTimeout(callHighlightTimer.current);
        setCallHighlight(true);
        callHighlightTimer.current = setTimeout(() => setCallHighlight(false), 1200);
        return;
      }

      // 3. User is actively typing — show small badge instead of opening drawer
      const el  = document.activeElement;
      const tag = el?.tagName.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
        || !!(el as HTMLElement | null)?.isContentEditable;

      if (typing) {
        setCallNotification(d);
      } else {
        setIncomingCall(d);
      }
    },
    // Push-triggered refresh: when any device mutates a reservation the backend
    // emits floor_updated over SSE. Trigger the same refresh key that the 60-second
    // poll uses so the floor board + reservation list update immediately.
    floor_updated: () => {
      setRefreshKey(k => k + 1);
      setWaitlistRefreshKey(k => k + 1);
    },
  });

  const showToast = useCallback((text: string, type: ToastMessage['type'] = 'success', action?: ToastMessage['action']) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type, action }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Fetch floor + reservations together whenever date, time, or refreshKey change.
  // Stale-while-revalidate: only show the full loading spinner on initial page
  // load or when the user navigates to a different date. Background polls
  // (refreshKey / time ticks) update data silently so the list never flickers.
  useEffect(() => {
    let cancelled = false;
    const isBackground = loadedDateRef.current === date;

    async function load() {
      if (!isBackground) setResLoading(true);
      const [floorResult, resResult, insightResult] = await Promise.allSettled([
        api.tables.floor(date, time),
        api.reservations.list({ date, limit: '500' }),
        api.tables.insights(date, time),
      ]);
      if (cancelled) return;
      const floorOk = floorResult.status === 'fulfilled';
      const resOk   = resResult.status   === 'fulfilled';
      if (floorOk) {
        const ft = floorResult.value;
        const ids = ft.map((t: FloorTable) => t.id);
        const dupeIds = ids.filter((id: string, i: number, a: string[]) => a.indexOf(id) !== i);
        if (dupeIds.length > 0) {
          console.error('[HostDashboard] API returned duplicate table IDs:', dupeIds, 'total:', ids.length, 'unique:', new Set(ids).size);
        } else {
          console.log('[HostDashboard] floor refresh ok — tables:', ids.length, 'date:', date, 'time:', time, 'key:', refreshKey);
        }
        setFloorTables(ft);
        setLoadError(false);
      }
      if (resOk) {
        setReservations(resResult.value.data);
        loadedDateRef.current = date;
      }
      if (insightResult.status === 'fulfilled') setInsights(insightResult.value);
      // Both critical calls failed — backend is likely unreachable
      if (!floorOk && !resOk) setLoadError(true);
      setResLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [date, time, refreshKey]);

  // Floor objects — static layout data, refresh when layout is saved
  useEffect(() => {
    api.tables.listFloorObjects().then(setFloorObjs).catch(() => {});
  }, [refreshKey]);

  // Static table list for seat/move/create pickers — refresh on layout saves
  useEffect(() => {
    api.tables.list().then(setAllTables).catch(() => {});
  }, [refreshKey]);

  // Operational timestamp: dashboard date + time as a local-time ms value.
  // Used instead of Date.now() for wait-time and ETA calculations so that
  // manually-selected times and midnight-crossing service days work correctly.
  const operationalNow = useMemo(() => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, m]     = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, m).getTime();
  }, [date, time]);

  // True only when the selected date is calendar-today (live service mode).
  // On future dates the board is in schedule/planning mode — live-clock
  // countdowns, overdue indicators, and arrival alerts must be suppressed.
  const isToday = date === todayStr();

  // Waitlist — refresh on date, time, main refresh, or dedicated 30s waitlist key.
  // Same stale-while-revalidate pattern: spinner only on date change or first load.
  useEffect(() => {
    let cancelled = false;
    const isBackground = loadedDateRef.current === date;
    if (!isBackground) setWaitlistLoading(true);
    api.waitlist.list(date, time)
      .then(data => { if (!cancelled) setWaitlist(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWaitlistLoading(false); });
    return () => { cancelled = true; };
  }, [date, time, refreshKey, waitlistRefreshKey]);

  // Keep ref in sync so interval callbacks can read liveMode without stale closure
  useEffect(() => { liveModeRef.current = liveMode; }, [liveMode]);

  // Auto-refresh floor every 60s, waitlist every 30s — only when in live mode
  useEffect(() => {
    const floorId = setInterval(() => {
      if (!liveModeRef.current) return;
      setTime(nowTime()); // nowTime() already snaps to nearest 30-min boundary
      setRefreshKey(k => k + 1);
    }, 60_000);
    const waitlistId = setInterval(() => {
      if (!liveModeRef.current) return;
      setWaitlistRefreshKey(k => k + 1);
    }, 30_000);
    return () => { clearInterval(floorId); clearInterval(waitlistId); };
  }, []);

  // Reconnect strategy: when both critical API calls fail, retry every 2.5s
  // and restore the dashboard automatically when the backend responds.
  // After 35s of continuous failure, escalate to a harder failure message.
  useEffect(() => {
    if (!loadError) {
      setErrorPhase('none');
      return;
    }
    setErrorPhase('reconnecting');
    const retryId    = setInterval(() => setRefreshKey(k => k + 1), 2500);
    const escalateId = setTimeout(() => setErrorPhase('failed'), 35_000);
    return () => { clearInterval(retryId); clearTimeout(escalateId); };
  }, [loadError]);

  const handleSelect = useCallback((r: Reservation) => {
    const enriched = reservations.find(x => x.id === r.id) ?? r;
    setSelectedRes(enriched);
  }, [reservations]);

  const handlePanelSelect = useCallback((r: Reservation) => {
    const enriched = reservations.find(x => x.id === r.id) ?? r;
    setSelectedRes(enriched);
    const [h, m] = r.time.split(':').map(Number);
    setTime(snapTo30(h * 60 + m));
    setLiveMode(false);
  }, [reservations]);

  const handleUpdated = useCallback((updated: Reservation) => {
    setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setSelectedRes(updated);
    setRefreshKey(k => k + 1);
    setWaitlistRefreshKey(k => k + 1);
  }, []);

  const handleInsightAction = useCallback(async (tableId: string, reservationId: string) => {
    const combinedTableIds = reservations.find(r => r.id === reservationId)?.combinedTableIds ?? [];
    try {
      const updated = await api.reservations.seat(reservationId, tableId, false, combinedTableIds);
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      setRefreshKey(k => k + 1);
      setInsights(prev => prev.filter(i => i.tableId !== tableId && i.reservationId !== reservationId));
      const tableName = floorTables.find(t => t.id === tableId)?.name ?? tableId;
      showToast(T.hostDashboard.toastQuickSeated(tableName), 'success', {
        label: T.hostDashboard.quickSeatUndo,
        onClick: () => {
          api.reservations.undo(updated.id)
            .then(reverted => {
              setReservations(prev => prev.map(r => r.id === reverted.id ? { ...r, ...reverted } : r));
              setRefreshKey(k => k + 1);
              showToast(T.hostDashboard.toastQuickUndone);
            })
            .catch(() => showToast(T.hostDashboard.toastUndoFail, 'error'));
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const det = err.details as { code?: string; conflicts?: ReorganizeConflict[] } | null;
        if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
          const tName = floorTables.find(t => t.id === tableId)?.name ?? tableId;
          setReorganizeConflict({
            conflicts: det.conflicts,
            pendingReservationId: reservationId,
            pendingTableId: tableId,
            pendingCombinedIds: combinedTableIds,
            tableName: tName,
            busy: false,
            _key: ++reorganizeKeyRef.current,
          });
          return;
        }
      }
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
    }
  }, [floorTables, reservations, showToast]);

  const handleActionBarClick = useCallback((insight: FloorInsight) => {
    if (insight.type === 'SEAT_NOW' && insight.reservationId) {
      handleInsightAction(insight.tableId, insight.reservationId);
    } else if (
      (insight.type === 'LATE_GUEST' || insight.type === 'LATE' ||
       insight.type === 'NO_SHOW_RISK' || insight.type === 'DUE_NOW' ||
       insight.type === 'ARRIVING_SOON') && insight.reservationId
    ) {
      const res = reservations.find(r => r.id === insight.reservationId);
      if (res) setSelectedRes(res);
    } else if (insight.type === 'ENDING_SOON') {
      const ft = floorTables.find(t => t.id === insight.tableId);
      const res = ft?.currentReservation as Reservation | null | undefined;
      if (res) setSelectedRes(res);
    }
  }, [handleInsightAction, reservations, floorTables]);

  const handleContextMenuSeat = useCallback(async (res: Reservation) => {
    if (!res.tableId) {
      showToast(T.hostDashboard.toastNoTable, 'error');
      return;
    }
    await handleInsightAction(res.tableId, res.id);
  }, [handleInsightAction, showToast]);

  const handleAvailableClick = useCallback((table: FloorTable) => {
    setPreselectedTableId(table.id);
    setCreateMode('reservation');
  }, []);

  const handleCombineToggle = useCallback((tableId: string) => {
    setCombinedSelection(prev =>
      prev.includes(tableId) ? prev.filter(id => id !== tableId) : [...prev, tableId]
    );
  }, []);

  const handleCombineCreate = useCallback(() => {
    if (combinedSelection.length === 0) return;
    setPreselectedTableId(combinedSelection[0]);
    setPreselectedCombinedTableIds(combinedSelection.slice(1));
    setCreateMode('reservation');
    setCombineMode(false);
    setCombinedSelection([]);
  }, [combinedSelection]);

  const handleLockTable = useCallback((table: FloorTable) => {
    setLockTarget(table);
  }, []);

  const handleUnlockTable = useCallback(async (tableId: string) => {
    try {
      const updated = await api.tables.unlock(tableId);
      setFloorTables(prev => prev.map(t => t.id === tableId ? { ...t, ...updated } : t));
      setAllTables(prev => prev.map(t => t.id === tableId ? { ...t, ...updated } : t));
      showToast(T.hostDashboard.toastUnlocked);
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastUnlockFail, 'error');
    }
  }, [showToast]);

  const handleGapClick = useCallback((tableId: string, startTime: string, endTime: string) => {
    const table = allTables.find(t => t.id === tableId);
    if (table) {
      const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const s = toMins(startTime), e = toMins(endTime);
      const durationMins = (e >= s ? e - s : e + 1440 - s);
      setGapHint({ tableId, tableName: table.name, startTime, endTime, durationMins, minCovers: table.minCovers, maxCovers: table.maxCovers });
    }
    setCreateMode('reservation');
  }, [allTables]);

  const handleGapWaitlistSeat = useCallback(async (tableId: string, entry: WaitlistEntry, startTime: string, endTime: string) => {
    if (date > new Date().toISOString().slice(0, 10)) {
      showToast(T.waitlistPanel.seatFutureDisabled, 'error');
      return;
    }
    const toServiceMins = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const mins = h * 60 + m;
      return mins < 360 ? mins + 1440 : mins;
    };
    const gapStart     = toServiceMins(startTime);
    const gapEnd       = toServiceMins(endTime);
    const durationMins = gapEnd >= gapStart ? gapEnd - gapStart : gapEnd + 1440 - gapStart;

    // Pre-flight: check for overlapping active reservations on this table
    const hasConflict = reservations.some(r => {
      if (r.tableId !== tableId) return false;
      if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(r.status)) return false;
      const rStart = toServiceMins(r.time);
      const rEnd   = rStart + r.duration;
      return rStart < gapStart + durationMins && rEnd > gapStart;
    });

    if (hasConflict) {
      const table = allTables.find(t => t.id === tableId);
      if (table) setGapHint({ tableId, tableName: table.name, startTime, endTime, durationMins, minCovers: table.minCovers, maxCovers: table.maxCovers });
      setCreateMode('reservation');
      showToast('Slot conflict — please review before booking', 'error');
      return;
    }

    try {
      let r = await api.reservations.create({
        guestName:  entry.guestName,
        partySize:  entry.partySize,
        date,
        time:       startTime,
        duration:   durationMins,
        source:     'WALK_IN',
        guestPhone: entry.guestPhone ?? undefined,
        tableId,
      });
      if (r.status === 'PENDING') r = await api.reservations.confirm(r.id);
      setReservations(prev => [...prev, r]);
      setRefreshKey(k => k + 1);
      setSelectedRes(r);
      setHighlightId(r.id);
      setTimeout(() => setHighlightId(null), 2000);
      await api.waitlist.remove(entry.id, 'REMOVED');
      setWaitlist(prev => prev.filter(e => e.id !== entry.id));
      const tableName = floorTables.find(t => t.id === tableId)?.name ?? 'table';
      showToast(T.hostDashboard.toastSeatAt(entry.guestName, tableName));
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
    }
  }, [date, floorTables, reservations, allTables, showToast]);

  const handleTimelineQuickAction = useCallback(async (action: 'seat' | 'move' | 'cancel', res: Reservation) => {
    if (action === 'seat') {
      if (!res.tableId) { setSelectedRes(res); return; }
      try { await handleInsightAction(res.tableId, res.id); }
      catch { setSelectedRes(res); }
      return;
    }
    if (action === 'move') { setSelectedRes(res); return; }
    if (action === 'cancel') {
      try { await api.reservations.cancel(res.id); setRefreshKey(k => k + 1); }
      catch { /* ignore */ }
    }
  }, [handleInsightAction]);

  const handleTableLocked = useCallback((updated: Table) => {
    setFloorTables(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
    setAllTables(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
    setLockTarget(null);
    showToast(T.guestDrawer.toastLocked(updated.name));
  }, [showToast]);

  const handleTableLockChange = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // Match each available non-locked table to the highest-scoring waitlist guest
  const waitlistMatches = useMemo(() => {
    const active = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED');
    if (active.length === 0) return {};
    const matches: Record<string, WaitlistEntry> = {};
    for (const table of floorTables) {
      if (table.liveStatus !== 'AVAILABLE' || table.locked) continue;
      const candidates = active.filter(e => e.partySize <= table.maxCovers);
      if (candidates.length === 0) continue;
      const best = candidates.reduce((a, b) =>
        scoreWaitlistMatch(a, table, operationalNow) >= scoreWaitlistMatch(b, table, operationalNow) ? a : b
      );
      matches[table.id] = best;
    }
    return matches;
  }, [floorTables, waitlist, operationalNow]);

  // Deduped list: each guest appears once with their best table.
  // Sorted: ready now (ETA 0) first, then shortest ETA, then longest wait.
  const nextInLine = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ entry: WaitlistEntry; tableId: string; tableName: string }> = [];
    for (const [tableId, entry] of Object.entries(waitlistMatches)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const table = floorTables.find(t => t.id === tableId);
      if (!table) continue;
      result.push({ entry, tableId, tableName: table.name });
    }
    return result.sort((a, b) => {
      const aEta = a.entry.estimatedWaitMin ?? Infinity;
      const bEta = b.entry.estimatedWaitMin ?? Infinity;
      if (aEta !== bEta) return aEta - bEta;
      return new Date(a.entry.addedAt).getTime() - new Date(b.entry.addedAt).getTime();
    });
  }, [waitlistMatches, floorTables]);

  // Smart seat: top table suggestions per active waitlist entry.
  // Runs whenever floorTables or operationalNow change; separate from nextInLine
  // so it doesn't trigger a re-score on every minute tick unnecessarily.
  const entrySuggestions = useMemo<Map<string, TableSuggestion[]>>(() => {
    const active = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED');
    const map = new Map<string, TableSuggestion[]>();
    for (const entry of active) {
      const sugs = getTopSuggestions(entry, floorTables, operationalNow);
      if (sugs.length > 0) map.set(entry.id, sugs);
    }
    return map;
  }, [waitlist, floorTables, operationalNow]);

  // Priority-sorted waitlist queue with urgency + best suggestion per entry
  const priorityQueue = useMemo<PriorityEntry[]>(() =>
    prioritizeQueue(waitlist, entrySuggestions, operationalNow),
  [waitlist, entrySuggestions, operationalNow]);

  // Soft holds: immediately-free tables reserved "mentally" for top-priority guests
  const softHoldMap = useMemo<Record<string, WaitlistEntry>>(() =>
    buildSoftHolds(priorityQueue),
  [priorityQueue]);

  // Best table to glow on FloorBoard: top suggestion for priority #1 guest
  const bestSuggestionTableId = useMemo<string | null>(() =>
    priorityQueue[0]?.bestSuggestion?.tableId ?? null,
  [priorityQueue]);

  // Service pressure: how busy the next 30m looks
  const pressureInfo = useMemo<PressureInfo>(() =>
    computePressure(floorTables, reservations, time, operationalNow),
  [floorTables, reservations, time, operationalNow]);

  // Arrival-based insights for CONFIRMED late/at-risk guests (frontend-computed,
  // uses operational time, covers both assigned and unassigned reservations).
  const arrivalInsights = useMemo((): FloorInsight[] => {
    if (!isToday) return [];
    return reservations
      .filter(r => r.status === 'CONFIRMED')
      .flatMap(r => {
        const state = arrivalState(r.time, r.status, time);
        if (state !== 'LATE' && state !== 'NO_SHOW_RISK') return [];
        const minsLate = Math.abs(minutesUntilRes(r.time, time));
        return [{
          type: state as FloorInsight['type'],
          priority: 'HIGH' as const,
          tableId: r.tableId ?? 'unassigned',
          reservationId: r.id,
          message: state === 'NO_SHOW_RISK'
            ? T.arrival.insightNoShow(r.guestName, minsLate)
            : T.arrival.insightLate(r.guestName, minsLate),
        }];
      })
      .sort((a, b) => {
        // Most-late first
        const aId = reservations.find(r => r.id === a.reservationId);
        const bId = reservations.find(r => r.id === b.reservationId);
        const aMins = aId ? Math.abs(minutesUntilRes(aId.time, time)) : 0;
        const bMins = bId ? Math.abs(minutesUntilRes(bId.time, time)) : 0;
        return bMins - aMins;
      });
  }, [reservations, time, T, isToday]);

  // Backend insights + frontend arrival insights, deduped by reservationId.
  // Backend messages are English-hardcoded, so we re-derive them from raw data using T.
  const allInsights = useMemo((): FloorInsight[] => {
    const backendResIds = new Set(insights.map(i => i.reservationId).filter(Boolean));
    const extra = arrivalInsights.filter(i => i.reservationId && !backendResIds.has(i.reservationId));

    const translated = insights.map((insight): FloorInsight => {
      if (insight.type === 'LATE_GUEST' && insight.reservationId) {
        const res = reservations.find(r => r.id === insight.reservationId);
        if (res) {
          const mins = Math.abs(minutesUntilRes(res.time, time));
          return { ...insight, message: T.arrival.insightLate(res.guestName, mins) };
        }
      }
      if (insight.type === 'ENDING_SOON') {
        const table = floorTables.find(t => t.id === insight.tableId);
        if (table?.currentReservation) {
          const mr = Math.round((new Date(table.currentReservation.expectedEndTime).getTime() - operationalNow) / 60_000);
          return { ...insight, message: mr > 0 ? `${table.name} · ${T.tableCard.endsIn(mr)}` : `${table.name} · ${T.tableCard.overBy(Math.abs(mr))}` };
        }
      }
      if (insight.type === 'SEAT_NOW' && insight.reservation) {
        const [rH, rM] = insight.reservation.time.split(':').map(Number);
        const [nH, nM] = time.split(':').map(Number);
        const diff = rH * 60 + rM - (nH * 60 + nM);
        const table = floorTables.find(t => t.id === insight.tableId);
        if (diff < 0) return { ...insight, message: `${insight.reservation.guestName} · ${T.arrival.lateMin(Math.abs(diff))}` };
        if (table)    return { ...insight, message: `${insight.reservation.guestName} → ${table.name}` };
      }
      return insight;
    });

    return [...translated, ...extra];
  }, [insights, arrivalInsights, reservations, floorTables, time, T]);

  const handleWaitlistAdd = useCallback(async (data: { guestName: string; partySize: number; guestPhone?: string }) => {
    const entry = await api.waitlist.add({ ...data, date });
    setWaitlist(prev => [...prev, entry]);
  }, [date]);

  const handleWaitlistSeat = useCallback((entry: WaitlistEntry) => {
    if (entry.date.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
      showToast(T.waitlistPanel.seatFutureDisabled, 'error');
      return;
    }
    // Enter table assignment mode — host must select a table on the map before seating
    setWaitlistAssignEntry(entry);
    setWaitlistAssignTableId(null);
  }, [showToast]);

  const handleWaitlistCancel = useCallback(async (entry: WaitlistEntry) => {
    try {
      await api.waitlist.remove(entry.id, 'REMOVED');
      setWaitlist(prev => prev.filter(e => e.id !== entry.id));
      setWaitlistRefreshKey(k => k + 1);
      showToast(T.hostDashboard.toastWLRemoved);
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastWLRemoveFail, 'error');
    }
  }, [showToast]);

  const handleWaitlistNotify = useCallback(async (entry: WaitlistEntry) => {
    try {
      const updated = await api.waitlist.notify(entry.id);
      setWaitlist(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e));
      showToast(T.hostDashboard.toastNotified(entry.guestName));
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastNotifyFail, 'error');
    }
  }, [showToast]);

  const handleWaitlistNoShow = useCallback(async (entry: WaitlistEntry) => {
    try {
      await api.waitlist.remove(entry.id, 'LEFT');
      setWaitlist(prev => prev.filter(e => e.id !== entry.id));
      setWaitlistRefreshKey(k => k + 1);
      showToast(T.hostDashboard.toastNoShow);
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastNoShowFail, 'error');
    }
  }, [showToast]);

  const handleSuggestionSeat = useCallback((tableId: string, entry: WaitlistEntry) => {
    if (entry.date.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
      showToast(T.waitlistPanel.seatFutureDisabled, 'error');
      return;
    }
    // Pre-select table from suggestion — host can change or confirm on the map
    setWaitlistAssignEntry(entry);
    setWaitlistAssignTableId(tableId);
  }, [showToast]);

  const handleWaitlistTablePick = useCallback((tableId: string) => {
    setWaitlistAssignTableId(prev => (prev === tableId ? null : tableId));
  }, []);

  const handleWaitlistAssignCancel = useCallback(() => {
    setWaitlistAssignEntry(null);
    setWaitlistAssignTableId(null);
  }, []);

  const handleWaitlistConfirmSeat = useCallback(async () => {
    if (!waitlistAssignEntry) return;
    const entry   = waitlistAssignEntry;
    const tableId = waitlistAssignTableId ?? undefined;
    setWaitlistAssignEntry(null);
    setWaitlistAssignTableId(null);
    try {
      const { reservation } = await api.waitlist.seat(entry.id, tableId);
      setReservations(prev => [...prev, reservation]);
      setRefreshKey(k => k + 1);
      setWaitlist(prev => prev.filter(e => e.id !== entry.id));
      setWaitlistRefreshKey(k => k + 1);
      setSelectedRes(reservation);
      setHighlightId(reservation.id);
      setTimeout(() => setHighlightId(null), 2000);
      const tableName = tableId ? (floorTables.find(t => t.id === tableId)?.name ?? 'table') : '';
      showToast(tableName ? T.hostDashboard.toastSeatAt(entry.guestName, tableName) : T.hostDashboard.toastSeated);
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
    }
  }, [waitlistAssignEntry, waitlistAssignTableId, floorTables, showToast]);

  // Bidirectional date sync: called by CreateDrawer and GuestDrawer (edit mode)
  // whenever the host changes the reservation date or time inside the drawer.
  // Keeps the floor board and the open drawer on the same calendar day so
  // availability shown in the form always matches what the board is rendering.
  const handleDrawerDateTimeChange = useCallback((d: string, t: string) => {
    setDate(d);
    setTime(t);
    setLiveMode(false);
  }, []);

  const handlePickTables = useCallback((currentIds: string[], suggestions: BackendTableSuggestion[], callback: (ids: string[] | null) => void, action?: 'seat' | 'move' | 'change-table', guestName?: string) => {
    tablePickCallbackRef.current = callback;
    setTablePickIds(currentIds);
    setTablePickSuggestions(suggestions);
    setTablePickAction(action);
    setTablePickGuestName(guestName);
    setTablePickMode(true);
  }, []);

  const handlePickDone = useCallback((ids: string[]) => {
    tablePickCallbackRef.current?.(ids);
    tablePickCallbackRef.current = null;
    setTablePickMode(false);
    setTablePickAction(undefined);
    setTablePickGuestName(undefined);
  }, []);

  const handlePickCancel = useCallback(() => {
    tablePickCallbackRef.current?.(null);
    tablePickCallbackRef.current = null;
    setTablePickMode(false);
    setTablePickAction(undefined);
    setTablePickGuestName(undefined);
  }, []);

  // Called after a reservation is created — refresh everything and open it in the drawer
  const handleCreated = useCallback((created: Reservation) => {
    setCreateMode(null);
    setPreselectedTableId(null);
    setPreselectedCombinedTableIds([]);
    setReservations(prev => [...prev, created]);
    setRefreshKey(k => k + 1);
    setSelectedRes(created);
    setHighlightId(created.id);
    showToast(created.status === 'SEATED' ? T.hostDashboard.toastSeated : T.hostDashboard.toastCreated);
    setTimeout(() => setHighlightId(null), 2000);
  }, [showToast]);

  const operatingHours = auth.user.restaurant?.operatingHours;

  function serviceStartForDate(dateStr: string): string {
    if (operatingHours?.length) {
      const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
      const h = operatingHours.find(h => h.dayOfWeek === dow);
      if (h?.isOpen) return snapTimeStr(h.openTime);
    }
    return snapTimeStr(
      auth.user.restaurant?.settings?.openingHour ?? SERVICE_START_FALLBACK
    );
  }

  const handleDateChange = useCallback((d: string) => {
    if (!d) return; // ignore transient empty values from date picker
    setDate(d);
    setTime(serviceStartForDate(d));
    setSelectedRes(null);
    setLiveMode(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatingHours]);

  const handleTimeChange = useCallback((t: string) => {
    setTime(snapTimeStr(t));
    setLiveMode(false);
  }, []);

  const handleNow = useCallback(() => {
    setDate(todayStr());
    setTime(nowTime());
    setSelectedRes(null);
    setLiveMode(true);
    setRefreshKey(k => k + 1);
  }, []);

  const handlePrevDay = useCallback(() => {
    setDate(d => {
      const next = shiftDate(d, -1);
      setTime(serviceStartForDate(next));
      return next;
    });
    setSelectedRes(null);
    setLiveMode(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatingHours]);

  const handleNextDay = useCallback(() => {
    setDate(d => {
      const next = shiftDate(d, 1);
      setTime(serviceStartForDate(next));
      return next;
    });
    setSelectedRes(null);
    setLiveMode(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatingHours]);

  const handlePrev30 = useCallback(() => {
    const { date: nd, time: nt } = shiftTime(date, time, -30);
    if (nd !== date) setDate(nd);
    setTime(nt);
    setLiveMode(false);
  }, [date, time]);

  const handleNext30 = useCallback(() => {
    const { date: nd, time: nt } = shiftTime(date, time, +30);
    if (nd !== date) setDate(nd);
    setTime(nt);
    setLiveMode(false);
  }, [date, time]);

  const handleGuestsPage = useCallback(() => {
    setSelectedRes(null);
    setCreateMode(null);
    setActivePage('guests');
  }, []);

  if (activePage === 'guests') {
    return (
      <>
        <GuestsPage onBack={() => setActivePage('dashboard')} />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  if (layoutMode) {
    return (
      <LayoutEditor
        onClose={() => setLayoutMode(false)}
        onSaved={() => { setLayoutMode(false); setRefreshKey(k => k + 1); }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-iron-bg overflow-hidden">
      <TopBar
        date={date}
        time={time}
        onDateChange={handleDateChange}
        onTimeChange={handleTimeChange}
        onPrevDay={handlePrevDay}
        onNextDay={handleNextDay}
        onPrev30={handlePrev30}
        onNext30={handleNext30}
        onNow={handleNow}
        isLive={liveMode}
        restaurantName={auth.user.restaurant?.name ?? ''}
        userName={`${auth.user.firstName} ${auth.user.lastName}`}
        onLogout={onLogout}
        zoom={zoom}
        zoomStep={zoomStep}
        onZoomChange={onZoomChange}
        theme={theme}
        onThemeChange={onThemeChange}
        onAdminPortal={onAdminPortal}
        onGuestsPage={handleGuestsPage}
      />

      {/* Secondary toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-iron-border bg-iron-card/30 shrink-0">
        <button
          onClick={() => {
            if (combineMode) {
              setCombineMode(false);
              setCombinedSelection([]);
            } else {
              setSelectedRes(null);
              setCreateMode(null);
              setCombineMode(true);
            }
          }}
          className={`text-xs border rounded px-2.5 py-1 transition-colors ${
            combineMode
              ? 'bg-blue-600/20 border-blue-500/50 text-blue-400 hover:bg-blue-600/30'
              : 'text-iron-muted hover:text-iron-text border-iron-border hover:border-iron-text/30'
          }`}
        >
          {combineMode ? T.hostDashboard.cancelCombine : T.hostDashboard.combineTables}
        </button>
        <button
          onClick={() => setLayoutMode(true)}
          className="text-xs text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded px-2.5 py-1 transition-colors"
        >
          {T.hostDashboard.editLayout}
        </button>
      </div>

      <ActionBar insights={allInsights} onItemClick={handleActionBarClick} />

      <BoardErrorBoundary>
      <div className="flex-1 flex overflow-hidden">
        <FloorBoard
          tables={floorTables}
          floorObjs={floorObjs}
          selectedId={selectedRes?.id ?? null}
          onSelect={handleSelect}
          onAvailableClick={handleAvailableClick}
          insights={allInsights}
          onInsightAction={handleInsightAction}
          loadError={loadError}
          errorPhase={errorPhase}
          onLockTable={handleLockTable}
          onUnlockTable={handleUnlockTable}
          onWaitlistSuggestion={handleSuggestionSeat}
          bestSuggestionTableId={bestSuggestionTableId}
          softHoldMap={softHoldMap}
          pressureInfo={pressureInfo}
          nowTime={time}
          operationalNow={operationalNow}
          reservations={reservations}
          date={date}
          waitlist={waitlist}
          onGapClick={handleGapClick}
          onGapWaitlistSeat={handleGapWaitlistSeat}
          onQuickAction={handleTimelineQuickAction}
          combineMode={combineMode}
          combinedSelection={combinedSelection}
          onCombineToggle={handleCombineToggle}
          onCombineCreate={handleCombineCreate}
          pickMode={tablePickMode}
          pickIds={tablePickIds}
          pickSuggestions={tablePickSuggestions}
          onPickDone={handlePickDone}
          onPickCancel={handlePickCancel}
          pickAction={tablePickAction}
          pickGuestName={tablePickGuestName}
          waitlistAssignEntry={waitlistAssignEntry}
          waitlistAssignTableId={waitlistAssignTableId}
          onWaitlistTablePick={handleWaitlistTablePick}
          onWaitlistAssignCancel={handleWaitlistAssignCancel}
          onWaitlistConfirmSeat={handleWaitlistConfirmSeat}
        />

        <ReservationPanel
          reservations={reservations}
          selectedId={selectedRes?.id ?? null}
          highlightId={highlightId}
          onSelect={handlePanelSelect}
          loading={resLoading}
          onNewReservation={() => { setPreselectedTableId(null); setCreateMode('reservation'); }}
          onWalkIn={() => setCreateMode('walkin')}
          waitlist={waitlist}
          waitlistLoading={waitlistLoading}
          onWaitlistAdd={handleWaitlistAdd}
          onWaitlistSeat={handleWaitlistSeat}
          onWaitlistNotify={handleWaitlistNotify}
          onWaitlistCancel={handleWaitlistCancel}
          onWaitlistNoShow={handleWaitlistNoShow}
          nextInLine={nextInLine}
          onSeatAtTable={handleSuggestionSeat}
          entrySuggestions={entrySuggestions}
          priorityQueue={priorityQueue}
          nowTime={time}
          operationalNow={operationalNow}
          onContextMenuSeat={handleContextMenuSeat}
          date={date}
          reorganizeQueue={reservations.filter(r => r.reorganizeAt != null && ['CONFIRMED', 'PENDING'].includes(r.status))}
          onReorganizeSelect={r => setSelectedRes(r)}
          allTables={allTables}
        />
      </div>
      </BoardErrorBoundary>

      {selectedRes && !createMode && (
        <DrawerErrorBoundary key={selectedRes.id} onClose={() => setSelectedRes(null)}>
          <GuestDrawer
            reservation={selectedRes}
            tables={allTables}
            allReservations={reservations}
            onClose={() => setSelectedRes(null)}
            onUpdated={handleUpdated}
            onSuccess={showToast}
            onTableLockChange={handleTableLockChange}
            nowTime={time}
            onPickTables={handlePickTables}
            onPickTablesCancel={handlePickCancel}
            onDateTimeChange={handleDrawerDateTimeChange}
          />
        </DrawerErrorBoundary>
      )}

      {createMode && (
        <DrawerErrorBoundary key={`create-${createMode}`} onClose={() => { setCreateMode(null); setPreselectedTableId(null); setPreselectedCombinedTableIds([]); setGapHint(null); setCallPrefillPhone(''); }}>
          <CreateDrawer
            initialMode={createMode}
            defaultDate={date}
            defaultTime={time}
            tables={allTables}
            floorObjs={floorObjs}
            preselectedTableId={preselectedTableId ?? undefined}
            preselectedCombinedTableIds={preselectedCombinedTableIds.length > 0 ? preselectedCombinedTableIds : undefined}
            gapHint={gapHint ?? undefined}
            initialData={callPrefillPhone ? { guestPhone: callPrefillPhone } : undefined}
            onClose={() => { setCreateMode(null); setPreselectedTableId(null); setPreselectedCombinedTableIds([]); setGapHint(null); setCallPrefillPhone(''); }}
            onCreated={handleCreated}
            onPickTables={handlePickTables}
            onPickTablesCancel={handlePickCancel}
            onDateTimeChange={handleDrawerDateTimeChange}
          />
        </DrawerErrorBoundary>
      )}

      {/* Typing-guard notification badge */}
      {callNotification && !incomingCall && (
        <button
          onClick={() => { setIncomingCall(callNotification); setCallNotification(null); }}
          className="fixed bottom-16 right-4 z-50 flex items-center gap-2.5 bg-iron-elevated border border-iron-green/50 text-iron-green-light text-sm font-semibold pl-3 pr-4 py-2.5 rounded-full shadow-2xl animate-toast"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iron-green opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-iron-green" />
          </span>
          <span>📞 {callNotification.phone || T.callDrawer.unknownCaller}</span>
        </button>
      )}

      {incomingCall && (
        <CallDrawer
          phone={incomingCall.phone}
          createdAt={incomingCall.createdAt}
          highlight={callHighlight}
          onNewReservation={(phone) => {
            setCallPrefillPhone(phone);
            setCreateMode('reservation');
            setIncomingCall(null);
          }}
          onOpenReservation={(resId) => {
            const res = reservations.find(r => r.id === resId);
            if (res) setSelectedRes(res);
            setIncomingCall(null);
          }}
          onClose={() => setIncomingCall(null)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {lockTarget && (
        <LockTableModal
          table={lockTarget}
          onClose={() => setLockTarget(null)}
          onLocked={handleTableLocked}
        />
      )}

      {reorganizeConflict && (
        <ReorganizeConflictModal
          key={reorganizeConflict._key}
          conflicts={reorganizeConflict.conflicts}
          busy={reorganizeConflict.busy}
          onCancel={() => setReorganizeConflict(null)}
          onConfirm={async (selectedIds) => {
            const { pendingReservationId, pendingTableId, pendingCombinedIds, tableName } = reorganizeConflict;
            setReorganizeConflict(prev => prev ? { ...prev, busy: true } : null);
            try {
              const updated = await api.reservations.seat(pendingReservationId, pendingTableId, true, pendingCombinedIds, selectedIds);
              setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
              setRefreshKey(k => k + 1);
              setInsights(prev => prev.filter(i => i.tableId !== pendingTableId && i.reservationId !== pendingReservationId));
              setReorganizeConflict(null);
              showToast(T.hostDashboard.toastQuickSeated(tableName), 'success');
            } catch (err) {
              setReorganizeConflict(null);
              showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
            }
          }}
        />
      )}

    </div>
  );
}
