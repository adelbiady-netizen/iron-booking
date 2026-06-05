import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Reservation, ReservationStatus, WaitlistEntry } from '../types';
import WaitlistPanel, { type NextInLineItem } from './WaitlistPanel';
import type { TableSuggestion } from '../utils/seating';
import type { PriorityEntry } from '../utils/flowControl';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { arrivalState, minutesUntilRes, isStaleReservation, isFloorReleased } from '../utils/arrival';
import { normalizeTime } from '../utils/time';

// Unified name + phone search — works for "052", "1234", "Yossi", "lev".
// Phone match strips all non-digits from both sides so formatting never matters.
// Requires ≥2 digit chars to avoid matching every number on a single "0".
function matchesSearch(name: string, phone: string | null | undefined, q: string, occasion?: string | null): boolean {
  if (!q.trim()) return true;
  const ql = q.trim().toLowerCase();
  if (name.toLowerCase().includes(ql)) return true;
  if (occasion && occasion.toLowerCase().includes(ql)) return true;
  const qDigits = ql.replace(/\D/g, '');
  if (qDigits.length >= 2) {
    const phoneDigits = (phone ?? '').replace(/\D/g, '');
    if (phoneDigits && phoneDigits.includes(qDigits)) return true;
  }
  return false;
}

const STATUS_BADGE: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-500/14 text-amber-400 border-amber-500/35',
  CONFIRMED: 'bg-blue-500/12 text-blue-300/90 border-blue-500/28',
  SEATED:    'bg-iron-green/18 text-iron-green-light border-iron-green/35',
  COMPLETED: 'bg-iron-border/15 text-iron-muted/65 border-iron-border/18',
  CANCELLED: 'bg-red-900/12 text-red-400/80 border-red-900/20',
  NO_SHOW:   'bg-orange-900/12 text-orange-400/80 border-orange-900/20',
};

type FilterValue = 'ACTIVE' | 'SEATED' | 'DONE' | 'NO_TABLE';
type Tab = 'reservations' | 'waitlist';

interface Props {
  reservations: Reservation[];
  selectedId: string | null;
  highlightId: string | null;
  onSelect: (r: Reservation) => void;
  loading: boolean;
  onNewReservation: () => void;
  onWalkIn: () => void;
  // waitlist
  waitlist: WaitlistEntry[];
  waitlistLoading: boolean;
  onWaitlistAdd: (data: { guestName: string; partySize: number; guestPhone?: string }) => Promise<void>;
  onWaitlistSeat: (entry: WaitlistEntry) => void;
  onWaitlistNotify: (entry: WaitlistEntry) => Promise<void>;
  onWaitlistUpdate?: (entry: WaitlistEntry, data: { partySize?: number; guestName?: string; notes?: string }) => Promise<void>;
  onWaitlistCancel: (entry: WaitlistEntry) => void;
  onWaitlistNoShow: (entry: WaitlistEntry) => void;
  nextInLine?: NextInLineItem[];
  onSeatAtTable?: (tableId: string, entry: WaitlistEntry) => void;
  entrySuggestions?: Map<string, TableSuggestion[]>;
  priorityQueue?: PriorityEntry[];
  nowTime?: string;
  operationalNow?: number;
  onContextMenuSeat?: (res: Reservation) => void;
  date?: string;
  reorganizeQueue?: Reservation[];
  onReorganizeSelect?: (r: Reservation) => void;
  allTables?: { id: string; name: string }[];
  onChooseTable?: (r: Reservation) => void;
  isLiveView?: boolean;
  onHoverRow?: (id: string | null) => void;
  onSmartAssign?: () => void;
}

