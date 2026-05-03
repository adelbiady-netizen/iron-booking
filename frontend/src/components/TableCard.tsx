import type React from 'react';
import type { FloorInsight, FloorTable, Reservation, WaitlistEntry } from '../types';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName } from '../utils/displayHelpers';
import { minutesUntilRes } from '../utils/arrival';
import { minutesUntilEnd } from '../utils/time';

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
}

export default function TableCard({ table, selected, isBestSuggestion, softHold, onClick, onContextMenu, insight, onInsightAction, waitlistMatch, onWaitlistAction, nowTime, operationalNow }: Props) {
  const T = useT();
  const { locale } = useLocale();
  const STATUS_STYLE: Record<string, StatusStyle> = {
    AVAILABLE:     { border: 'border-iron-border hover:border-iron-green',   bg: '',                  dot: 'bg-iron-muted',  label: T.tableStatus.AVAILABLE,     labelColor: 'text-iron-muted' },
    OCCUPIED:      { border: 'border-iron-green',                            bg: 'bg-iron-green/10',  dot: 'bg-iron-green',  label: T.tableStatus.OCCUPIED,      labelColor: 'text-iron-green-light' },
    RESERVED_SOON: { border: 'border-amber-500',                             bg: 'bg-amber-500/10',   dot: 'bg-amber-500',   label: T.tableStatus.RESERVED_SOON, labelColor: 'text-amber-400' },
    RESERVED:      { border: 'border-blue-500/50',                           bg: 'bg-blue-900/15',    dot: 'bg-blue-500',    label: T.tableStatus.RESERVED,      labelColor: 'text-blue-400' },
    BLOCKED:       { border: 'border-iron-border/50',                        bg: 'bg-iron-border/20', dot: 'bg-iron-muted',  label: T.tableStatus.BLOCKED,       labelColor: 'text-iron-muted' },
  };
  const currentRes = table.currentReservation;
  const nextRes = table.upcomingReservations[0] as (Reservation & { minutesUntil: number }) | undefined;
  const displayRes = currentRes ?? nextRes ?? null;
  const isAvailable = table.liveStatus === 'AVAILABLE';

  // Detect late/no-show risk for RESERVED_SOON tables
  const arrMins = nowTime && nextRes
    ? minutesUntilRes(nextRes.time, nowTime)
    : nextRes?.minutesUntil ?? null;
  const isNoShowRisk = arrMins !== null && arrMins <= -15;
  const isLate       = arrMins !== null && arrMins < -5 && !isNoShowRisk;

  const style = isNoShowRisk
    ? { ...STATUS_STYLE['RESERVED_SOON'], border: 'border-red-500/60',    bg: 'bg-red-900/15',    dot: 'bg-red-500',    label: T.arrival.noShowRisk,                              labelColor: 'text-red-400'    }
    : isLate
    ? { ...STATUS_STYLE['RESERVED_SOON'], border: 'border-orange-500/60', bg: 'bg-orange-900/15', dot: 'bg-orange-500', label: T.arrival.lateMin(Math.abs(arrMins as number)), labelColor: 'text-orange-400' }
    : (STATUS_STYLE[table.liveStatus] ?? STATUS_STYLE['AVAILABLE']);

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={isAvailable ? T.tableCard.clickToSeat : undefined}
      className={`
        group w-full text-left p-3 rounded-lg border transition-all duration-150
        ${table.locked ? 'bg-amber-500/5' : (style.bg || 'bg-iron-card')}
        ${selected
          ? 'border-iron-green ring-2 ring-iron-green/40 ring-offset-1 ring-offset-iron-bg'
          : softHold && table.liveStatus === 'AVAILABLE' && !table.locked
          ? 'border-indigo-500/60 ring-2 ring-indigo-500/20 ring-offset-1 ring-offset-iron-bg'
          : isBestSuggestion && !table.locked
          ? `${style.border} ring-2 ring-iron-green/20 ring-offset-1 ring-offset-iron-bg`
          : table.locked ? LOCKED_STYLE : style.border}
      `}
    >
      {/* Name + priority dot + status label */}
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-iron-text font-semibold text-sm leading-tight truncate">{table.name}</span>
          {insight?.priority === 'HIGH'   && <span className="w-2 h-2 rounded-full shrink-0 bg-red-500"   title={insight.message} />}
          {insight?.priority === 'MEDIUM' && <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" title={insight.message} />}
        </div>
        <span className={`flex items-center gap-1 text-[10px] font-medium shrink-0 ${style.labelColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
          {style.label}
        </span>
      </div>

      {/* Lock badge */}
      {table.locked && (
        <div className="flex items-center gap-1 mb-1.5">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400">
            {T.tableCard.locked}{table.lockReason ? ` · ${table.lockReason}` : ''}
          </span>
        </div>
      )}

      {/* Capacity + section */}
      <p className="text-iron-muted text-[11px] mb-1.5 leading-tight">
        {table.minCovers}–{table.maxCovers} {T.tableCard.covers}
        {table.section && (
          <span className="opacity-60"> · {formatSectionName(table.section.name, locale)}</span>
        )}
      </p>

      {/* Context line */}
      {table.liveStatus === 'BLOCKED' && (
        <p className="text-iron-muted text-[11px] truncate">{table.blockReason}</p>
      )}

      {table.liveStatus === 'OCCUPIED' && currentRes && (() => {
        const mr = minutesUntilEnd(currentRes.expectedEndTime, Date.now());
        return (
          <div>
            <p className="text-iron-text text-xs font-medium truncate">{currentRes.guestName}</p>
            <p className="text-iron-muted text-[11px]">
              {T.common.guests(currentRes.partySize)}
              {mr > 5 && (
                <span> · {T.tableCard.endsIn(mr)}</span>
              )}
              {mr >= -5 && mr <= 5 && (
                <span className="text-amber-400"> · {T.tableCard.endsNow}</span>
              )}
              {mr < -5 && (
                <span className="text-orange-400"> · {T.tableCard.overBy(Math.abs(mr))}</span>
              )}
            </p>
          </div>
        );
      })()}

      {(table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON') && displayRes && (
        <div>
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-iron-text text-xs font-medium truncate">{displayRes.guestName}</p>
            {displayRes.isConfirmedByGuest && (
              <span className="shrink-0 text-[9px] px-1 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold">✓</span>
            )}
            {!displayRes.isConfirmedByGuest && displayRes.confirmationSentAt && (
              <span className="shrink-0 text-[9px] px-1 py-0.5 rounded border bg-blue-500/10 border-blue-500/25 text-blue-400 font-semibold">SMS</span>
            )}
          </div>
          <p className="text-iron-muted text-[11px]">
            {T.common.guests(displayRes.partySize)} · {displayRes.time}
            {insight?.type === 'LATE_GUEST' && nextRes && nextRes.minutesUntil < 0
              ? <span className="text-red-400"> · {T.tableCard.lateBy(Math.abs(nextRes.minutesUntil))}</span>
              : nextRes && nextRes.minutesUntil > 0
              ? <span> · {T.tableCard.inNMin(nextRes.minutesUntil)}</span>
              : null
            }
          </p>
        </div>
      )}

      {isAvailable && insight?.type === 'SEAT_NOW' && insight.reservation && (
        <div
          onClick={(e) => { e.stopPropagation(); onInsightAction?.(); }}
          className="mt-0.5 -mx-0.5 px-1.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/30 cursor-pointer hover:bg-iron-green/25 transition-colors"
        >
          <p className="text-iron-green-light text-[11px] font-medium truncate">
            → {insight.reservation.guestName} · {T.common.guests(insight.reservation.partySize)} · {insight.reservation.time}
          </p>
          <p className="text-iron-muted text-[10px] truncate">{insight.reason}</p>
        </div>
      )}

      {isAvailable && softHold && !insight && (
        <div className="mt-0.5 -mx-0.5 px-1.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/30">
          <p className="text-indigo-300 text-[11px] font-medium truncate">
            ⏸ {softHold.guestName} · {T.common.guests(softHold.partySize)}
          </p>
          <p className="text-iron-muted text-[10px]">{(() => { const m = waitMins(softHold.addedAt, operationalNow ?? Date.now()); return m < 1 ? T.waitlistPanel.justAdded : T.flowControl.softHoldWaiting(m); })()}</p>
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
          <p className="text-iron-muted text-[10px]">{(() => { const m = waitMins(waitlistMatch.addedAt, operationalNow ?? Date.now()); return m < 1 ? T.waitlistPanel.justAdded : T.tableCard.waitlistWaiting(m); })()}</p>
        </div>
      )}

      {isAvailable && !insight && !softHold && !waitlistMatch && (
        <p className="text-iron-muted text-[11px] group-hover:text-iron-green-light transition-colors">
          {T.tableCard.openTapToSeat}
        </p>
      )}
    </button>
  );
}
