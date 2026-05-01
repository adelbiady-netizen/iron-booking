import { useState } from 'react';
import type React from 'react';
import type { FloorInsight, FloorObjectData, FloorTable, Reservation, WaitlistEntry } from '../types';
import type { PressureInfo } from '../utils/flowControl';
import { logOverride } from '../utils/flowControl';
import TableCard from './TableCard';
import TableTimeline from './TableTimeline';
import { T } from '../strings';
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

// Status-driven background — section color drives the border
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

export default function FloorBoard({
  tables, floorObjs = [], selectedId, onSelect, onAvailableClick,
  insights = [], onInsightAction, loadError, errorPhase,
  onLockTable, onUnlockTable,
  waitlist = [], waitlistMatches = {}, onWaitlistSuggestion, bestSuggestionTableId,
  softHoldMap = {}, pressureInfo,
  nowTime, operationalNow,
  reservations = [], date,
  onGapClick, onGapWaitlistSeat, onQuickAction,
}: Props) {
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [lockedWarning,    setLockedWarning]    = useState<FloorTable | null>(null);
  const [softHoldWarning,  setSoftHoldWarning]  = useState<{ table: FloorTable; entry: WaitlistEntry } | null>(null);
  const [ctxMenu,          setCtxMenu]          = useState<{ x: number; y: number; table: FloorTable } | null>(null);
  const [view,             setView]             = useState<View>('floor');

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
      ? [{ id: '__none__', name: 'Other', color: '#6B7280', tables: noSection }]
      : []),
  ];

  // Unique sections for the canvas legend
  const sections = Array.from(sectionMap.values());

  function isSelected(t: FloorTable): boolean {
    if (!selectedId) return false;
    if (t.currentReservation?.id === selectedId) return true;
    return t.upcomingReservations.some(r => r.id === selectedId);
  }

  function handleClick(t: FloorTable) {
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

  // ── Stats ───────────────────────────────────────────────────────────────────
  const available    = tables.filter(t => t.liveStatus === 'AVAILABLE').length;
  const occupied     = tables.filter(t => t.liveStatus === 'OCCUPIED').length;
  const reservedSoon = tables.filter(t => t.liveStatus === 'RESERVED_SOON').length;
  const reserved     = tables.filter(t => t.liveStatus === 'RESERVED').length;

  const positioned = hasPositions(tables);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Stats + section legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-iron-border bg-iron-card/50 shrink-0 flex-wrap">
        <Stat label={T.floorBoard.statAvailable} value={available}    color="text-iron-muted" />
        <Stat label={T.floorBoard.statSeated}    value={occupied}     color="text-iron-green-light" />
        {reservedSoon > 0 && <Stat label={T.floorBoard.statArriving} value={reservedSoon} color="text-amber-400" />}
        <Stat label={T.floorBoard.statReserved}  value={reserved}     color="text-blue-400" />

        {/* Section legend — only shown in canvas mode */}
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
                <span className="text-iron-muted text-xs">{sec.name}</span>
              </button>
            ))}
          </>
        )}

        {/* Pressure indicator — only shown under MEDIUM/HIGH load */}
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

        {/* View toggle */}
        <div className="flex items-center gap-px ml-3 rounded border border-iron-border overflow-hidden shrink-0">
          {(['floor', 'timeline'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                view === v
                  ? 'bg-iron-green/20 text-iron-green-light'
                  : 'text-iron-muted hover:text-iron-text hover:bg-iron-border/30'
              }`}
            >
              {v === 'floor' ? T.floorBoard.viewFloor : T.floorBoard.viewTimeline}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline view */}
      {view === 'timeline' && date && (
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

      {view === 'floor' && (positioned ? (
        // ── Visual floor map ──────────────────────────────────────────────────
        <div className="flex-1 overflow-auto">
          <div
            style={{
              position: 'relative',
              width: CANVAS_W,
              height: CANVAS_H,
              backgroundColor: 'var(--canvas-bg)',
              backgroundImage: 'radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          >
            {/* Floor objects rendered beneath tables */}
            {floorObjs.map(o => {
              const s = OBJ_STYLE[o.kind] ?? OBJ_STYLE['WALL'];
              return (
                <div
                  key={o.id}
                  style={{
                    position: 'absolute',
                    left: o.posX,
                    top: o.posY,
                    width: o.width,
                    height: o.height,
                    backgroundColor: s.bg,
                    border: `1.5px solid ${s.border}`,
                    borderRadius: s.zone ? 8 : 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
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
              const insight = insights.find(i => i.tableId === t.id);
              const dimmed  = hoveredSectionId !== null && t.section?.id !== hoveredSectionId;
              const wMatch  = waitlistMatches[t.id];
              return (
                <MapTable
                  key={t.id}
                  table={t}
                  selected={isSelected(t)}
                  dimmed={dimmed}
                  bestSuggestion={!isSelected(t) && t.id === bestSuggestionTableId}
                  softHold={softHoldMap[t.id]}
                  onClick={() => handleClick(t)}
                  onContextMenu={e => handleContextMenu(e, t)}
                  insight={insight}
                  onInsightAction={
                    insight?.reservationId
                      ? () => onInsightAction?.(t.id, insight.reservationId!)
                      : undefined
                  }
                  waitlistMatch={wMatch}
                  onWaitlistAction={wMatch ? () => onWaitlistSuggestion?.(t.id, wMatch) : undefined}
                  nowTime={nowTime}
                  operationalNow={operationalNow}
                />
              );
            })}
          </div>
        </div>
      ) : (
        // ── Grouped grid (fallback when no positions saved) ────────────────────
        <div className="flex-1 overflow-y-auto p-4 space-y-6">

          {groups.map(group => (
            <section key={group.id}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
                <h3 className="text-iron-muted text-xs font-semibold uppercase tracking-wider">
                  {group.name}
                </h3>
                <div className="flex-1 h-px bg-iron-border" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                {group.tables.map(t => {
                  const insight = insights.find(i => i.tableId === t.id);
                  const wMatch = waitlistMatches[t.id];
                  return (
                    <TableCard
                      key={t.id}
                      table={t}
                      selected={isSelected(t)}
                      isBestSuggestion={!isSelected(t) && t.id === bestSuggestionTableId}
                      softHold={softHoldMap[t.id]}
                      onClick={() => handleClick(t)}
                      onContextMenu={e => handleContextMenu(e, t)}
                      insight={insight}
                      onInsightAction={
                        insight?.reservationId
                          ? () => onInsightAction?.(t.id, insight.reservationId!)
                          : undefined
                      }
                      waitlistMatch={wMatch}
                      onWaitlistAction={wMatch ? () => onWaitlistSuggestion?.(t.id, wMatch) : undefined}
                      nowTime={nowTime}
                      operationalNow={operationalNow}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ))}

      {/* Right-click context menu */}
      {ctxMenu && (
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

      {/* Seating-attempt warning for locked available tables */}
      {lockedWarning && (
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

      {/* Soft hold warning — host clicked a table held for a waitlist guest */}
      {softHoldWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-iron-card border border-iron-border rounded-xl shadow-2xl p-5 w-72 space-y-3">
            <div>
              <p className="text-iron-text text-sm font-semibold">
                {T.flowControl.softHoldTitle(softHoldWarning.entry.guestName)}
              </p>
              <p className="text-iron-muted text-xs mt-0.5">
                {softHoldWarning.entry.partySize} guests
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

function MapTable({ table, selected, dimmed, bestSuggestion, softHold, onClick, onContextMenu, insight, onInsightAction, waitlistMatch, onWaitlistAction, nowTime }: {
  table: FloorTable;
  selected: boolean;
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
}) {
  // Detect late arrival: RESERVED_SOON tables whose upcoming reservation is past due
  const nextRes = table.upcomingReservations[0] as (typeof table.upcomingReservations[0] & { minutesUntil: number }) | undefined;
  const arrMins = nowTime && nextRes
    ? minutesUntilRes(nextRes.time, nowTime)
    : nextRes?.minutesUntil ?? null;
  const isNoShowRisk = arrMins !== null && arrMins <= -15;
  const isLate       = arrMins !== null && arrMins < -5 && !isNoShowRisk;

  const bg = isNoShowRisk ? 'rgba(239,68,68,0.15)'
           : isLate       ? 'rgba(249,115,22,0.15)'
           : softHold && table.liveStatus === 'AVAILABLE' ? 'rgba(99,102,241,0.10)'
           : (STATUS_BG[table.liveStatus] ?? STATUS_BG['AVAILABLE']);
  const sectionColor = table.section?.color ?? '#3f3f46';
  const borderColor  = selected      ? '#22c55e'
                     : isNoShowRisk  ? '#ef4444'
                     : isLate        ? '#f97316'
                     : softHold && table.liveStatus === 'AVAILABLE' ? '#6366f1'
                     : table.locked  ? '#f59e0b'
                     : sectionColor;
  const borderWidth  = selected || (softHold && table.liveStatus === 'AVAILABLE') ? 2 : 1.5;
  const currentRes   = table.currentReservation;
  const displayRes   = currentRes ?? nextRes ?? null;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        position: 'absolute',
        left: table.posX,
        top: table.posY,
        width: table.width,
        height: table.height,
        borderRadius: tableRadius(table.shape),
        border: `${borderWidth}px solid ${borderColor}`,
        backgroundColor: bg,
        boxShadow: selected
          ? '0 0 0 3px rgba(34,197,94,0.25)'
          : softHold && table.liveStatus === 'AVAILABLE'
          ? '0 0 0 3px rgba(99,102,241,0.20), 0 0 10px rgba(99,102,241,0.12)'
          : bestSuggestion
          ? '0 0 0 3px rgba(34,197,94,0.18), 0 0 10px rgba(34,197,94,0.12)'
          : table.locked ? '0 0 0 2px rgba(245,158,11,0.15)' : undefined,
        opacity: dimmed ? 0.25 : table.locked ? 0.55 : 1,
        padding: '5px 7px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'opacity 0.15s, border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Name + priority dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--iron-text))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {table.name}
        </span>
        {insight?.priority === 'HIGH'   && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} />}
        {insight?.priority === 'MEDIUM' && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#f59e0b', flexShrink: 0 }} />}
      </div>

      {/* Capacity */}
      <span style={{ fontSize: 9, color: 'rgb(var(--iron-muted))', lineHeight: 1.3, marginTop: 1 }}>
        {table.minCovers}–{table.maxCovers} covers
      </span>

      {/* OCCUPIED */}
      {table.liveStatus === 'OCCUPIED' && currentRes && (() => {
        const mr = minutesUntilEnd(currentRes.expectedEndTime, Date.now());
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <p style={{ fontSize: 10, color: 'var(--canvas-status-occupied)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentRes.guestName}
            </p>
            <p style={{ fontSize: 9, color: 'rgb(var(--iron-muted))' }}>
              {currentRes.partySize} ·{' '}
              {mr > 5
                ? T.floorBoard.mLeft(mr)
                : mr >= -5
                ? T.floorBoard.ending
                : T.floorBoard.mOver(Math.abs(mr))}
            </p>
          </div>
        );
      })()}

      {/* RESERVED / RESERVED_SOON */}
      {(table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON') && displayRes && (
        <div style={{ marginTop: 'auto', width: '100%' }}>
          <p style={{ fontSize: 10, color: 'var(--canvas-status-reserved)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayRes.guestName}
          </p>
          {nextRes && (
            <p style={{ fontSize: 9, color: 'rgb(var(--iron-muted))' }}>
              {nextRes.partySize} · {nextRes.minutesUntil > 0 ? T.floorBoard.inNMin(nextRes.minutesUntil) : nextRes.time}
            </p>
          )}
        </div>
      )}

      {/* BLOCKED */}
      {table.liveStatus === 'BLOCKED' && (
        <p style={{ fontSize: 9, color: 'rgb(var(--iron-muted))', marginTop: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {table.blockReason ?? 'Blocked'}
        </p>
      )}

      {/* AVAILABLE + soft hold: table is mentally reserved for a waitlist guest */}
      {table.liveStatus === 'AVAILABLE' && softHold && !insight && (
        <div style={{
          marginTop: 'auto',
          width: '100%',
          backgroundColor: 'rgba(99,102,241,0.12)',
          border: '1px solid rgba(99,102,241,0.35)',
          borderRadius: 4,
          padding: '2px 4px',
        }}>
          <p style={{ fontSize: 9, color: '#a5b4fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⏸ {softHold.guestName} · {softHold.partySize}
          </p>
        </div>
      )}

      {/* AVAILABLE + SEAT_NOW insight */}
      {table.liveStatus === 'AVAILABLE' && insight?.type === 'SEAT_NOW' && insight.reservation && (
        <div
          onClick={(e) => { e.stopPropagation(); onInsightAction?.(); }}
          style={{
            marginTop: 'auto',
            width: '100%',
            backgroundColor: 'rgba(22,163,74,0.15)',
            border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 4,
            padding: '2px 4px',
            cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 9, color: 'var(--canvas-status-occupied)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {insight.reservation.guestName}
          </p>
        </div>
      )}

      {/* AVAILABLE + waitlist match (when no SEAT_NOW insight) */}
      {table.liveStatus === 'AVAILABLE' && !insight && waitlistMatch && (
        <div
          onClick={(e) => { e.stopPropagation(); onWaitlistAction?.(); }}
          style={{
            marginTop: 'auto',
            width: '100%',
            backgroundColor: 'rgba(22,163,74,0.15)',
            border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 4,
            padding: '2px 4px',
            cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 9, color: 'var(--canvas-status-occupied)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {waitlistMatch.guestName} · {waitlistMatch.partySize}
          </p>
        </div>
      )}

      {/* Lock badge */}
      {table.locked && (
        <div style={{
          position: 'absolute',
          bottom: 3,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 8,
            color: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 3,
            padding: '1px 4px',
            letterSpacing: '0.04em',
            userSelect: 'none',
          }}>
            LOCKED
          </span>
        </div>
      )}

      {/* Section color dot (bottom-right) */}
      {table.section?.color && !table.locked && (
        <span style={{
          position: 'absolute',
          bottom: 4,
          right: 4,
          width: 5,
          height: 5,
          borderRadius: '50%',
          backgroundColor: table.section.color,
          opacity: 0.9,
        }} />
      )}
    </button>
  );
}
