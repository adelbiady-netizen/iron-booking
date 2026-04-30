import { useState } from 'react';
import type { Reservation, ReservationStatus, Table } from '../types';
import { api } from '../api';
import type React from 'react';
import { T } from '../strings';
import { arrivalState, minutesUntilRes } from '../utils/arrival';

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING:   T.reservationStatus.PENDING,
  CONFIRMED: T.reservationStatus.CONFIRMED,
  SEATED:    T.reservationStatus.SEATED,
  COMPLETED: T.reservationStatus.COMPLETED,
  CANCELLED: T.reservationStatus.CANCELLED,
  NO_SHOW:   T.reservationStatus.NO_SHOW,
};

const STATUS_PILL: Record<ReservationStatus, string> = {
  PENDING:   'bg-amber-500/15 text-amber-400',
  CONFIRMED: 'bg-blue-500/15 text-blue-400',
  SEATED:    'bg-iron-green/25 text-iron-green-light',
  COMPLETED: 'bg-iron-border/20 text-iron-muted',
  CANCELLED: 'bg-red-900/15 text-red-400',
  NO_SHOW:   'bg-orange-900/15 text-orange-400',
};

interface RowProps { label: string; value: string; accent?: boolean; warn?: boolean }
function Row({ label, value, accent, warn }: RowProps) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-iron-muted text-xs shrink-0">{label}</span>
      <span className={`text-xs text-right ${warn ? 'text-orange-400' : accent ? 'text-iron-green-light' : 'text-iron-text'}`}>
        {value}
      </span>
    </div>
  );
}

function Ts({ label, ts }: { label: string; ts: string }) {
  const d = new Date(ts);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex justify-between">
      <span className="text-iron-muted text-xs">{label}</span>
      <span className="text-iron-text text-xs tabular-nums">{t}</span>
    </div>
  );
}

// ─── Table picker ─────────────────────────────────────────────────────────────

interface TablePickerProps {
  tables: Table[];
  excludeId?: string | null;
  label: string;
  busy: boolean;
  onPick: (tableId: string) => void;
  onBack: () => void;
}

