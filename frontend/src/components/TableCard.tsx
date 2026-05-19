import type React from 'react';
import type { FloorInsight, FloorTable, Reservation, WaitlistEntry } from '../types';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName } from '../utils/displayHelpers';
import { minutesUntilEnd } from '../utils/time';
import { isLiveServiceView } from '../utils/arrival';

function waitMins(addedAt: string, opNow: number): number {
  return Math.floor((opNow - new Date(addedAt).getTime()) / 60_000);
}

interface StatusStyle {
  border: string;
  bg: string;
  dot: string;
  label: string;
  labelColor: string;
}

const LOCKED_STYLE = 'border-amber-500/40 bg-amber-500/5 opacity-60';

interface Props {
  table: FloorTable;
  selected: boolean;
  isBestSuggestion?: boolean;
  softHold?: WaitlistEntry;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  insight?: FloorInsight;
  onInsightAction?: () => void;
  waitlistMatch?: WaitlistEntry;
  onWaitlistAction?: () => void;
  nowTime?: string;
  operationalNow?: number;
  extraTurns?: number;
  turnTooltip?: string;
  date?: string;
}

export default function TableCard({ table, selected, isBestSuggestion, softHold, onClick, onContextMenu, insight, onInsightAction, waitlistMatch, onWaitlistAction, operationalNow, extraTurns = 0, turnTooltip, date, nowTime }: Props) {
  const T = useT();
  const { locale } = useLocale();
  const isToday = date === undefined || date === new Date().toISOString().slice(0, 10);
  // Suppress urgency styling (amber RESERVED_SOON) when viewing a future boardTime.
  // Live/current board keeps exact existing behaviour (isLiveView=true).
  const isLiveView = date && nowTime ? isLiveServiceView(date, nowTime) : true;
  const displayStatus = (isLiveView || table.liveStatus !== 'RESERVED_SOON')
    ? table.liveStatus
    : 'RESERVED';
  const STATUS_STYLE: Record<string, StatusStyle> = {
    AVAILABLE:     { border: 'border-iron-border/60 hover:border-iron-green-light/65', bg: '',                  dot: 'bg-iron-border',  label: T.tableStatus.AVAILABLE,     labelColor: 'text-iron-muted/75' },
    OCCUPIED:      { border: 'border-iron-green-light',                       bg: 'bg-iron-green/16',  dot: 'bg-iron-green-light', label: T.tableStatus.OCCUPIED,      labelColor: 'text-iron-green-light' },
    RESERVED_SOON: { border: 'border-amber-500',                             bg: 'bg-amber-500/15',   dot: 'bg-amber-500',        label: T.tableStatus.RESERVED_SOON, labelColor: 'text-amber-400' },
    RESERVED:      { border: 'border-blue-400/60',                           bg: 'bg-blue-900/20',    dot: 'bg-blue-500',         label: T.tableStatus.RESERVED,      labelColor: 'text-blue-400' },
    BLOCKED:       { border: 'border-iron-border/50',                        bg: 'bg-iron-border/20', dot: 'bg-iron-muted',  label: T.tableStatus.BLOCKED,       labelColor: 'text-iron-muted' },
  };
  const currentRes = table.currentReservation;
  const nextRes = table.upcomingReservations[0] as (Reservation & { minutesUntil: number }) | undefined;
  const displayRes = currentRes ?? nextRes ?? null;
  const isAvailable = table.liveStatus === 'AVAILABLE';
  const isOverdue = isToday
    && table.liveStatus === 'OCCUPIED'
    && currentRes != null
    && minutesUntilEnd(currentRes.expectedEndTime, operationalNow ?? Date.now()) < -5;

  const style = STATUS_STYLE[displayStatus] ?? STATUS_STYLE['AVAILABLE'];

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={turnTooltip ?? (isAvailable ? T.tableCard.clickToSeat : undefined)}
      className={`
        group w-full text-left p-3 rounded-lg border transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 active:scale-[0.97] touch-manipulation
        ${table.locked ? 'bg-amber-500/5' : isOverdue ? 'bg-orange-900/12' : (style.bg || (isAvailable ? 'bg-iron-card hover:bg-iron-elevated/30' : 'bg-iron-card'))}
        ${selected
          ? 'border-iron-green ring-2 ring-iron-green-light/55 ring-offset-1 ring-offset-iron-bg'
          : softHold && table.liveStatus === 'AVAILABLE' && !table.locked
          ? 'border-indigo-500/60 ring-2 ring-indigo-500/20 ring-offset-1 ring-offset-iron-bg'
          : isBestSuggestion && !table.locked
          ? `${style.border} ring-2 ring-iron-green/20 ring-offset-1 ring-offset-iron-bg`
          : table.locked ? LOCKED_STYLE : isOverdue ? 'border-orange-500/80' : style.border}
      `}
    >
      {/* Name + priority dot + turn badge + status label */}
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-iron-text font-semibold text-[15px] leading-tight truncate">{table.name}</span>
          {insight?.priority === 'HIGH'   && <span className="w-2 h-2 rounded-full shrink-0 bg-red-500"   title={insight.message} />}
          {insight?.priority === 'MEDIUM' && <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" title={insight.message} />}
          {extraTurns > 0 && !isAvailable && (
            <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded bg-blue-500/15 border border-blue-500/25 text-blue-400 tabular-nums">
              +{extraTurns}
            </span>
          )}
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium shrink-0 ${style.labelColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
          {style.label}
        </span>
      </div>

      {/* Lock badge */}
      {table.locked && (
        <div className="flex items-center gap-1 mb-1.5">
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400">
            {T.tableCard.locked}{table.lockReason ? ` · ${table.lockReason}` : ''}
          </span>
        </div>
      )}

      {/* Capacity + section */}
      <p className="text-iron-muted text-xs font-medium mb-1.5 leading-tight">
        {table.minCovers}–{table.maxCovers} {T.tableCard.covers}
        {table.section && (
          <span> · {formatSectionName(table.section.name, locale)}</span>
        )}
      </p>

      {/* Context line */}
      {table.liveStatus === 'BLOCKED' && (
        <p className="text-iron-muted text-[11px] truncate">{table.blockReason}</p>
      )}

      {table.liveStatus === 'OCCUPIED' && currentRes && (() => {
        const mr = minutesUntilEnd(currentRes.expectedEndTime, operationalNow ?? Date.now());
        const isCombined   = currentRes.combinedTableIds.length > 0;
        const isSecondary  = isCombined && currentRes.combinedTableIds.includes(table.id);
        return (
          <div>
            <div className="flex items-center gap-1 min-w-0">
              <p className="text-iron-text text-[13px] font-semibold truncate flex-1">{currentRes.guestName}</p>
              {isCombined && (
                <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded border bg-blue-500/15 border-blue-500/30 text-blue-400">⊞</span>
              )}
            </div>
            {!isSecondary && (
              <p className="text-iron-muted text-xs font-medium">
                {T.common.guests(currentRes.partySize)}
                {isToday && mr > 5 && <span> · {T.tableCard.endsIn(mr)}</span>}
                {isToday && mr >= -5 && mr <= 5 && <span className="text-amber-400"> · {T.tableCard.endsNow}</span>}
                {isToday && mr < -5 && <span className="text-orange-400 font-semibold"> · {T.tableCard.overBy(Math.abs(mr))}</span>}
              </p>
            )}
          </div>
        );
      })()}

      {(table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON') && displayRes && (() => {
        const isCombined  = (displayRes.combinedTableIds?.length ?? 0) > 0;
        const isSecondary = isCombined && displayRes.combinedTableIds?.includes(table.id);
        return (
          <div>
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-iron-text text-[13px] font-semibold truncate flex-1">{displayRes.guestName}</p>
              {isCombined && (
                <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded border bg-blue-500/15 border-blue-500/30 text-blue-400">⊞</span>
              )}
              {displayRes.isConfirmedByGuest && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold">✓</span>
              )}
              {!displayRes.isConfirmedByGuest && displayRes.confirmationSentAt && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border bg-blue-500/10 border-blue-500/25 text-blue-400 font-semibold">SMS</span>
              )}
            </div>
            {!isSecondary && (
              <p className="text-iron-muted text-[11px] font-medium">
                {T.common.guests(displayRes.partySize)} · {displayRes.time}
                {isToday && nextRes && nextRes.minutesUntil > 0 && (
                  <span> · {T.tableCard.inNMin(nextRes.minutesUntil)}</span>
                )}
              </p>
            )}
          </div>
        );
      })()}

      {isAvailable && insight?.type === 'SEAT_NOW' && insight.reservation && (
        <div
          onClick={(e) => { e.stopPropagation(); onInsightAction?.(); }}
          className="mt-0.5 -mx-0.5 px-1.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/30 cursor-pointer hover:bg-iron-green/25 transition-colors"
        >
          <p className="text-iron-green-light text-[11px] font-medium truncate">
            → {insight.reservation.guestName} · {T.common.guests(insight.reservation.partySize)} · {insight.reservation.time}
          </p>
          <p className="text-iron-muted text-[11px] truncate">{insight.reason}</p>
        </div>
      )}

      {isAvailable && softHold && !insight && (
        <div className="mt-0.5 -mx-0.5 px-1.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30">
          <p className="text-indigo-300 text-[11px] font-medium truncate">
            ⏸ {softHold.guestName} · {T.common.guests(softHold.partySize)}
          </p>
          <p className="text-iron-muted text-[11px]">{isToday ? (() => { const m = waitMins(softHold.addedAt, operationalNow ?? Date.now()); return m < 1 ? T.waitlistPanel.justAdded : T.flowControl.softHoldWaiting(m); })() : ''}</p>
        </div>
      )}

      {isAvailable && !insight && !softHold && waitlistMatch && (
        <div
          onClick={(e) => { e.stopPropagation(); onWaitlistAction?.(); }}
          className="mt-0.5 -mx-0.5 px-1.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/30 cursor-pointer hover:bg-iron-green/25 transition-colors"
        >
          <p className="text-iron-green-light text-[11px] font-medium truncate">
            → {waitlistMatch.guestName} · {T.common.guests(waitlistMatch.partySize)}
          </p>
          <p className="text-iron-muted text-[11px]">{isToday ? (() => { const m = waitMins(waitlistMatch.addedAt, operationalNow ?? Date.now()); return m < 1 ? T.waitlistPanel.justAdded : T.tableCard.waitlistWaiting(m); })() : ''}</p>
        </div>
      )}

      {isAvailable && !insight && !softHold && !waitlistMatch && (
        <p className="text-iron-muted text-xs font-medium group-hover:text-iron-green-light transition-colors">
          {T.tableCard.openTapToSeat}
        </p>
      )}
    </button>
  );
}
