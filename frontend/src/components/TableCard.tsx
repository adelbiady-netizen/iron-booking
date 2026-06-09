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

const LOCKED_STYLE = 'border-status-warning/40 bg-status-warning/5 opacity-60';

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
    AVAILABLE:      { border: 'border-iron-border/55 hover:border-iron-green/55',   bg: '',                   dot: 'bg-iron-border/75',    label: T.tableStatus.AVAILABLE,      labelColor: 'text-iron-muted/70' },
    OCCUPIED:       { border: 'border-iron-green/80',                               bg: 'bg-iron-green/14',   dot: 'bg-iron-green-light',  label: T.tableStatus.OCCUPIED,       labelColor: 'text-iron-green-light' },
    RESERVED_SOON:  { border: 'border-status-warning/90',                                bg: 'bg-status-warning/12',    dot: 'bg-status-warning',         label: T.tableStatus.RESERVED_SOON,  labelColor: 'text-status-warning' },
    RESERVED:       { border: 'border-status-reserved/55',                                 bg: 'bg-blue-950/28',     dot: 'bg-status-reserved',          label: T.tableStatus.RESERVED,       labelColor: 'text-status-reserved/90' },
    BLOCKED:        { border: 'border-iron-border/40',                              bg: 'bg-iron-bg/55',      dot: 'bg-iron-muted/55',     label: T.tableStatus.BLOCKED,        labelColor: 'text-iron-muted/65' },
    STALE_OCCUPIED: { border: 'border-amber-600/28',                                bg: 'bg-status-warning/5',     dot: 'bg-status-warning/60',      label: T.tableStatus.STALE_OCCUPIED, labelColor: 'text-amber-600/55' },
  };
  const currentRes = table.currentReservation;
  const nextRes = table.upcomingReservations[0] as (Reservation & { minutesUntil: number }) | undefined;
  const displayRes = currentRes ?? nextRes ?? null;
  const isAvailable = table.liveStatus === 'AVAILABLE';

  const mr_live = (isToday && table.liveStatus === 'OCCUPIED' && currentRes != null)
    ? minutesUntilEnd(currentRes.expectedEndTime, operationalNow ?? Date.now())
    : null;
  const isOverdue    = mr_live !== null && mr_live < 0;
  const isEndingSoon = mr_live !== null && mr_live >= 0 && mr_live <= 10;

  const style = STATUS_STYLE[displayStatus] ?? STATUS_STYLE['AVAILABLE'];

  const shadowStyle: React.CSSProperties = (() => {
    if (selected)             return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(111,138,60,0.24), 0 4px 18px rgba(0,0,0,0.52)' };
    if (table.locked)         return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 8px rgba(0,0,0,0.28)' };
    if (isOverdue)            return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(239,68,68,0.32), 0 2px 18px rgba(0,0,0,0.52)' };
    if (isEndingSoon)         return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(251,191,36,0.22), 0 2px 14px rgba(0,0,0,0.46)' };
    switch (displayStatus) {
      case 'OCCUPIED':      return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(111,138,60,0.14), 0 2px 14px rgba(0,0,0,0.42)' };
      case 'RESERVED_SOON': return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(245,158,11,0.12), 0 2px 12px rgba(0,0,0,0.36)' };
      case 'RESERVED':      return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 0 0 1px rgba(59,130,246,0.08), 0 2px 10px rgba(0,0,0,0.32)' };
      default:              return { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 7px rgba(0,0,0,0.26)' };
    }
  })();

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={turnTooltip ?? (isAvailable ? T.tableCard.clickToSeat : undefined)}
      style={shadowStyle}
      className={`
        group w-full text-left p-3 rounded-lg border transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 active:scale-[0.97] touch-manipulation
        ${table.locked ? 'bg-status-warning/5' : isOverdue ? 'bg-status-danger/20' : isEndingSoon ? 'bg-status-warning/16' : (style.bg || (isAvailable ? 'bg-iron-card hover:bg-iron-elevated/30' : 'bg-iron-card'))}
        ${selected
          ? 'border-iron-green ring-2 ring-iron-green-light/55 ring-offset-1 ring-offset-iron-bg'
          : softHold && table.liveStatus === 'AVAILABLE' && !table.locked
          ? 'border-status-info/60 ring-2 ring-status-info/20 ring-offset-1 ring-offset-iron-bg'
          : isBestSuggestion && !table.locked
          ? `${style.border} ring-2 ring-iron-green/20 ring-offset-1 ring-offset-iron-bg`
          : table.locked ? LOCKED_STYLE : isOverdue ? 'border-status-danger/85' : isEndingSoon ? 'border-status-warning/80' : style.border}
      `}
    >
      {/* Name + priority dot + turn badge + status label */}
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-iron-text font-semibold text-[15px] leading-tight truncate">{table.name}</span>
          {insight?.priority === 'HIGH'   && <span className="w-2 h-2 rounded-full shrink-0 bg-status-danger"   title={insight.message} />}
          {insight?.priority === 'MEDIUM' && <span className="w-2 h-2 rounded-full shrink-0 bg-status-warning" title={insight.message} />}
          {extraTurns > 0 && !isAvailable && (
            <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded bg-status-reserved/15 border border-status-reserved/25 text-status-reserved tabular-nums">
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
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border bg-status-warning/10 border-status-warning/30 text-status-warning">
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
                <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded border bg-status-reserved/15 border-status-reserved/30 text-status-reserved">⊞</span>
              )}
            </div>
            <p className="text-iron-muted text-xs font-medium">
              {T.common.guests(currentRes.partySize)}
              {!isSecondary && isToday && mr > 10 && <span> · {T.tableCard.endsIn(mr)}</span>}
              {!isSecondary && isToday && mr > 5 && mr <= 10 && <span className="text-status-warning font-medium"> · {T.tableCard.endsIn(mr)}</span>}
              {!isSecondary && isToday && mr >= -5 && mr <= 5 && <span className="text-status-warning"> · {T.tableCard.endsNow}</span>}
              {!isSecondary && isToday && mr < -5 && <span className="text-status-danger font-semibold"> · {T.tableCard.overBy(Math.abs(mr))}</span>}
            </p>
          </div>
        );
      })()}

      {table.liveStatus === 'STALE_OCCUPIED' && currentRes && (() => {
        const isCombined  = currentRes.combinedTableIds.length > 0;
        const isSecondary = isCombined && currentRes.combinedTableIds.includes(table.id);
        return (
          <div>
            <div className="flex items-center gap-1 min-w-0">
              <p className="text-amber-800/70 text-[13px] font-medium truncate flex-1">{currentRes.guestName}</p>
              {isCombined && (
                <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded border bg-status-warning/10 border-status-warning/20 text-amber-600/60">⊞</span>
              )}
            </div>
            <p className="text-amber-600/50 text-xs font-medium">
              {T.common.guests(currentRes.partySize)}
              {!isSecondary && <span> · {T.tableStatus.STALE_OCCUPIED}</span>}
            </p>
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
                <span className="shrink-0 text-[10px] font-bold px-1 py-px rounded border bg-status-reserved/15 border-status-reserved/30 text-status-reserved">⊞</span>
              )}
              {displayRes.isConfirmedByGuest && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border bg-status-success/10 border-status-success/30 text-status-success font-semibold">✓</span>
              )}
              {!displayRes.isConfirmedByGuest && displayRes.confirmationSentAt && (
                <span className="shrink-0 text-[10px] px-1 py-0.5 rounded border bg-status-reserved/10 border-status-reserved/25 text-status-reserved font-semibold">SMS</span>
              )}
            </div>
            <p className="text-iron-muted text-[11px] font-medium">
              {T.common.guests(displayRes.partySize)}
              {!isSecondary && <> · {displayRes.time}
                {isToday && nextRes && nextRes.minutesUntil > 0 && (
                  <span> · {T.tableCard.inNMin(nextRes.minutesUntil)}</span>
                )}
              </>}
            </p>
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
        <div className="mt-0.5 -mx-0.5 px-1.5 py-1 rounded-md bg-status-info/10 border border-status-info/30">
          <p className="text-status-info text-[11px] font-medium truncate">
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