function TablePicker({ tables, excludeId, label, busy, onPick, onBack }: TablePickerProps) {
  const candidates = tables.filter(t => t.isActive && t.id !== excludeId);

  return (
    <div>
      <p className="text-iron-muted text-xs mb-2">{label}</p>
      {candidates.length === 0 && (
        <p className="text-iron-muted text-xs italic">{T.guestDrawer.noTablesAvailable}</p>
      )}
      <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-1">
        {candidates.map(t => (
          <button
            key={t.id}
            disabled={busy}
            onClick={() => onPick(t.id)}
            className="text-xs p-2 rounded-lg border border-iron-border hover:border-iron-green text-iron-text text-center transition-colors disabled:opacity-40"
          >
            <div className="font-semibold">{t.name}</div>
            <div className="text-iron-muted text-[10px]">
              {t.minCovers}–{t.maxCovers}
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={onBack}
        className="mt-2 text-iron-muted text-xs hover:text-iron-text transition-colors"
      >
        {T.guestDrawer.backLink}
      </button>
    </div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

interface ActionBtnProps {
  label: string;
  cls: string;
  onClick: () => void;
  disabled: boolean;
}

function ActionBtn({ label, cls, onClick, disabled }: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  children: React.ReactNode;
}
function Field({ label, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-iron-muted text-xs">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-iron-bg border border-iron-border rounded-lg px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors';

// ─── Main drawer ──────────────────────────────────────────────────────────────

type Mode = 'view' | 'edit' | 'seat' | 'move' | 'cancel' | 'lock';

const LOCK_QUICK_REASONS = T.guestDrawer.quickLockReasons;

interface Props {
  reservation: Reservation;
  tables: Table[];
  onClose: () => void;
  onUpdated: (r: Reservation) => void;
  onSuccess?: (message: string) => void;
  onTableLockChange?: () => void;
  nowTime?: string;
}

export default function GuestDrawer({ reservation: init, tables, onClose, onUpdated, onSuccess, onTableLockChange, nowTime }: Props) {
  const [res, setRes] = useState<Reservation>(init);
  const [mode, setMode] = useState<Mode>('view');
  const [cancelReason, setCancelReason] = useState('');
  const [lockReason,   setLockReason]   = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit form state — initialised when entering edit mode
  const [editName,       setEditName]       = useState('');
  const [editPhone,      setEditPhone]      = useState('');
  const [editParty,      setEditParty]      = useState('');
  const [editDuration,   setEditDuration]   = useState(0);
  const [originalDuration, setOriginalDuration] = useState(0);
  const [editNotes,      setEditNotes]      = useState('');
  const [editHostNotes,  setEditHostNotes]  = useState('');

  function enterEdit() {
    setEditName(res.guestName);
    setEditPhone(res.guestPhone ?? '');
    setEditParty(String(res.partySize));
    setEditDuration(res.duration);
    setOriginalDuration(res.duration);
    setEditNotes(res.guestNotes ?? '');
    setEditHostNotes(res.hostNotes ?? '');
    setError(null);
    setMode('edit');
  }

  function adjustDuration(delta: number) {
    setEditDuration(prev => Math.min(480, Math.max(30, prev + delta)));
  }

  async function saveEdit() {
    const partySize = parseInt(editParty, 10);
    if (!editName.trim()) { setError(T.guestDrawer.fieldGuestName + ' is required'); return; }
    if (isNaN(partySize) || partySize < 1) { setError(T.guestDrawer.fieldPartySize + ' must be at least 1'); return; }
    if (editDuration < 30) { setError(T.guestDrawer.fieldDuration + ' must be at least 30 minutes'); return; }

    await run(
      () => api.reservations.update(res.id, {
        guestName:  editName.trim(),
        guestPhone: editPhone.trim() || undefined,
        partySize,
        duration:   editDuration,
        guestNotes: editNotes.trim() || undefined,
        hostNotes:  editHostNotes.trim() || undefined,
      }),
      'Reservation updated'
    );
  }

  async function run(fn: () => Promise<Reservation>, successMsg?: string) {
    setError(null);
    setBusy(true);
    try {
      const updated = await fn();
      setRes(updated);
      onUpdated(updated);
      setMode('view');
      if (successMsg) onSuccess?.(successMsg);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : T.guestDrawer.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  // ─── Action buttons per status ──────────────────────────────────────────────

  const btnGreen  = 'bg-iron-green/20 border-iron-green/40 text-iron-green-light hover:bg-iron-green/30';
  const btnBlue   = 'bg-blue-500/15 border-blue-500/30 text-blue-400 hover:bg-blue-500/25';
  const btnAmber  = 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25';
  const btnRed    = 'bg-red-900/15 border-red-900/25 text-red-400 hover:bg-red-900/25';
  const btnNeutral= 'bg-iron-border/20 border-iron-border/40 text-iron-text hover:bg-iron-border/30';

  const assignedTable   = res.tableId ? tables.find(t => t.id === res.tableId) ?? null : null;
  const tableIsLocked   = assignedTable?.locked ?? false;

  async function handleLockTable() {
    if (!assignedTable) return;
    setError(null); setBusy(true);
    try {
      await api.tables.lock(assignedTable.id, { reason: lockReason.trim() || null });
      setMode('view'); setLockReason('');
      onSuccess?.(T.guestDrawer.toastLocked(assignedTable.name));
      onTableLockChange?.();
    } catch (err) { setError(err instanceof Error ? err.message : T.lockModal.errorFailed); }
    finally { setBusy(false); }
  }

  async function handleUnlockTable() {
    if (!assignedTable) return;
    setError(null); setBusy(true);
    try {
      await api.tables.unlock(assignedTable.id);
      onSuccess?.(T.guestDrawer.toastUnlocked(assignedTable.name));
      onTableLockChange?.();
    } catch (err) { setError(err instanceof Error ? err.message : T.hostDashboard.toastUnlockFail); }
    finally { setBusy(false); }
  }

  function tableName(id: string) {
    return tables.find(t => t.id === id)?.name ?? 'table';
  }

  function ConfirmationSection() {
    const isClosed = ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(res.status);

    // "Needs reminder" — within 60 min, not yet confirmed, initial SMS already sent, <2 reminders
    const needsReminder = (() => {
      if (res.isConfirmedByGuest || !res.confirmationSentAt || res.reminderCount >= 2) return false;
      if (!nowTime) return false;
      const [rh, rm] = res.time.split(':').map(Number);
      const [nh, nm] = nowTime.split(':').map(Number);
      const minsUntil = (rh * 60 + rm) - (nh * 60 + nm);
      return minsUntil > 0 && minsUntil <= 60;
    })();

    const fmtTime = (iso: string) =>
      new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <section className="border-t border-iron-border pt-4 space-y-2.5">
        <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest">
          Confirmation
        </p>

        {/* Confirmation status */}
        {res.isConfirmedByGuest ? (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-emerald-400 text-xs font-medium">Guest confirmed</span>
            {res.confirmationSentAt && (
              <span className="text-iron-muted text-[11px]">· via SMS {fmtTime(res.confirmationSentAt)}</span>
            )}
          </div>
        ) : res.confirmationSentAt ? (
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${needsReminder ? 'bg-amber-400' : 'bg-blue-400'}`} />
            <span className={`text-xs ${needsReminder ? 'text-amber-400 font-medium' : 'text-blue-400'}`}>
              {needsReminder ? 'Needs reminder' : `SMS sent ${fmtTime(res.confirmationSentAt)} · awaiting reply`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-iron-muted/50 shrink-0" />
            <span className="text-iron-muted text-xs">No confirmation sent yet</span>
          </div>
        )}

        {/* Reminder status */}
        {res.remindedAt && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-iron-muted/40 shrink-0" />
            <span className="text-iron-muted text-[11px]">
              Reminder sent {fmtTime(res.remindedAt)}
              {res.reminderCount > 1 && ` (×${res.reminderCount})`}
              {res.reminderCount >= 2 && ' · max reached'}
            </span>
          </div>
        )}

        {/* Buttons */}
        {!isClosed && (
          <div className="flex flex-wrap gap-2">
            {res.guestPhone ? (
              <>
                {/* Confirmation SMS */}
                {!res.isConfirmedByGuest && (
                  <ActionBtn
                    label={res.confirmationSentAt ? 'Resend confirmation' : 'Send confirmation SMS'}
                    cls={res.confirmationSentAt ? btnNeutral : btnBlue}
                    onClick={() => run(
                      () => api.reservations.sendConfirmation(res.id),
                      res.confirmationSentAt ? 'Confirmation SMS resent' : 'Confirmation SMS sent'
                    )}
                    disabled={busy}
                  />
                )}
                {res.isConfirmedByGuest && (
                  <ActionBtn
                    label="Resend confirmation"
                    cls={btnNeutral}
                    onClick={() => run(() => api.reservations.sendConfirmation(res.id), 'Confirmation SMS resent')}
                    disabled={busy}
                  />
                )}

                {/* Reminder button — only when eligible */}
                {!res.isConfirmedByGuest && res.confirmationSentAt && res.reminderCount < 2 && (
                  <ActionBtn
                    label={needsReminder ? 'Send reminder now' : 'Send reminder'}
                    cls={needsReminder ? btnAmber : btnNeutral}
                    onClick={() => run(() => api.reservations.sendReminder(res.id), 'Reminder sent')}
                    disabled={busy}
                  />
                )}
              </>
            ) : (
              <ActionBtn
                label="No phone available"
                cls="bg-iron-border/10 border-iron-border/30 text-iron-muted cursor-not-allowed"
                onClick={() => {}}
                disabled={true}
              />
            )}

            {!res.isConfirmedByGuest && (
              <ActionBtn
                label="Mark as confirmed"
                cls={btnNeutral}
                onClick={() => run(() => api.reservations.markConfirmedByGuest(res.id), 'Marked as confirmed')}
                disabled={busy}
              />
            )}
          </div>
        )}
      </section>
    );
  }

  function Actions() {
    if (res.status === 'PENDING') return (
      <>
        <ActionBtn label={T.guestDrawer.actionConfirm}  cls={btnBlue}   onClick={() => run(() => api.reservations.confirm(res.id), T.guestDrawer.toastConfirmed)} disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionSeat}     cls={btnGreen}  onClick={() => setMode('seat')}  disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionNoShow}   cls={btnAmber}  onClick={() => run(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)}  disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionCancel}   cls={btnRed}    onClick={() => setMode('cancel')} disabled={busy} />
      </>
    );

    if (res.status === 'CONFIRMED') return (
      <>
        <ActionBtn label={T.guestDrawer.actionSeat}     cls={btnGreen}  onClick={() => setMode('seat')}  disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionNoShow}   cls={btnAmber}  onClick={() => run(() => api.reservations.noShow(res.id), T.guestDrawer.toastNoShow)}  disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionCancel}   cls={btnRed}    onClick={() => setMode('cancel')} disabled={busy} />
      </>
    );

    if (res.status === 'SEATED') return (
      <>
        <ActionBtn label={T.guestDrawer.actionComplete}   cls={btnGreen}   onClick={() => run(() => api.reservations.complete(res.id), T.guestDrawer.toastCompleted)} disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionMoveTable}  cls={btnNeutral} onClick={() => setMode('move')}   disabled={busy} />
        <ActionBtn label={T.guestDrawer.actionCancel}     cls={btnRed}     onClick={() => setMode('cancel')}  disabled={busy} />
      </>
    );

    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status)) return (
      <ActionBtn label={T.guestDrawer.actionUndo} cls={btnNeutral} onClick={() => run(() => api.reservations.undo(res.id), T.guestDrawer.toastUndone)} disabled={busy} />
    );

    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <aside className="fixed right-0 top-0 h-full w-96 bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="p-4 border-b border-iron-border shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-iron-text font-semibold text-base truncate">{res.guestName}</h2>
                {res.guest?.isVip && (
                  <span className="text-amber-400 text-xs font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                    {T.common.vip}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${STATUS_PILL[res.status]}`}>
                  {STATUS_LABEL[res.status]}
                </span>
                {res.isConfirmedByGuest && (
                  <span className="text-xs px-1.5 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium">
                    Guest confirmed
                  </span>
                )}
                {!res.isConfirmedByGuest && res.confirmationSentAt && (
                  <span className="text-xs px-1.5 py-0.5 rounded border bg-blue-500/10 border-blue-500/25 text-blue-400 font-medium">
                    SMS sent
                  </span>
                )}
                <span className="text-iron-muted text-xs">{res.partySize} guests</span>
                {res.table && (
                  <span className="text-iron-muted text-xs">· {res.table.name}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {mode === 'view' && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(res.status) && (
                <button
                  onClick={enterEdit}
                  className="text-xs font-medium px-2.5 py-1 rounded-md border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text transition-colors"
                >
                  {T.guestDrawer.editButton}
                </button>
              )}
              <button
                onClick={onClose}
                className="text-iron-muted hover:text-iron-text text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Arrival state banner — only for CONFIRMED reservations */}
          {(() => {
            if (!nowTime) return null;
            const aState = arrivalState(res.time, res.status, nowTime);
            if (!aState) return null;
            const minsLate = Math.abs(minutesUntilRes(res.time, nowTime));
            const config = {
              ARRIVING_SOON: { cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400',    dot: 'bg-amber-400',  label: T.arrival.arrivingSoon },
              DUE_NOW:       { cls: 'bg-amber-500/20 border-amber-400/40 text-amber-300',    dot: 'bg-amber-300',  label: T.arrival.dueNow },
              LATE:          { cls: 'bg-orange-900/15 border-orange-500/30 text-orange-400', dot: 'bg-orange-500', label: T.arrival.lateMin(minsLate) },
              NO_SHOW_RISK:  { cls: 'bg-red-900/20 border-red-500/30 text-red-400',          dot: 'bg-red-500',    label: T.arrival.noShowRisk },
            }[aState];
            return (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${config.cls}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
                <span className="text-xs font-semibold">{config.label}</span>
              </div>
            );
          })()}

          {/* Reservation details */}
          <section className="space-y-2">
            <Row label={T.guestDrawer.rowDate}       value={res.date} />
            <Row label={T.guestDrawer.rowTime}       value={res.time} />
            <Row label={T.guestDrawer.rowDuration}   value={T.guestDrawer.durationValue(res.duration)} />
            <Row label={T.guestDrawer.rowTable}      value={res.table?.name ?? (res.tableId ? '…' : T.guestDrawer.tableUnassigned)} />
            <Row label={T.guestDrawer.rowSource}     value={res.source} />
            {res.occasion  && <Row label={T.guestDrawer.rowOccasion}   value={res.occasion}   accent />}
            {res.guestNotes && <Row label={T.guestDrawer.rowGuestNotes} value={res.guestNotes} />}
            {res.hostNotes  && <Row label={T.guestDrawer.rowHostNotes}  value={res.hostNotes}  accent />}
          </section>

          {/* Guest CRM */}
          {res.guest && (
            <section className="border-t border-iron-border pt-4 space-y-2">
              <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-2">
                {T.guestDrawer.sectionGuestProfile}
              </p>
              <Row label={T.guestDrawer.rowName}     value={`${res.guest.firstName} ${res.guest.lastName}`} />
              {res.guest.visitCount != null && (
                <Row label={T.guestDrawer.rowVisits}   value={String(res.guest.visitCount)} />
              )}
              {res.guest.noShowCount != null && res.guest.noShowCount > 0 && (
                <Row label={T.guestDrawer.rowNoShows} value={String(res.guest.noShowCount)} warn />
              )}
              {res.guest.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {res.guest.tags.map(tag => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 bg-iron-bg border border-iron-border rounded-md text-iron-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Confirmation */}
          <ConfirmationSection />

          {/* Actions */}
          <section className="border-t border-iron-border pt-4">
            <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-3">
              {T.guestDrawer.sectionActions}
            </p>

            {mode === 'view' && (
              <div className="flex flex-wrap gap-2">
                <Actions />
              </div>
            )}

            {mode === 'edit' && (
              <div className="space-y-3">
                <Field label={T.guestDrawer.fieldGuestName}>
                  <input
                    className={inputCls}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder={T.guestDrawer.placeholderName}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldPhone}>
                  <input
                    className={inputCls}
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    placeholder={T.guestDrawer.placeholderPhone}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldPartySize}>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    max={30}
                    value={editParty}
                    onChange={e => setEditParty(e.target.value)}
                  />
                </Field>

                <Field label={T.guestDrawer.fieldDuration}>
                  {/* Quick adjust */}
                  <div className="flex gap-1.5 mb-2">
                    {([-15, +15, +30] as const).map(delta => (
                      <button
                        key={delta}
                        type="button"
                        disabled={busy}
                        onClick={() => adjustDuration(delta)}
                        className={`flex-1 text-xs py-1.5 rounded-md border transition-colors disabled:opacity-40 ${
                          delta < 0
                            ? 'border-red-900/30 text-red-400 hover:bg-red-900/15 active:bg-red-900/25'
                            : 'border-iron-green/30 text-iron-green-light hover:bg-iron-green/10 active:bg-iron-green/20'
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta}m
                      </button>
                    ))}
                  </div>

                  {/* Current duration + delta */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-iron-bg border border-iron-border mb-1.5">
                    <span className="text-iron-text text-sm font-semibold tabular-nums">
                      {editDuration} min
                    </span>
                    {editDuration !== originalDuration && (
                      <div className="flex items-center gap-2">
                        <span className="text-iron-muted text-[11px]">{T.guestDrawer.wasNMin(originalDuration)}</span>
                        <span className={`text-xs font-semibold ${
                          editDuration > originalDuration ? 'text-iron-green-light' : 'text-red-400'
                        }`}>
                          {editDuration > originalDuration
                            ? `+${editDuration - originalDuration}m`
                            : `${editDuration - originalDuration}m`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Manual fallback */}
                  <input
                    className={inputCls}
                    type="number"
                    min={30}
                    max={480}
                    step={15}
                    value={editDuration}
                    onChange={e => {
                      const v = e.target.valueAsNumber;
                      if (!isNaN(v) && v > 0) setEditDuration(Math.min(480, Math.max(30, v)));
                    }}
                    placeholder={T.guestDrawer.placeholderMinutes}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldGuestNotes}>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={2}
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder={T.guestDrawer.placeholderNotes}
                  />
                </Field>
                <Field label={T.guestDrawer.fieldHostNotes}>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={2}
                    value={editHostNotes}
                    onChange={e => setEditHostNotes(e.target.value)}
                    placeholder={T.guestDrawer.placeholderHostNotes}
                  />
                </Field>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveEdit}
                    disabled={busy}
                    className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors disabled:opacity-40"
                  >
                    {T.guestDrawer.saveChanges}
                  </button>
                  <button
                    onClick={() => setMode('view')}
                    disabled={busy}
                    className="text-iron-muted text-xs hover:text-iron-text px-3 transition-colors"
                  >
                    {T.common.cancel}
                  </button>
                </div>
              </div>
            )}

            {mode === 'seat' && (
              <TablePicker
                tables={tables}
                excludeId={null}
                label={T.guestDrawer.seatPickerLabel}
                busy={busy}
                onPick={tableId => run(() => api.reservations.seat(res.id, tableId), T.guestDrawer.toastSeated(tableName(tableId)))}
                onBack={() => setMode('view')}
              />
            )}

            {mode === 'move' && (
              <TablePicker
                tables={tables}
                excludeId={res.tableId}
                label={T.guestDrawer.movePickerLabel}
                busy={busy}
                onPick={tableId => run(() => api.reservations.move(res.id, tableId), T.guestDrawer.toastMoved(tableName(tableId)))}
                onBack={() => setMode('view')}
              />
            )}

            {mode === 'cancel' && (
              <div className="space-y-2">
                <p className="text-iron-muted text-xs">{T.guestDrawer.cancelReasonLabel}</p>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder={T.guestDrawer.cancelReasonPh}
                  className="w-full bg-iron-bg border border-iron-border rounded-lg px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-red-500 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => run(() => api.reservations.cancel(res.id, cancelReason || undefined))}
                    disabled={busy}
                    className="flex-1 text-xs py-1.5 rounded-lg bg-red-900/20 border border-red-900/30 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40"
                  >
                    {T.guestDrawer.confirmCancel}
                  </button>
                  <button
                    onClick={() => setMode('view')}
                    className="text-iron-muted text-xs hover:text-iron-text px-3 transition-colors"
                  >
                    {T.guestDrawer.backButton}
                  </button>
                </div>
              </div>
            )}

            {/* Feedback */}
            {error && (
              <p className="mt-3 text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {busy && (
              <div className="mt-3 flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                <span className="text-iron-muted text-xs">{T.common.processing}</span>
              </div>
            )}
          </section>

          {/* Table lock */}
          {assignedTable && mode !== 'lock' && (
            <section className="border-t border-iron-border pt-4">
              <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-3">{T.guestDrawer.sectionTableLock}</p>
              {tableIsLocked ? (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400">
                      {T.tableCard.locked}{assignedTable.lockReason ? ` · ${assignedTable.lockReason}` : ''}
                    </span>
                  </div>
                  <ActionBtn label={T.guestDrawer.unlockButton} cls={btnNeutral} onClick={handleUnlockTable} disabled={busy} />
                </div>
              ) : (
                <ActionBtn label={T.guestDrawer.lockTableButton} cls={btnAmber} onClick={() => { setMode('lock'); setLockReason(''); }} disabled={busy} />
              )}
            </section>
          )}

          {mode === 'lock' && assignedTable && (
            <section className="border-t border-iron-border pt-4 space-y-3">
              <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest">{T.lockModal.title(assignedTable.name)}</p>
              <div className="flex flex-wrap gap-1.5">
                {LOCK_QUICK_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setLockReason(prev => prev === r ? '' : r)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      lockReason === r
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                        : 'border-iron-border text-iron-muted hover:text-iron-text'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={lockReason}
                onChange={e => setLockReason(e.target.value)}
                placeholder={T.guestDrawer.lockReasonPh}
                className={inputCls}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleLockTable}
                  disabled={busy}
                  className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40"
                >
                  {busy ? T.guestDrawer.lockTableBusy : T.guestDrawer.lockTableConfirm}
                </button>
                <button onClick={() => setMode('view')} className="text-iron-muted text-xs hover:text-iron-text px-3">{T.common.cancel}</button>
              </div>
            </section>
          )}

          {/* Lifecycle timestamps */}
          <section className="border-t border-iron-border pt-4 space-y-2">
            <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-2">
              {T.guestDrawer.sectionTimeline}
            </p>
            {!res.confirmedAt && !res.seatedAt && !res.completedAt && !res.cancelledAt && !res.noShowAt && (
              <p className="text-iron-muted text-xs italic">{T.guestDrawer.timelineEmpty}</p>
            )}
            {res.confirmedAt && <Ts label={T.guestDrawer.tsConfirmed}  ts={res.confirmedAt} />}
            {res.seatedAt    && <Ts label={T.guestDrawer.tsSeated}     ts={res.seatedAt} />}
            {res.completedAt && <Ts label={T.guestDrawer.tsCompleted}  ts={res.completedAt} />}
            {res.cancelledAt && <Ts label={T.guestDrawer.tsCancelled}  ts={res.cancelledAt} />}
            {res.noShowAt    && <Ts label={T.guestDrawer.tsNoShow}     ts={res.noShowAt} />}
          </section>
        </div>
      </aside>
    </>
  );
}
