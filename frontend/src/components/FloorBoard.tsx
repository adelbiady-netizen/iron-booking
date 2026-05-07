import { useState, useRef, useEffect, useMemo } from 'react';
import type React from 'react';
import type { BackendTableSuggestion, FloorInsight, FloorObjectData, FloorTable, Reservation, WaitlistEntry } from '../types';
import type { PressureInfo } from '../utils/flowControl';
import { logOverride } from '../utils/flowControl';
import TableCard from './TableCard';
import TableTimeline from './TableTimeline';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName } from '../utils/displayHelpers';
import { minutesUntilRes } from '../utils/arrival';
import { minutesUntilEnd } from '../utils/time';

interface SectionGroup {
  id: string;
  name: string;
  color: string;
  tables: FloorTable[];
}

const OBJ_STYLE: Record<string, { bg: string; border: string; zone: boolean }> = {
  WALL:     { bg: '#71717abb', border: '#71717a', zone: false },
  DIVIDER:  { bg: '#52525bbb', border: '#52525b', zone: false },
  BAR:      { bg: '#92400ebb', border: '#92400e', zone: false },
  ENTRANCE: { bg: '#1e40afbb', border: '#1e40af', zone: false },
  ZONE:     { bg: '#37415120', border: '#374151', zone: true  },
};

const STATUS_BG: Record<string, string> = {
  AVAILABLE:     'rgb(var(--iron-card))',
  OCCUPIED:      'rgba(22,163,74,0.20)',
  RESERVED_SOON: 'rgba(217,119,6,0.20)',
  RESERVED:      'rgba(37,99,235,0.15)',
  BLOCKED:       'rgba(82,82,91,0.20)',
};

interface Props {
  tables: FloorTable[];
  floorObjs?: FloorObjectData[];
  selectedId: string | null;
  onSelect: (res: Reservation) => void;
  onAvailableClick?: (table: FloorTable) => void;
  insights?: FloorInsight[];
  onInsightAction?: (tableId: string, reservationId: string) => void;
  loadError?: boolean;
  errorPhase?: 'none' | 'reconnecting' | 'failed';
  onLockTable?: (table: FloorTable) => void;
  onUnlockTable?: (tableId: string) => void;
  waitlist?: WaitlistEntry[];
  waitlistMatches?: Record<string, WaitlistEntry>;
  onWaitlistSuggestion?: (tableId: string, entry: WaitlistEntry) => void;
  bestSuggestionTableId?: string | null;
  softHoldMap?: Record<string, WaitlistEntry>;
  pressureInfo?: PressureInfo;
  nowTime?: string;
  operationalNow?: number;
  reservations?: Reservation[];
  date?: string;
  onGapClick?: (tableId: string, startTime: string, endTime: string) => void;
  onGapWaitlistSeat?: (tableId: string, entry: WaitlistEntry, startTime: string, endTime: string) => void;
  onQuickAction?: (action: 'seat' | 'move' | 'cancel', res: Reservation) => void;
  // Combine-tables mode
  combineMode?: boolean;
  combinedSelection?: string[];
  onCombineToggle?: (tableId: string) => void;
  onCombineCreate?: () => void;
  // Table pick mode (Tabit-style map selection from drawer)
  pickMode?: boolean;
  pickIds?: string[];
  pickSuggestions?: BackendTableSuggestion[];
  onPickDone?: (ids: string[]) => void;
  onPickCancel?: () => void;
}

const CANVAS_W = 1500;
const CANVAS_H = 800;

function tableRadius(shape: string): string {
  if (shape === 'ROUND' || shape === 'OVAL') return '9999px';
  if (shape === 'BOOTH') return '0 0 10px 10px';
  return '8px';
}

function hasPositions(tables: FloorTable[]): boolean {
  return tables.some(t => t.posX > 5 || t.posY > 5);
}

type View = 'floor' | 'timeline';

type PickStatus = 'recommended' | 'possible' | 'tight' | 'unavailable' | null;

