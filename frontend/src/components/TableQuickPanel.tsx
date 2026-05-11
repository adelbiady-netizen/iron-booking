import { useState } from 'react';
import type { FloorTable, Reservation, ReservationStatus, Table } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatReservationSource } from '../utils/displayHelpers';

const STATUS_DOT: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-400',
  CONFIRMED: 'bg-blue-400',
  SEATED:    'bg-emerald-400',
  COMPLETED: 'bg-iron-muted/50',
  CANCELLED: 'bg-red-400',
  NO_SHOW:   'bg-orange-400',
};

interface Props {
  floorTable: FloorTable;
  reservation: Reservation | null;
  allTables: Table[];
  isFutureDate: boolean;
  onClose: () => void;
  onViewFull: (res: Reservation) => void;
  onSeat: (res: Reservation) => void;
  onLock: (table: FloorTable) => void;
  onUnlock: (tableId: string) => void;
  onOpenCreate: (tableId: string) => void;
  onOpenWalkin: (tableId: string) => void;
  onUpdated: (res: Reservation) => void;
  onSuccess: (msg: string) => void;
}

export default function TableQuickPanel({
  floorTable,
  reservation: res,
  isFutureDate,
  onClose,
  onViewFull,
  onSeat,
  onLock,
  onUnlock,
  onOpenCreate,
  onOpenWalkin,
  onUpdated,
  onSuccess,
}: Props) {
  const T = useT();
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STATUS_LABEL: Record<ReservationStatus, string> = {
    PENDING:   T.reservationStatus.PENDING,
    CONFIRMED: T.reservationStatus.CONFIRMED,
    SEATED:    T.reservationStatus.SEATED,
    COMPLETED: T.reservationStatus.COMPLETED,
    CANCELLED: T.reservationStatus.CANCELLED,
    NO_SHOW:   T.reservationStatus.NO_SHOW,
  };

  async function quick(fn: () => Promise<Reservation>, msg?: string) {
    setError(null);
    setBusy(true);
    try {
      const updated = await fn();
      onUpdated(updated);
      if (msg) onSuccess(msg);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  const btnGreen   = 'bg-iron-green/20 border-iron-green/40 text-iron-green-light hover:bg-iron-green/30';
  const btnBlue    = 'bg-blue-500/15 border-blue-500/30 text-blue-400 hover:bg-blue-500/25';
  const btnAmber   = 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25';
  const btnRed     = 'bg-red-900/15 border-red-900/25 text-red-400 hover:bg-red-900/25';
  const btnNeutral = 'bg-iron-border/20 border-iron-border/40 text-iron-text hover:bg-iron-border/30';

  function Btn({ label, cls, onClick, disabled }: { label: string; cls: string; onClick: () => void; disabled?: boolean }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled || busy}
        className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${cls}`}
      >
        {label}
      </button>
    );
  }

  const statusConfig = (() => {
    if (floorTable.locked) return { cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400', dot: 'bg-amber-400', label: T.tableQuickPanel.locked };
    if (floorTable.liveStatus === 'OCCUPIED') return { cls: 'bg-iron-green/10 border-iron-green/25 text-iron-green-light', dot: 'bg-iron-green', label: T.tableQuickPanel.statusOccupied };
    if (floorTable.liveStatus === 'RESERVED') return { cls: 'bg-blue-500/10 border-blue-500/25 text-blue-400', dot: 'bg-blue-400', label: T.tableQuickPanel.statusReserved };
    return { cls: 'bg-iron-bg border-iron-border text-iron-muted', dot: 'bg-iron-muted/50', label: T.tableQuickPanel.available };
  })();

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="fixed right-0 top-0 h-full w-72 bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="p-4 border-b border-iron-border shrink-0">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-iron-text font-bold text-lg">{floorTable.name}</span>
                {floorTable.locked && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400 font-semibold">
                    {T.tableQuickPanel.locked}
                  </span>
                )}
              </div>
              <p className="text-iron-muted text-xs mt-0.5">
                {floorTable.minCovers}–{floorTable.maxCovers}
                {floorTable.section?.name ? ` · ${floorTable.section.name}` : ''}
              </p>
            </div>
            <button onClick={onClose} className="text-iron-muted hover:text-iron-text text-2xl leading-none" aria-label="Close">×</button>
          </div>

          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${statusConfig.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusConfig.dot}`} />
            <span>
              {statusConfig.label}
              {floorTable.locked && floorTable.lockReason ? ` · ${floorTable.lockReason}` : ''}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Reservation info */}
          {res && (
            <div className="space-y-3">
              {/* Guest identity */}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-iron-text font-semibold text-base leading-tight">{res.guestName}</span>
                  {res.guest?.isVip && (
                    <span className="text-amber-400 text-[10px] font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                      {T.common.vip}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[res.status]}`} />
                  <span className="text-iron-muted text-xs">{STATUS_LABEL[res.status]}</span>
                  {res.isConfirmedByGuest && (
                    <span className="text-emerald-400 text-[10px]">· {T.guestDrawer.guestConfirmed}</span>
                  )}
                  {res.isRunningLate && (
                    <span className="text-orange-400 text-[10px]">· {T.guestDrawer.runningLate}</span>
                  )}
                </div>
              </div>

              {/* Phone — tap-to-call */}
              {res.guestPhone && (
                <a
                  href={`tel:${res.guestPhone}`}
                  className="flex items-center gap-2 text-sm font-mono font-medium text-iron-text hover:text-iron-green-light transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="text-iron-muted text-xs">📞</span>
                  {res.guestPhone}
                </a>
              )}

              {/* Key details */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-iron-muted">{T.tableQuickPanel.labelTime}</span>
                  <span className="text-iron-text font-medium tabular-nums">{res.time}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-iron-muted">{T.tableQuickPanel.labelGuests}</span>
                  <span className="text-iron-text">{res.partySize}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-iron-muted">{T.tableQuickPanel.labelDuration}</span>
                  <span className="text-iron-text">{T.guestDrawer.durationValue(res.duration)}</span>
                </div>
                {res.source && (
                  <div className="flex justify-between text-xs">
                    <span className="text-iron-muted">{T.tableQuickPanel.labelSource}</span>
                    <span className="text-iron-text">{formatReservationSource(res.source, locale)}</span>
                  </div>
                )}
              </div>

              {/* Operational notes */}
              {(res.hostNotes || res.guestNotes || res.occasion) && (
                <div className="space-y-1.5">
                  {res.hostNotes && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-900/10 border border-amber-500/25">
                      <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider mb-0.5">{T.tableQuickPanel.hostNote}</p>
                      <p className="text-amber-300 text-xs">{res.hostNotes}</p>
                    </div>
                  )}
                  {res.guestNotes && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-iron-bg border border-iron-border">
                      <p className="text-[10px] text-iron-muted font-semibold uppercase tracking-wider mb-0.5">{T.tableQuickPanel.guestNote}</p>
                      <p className="text-iron-text text-xs">{res.guestNotes}</p>
                    </div>
                  )}
                  {res.occasion && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-iron-green/8 border border-iron-green/20">
                      <p className="text-iron-green-light text-xs font-medium">{res.occasion}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Context-aware actions */}
              <div className="flex flex-wrap gap-2">
                {res.status === 'PENDING' && (<>
                  <Btn label={T.guestDrawer.actionConfirm} cls={btnBlue}
                    onClick={() => quick(() => api.reservations.confirm(res.id), T.guestDrawer.toastConfirmed)} />
                  <Btn label={T.guestDrawer.actionSeat} cls={btnGreen}
                    onClick={() => { onSeat(res); onClose(); }}
                    disabled={isFutureDate} />
                  <Btn label={T.guestDrawer.actionNoShow} cls={btnAmber}
                    onClick={() => quick(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)} />
                  <Btn label={T.guestDrawer.actionCancel} cls={btnRed}
                    onClick={() => quick(() => api.reservations.cancel(res.id))} />
                </>)}

                {res.status === 'CONFIRMED' && (<>
                  <Btn label={T.guestDrawer.actionSeat} cls={btnGreen}
                    onClick={() => { onSeat(res); onClose(); }}
                    disabled={isFutureDate} />
                  <Btn label={T.guestDrawer.actionNoShow} cls={btnAmber}
                    onClick={() => quick(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)} />
                  <Btn label={T.guestDrawer.actionCancel} cls={btnRed}
                    onClick={() => quick(() => api.reservations.cancel(res.id))} />
                </>)}

                {res.status === 'SEATED' && (<>
                  <Btn label={T.guestDrawer.actionComplete} cls={btnGreen}
                    onClick={() => quick(() => api.reservations.complete(res.id), T.guestDrawer.toastCompleted)} />
                  <Btn label={T.guestDrawer.actionMoveTable} cls={btnNeutral}
                    onClick={() => { onViewFull(res); onClose(); }} />
                  <Btn label={T.guestDrawer.actionCancel} cls={btnRed}
                    onClick={() => quick(() => api.reservations.cancel(res.id))} />
                </>)}

                {['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status) && (
                  <Btn label={T.guestDrawer.actionUndo} cls={btnNeutral}
                    onClick={() => quick(() => api.reservations.undo(res.id), T.guestDrawer.toastUndone)} />
                )}
              </div>
            </div>
          )}

          {/* Available table — create or walk-in */}
          {!res && !floorTable.locked && (
            <div className="space-y-2">
              <p className="text-iron-muted text-xs">{T.tableQuickPanel.available}</p>
              <div className="flex flex-wrap gap-2">
                <Btn label={T.tableQuickPanel.newReservation} cls={btnGreen}
                  onClick={() => { onOpenCreate(floorTable.id); onClose(); }} />
                <Btn label={T.tableQuickPanel.walkIn} cls={btnNeutral}
                  onClick={() => { onOpenWalkin(floorTable.id); onClose(); }} />
              </div>
              <Btn label={T.guestDrawer.lockTableButton} cls={btnAmber}
                onClick={() => { onLock(floorTable); onClose(); }} />
            </div>
          )}

          {/* Locked table — unlock */}
          {!res && floorTable.locked && (
            <div className="space-y-2">
              {floorTable.lockReason && (
                <div className="px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
                  <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider mb-0.5">{T.tableQuickPanel.lockedTitle}</p>
                  <p className="text-amber-300 text-xs">{floorTable.lockReason}</p>
                </div>
              )}
              <Btn label={T.guestDrawer.unlockButton} cls={btnNeutral}
                onClick={() => { onUnlock(floorTable.id); onClose(); }} />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}
          {busy && (
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
              <span className="text-iron-muted text-xs">{T.common.processing}</span>
            </div>
          )}
        </div>

        {/* Footer: full details */}
        {res && (
          <div className="p-4 border-t border-iron-border shrink-0">
            <button
              onClick={() => { onViewFull(res); onClose(); }}
              className="w-full text-xs font-medium text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded-lg px-3 py-2 transition-colors"
            >
              {T.tableQuickPanel.viewFullDetails} →
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
