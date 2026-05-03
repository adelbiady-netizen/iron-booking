import { useRef, useEffect, useMemo, useState } from 'react';
import type { FloorTable, Reservation, WaitlistEntry } from '../types';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName } from '../utils/displayHelpers';

// ── Zoom levels ───────────────────────────────────────────────────────────────
type ZoomLevel = 15 | 30 | 60;

const ZOOM_CONFIG: Record<ZoomLevel, { pxPerMin: number; tickMajor: number; tickMinor: number }> = {
  15: { pxPerMin: 6.5, tickMajor: 60,  tickMinor: 15 },
  30: { pxPerMin: 3.5, tickMajor: 60,  tickMinor: 30 },
  60: { pxPerMin: 1.8, tickMajor: 120, tickMinor: 60 },
};

// ── Layout (zoom-independent) ─────────────────────────────────────────────────
const BEFORE_NOW  = 30;
const AFTER_NOW   = 4 * 60;
const WINDOW_MINS = BEFORE_NOW + AFTER_NOW;
const LANE_H      = 26;
const ROW_VPAD    = 5;
const HEADER_H    = 44;
const NAME_W      = 148;

// Progressive block content width thresholds (px)
const W_NAME  = 36;   // show first name only
const W_PARTY = 56;   // show first name + party size
const W_TIME  = 120;  // show first name + party size + time range

const NEAR_FUTURE_MINS  = 60;
const DENSITY_HORIZON   = AFTER_NOW;
const TERMINAL          = new Set(['COMPLETED', 'NO_SHOW', 'CANCELLED']);
const DEFAULT_TURN_MINS = 90;

// ── Colours ───────────────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  PENDING:       { bg: 'rgba(245,158,11,0.65)',  border: '#d97706', text: '#fef3c7' },
  CONFIRMED:     { bg: 'rgba(59,130,246,0.70)',  border: '#3b82f6', text: '#dbeafe' },
  ARRIVING_SOON: { bg: 'rgba(217,119,6,0.85)',   border: '#f59e0b', text: '#fef3c7' },
  LATE:          { bg: 'rgba(220,38,38,0.70)',   border: '#ef4444', text: '#fee2e2' },
  NO_SHOW_RISK:  { bg: 'rgba(153,27,27,0.85)',   border: '#dc2626', text: '#fca5a5' },
  SEATED:        { bg: 'rgba(22,163,74,0.80)',   border: '#4ade80', text: '#dcfce7' },
  COMPLETED:     { bg: 'rgba(82,82,91,0.55)',    border: '#71717a', text: '#a1a1aa' },
  NO_SHOW:       { bg: 'rgba(153,27,27,0.55)',   border: '#dc2626', text: '#fca5a5' },
};

const LIVE_DOT: Record<string, string> = {
  AVAILABLE:     '#6b7280',
  OCCUPIED:      '#22c55e',
  RESERVED_SOON: '#f59e0b',
  RESERVED:      '#3b82f6',
  BLOCKED:       '#52525b',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface Block { res: Reservation; startMins: number; endMins: number }
interface Gap   { tableId: string; startMins: number; endMins: number }
interface DensityInfo { label: string; color: string }
interface ActionBar { res: Reservation; rect: DOMRect }

// ── Pure helpers ──────────────────────────────────────────────────────────────

function toServiceMins(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const mins = h * 60 + m;
  return mins < 360 ? mins + 1440 : mins;
}

function minsToHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getEffectiveStyle(status: string, startMins: number, nowMins: number) {
  if (status === 'CONFIRMED') {
    const minsUntil = startMins - nowMins;
    if (minsUntil >= 0 && minsUntil <= 15) return STATUS_STYLE.ARRIVING_SOON;
    if (minsUntil < 0 && minsUntil > -15)  return STATUS_STYLE.LATE;
    if (minsUntil <= -15)                   return STATUS_STYLE.NO_SHOW_RISK;
  }
  return STATUS_STYLE[status] ?? STATUS_STYLE.CONFIRMED;
}

function assignLanes(blocks: Block[]): Array<Block & { lane: number }> {
  const sorted = [...blocks].sort((a, b) => a.startMins - b.startMins);
  const laneEnds: number[] = [];
  return sorted.map(b => {
    let lane = laneEnds.findIndex(end => b.startMins >= end);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.endMins;
    return { ...b, lane };
  });
}

function detectGaps(blocks: Block[], tableId: string): Gap[] {
  if (blocks.length < 2) return [];
  const sorted = [...blocks].sort((a, b) => a.startMins - b.startMins);
  const merged: { startMins: number; endMins: number }[] = [];
  let curr = { startMins: sorted[0].startMins, endMins: sorted[0].endMins };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMins <= curr.endMins) {
      curr.endMins = Math.max(curr.endMins, sorted[i].endMins);
    } else {
      merged.push({ ...curr });
      curr = { startMins: sorted[i].startMins, endMins: sorted[i].endMins };
    }
  }
  merged.push(curr);
  return merged.slice(0, -1)
    .map((seg, i) => ({ tableId, startMins: seg.endMins, endMins: merged[i + 1].startMins }))
    .filter(g => g.endMins - g.startMins >= 20);
}