export default function ReservationPanel({
  reservations, selectedId, highlightId, onSelect, loading,
  onNewReservation, onWalkIn,
  waitlist, waitlistLoading, onWaitlistAdd, onWaitlistSeat, onWaitlistNotify, onWaitlistUpdate, onWaitlistCancel, onWaitlistNoShow,
  nextInLine, onSeatAtTable, entrySuggestions, priorityQueue, nowTime, operationalNow,
  onContextMenuSeat, date, reorganizeQueue, onReorganizeSelect, allTables,
  onChooseTable, isLiveView, onHoverRow, onSmartAssign,
}: Props) {
  const T = useT();
  const { dir } = useLocale();
  const [tab,    setTab]    = useState<Tab>('reservations');
  const [filter, setFilter] = useState<FilterValue>('ACTIVE');
  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ res: Reservation; x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

  // Live clock for waiting-time labels on arrived guests — ticks every minute.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayStr     = new Date().toISOString().slice(0, 10);
  const isFutureDate = !!date && date > todayStr;

  const STATUS_LABEL: Record<string, string> = {
    PENDING:   T.reservationStatus.PENDING,
    CONFIRMED: T.reservationStatus.CONFIRMED,
    SEATED:    T.reservationStatus.SEATED,
    COMPLETED: T.reservationStatus.COMPLETED,
    CANCELLED: T.reservationStatus.CANCELLED,
    NO_SHOW:   T.reservationStatus.NO_SHOW,
  };
  const noTableCount = reservations
    .filter(r => matchesSearch(r.guestName, r.guestPhone, search, r.occasion))
    .filter(r => ['PENDING', 'CONFIRMED'].includes(r.status) && !r.table)
    .length;

  // Unassigned count for Smart Assign trigger — includes displaced reservations
  const unassignedCount = reservations
    .filter(r => ['PENDING', 'CONFIRMED'].includes(r.status) && r.tableId === null)
    .length;

  const FILTERS: { label: string; value: FilterValue; count?: number }[] = [
    { label: T.reservationPanel.filterActive,  value: 'ACTIVE' },
    { label: T.reservationPanel.filterSeated,  value: 'SEATED' },
    { label: T.reservationPanel.filterDone,    value: 'DONE' },
    { label: T.reservationPanel.filterNoTable, value: 'NO_TABLE', count: noTableCount || undefined },
  ];

  const waitingCount = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED').length;

  const visible = reservations
    .filter(r => {
      if (filter === 'ACTIVE')   return ['PENDING', 'CONFIRMED'].includes(r.status) && !!r.table;
      if (filter === 'SEATED')   return r.status === 'SEATED';
      if (filter === 'DONE')     return ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(r.status);
      if (filter === 'NO_TABLE') return ['PENDING', 'CONFIRMED'].includes(r.status) && !r.table;
      return false;
    })
    .filter(r => matchesSearch(r.guestName, r.guestPhone, search, r.occasion))
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <>
    <aside className="w-full h-full flex flex-col border-s border-iron-border/60 bg-iron-elevated" style={{ boxShadow: '-1px 0 0 rgba(255,255,255,0.06), -3px 0 0 rgba(0,0,0,0.12), -20px 0 60px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.04), inset 2px 0 8px rgba(0,0,0,0.16)' }}>

      {/* Tab bar + action buttons */}
      <div className="px-3.5 pt-3.5 pb-0 border-b border-iron-border/40" style={{ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, transparent 100%)', boxShadow: '0 1px 0 rgba(255,255,255,0.07), 0 6px 18px rgba(0,0,0,0.26)' }}>
        <div className="flex items-center gap-2 mb-2.5">
          {/* Segmented tab control — premium pill style */}
          <div className="flex gap-0.5 flex-1 rounded-xl p-[3px] bg-iron-bg border border-iron-border/35" style={{ boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.26)' }}>
            <button
              onClick={() => setTab('reservations')}
              className={`flex-1 text-[12px] py-1.5 rounded-[9px] font-medium transition-[background-color,color,box-shadow] duration-100 ${
                tab === 'reservations'
                  ? 'bg-iron-elevated text-iron-text font-semibold'
                  : 'text-iron-muted/65 hover:text-iron-text'
              }`}
              style={tab === 'reservations' ? { boxShadow: '0 1px 3px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.07)' } : undefined}
            >
              {T.reservationPanel.tabReservations}
            </button>
            <button
              onClick={() => setTab('waitlist')}
              className={`flex-1 text-[12px] py-1.5 rounded-[9px] font-medium flex items-center justify-center gap-1.5 transition-[background-color,color,box-shadow] duration-100 ${
                tab === 'waitlist'
                  ? 'bg-iron-elevated text-iron-text font-semibold'
                  : 'text-iron-muted/65 hover:text-iron-text'
              }`}
              style={tab === 'waitlist' ? { boxShadow: '0 1px 3px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.07)' } : undefined}
            >
              {T.reservationPanel.tabWaitlist}
              {waitingCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                  tab === 'waitlist' ? 'bg-iron-green/20 text-iron-green-light' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {waitingCount}
                </span>
              )}
            </button>
          </div>

          {tab === 'reservations' && (
            <>
              <button
                onClick={onWalkIn}
                className="text-xs font-semibold px-3 py-2 rounded-xl border border-iron-border/50 text-iron-muted hover:border-iron-green/50 hover:text-iron-text transition-[color,border-color,transform] duration-100 active:scale-[0.97]"
                style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.14)' }}
              >
                {T.reservationPanel.walkIn}
              </button>
              <button
                onClick={onNewReservation}
                className="text-xs font-semibold px-3 py-2 rounded-xl bg-iron-green hover:bg-iron-green-light text-white transition-[background-color,transform] duration-100 active:scale-[0.97]"
                style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)' }}
              >
                {T.reservationPanel.newReservation}
              </button>
            </>
          )}
        </div>

        {/* Search — shared across reservations and waitlist tabs */}
        <div className={tab === 'reservations' ? 'space-y-1.5 pb-2.5' : 'pb-2.5'}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={T.reservationPanel.searchPlaceholder}
            className="w-full bg-iron-bg/80 border border-iron-border/50 rounded-xl px-3 py-2 text-iron-text text-[13px] placeholder-iron-muted/55 focus:outline-none focus:border-iron-green/55 transition-colors"
            style={{ boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.24)' }}
          />
          {tab === 'reservations' && (
            <>
              <div className="flex items-center gap-0.5 flex-wrap">
                {FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setFilter(f.value)}
                    className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition-colors ${
                      filter === f.value
                        ? 'text-iron-text font-semibold bg-iron-elevated border border-iron-border/40'
                        : 'text-iron-muted/70 font-medium hover:text-iron-text hover:bg-iron-bg/50'
                    }`}
                  >
                    {f.label}
                    {f.count !== undefined && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none bg-amber-500/20 text-amber-400">
                        {f.count}
                      </span>
                    )}
                  </button>
                ))}
                {/* Smart Assign trigger — only when there are unassigned reservations and it's today */}
                {onSmartAssign && unassignedCount > 0 && !isFutureDate && (
                  <button
                    onClick={onSmartAssign}
                    className="ms-auto text-[11px] font-medium px-2.5 py-1 rounded-lg border border-iron-border/35 text-iron-muted/60 hover:text-iron-text hover:border-iron-green/45 transition-colors touch-manipulation"
                  >
                    {T.smartAssign.trigger(unassignedCount)}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {tab === 'waitlist' ? (
        <WaitlistPanel
          entries={search.trim() ? waitlist.filter(e => matchesSearch(e.guestName, e.guestPhone, search)) : waitlist}
          loading={waitlistLoading}
          onAdd={onWaitlistAdd}
          onSeat={onWaitlistSeat}
          onNotify={onWaitlistNotify}
          onUpdate={onWaitlistUpdate}
          onCancel={onWaitlistCancel}
          onNoShow={onWaitlistNoShow}
          nextInLine={nextInLine}
          onSeatAtTable={onSeatAtTable}
          entrySuggestions={entrySuggestions}
          priorityQueue={priorityQueue}
          operationalNow={operationalNow}
          isToday={!isFutureDate}
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto" style={{ backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, transparent 36px)' }}>
            {/* Overdue section — CONFIRMED/PENDING reservations 50+ min past their time
                that still have a table assigned. Floor map released these already;
                host must manually mark no-show or recover. */}
            {(() => {
              if (!isLiveView || !nowTime) return null;
              const safeNow = nowTime;
              const items = reservations
                .filter(r => ['PENDING', 'CONFIRMED'].includes(r.status) && r.table)
                .filter(r => isFloorReleased(r.time, r.status, safeNow))
                .sort((a, b) => a.time.localeCompare(b.time));
              if (items.length === 0) return null;
              return (
                <div className="border-b border-red-500/20 bg-red-900/[0.10]">
                  <div className="px-3.5 py-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" />
                    <span className="text-red-400 text-xs font-semibold uppercase tracking-widest flex-1">
                      {T.reservationPanel.overdueHeader(items.length)}
                    </span>
                  </div>
                  {items.map(r => {
                    const minsLate = Math.abs(minutesUntilRes(r.time, safeNow));
                    return (
                      <div key={r.id} className="px-3.5 py-2.5 border-t border-red-500/10 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-iron-text text-sm font-semibold truncate">{r.guestName}</span>
                            <span className="text-iron-muted text-xs shrink-0 tabular-nums">{r.time}</span>
                            <span className="text-iron-muted text-xs shrink-0">{T.common.guests(r.partySize)}</span>
                          </div>
                          <p className="text-red-400/65 text-[10px] mt-0.5">
                            {r.table?.name} · {T.reservationPanel.overdueMinutes(minsLate)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelect(r)}
                          className="text-xs font-medium px-2.5 py-1 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/15 transition-colors shrink-0"
                        >
                          {T.reservationPanel.overdueOpen}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Reorganize queue — work queue, only relevant on NO_TABLE tab */}
            {filter === 'NO_TABLE' && reorganizeQueue && reorganizeQueue.length > 0 && (
              <div className="border-b border-amber-500/20 bg-amber-500/5">
                <div className="px-3.5 py-2 flex items-center gap-2">
                  <span className="text-amber-400 text-xs font-semibold uppercase tracking-widest flex-1">
                    {T.reservationPanel.reorganizeHeader(reorganizeQueue.length)}
                  </span>
                </div>
                {reorganizeQueue.map(r => {
                  const fromTableName = r.reorganizeFromTableId
                    ? (allTables?.find(t => t.id === r.reorganizeFromTableId)?.name ?? r.reorganizeFromTableId)
                    : null;
                  const fromTable = fromTableName
                    ? T.reservationPanel.reorganizeRemovedFrom(fromTableName)
                    : null;
                  return (
                    <div
                      key={r.id}
                      className="px-3.5 py-2.5 border-t border-amber-500/15 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-iron-text text-sm font-semibold truncate">{r.guestName}</span>
                          <span className="text-iron-muted text-xs shrink-0 tabular-nums">{r.time}</span>
                          <span className="text-iron-muted text-xs shrink-0">{T.common.guests(r.partySize)}</span>
                        </div>
                        {fromTable && (
                          <p className="text-amber-400/70 text-[10px] mt-0.5">{fromTable}</p>
                        )}
                      </div>
                      <button
                        onClick={() => onReorganizeSelect?.(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-md border border-amber-500/40 text-amber-400 hover:bg-amber-500/15 transition-colors shrink-0"
                      >
                        {T.reservationPanel.reorganizeOpen}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-10">
                <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loading && reservations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
                <p className="text-iron-muted text-sm">{T.reservationPanel.emptyTitle}</p>
                <p className="text-iron-muted text-xs opacity-75">
                  {T.reservationPanel.emptyHintPrefix}<span className="font-medium text-iron-text">{T.reservationPanel.emptyHintNew}</span>{T.reservationPanel.emptyHintMid}<span className="font-medium text-iron-text">{T.reservationPanel.emptyHintWalkIn}</span>{T.reservationPanel.emptyHintSuffix}
                </p>
              </div>
            )}

            {!loading && reservations.length > 0 && visible.length === 0 && (
              <div className="flex items-center justify-center py-10 text-iron-muted text-xs">
                {T.reservationPanel.emptyFiltered}
              </div>
            )}

            {!loading && (filter === 'ACTIVE' && isLiveView
              ? (() => {
                  const isImminent = (r: (typeof visible)[0]) =>
                    !!nowTime && minutesUntilRes(r.time, nowTime) >= 0 && minutesUntilRes(r.time, nowTime) <= 30;
                  // Past-due: reservation time has already passed in live view.
                  const isPastDue = (r: (typeof visible)[0]) =>
                    !!isLiveView && !!nowTime && minutesUntilRes(r.time, nowTime) < 0;

                  // Arrived bucket: ALL arrived guests, strict FIFO by arrivedAt.
                  // Arrived guests are excluded from lateBucket even if their reservation
                  // time has passed — they've physically arrived and entered the FIFO queue.
                  const arrivedBucket = visible
                    .filter(r => r.isArrived)
                    .sort((a, b) => {
                      const aT = a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0;
                      const bT = b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0;
                      if (aT !== bT) return aT - bT;
                      return a.time.localeCompare(b.time); // fallback: reservation time ASC
                    });
                  // Not-arrived guests only from here on.
                  const notArrived = visible.filter(r => !r.isArrived);
                  const lateBucket = notArrived
                    .filter(r => isPastDue(r))
                    .sort((a, b) => a.time.localeCompare(b.time)); // earliest = most overdue first
                  const remaining = notArrived.filter(r => !isPastDue(r));
                  return [
                    ...arrivedBucket,
                    ...lateBucket,
                    ...remaining.filter(r => isImminent(r)),
                    ...remaining.filter(r => !isImminent(r)),
                  ];
                })()
              : visible
            ).map(r => {
              const aState  = !!isLiveView && !!nowTime ? arrivalState(r.time, r.status, nowTime) : null;
              const isStale = !!isLiveView && !!nowTime && isStaleReservation(r.time, r.status, nowTime);

              const arrivalBadge = aState ? {
                ARRIVING_SOON: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25',    label: T.arrival.arrivingSoon },
                DUE_NOW:       { cls: 'bg-amber-500/25 text-amber-300 border-amber-400/40',    label: T.arrival.dueNow },
                LATE:          { cls: 'bg-orange-900/15 text-orange-400 border-orange-500/25', label: T.arrival.lateMin(Math.abs(minutesUntilRes(r.time, nowTime!))) },
                NO_SHOW_RISK:  { cls: 'bg-red-900/20 text-red-400 border-red-500/30',          label: T.arrival.noShowRisk },
              }[aState] : null;

              const minsUntil = isLiveView && nowTime ? minutesUntilRes(r.time, nowTime) : null;
              // Far-future: arriving in >90 min, not yet arrived — step back visually
              const isFarFuture = filter === 'ACTIVE' && !r.isArrived && minsUntil !== null && minsUntil > 90;

              const needsReminder = (() => {
                if (!isLiveView || r.isConfirmedByGuest || !r.confirmationSentAt || r.reminderCount >= 2) return false;
                if (!nowTime) return false;
                return minsUntil !== null && minsUntil > 0 && minsUntil <= 60;
              })();

              const staleBadge = isStale
                ? { cls: 'bg-zinc-700/30 text-zinc-500 border-zinc-600/30', label: `${STATUS_LABEL['NO_SHOW']}?` }
                : null;

              const statusBadge = staleBadge ?? arrivalBadge ?? (needsReminder
                ? { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: T.reservationPanel.needsReminder }
                : r.status === 'PENDING' ? null
                : { cls: STATUS_BADGE[r.status], label: STATUS_LABEL[r.status] });

              const rowBg = selectedId === r.id
                ? 'bg-iron-green/[0.18]'
                : highlightId === r.id
                ? 'animate-flash'
                : isStale
                ? 'opacity-50 hover:opacity-70'
                : aState === 'NO_SHOW_RISK'
                ? 'bg-red-900/8 hover:bg-red-900/14'
                : aState === 'LATE'
                ? 'bg-orange-900/8 hover:bg-orange-900/14'
                : aState === 'DUE_NOW'
                ? 'bg-amber-500/13 hover:bg-amber-500/20'
                : aState === 'ARRIVING_SOON'
                ? 'bg-amber-500/8 hover:bg-amber-500/13'
                : r.isArrived
                ? 'bg-iron-green/8 hover:bg-iron-green/12'
                : needsReminder
                ? 'bg-amber-500/8 hover:bg-amber-500/13'
                : 'hover:bg-iron-elevated/55';

              // Priority stripe — left edge signals urgency without adding noise
              const priorityBorder =
                aState === 'NO_SHOW_RISK' || aState === 'LATE' ? 'border-s-2 border-s-orange-500/90'
                : aState === 'DUE_NOW'                          ? 'border-s-2 border-s-amber-400'
                : aState === 'ARRIVING_SOON'                    ? 'border-s-2 border-s-amber-500/60'
                : r.isArrived                                   ? 'border-s-2 border-s-iron-green/85'
                : selectedId === r.id                           ? 'border-s-2 border-s-iron-green-light/75'
                :                                                 'border-s-2 border-s-transparent';

              return (
                <div
                  key={r.id}
                  className={`w-full flex items-stretch border-b border-iron-border/[0.26] transition-[background-color,box-shadow] duration-150 ${rowBg} ${priorityBorder}${isFarFuture ? ' opacity-[0.58]' : ''}`}
                  style={{ boxShadow: selectedId === r.id
                    ? 'inset 0 0 0 1px rgba(111,138,60,0.28), 0 4px 18px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.08)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.020)'
                  }}
                  onMouseEnter={() => onHoverRow?.(r.id)}
                  onMouseLeave={() => onHoverRow?.(null)}
                >
                  {/* Time anchor column — left rail for instant time scanning */}
                  <div dir="ltr" className="w-[58px] shrink-0 flex flex-col items-center justify-center border-e border-iron-border/[0.18] py-[18px] gap-1.5">
                    <span className="text-iron-text text-[17px] font-bold tabular-nums tracking-tight leading-none">{normalizeTime(r.time)}</span>
                    <span className="text-iron-muted/65 text-[12px] tabular-nums leading-none font-semibold">{r.partySize}p</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ res: r, x: e.clientX, y: e.clientY }); }}
                    dir={dir}
                    className="flex-1 text-start px-3 py-[18px] min-w-0 touch-manipulation active:bg-iron-green/8 transition-colors duration-100"
                  >

                    {/* Row 1 — name + VIP + status badge */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className="text-iron-text text-[18px] font-bold tracking-tight truncate leading-snug min-w-0">
                          {r.guestName}
                        </span>
                        {r.guest?.isVip && (
                          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400">
                            VIP
                          </span>
                        )}
                      </span>
                      {statusBadge && (
                        <span dir="ltr" className={`text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${statusBadge.cls}`}>
                          {statusBadge.label}
                        </span>
                      )}
                    </div>

                    {/* Row 2 — table assignment */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {r.table ? (
                        <span className="text-iron-text/55 text-[12px] font-medium leading-none">{r.table.name}</span>
                      ) : (
                        (() => {
                          const urgent = minsUntil !== null && minsUntil >= 0 && minsUntil <= 30;
                          return (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium leading-none ${
                              urgent
                                ? 'bg-amber-500/15 border-amber-500/25 text-amber-400'
                                : 'bg-iron-border/15 border-iron-border/30 text-iron-muted/75'
                            }`}>
                              {T.reservationPanel.noTableBadge}{urgent && minsUntil !== null && !arrivalBadge ? ` · ${minsUntil}m` : ''}
                            </span>
                          );
                        })()
                      )}
                    </div>

                    {/* Row 3 — phone identity layer */}
                    <div className="flex items-center gap-1.5 mt-2">
                      {r.guestPhone ? (
                        <span dir="ltr" className="text-iron-muted/50 text-[12px] font-mono tabular-nums tracking-wider leading-none">
                          {(() => {
                            const d = r.guestPhone.replace(/\D/g, '');
                            if (d.length === 12 && d.startsWith('972')) return `+972 ${d.slice(3,5)} · ${d.slice(5,8)} · ${d.slice(8)}`;
                            if (d.length === 10 && d.startsWith('0'))   return `${d.slice(0,3)} · ${d.slice(3,6)} · ${d.slice(6)}`;
                            return r.guestPhone;
                          })()}
                        </span>
                      ) : (
                        <span className="text-[10px] text-iron-muted/40 font-medium">
                          {T.reservationPanel.noPhone}
                        </span>
                      )}
                    </div>

                    {/* Row 4 — optional signal chips */}
                    {(r.hostNotes || r.occasion || r.isConfirmedByGuest || r.isRunningLate || r.isArrived || r.remindedAt || r.confirmationSentAt || (r.guest?.tags?.length ?? 0) > 0) && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {r.hostNotes && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 font-medium max-w-[180px] truncate leading-none">
                            {r.hostNotes}
                          </span>
                        )}
                        {r.occasion && (
                          <span className="text-[11px] text-iron-green-light/80 font-medium">{r.occasion}</span>
                        )}
                        {r.guest?.tags && r.guest.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full border border-iron-border/35 text-iron-muted/65 font-medium">{tag}</span>
                        ))}
                        {r.isConfirmedByGuest && (
                          <span className="text-[11px] font-medium text-emerald-400/90">{T.reservationPanel.confirmedTick}</span>
                        )}
                        {r.isArrived && (
                          <span className="text-[11px] font-medium text-teal-400/85">
                            {r.arrivedAt
                              ? T.reservationPanel.arrivedWaiting(Math.round((nowMs - new Date(r.arrivedAt).getTime()) / 60_000))
                              : T.reservationPanel.arrivedBadge}
                          </span>
                        )}
                        {r.isRunningLate && (
                          <span className="text-[11px] font-semibold text-orange-400">{T.reservationPanel.runningLate}</span>
                        )}
                        {!r.isConfirmedByGuest && r.remindedAt && (
                          <span className="text-[11px] text-iron-muted/70">{T.reservationPanel.reminded}</span>
                        )}
                        {!r.isConfirmedByGuest && !r.remindedAt && r.confirmationSentAt && (
                          <span className="text-[11px] text-iron-muted/70">{T.reservationPanel.smsSent}</span>
                        )}
                      </div>
                    )}
                  </button>
                  {!r.table && ['PENDING', 'CONFIRMED'].includes(r.status) && onChooseTable && (
                    <div className="flex items-center pe-3.5 shrink-0">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onChooseTable(r); }}
                        className="text-xs font-medium px-2.5 py-2 rounded-lg border border-iron-green/40 text-iron-green-light hover:bg-iron-green/15 transition-colors active:scale-[0.97] whitespace-nowrap"
                      >
                        {T.reservationPanel.chooseTable}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-iron-border/20 text-iron-muted/55 text-[11px] text-center">
            {T.reservationPanel.showing(visible.length, reservations.length)}
          </div>
        </>
      )}
    </aside>

  {ctxMenu && createPortal(
    (() => {
      const hasSeat = ['PENDING', 'CONFIRMED'].includes(ctxMenu.res.status);
      const menuW = 184;
      const menuH = hasSeat ? 108 : 56;
      let left = ctxMenu.x + 4;
      let top  = ctxMenu.y + 4;
      const flipX = left + menuW > window.innerWidth  - 8;
      const flipY = top  + menuH > window.innerHeight - 8;
      if (flipX) left = ctxMenu.x - menuW - 4;
      if (flipY) top  = ctxMenu.y - menuH - 4;
      left = Math.max(8, left);
      top  = Math.max(8, top);

      return (
        <div
          ref={ctxRef}
          style={{
            position: 'fixed', left, top, zIndex: 9999,
            minWidth: menuW,
            maxWidth: 224,
            boxShadow: '0 8px 28px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
            transformOrigin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
          }}
          className="bg-iron-elevated border border-iron-border/70 rounded-xl p-1.5 animate-ctx-menu"
          onContextMenu={e => e.preventDefault()}
        >
          {hasSeat && (
            <button
              type="button"
              className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm text-iron-green-light font-medium hover:bg-iron-green/15 active:bg-iron-green/25 transition-colors cursor-pointer"
              onClick={() => { onContextMenuSeat?.({ ...ctxMenu.res, tableId: null, combinedTableIds: [] }); setCtxMenu(null); }}
            >
              <span className="text-base leading-none shrink-0">🍽️</span>
              <span>{T.reservationPanel.ctxSeat}</span>
            </button>
          )}

          {hasSeat && <div className="h-px bg-iron-border/40 my-1 mx-1.5" />}

          <button
            type="button"
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm text-iron-muted hover:bg-white/[0.06] active:bg-white/10 transition-colors cursor-pointer"
            onClick={() => setCtxMenu(null)}
          >
            <span className="text-[13px] leading-none shrink-0 opacity-60">✕</span>
            <span>{T.reservationPanel.ctxClose}</span>
          </button>
        </div>
      );
    })(),
    document.body,
  )}
  </>
  );
}
