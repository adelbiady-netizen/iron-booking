import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Reservation, ReservationStatus, WaitlistEntry } from '../types';
import WaitlistPanel, { type NextInLineItem } from './WaitlistPanel';
import type { TableSuggestion } from '../utils/seating';
import type { PriorityEntry } from '../utils/flowControl';
import { useT } from '../i18n/useT';
import { arrivalState, minutesUntilRes, isStaleReservation } from '../utils/arrival';

// Unified name + phone search — works for "052", "1234", "Yossi", "lev".
// Phone match strips all non-digits from both sides so formatting never matters.
// Requires ≥2 digit chars to avoid matching every number on a single "0".
function matchesSearch(name: string, phone: string | null | undefined, q: string): boolean {
  if (!q.trim()) return true;
  const ql = q.trim().toLowerCase();
  if (name.toLowerCase().includes(ql)) return true;
  const qDigits = ql.replace(/\D/g, '');
  if (qDigits.length >= 2) {
    const phoneDigits = (phone ?? '').replace(/\D/g, '');
    if (phoneDigits && phoneDigits.includes(qDigits)) return true;
  }
  return false;
}

const STATUS_BADGE: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
  CONFIRMED: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  SEATED:    'bg-iron-green/20 text-iron-green-light border-iron-green/40',
  COMPLETED: 'bg-iron-border/20 text-iron-muted border-iron-border/20',
  CANCELLED: 'bg-red-900/15 text-red-400 border-red-900/20',
  NO_SHOW:   'bg-orange-900/15 text-orange-400 border-orange-900/20',
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
}

