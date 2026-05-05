import { useState } from 'react';
import type { Reservation, ReservationStatus, WaitlistEntry } from '../types';
import WaitlistPanel, { type NextInLineItem } from './WaitlistPanel';
import type { TableSuggestion } from '../utils/seating';
import type { PriorityEntry } from '../utils/flowControl';
import { useT } from '../i18n/useT';
import { arrivalState, minutesUntilRes } from '../utils/arrival';

const STATUS_BADGE: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
  CONFIRMED: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  SEATED:    'bg-iron-green/20 text-iron-green-light border-iron-green/40',
  COMPLETED: 'bg-iron-border/20 text-iron-muted border-iron-border/20',
  CANCELLED: 'bg-red-900/15 text-red-400 border-red-900/20',
  NO_SHOW:   'bg-orange-900/15 text-orange-400 border-orange-900/20',
};

type FilterValue = 'ALL' | 'PENDING' | 'CONFIRMED' | 'SEATED' | 'DONE';
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
}

export default function ReservationPanel({
  reservations, selectedId, highlightId, onSelect, loading,
  onNewReservation, onWalkIn,
  waitlist, waitlistLoading, onWaitlistAdd, onWaitlistSeat, onWaitlistNotify, onWaitlistCancel, onWaitlistNoShow,
  nextInLine, onSeatAtTable, entrySuggestions, priorityQueue, nowTime, operationalNow,
}: Props) {
  const T = useT();
  const [tab,    setTab]    = useState<Tab>('reservations');
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [search, setSearch] = useState('');

  const STATUS_LABEL: Record<string, string> = {
    PENDING:   T.reservationStatus.PENDING,
    CONFIRMED: T.reservationStatus.CONFIRMED,
    SEATED:    T.reservationStatus.SEATED,
    COMPLETED: T.reservationStatus.COMPLETED,
    CANCELLED: T.reservationStatus.CANCELLED,
    NO_SHOW:   T.reservationStatus.NO_SHOW,
  };
  const FILTERS = [
    { label: T.reservationPanel.filterAll,       value: 'ALL' as FilterValue },
    { label: T.reservationPanel.filterPending,   value: 'PENDING' as FilterValue },
    { label: T.reservationPanel.filterConfirmed, value: 'CONFIRMED' as FilterValue },
    { label: T.reservationPanel.filterSeated,    value: 'SEATED' as FilterValue },
    { label: T.reservationPanel.filterDone,      value: 'DONE' as FilterValue },
  ];

  const waitingCount = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED').length;

  const visible = reservations
    .filter(r => {
      if (filter === 'DONE') return ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(r.status);
      if (filter === 'ALL')  return ['PENDING', 'CONFIRMED', 'SEATED'].includes(r.status);
      return r.status === filter;
    })
    .filter(r => {
      if (!search) return true;
      return r.guestName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <aside className="w-80 lg:w-[26rem] shrink-0 flex flex-col border-l border-iron-border bg-iron-card">

      {/* Tab bar + action buttons */}
      <div className="px-3 pt-3 pb-0 border-b border-iron-border">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="flex gap-1 flex-1">
            <button
              onClick={() => setTab('reservations')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                tab === 'reservations'
                  ? 'bg-iron-green text-white'
                  : 'text-iron-muted hover:text-iron-text'
              }`}
            >
              {T.reservationPanel.tabReservations}
            </button>
            <button
              onClick={() => setTab('waitlist')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                tab === 'waitlist'
                  ? 'bg-iron-green text-white'
                  : 'text-iron-muted hover:text-iron-text'
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
                className="text-xs font-medium px-3 py-1.5 rounded-md border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors"
              >
                {T.reservationPanel.walkIn}
              </button>
              <button
                onClick={onNewReservation}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-iron-green hover:bg-iron-green-light text-white transition-colors"
              >
                {T.reservationPanel.newReservation}
              </button>
            </>
          )}
        </div>

        {/* Reservation search + filters */}
        {tab === 'reservations' && (
          <div className="space-y-2 pb-3">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={T.reservationPanel.searchPlaceholder}
              className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
            />
            <div className="flex gap-1 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    filter === f.value
                      ? 'bg-iron-green text-white font-semibold'
                      : 'text-iron-muted hover:text-iron-text'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      {tab === 'waitlist' ? (
        <WaitlistPanel
          entries={waitlist}
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
        />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
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

            {!loading && visible.map(r => {
              const aState = nowTime ? arrivalState(r.time, r.status, nowTime) : null;
              const arrivalBadge = aState ? {
                ARRIVING_SOON: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25',    label: T.arrival.arrivingSoon },
                DUE_NOW:       { cls: 'bg-amber-500/25 text-amber-300 border-amber-400/40',    label: T.arrival.dueNow },
                LATE:          { cls: 'bg-orange-900/15 text-orange-400 border-orange-500/25', label: T.arrival.lateMin(Math.abs(minutesUntilRes(r.time, nowTime!))) },
                NO_SHOW_RISK:  { cls: 'bg-red-900/20 text-red-400 border-red-500/30',          label: T.arrival.noShowRisk },
              }[aState] : null;

              const needsReminder = (() => {
                if (r.isConfirmedByGuest || !r.confirmationSentAt || r.reminderCount >= 2) return false;
                if (!nowTime) return false;
                const minsUntil = minutesUntilRes(r.time, nowTime);
                return minsUntil > 0 && minsUntil <= 60;
              })();

              const statusBadge = arrivalBadge ?? (needsReminder
                ? { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: T.reservationPanel.needsReminder }
                : { cls: STATUS_BADGE[r.status], label: STATUS_LABEL[r.status] });

              const rowBg = selectedId === r.id
                ? 'bg-iron-green/10'
                : highlightId === r.id
                ? 'animate-flash'
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
                  className={`w-full flex items-stretch border-b border-iron-border/70 transition-colors ${rowBg}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(r)}
                    className="flex-1 text-left px-3.5 py-4 min-w-0"
                  >
                    {/* Row 1 — name + badge */}
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-iron-text text-lg font-bold truncate flex-1 leading-snug">
                        {r.guestName}
                        {r.guest?.isVip && (
                          <span className="ms-1.5 text-amber-400 text-xs font-bold">{T.common.vip}</span>
                        )}
                      </span>
                      <span className={`text-xs px-2.5 py-1 rounded-md border font-semibold shrink-0 ${statusBadge.cls}`}>
                        {statusBadge.label}
                      </span>
                    </div>

                    {/* Row 2 — time · guests · table */}
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-white font-semibold tabular-nums">{r.time}</span>
                      <span className="text-iron-border">·</span>
                      <span className="text-iron-muted">{T.common.guests(r.partySize)}</span>
                      {r.table && (
                        <>
                          <span className="text-iron-border">·</span>
                          <span className="text-iron-text font-medium">{r.table.name}</span>
                        </>
                      )}
                      {!r.table && (
                        <>
                          <span className="text-iron-border">·</span>
                          <span className="text-iron-border/60 italic text-xs">no table</span>
                        </>
                      )}
                    </div>

                    {/* Row 3 — optional signal chips */}
                    {(r.occasion || r.isConfirmedByGuest || r.isRunningLate || r.remindedAt || r.confirmationSentAt) && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {r.occasion && (
                          <span className="text-xs text-iron-green-light font-medium">{r.occasion}</span>
                        )}
                        {r.isConfirmedByGuest && (
                          <span className="text-xs text-emerald-400 font-medium">{T.reservationPanel.confirmedTick}</span>
                        )}
                        {r.isRunningLate && (
                          <span className="text-xs text-orange-400 font-medium">{T.reservationPanel.runningLate}</span>
                        )}
                        {!r.isConfirmedByGuest && r.remindedAt && (
                          <span className="text-xs text-iron-muted">{T.reservationPanel.reminded}</span>
                        )}
                        {!r.isConfirmedByGuest && !r.remindedAt && r.confirmationSentAt && (
                          <span className="text-xs text-iron-muted">{T.reservationPanel.smsSent}</span>
                        )}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-iron-border text-iron-muted text-xs text-center">
            {T.reservationPanel.showing(visible.length, reservations.length)}
          </div>
        </>
      )}
    </aside>
  );
}
