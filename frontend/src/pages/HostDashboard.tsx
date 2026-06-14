import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { AuthState, BackendTableSuggestion, CallLogItem, FloorInsight, FloorObjectData, FloorTable, Reservation, Table, TableFirstGuest, WaitlistEntry } from '../types';
import type { Theme } from '../App';
import { useT } from '../i18n/useT';
import { api, ApiError } from '../api';
import ReorganizeConflictModal, { type ReorganizeConflict } from '../components/ReorganizeConflictModal';
import { arrivalState, minutesUntilRes, isLiveServiceView, isFloorReleased, arrivedFifoSort } from '../utils/arrival';
import { optimisticExpectedEnd } from '../utils/time';
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
import IntelligencePage from './IntelligencePage';
import ClubCenterPage from './ClubCenterPage';
import HostsSettingsPage from './HostsSettingsPage';
import ActivityLogPage from './ActivityLogPage';
import { useServerEvents } from '../hooks/useServerEvents';
import CallDrawer from '../components/CallDrawer';
import IncomingCallCard from '../components/IncomingCallCard';
import { DrawerErrorBoundary, BoardErrorBoundary } from '../components/ErrorBoundary';
import ServiceReportPanel from '../components/ServiceReportPanel';
import BulkConfirmModal from '../components/BulkConfirmModal';
import TableQuickPanel from '../components/TableQuickPanel';
import CallLogPanel from '../components/CallLogPanel';
import SmartAssignModal from '../components/SmartAssignModal';

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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function snapTo30(totalMinutes: number): string {
  const snapped = Math.round(totalMinutes / 30) * 30;
  const h = Math.floor(snapped / 60) % 24;
  const m = snapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nowTime(): string {
  const d = new Date();
  const floored = Math.floor((d.getHours() * 60 + d.getMinutes()) / 30) * 30;
  const h = Math.floor(floored / 60) % 24;
  const m = floored % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  onSwitchHost?: () => void;
  zoom: number;
  zoomStep: number;
  onZoomChange: (v: number) => void;
  theme: Theme;
  onThemeChange: () => void;
  onAdminPortal?: () => void;
}

export default function HostDashboard({ auth, onLogout, onSwitchHost, zoom, zoomStep, onZoomChange, theme, onThemeChange, onAdminPortal }: Props) {
  const T = useT();
  const [date, setDate]             = useState(todayStr);
  const [time, setTime]             = useState(nowTime);
  const [refreshKey, setRefreshKey] = useState(0);
  // Separate key for floor-objects (static layout data). Only incremented on layout
  // save — never on reservation mutations, SSE events, or auto-refresh ticks.
  const [floorLayoutKey, setFloorLayoutKey] = useState(0);
  const [liveMode, setLiveMode]     = useState(true);
  const liveModeRef    = useRef(true);
  // In-flight guard — keyed by reservationId. Ref for synchronous guard checks;
  // state for UI layer (disables buttons on re-render).
  const inFlightRef = useRef(new Set<string>());
  const [inFlightIds, setInFlightIds] = useState<ReadonlySet<string>>(new Set());
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
  const [hoveredResId,      setHoveredResId]      = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reorganizeKeyRef = useRef(0);
  const optimisticSeatSnapshotRef = useRef<Map<string, { res: Reservation; floorTable: FloorTable | null; tableId: string }>>(new Map());
  const [reorganizeConflict, setReorganizeConflict] = useState<{
    conflicts: ReorganizeConflict[];
    pendingReservationId: string;
    pendingTableId: string;
    pendingCombinedIds: string[];
    tableName: string;
    busy: boolean;
    _key: number;
    pendingWaitlistEntry?: WaitlistEntry;
    pendingMoveResId?: string;
  } | null>(null);
  const [occupiedConflict, setOccupiedConflict] = useState<{
    occupiedBy: { id: string; guestName: string; time: string; partySize: number };
    resume: () => void;
  } | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    res: Reservation;
    sourceTableName: string;
    targetTableId: string;
    targetCombinedIds: string[];
    targetTableName: string;
    busy: boolean;
  } | null>(null);
  const [swapSource, setSwapSource] = useState<{ res: Reservation; tableName: string } | null>(null);
  const [pendingSwap, setPendingSwap] = useState<{
    resA: Reservation;
    tableNameA: string;
    resB: Reservation;
    tableNameB: string;
    busy: boolean;
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
  const [activePage,                  setActivePage]                  = useState<'dashboard' | 'guests' | 'hosts' | 'activity' | 'intelligence' | 'club'>('dashboard');
  const [layoutMode,                  setLayoutMode]                  = useState(false);
  const [createMode,                  setCreateMode]                  = useState<CreateMode | null>(null);
  const [preselectedTableId,          setPreselectedTableId]          = useState<string | null>(null);
  const [preselectedCombinedTableIds, setPreselectedCombinedTableIds] = useState<string[]>([]);
  const [lockTarget,                  setLockTarget]                  = useState<FloorTable | null>(null);
  const [gapHint,                     setGapHint]                     = useState<GapHint | null>(null);
  // Combine-tables mode: host taps multiple available tables before creating a combined reservation
  const [combineMode,       setCombineMode]       = useState(false);
  const [combinedSelection, setCombinedSelection] = useState<string[]>([]);
  const [incomingCall,         setIncomingCall]         = useState<{ phone: string; createdAt: string; callid?: string | null } | null>(null);
  const [callNotification,     setCallNotification]     = useState<{ phone: string; createdAt: string; callid?: string | null } | null>(null);
  const [callHighlight,        setCallHighlight]        = useState(false);
  const [callPrefillPhone,     setCallPrefillPhone]     = useState('');
  const lastCallRef            = useRef<{ phone: string; at: number; callid?: string | null; status?: string; dismissed?: boolean } | null>(null);
  const callHighlightTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Waitlist manual table assignment — two-step flow: select table then confirm seat
  const [waitlistAssignEntry,   setWaitlistAssignEntry]   = useState<WaitlistEntry | null>(null);
  const [waitlistAssignTableId, setWaitlistAssignTableId] = useState<string | null>(null);

  const [showServiceReport,   setShowServiceReport]   = useState(false);
  const [showBulkConfirm,    setShowBulkConfirm]    = useState(false);
  const [showCallLog,        setShowCallLog]        = useState(false);
  const [showMoreMenu,       setShowMoreMenu]       = useState(false);
  const [showBroadcast,      setShowBroadcast]      = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMoreMenu && !showBroadcast) return;
    const onDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
        setShowBroadcast(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showMoreMenu, showBroadcast]);
  const [broadcastMsg,       setBroadcastMsg]       = useState('');
  const [broadcastTarget,    setBroadcastTarget]    = useState<'all' | 'specific'>('all');
  const [broadcastSelIds,    setBroadcastSelIds]    = useState<string[]>([]);
  const [broadcastBusy,      setBroadcastBusy]      = useState(false);
  const [broadcastResult,    setBroadcastResult]    = useState<{ sent: number; total: number; errors: string[] } | null>(null);
  const [broadcastConfirming, setBroadcastConfirming] = useState(false);
  const [showSmartAssign,    setShowSmartAssign]    = useState(false);
  const [latestCall,         setLatestCall]         = useState<CallLogItem | null>(null);
  const [guestSearchPhone,   setGuestSearchPhone]   = useState('');
  const [panelCollapsed,     setPanelCollapsed]     = useState(false);

  // Compact table action panel — shown on floor map click before opening full GuestDrawer.
  // Stores IDs only so the panel always derives fresh data from the live reservations/floorTables
  // arrays, which means SSE updates automatically propagate without any manual sync.
  const [quickTable, setQuickTable] = useState<{ tableId: string; reservationId: string | null } | null>(null);

  // Management Reorganize Mode
  const [reorganizeMode, setReorganizeMode] = useState(false);
  const [rebuildDayTarget, setRebuildDayTarget] = useState<{ table: FloorTable; resv: Reservation[] } | null>(null);
  const [rebuildDayReason, setRebuildDayReason] = useState('');
  const [rebuildDayBusy, setRebuildDayBusy] = useState(false);
  const [selectedRebuildIds, setSelectedRebuildIds] = useState<string[]>([]);
  const rebuildSessionIdRef = useRef('');

  // Floor-map table pick mode — triggered by CreateDrawer or GuestDrawer
  const [tablePickMode,        setTablePickMode]        = useState(false);
  const [tablePickIds,         setTablePickIds]         = useState<string[]>([]);
  const [tablePickSuggestions, setTablePickSuggestions] = useState<BackendTableSuggestion[]>([]);
  const [tablePickAction,      setTablePickAction]      = useState<'seat' | 'move' | 'change-table' | undefined>(undefined);
  const [tablePickGuestName,   setTablePickGuestName]   = useState<string | undefined>(undefined);
  const [tablePickWalkIn,      setTablePickWalkIn]      = useState(false);
  const tablePickCallbackRef   = useRef<((ids: string[] | null) => void) | null>(null);

  const sseStatus = useServerEvents({
    incoming_call: (data) => {
      const raw = data as Record<string, unknown>;
      const d = data as {
        id?: string; phone: string; createdAt: string; callid?: string | null; status?: string;
        duration?: number | null; recordUrl?: string | null; group?: string | null;
        restaurantName?: string | null; routingStatus?: string | null;
        guestName?: string | null;
      };

      console.log('[call:sse] ① event received', {
        id: d.id, phone: d.phone, status: d.status,
        restaurantId: raw.restaurantId, createdAt: d.createdAt,
        routingStatus: d.routingStatus,
      });

      // Always update the call log panel with the freshest record from SSE.
      // The panel guards against duplicates by id.
      const callItem = {
        id:            d.id ?? `sse-${d.createdAt}`,
        phone:         d.phone,
        createdAt:     d.createdAt,
        status:        d.status ?? 'answered',
        duration:      d.duration ?? null,
        recordUrl:     d.recordUrl ?? null,
        group:         d.group ?? null,
        restaurantName: d.restaurantName ?? null,
        routingStatus: d.routingStatus ?? null,
        guestName:     d.guestName ?? null,
      };
      setLatestCall(callItem);
      console.log('[call:sse] ② setLatestCall dispatched', { id: callItem.id, panelOpen: showCallLog });

      const callid = d.callid ?? null;
      const now = Date.now();

      // 1. Callid-aware handling (when provider sends a call identifier)
      if (callid) {
        // Same callid, drawer already open → update (ring → answered lifecycle transition)
        if (incomingCall?.callid === callid) {
          setIncomingCall(d);
          if (callHighlightTimer.current) clearTimeout(callHighlightTimer.current);
          setCallHighlight(true);
          callHighlightTimer.current = setTimeout(() => setCallHighlight(false), 1200);
          lastCallRef.current = { phone: d.phone, at: now, callid, status: d.status };
          console.log('[call:sse] ③ same callid — drawer updated (ring→answered)');
          return;
        }
        // User already dismissed this call — suppress all subsequent lifecycle events
        if (lastCallRef.current?.callid === callid && lastCallRef.current.dismissed) {
          console.log('[call:sse] ③ dismissed callid — suppressed (ended/completed after close)');
          return;
        }
        // Duplicate event: same callid + same status (second ring from another extension)
        if (lastCallRef.current?.callid === callid && lastCallRef.current?.status === d.status) {
          console.log('[call:sse] ③ duplicate callid+status — suppressed');
          return;
        }
        // New call: update ref, fall through to open drawer
        lastCallRef.current = { phone: d.phone, at: now, callid, status: d.status };
      } else {
        // 2. Backward compat: no callid — phone+time dedup (answered-only webhooks)
        if (lastCallRef.current?.phone === d.phone && now - lastCallRef.current.at < 10_000) {
          console.log('[call:sse] ③ drawer dedup fired — same phone within 10s (no callid)');
          return;
        }
        lastCallRef.current = { phone: d.phone, at: now, callid: null, status: d.status };
        // Drawer already open → update content + visual ping, no interruption
        if (incomingCall) {
          setIncomingCall(d);
          if (callHighlightTimer.current) clearTimeout(callHighlightTimer.current);
          setCallHighlight(true);
          callHighlightTimer.current = setTimeout(() => setCallHighlight(false), 1200);
          console.log('[call:sse] ③ no callid, drawer already open — updated + ping');
          return;
        }
      }

      // 3. User is actively typing — show small badge instead of opening drawer
      const el  = document.activeElement;
      const tag = el?.tagName.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
        || !!(el as HTMLElement | null)?.isContentEditable;

      if (typing) {
        setCallNotification(d);
        console.log('[call:sse] ③ typing detected — badge shown');
      } else {
        setIncomingCall(d);
        console.log('[call:sse] ③ drawer opened', { status: d.status, callid });
      }
    },
    // Push-triggered refresh: when any device mutates a reservation the backend
    // emits floor_updated over SSE. Trigger the same refresh key that the 60-second
    // poll uses so the floor board + reservation list update immediately.
    floor_updated: () => {
      console.log('[perf:seat] SSE floor_updated → refreshKey++', new Date().toISOString());
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

  // Debounced hover: 50ms delay on set, immediate clear on null.
  // Prevents continuous HostDashboard + FloorBoard re-renders while the host
  // moves the cursor across the reservation list during live service.
  const handleHoverRow = useCallback((id: string | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (id === null) { setHoveredResId(null); return; }
    hoverTimerRef.current = setTimeout(() => setHoveredResId(id), 50);
  }, []);

  // Fetch floor + reservations together whenever date, time, or refreshKey change.
  // Stale-while-revalidate: only show the full loading spinner on initial page
  // load or when the user navigates to a different date. Background polls
  // (refreshKey / time ticks) update data silently so the list never flickers.
  useEffect(() => {
    let cancelled = false;
    const isBackground = loadedDateRef.current === date;

    async function load() {
      const t0 = performance.now();
      console.log('[perf:floor] load start', { date, time, refreshKey, isBackground });
      if (!isBackground) setResLoading(true);
      const [floorResult, resResult, insightResult] = await Promise.allSettled([
        api.tables.floor(date, time),
        api.reservations.list({ date, limit: '500' }),
        api.tables.insights(date, time),
      ]);
      console.log('[perf:floor] API responses received', Math.round(performance.now() - t0) + 'ms');
      if (cancelled) return;
      const floorOk = floorResult.status === 'fulfilled';
      const resOk   = resResult.status   === 'fulfilled';
      if (floorOk) {
        const ft = floorResult.value;
        const ids = ft.map((t: FloorTable) => t.id);
        const dupeIds = ids.filter((id: string, i: number, a: string[]) => a.indexOf(id) !== i);
        if (dupeIds.length > 0) {
          console.error('[HostDashboard] API returned duplicate table IDs:', dupeIds, 'total:', ids.length, 'unique:', new Set(ids).size);
        }
        setFloorTables(ft);
      }
      if (resOk) {
        const freshData = resResult.value.data as Reservation[];
        setReservations(freshData);
        setSelectedRes(prev => {
          if (!prev) return prev;
          return freshData.find(r => r.id === prev.id) ?? prev;
        });
        loadedDateRef.current = date;
      }
      if (insightResult.status === 'fulfilled') setInsights(insightResult.value);
      // Clear the error overlay if either critical API responded — partial recovery
      // is enough. Only lock out the UI when both are unreachable simultaneously.
      if (floorOk || resOk) setLoadError(false);
      else setLoadError(true);
      setResLoading(false);
      console.log('[perf:floor] state updated', Math.round(performance.now() - t0) + 'ms');
    }

    load();
    return () => { cancelled = true; };
  }, [date, time, refreshKey]);

  // Floor objects — static layout data. Loaded once on mount and after layout save.
  // Deliberately NOT on refreshKey so reservation mutations, SSE floor_updated events,
  // auto-refresh ticks, and error-retries do not refetch this never-changing data.
  useEffect(() => {
    api.tables.listFloorObjects().then(setFloorObjs).catch(() => {});
  }, [floorLayoutKey]);

  // Static table list for seat/move/create pickers — loaded once on mount.
  // Tables don't change during service; a full page reload picks up any admin changes.
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

  // True only when the board is in live-service view: liveMode is active AND
  // today's date AND board time is within ±90 min of the wall-clock.
  // liveMode is set to false by every manual time-navigation handler, so
  // advancing the clock forward (even within the ±90 min window) suppresses
  // arrival alerts rather than flooding the panel with false LATE/NO_SHOW badges.
  const isLiveView = liveMode && isLiveServiceView(date, time);

  // Derive live-synced objects from ID-based quickTable state.
  // Because these are computed from the live arrays they update automatically
  // when reservations or floorTables change (SSE push, API response, etc.).
  const quickFloorTable = useMemo(
    () => (quickTable ? floorTables.find(t => t.id === quickTable.tableId) ?? null : null),
    [quickTable, floorTables],
  );
  const quickRes = useMemo(
    () => (quickTable?.reservationId ? reservations.find(r => r.id === quickTable.reservationId) ?? null : null),
    [quickTable, reservations],
  );

  // Waitlist — refresh on date, time, main refresh, or dedicated 30s waitlist key.
  // Same stale-while-revalidate pattern: spinner only on date change or first load.
  useEffect(() => {
    let cancelled = false;
    const isBackground = loadedDateRef.current === date;
    if (!isBackground) setWaitlistLoading(true);
    console.log('[waitlist:fetch]', { date, todayStr: todayStr(), liveMode, url: `/waitlist?date=${date}&time=${time}` });
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
      setDate(todayStr());
      setTime(nowTime());
      setRefreshKey(k => k + 1);
    }, 60_000);
    const waitlistId = setInterval(() => {
      if (!liveModeRef.current) return;
      setWaitlistRefreshKey(k => k + 1);
    }, 30_000);
    return () => { clearInterval(floorId); clearInterval(waitlistId); };
  }, []);

  // Midnight date guard — independent of liveMode.
  // If the displayed date has fallen behind today (app open overnight with
  // liveMode off, or host forgot to click Now), roll it to today so the
  // waitlist never stays pinned to a past operational day.
  // Does NOT touch time or liveMode — future-date browsing is unaffected.
  useEffect(() => {
    const id = setInterval(() => {
      setDate(d => {
        const today = todayStr();
        return d < today ? today : d;
      });
    }, 60_000);
    return () => clearInterval(id);
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

  // When an unassigned PENDING/CONFIRMED reservation is active in GuestDrawer,
  // any floor-table click should assign that reservation to the clicked table
  // rather than opening the table's own panel or triggering the reorganize lift flow.
  const handleAssignActiveRes = useCallback(async (table: FloorTable) => {
    if (!selectedRes) return;
    const res = selectedRes;
    try {
      const updated = await api.reservations.update(res.id, { tableId: table.id, combinedTableIds: [] });
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      setSelectedRes(updated);
      showToast(T.guestDrawer.toastTableAssigned(table.name));
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
    }
  }, [selectedRes, showToast]);

  const isActiveUnassigned = useCallback((r: Reservation | null): r is Reservation => {
    return !!r && !r.tableId && ['PENDING', 'CONFIRMED'].includes(r.status);
  }, []);

  const handleSelect = useCallback((r: Reservation) => {
    const enriched = reservations.find(x => x.id === r.id) ?? r;
    // If an unassigned reservation is active in GuestDrawer, clicking any reserved
    // table assigns the active reservation there instead of switching focus.
    if (isActiveUnassigned(selectedRes) && enriched.tableId) {
      const clickedTable = floorTables.find(t => t.id === enriched.tableId);
      if (clickedTable) { handleAssignActiveRes(clickedTable); return; }
    }
    const floorTable = floorTables.find(t => t.id === enriched.tableId) ?? null;
    if (floorTable) {
      setSelectedRes(null);
      setQuickTable({ tableId: floorTable.id, reservationId: enriched.id });
    } else {
      setSelectedRes(enriched);
    }
  }, [reservations, floorTables, selectedRes, isActiveUnassigned, handleAssignActiveRes]);

  const handlePanelSelect = useCallback((r: Reservation) => {
    const enriched = reservations.find(x => x.id === r.id) ?? r;
    setQuickTable(null);
    setSelectedRes(enriched);
    // Sync board time when the host opens a reservation for inspection so the floor map
    // context matches the drawer. Includes SEATED so a live guest's table renders at the
    // correct time. Historical statuses (COMPLETED, CANCELLED, NO_SHOW) are excluded —
    // jumping to a past time during live service has no operational value.
    if (enriched.status === 'PENDING' || enriched.status === 'CONFIRMED' || enriched.status === 'SEATED') {
      const [h, m] = enriched.time.split(':').map(Number);
      setTime(snapTo30(h * 60 + m));
      setLiveMode(false);
    }
  }, [reservations]);

  const handleReorganizeSelect = useCallback((r: Reservation) => {
    setReorganizeMode(false);
    setRebuildDayTarget(null);
    setSelectedRes(r);
    const [h, m] = r.time.split(':').map(Number);
    setTime(snapTo30(h * 60 + m));
    setLiveMode(false);
  }, []);

  // Shared helper for any "open this reservation's details" action.
  // Applies the same board-time sync as handlePanelSelect so the floor map
  // always shows the correct time context when a drawer opens.
  // Live-alert paths (arrival notifications, ENDING_SOON) use setSelectedRes
  // directly and intentionally bypass this — they must not disrupt the live view.
  const openReservationDetails = useCallback((res: Reservation) => {
    setSelectedRes(res);
    if (res.status === 'PENDING' || res.status === 'CONFIRMED' || res.status === 'SEATED') {
      const [h, m] = res.time.split(':').map(Number);
      setTime(snapTo30(h * 60 + m));
      setLiveMode(false);
    }
  }, []);

  const handleUpdated = useCallback((updated: Reservation) => {
    optimisticSeatSnapshotRef.current.delete(updated.id);
    setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setQuickTable(null);
    setSelectedRes(updated);
    // Reconcile floor board with API-confirmed seat. Computes floor-specific fields
    // (minutesRemaining, expectedEndTime, isOverdue) using the same max(scheduledEnd,
    // seatedAt + minWindow) model as the backend. SSE still fires afterward as authoritative sync.
    if (updated.status === 'SEATED' && updated.tableId) {
      const now = Date.now();
      const seatedAtMs = updated.seatedAt ? new Date(updated.seatedAt).getTime() : now;
      const expectedEndTime = optimisticExpectedEnd(updated, seatedAtMs);
      const minutesRemaining = Math.round((new Date(expectedEndTime).getTime() - now) / 60_000);
      setFloorTables(prev => prev.map(t => {
        if (t.id !== updated.tableId) return t;
        return {
          ...t,
          liveStatus: 'OCCUPIED' as FloorTable['liveStatus'],
          currentReservation: {
            ...updated,
            minutesRemaining,
            expectedEndTime,
            isOverdue: minutesRemaining < 0,
            minutesOverdue: minutesRemaining < 0 ? -minutesRemaining : 0,
          },
          upcomingReservations: t.upcomingReservations.filter(r => r.id !== updated.id),
        };
      }));
      setInsights(prev => prev.filter(i => i.reservationId !== updated.id));
    }
  }, []);

  // Applies an optimistic seat to reservations + floorTables before the API responds.
  // Captures a rollback snapshot so handleOptimisticSeatRollback can restore exact prior state.
  // Combined tables are not patched here — SSE reconciles them as it does for context-menu seats.
  const handleOptimisticSeat = useCallback((seatRes: Reservation, tableId: string, _combinedIds: string[]) => {
    const now = Date.now();
    const seatedAt = new Date(now).toISOString();
    const expectedEndTime = optimisticExpectedEnd(seatRes, now);
    const minutesRemaining = Math.round((new Date(expectedEndTime).getTime() - now) / 60_000);

    let capturedFloorTable: FloorTable | null = null;
    setFloorTables(prev => prev.map(t => {
      if (t.id !== tableId) return t;
      capturedFloorTable = t;
      return {
        ...t,
        liveStatus: 'OCCUPIED' as FloorTable['liveStatus'],
        currentReservation: {
          ...seatRes, status: 'SEATED' as const, tableId, seatedAt,
          minutesRemaining, expectedEndTime, isOverdue: false, minutesOverdue: 0,
        },
        upcomingReservations: t.upcomingReservations.filter(r => r.id !== seatRes.id),
      };
    }));
    setReservations(prev => prev.map(r =>
      r.id === seatRes.id ? { ...r, status: 'SEATED' as const, tableId, seatedAt } : r
    ));
    optimisticSeatSnapshotRef.current.set(seatRes.id, {
      res: seatRes, floorTable: capturedFloorTable, tableId,
    });
  }, []);

  const handleOptimisticSeatRollback = useCallback((resId: string) => {
    const snapshot = optimisticSeatSnapshotRef.current.get(resId);
    if (!snapshot) return;
    optimisticSeatSnapshotRef.current.delete(resId);
    setReservations(prev => prev.map(r => r.id === resId ? snapshot.res : r));
    if (snapshot.floorTable) {
      const snap = snapshot.floorTable;
      setFloorTables(prev => prev.map(t => t.id === snapshot.tableId ? snap : t));
    }
  }, []);

  // Updates reservations in-place. No explicit refreshKey — SSE floor_updated fires for
  // every mutation and triggers the single authoritative floor refresh, matching the
  // already-correct handleUpdated (GuestDrawer) pattern. Double-refresh eliminated.
  const handleQuickPanelUpdated = useCallback((updated: Reservation) => {
    setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
  }, []);

  const handleInsightAction = useCallback(async (tableId: string, reservationId: string) => {
    if (inFlightRef.current.has(reservationId)) return;

    const res = reservations.find(r => r.id === reservationId);
    const combinedTableIds = res?.combinedTableIds ?? [];

    const resSnapshot = res; // stable pre-optimistic snapshot — res is const but named explicitly for the rollback below

    inFlightRef.current.add(reservationId);
    setInFlightIds(new Set(inFlightRef.current));

    // ── Optimistic update ────────────────────────────────────────────────────
    const now = Date.now();
    const seatedAt = new Date(now).toISOString();
    const expectedEndTime = res ? optimisticExpectedEnd(res, now) : seatedAt; // fallback unused (currentReservation kept as-is when res is null)
    let snapshotFloorTable: FloorTable | null = null;
    setReservations(prev => prev.map(r =>
      r.id === reservationId
        ? { ...r, status: 'SEATED' as const, tableId, seatedAt }
        : r
    ));
    setFloorTables(prev => prev.map(t => {
      if (t.id === tableId) {
        snapshotFloorTable = t;
        return {
          ...t,
          liveStatus: 'OCCUPIED' as FloorTable['liveStatus'],
          currentReservation: res ? {
            ...res, status: 'SEATED' as const, tableId, seatedAt,
            minutesRemaining: Math.round((new Date(expectedEndTime).getTime() - now) / 60_000), expectedEndTime, isOverdue: false, minutesOverdue: 0,
          } : t.currentReservation,
          upcomingReservations: t.upcomingReservations.filter(r => r.id !== reservationId),
        };
      }
      return t;
    }));
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const updated = await api.reservations.seat(reservationId, tableId, false, combinedTableIds);
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      setInsights(prev => prev.filter(i => i.tableId !== tableId && i.reservationId !== reservationId));
      const tableName = floorTables.find(t => t.id === tableId)?.name ?? tableId;
      const advisory = updated._advisory;
      const toastMsg = advisory?.shortWindow
        ? (advisory.minutesLate && advisory.minutesLate > 0
            ? T.hostDashboard.toastSeatLateAdvisory(advisory.minutesLate, advisory.minutesUntil)
            : advisory.minutesUntil > 0
              ? T.hostDashboard.toastSeatAdvisory(tableName, advisory.minutesUntil)
              : T.hostDashboard.toastQuickSeated(tableName))
        : T.hostDashboard.toastQuickSeated(tableName);
      showToast(toastMsg, 'success', {
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
      // ── Rollback ─────────────────────────────────────────────────────────
      if (resSnapshot) setReservations(prev => prev.map(r => r.id === reservationId ? resSnapshot : r));
      if (snapshotFloorTable) { const snap = snapshotFloorTable; setFloorTables(prev => prev.map(t => t.id === tableId ? snap : t)); }
      // ─────────────────────────────────────────────────────────────────────
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
    } finally {
      inFlightRef.current.delete(reservationId);
      setInFlightIds(new Set(inFlightRef.current));
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

  const handleAvailableClick = useCallback((table: FloorTable) => {
    if (isActiveUnassigned(selectedRes)) { handleAssignActiveRes(table); return; }
    setSelectedRes(null);
    setQuickTable({ tableId: table.id, reservationId: null });
  }, [selectedRes, isActiveUnassigned, handleAssignActiveRes]);

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

  const handleReorganizeTableClick = useCallback((table: FloorTable) => {
    // If an unassigned reservation is active in GuestDrawer, assign it to the
    // clicked table instead of triggering the floor-lift flow.
    if (isActiveUnassigned(selectedRes)) { handleAssignActiveRes(table); return; }
    const tableResv = reservations.filter(
      r => r.tableId === table.id && ['CONFIRMED', 'PENDING'].includes(r.status) && !r.reorganizeAt
    );
    setRebuildDayTarget({ table, resv: tableResv });
    setSelectedRebuildIds(tableResv.map(r => r.id));
    setRebuildDayReason('');
  }, [selectedRes, isActiveUnassigned, handleAssignActiveRes, reservations]);

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
      if (!res.tableId) { openReservationDetails(res); return; }
      try { await handleInsightAction(res.tableId, res.id); }
      catch { openReservationDetails(res); }
      return;
    }
    if (action === 'move') { openReservationDetails(res); return; }
    if (action === 'cancel') {
      try { await api.reservations.cancel(res.id); setRefreshKey(k => k + 1); }
      catch (err) { showToast(err instanceof Error ? err.message : T.hostDashboard.toastCancelFail, 'error'); }
    }
  }, [handleInsightAction, openReservationDetails, showToast]);

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
      if (reservations.some(r => r.tableId === table.id && r.status === 'SEATED')) continue;
      const candidates = active.filter(e => e.partySize <= table.maxCovers);
      if (candidates.length === 0) continue;
      const best = candidates.reduce((a, b) =>
        scoreWaitlistMatch(a, table, operationalNow) >= scoreWaitlistMatch(b, table, operationalNow) ? a : b
      );
      matches[table.id] = best;
    }
    return matches;
  }, [floorTables, waitlist, operationalNow, reservations]);

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

  // Guests eligible for table-first seating from the floor context menu.
  // Only populated on today's date; returns empty for future/past planning views.
  // Priority order: ARRIVED > CONFIRMED > PENDING > NOTIFIED waitlist > WAITING waitlist.
  const eligibleGuests = useMemo((): TableFirstGuest[] => {
    if (date !== todayStr()) return [];
    const today = date;
    const result: TableFirstGuest[] = [];

    // 1. Arrived guests (any sitable status) — highest priority, strict FIFO by arrivedAt
    reservations
      .filter(r => r.isArrived && !!r.arrivedAt && !r.tableId && (r.status === 'PENDING' || r.status === 'CONFIRMED'))
      .sort(arrivedFifoSort)
      .forEach(r => result.push({ kind: 'reservation', data: r }));

    // 2. Confirmed, not yet arrived
    reservations
      .filter(r => !r.isArrived && !r.tableId && r.status === 'CONFIRMED')
      .sort((a, b) => a.time.localeCompare(b.time))
      .forEach(r => result.push({ kind: 'reservation', data: r }));

    // 3. Pending, not yet arrived (host-created / unconfirmed bookings)
    reservations
      .filter(r => !r.isArrived && !r.tableId && r.status === 'PENDING')
      .sort((a, b) => a.time.localeCompare(b.time))
      .forEach(r => result.push({ kind: 'reservation', data: r }));

    // 4. Waitlist — notified first, then waiting
    waitlist
      .filter(e => e.status === 'NOTIFIED' && e.date.slice(0, 10) === today)
      .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime())
      .forEach(e => result.push({ kind: 'waitlist', data: e }));

    waitlist
      .filter(e => e.status === 'WAITING' && e.date.slice(0, 10) === today)
      .sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime())
      .forEach(e => result.push({ kind: 'waitlist', data: e }));

    return result;
  }, [date, reservations, waitlist]);

  // Smart seat: top table suggestions per active waitlist entry.
  // Runs whenever floorTables or operationalNow change; separate from nextInLine
  // so it doesn't trigger a re-score on every minute tick unnecessarily.
  const entrySuggestions = useMemo<Map<string, TableSuggestion[]>>(() => {
    const active = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED');
    const map = new Map<string, TableSuggestion[]>();
    for (const entry of active) {
      const sugs = getTopSuggestions(
        entry,
        floorTables.filter(t => !reservations.some(r => r.tableId === t.id && r.status === 'SEATED')),
        operationalNow
      );
      if (sugs.length > 0) map.set(entry.id, sugs);
    }
    return map;
  }, [waitlist, floorTables, operationalNow, reservations]);

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

  // Section pressure: is any named section disproportionately loaded?
  const sectionSignal = useMemo<string | null>(() => {
    if (!isLiveView) return null;
    const bySection = new Map<string, { name: string; tables: FloorTable[] }>();
    for (const t of floorTables) {
      if (!t.section || !t.isActive || t.liveStatus === 'BLOCKED') continue;
      const k = t.section.id;
      if (!bySection.has(k)) bySection.set(k, { name: t.section.name, tables: [] });
      bySection.get(k)!.tables.push(t);
    }
    let bestMsg: string | null = null;
    let bestScore = 0;
    for (const { name, tables } of bySection.values()) {
      if (tables.length < 2) continue;
      const committed = tables.filter(t => t.liveStatus === 'OCCUPIED' || t.liveStatus === 'RESERVED_SOON').length;
      const overdue   = tables.filter(t => t.currentReservation?.isOverdue).length;
      const ratio     = committed / tables.length;
      if (ratio < 0.60) continue;
      const score = ratio + overdue * 0.15;
      if (score <= bestScore) continue;
      bestScore = score;
      bestMsg = (ratio >= 0.75 || (ratio >= 0.65 && overdue >= 1))
        ? T.actionBar.sectionUnderPressure(name)
        : T.actionBar.sectionFillingUp(name);
    }
    return bestMsg;
  }, [floorTables, isLiveView, T]);

  // Floor pacing: is the floor about to ease or tighten in the next ~20–30 min?
  const pacingSignal = useMemo<'EASING' | 'TIGHTENING' | null>(() => {
    if (!isLiveView) return null;
    const freeingSoon    = pressureInfo.freeingSoonCount;
    const arrivingSoon   = pressureInfo.arrivingSoonCount;
    if (freeingSoon === 0 && arrivingSoon === 0) return null;
    const activeWaitlist = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED').length;
    const netFlow = freeingSoon - arrivingSoon;
    if (netFlow < 0)                         return 'TIGHTENING';
    if (netFlow > 0 && activeWaitlist < 2)   return 'EASING';
    return null;
  }, [pressureInfo.freeingSoonCount, pressureInfo.arrivingSoonCount, waitlist, isLiveView]);

  // Arrival-based insights for CONFIRMED late/at-risk guests (frontend-computed,
  // uses operational time, covers both assigned and unassigned reservations).
  const arrivalInsights = useMemo((): FloorInsight[] => {
    if (!isLiveView) return [];
    const resMap = new Map(reservations.map(r => [r.id, r]));
    return reservations
      .filter(r => r.status === 'CONFIRMED')
      .filter(r => !isFloorReleased(r.time, r.status, time)) // floor-released → sidebar "needs action" only
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
        // Most-late first — resMap built once before sort to avoid O(n) find per comparison
        const aMins = Math.abs(minutesUntilRes(resMap.get(a.reservationId)?.time ?? '00:00', time));
        const bMins = Math.abs(minutesUntilRes(resMap.get(b.reservationId)?.time ?? '00:00', time));
        return bMins - aMins;
      });
  }, [reservations, time, T, isLiveView]);

  // Backend insights + frontend arrival insights, deduped by reservationId.
  // Backend messages are English-hardcoded, so we re-derive them from raw data using T.
  const allInsights = useMemo((): FloorInsight[] => {
    // In browse/preview mode suppress time-derived late alerts from the backend.
    // LATE_GUEST is computed by the backend using the board's time param, not the
    // real wall-clock, so it fires false positives whenever the host previews a
    // future hour on today's date. ENDING_SOON is also suppressed: its minutesRemaining
    // is boardTime-based, so it would show a false "ending soon" badge in planning view.
    const liveInsights = isLiveView
      ? insights
      : insights.filter(i => i.type !== 'LATE_GUEST' && i.type !== 'ENDING_SOON');

    const backendResIds = new Set(liveInsights.map(i => i.reservationId).filter(Boolean));
    const extra = arrivalInsights.filter(i => i.reservationId && !backendResIds.has(i.reservationId));

    const translated = liveInsights.map((insight): FloorInsight => {
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
          const mr = table.currentReservation.minutesRemaining;
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
  }, [insights, arrivalInsights, reservations, floorTables, time, T, isLiveView]);

  const reorganizeQueue = useMemo(
    () => reservations.filter(r => r.reorganizeAt != null && ['CONFIRMED', 'PENDING'].includes(r.status)),
    [reservations],
  );

  const handleWaitlistAdd = useCallback(async (data: { guestName: string; partySize: number; guestPhone?: string }) => {
    const entry = await api.waitlist.add({ ...data, date });
    setWaitlist(prev => [...prev, entry]);
  }, [date]);

  const handleWaitlistSeat = useCallback((entry: WaitlistEntry) => {
    if (entry.date.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
      showToast(T.waitlistPanel.seatFutureDisabled, 'error');
      return;
    }
    // Close any open reservation drawer so the full floor map is accessible
    setSelectedRes(null);
    setCreateMode(null);
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

  const handleWaitlistUpdate = useCallback(async (entry: WaitlistEntry, data: { partySize?: number; guestName?: string; notes?: string }) => {
    const updated = await api.waitlist.update(entry.id, data);
    setWaitlist(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e));
    setWaitlistRefreshKey(k => k + 1);
  }, []);

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
    // Close any open reservation drawer so the full floor map is accessible
    setSelectedRes(null);
    setCreateMode(null);
    // Pre-select table from suggestion — host can freely change it on the map
    setWaitlistAssignEntry(entry);
    setWaitlistAssignTableId(tableId);
  }, [showToast]);

  const handleWaitlistTablePick = useCallback((tableId: string) => {
    setWaitlistAssignTableId(tableId);
  }, []);

  const handleWaitlistAssignCancel = useCallback(() => {
    setWaitlistAssignEntry(null);
    setWaitlistAssignTableId(null);
  }, []);

  // Shared waitlist-seat execution core — reused by handleWaitlistConfirmSeat (two-step
  // confirm flow) and handleTableFirstSeat (table-first direct seat).
  // Returns true on success so callers that own UI state (e.g. assign banner) can clear it.
  const executeWaitlistSeat = useCallback(async (
    entry: WaitlistEntry,
    tableId: string | undefined,
  ): Promise<boolean> => {
    if (inFlightRef.current.has(entry.id)) return false;
    inFlightRef.current.add(entry.id);
    setInFlightIds(new Set(inFlightRef.current));
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
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const det = err.details as { code?: string; conflicts?: ReorganizeConflict[]; conflictingReservationId?: string; validatorDebug?: Record<string, unknown> } | null;
        // Diagnostic: always log full conflict details so the exact cause is visible in browser DevTools
        console.error('[wl:seat:conflict]', {
          tableId,
          errCode:                  err.code,
          errMessage:               err.message,
          detCode:                  det?.code ?? null,
          conflictingReservationId: det?.conflictingReservationId ?? null,
          validatorDebug:           det?.validatorDebug ?? null,
          fullDetails:              det,
        });
        if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length && tableId) {
          const tName = floorTables.find(t => t.id === tableId)?.name ?? tableId;
          setReorganizeConflict({
            conflicts: det.conflicts,
            pendingReservationId: '',
            pendingTableId: tableId,
            pendingCombinedIds: [],
            tableName: tName,
            busy: false,
            _key: ++reorganizeKeyRef.current,
            pendingWaitlistEntry: entry,
          });
          return false;
        }
      }
      showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
      return false;
    } finally {
      inFlightRef.current.delete(entry.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }, [floorTables, showToast]);

  // Thin wrapper: reads from the two-step assign state, delegates to executeWaitlistSeat,
  // then clears the assign banner only on success (so the host can retry on failure).
  const handleWaitlistConfirmSeat = useCallback(async () => {
    if (!waitlistAssignEntry) return;
    const entry   = waitlistAssignEntry;
    const tableId = waitlistAssignTableId ?? undefined;
    const ok = await executeWaitlistSeat(entry, tableId);
    if (ok) {
      setWaitlistAssignEntry(null);
      setWaitlistAssignTableId(null);
    }
  }, [waitlistAssignEntry, waitlistAssignTableId, executeWaitlistSeat]);

  // Bidirectional date sync: called by CreateDrawer and GuestDrawer (edit mode)
  // whenever the host changes the reservation date or time inside the drawer.
  // Keeps the floor board and the open drawer on the same calendar day so
  // availability shown in the form always matches what the board is rendering.
  const handleDrawerDateTimeChange = useCallback((d: string, t: string) => {
    // Reject any date that isn't plain YYYY-MM-DD (Prisma returns ISO strings
    // like "2026-05-19T00:00:00.000Z" which would corrupt the API query params).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
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
    setTablePickWalkIn(false);
  }, []);

  const handlePickCancel = useCallback(() => {
    tablePickCallbackRef.current?.(null);
    tablePickCallbackRef.current = null;
    setTablePickMode(false);
    setTablePickAction(undefined);
    setTablePickGuestName(undefined);
    setTablePickWalkIn(false);
  }, []);

  const handlePickTablesFromDrawer = useCallback((
    currentIds: string[],
    suggestions: BackendTableSuggestion[],
    callback: (ids: string[] | null) => void,
    action?: 'seat' | 'move' | 'change-table',
    guestName?: string,
    walkIn?: boolean,
  ) => {
    setTablePickWalkIn(!!walkIn);
    handlePickTables(currentIds, suggestions, callback, action, guestName);
  }, [handlePickTables]);

  const handleChooseTable = useCallback(async (r: Reservation) => {
    let sug: BackendTableSuggestion[] = [];
    try {
      sug = await api.tables.suggest({
        date: r.date,
        time: r.time,
        partySize: r.partySize,
        duration: r.duration,
        excludeReservationId: r.id,
      });
    } catch { /* proceed with no suggestions — tables still selectable */ }

    handlePickTables(
      [],
      sug,
      async (ids) => {
        if (!ids || ids.length === 0) return;
        const [primaryId, ...secondaryIds] = ids;
        const name = floorTables.find(t => t.id === primaryId)?.name
          ?? allTables.find(t => t.id === primaryId)?.name
          ?? primaryId;
        try {
          const updated = await api.reservations.update(r.id, {
            tableId: primaryId,
            combinedTableIds: secondaryIds,
          });
          setReservations(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
          setRefreshKey(k => k + 1);
          showToast(T.guestDrawer.toastTableAssigned(name));
        } catch (err) {
          showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
        }
      },
      'change-table',
      r.guestName,
    );
  }, [handlePickTables, floorTables, allTables, showToast]);

  const handleContextMenuSeat = useCallback(async (res: Reservation) => {
    async function executeSeat(primaryId: string, secondaryIds: string[], forceOverrideOccupied = false) {
      if (inFlightRef.current.has(res.id)) return;

      // Pre-flight: if the target table has a SEATED guest, show handoff modal before
      // touching the API — mirrors the same check in GuestDrawer.seatWithReorganizeCheck.
      if (!forceOverrideOccupied) {
        const seatedOccupant = reservations.find(r =>
          r.tableId === primaryId && r.status === 'SEATED' && r.id !== res.id
        );
        if (seatedOccupant) {
          setOccupiedConflict({
            occupiedBy: { id: seatedOccupant.id, guestName: seatedOccupant.guestName, time: seatedOccupant.time, partySize: seatedOccupant.partySize },
            resume: () => { void executeSeat(primaryId, secondaryIds, true); },
          });
          return;
        }
      }

      const now = Date.now();
      const seatedAt = new Date(now).toISOString();
      const expectedEndTime = optimisticExpectedEnd(res, now);
      let snapshotFloorTable: FloorTable | null = null;

      inFlightRef.current.add(res.id);
      setInFlightIds(new Set(inFlightRef.current));

      setReservations(prev => prev.map(r =>
        r.id === res.id ? { ...r, status: 'SEATED' as const, tableId: primaryId, seatedAt } : r
      ));
      setFloorTables(prev => prev.map(t => {
        if (t.id === primaryId) {
          snapshotFloorTable = t;
          return {
            ...t,
            liveStatus: 'OCCUPIED' as FloorTable['liveStatus'],
            currentReservation: {
              ...res, status: 'SEATED' as const, tableId: primaryId, seatedAt,
              minutesRemaining: Math.round((new Date(expectedEndTime).getTime() - now) / 60_000), expectedEndTime, isOverdue: false, minutesOverdue: 0,
            },
            upcomingReservations: t.upcomingReservations.filter(r => r.id !== res.id),
          };
        }
        return t;
      }));

      try {
        const updated = await api.reservations.seat(res.id, primaryId, false, secondaryIds, [], forceOverrideOccupied);
        setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
        setInsights(prev => prev.filter(i => i.tableId !== primaryId && i.reservationId !== res.id));
        const tableName = floorTables.find(t => t.id === primaryId)?.name ?? primaryId;
        const advisory = updated._advisory;
        const toastMsg = advisory?.shortWindow
          ? (advisory.minutesLate && advisory.minutesLate > 0
              ? T.hostDashboard.toastSeatLateAdvisory(advisory.minutesLate, advisory.minutesUntil)
              : advisory.minutesUntil > 0
                ? T.hostDashboard.toastSeatAdvisory(tableName, advisory.minutesUntil)
                : T.hostDashboard.toastQuickSeated(tableName))
          : T.hostDashboard.toastQuickSeated(tableName);
        showToast(toastMsg, 'success', {
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
        setReservations(prev => prev.map(r => r.id === res.id ? res : r));
        if (snapshotFloorTable) { const snap = snapshotFloorTable; setFloorTables(prev => prev.map(t => t.id === primaryId ? snap : t)); }
        if (err instanceof ApiError && err.code === 'CONFLICT') {
          const det = err.details as { code?: string; conflicts?: ReorganizeConflict[]; occupiedBy?: { id: string; guestName: string; time: string; partySize: number } } | null;
          if (det?.code === 'TABLE_IS_OCCUPIED' && det.occupiedBy) {
            setOccupiedConflict({
              occupiedBy: det.occupiedBy,
              resume: () => { void executeSeat(primaryId, secondaryIds, true); },
            });
            return;
          }
          if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
            const tName = floorTables.find(t => t.id === primaryId)?.name ?? primaryId;
            setReorganizeConflict({
              conflicts: det.conflicts,
              pendingReservationId: res.id,
              pendingTableId: primaryId,
              pendingCombinedIds: secondaryIds,
              tableName: tName,
              busy: false,
              _key: ++reorganizeKeyRef.current,
            });
            return;
          }
        }
        showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
      } finally {
        inFlightRef.current.delete(res.id);
        setInFlightIds(new Set(inFlightRef.current));
      }
    }

    // Table already assigned — seat directly, same as GuestDrawer right-side flow
    if (res.tableId) {
      await executeSeat(res.tableId, res.combinedTableIds ?? []);
      return;
    }

    // No table assigned — enter floor pick mode
    let sug: BackendTableSuggestion[] = [];
    try {
      sug = await api.tables.suggest({
        date: res.date, time: res.time, partySize: res.partySize,
        duration: res.duration, excludeReservationId: res.id,
      });
    } catch { /* proceed with no suggestions — all tables remain selectable */ }

    handlePickTables(
      [],
      sug,
      async (ids) => {
        if (!ids || ids.length === 0) return;
        const [primaryId, ...secondaryIds] = ids;
        await executeSeat(primaryId, secondaryIds);
      },
      'seat',
      res.guestName,
    );
  }, [handlePickTables, floorTables, reservations, showToast]);

  // Table-first seating: host right-clicks an available table and picks a guest.
  // Reservation path reuses handleContextMenuSeat with tableId pre-injected (skips pick mode).
  // Waitlist path reuses executeWaitlistSeat directly (no assign-banner state involved).
  const handleTableFirstSeat = useCallback((table: FloorTable, guest: TableFirstGuest) => {
    if (guest.kind === 'reservation') {
      handleContextMenuSeat({ ...guest.data, tableId: table.id });
    } else {
      void executeWaitlistSeat(guest.data, table.id);
    }
  }, [handleContextMenuSeat, executeWaitlistSeat]);

  const handleContextMenuComplete = useCallback(async (res: Reservation) => {
    if (inFlightRef.current.has(res.id)) return;

    const tableId = res.tableId;
    let snapshotFloorTable: FloorTable | null = null;

    inFlightRef.current.add(res.id);
    setInFlightIds(new Set(inFlightRef.current));

    setReservations(prev => prev.map(r =>
      r.id === res.id ? { ...r, status: 'COMPLETED' as const } : r
    ));
    if (tableId) {
      setFloorTables(prev => prev.map(t => {
        if (t.id === tableId) {
          snapshotFloorTable = t;
          return { ...t, liveStatus: 'AVAILABLE' as FloorTable['liveStatus'], currentReservation: null };
        }
        return t;
      }));
    }

    try {
      const updated = await api.reservations.complete(res.id);
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      showToast(T.guestDrawer.toastCompleted, 'success');
    } catch (err) {
      setReservations(prev => prev.map(r => r.id === res.id ? res : r));
      if (snapshotFloorTable) { const snap = snapshotFloorTable; setFloorTables(prev => prev.map(t => t.id === tableId ? snap : t)); }
      showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
    } finally {
      inFlightRef.current.delete(res.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }, [showToast]);

  const handleContextMenuReturnToList = useCallback(async (res: Reservation) => {
    if (inFlightRef.current.has(res.id)) return;

    const tableId = res.tableId;
    let snapshotFloorTable: FloorTable | null = null;

    inFlightRef.current.add(res.id);
    setInFlightIds(new Set(inFlightRef.current));

    setReservations(prev => prev.map(r =>
      r.id === res.id ? { ...r, status: 'CONFIRMED' as const, tableId: null, combinedTableIds: [], seatedAt: null } : r
    ));
    if (tableId) {
      setFloorTables(prev => prev.map(t => {
        if (t.id === tableId) {
          snapshotFloorTable = t;
          return { ...t, liveStatus: 'AVAILABLE' as FloorTable['liveStatus'], currentReservation: null };
        }
        return t;
      }));
    }

    try {
      const updated = await api.reservations.unseat(res.id);
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      showToast(T.guestDrawer.toastUnseated, 'success');
    } catch (err) {
      setReservations(prev => prev.map(r => r.id === res.id ? res : r));
      if (snapshotFloorTable) { const snap = snapshotFloorTable; setFloorTables(prev => prev.map(t => t.id === tableId ? snap : t)); }
      showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
    } finally {
      inFlightRef.current.delete(res.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }, [showToast]);

  const handleContextMenuOpenDetails = useCallback((res: Reservation) => {
    const enriched = reservations.find(r => r.id === res.id) ?? res;
    setQuickTable(null);
    openReservationDetails(enriched);
  }, [reservations, openReservationDetails]);

  const handleContextMenuArrive = useCallback(async (res: Reservation) => {
    if (inFlightRef.current.has(res.id)) return;

    inFlightRef.current.add(res.id);
    setInFlightIds(new Set(inFlightRef.current));

    setReservations(prev => prev.map(r =>
      r.id === res.id ? { ...r, isArrived: true, arrivedAt: r.arrivedAt ?? new Date().toISOString() } : r
    ));

    try {
      const updated = await api.reservations.markArrived(res.id);
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      showToast(T.guestDrawer.toastArrived, 'success');
    } catch (err) {
      setReservations(prev => prev.map(r => r.id === res.id ? res : r));
      showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
    } finally {
      inFlightRef.current.delete(res.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }, [showToast]);

  const handleSendSms = useCallback(async (res: Reservation) => {
    if (inFlightRef.current.has(res.id)) return;
    inFlightRef.current.add(res.id);
    setInFlightIds(new Set(inFlightRef.current));
    try {
      const response = await api.reservations.sendConfirmation(res.id);
      const { whatsappFailed, smsFailed, ...updated } = response;
      setReservations(prev => prev.map(r => r.id === (updated as Reservation).id ? { ...r, ...(updated as Reservation) } : r));
      if (whatsappFailed && smsFailed) {
        showToast(T.guestDrawer.toastConfirmationBothFailed, 'error');
      } else if (whatsappFailed) {
        showToast(T.guestDrawer.toastConfirmationWhatsappFailed, 'success');
      } else {
        showToast(res.confirmationSentAt ? T.guestDrawer.confirmationResent : T.guestDrawer.confirmationSent, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
    } finally {
      inFlightRef.current.delete(res.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }, [showToast]);

  const handleContextMenuMove = useCallback(async (res: Reservation) => {
    let sug: BackendTableSuggestion[] = [];
    try {
      sug = await api.tables.suggest({
        date: res.date,
        time: res.time,
        partySize: res.partySize,
        duration: res.duration,
        excludeReservationId: res.id,
      });
    } catch { /* proceed with no suggestions */ }
    const currentIds = [res.tableId, ...(res.combinedTableIds ?? [])].filter(Boolean) as string[];
    handlePickTables(
      currentIds,
      sug,
      (ids) => {
        if (!ids || ids.length === 0) return;
        const [primaryId, ...secondaryIds] = ids;
        const targetName = floorTables.find(t => t.id === primaryId)?.name ?? primaryId;
        const sourceName = floorTables.find(t => t.id === res.tableId)?.name ?? (res.tableId ?? '');
        setPendingMove({
          res,
          sourceTableName: sourceName,
          targetTableId: primaryId,
          targetCombinedIds: secondaryIds,
          targetTableName: targetName,
          busy: false,
        });
      },
      'move',
      res.guestName,
    );
  }, [handlePickTables, floorTables]);

  const handleContextMenuSwap = useCallback((res: Reservation) => {
    const tableName = floorTables.find(t => t.id === res.tableId)?.name ?? (res.tableId ?? '');
    setSwapSource({ res, tableName });
  }, [floorTables]);

  const handleSwapTargetPick = useCallback((targetRes: Reservation) => {
    if (!swapSource) return;
    const tableNameB = floorTables.find(t => t.id === targetRes.tableId)?.name ?? (targetRes.tableId ?? '');
    setPendingSwap({
      resA: swapSource.res,
      tableNameA: swapSource.tableName,
      resB: targetRes,
      tableNameB,
      busy: false,
    });
    setSwapSource(null);
  }, [swapSource, floorTables]);

  const confirmSwap = useCallback(async () => {
    if (!pendingSwap || pendingSwap.busy) return;
    setPendingSwap(p => p && ({ ...p, busy: true }));
    try {
      const result = await api.reservations.swap(pendingSwap.resA.id, pendingSwap.resB.id);
      setReservations(prev => prev.map(r => {
        if (r.id === result.reservationA.id) return { ...r, ...result.reservationA };
        if (r.id === result.reservationB.id) return { ...r, ...result.reservationB };
        return r;
      }));
      setRefreshKey(k => k + 1);
      showToast(T.floorBoard.swapConfirmTitle(pendingSwap.resA.guestName, pendingSwap.resB.guestName).replace('?', ''));
    } catch (err) {
      let toastMsg = err instanceof Error ? err.message : T.guestDrawer.actionFailed;
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const det = err.details as { code?: string; conflicts?: Array<{ guestName: string; time: string }> } | null;
        if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.[0]) {
          const c = det.conflicts[0];
          toastMsg = `Swap blocked — table already reserved for ${c.guestName} at ${c.time}`;
        }
      }
      showToast(toastMsg, 'error');
    } finally {
      setPendingSwap(null);
    }
  }, [pendingSwap, showToast, setRefreshKey]);

  const confirmMove = useCallback(async () => {
    if (!pendingMove || pendingMove.busy) return;
    setPendingMove(p => p && ({ ...p, busy: true }));
    try {
      const updated = await api.reservations.move(
        pendingMove.res.id,
        pendingMove.targetTableId,
        undefined,
        pendingMove.targetCombinedIds,
      );
      setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
      showToast(T.guestDrawer.toastMoved(pendingMove.targetTableName));
      setQuickTable(null);
      setPendingMove(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const det = err.details as { code?: string; conflicts?: ReorganizeConflict[] } | null;
        if (det?.code === 'TABLE_HAS_FUTURE_RESERVATIONS' && det.conflicts?.length) {
          const { res, targetTableId, targetCombinedIds, targetTableName } = pendingMove;
          setPendingMove(null);
          setReorganizeConflict({
            conflicts: det.conflicts,
            pendingReservationId: res.id,
            pendingTableId: targetTableId,
            pendingCombinedIds: targetCombinedIds,
            tableName: targetTableName,
            busy: false,
            _key: ++reorganizeKeyRef.current,
            pendingMoveResId: res.id,
          });
          return;
        }
      }
      setPendingMove(p => p ? { ...p, busy: false } : null);
      showToast(err instanceof Error ? err.message : T.guestDrawer.actionFailed, 'error');
    }
  }, [pendingMove, showToast]);

  // Called after a reservation is created — update state optimistically and open it in the drawer.
  // No explicit setRefreshKey: SSE floor_updated fires for every mutation and triggers
  // the background refresh, same as handleUpdated. Avoids a double-fetch alongside SSE.
  const handleCreated = useCallback((created: Reservation) => {
    setCreateMode(null);
    setPreselectedTableId(null);
    setPreselectedCombinedTableIds([]);
    // Upsert: if the SSE re-fetch already added a PENDING version (race in override flow), replace it.
    setReservations(prev => {
      const idx = prev.findIndex(r => r.id === created.id);
      return idx === -1 ? [...prev, created] : prev.map(r => r.id === created.id ? created : r);
    });
    // Optimistic floor update for seated walk-ins: show OCCUPIED immediately without waiting
    // for the SSE-triggered refetch, so the floor board reflects the seat as soon as the
    // backend confirms it.
    if (created.status === 'SEATED' && created.tableId) {
      const now = Date.now();
      const seatedAtMs = created.seatedAt ? new Date(created.seatedAt).getTime() : now;
      const expectedEndTime = optimisticExpectedEnd(created, seatedAtMs);
      setFloorTables(prev => prev.map(t => {
        if (t.id !== created.tableId) return t;
        return {
          ...t,
          liveStatus: 'OCCUPIED' as FloorTable['liveStatus'],
          currentReservation: {
            ...created,
            minutesRemaining: Math.round((new Date(expectedEndTime).getTime() - now) / 60_000),
            expectedEndTime,
            isOverdue: false,
            minutesOverdue: 0,
          },
          upcomingReservations: t.upcomingReservations.filter(r => r.id !== created.id),
        };
      }));
    }
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

  const handleIntelligencePage = useCallback(() => {
    setSelectedRes(null);
    setCreateMode(null);
    setActivePage('intelligence');
  }, []);

  const canAccessGuests =
    auth.user.restaurant?.settings?.guestsPageEnabled !== false &&
    !(['HOST', 'SERVER'] as const).includes(auth.user.role as 'HOST' | 'SERVER');

  if (activePage === 'guests' && canAccessGuests) {
    return (
      <>
        <GuestsPage
          onBack={() => { setActivePage('dashboard'); setGuestSearchPhone(''); }}
          initialSearch={guestSearchPhone}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  if (activePage === 'hosts') {
    return (
      <>
        <HostsSettingsPage
          onBack={() => setActivePage('dashboard')}
          userRole={auth.user.role}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  if (activePage === 'activity') {
    return (
      <>
        <ActivityLogPage
          onBack={() => setActivePage('dashboard')}
          userRole={auth.user.role}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  if (activePage === 'intelligence') {
    return (
      <>
        <IntelligencePage onBack={() => setActivePage('dashboard')} />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  const canAccessClub =
    !!auth.user.restaurant?.settings?.ironClubEnabled &&
    !(['HOST', 'SERVER'] as const).includes(auth.user.role as 'HOST' | 'SERVER');

  if (activePage === 'club' && canAccessClub && auth.user.restaurant?.id) {
    return (
      <>
        <ClubCenterPage
          restaurantId={auth.user.restaurant.id}
          onBack={() => setActivePage('dashboard')}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  if (layoutMode) {
    return (
      <LayoutEditor
        onClose={() => setLayoutMode(false)}
        onSaved={() => { setLayoutMode(false); setFloorLayoutKey(k => k + 1); }}
      />
    );
  }

  // Full CallDrawer only when no drawer or active floor workflow is open.
  // Compact card when the host is mid-flow so their context is not hidden.
  const callWorkflowActive = !!(selectedRes || createMode || tablePickMode || waitlistAssignEntry);

  const handleBroadcastSend = async () => {
    if (!broadcastMsg.trim() || broadcastBusy) return;
    setBroadcastBusy(true);
    setBroadcastConfirming(false);
    setBroadcastResult(null);
    try {
      const body: { date: string; message: string; reservationIds?: string[] } = {
        date: date,
        message: broadcastMsg.trim(),
      };
      if (broadcastTarget === 'specific' && broadcastSelIds.length > 0) {
        body.reservationIds = broadcastSelIds;
      }
      const result = await api.reservations.broadcast(body);
      setBroadcastResult({ sent: result.sent, total: result.total, errors: result.errors ?? [] });
      setBroadcastMsg('');
      setBroadcastSelIds([]);
    } catch {
      // keep panel open on error
    } finally {
      setBroadcastBusy(false);
    }
  };

  const broadcastableRes = reservations.filter(
    r => ['PENDING', 'CONFIRMED', 'SEATED'].includes(r.status) && r.guestPhone,
  );

  const toolbarActions = (
    <>
      {/* ── More menu (עוד) — contains all toolbar actions including broadcast ── */}
      <div className="relative" ref={moreMenuRef}>
        <button
          onClick={() => { setShowMoreMenu(v => !v); setShowBroadcast(false); }}
          className={`flex items-center gap-1 text-[11px] font-medium border rounded-lg px-2.5 py-1.5 transition-colors ${
            showMoreMenu || showBroadcast
              ? 'bg-iron-elevated/40 border-iron-border/65 text-iron-text/90'
              : 'text-iron-muted/70 hover:text-iron-text/90 border-iron-border/45 hover:border-iron-border/65 hover:bg-iron-elevated/30'
          }`}
        >
          {T.hostDashboard.moreMenu}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${showMoreMenu ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* ── Dropdown menu ── */}
        {showMoreMenu && (
          <div
            className="absolute end-0 top-full mt-1.5 z-50 min-w-[176px] rounded-xl border border-iron-border/50 bg-iron-elevated py-1.5"
            style={{ boxShadow: '0 14px 36px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)' }}
          >
            <button
              onClick={() => { setShowMoreMenu(false); setShowBroadcast(true); setBroadcastResult(null); setBroadcastConfirming(false); }}
              className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
            >
              {T.hostDashboard.broadcastBtn}
            </button>
            <div className="my-1 border-t border-iron-border/30" />
            <button
              onClick={() => {
                setShowMoreMenu(false);
                if (combineMode) { setCombineMode(false); setCombinedSelection([]); }
                else { setSelectedRes(null); setCreateMode(null); setCombineMode(true); }
              }}
              className={`w-full text-start px-3.5 py-2 text-xs font-medium transition-colors ${
                combineMode
                  ? 'text-status-reserved bg-blue-600/10 hover:bg-blue-600/18'
                  : 'text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20'
              }`}
            >
              {combineMode ? T.hostDashboard.cancelCombine : T.hostDashboard.combineTables2}
            </button>
            <button
              onClick={() => {
                setShowMoreMenu(false);
                if (reorganizeMode) { setReorganizeMode(false); setRebuildDayTarget(null); }
                else { setSelectedRes(null); setCreateMode(null); setCombineMode(false); setCombinedSelection([]); setReorganizeMode(true); rebuildSessionIdRef.current = crypto.randomUUID(); }
              }}
              className={`w-full text-start px-3.5 py-2 text-xs font-medium transition-colors ${
                reorganizeMode
                  ? 'text-status-warning bg-status-warning/10 hover:bg-status-warning/18'
                  : 'text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20'
              }`}
            >
              {reorganizeMode ? T.hostDashboard.exitReorganize : T.hostDashboard.reorganizeFloor2}
            </button>
            <button
              onClick={() => { setShowMoreMenu(false); setShowCallLog(v => !v); }}
              className={`w-full text-start px-3.5 py-2 text-xs font-medium transition-colors ${
                showCallLog
                  ? 'text-iron-green-light bg-iron-green/10 hover:bg-iron-green/18'
                  : 'text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20'
              }`}
            >
              {T.hostDashboard.callLogBtn}
            </button>
            <div className="my-1 border-t border-iron-border/30" />
            <button
              onClick={() => { setShowMoreMenu(false); setShowBulkConfirm(true); }}
              className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
            >
              {T.hostDashboard.bulkConfirmBtn}
            </button>
            <button
              onClick={() => { setShowMoreMenu(false); setShowServiceReport(true); }}
              className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
            >
              {T.hostDashboard.serviceReportBtn}
            </button>
            <button
              onClick={() => { setShowMoreMenu(false); setActivePage('activity'); }}
              className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
            >
              {T.hostDashboard.activityLogBtn}
            </button>
            {(['MANAGER', 'ADMIN', 'OWNER', 'HQ_ADMIN', 'GROUP_MANAGER', 'SUPER_ADMIN'] as const).includes(auth.user.role as 'MANAGER' | 'ADMIN' | 'OWNER' | 'HQ_ADMIN' | 'GROUP_MANAGER' | 'SUPER_ADMIN') && (
              <button
                onClick={() => { setShowMoreMenu(false); setActivePage('hosts'); }}
                className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
              >
                {T.hostDashboard.hostsBtn}
              </button>
            )}
            {canAccessClub && (
              <button
                onClick={() => { setShowMoreMenu(false); setActivePage('club'); }}
                className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors flex items-center gap-1.5"
              >
                <span>♦</span> IRON CLUB
              </button>
            )}
            <button
              onClick={() => { setShowMoreMenu(false); setLayoutMode(true); }}
              className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
            >
              {T.hostDashboard.editLayout}
            </button>
          </div>
        )}

        {/* ── Broadcast panel (opens from same anchor after selecting from menu) ── */}
        {showBroadcast && (
          <div
            className="absolute end-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-iron-border/50 bg-iron-elevated p-3 flex flex-col gap-2.5"
            style={{ boxShadow: '0 14px 36px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-iron-text/90">{T.hostDashboard.broadcastTitle}</p>
              <button
                onClick={() => setShowBroadcast(false)}
                className="text-iron-muted/50 hover:text-iron-muted/80 transition-colors"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <textarea
              rows={3}
              value={broadcastMsg}
              onChange={e => setBroadcastMsg(e.target.value)}
              placeholder={T.hostDashboard.broadcastPlaceholder}
              className="w-full resize-none rounded-lg border border-iron-border/50 bg-iron-bg px-2.5 py-2 text-xs text-iron-text placeholder:text-iron-muted/40 focus:outline-none focus:border-iron-border/80"
              dir="rtl"
            />
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="broadcast-target"
                  checked={broadcastTarget === 'all'}
                  onChange={() => { setBroadcastTarget('all'); setBroadcastSelIds([]); }}
                  className="accent-iron-green-light"
                />
                <span className="text-xs text-iron-muted/80">{T.hostDashboard.broadcastToAll} ({broadcastableRes.length})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="broadcast-target"
                  checked={broadcastTarget === 'specific'}
                  onChange={() => setBroadcastTarget('specific')}
                  className="accent-iron-green-light"
                />
                <span className="text-xs text-iron-muted/80">{T.hostDashboard.broadcastToSpecific}</span>
              </label>
            </div>
            {broadcastTarget === 'specific' && (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {broadcastableRes.map(r => (
                  <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={broadcastSelIds.includes(r.id)}
                      onChange={e => setBroadcastSelIds(prev =>
                        e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id)
                      )}
                      className="accent-iron-green-light"
                    />
                    <span className="text-xs text-iron-text/80 truncate">{r.guestName} — {r.time}</span>
                  </label>
                ))}
                {broadcastableRes.length === 0 && (
                  <p className="text-xs text-iron-muted/50">{T.hostDashboard.broadcastNoPhone}</p>
                )}
              </div>
            )}
            {broadcastResult && broadcastResult.sent > 0 && (
              <p className="text-xs text-iron-green-light font-medium">
                {T.hostDashboard.broadcastSuccess(broadcastResult.sent)}
              </p>
            )}
            {broadcastResult && broadcastResult.sent === 0 && broadcastResult.total === 0 && (
              <p className="text-xs text-status-danger font-medium">לא נמצאו אורחים לתאריך זה</p>
            )}
            {broadcastResult && broadcastResult.sent === 0 && broadcastResult.total > 0 && (
              <div className="text-xs text-status-danger">
                <p className="font-medium">שליחה נכשלה ({broadcastResult.total} אורחים)</p>
                {broadcastResult.errors[0] && <p className="text-[11px] opacity-80 mt-0.5">{broadcastResult.errors[0]}</p>}
              </div>
            )}
            {broadcastConfirming ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2">
                <span className="text-xs text-status-warning font-medium">
                  {T.hostDashboard.broadcastConfirm(
                    broadcastTarget === 'specific' ? broadcastSelIds.length : broadcastableRes.length
                  )}
                </span>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => setBroadcastConfirming(false)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-iron-border/50 text-iron-muted/80 hover:text-iron-text transition-colors"
                  >
                    {T.hostDashboard.broadcastConfirmNo}
                  </button>
                  <button
                    onClick={handleBroadcastSend}
                    disabled={broadcastBusy}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-iron-green-light text-white hover:bg-iron-green disabled:opacity-40 transition-colors"
                  >
                    {broadcastBusy ? T.hostDashboard.broadcastSending : T.hostDashboard.broadcastConfirmYes}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setBroadcastConfirming(true)}
                disabled={!broadcastMsg.trim() || (broadcastTarget === 'specific' && broadcastSelIds.length === 0)}
                className="self-end text-xs font-semibold px-3 py-1.5 rounded-lg bg-iron-green-light text-white hover:bg-iron-green disabled:opacity-40 transition-colors"
              >
                {T.hostDashboard.broadcastSend}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

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
        guestsPageEnabled={canAccessGuests}
        onIntelligencePage={handleIntelligencePage}
        onSwitchHost={onSwitchHost}
        sseStatus={sseStatus}
        toolbarSlot={toolbarActions}
      />

      <ActionBar insights={allInsights} onItemClick={handleActionBarClick} sectionSignal={sectionSignal} pacingSignal={pacingSignal} />

      <BoardErrorBoundary>
      <div className="flex-1 flex overflow-hidden">

        {/* Left structural rail — table context panel.
            Width snaps instantly (no transition) so the floor board never reflows
            continuously during open/close. The panel content uses animate-slide-in-left
            (GPU transform only) for a smooth entrance without layout cost. */}
        <div
          className="shrink-0 overflow-hidden border-e border-iron-border/40"
          style={{
            width: (quickTable && quickFloorTable && !selectedRes && !createMode && !tablePickMode && !waitlistAssignEntry) ? 320 : 0,
            boxShadow: (quickTable && quickFloorTable && !selectedRes && !createMode && !tablePickMode && !waitlistAssignEntry) ? '1px 0 0 rgba(255,255,255,0.05), 6px 0 28px rgba(0,0,0,0.55), 20px 0 60px rgba(0,0,0,0.35)' : 'none',
          }}
        >
          {quickTable && quickFloorTable && !selectedRes && !createMode && !tablePickMode && !waitlistAssignEntry && (
            <TableQuickPanel
              floorTable={quickFloorTable}
              reservation={quickRes}
              allTables={allTables}
              isFutureDate={date > todayStr()}
              nowTime={time}
              isLiveView={isLiveView}
              onClose={() => setQuickTable(null)}
              onViewFull={(res) => { setQuickTable(null); openReservationDetails(res); }}
              onSeat={handleContextMenuSeat}
              onMoveTable={handleContextMenuMove}
              onChangeTable={handleChooseTable}
              onLock={handleLockTable}
              onUnlock={handleUnlockTable}
              onOpenCreate={(tableId) => { setPreselectedTableId(tableId); setCreateMode('reservation'); }}
              onOpenWalkin={(tableId) => { setPreselectedTableId(tableId); setCreateMode('walkin'); }}
              onUpdated={handleQuickPanelUpdated}
              onSuccess={showToast}
              inFlightIds={inFlightIds}
            />
          )}
        </div>

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
          pickWalkInMode={tablePickWalkIn}
          waitlistAssignEntry={waitlistAssignEntry}
          waitlistAssignTableId={waitlistAssignTableId}
          onWaitlistTablePick={handleWaitlistTablePick}
          onWaitlistAssignCancel={handleWaitlistAssignCancel}
          onWaitlistConfirmSeat={handleWaitlistConfirmSeat}
          reorganizeMode={reorganizeMode}
          onReorganizeTableClick={handleReorganizeTableClick}
          hoveredResId={hoveredResId}
          drawerOpen={!!(selectedRes || createMode)}
          onContextMenuSeat={handleContextMenuSeat}
          onContextMenuComplete={handleContextMenuComplete}
          onContextMenuMove={handleContextMenuMove}
          onContextMenuReturnToList={handleContextMenuReturnToList}
          onContextMenuOpenDetails={handleContextMenuOpenDetails}
          onContextMenuArrive={handleContextMenuArrive}
          onContextMenuSwap={handleContextMenuSwap}
          eligibleGuests={eligibleGuests}
          onTableFirstSeat={handleTableFirstSeat}
          activeDrawerRes={selectedRes}
          inFlightIds={inFlightIds}
          swapMode={!!swapSource}
          swapSourceId={swapSource?.res.id ?? null}
          onSwapTargetPick={handleSwapTargetPick}
          onSwapCancel={() => setSwapSource(null)}
        />

        {/* Panel toggle handle — always visible between floor and right rail */}
        <button
          type="button"
          onClick={() => setPanelCollapsed(c => !c)}
          className="shrink-0 w-4 bg-iron-elevated hover:bg-iron-card border-x border-iron-border/40 hover:border-iron-border/60 transition-colors flex items-center justify-center cursor-pointer"
          title={panelCollapsed ? 'Open reservation panel' : 'Collapse reservation panel'}
          aria-label={panelCollapsed ? 'Open reservation panel' : 'Collapse reservation panel'}
        >
          <svg
            width="6" height="10" viewBox="0 0 6 10" fill="none"
            className={`text-iron-muted/40 transition-transform duration-200 ${panelCollapsed ? 'rotate-180' : ''}`}
          >
            <polyline points="5,1 1,5 5,9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Right structural rail — reservation feed or call log. Width animates; map reflows. */}
        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: showCallLog ? 380 : (panelCollapsed ? 0 : 416),
            transition: 'width 200ms ease-out',
          }}
        >
          {showCallLog ? (
            <CallLogPanel
              latestCall={latestCall}
              onClose={() => setShowCallLog(false)}
              onNewReservation={(phone) => {
                setCallPrefillPhone(phone);
                setCreateMode('reservation');
                setShowCallLog(false);
              }}
              onFindGuest={(phone) => {
                setGuestSearchPhone(phone);
                setActivePage('guests');
                setShowCallLog(false);
              }}
            />
          ) : (
            <ReservationPanel
              reservations={reservations}
              selectedId={selectedRes?.id ?? null}
              highlightId={highlightId}
              onSelect={handlePanelSelect}
              loading={resLoading}
              onNewReservation={() => { setQuickTable(null); setPreselectedTableId(null); setCreateMode('reservation'); }}
              onWalkIn={() => { setQuickTable(null); setCreateMode('walkin'); }}
              waitlist={waitlist}
              waitlistLoading={waitlistLoading}
              onWaitlistAdd={handleWaitlistAdd}
              onWaitlistSeat={handleWaitlistSeat}
              onWaitlistNotify={handleWaitlistNotify}
              onWaitlistUpdate={handleWaitlistUpdate}
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
              reorganizeQueue={reorganizeQueue}
              onReorganizeSelect={handleReorganizeSelect}
              allTables={allTables}
              onChooseTable={handleChooseTable}
              onMarkArrived={handleContextMenuArrive}
              onSendSms={handleSendSms}
              isLiveView={isLiveView}
              onHoverRow={handleHoverRow}
              onSmartAssign={() => setShowSmartAssign(true)}
            />
          )}
        </div>
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
            isLiveView={isLiveView}
            onPickTables={handlePickTables}
            onPickTablesCancel={handlePickCancel}
            onDateTimeChange={handleDrawerDateTimeChange}
            onOptimisticSeat={handleOptimisticSeat}
            onOptimisticSeatRollback={handleOptimisticSeatRollback}
            onMarkArrived={handleContextMenuArrive}
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
            defaultTurnMinutes={auth.user.restaurant?.settings?.defaultTurnMinutes}
            initialData={callPrefillPhone ? { guestPhone: callPrefillPhone } : undefined}
            onClose={() => { setCreateMode(null); setPreselectedTableId(null); setPreselectedCombinedTableIds([]); setGapHint(null); setCallPrefillPhone(''); }}
            onCreated={handleCreated}
            onPickTables={handlePickTablesFromDrawer}
            onPickTablesCancel={handlePickCancel}
            onUpdatePickSuggestions={setTablePickSuggestions}
            onDateTimeChange={handleDrawerDateTimeChange}
          />
        </DrawerErrorBoundary>
      )}

      {/* Typing-guard notification badge */}
      {callNotification && !incomingCall && (
        <button
          onClick={() => { setIncomingCall(callNotification); setCallNotification(null); }}
          className="fixed bottom-4 left-4 z-[60] flex items-center gap-2.5 bg-iron-elevated border border-iron-green/30 text-iron-green-light text-sm font-medium pl-3 pr-4 py-2 rounded-full shadow-lg animate-toast"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iron-green opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-iron-green" />
          </span>
          <span>📞 {callNotification.phone || T.callDrawer.unknownCaller}</span>
        </button>
      )}

      {incomingCall && !callWorkflowActive && (
        <CallDrawer
          phone={incomingCall.phone}
          createdAt={incomingCall.createdAt}
          highlight={callHighlight}
          onNewReservation={(phone) => {
            setCallPrefillPhone(phone);
            setCreateMode('reservation');
            if (lastCallRef.current?.callid) lastCallRef.current = { ...lastCallRef.current, dismissed: true }; else lastCallRef.current = null; setIncomingCall(null);
          }}
          onOpenReservation={(resId) => {
            const res = reservations.find(r => r.id === resId);
            if (res) openReservationDetails(res);
            if (lastCallRef.current?.callid) lastCallRef.current = { ...lastCallRef.current, dismissed: true }; else lastCallRef.current = null; setIncomingCall(null);
          }}
          onClose={() => { if (lastCallRef.current?.callid) lastCallRef.current = { ...lastCallRef.current, dismissed: true }; else lastCallRef.current = null; setIncomingCall(null); }}
        />
      )}

      {incomingCall && callWorkflowActive && (
        <IncomingCallCard
          phone={incomingCall.phone}
          createdAt={incomingCall.createdAt}
          onOpen={() => {
            setSelectedRes(null);
            setCreateMode(null);
            setPreselectedTableId(null);
            setPreselectedCombinedTableIds([]);
            setGapHint(null);
            setCallPrefillPhone('');
          }}
          onNewReservation={(phone) => {
            setCallPrefillPhone(phone);
            setCreateMode('reservation');
            if (lastCallRef.current?.callid) lastCallRef.current = { ...lastCallRef.current, dismissed: true }; else lastCallRef.current = null; setIncomingCall(null);
          }}
          onDismiss={() => { if (lastCallRef.current?.callid) lastCallRef.current = { ...lastCallRef.current, dismissed: true }; else lastCallRef.current = null; setIncomingCall(null); }}
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

      {rebuildDayTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-iron-card border border-iron-border rounded-xl shadow-2xl p-5 w-80 space-y-3">
            <h3 className="text-iron-text font-semibold text-sm">
              {T.hostDashboard.rebuildDayTitle(rebuildDayTarget.table.name)}
            </h3>
            {rebuildDayTarget.resv.length === 0 ? (
              <p className="text-iron-muted text-xs">{T.hostDashboard.rebuildDayNoRes}</p>
            ) : (
              <>
                <p className="text-iron-muted text-xs">{T.hostDashboard.rebuildDayBody(selectedRebuildIds.length)}</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {rebuildDayTarget.resv.map(r => (
                    <label key={r.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-iron-bg border border-iron-border cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRebuildIds.includes(r.id)}
                        onChange={() => setSelectedRebuildIds(prev =>
                          prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id]
                        )}
                        disabled={rebuildDayBusy}
                        className="w-3.5 h-3.5 rounded border-iron-border accent-status-warning shrink-0"
                      />
                      <span className="text-iron-text text-xs font-medium flex-1 truncate">{r.guestName}</span>
                      <span className="text-iron-muted text-[11px]">{T.common.guests(r.partySize)}</span>
                      <span className="text-status-warning text-[11px]">{r.time}</span>
                    </label>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder={T.hostDashboard.rebuildDayReason}
                  value={rebuildDayReason}
                  onChange={e => setRebuildDayReason(e.target.value)}
                  className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-1.5 text-xs text-iron-text placeholder-iron-muted focus:outline-none focus:border-status-warning/50"
                />
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setRebuildDayTarget(null)}
                disabled={rebuildDayBusy}
                className="flex-1 text-xs border border-iron-border rounded-lg px-3 py-2 text-iron-muted hover:text-iron-text hover:border-iron-text/30 transition-colors disabled:opacity-50"
              >
                {T.common.cancel}
              </button>
              {rebuildDayTarget.resv.length > 0 && (
                <button
                  disabled={rebuildDayBusy || selectedRebuildIds.length === 0}
                  onClick={async () => {
                    setRebuildDayBusy(true);
                    try {
                      const result = await api.tables.rebuildDay(rebuildDayTarget.table.id, {
                        date,
                        reason: rebuildDayReason.trim() || undefined,
                        rebuildSessionId: rebuildSessionIdRef.current,
                        ids: selectedRebuildIds,
                      });
                      setRebuildDayTarget(null);
                      showToast(T.hostDashboard.toastRebuildDone(result.lifted, result.tableName));
                    } catch (err) {
                      showToast(err instanceof Error ? err.message : T.hostDashboard.toastRebuildFail, 'error');
                    } finally {
                      setRebuildDayBusy(false);
                    }
                  }}
                  className="flex-1 text-xs bg-status-warning/20 border border-status-warning/40 text-status-warning hover:bg-status-warning/30 rounded-lg px-3 py-2 font-semibold transition-colors disabled:opacity-50"
                >
                  {rebuildDayBusy ? T.common.processing : T.hostDashboard.rebuildDayConfirm}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showServiceReport && (
        <ServiceReportPanel
          initialDate={date}
          onClose={() => setShowServiceReport(false)}
        />
      )}

      {showBulkConfirm && (
        <BulkConfirmModal
          date={date}
          time={time}
          reservations={reservations}
          onClose={() => setShowBulkConfirm(false)}
          onSuccess={showToast}
        />
      )}

      {showSmartAssign && (
        <SmartAssignModal
          reservations={reservations}
          tables={allTables}
          date={date}
          onClose={() => setShowSmartAssign(false)}
          onUpdated={(updated) => {
            setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
          }}
          onApply={() => {}}
        />
      )}

      {/* Portaled to document.body to escape App.tsx's transform:scale stacking context */}
      {reorganizeConflict && createPortal(
        <ReorganizeConflictModal
          key={reorganizeConflict._key}
          conflicts={reorganizeConflict.conflicts}
          busy={reorganizeConflict.busy}
          onCancel={() => setReorganizeConflict(null)}
          onConfirm={async (selectedIds) => {
            const { pendingReservationId, pendingTableId, pendingCombinedIds, tableName, pendingWaitlistEntry, pendingMoveResId } = reorganizeConflict;
            setReorganizeConflict(prev => prev ? { ...prev, busy: true } : null);
            try {
              if (pendingWaitlistEntry) {
                // Waitlist-seat path: seat walk-in, backend unassigns conflicting future reservations
                const { reservation } = await api.waitlist.seat(pendingWaitlistEntry.id, pendingTableId, true);
                setReservations(prev => [...prev, reservation]);
                setWaitlist(prev => prev.filter(e => e.id !== pendingWaitlistEntry.id));
                setWaitlistAssignEntry(null);
                setWaitlistAssignTableId(null);
                setRefreshKey(k => k + 1);
                setWaitlistRefreshKey(k => k + 1);
                setReorganizeConflict(null);
                showToast(T.hostDashboard.toastSeatAt(pendingWaitlistEntry.guestName, tableName));
              } else if (pendingMoveResId) {
                // Move path: re-issue move with overrideConflicts + selectedIds to displace
                const updated = await api.reservations.move(pendingMoveResId, pendingTableId, undefined, pendingCombinedIds, true, selectedIds);
                setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
                setRefreshKey(k => k + 1);
                setReorganizeConflict(null);
                showToast(T.guestDrawer.toastMoved(tableName), 'success');
              } else {
                const updated = await api.reservations.seat(pendingReservationId, pendingTableId, true, pendingCombinedIds, selectedIds);
                setReservations(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
                setRefreshKey(k => k + 1);
                setInsights(prev => prev.filter(i => i.tableId !== pendingTableId && i.reservationId !== pendingReservationId));
                setReorganizeConflict(null);
                showToast(T.hostDashboard.toastQuickSeated(tableName), 'success');
              }
            } catch (err) {
              setReorganizeConflict(null);
              showToast(err instanceof Error ? err.message : T.hostDashboard.toastSeatFail, 'error');
            }
          }}
        />,
        document.body
      )}

      {/* Occupied-table handoff modal — shown when target table has a SEATED guest.
          Same UX as GuestDrawer's occupiedModal but driven from the QuickPanel path. */}
      {occupiedConflict && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOccupiedConflict(null)} />
          <div className="relative z-10 bg-iron-card border border-iron-border rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 text-right">
            <h2 className="text-iron-text font-bold text-lg mb-2">{T.guestDrawer.occupiedModalTitle}</h2>
            <p className="text-iron-muted text-sm mb-1">{T.guestDrawer.occupiedModalBody}</p>
            <p className="text-iron-text text-sm font-semibold mb-5">
              {occupiedConflict.occupiedBy.guestName} · {occupiedConflict.occupiedBy.time} · {T.common.guests(occupiedConflict.occupiedBy.partySize)}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setOccupiedConflict(null)}
                className="px-4 py-2 rounded-lg border border-iron-border text-iron-muted text-sm hover:bg-iron-elevated transition-colors"
              >
                {T.guestDrawer.occupiedModalCancel}
              </button>
              <button
                onClick={() => { const r = occupiedConflict.resume; setOccupiedConflict(null); r(); }}
                className="px-4 py-2 rounded-lg bg-iron-green/20 border border-iron-green/40 text-iron-green-light text-sm font-semibold hover:bg-iron-green/30 transition-colors"
              >
                {T.guestDrawer.occupiedModalConfirm}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Move-table confirmation — lightweight bottom-sheet style, no heavy modal */}
      {pendingMove && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none">
          <div className="pointer-events-auto bg-iron-elevated border border-iron-border/60 rounded-xl px-5 py-4 shadow-2xl w-80">
            <p className="text-sm font-semibold text-iron-text mb-1">
              {T.floorBoard.moveConfirmTitle(pendingMove.res.guestName)}
            </p>
            <p className="text-xs text-iron-muted mb-4">
              {T.floorBoard.moveConfirmBody(pendingMove.sourceTableName, pendingMove.targetTableName)}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingMove(null)}
                disabled={pendingMove.busy}
                className="px-3 py-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border/50 rounded-lg transition-colors disabled:opacity-40"
              >
                {T.floorBoard.pickModeCancel}
              </button>
              <button
                onClick={confirmMove}
                disabled={pendingMove.busy}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-status-warning rounded-lg transition-colors disabled:opacity-40"
              >
                {pendingMove.busy ? '…' : T.floorBoard.moveConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Swap-table confirmation — lightweight bottom-sheet style */}
      {pendingSwap && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none">
          <div className="pointer-events-auto bg-iron-elevated border border-iron-border/60 rounded-xl px-5 py-4 shadow-2xl w-80">
            <p className="text-sm font-semibold text-iron-text mb-1">
              {T.floorBoard.swapConfirmTitle(pendingSwap.resA.guestName, pendingSwap.resB.guestName)}
            </p>
            <p className="text-xs text-iron-muted mb-4">
              {T.floorBoard.swapConfirmBody(pendingSwap.tableNameA, pendingSwap.tableNameB)}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingSwap(null)}
                disabled={pendingSwap.busy}
                className="px-3 py-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border/50 rounded-lg transition-colors disabled:opacity-40"
              >
                {T.common.cancel}
              </button>
              <button
                onClick={confirmSwap}
                disabled={pendingSwap.busy}
                className="px-3 py-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors disabled:opacity-40"
              >
                {pendingSwap.busy ? '…' : T.floorBoard.swapConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