export default function ReservationPanel({
  reservations, selectedId, highlightId, onSelect, loading,
  onNewReservation, onWalkIn,
  waitlist, waitlistLoading, onWaitlistAdd, onWaitlistSeat, onWaitlistNotify, onWaitlistCancel, onWaitlistNoShow,
  nextInLine, onSeatAtTable, entrySuggestions, priorityQueue, nowTime, operationalNow,
  onContextMenuSeat, date, reorganizeQueue, onReorganizeSelect, allTables,
  onChooseTable, isLiveView, onHoverRow,
}: Props) {
  const T = useT();
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
  const noTableCount = reservations.filter(
    r => ['PENDING', 'CONFIRMED'].includes(r.status) && !r.table
  ).length;

  const FILTERS: { label: string; value: FilterValue; count?: number }[] = [
    { label: T.reservationPanel.filterActive,  value: 'ACTIVE' },
    { label: T.reservationPanel.filterSeated,  value: 'SEATED' },
    { label: T.reservationPanel.filterDone,    value: 'DONE' },
    { label: T.reservationPanel.filterNoTable, value: 'NO_TABLE', count: noTableCount || undefined },
  ];

  const waitingCount = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED').length;

  const visible = reservations
    .filter(r => {
      if (filter === 'ACTIVE')   return ['PENDING', 'CONFIRMED'].includes(r.status);
      if (filter === 'SEATED')   return r.status === 'SEATED';
      if (filter === 'DONE')     return ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(r.status);
      if (filter === 'NO_TABLE') return ['PENDING', 'CONFIRMED'].includes(r.status) && !r.table;
      return false;
    })
    .filter(r => matchesSearch(r.guestName, r.guestPhone, search))
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <>
    <aside className="w-80 lg:w-[26rem] shrink-0 flex flex-col border-s border-iron-border/30 bg-iron-elevated" style={{ boxShadow: '-1px 0 0 rgba(255,255,255,0.03), -6px 0 28px rgba(0,0,0,0.32)' }}>

      {/* Tab bar + action buttons */}
      <div className="px-4 pt-3.5 pb-0 border-b border-iron-border/20" style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.03)' }}>
        <div className="flex items-center gap-2 mb-2.5">
          <div className="flex gap-3 flex-1">
            <button
              onClick={() => setTab('reservations')}
              className={`text-xs pb-2 pt-0.5 transition-colors border-b-2 ${
                tab === 'reservations'
                  ? 'text-iron-text font-semibold border-iron-green-light/70'
                  : 'text-iron-muted/50 font-medium hover:text-iron-muted/80 border-transparent'
              }`}
            >
              {T.reservationPanel.tabReservations}
            </button>
            <button
              onClick={() => setTab('waitlist')}
              className={`text-xs pb-2 pt-0.5 transition-colors border-b-2 flex items-center gap-1.5 ${
                tab === 'waitlist'
                  ? 'text-iron-text font-semibold border-iron-green-light/70'
                  : 'text-iron-muted/50 font-medium hover:text-iron-muted/80 border-transparent'
              }`}
            >
              {T.reservationPanel.tabWaitlist}
              {waitingCount > 0 && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  tab === 'waitlist' ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-400'
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
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-iron-border/30 text-iron-muted hover:border-iron-green/40 hover:text-iron-text transition-colors"
              >
                {T.reservationPanel.walkIn}
              </button>
              <button
                onClick={onNewReservation}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-iron-green hover:bg-iron-green-light text-white transition-colors"
              >
                {T.reservationPanel.newReservation}
              </button>
            </>
          )}
        </div>

        {/* Search — shared across reservations and waitlist tabs */}
        <div className={tab === 'reservations' ? 'space-y-2 pb-3' : 'pb-3'}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={T.reservationPanel.searchPlaceholder}
            className="w-full bg-iron-bg border border-iron-border/35 rounded-lg px-3 py-2 text-iron-text text-sm placeholder-iron-muted/60 focus:outline-none focus:border-iron-green/50 transition-colors"
            style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.20)' }}
          />
          {tab === 'reservations' && (
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                    filter === f.value
                      ? 'text-iron-text font-medium'
                      : 'text-iron-muted/55 font-medium hover:text-iron-muted/80'
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
            </div>
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
          <div className="flex-1 overflow-y-auto">
            {/* Reorganize queue — shown above normal list when reservations need reassignment */}
            {reorganizeQueue && reorganizeQueue.length > 0 && (
              <div className="border-b border-amber-500/20 bg-amber-500/5">
                <div className="px-3.5 py-2 flex items-center gap-2">
                  <span className="text-amber-400 text-[10px] font-semibold uppercase tracking-widest flex-1">
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
                      className="px-3.5 py-3 border-t border-amber-500/15 flex items-center gap-3"
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
                <p className="text-iron-muted text-xs opacity-60">
                  {T.reservationPanel.emptyHintPrefix}<span className="font-medium text-iron-text">{T.reservationPanel.emptyHintNew}</span>{T.reservationPanel.emptyHintMid}<span className="font-medium text-iron-text">{T.reservationPanel.emptyHintWalkIn}</span>{T.reservationPanel.emptyHintSuffix}
                </p>
              </div>
            )}

            {!loading && reservations.length > 0 && visible.length === 0 && (
              <div className="flex items-center justify-center py-10 text-iron-muted text-xs">
                {T.reservationPanel.emptyFiltered}
              </div>
            )}

            {!loading && (filter === 'ACTIVE'
              ? (() => {
                  const isImminent = (r: (typeof visible)[0]) =>
                    !!nowTime && minutesUntilRes(r.time, nowTime) >= 0 && minutesUntilRes(r.time, nowTime) <= 30;
                  const arrivedBucket = visible
                    .filter(r => r.isArrived)
                    .sort((a, b) => {
                      if (a.arrivedAt && b.arrivedAt) return a.arrivedAt.localeCompare(b.arrivedAt);
                      if (a.arrivedAt) return -1;
                      if (b.arrivedAt) return 1;
                      return a.time.localeCompare(b.time);
                    });
                  return [
                    ...arrivedBucket,
                    ...visible.filter(r => !r.isArrived && isImminent(r)),
                    ...visible.filter(r => !r.isArrived && !isImminent(r)),
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

              const needsReminder = (() => {
                if (!isLiveView || r.isConfirmedByGuest || !r.confirmationSentAt || r.reminderCount >= 2) return false;
                if (!nowTime) return false;
                const minsUntil = minutesUntilRes(r.time, nowTime);
                return minsUntil > 0 && minsUntil <= 60;
              })();

              const staleBadge = isStale
                ? { cls: 'bg-zinc-700/30 text-zinc-500 border-zinc-600/30', label: `${STATUS_LABEL['NO_SHOW']}?` }
                : null;

              const statusBadge = staleBadge ?? arrivalBadge ?? (needsReminder
                ? { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: T.reservationPanel.needsReminder }
                : { cls: STATUS_BADGE[r.status], label: STATUS_LABEL[r.status] });

              const rowBg = selectedId === r.id
                ? 'bg-iron-green/10'
                : highlightId === r.id
                ? 'animate-flash'
                : isStale
                ? 'opacity-50 hover:opacity-70'
                : aState === 'NO_SHOW_RISK'
                ? 'bg-red-900/5 hover:bg-red-900/10'
                : aState === 'LATE'
                ? 'bg-orange-900/5 hover:bg-orange-900/10'
                : needsReminder
                ? 'bg-amber-500/5 hover:bg-amber-500/10'
                : 'hover:bg-white/[0.04]';

              return (
                <div
                  key={r.id}
                  className={`w-full flex items-stretch border-b border-white/[0.05] transition-colors ${rowBg}`}
                  onMouseEnter={() => onHoverRow?.(r.id)}
                  onMouseLeave={() => onHoverRow?.(null)}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ res: r, x: e.clientX, y: e.clientY }); }}
                    className="flex-1 text-left px-4 py-4 min-w-0 touch-manipulation active:bg-white/[0.05] transition-colors"
                  >

                    {/* Row 1 — name + badge */}
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="text-iron-text text-[15px] font-semibold tracking-tight truncate flex-1 leading-snug">
                        {r.guestName}
                        {r.guest?.isVip && (
                          <span className="ms-1.5 text-amber-400 text-xs font-bold">{T.common.vip}</span>
                        )}
                      </span>
                      {!r.guestPhone && (
                        <span
                          title={T.reservationPanel.noPhone}
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-iron-border/40 text-iron-muted/40 font-medium"
                        >
                          ✆–
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${statusBadge.cls}`}>
                        {statusBadge.label}
                      </span>
                    </div>

                    {/* Row 2 — time · guests · table */}
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-iron-text font-bold tabular-nums">{r.time}</span>
                      <span className="text-iron-muted/10">·</span>
                      <span className="text-iron-muted/35 text-[11px]">{T.common.guests(r.partySize)}</span>
                      {r.table && (
                        <>
                          <span className="text-iron-muted/10">·</span>
                          <span className="text-iron-muted/60 text-[11px]">{r.table.name}</span>
                        </>
                      )}
                      {!r.table && (
                        <>
                          <span className="text-iron-muted/10">·</span>
                          {(() => {
                            const minsUntil = isLiveView && nowTime ? minutesUntilRes(r.time, nowTime) : null;
                            const urgent = minsUntil !== null && minsUntil >= 0 && minsUntil <= 30;
                            return (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                                urgent
                                  ? 'bg-amber-500/15 border-amber-500/25 text-amber-400'
                                  : 'bg-iron-border/15 border-iron-border/30 text-iron-muted'
                              }`}>
                                {T.reservationPanel.noTableBadge}{urgent && minsUntil !== null && !arrivalBadge ? ` · ${minsUntil}m` : ''}
                              </span>
                            );
                          })()}
                        </>
                      )}
                    </div>

                    {/* Row 3 — optional signal chips */}
                    {(r.occasion || r.isConfirmedByGuest || r.isRunningLate || r.isArrived || r.remindedAt || r.confirmationSentAt) && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {r.occasion && (
                          <span className="text-[11px] text-iron-green-light/75 font-medium">{r.occasion}</span>
                        )}
                        {r.isConfirmedByGuest && (
                          <span className="text-[10px] text-emerald-400/60">{T.reservationPanel.confirmedTick}</span>
                        )}
                        {r.isArrived && (
                          <span className="text-[10px] text-teal-400/60">{T.reservationPanel.arrivedBadge}</span>
                        )}
                        {r.isRunningLate && (
                          <span className="text-xs text-orange-400 font-medium">{T.reservationPanel.runningLate}</span>
                        )}
                        {!r.isConfirmedByGuest && r.remindedAt && (
                          <span className="text-[10px] text-iron-muted/50">{T.reservationPanel.reminded}</span>
                        )}
                        {!r.isConfirmedByGuest && !r.remindedAt && r.confirmationSentAt && (
                          <span className="text-[10px] text-iron-muted/50">{T.reservationPanel.smsSent}</span>
                        )}
                      </div>
                    )}
                  </button>
                  {!r.table && ['PENDING', 'CONFIRMED'].includes(r.status) && onChooseTable && (
                    <div className="flex items-center pr-3.5 shrink-0">
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onChooseTable(r); }}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-iron-green/40 text-iron-green-light hover:bg-iron-green/15 transition-colors whitespace-nowrap"
                      >
                        {T.reservationPanel.chooseTable}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2.5 border-t border-white/[0.05] text-iron-muted/60 text-xs text-center">
            {T.reservationPanel.showing(visible.length, reservations.length)}
          </div>
        </>
      )}
    </aside>

  {ctxMenu && createPortal(
    (() => {
      const menuW = 184;
      const menuH = 108;
      let left = ctxMenu.x + 4;
      let top  = ctxMenu.y + 4;
      const flipX = left + menuW > window.innerWidth  - 8;
      const flipY = top  + menuH > window.innerHeight - 8;
      if (flipX) left = ctxMenu.x - menuW - 4;
      if (flipY) top  = ctxMenu.y - menuH - 4;
      left = Math.max(8, left);
      top  = Math.max(8, top);

      const hasSeat = ['PENDING', 'CONFIRMED'].includes(ctxMenu.res.status);

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
              onClick={() => { onContextMenuSeat?.(ctxMenu.res); setCtxMenu(null); }}
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
