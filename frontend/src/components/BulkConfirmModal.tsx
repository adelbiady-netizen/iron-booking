import { useState, useMemo } from 'react';
import type { Reservation } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';

interface Props {
  date: string;
  time: string;
  reservations: Reservation[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

type Phase = 'preview' | 'sending' | 'done';

export default function BulkConfirmModal({ date, time, reservations, onClose, onSuccess }: Props) {
  const T = useT();
  const [withinTwoHours, setWithinTwoHours] = useState(false);
  const [phase, setPhase] = useState<Phase>('preview');
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Compute eligible list client-side for preview ──────────────────────────
  const eligible = useMemo(() => {
    return reservations.filter(r => {
      if (!['PENDING', 'CONFIRMED'].includes(r.status)) return false;
      if (!r.guestPhone) return false;
      if (r.isConfirmedByGuest) return false;
      if (withinTwoHours) {
        const [rH, rM] = r.time.split(':').map(Number);
        const [nH, nM] = time.split(':').map(Number);
        const diff = (rH * 60 + rM) - (nH * 60 + nM);
        if (diff < 0 || diff > 120) return false;
      }
      return true;
    });
  }, [reservations, withinTwoHours, time]);

  const alreadyConfirmedCount = useMemo(() =>
    reservations.filter(r =>
      ['PENDING', 'CONFIRMED'].includes(r.status) &&
      Boolean(r.guestPhone) &&
      r.isConfirmedByGuest,
    ).length,
  [reservations]);

  const cooldownCount = useMemo(() => {
    const now = Date.now();
    return eligible.filter(r => {
      if (!r.confirmationSentAt) return false;
      return now - new Date(r.confirmationSentAt).getTime() < 60 * 60 * 1000;
    }).length;
  }, [eligible]);

  // ── Send ──────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (eligible.length === 0 || phase !== 'preview') return;
    setPhase('sending');
    setSendError(null);
    try {
      const body: { date: string; timeFrom?: string; timeTo?: string } = { date };
      if (withinTwoHours) {
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

  const canSend = eligible.length > 0 && phase === 'preview';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={phase !== 'sending' ? onClose : undefined} />

      {/* Panel */}
      <div className="relative bg-iron-card border border-iron-border rounded-xl shadow-2xl w-80 z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-iron-border">
          <div>
            <h2 className="text-iron-text font-semibold text-sm">{T.bulkConfirm.title}</h2>
            <p className="text-iron-muted text-xs mt-0.5">{T.bulkConfirm.subtitle}</p>
          </div>
          {phase !== 'sending' && (
            <button
              onClick={onClose}
              className="text-iron-muted hover:text-iron-text text-xl leading-none ml-3 mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* Filter toggle */}
          {phase !== 'done' && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={withinTwoHours}
                onChange={e => setWithinTwoHours(e.target.checked)}
                disabled={phase === 'sending'}
                className="w-3.5 h-3.5 accent-iron-green-light"
              />
              <span className="text-iron-text text-xs">{T.bulkConfirm.toggleNextTwo}</span>
            </label>
          )}

          {/* Stats */}
          {phase !== 'done' && (
            <div className="space-y-2">
              {eligible.length > 0 ? (
                <p className="text-iron-green-light font-semibold text-sm">
                  {T.bulkConfirm.eligibleCount(eligible.length)}
                </p>
              ) : (
                <p className="text-iron-muted text-sm">{T.bulkConfirm.noEligible}</p>
              )}

              {alreadyConfirmedCount > 0 && (
                <p className="text-emerald-400/80 text-xs flex items-center gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  {T.bulkConfirm.alreadyConfirmed(alreadyConfirmedCount)}
                </p>
              )}

              {cooldownCount > 0 && (
                <p className="text-amber-400/80 text-xs flex items-center gap-1.5">
                  <span className="text-amber-400">⚠</span>
                  {T.bulkConfirm.cooldown(cooldownCount)}
                </p>
              )}
            </div>
          )}

          {/* Result */}
          {phase === 'done' && result && (
            <div className="space-y-1.5">
              <p className="text-emerald-400 font-semibold text-sm">{T.bulkConfirm.resultSent(result.sent)}</p>
              {result.failed > 0 && (
                <p className="text-red-400 text-sm">{T.bulkConfirm.resultFailed(result.failed)}</p>
              )}
            </div>
          )}

          {/* Error */}
          {sendError && (
            <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
              {sendError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
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
              className="w-full text-sm font-semibold py-2.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-iron-green/25 border-iron-green/50 text-iron-green-light hover:bg-iron-green/35 enabled:cursor-pointer"
            >
              {phase === 'sending' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-iron-green-light border-t-transparent rounded-full animate-spin inline-block" />
                  {T.bulkConfirm.sending}
                </span>
              ) : (
                canSend ? T.bulkConfirm.sendButton(eligible.length) : T.bulkConfirm.noEligible
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
