import { useState, useMemo, useEffect } from 'react';
import type { Reservation } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';

interface Props {
  date: string;   // board's current date (reservations already loaded for this)
  time: string;   // board's current time (used for "next 2h" filter)
  reservations: Reservation[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

type DateMode = 'today' | 'tomorrow' | 'custom';
type Phase    = 'preview' | 'sending' | 'done';

function computeToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function computeTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export default function BulkConfirmModal({ date, time, reservations, onClose, onSuccess }: Props) {
  const T = useT();

  // Anchor these once on mount — they don't change while the modal is open.
  const [todayDate]    = useState(computeToday);
  const [tomorrowDate] = useState(computeTomorrow);

  // ── Date targeting ────────────────────────────────────────────────────────
  const initialMode: DateMode =
    date === todayDate    ? 'today'
    : date === tomorrowDate ? 'tomorrow'
    : 'custom';

  const [dateMode,   setDateMode]   = useState<DateMode>(initialMode);
  const [customDate, setCustomDate] = useState(date);

  const targetDate =
    dateMode === 'today'    ? todayDate
    : dateMode === 'tomorrow' ? tomorrowDate
    : customDate;

  // ── Filters ───────────────────────────────────────────────────────────────
  const [withinTwoHours, setWithinTwoHours] = useState(false);

  // ── Fetch reservations when target ≠ board date ───────────────────────────
  const [fetchedRes,   setFetchedRes]   = useState<Reservation[] | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);

  useEffect(() => {
    if (targetDate === date) {
      setFetchedRes(null);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    setFetchLoading(true);
    setFetchError(null);
    api.reservations.list({ date: targetDate, limit: '500' })
      .then(r => { if (!cancelled) setFetchedRes(r.data); })
      .catch(e => { if (!cancelled) setFetchError(e instanceof Error ? e.message : T.bulkConfirm.fetchError); })
      .finally(() => { if (!cancelled) setFetchLoading(false); });
    return () => { cancelled = true; };
  }, [targetDate, date, T.bulkConfirm.fetchError]);

  const activeRes: Reservation[] = targetDate === date ? reservations : (fetchedRes ?? []);
  const isLoading = targetDate !== date && fetchLoading;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total      = activeRes.length;
    const badStatus  = activeRes.filter(r => ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(r.status)).length;
    const noPhone    = activeRes.filter(r => !r.guestPhone && !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(r.status)).length;
    const alreadyOk  = activeRes.filter(r =>
      ['PENDING', 'CONFIRMED'].includes(r.status) && Boolean(r.guestPhone) && r.isConfirmedByGuest,
    ).length;

    const eligible = activeRes.filter(r => {
      if (!['PENDING', 'CONFIRMED'].includes(r.status)) return false;
      if (!r.guestPhone) return false;
      if (r.isConfirmedByGuest) return false;
      if (withinTwoHours && targetDate === todayDate) {
        const [rH, rM] = r.time.split(':').map(Number);
        const [nH, nM] = time.split(':').map(Number);
        const diff = (rH * 60 + rM) - (nH * 60 + nM);
        if (diff < 0 || diff > 120) return false;
      }
      return true;
    });

    const now      = Date.now();
    const cooldown = eligible.filter(r =>
      r.confirmationSentAt && now - new Date(r.confirmationSentAt).getTime() < 60 * 60 * 1000,
    ).length;

    return { total, badStatus, noPhone, alreadyOk, eligible, cooldown };
  }, [activeRes, withinTwoHours, targetDate, todayDate, time]);

  // ── Send / result ─────────────────────────────────────────────────────────
  const [phase,     setPhase]     = useState<Phase>('preview');
  const [result,    setResult]    = useState<{ sent: number; failed: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSend() {
    if (stats.eligible.length === 0 || phase !== 'preview') return;
    setPhase('sending');
    setSendError(null);
    try {
      const body: { date: string; timeFrom?: string; timeTo?: string } = { date: targetDate };
      if (withinTwoHours && targetDate === todayDate) {
        body.timeFrom = time;
        body.timeTo   = addMinutes(time, 120);
      }
      const res = await api.reservations.sendBulkConfirmations(body);
      setResult({ sent: res.sent, failed: res.failed.length });
      setPhase('done');
      if (res.sent > 0) onSuccess(T.bulkConfirm.resultSent(res.sent));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : T.bulkConfirm.sendError);
      setPhase('preview');
    }
  }

  const canSend = stats.eligible.length > 0 && phase === 'preview' && !isLoading && !fetchError;

