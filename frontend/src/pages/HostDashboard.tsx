import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AuthState, FloorInsight, FloorObjectData, FloorTable, Reservation, Table, WaitlistEntry } from '../types';
import type { Theme } from '../App';
import { useT } from '../i18n/useT';
import { api } from '../api';
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

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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
  const liveModeRef = useRef(true);

  const [floorTables,  setFloorTables]  = useState<FloorTable[]>([]);
  const [floorObjs,    setFloorObjs]    = useState<FloorObjectData[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [insights,     setInsights]     = useState<FloorInsight[]>([]);
  const [allTables,    setAllTables]    = useState<Table[]>([]);
  const [selectedRes,       setSelectedRes]       = useState<Reservation | null>(null);
  const [highlightId,       setHighlightId]       = useState<string | null>(null);
  const [resLoading,        setResLoading]        = useState(false);
  const [loadError,         setLoadError]         = useState(false);
  const [errorPhase,        setErrorPhase]        = useState<'none' | 'reconnecting' | 'failed'>('none');
  const [toasts,            setToasts]            = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const [waitlist,            setWaitlist]            = useState<WaitlistEntry[]>([]);
  const [waitlistLoading,     setWaitlistLoading]     = useState(false);
  const [waitlistRefreshKey,  setWaitlistRefreshKey]  = useState(0);

  // null = closed, 'reservation' | 'walkin' = open in that mode
  const [activePage,           setActivePage]           = useState<'dashboard' | 'guests'>('dashboard');
  const [layoutMode,           setLayoutMode]           = useState(false);
  const [createMode,           setCreateMode]           = useState<CreateMode | null>(null);
  const [preselectedTableId,   setPreselectedTableId]   = useState<string | null>(null);
  const [lockTarget,           setLockTarget]           = useState<FloorTable | null>(null);
  const [gapHint,              setGapHint]              = useState<GapHint | null>(null);

  const showToast = useCallback((text: string, type: ToastMessage['type'] = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Fetch floor + reservations together whenever date, time, or refreshKey change
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setResLoading(true);
      const [floorResult, resResult, insightResult] = await Promise.allSettled([
        api.tables.floor(date, time),
        api.reservations.list({ date, limit: '500' }),
        api.tables.insights(date, time),
      ]);
      if (cancelled) return;
      const floorOk = floorResult.status === 'fulfilled';
      const resOk   = resResult.status   === 'fulfilled';
      if (floorOk) { setFloorTables(floorResult.value); setLoadError(false); }
      if (resOk)   setReservations(resResult.value.data);
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

  // Static table list for seat/move/create pickers
  useEffect(() => {
    api.tables.list().then(setAllTables).catch(() => {});
  }, []);

  // Operational timestamp: dashboard date + time as a local-time ms value.
  // Used instead of Date.now() for wait-time and ETA calculations so that
  // manually-selected times and midnight-crossing service days work correctly.
  const operationalNow = useMemo(() => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, m]     = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, m).getTime();
  }, [date, time]);

  // Waitlist — refresh on date, time, main refresh, or dedicated 30s waitlist key
  useEffect(() => {
    let cancelled = false;
    setWaitlistLoading(true);
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
      setTime(nowTime());
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

  const handleUpdated = useCallback((updated: Reservation) => {
    setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setSelectedRes(updated);
    api.tables.floor(date, time).then(setFloorTables).catch(() => {});
    api.tables.insights(date, time).then(setInsights).catch(() => {});
    setWaitlistRefreshKey(k => k + 1);
  }, [date, time]);

  const handleInsightAction = useCallback(async (tableId: string, reservationId: string) => {
    try {
      const updated = await api.reservations.seat(reservationId, tableId);
      handleUpdated(updated);
      setInsights(prev => prev.filter(i => i.tableId !== tableId && i.reservationId !== reservationId));
      const tableName = floorTables.find(t => t.id === tableId)?.name ?? 'table';
      showToast(T.guestDrawer.toastSeated(tableName));
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
    }
  }, [handleUpdated, floorTables, showToast]);

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

  const handleAvailableClick = useCallback((table: FloorTable) => {
    setPreselectedTableId(table.id);
    setCreateMode('walkin');
  }, []);

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
      try { await api.reservations.seat(res.id, res.tableId); setRefreshKey(k => k + 1); }
      catch { setSelectedRes(res); }
      return;
    }
    if (action === 'move') { setSelectedRes(res); return; }
    if (action === 'cancel') {
      try { await api.reservations.cancel(res.id); setRefreshKey(k => k + 1); }
      catch { /* ignore */ }
    }
  }, []);

  const handleTableLocked = useCallback((updated: Table) => {
    setFloorTables(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
    setAllTables(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
    setLockTarget(null);
    showToast(T.guestDrawer.toastLocked(updated.name));
  }, [showToast]);

  const handleTableLockChange = useCallback(() => {
    api.tables.floor(date, time).then(setFloorTables).catch(() => {});
    api.tables.list().then(setAllTables).catch(() => {});
  }, [date, time]);

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
  }, [reservations, time]);

  // Backend insights + frontend arrival insights, deduped by reservationId
  const allInsights = useMemo((): FloorInsight[] => {
    const backendResIds = new Set(insights.map(i => i.reservationId).filter(Boolean));
    const extra = arrivalInsights.filter(i => i.reservationId && !backendResIds.has(i.reservationId));
    return [...insights, ...extra];
  }, [insights, arrivalInsights]);

  const handleWaitlistAdd = useCallback(async (data: { guestName: string; partySize: number; guestPhone?: string }) => {
    const entry = await api.waitlist.add({ ...data, date });
    setWaitlist(prev => [...prev, entry]);
  }, [date]);

  const handleWaitlistSeat = useCallback(async (entry: WaitlistEntry) => {
    try {
      const { reservation } = await api.waitlist.seat(entry.id);
      setReservations(prev => [...prev, reservation]);
      setRefreshKey(k => k + 1);
      setWaitlist(prev => prev.filter(e => e.id !== entry.id));
      setWaitlistRefreshKey(k => k + 1);
      setSelectedRes(reservation);
      setHighlightId(reservation.id);
      setTimeout(() => setHighlightId(null), 2000);
      showToast(T.hostDashboard.toastSeated);
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
    }
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

  const handleSuggestionSeat = useCallback(async (tableId: string, entry: WaitlistEntry) => {
    try {
      const { reservation } = await api.waitlist.seat(entry.id, tableId);
      setReservations(prev => [...prev, reservation]);
      setRefreshKey(k => k + 1);
      setWaitlist(prev => prev.filter(e => e.id !== entry.id));
      setWaitlistRefreshKey(k => k + 1);
      setSelectedRes(reservation);
      setHighlightId(reservation.id);
      setTimeout(() => setHighlightId(null), 2000);
      const tableName = floorTables.find(t => t.id === tableId)?.name ?? 'table';
      showToast(T.hostDashboard.toastSeatAt(entry.guestName, tableName));
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
    }
  }, [floorTables, showToast]);

  // Called after a reservation is created — refresh everything and open it in the drawer
  const handleCreated = useCallback((created: Reservation) => {
    setCreateMode(null);
    setPreselectedTableId(null);
    setReservations(prev => [...prev, created]);
    setRefreshKey(k => k + 1);
    setSelectedRes(created);
    setHighlightId(created.id);
    showToast(created.status === 'SEATED' ? T.hostDashboard.toastSeated : T.hostDashboard.toastCreated);
    setTimeout(() => setHighlightId(null), 2000);
  }, [showToast]);

  const handleDateChange = useCallback((d: string) => {
    setDate(d);
    setSelectedRes(null);
    setLiveMode(false);
  }, []);

  const handleTimeChange = useCallback((t: string) => {
    setTime(t);
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
    setDate(d => shiftDate(d, -1));
    setSelectedRes(null);
    setLiveMode(false);
  }, []);

  const handleNextDay = useCallback(() => {
    setDate(d => shiftDate(d, 1));
    setSelectedRes(null);
    setLiveMode(false);
  }, []);

  const handlePrev15 = useCallback(() => {
    const { date: nd, time: nt } = shiftTime(date, time, -15);
    if (nd !== date) setDate(nd);
    setTime(nt);
    setLiveMode(false);
  }, [date, time]);

  const handleNext15 = useCallback(() => {
    const { date: nd, time: nt } = shiftTime(date, time, +15);
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
        onPrev15={handlePrev15}
        onNext15={handleNext15}
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
      <div className="flex items-center justify-end px-4 py-1.5 border-b border-iron-border bg-iron-card/30 shrink-0">
        <button
          onClick={() => setLayoutMode(true)}
          className="text-xs text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded px-2.5 py-1 transition-colors"
        >
          {T.hostDashboard.editLayout}
        </button>
      </div>

      <ActionBar insights={allInsights} onItemClick={handleActionBarClick} />

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
          waitlistMatches={waitlistMatches}
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
        />

        <ReservationPanel
          reservations={reservations}
          selectedId={selectedRes?.id ?? null}
          highlightId={highlightId}
          onSelect={setSelectedRes}
          loading={resLoading}
          onNewReservation={() => setCreateMode('reservation')}
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
        />
      </div>

      {selectedRes && !createMode && (
        <GuestDrawer
          reservation={selectedRes}
          tables={allTables}
          onClose={() => setSelectedRes(null)}
          onUpdated={handleUpdated}
          onSuccess={showToast}
          onTableLockChange={handleTableLockChange}
          nowTime={time}
        />
      )}

      {createMode && (
        <CreateDrawer
          initialMode={createMode}
          defaultDate={date}
          defaultTime={time}
          tables={allTables}
          preselectedTableId={preselectedTableId ?? undefined}
          gapHint={gapHint ?? undefined}
          onClose={() => { setCreateMode(null); setPreselectedTableId(null); setGapHint(null); }}
          onCreated={handleCreated}
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
    </div>
  );
}