function gapQuality(durationMins: number): { border: string; bg: string; text: string; pct: number } {
  const pct = durationMins / DEFAULT_TURN_MINS;
  if (pct >= 1.0)  return { border: 'rgba(34,197,94,0.42)',  bg: 'rgba(34,197,94,0.07)',  text: '#4ade80', pct };
  if (pct >= 0.70) return { border: 'rgba(245,158,11,0.42)', bg: 'rgba(245,158,11,0.07)', text: '#fbbf24', pct };
  return                   { border: 'rgba(239,68,68,0.42)',  bg: 'rgba(239,68,68,0.07)',  text: '#f87171', pct };
}

function gapBestGuest(minCovers: number, maxCovers: number, waitlist: WaitlistEntry[]): WaitlistEntry | null {
  const candidates = waitlist.filter(
    e => (e.status === 'WAITING' || e.status === 'NOTIFIED') &&
         e.partySize >= minCovers && e.partySize <= maxCovers,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) =>
    new Date(a.addedAt).getTime() <= new Date(b.addedAt).getTime() ? a : b,
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tables: FloorTable[];
  reservations: Reservation[];
  date: string;
  operationalNow: number;
  selectedId: string | null;
  onSelect: (res: Reservation) => void;
  waitlist?: WaitlistEntry[];
  onGapClick?: (tableId: string, startTime: string, endTime: string) => void;
  onGapWaitlistSeat?: (tableId: string, entry: WaitlistEntry, startTime: string, endTime: string) => void;
  onQuickAction?: (action: 'seat' | 'move' | 'cancel', res: Reservation) => void;
}