  // ── Date selector buttons ─────────────────────────────────────────────────
  const modes: { key: DateMode; label: string }[] = [
    { key: 'today',    label: T.bulkConfirm.targetToday    },
    { key: 'tomorrow', label: T.bulkConfirm.targetTomorrow },
    { key: 'custom',   label: T.bulkConfirm.targetCustom   },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16">
      <div className="fixed inset-0 bg-black/50" onClick={phase !== 'sending' ? onClose : undefined} />

      <div className="relative bg-iron-card border border-iron-border rounded-xl shadow-2xl w-[22rem] z-10 flex flex-col max-h-[calc(100vh-5rem)] overflow-hidden">

        {/* ── HEADER ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-iron-border shrink-0">
          <h2 className="text-iron-text font-semibold text-sm">{T.bulkConfirm.title}</h2>
          {phase !== 'sending' && (
            <button onClick={onClose} className="text-iron-muted hover:text-iron-text text-xl leading-none" aria-label="Close">×</button>
          )}
        </div>

        {/* ── BODY ── */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">

          {/* Date selector — hidden once sending/done */}
          {phase === 'preview' && (
            <div className="space-y-2">
              <p className="text-iron-muted text-[11px] font-medium uppercase tracking-wider">{T.bulkConfirm.targetLabel}</p>
              <div className="flex gap-1.5">
                {modes.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setDateMode(key)}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors flex-1 ${
                      dateMode === key
                        ? 'bg-iron-green/20 border-iron-green/50 text-iron-green-light font-medium'
                        : 'border-iron-border text-iron-muted hover:text-iron-text hover:border-iron-text/30'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Custom date picker */}
              {dateMode === 'custom' && (
                <input
                  type="date"
                  value={customDate}
                  onChange={e => setCustomDate(e.target.value)}
                  className="w-full bg-iron-bg border border-iron-border rounded-lg px-2.5 py-1.5 text-iron-text text-xs focus:outline-none focus:border-iron-green/60"
                />
              )}

              {/* Active target date label */}
              <p className="text-iron-text text-xs font-medium">{fmtDate(targetDate)}</p>
            </div>
          )}

          {/* Result date label (done state) */}
          {phase === 'done' && (
            <p className="text-iron-muted text-xs">{fmtDate(targetDate)}</p>
          )}

          {/* ── STATS ── */}
          {phase !== 'done' && (
            <div className="space-y-3">
              {isLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                  <span className="text-iron-muted text-xs">{T.bulkConfirm.loading}</span>
                </div>
              ) : fetchError ? (
                <p className="text-status-danger text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">{fetchError}</p>
              ) : (
                <>
                  {/* Total */}
                  {stats.total > 0 && (
                    <p className="text-iron-muted text-xs">{T.bulkConfirm.totalCount(stats.total)}</p>
                  )}

                  {/* Primary number — will receive */}
                  <p className={`font-semibold text-sm ${stats.eligible.length > 0 ? 'text-iron-green-light' : 'text-iron-muted'}`}>
                    {stats.eligible.length > 0
                      ? T.bulkConfirm.eligibleCount(stats.eligible.length)
                      : T.bulkConfirm.noEligible}
                  </p>

                  {/* Exclusions breakdown */}
                  {(stats.alreadyOk > 0 || stats.noPhone > 0 || stats.badStatus > 0 || stats.cooldown > 0) && (
                    <div className="border-t border-iron-border/40 pt-2.5 space-y-1.5">
                      {stats.alreadyOk > 0 && (
                        <p className="text-status-success/80 text-xs flex items-center gap-1.5">
                          <span className="text-status-success shrink-0">✓</span>
                          {T.bulkConfirm.alreadyConfirmed(stats.alreadyOk)}
                        </p>
                      )}
                      {stats.noPhone > 0 && (
                        <p className="text-iron-muted text-xs flex items-center gap-1.5">
                          <span className="shrink-0">—</span>
                          {T.bulkConfirm.excludedNoPhone(stats.noPhone)}
                        </p>
                      )}
                      {stats.badStatus > 0 && (
                        <p className="text-iron-muted text-xs flex items-center gap-1.5">
                          <span className="shrink-0">—</span>
                          {T.bulkConfirm.excludedBadStatus(stats.badStatus)}
                        </p>
                      )}
                      {stats.cooldown > 0 && (
                        <p className="text-status-warning/80 text-xs flex items-center gap-1.5">
                          <span className="text-status-warning shrink-0">⚠</span>
                          {T.bulkConfirm.cooldown(stats.cooldown)}
                        </p>
                      )}
                    </div>
                  )}

                  {/* "Only next 2 hours" — today only */}
                  {targetDate === todayDate && stats.total > 0 && (
                    <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        checked={withinTwoHours}
                        onChange={e => setWithinTwoHours(e.target.checked)}
                        className="w-3.5 h-3.5 accent-iron-green-light"
                      />
                      <span className="text-iron-text text-xs">{T.bulkConfirm.toggleNextTwo}</span>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {/* Result */}
          {phase === 'done' && result && (
            <div className="space-y-1.5">
              <p className="text-status-success font-semibold text-sm">{T.bulkConfirm.resultSent(result.sent)}</p>
              {result.failed > 0 && (
                <p className="text-status-danger text-sm">{T.bulkConfirm.resultFailed(result.failed)}</p>
              )}
            </div>
          )}

          {/* Send error */}
          {sendError && (
            <p className="text-status-danger text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">{sendError}</p>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div className="px-5 pb-5 pt-1 shrink-0">
          {phase === 'done' ? (
            <button
              onClick={onClose}
              className="w-full text-xs font-medium py-2 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
            >
              {T.bulkConfirm.close}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-full text-sm font-semibold py-2.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-iron-green-light border-iron-green-light text-white hover:bg-iron-green"
            >
              {phase === 'sending' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-iron-green-light border-t-transparent rounded-full animate-spin inline-block" />
                  {T.bulkConfirm.sending}
                </span>
              ) : canSend ? (
                T.bulkConfirm.sendButton(stats.eligible.length)
              ) : (
                T.bulkConfirm.noEligible
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