export default function FloorBoard({
  tables, floorObjs = [], selectedId, onSelect, onAvailableClick,
  insights = [], onInsightAction, loadError, errorPhase,
  onLockTable, onUnlockTable,
  waitlist = [], waitlistMatches = {}, onWaitlistSuggestion, bestSuggestionTableId,
  softHoldMap = {}, pressureInfo,
  nowTime, operationalNow,
  reservations = [], date,
  onGapClick, onGapWaitlistSeat, onQuickAction,
  combineMode = false, combinedSelection = [], onCombineToggle, onCombineCreate,
  pickMode = false, pickIds = [], pickSuggestions = [], onPickDone, onPickCancel,
}: Props) {
  const T = useT();
  const { locale } = useLocale();

  // Diagnostic: log whenever the occupied table set changes so ghost tables
  // can be identified from the browser console.
  const occupiedSnapshot = useMemo(() => {
    const occupied = tables.filter(t => t.liveStatus === 'OCCUPIED');
    return occupied.map(t => ({
      name: t.name,
      id: t.id,
      resId: t.currentReservation?.id ?? null,
      tableId: t.currentReservation?.tableId ?? null,
      combinedTableIds: t.currentReservation?.combinedTableIds ?? [],
    }));
  }, [tables]);

  useEffect(() => {
    console.log('[FloorBoard] occupied tables:', occupiedSnapshot);
  }, [occupiedSnapshot]);

  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [lockedWarning,    setLockedWarning]    = useState<FloorTable | null>(null);
  const [softHoldWarning,  setSoftHoldWarning]  = useState<{ table: FloorTable; entry: WaitlistEntry } | null>(null);
  const [ctxMenu,          setCtxMenu]          = useState<{ x: number; y: number; table: FloorTable } | null>(null);
  const [view,             setView]             = useState<View>('floor');

  // Pick mode state
  const [pickSelection, setPickSelection]     = useState<string[]>([]);
  const [pickWarn,      setPickWarn]          = useState<string | null>(null);
  const dragStartRef   = useRef<{ cx: number; cy: number } | null>(null);
  const isDraggingRef  = useRef(false);
  const [dragRect,      setDragRect]          = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);

  // Force floor view and sync selection when entering pick mode
  useEffect(() => {
    if (pickMode) {
      setView('floor');
      setPickSelection(pickIds);
      setPickWarn(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode]);

  // Drag-to-select — document-level mouse handlers active only in pick mode
  useEffect(() => {
    if (!pickMode) return;

    function handleMouseMove(e: MouseEvent) {
      if (!dragStartRef.current || !canvasScrollRef.current) return;
      const container = canvasScrollRef.current;
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left + container.scrollLeft;
      const cy = e.clientY - rect.top + container.scrollTop;
      const { cx: sx, cy: sy } = dragStartRef.current;
      if (Math.abs(cx - sx) > 5 || Math.abs(cy - sy) > 5) {
        isDraggingRef.current = true;
        setDragRect({
          x: Math.min(sx, cx), y: Math.min(sy, cy),
          w: Math.abs(cx - sx), h: Math.abs(cy - sy),
        });
      }
    }

    function handleMouseUp(e: MouseEvent) {
      if (isDraggingRef.current && dragStartRef.current && canvasScrollRef.current) {
        const container = canvasScrollRef.current;
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left + container.scrollLeft;
        const cy = e.clientY - rect.top + container.scrollTop;
        const { cx: sx, cy: sy } = dragStartRef.current;
        const fr = {
          x: Math.min(sx, cx), y: Math.min(sy, cy),
          w: Math.abs(cx - sx), h: Math.abs(cy - sy),
        };
        if (fr.w > 8 && fr.h > 8) {
          setPickSelection(() => {
            const newIds = tables.filter(t => {
              if (!t.isActive) return false;
              const sug = pickSuggestions.find(s => s.tableId === t.id);
              const unavail = sug
                ? sug.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED')
                : false;
              if (unavail) return false;
              return (
                t.posX < fr.x + fr.w && t.posX + t.width  > fr.x &&
                t.posY < fr.y + fr.h && t.posY + t.height > fr.y
              );
            }).map(t => t.id);
            return newIds;
          });
        }
      }
      dragStartRef.current  = null;
      isDraggingRef.current = false;
      setDragRect(null);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [pickMode, tables, pickSuggestions]);

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('button')) return;
    const container = canvasScrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragStartRef.current = {
      cx: e.clientX - rect.left + container.scrollLeft,
      cy: e.clientY - rect.top + container.scrollTop,
    };
    isDraggingRef.current = false;
  }

  function getPickStatus(t: FloorTable): PickStatus {
    const sug = pickSuggestions.find(s => s.tableId === t.id);
    if (!sug) return null;
    // Only genuine conflicts/locks are hard-unavailable; capacity mismatches (TOO_SMALL) are advisory.
    if (sug.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED')) {
      return 'unavailable';
    }
    // TOO_SMALL-only blocked → downgrade to 'tight' (selectable with warning)
    if (sug.status === 'blocked') return 'tight';
    return sug.status as PickStatus;
  }

  if (loadError) {
    if (errorPhase !== 'failed') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-iron-muted">
          <div className="w-5 h-5 border-2 border-iron-muted/40 border-t-iron-muted/80 rounded-full animate-spin mb-1" />
          <p className="text-sm">{T.floorBoard.reconnecting}</p>
          <p className="text-xs opacity-50">{T.floorBoard.reconnectingHint}</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-iron-muted">
        <div className="w-10 h-10 rounded-lg border-2 border-dashed border-red-900/40 flex items-center justify-center mb-1">
          <span className="text-lg opacity-60 text-red-400">!</span>
        </div>
        <p className="text-sm text-red-400">{T.floorBoard.errorTitle}</p>
        <p className="text-xs opacity-60">{T.floorBoard.errorHint}</p>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-iron-muted">
        <div className="w-10 h-10 rounded-lg border-2 border-dashed border-iron-border flex items-center justify-center mb-1">
          <span className="text-lg opacity-40">⊞</span>
        </div>
        <p className="text-sm">{T.floorBoard.emptyTitle}</p>
        <p className="text-xs opacity-50">{T.floorBoard.emptyHint}</p>
      </div>
    );
  }

  // ── Section groups (grid fallback) ──────────────────────────────────────────
  const sectionMap = new Map<string, SectionGroup>();
  const noSection: FloorTable[] = [];

  for (const t of tables) {
    if (t.section) {
      const key = t.section.id;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, { id: key, name: t.section.name, color: t.section.color, tables: [] });
      }
      sectionMap.get(key)!.tables.push(t);
    } else {
      noSection.push(t);
    }
  }

  const groups: SectionGroup[] = [
    ...Array.from(sectionMap.values()),
    ...(noSection.length > 0
      ? [{ id: '__none__', name: T.floorBoard.sectionOther, color: '#6B7280', tables: noSection }]
      : []),
  ];

  const sections = Array.from(sectionMap.values());

  function isSelected(t: FloorTable): boolean {
    if (!selectedId) return false;
    if (t.currentReservation?.id === selectedId) return true;
    return t.upcomingReservations.some(r => r.id === selectedId);
  }

  function handleClick(t: FloorTable) {
    // Pick mode: toggle or warn
    if (pickMode) {
      const ps = getPickStatus(t);
      if (ps === 'unavailable') {
        setPickWarn(t.name);
        setTimeout(() => setPickWarn(w => (w === t.name ? null : w)), 2500);
        return;
      }
      setPickSelection(prev =>
        prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
      );
      return;
    }
    // Combine mode: toggle available tables
    if (combineMode) {
      if (t.liveStatus === 'AVAILABLE' && !t.locked && !softHoldMap[t.id]) {
        onCombineToggle?.(t.id);
      }
      return;
    }
    const res = (t.currentReservation ?? t.upcomingReservations[0]) as Reservation | undefined;
    if (res) {
      onSelect(res);
    } else if (t.liveStatus === 'AVAILABLE') {
      if (t.locked) { setLockedWarning(t); return; }
      const held = softHoldMap[t.id];
      if (held) { setSoftHoldWarning({ table: t, entry: held }); return; }
      if (onAvailableClick) onAvailableClick(t);
    }
  }

  function handleContextMenu(e: React.MouseEvent, t: FloorTable) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 80);
    setCtxMenu({ x, y, table: t });
  }

  // ── Turn data ─────────────────────────────────────────────────────────────────
  const turnData = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (!r.tableId || !['PENDING', 'CONFIRMED'].includes(r.status)) continue;
    const arr = turnData.get(r.tableId) ?? [];
    arr.push(r);
    turnData.set(r.tableId, arr);
  }
  for (const arr of turnData.values()) arr.sort((a, b) => a.time.localeCompare(b.time));

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const available    = tables.filter(t => t.liveStatus === 'AVAILABLE').length;
  const occupied     = tables.filter(t => t.liveStatus === 'OCCUPIED').length;
  const reservedSoon = tables.filter(t => t.liveStatus === 'RESERVED_SOON').length;
  const reserved     = tables.filter(t => t.liveStatus === 'RESERVED').length;

  const positioned = hasPositions(tables);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Pick mode banner */}
      {pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-blue-900/20 border-b border-blue-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <span className="text-blue-300 text-xs font-medium flex-1">{T.floorBoard.pickModeHint}</span>
        </div>
      )}

      {/* Stats + section legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-iron-border bg-iron-card/50 shrink-0 flex-wrap">
        <Stat label={T.floorBoard.statAvailable} value={available}    color="text-iron-muted" />
        <Stat label={T.floorBoard.statSeated}    value={occupied}     color="text-iron-green-light" />
        {reservedSoon > 0 && <Stat label={T.floorBoard.statArriving} value={reservedSoon} color="text-amber-400" />}
        <Stat label={T.floorBoard.statReserved}  value={reserved}     color="text-blue-400" />

        {positioned && sections.length > 0 && (
          <>
            <div className="w-px h-3 bg-iron-border mx-1" />
            {sections.map(sec => (
              <button
                key={sec.id}
                className="flex items-center gap-1.5 transition-opacity"
                style={{ opacity: hoveredSectionId !== null && hoveredSectionId !== sec.id ? 0.4 : 1 }}
                onMouseEnter={() => setHoveredSectionId(sec.id)}
                onMouseLeave={() => setHoveredSectionId(null)}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sec.color }} />
                <span className="text-iron-muted text-xs">{formatSectionName(sec.name, locale)}</span>
              </button>
            ))}
          </>
        )}

        {pressureInfo && pressureInfo.level !== 'LOW' && (
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-medium ${
            pressureInfo.level === 'HIGH'
              ? 'bg-red-900/20 border-red-500/25 text-red-400'
              : 'bg-amber-900/20 border-amber-500/25 text-amber-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pressureInfo.level === 'HIGH' ? 'bg-red-500' : 'bg-amber-500'}`} />
            {pressureInfo.level === 'HIGH' ? T.flowControl.pressureHigh : T.flowControl.pressureMed}
            {pressureInfo.label && <span className="opacity-70">· {pressureInfo.label}</span>}
          </div>
        )}

        <span className="ml-auto text-xs text-iron-muted">{T.floorBoard.tableCount(tables.length)}</span>

        <div className="flex items-center gap-px ml-3 rounded border border-iron-border overflow-hidden shrink-0">
          {(['floor', 'timeline'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => !pickMode && setView(v)}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                view === v
                  ? 'bg-iron-green/20 text-iron-green-light'
                  : 'text-iron-muted hover:text-iron-text hover:bg-iron-border/30'
              } ${pickMode ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {v === 'floor' ? T.floorBoard.viewFloor : T.floorBoard.viewTimeline}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline view */}
      {view === 'timeline' && !pickMode && date && (
        <TableTimeline
          tables={tables}
          reservations={reservations}
          date={date}
          operationalNow={operationalNow ?? Date.now()}
          selectedId={selectedId}
          onSelect={onSelect}
          waitlist={waitlist}
          onGapClick={onGapClick}
          onGapWaitlistSeat={onGapWaitlistSeat}
          onQuickAction={onQuickAction}
        />
      )}

      {(view === 'floor' || pickMode) && (positioned ? (
        // ── Visual floor map ──────────────────────────────────────────────────
        <div ref={canvasScrollRef} className="flex-1 overflow-auto">
          <div
            onMouseDown={pickMode ? handleCanvasMouseDown : undefined}
            style={{
              position: 'relative',
              width: CANVAS_W,
              height: CANVAS_H,
              backgroundColor: 'var(--canvas-bg)',
              backgroundImage: 'radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              userSelect: pickMode ? 'none' : undefined,
            }}
          >
            {/* Floor objects */}
            {floorObjs.map(o => {
              const s = OBJ_STYLE[o.kind] ?? OBJ_STYLE['WALL'];
              return (
                <div
                  key={o.id}
                  style={{
                    position: 'absolute',
                    left: o.posX, top: o.posY,
                    width: o.width, height: o.height,
                    backgroundColor: s.bg,
                    border: `1.5px solid ${s.border}`,
                    borderRadius: s.zone ? 8 : 3,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ fontSize: 10, color: 'rgb(var(--iron-text))', opacity: 0.8, userSelect: 'none', padding: '0 4px', textAlign: 'center' }}>
                    {o.label}
                  </span>
                </div>
              );
            })}

            {tables.map(t => {
              const insight    = insights.find(i => i.tableId === t.id);
              const dimmed     = !pickMode && hoveredSectionId !== null && t.section?.id !== hoveredSectionId;
              const wMatch     = waitlistMatches[t.id];
              const turns      = turnData.get(t.id) ?? [];
              const extraTurns = Math.max(0, turns.length - 1);
              const turnTooltip = turns.length > 0
                ? `${t.name} · upcoming:\n${turns.map(r => `${r.time}  ${r.guestName}  ·  ${r.partySize}p`).join('\n')}`
                : undefined;
              const ps = pickMode ? getPickStatus(t) : null;
              return (
                <MapTable
                  key={t.id}
                  table={t}
                  selected={!pickMode && isSelected(t)}
                  combinedSelected={!pickMode && combinedSelection.includes(t.id)}
                  dimmed={dimmed}
                  bestSuggestion={!pickMode && !isSelected(t) && t.id === bestSuggestionTableId}
                  softHold={!pickMode ? softHoldMap[t.id] : undefined}
                  onClick={() => handleClick(t)}
                  onContextMenu={e => !pickMode && handleContextMenu(e, t)}
                  insight={!pickMode ? insight : undefined}
                  onInsightAction={
                    !pickMode && insight?.reservationId
                      ? () => onInsightAction?.(t.id, insight.reservationId!)
                      : undefined
                  }
                  waitlistMatch={!pickMode ? wMatch : undefined}
                  onWaitlistAction={!pickMode && wMatch ? () => onWaitlistSuggestion?.(t.id, wMatch) : undefined}
                  nowTime={nowTime}
                  operationalNow={operationalNow}
                  date={date}
                  extraTurns={pickMode ? 0 : extraTurns}
                  turnTooltip={pickMode ? undefined : turnTooltip}
                  pickMode={pickMode}
                  pickSelected={pickMode && pickSelection.includes(t.id)}
                  pickStatus={ps}
                />
              );
            })}

            {/* Drag selection rect */}
            {pickMode && dragRect && (
              <div
                style={{
                  position: 'absolute',
                  left: dragRect.x, top: dragRect.y,
                  width: dragRect.w, height: dragRect.h,
                  border: '1.5px solid rgba(59,130,246,0.7)',
                  backgroundColor: 'rgba(59,130,246,0.07)',
                  pointerEvents: 'none',
                  zIndex: 100,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        // ── Grouped grid (fallback when no positions saved) ────────────────────
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {groups.map(group => (
            <section key={group.id}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                <h3 className="text-iron-muted text-xs font-semibold uppercase tracking-wider">
                  {formatSectionName(group.name, locale)}
                </h3>
                <div className="flex-1 h-px bg-iron-border" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                {group.tables.map(t => {
                  const insight    = insights.find(i => i.tableId === t.id);
                  const wMatch     = waitlistMatches[t.id];
                  const turns      = turnData.get(t.id) ?? [];
                  const extraTurns = Math.max(0, turns.length - 1);
                  const turnTooltip = turns.length > 0
                    ? `${t.name} · upcoming:\n${turns.map(r => `${r.time}  ${r.guestName}  ·  ${r.partySize}p`).join('\n')}`
                    : undefined;
                  const isPickSelected = pickMode && pickSelection.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      className={
                        isPickSelected || combinedSelection.includes(t.id)
                          ? 'ring-2 ring-blue-500/50 rounded-lg'
                          : ''
                      }
                    >
                      <TableCard
                        table={t}
                        selected={!pickMode && isSelected(t)}
                        isBestSuggestion={!pickMode && !isSelected(t) && t.id === bestSuggestionTableId}
                        softHold={!pickMode ? softHoldMap[t.id] : undefined}
                        onClick={() => handleClick(t)}
                        onContextMenu={e => !pickMode && handleContextMenu(e, t)}
                        insight={!pickMode ? insight : undefined}
                        onInsightAction={
                          !pickMode && insight?.reservationId
                            ? () => onInsightAction?.(t.id, insight.reservationId!)
                            : undefined
                        }
                        waitlistMatch={!pickMode ? wMatch : undefined}
                        onWaitlistAction={!pickMode && wMatch ? () => onWaitlistSuggestion?.(t.id, wMatch) : undefined}
                        nowTime={nowTime}
                        operationalNow={operationalNow}
                        date={date}
                        extraTurns={pickMode ? 0 : extraTurns}
                        turnTooltip={pickMode ? undefined : turnTooltip}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ))}

      {/* Right-click context menu */}
      {ctxMenu && !pickMode && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-50 bg-iron-card border border-iron-border rounded-lg shadow-xl py-1 min-w-[10rem]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <div className="px-3 py-1 border-b border-iron-border/50 mb-1">
              <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-wider">{ctxMenu.table.name}</span>
            </div>
            {ctxMenu.table.locked ? (
              <button
                onClick={() => { onUnlockTable?.(ctxMenu.table.id); setCtxMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-xs text-iron-text hover:bg-iron-bg transition-colors"
              >
                {T.floorBoard.unlockTable}
              </button>
            ) : (
              <button
                onClick={() => { onLockTable?.(ctxMenu.table); setCtxMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-xs text-iron-text hover:bg-iron-bg transition-colors"
              >
                {T.floorBoard.lockTable}
              </button>
            )}
          </div>
        </>
      )}

      {/* Locked table warning */}
      {lockedWarning && !pickMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-iron-card border border-iron-border rounded-xl shadow-2xl p-5 w-72 space-y-3">
            <div>
              <p className="text-iron-text text-sm font-semibold">{T.floorBoard.lockedTitle(lockedWarning.name)}</p>
              {lockedWarning.lockReason && (
                <p className="text-iron-muted text-xs mt-0.5">{lockedWarning.lockReason}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => { const t = lockedWarning; setLockedWarning(null); onUnlockTable?.(t.id); }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-iron-bg border border-iron-border text-iron-text hover:border-iron-text/40 transition-colors"
              >
                {T.floorBoard.unlockTable}
              </button>
              <button
                onClick={() => { const t = lockedWarning; setLockedWarning(null); onAvailableClick?.(t); }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 transition-colors"
              >
                {T.floorBoard.seatAnyway}
              </button>
              <button
                onClick={() => setLockedWarning(null)}
                className="text-xs text-iron-muted hover:text-iron-text py-1.5 transition-colors"
              >
                {T.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Soft hold warning */}
      {softHoldWarning && !pickMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-iron-card border border-iron-border rounded-xl shadow-2xl p-5 w-72 space-y-3">
            <div>
              <p className="text-iron-text text-sm font-semibold">
                {T.flowControl.softHoldTitle(softHoldWarning.entry.guestName)}
              </p>
              <p className="text-iron-muted text-xs mt-0.5">
                {T.common.guests(softHoldWarning.entry.partySize)}
                {' · '}
                {T.flowControl.softHoldWaiting(
                  Math.floor((Date.now() - new Date(softHoldWarning.entry.addedAt).getTime()) / 60_000)
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => {
                  const { table, entry } = softHoldWarning;
                  setSoftHoldWarning(null);
                  onWaitlistSuggestion?.(table.id, entry);
                }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-iron-green/15 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/25 transition-colors font-medium"
              >
                {T.flowControl.softHoldSeat(softHoldWarning.entry.guestName)}
              </button>
              <button
                onClick={() => {
                  const { table, entry } = softHoldWarning;
                  logOverride(table.id, entry);
                  setSoftHoldWarning(null);
                  onAvailableClick?.(table);
                }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-iron-bg border border-iron-border text-iron-muted hover:text-iron-text hover:border-iron-text/30 transition-colors"
              >
                {T.flowControl.softHoldIgnore}
              </button>
              <button
                onClick={() => setSoftHoldWarning(null)}
                className="text-xs text-iron-muted hover:text-iron-text py-1.5 transition-colors"
              >
                {T.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pick mode action bar */}
      {pickMode && (
        <div className="shrink-0 border-t border-blue-500/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {pickWarn ? (
              <span className="text-red-400 text-xs font-medium">{T.floorBoard.pickModeUnavailable(pickWarn)}</span>
            ) : pickSelection.length === 0 ? (
              <span className="text-blue-400 text-sm">{T.floorBoard.pickModeHint}</span>
            ) : (
              <span className="text-iron-text text-sm font-semibold truncate">
                {pickSelection.map(id => tables.find(t => t.id === id)?.name ?? id).join(' + ')}
                <span className="text-iron-muted font-normal text-xs ml-1.5">
                  · {T.floorBoard.pickModeSelected(pickSelection.length)}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onPickCancel}
            className="text-iron-muted text-xs hover:text-iron-text transition-colors shrink-0"
          >
            {T.floorBoard.pickModeCancel}
          </button>
          <button
            type="button"
            onClick={() => onPickDone?.(pickSelection)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            {T.floorBoard.pickModeConfirm}
          </button>
        </div>
      )}

      {/* Combine-tables action bar */}
      {!pickMode && combineMode && (
        <div className="shrink-0 border-t border-blue-500/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          {combinedSelection.length === 0 ? (
            <span className="text-blue-400 text-sm flex-1">{T.floorBoard.combineHint}</span>
          ) : (
            <>
              <span className="text-iron-text text-sm font-semibold flex-1 truncate">
                {combinedSelection
                  .map(id => tables.find(t => t.id === id)?.name ?? id)
                  .join(' + ')}
              </span>
              <button
                type="button"
                onClick={onCombineCreate}
                disabled={combinedSelection.length < 1}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
              >
                {T.floorBoard.combineCreate}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-iron-muted text-xs">{label}</span>
    </div>
  );
}

// ── Canvas table card ─────────────────────────────────────────────────────────

function MapTable({ table, selected, combinedSelected, dimmed, bestSuggestion, softHold, onClick, onContextMenu, insight, onInsightAction, waitlistMatch, onWaitlistAction, nowTime, operationalNow: _operationalNow, extraTurns = 0, turnTooltip, pickMode = false, pickSelected = false, pickStatus = null, date }: {
  table: FloorTable;
  selected: boolean;
  combinedSelected: boolean;
  dimmed: boolean;
  bestSuggestion?: boolean;
  softHold?: WaitlistEntry;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  insight?: FloorInsight;
  onInsightAction?: () => void;
  waitlistMatch?: WaitlistEntry;
  onWaitlistAction?: () => void;
  nowTime?: string;
  operationalNow?: number;
  extraTurns?: number;
  turnTooltip?: string;
  pickMode?: boolean;
  pickSelected?: boolean;
  pickStatus?: PickStatus;
  date?: string;
}) {
  const T = useT();
  const todayStr = new Date().toISOString().slice(0, 10);
  const isFutureDate = !!date && date > todayStr;
  const nextRes = table.upcomingReservations[0] as (typeof table.upcomingReservations[0] & { minutesUntil: number }) | undefined;
  const arrMins = nowTime && nextRes
    ? minutesUntilRes(nextRes.time, nowTime)
    : nextRes?.minutesUntil ?? null;
  const isNoShowRisk = !isFutureDate && arrMins !== null && arrMins <= -15;
  const isLate       = !isFutureDate && arrMins !== null && arrMins < -5 && !isNoShowRisk;

  const sectionColor = table.section?.color ?? '#3f3f46';

  // Base (non-pick) colors
  let bg = isNoShowRisk ? 'rgba(239,68,68,0.15)'
    : isLate       ? 'rgba(249,115,22,0.15)'
    : softHold && table.liveStatus === 'AVAILABLE' ? 'rgba(99,102,241,0.10)'
    : (STATUS_BG[table.liveStatus] ?? STATUS_BG['AVAILABLE']);

  let borderColor = selected        ? '#22c55e'
    : combinedSelected ? '#3b82f6'
    : isNoShowRisk   ? '#ef4444'
    : isLate         ? '#f97316'
    : softHold && table.liveStatus === 'AVAILABLE' ? '#6366f1'
    : table.locked   ? '#f59e0b'
    : sectionColor;

  let borderWidth = selected || combinedSelected || (softHold && table.liveStatus === 'AVAILABLE') ? 2 : 1.5;

  let boxShadow: string | undefined = selected
    ? '0 0 0 3px rgba(34,197,94,0.25)'
    : combinedSelected
    ? '0 0 0 3px rgba(59,130,246,0.30)'
    : softHold && table.liveStatus === 'AVAILABLE'
    ? '0 0 0 3px rgba(99,102,241,0.20), 0 0 10px rgba(99,102,241,0.12)'
    : bestSuggestion
    ? '0 0 0 3px rgba(34,197,94,0.18), 0 0 10px rgba(34,197,94,0.12)'
    : table.locked ? '0 0 0 2px rgba(245,158,11,0.15)' : undefined;

  let opacity = dimmed ? 0.25 : table.locked ? 0.55 : 1;
  let cursor = 'pointer';

  // Pick mode overrides
  if (pickMode) {
    if (pickSelected) {
      bg          = 'rgba(59,130,246,0.22)';
      borderColor = '#3b82f6';
      borderWidth = 2;
      boxShadow   = '0 0 0 3px rgba(59,130,246,0.35)';
      opacity     = 1;
    } else {
      switch (pickStatus) {
        case 'recommended':
          bg          = 'rgba(22,163,74,0.12)';
          borderColor = '#22c55e';
          borderWidth = 1.5;
          boxShadow   = '0 0 0 2px rgba(34,197,94,0.15)';
          opacity     = 1;
          break;
        case 'possible':
          bg          = 'rgba(37,99,235,0.10)';
          borderColor = '#3b82f6';
          borderWidth = 1.5;
          opacity     = 1;
          break;
        case 'tight':
          bg          = 'rgba(217,119,6,0.10)';
          borderColor = '#d97706';
          borderWidth = 1.5;
          opacity     = 1;
          break;
        case 'unavailable':
          bg          = 'rgba(82,82,91,0.08)';
          borderColor = '#52525b';
          borderWidth = 1;
          boxShadow   = undefined;
          opacity     = 0.4;
          cursor      = 'not-allowed';
          break;
        default:
          bg          = 'rgba(82,82,91,0.08)';
          borderColor = '#52525b';
          borderWidth = 1;
          opacity     = 0.85;
          break;
      }
    }
  }

  const currentRes = table.currentReservation;
  const displayRes = currentRes ?? nextRes ?? null;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={turnTooltip}
      style={{
        position: 'absolute',
        left: table.posX, top: table.posY,
        width: table.width, height: table.height,
        borderRadius: tableRadius(table.shape),
        border: `${borderWidth}px solid ${borderColor}`,
        backgroundColor: bg,
        boxShadow,
        opacity,
        padding: '5px 7px',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        textAlign: 'left',
        cursor,
        transition: 'opacity 0.15s, border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Name + priority dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--iron-text))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {table.name}
        </span>
        {!pickMode && insight?.priority === 'HIGH'   && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} />}
        {!pickMode && insight?.priority === 'MEDIUM' && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#f59e0b', flexShrink: 0 }} />}
        {pickMode && pickSelected && (
          <span style={{ fontSize: 9, color: '#93c5fd', fontWeight: 700, flexShrink: 0 }}>✓</span>
        )}
        {pickMode && !pickSelected && pickStatus === 'recommended' && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0 }} />
        )}
      </div>

      {/* Capacity */}
      <span style={{ fontSize: 9, color: 'rgb(var(--iron-muted))', lineHeight: 1.3, marginTop: 1 }}>
        {table.minCovers}–{table.maxCovers} {T.tableCard.covers}
      </span>

      {/* OCCUPIED — only show detail when not in pick mode */}
      {!pickMode && table.liveStatus === 'OCCUPIED' && currentRes && (() => {
        const mr = minutesUntilEnd(currentRes.expectedEndTime, Date.now());
        const isCombined  = currentRes.combinedTableIds.length > 0;
        const isSecondary = isCombined && currentRes.combinedTableIds.includes(table.id);
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
              <p style={{ fontSize: 10, color: 'var(--canvas-status-occupied)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {currentRes.guestName}
              </p>
              {isCombined && (
                <span style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 3, padding: '0 2px', flexShrink: 0 }}>
                  ⊞
                </span>
              )}
            </div>
            {!isSecondary && (
              <p style={{ fontSize: 9, color: 'rgb(var(--iron-muted))' }}>
                {currentRes.partySize} ·{' '}
                {mr > 5
                  ? T.floorBoard.mLeft(mr)
                  : mr >= -5
                  ? T.floorBoard.ending
                  : T.floorBoard.mOver(Math.abs(mr))}
              </p>
            )}
          </div>
        );
      })()}

      {/* RESERVED / RESERVED_SOON — only show detail when not in pick mode */}
      {!pickMode && (table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON') && displayRes && (() => {
        const isCombined  = (displayRes.combinedTableIds?.length ?? 0) > 0;
        const isSecondary = isCombined && displayRes.combinedTableIds?.includes(table.id);
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
              <p style={{ fontSize: 10, color: 'var(--canvas-status-reserved)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {displayRes.guestName}
              </p>
              {isCombined && (
                <span style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 3, padding: '0 2px', flexShrink: 0 }}>
                  ⊞
                </span>
              )}
            </div>
            {!isSecondary && nextRes && (
              <p style={{ fontSize: 9, color: 'rgb(var(--iron-muted))' }}>
                {nextRes.partySize} · {nextRes.minutesUntil > 0 ? T.floorBoard.inNMin(nextRes.minutesUntil) : nextRes.time}
              </p>
            )}
          </div>
        );
      })()}

      {/* BLOCKED */}
      {!pickMode && table.liveStatus === 'BLOCKED' && (
        <p style={{ fontSize: 9, color: 'rgb(var(--iron-muted))', marginTop: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {table.blockReason ?? 'Blocked'}
        </p>
      )}

      {/* AVAILABLE + soft hold */}
      {!pickMode && table.liveStatus === 'AVAILABLE' && softHold && !insight && (
        <div style={{
          marginTop: 'auto', width: '100%',
          backgroundColor: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)',
          borderRadius: 4, padding: '2px 4px',
        }}>
          <p style={{ fontSize: 9, color: '#a5b4fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⏸ {softHold.guestName} · {softHold.partySize}
          </p>
        </div>
      )}

      {/* AVAILABLE + SEAT_NOW insight */}
      {!pickMode && table.liveStatus === 'AVAILABLE' && insight?.type === 'SEAT_NOW' && insight.reservation && (
        <div
          onClick={(e) => { e.stopPropagation(); onInsightAction?.(); }}
          style={{
            marginTop: 'auto', width: '100%',
            backgroundColor: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 9, color: 'var(--canvas-status-occupied)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {insight.reservation.guestName}
          </p>
        </div>
      )}

      {/* AVAILABLE + waitlist match */}
      {!pickMode && table.liveStatus === 'AVAILABLE' && !insight && waitlistMatch && (
        <div
          onClick={(e) => { e.stopPropagation(); onWaitlistAction?.(); }}
          style={{
            marginTop: 'auto', width: '100%',
            backgroundColor: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 9, color: 'var(--canvas-status-occupied)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {waitlistMatch.guestName} · {waitlistMatch.partySize}
          </p>
        </div>
      )}

      {/* Lock badge */}
      {table.locked && (
        <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <span style={{
            fontSize: 8, color: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 3, padding: '1px 4px', letterSpacing: '0.04em', userSelect: 'none',
          }}>
            LOCKED
          </span>
        </div>
      )}

      {/* Turn count badge */}
      {!pickMode && extraTurns > 0 && (
        <span style={{
          position: 'absolute', top: 3, right: 3,
          fontSize: 9, fontWeight: 700, color: '#60a5fa',
          backgroundColor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: 3, padding: '1px 4px', userSelect: 'none', lineHeight: 1.4,
        }}>
          +{extraTurns}
        </span>
      )}

      {/* Section color dot */}
      {!pickMode && table.section?.color && !table.locked && (
        <span style={{
          position: 'absolute', bottom: 4, right: 4,
          width: 5, height: 5, borderRadius: '50%',
          backgroundColor: table.section.color, opacity: 0.9,
        }} />
      )}
    </button>
  );
}