export default function TableTimeline({
  tables, reservations, date, operationalNow, selectedId, onSelect,
  waitlist = [], onGapClick, onGapWaitlistSeat, onQuickAction,
}: Props) {
  const T = useT();
  const { locale } = useLocale();
  const scrollRef    = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [zoom,      setZoom]      = useState<ZoomLevel>(30);
  const [actionBar, setActionBar] = useState<ActionBar | null>(null);

  const { pxPerMin, tickMajor, tickMinor } = ZOOM_CONFIG[zoom];
  const TOTAL_W = WINDOW_MINS * pxPerMin;
  const NOW_X   = BEFORE_NOW  * pxPerMin;

  const nowMins = useMemo(() => {
    const [y, mo, d] = date.split('-').map(Number);
    const midnight = new Date(y, mo - 1, d).getTime();
    return Math.round((operationalNow - midnight) / 60_000);
  }, [date, operationalNow]);

  const windowStart = nowMins - BEFORE_NOW;

  const byTable = useMemo<Map<string, Reservation[]>>(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      if (r.status === 'CANCELLED' || !r.tableId) continue;
      const arr = map.get(r.tableId) ?? [];
      arr.push(r);
      map.set(r.tableId, arr);
    }
    return map;
  }, [reservations]);

  // Lane assignment + gap detection — reruns only on API refresh (not on tick)
  const tableLayouts = useMemo(() => tables.map(t => {
    const res    = byTable.get(t.id) ?? [];
    const blocks: Block[] = res.map(r => ({
      res:       r,
      startMins: toServiceMins(r.time),
      endMins:   toServiceMins(r.time) + r.duration,
    }));
    const laned   = assignLanes(blocks);
    const gaps    = detectGaps(blocks, t.id);
    const maxLane = laned.reduce((mx, b) => Math.max(mx, b.lane), 0);
    const rowH    = (maxLane + 1) * LANE_H + ROW_VPAD * 2;
    return { table: t, laned, rowH, gaps };
  }), [tables, byTable]);

  // Density insight — reruns every 60 s tick, API refresh, or language change
  const densityByTable = useMemo<Map<string, DensityInfo | null>>(() => {
    const map = new Map<string, DensityInfo | null>();
    for (const { table, laned } of tableLayouts) {
      const active = laned.find(b => b.startMins <= nowMins && b.endMins > nowMins);
      if (active) {
        const rem = active.endMins - nowMins;
        map.set(table.id, {
          label: rem <= 5 ? T.tableTimeline.endingNow : T.tableTimeline.endsMin(rem),
          color: rem <= 20 ? '#f59e0b' : '#22c55e',
        });
      } else {
        const upcoming = laned.filter(b => b.startMins > nowMins).sort((a, b) => a.startMins - b.startMins)[0];
        if (!upcoming || upcoming.startMins - nowMins > DENSITY_HORIZON) {
          map.set(table.id, null);
        } else {
          const free = upcoming.startMins - nowMins;
          map.set(table.id, {
            label: T.tableTimeline.nextMin(free),
            color: free <= 15 ? '#ef4444' : free <= 45 ? '#f59e0b' : 'rgb(var(--iron-muted))',
          });
        }
      }
    }
    return map;
  }, [tableLayouts, nowMins, T]);

  // Single highest-priority waitlist guest across all gap-bearing tables — only one glows
  const topGuestId = useMemo<string | null>(() => {
    let top: WaitlistEntry | null = null;
    for (const { table, gaps } of tableLayouts) {
      if (gaps.length === 0) continue;
      const match = gapBestGuest(table.minCovers, table.maxCovers, waitlist);
      if (!match) continue;
      if (!top || new Date(match.addedAt).getTime() < new Date(top.addedAt).getTime()) top = match;
    }
    return top?.id ?? null;
  }, [tableLayouts, waitlist]);

  const ticks = useMemo<number[]>(() => {
    const result: number[] = [];
    const first = Math.ceil(windowStart / tickMinor) * tickMinor;
    for (let m = first; m <= windowStart + WINDOW_MINS; m += tickMinor) result.push(m);
    return result;
  }, [windowStart, tickMinor]);

  // Scroll so NOW marker is ~15% from left — on date change or zoom change
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, NOW_X - scrollRef.current.clientWidth * 0.15);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, zoom]);

  // Scroll vertically to the selected reservation's row
  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    let offsetY = HEADER_H;
    for (const { laned, rowH } of tableLayouts) {
      if (laned.some(b => b.res.id === selectedId)) {
        const c = scrollRef.current;
        c.scrollTop = Math.max(0, offsetY - c.clientHeight / 2 + rowH / 2);
        return;
      }
      offsetY += rowH;
    }
  }, [selectedId, tableLayouts]);

  // ── Action bar helpers ────────────────────────────────────────────────────
  function openActionBar(res: Reservation, e: { currentTarget: EventTarget }) {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setActionBar({ res, rect });
  }

  function scheduleHide() {
    hideTimerRef.current = setTimeout(() => setActionBar(null), 150);
  }

  function cancelHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }

  function canSeat(res: Reservation)   { return !TERMINAL.has(res.status) && res.status !== 'SEATED'; }
  function canMove(res: Reservation)   { return res.status === 'SEATED'; }
  function canCancel(res: Reservation) { return !TERMINAL.has(res.status); }
  function isActionable(res: Reservation, isPast: boolean) {
    return !!onQuickAction && !isPast && (canSeat(res) || canMove(res) || canCancel(res));
  }

  return (
    <div className="flex-1 overflow-hidden" style={{ position: 'relative' }}>
      <style>{`
        @keyframes gap-pulse-normal{0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0)}50%{box-shadow:0 0 0 3px rgba(99,102,241,0.22)}}
        @keyframes gap-pulse-urgent{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:0 0 0 3px rgba(239,68,68,0.32)}}
      `}</style>
      <div className="h-full overflow-auto" ref={scrollRef}>
        <div style={{ width: NAME_W + TOTAL_W, minHeight: '100%' }}>

          {/* ══ Sticky header ════════════════════════════════════════════════ */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10 }}>

            {/* Corner — sticky on both axes */}
            <div style={{
              width: NAME_W, flexShrink: 0, height: HEADER_H,
              position: 'sticky', left: 0, zIndex: 11,
              backgroundColor: 'rgb(var(--iron-card))',
              borderRight: '1px solid rgb(var(--iron-border))',
              borderBottom: '1px solid rgb(var(--iron-border))',
              display: 'flex', flexDirection: 'column',
              justifyContent: 'space-between', padding: '6px 8px 5px 12px',
            }}>
              {/* Title + zoom buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  fontSize: 9, fontWeight: 600, letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: 'rgb(var(--iron-muted))', userSelect: 'none',
                }}>
                  {T.tableTimeline.headerTable}
                </span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {([15, 30, 60] as ZoomLevel[]).map(z => (
                    <button
                      key={z}
                      onClick={() => setZoom(z)}
                      style={{
                        fontSize: 8, fontWeight: 600, padding: '1px 4px',
                        borderRadius: 3, lineHeight: '14px', cursor: 'pointer',
                        border: `1px solid ${z === zoom ? '#22c55e' : 'rgb(var(--iron-border))'}`,
                        backgroundColor: z === zoom ? 'rgba(34,197,94,0.15)' : 'transparent',
                        color: z === zoom ? '#22c55e' : 'rgb(var(--iron-muted))',
                      }}
                    >
                      {z}m
                    </button>
                  ))}
                </div>
              </div>
              {/* Status legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {([
                  { color: '#f59e0b', label: T.tableTimeline.legendSoon },
                  { color: '#3b82f6', label: T.tableTimeline.legendConf },
                  { color: '#4ade80', label: T.tableTimeline.legendSeat },
                  { color: '#71717a', label: T.tableTimeline.legendDone },
                ]).map(({ color, label }) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 7.5, color: 'rgb(var(--iron-muted))', userSelect: 'none', opacity: 0.7 }}>{label}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Time axis */}
            <div style={{
              position: 'relative', flex: 1, height: HEADER_H,
              backgroundColor: 'rgb(var(--iron-card))',
              borderBottom: '1px solid rgb(var(--iron-border))',
            }}>
              {ticks.map(m => {
                const x     = (m - windowStart) * pxPerMin;
                const major = m % tickMajor === 0;
                return (
                  <div key={m} style={{
                    position: 'absolute', left: x, top: 0, bottom: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4,
                  }}>
                    {major && (
                      <span style={{
                        fontSize: 9, marginBottom: 3,
                        color: 'rgb(var(--iron-muted))',
                        fontVariantNumeric: 'tabular-nums',
                        transform: 'translateX(-50%)',
                        whiteSpace: 'nowrap', userSelect: 'none',
                      }}>
                        {minsToHHMM(m)}
                      </span>
                    )}
                    <span style={{
                      display: 'block', width: 1,
                      height: major ? 8 : 4,
                      backgroundColor: major ? 'rgba(160,167,160,0.5)' : 'rgba(160,167,160,0.22)',
                    }} />
                  </div>
                );
              })}

              {/* NOW pill */}
              <div style={{
                position: 'absolute', left: NOW_X, top: 5,
                transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 1,
              }}>
                <span style={{
                  fontSize: 8, fontWeight: 700, color: '#22c55e',
                  backgroundColor: 'rgba(34,197,94,0.15)',
                  border: '1px solid rgba(34,197,94,0.35)',
                  padding: '1px 5px', borderRadius: 3,
                  whiteSpace: 'nowrap', userSelect: 'none',
                }}>
                  {minsToHHMM(nowMins)}
                </span>
              </div>
            </div>
          </div>

          {/* ══ Table rows ═══════════════════════════════════════════════════ */}
          {tableLayouts.map(({ table, laned, rowH, gaps }) => {
            const density   = densityByTable.get(table.id) ?? null;
            // Per-table waitlist match — same best guest applies to all gaps in this row
            const tableBest = gaps.length > 0 ? gapBestGuest(table.minCovers, table.maxCovers, waitlist) : null;
            const waitMin   = tableBest ? Math.floor((Date.now() - new Date(tableBest.addedAt).getTime()) / 60_000) : 0;
            const isUrgent  = tableBest !== null && waitMin > 25;
            return (
              <div key={table.id} style={{ display: 'flex' }}>

                {/* Sticky name cell */}
                <div style={{
                  width: NAME_W, flexShrink: 0, height: rowH,
                  position: 'sticky', left: 0, zIndex: 5,
                  backgroundColor: 'rgb(var(--iron-card))',
                  borderRight: '1px solid rgb(var(--iron-border))',
                  borderBottom: '1px solid rgba(42,47,42,0.6)',
                  display: 'flex', alignItems: 'center',
                  padding: '0 8px 0 12px', gap: 6,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                      color: 'rgb(var(--iron-text))',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {table.name}
                    </p>
                    <p style={{
                      fontSize: 9, lineHeight: 1.3, marginTop: 1,
                      color: 'rgb(var(--iron-muted))',
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}>
                      <span>{table.minCovers}–{table.maxCovers}</span>
                      {table.section && (
                        <span style={{ opacity: 0.6 }}>· {formatSectionName(table.section.name, locale)}</span>
                      )}
                    </p>
                    {density && (
                      <p style={{
                        fontSize: 9, lineHeight: 1.3, marginTop: 2,
                        fontWeight: 500, color: density.color,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {density.label}
                      </p>
                    )}
                  </div>
                  <span
                    title={table.liveStatus}
                    style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      backgroundColor: LIVE_DOT[table.liveStatus] ?? '#6b7280',
                    }}
                  />
                </div>

                {/* Timeline strip */}
                <div style={{
                  position: 'relative', flex: 1, height: rowH,
                  borderBottom: '1px solid rgba(42,47,42,0.4)',
                  backgroundColor: 'rgb(var(--iron-bg))',
                  overflow: 'hidden',
                }}>
                  {/* Grid lines */}
                  {ticks.map(m => (
                    <div key={m} style={{
                      position: 'absolute',
                      left: (m - windowStart) * pxPerMin,
                      top: 0, bottom: 0, width: 1,
                      backgroundColor: m % tickMajor === 0
                        ? 'rgba(82,82,91,0.22)'
                        : 'rgba(82,82,91,0.09)',
                      pointerEvents: 'none',
                    }} />
                  ))}

                  {/* Past shading */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: NOW_X,
                    backgroundColor: 'rgba(0,0,0,0.06)',
                    pointerEvents: 'none',
                  }} />

                  {/* NOW line */}
                  <div style={{
                    position: 'absolute', left: NOW_X, top: 0, bottom: 0, width: 2,
                    backgroundColor: 'rgba(34,197,94,0.5)',
                    zIndex: 2, pointerEvents: 'none',
                  }} />

                  {/* Gap slots — quality-coloured, urgency-aware, waitlist-matched */}
                  {gaps.map(g => {
                    const gx = (g.startMins - windowStart) * pxPerMin;
                    const gw = (g.endMins - g.startMins) * pxPerMin;
                    if (gx + gw < 0 || gx > TOTAL_W) return null;
                    const clipL    = Math.max(0, -gx);
                    const visX     = gx + clipL;
                    const visW     = Math.max(6, gw - clipL);
                    const durMin   = g.endMins - g.startMins;
                    const startStr = minsToHHMM(g.startMins);
                    const endStr   = minsToHHMM(g.endMins);

                    // Colour: urgent red overrides quality colour when wait > 25m
                    const q = gapQuality(durMin);
                    const qLabel = q.pct >= 1.0 ? T.tableTimeline.gapPerfect : q.pct >= 0.70 ? T.tableTimeline.gapTight : T.tableTimeline.gapShort;
                    const c = isUrgent
                      ? { border: 'rgba(239,68,68,0.50)', bg: 'rgba(239,68,68,0.09)', text: '#f87171' }
                      : q;

                    // Only the globally longest-waiting guest gets the pulse glow
                    const isTop     = tableBest?.id === topGuestId;
                    const animation = isTop
                      ? `gap-pulse-${isUrgent ? 'urgent' : 'normal'} 2.2s ease-in-out infinite`
                      : undefined;

                    const hasAction = tableBest ? !!onGapWaitlistSeat : !!onGapClick;
                    const mainLabel = visW >= 70
                      ? tableBest
                        ? T.tableTimeline.seatGuest(tableBest.guestName.split(' ')[0], tableBest.partySize)
                        : T.tableTimeline.fitsCovers(table.minCovers, table.maxCovers)
                      : null;

                    return (
                      <button
                        key={`gap-${g.startMins}`}
                        onClick={() => tableBest && onGapWaitlistSeat
                          ? onGapWaitlistSeat(g.tableId, tableBest, startStr, endStr)
                          : onGapClick?.(g.tableId, startStr, endStr)
                        }
                        title={tableBest
                          ? `${T.tableTimeline.seatGuest(tableBest.guestName, tableBest.partySize)} · ${T.tableTimeline.mWait(waitMin)} · ${startStr}–${endStr}`
                          : `${qLabel}: ${startStr}–${endStr} (${durMin}m)`
                        }
                        style={{
                          position: 'absolute',
                          left: visX, top: ROW_VPAD,
                          width: visW, bottom: ROW_VPAD,
                          border: `1.5px dashed ${c.border}`,
                          borderRadius: 4,
                          backgroundColor: c.bg,
                          cursor: hasAction ? 'pointer' : 'default',
                          zIndex: isTop ? 1 : 0,
                          overflow: 'hidden',
                          display: 'flex', alignItems: 'center',
                          animation,
                        }}
                      >
                        {visW >= 30 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 5, paddingRight: 4, overflow: 'hidden' }}>
                            {mainLabel && (
                              <span style={{ fontSize: 8, fontWeight: 600, color: c.text, opacity: 0.9, whiteSpace: 'nowrap', userSelect: 'none' }}>
                                {mainLabel}
                              </span>
                            )}
                            {tableBest && waitMin > 0 && visW >= 130 && (
                              <span style={{ fontSize: 8, color: c.text, opacity: 0.55, whiteSpace: 'nowrap', userSelect: 'none' }}>
                                · {T.tableTimeline.mWait(waitMin)}
                              </span>
                            )}
                            <span style={{ fontSize: 8, color: c.text, opacity: 0.6, whiteSpace: 'nowrap', userSelect: 'none' }}>
                              {tableBest ? T.tableTimeline.seatAction : T.tableTimeline.addAction}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {/* Reservation blocks */}
                  {laned.map(({ res, startMins, endMins, lane }) => {
                    const rawX = (startMins - windowStart) * pxPerMin;
                    const durW = (endMins - startMins) * pxPerMin;
                    if (rawX + durW < 0 || rawX > TOTAL_W) return null;

                    const clipL = Math.max(0, -rawX);
                    const left  = rawX + clipL;
                    const width = Math.max(6, durW - clipL);

                    const isPast       = endMins < nowMins;
                    const isNearFuture = !isPast && startMins > nowMins && startMins <= nowMins + NEAR_FUTURE_MINS;
                    const st           = getEffectiveStyle(res.status, startMins, nowMins);
                    const isSel        = res.id === selectedId;
                    const actionable   = isActionable(res, isPast);

                    const opacity     = isPast ? 0.35 : 1;
                    const borderColor = isSel ? '#22c55e' : st.border;
                    const borderWidth = isSel ? 2 : isNearFuture ? 2 : 1.5;
                    const shadow      = isSel
                      ? '0 0 0 2px rgba(34,197,94,0.35)'
                      : isNearFuture
                      ? `0 0 0 2px ${st.border}55`
                      : undefined;

                    const firstName  = res.guestName.split(' ')[0];
                    const endStr     = minsToHHMM(endMins);
                    const tooltipTxt = `${res.guestName} · ${T.common.guests(res.partySize)} · ${res.time}–${endStr}`;

                    return (
                      <button
                        key={res.id}
                        onClick={() => onSelect(res)}
                        onMouseEnter={actionable ? e => openActionBar(res, e) : undefined}
                        onMouseLeave={actionable ? scheduleHide : undefined}
                        title={tooltipTxt}
                        style={{
                          position: 'absolute',
                          left, top: ROW_VPAD + lane * LANE_H,
                          width, height: LANE_H - 4,
                          opacity, backgroundColor: st.bg,
                          border: `${borderWidth}px solid ${borderColor}`,
                          borderRadius: 4, boxShadow: shadow,
                          overflow: 'hidden', display: 'flex', alignItems: 'center',
                          paddingLeft: 5, paddingRight: 4,
                          cursor: 'pointer',
                          zIndex: isSel ? 4 : isNearFuture ? 3 : 1,
                          userSelect: 'none',
                          transition: 'opacity 0.2s, border-color 0.1s, box-shadow 0.1s',
                        }}
                      >
                        {width >= W_NAME && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, lineHeight: 1.2,
                            color: isPast ? 'rgba(255,255,255,0.6)' : st.text,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            flex: 1,
                          }}>
                            {width >= W_TIME
                              ? `${firstName} · ${res.partySize} · ${res.time}–${endStr}`
                              : width >= W_PARTY
                              ? `${firstName} · ${res.partySize}`
                              : firstName}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ Quick action bar (fixed overlay, survives strip overflow:hidden) ═ */}
      {actionBar && (
        <div
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: actionBar.rect.left,
            top:  actionBar.rect.bottom + 3,
            zIndex: 200,
            display: 'flex', gap: 3,
            backgroundColor: 'rgb(var(--iron-card))',
            border: '1px solid rgb(var(--iron-border))',
            borderRadius: 5, padding: '3px 4px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}
        >
          {canSeat(actionBar.res) && (
            <QuickBtn label={T.tableTimeline.actionSeat} color="#22c55e"
              onClick={() => { onQuickAction?.('seat', actionBar.res); setActionBar(null); }}
            />
          )}
          {canMove(actionBar.res) && (
            <QuickBtn label={T.tableTimeline.actionMove} color="#3b82f6"
              onClick={() => { onQuickAction?.('move', actionBar.res); setActionBar(null); }}
            />
          )}
          {canCancel(actionBar.res) && (
            <QuickBtn label={T.tableTimeline.actionCancel} color="#ef4444"
              onClick={() => { onQuickAction?.('cancel', actionBar.res); setActionBar(null); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function QuickBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 9, fontWeight: 600, padding: '2px 7px',
        borderRadius: 3, lineHeight: '14px', cursor: 'pointer',
        border: `1px solid ${color}44`,
        backgroundColor: `${color}18`,
        color,
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = `${color}30`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = `${color}18`; }}
    >
      {label}
    </button>
  );
}
