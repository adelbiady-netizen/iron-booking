import { useState, useEffect } from 'react';
import type { PublicReservation } from '../types';
import { api, ApiError } from '../api';

interface Props {
  token: string;
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; code: string; message: string }
  | { phase: 'ready'; reservation: PublicReservation }
  | { phase: 'confirmed' }
  | { phase: 'cancelled' }
  | { phase: 'late' }
  | { phase: 'actioning'; action: 'confirm' | 'cancel' | 'late' };

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function ConfirmationPage({ token }: Props) {
  const [state, setState] = useState<PageState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api.public.getReservation(token)
      .then(r => {
        if (cancelled) return;
        // Already-confirmed state: show confirm screen directly
        if (r.status === 'CANCELLED') {
          setState({ phase: 'cancelled' });
        } else if (r.isConfirmedByGuest && !r.isRunningLate) {
          setState({ phase: 'confirmed' });
        } else {
          setState({ phase: 'ready', reservation: r });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? (err.message.includes('expired') ? 'EXPIRED' : 'ERROR') : 'ERROR';
        const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
        setState({ phase: 'error', code, message });
      });
    return () => { cancelled = true; };
  }, [token]);

  async function handleConfirm() {
    if (state.phase !== 'ready') return;
    setState({ phase: 'actioning', action: 'confirm' });
    try {
      await api.public.confirm(token);
      setState({ phase: 'confirmed' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not confirm. Please try again.';
      setState({ phase: 'error', code: 'ACTION_FAILED', message });
    }
  }

  async function handleCancel() {
    if (state.phase !== 'ready' && state.phase !== 'confirmed') return;
    setState({ phase: 'actioning', action: 'cancel' });
    try {
      await api.public.cancel(token);
      setState({ phase: 'cancelled' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not cancel. Please try again.';
      setState({ phase: 'error', code: 'ACTION_FAILED', message });
    }
  }

  async function handleLate() {
    if (state.phase !== 'ready' && state.phase !== 'confirmed') return;
    setState({ phase: 'actioning', action: 'late' });
    try {
      await api.public.late(token);
      setState({ phase: 'late' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not send notification. Please try again.';
      setState({ phase: 'error', code: 'ACTION_FAILED', message });
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-8 h-8 bg-[#22c55e] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">IB</span>
          </div>
        </div>

        {/* Loading */}
        {state.phase === 'loading' && (
          <div className="text-center py-12">
            <div className="w-6 h-6 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        )}

        {/* Actioning spinner */}
        {state.phase === 'actioning' && (
          <Card>
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-[#94a3b8] text-sm">
                {state.action === 'confirm' ? 'Confirming your reservation…'
                  : state.action === 'cancel' ? 'Cancelling your reservation…'
                  : 'Sending notification…'}
              </p>
            </div>
          </Card>
        )}

        {/* Error / not found / expired */}
        {state.phase === 'error' && (
          <Card>
            <IconBadge color="#ef4444" icon="✕" />
            <h1 className="text-[#f1f5f9] font-bold text-xl text-center mb-2">
              {state.code === 'EXPIRED' ? 'Link Expired' : 'Link Not Found'}
            </h1>
            <p className="text-[#94a3b8] text-sm text-center leading-relaxed">
              {state.message}
            </p>
          </Card>
        )}

        {/* Cancelled outcome */}
        {state.phase === 'cancelled' && (
          <Card>
            <IconBadge color="#ef4444" icon="✕" />
            <h1 className="text-[#f1f5f9] font-bold text-xl text-center mb-2">Reservation Cancelled</h1>
            <p className="text-[#94a3b8] text-sm text-center leading-relaxed">
              Your reservation has been cancelled. We hope to see you another time.
            </p>
          </Card>
        )}

        {/* Running late outcome */}
        {state.phase === 'late' && (
          <Card>
            <IconBadge color="#f97316" icon="⏱" />
            <h1 className="text-[#f1f5f9] font-bold text-xl text-center mb-2">We've Been Notified</h1>
            <p className="text-[#94a3b8] text-sm text-center leading-relaxed">
              The restaurant has been notified that you're running late. Your table is being held.
            </p>
          </Card>
        )}

        {/* Confirmed outcome */}
        {state.phase === 'confirmed' && (
          <Card>
            <IconBadge color="#22c55e" icon="✓" />
            <h1 className="text-[#f1f5f9] font-bold text-xl text-center mb-2">You're Confirmed!</h1>
            <p className="text-[#94a3b8] text-sm text-center leading-relaxed mb-6">
              We look forward to seeing you. If your plans change, you can cancel below.
            </p>
            <div className="space-y-2">
              <SecondaryBtn onClick={handleLate}>I'm running late</SecondaryBtn>
              <DangerBtn onClick={handleCancel}>Cancel reservation</DangerBtn>
            </div>
          </Card>
        )}

        {/* Active reservation — main action screen */}
        {state.phase === 'ready' && (() => {
          const r = state.reservation;
          return (
            <Card>
              {/* Restaurant name */}
              <p className="text-[#22c55e] text-xs font-semibold uppercase tracking-widest text-center mb-1">
                {r.restaurantName}
              </p>
              <h1 className="text-[#f1f5f9] font-bold text-xl text-center mb-5">
                Reservation Confirmation
              </h1>

              {/* Details */}
              <div className="bg-[#0f1117] rounded-xl p-4 mb-5 space-y-3">
                <DetailRow label="Guest" value={r.guestName} />
                <DetailRow label="Date" value={fmtDate(r.date)} />
                <DetailRow label="Time" value={r.time} />
                <DetailRow label="Party" value={`${r.partySize} ${r.partySize === 1 ? 'guest' : 'guests'}`} />
                {r.occasion && <DetailRow label="Occasion" value={r.occasion} />}
              </div>

              {/* Already confirmed notice */}
              {r.isConfirmedByGuest && (
                <div className="flex items-center gap-2 bg-[#22c55e]/10 border border-[#22c55e]/25 rounded-lg px-3 py-2 mb-4">
                  <span className="text-[#22c55e] text-sm">✓</span>
                  <span className="text-[#22c55e] text-sm font-medium">Already confirmed</span>
                </div>
              )}

              {/* Running late notice */}
              {r.isRunningLate && (
                <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/25 rounded-lg px-3 py-2 mb-4">
                  <span className="text-orange-400 text-sm">⏱</span>
                  <span className="text-orange-400 text-sm font-medium">Restaurant notified you're running late</span>
                </div>
              )}

              {/* Primary actions */}
              <div className="space-y-2">
                {!r.isConfirmedByGuest && (
                  <PrimaryBtn onClick={handleConfirm}>
                    Confirm my reservation
                  </PrimaryBtn>
                )}
                {!r.isRunningLate && (
                  <SecondaryBtn onClick={handleLate}>
                    I'm running late
                  </SecondaryBtn>
                )}
                <DangerBtn onClick={handleCancel}>
                  Cancel reservation
                </DangerBtn>
              </div>
            </Card>
          );
        })()}

        <p className="text-center text-[#475569] text-xs mt-6">
          Iron Booking · Reservation management
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#1a1d27] border border-[#2d3348] rounded-2xl p-6 shadow-2xl">
      {children}
    </div>
  );
}

function IconBadge({ color, icon }: { color: string; icon: string }) {
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
      style={{ background: `${color}20`, border: `2px solid ${color}50`, color }}
    >
      {icon}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-[#64748b] text-sm shrink-0">{label}</span>
      <span className="text-[#e2e8f0] text-sm text-right font-medium">{value}</span>
    </div>
  );
}

function PrimaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
    >
      {children}
    </button>
  );
}

function SecondaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-transparent border border-[#2d3348] hover:border-[#475569] text-[#94a3b8] hover:text-[#e2e8f0] font-medium py-3 px-4 rounded-xl transition-colors text-sm"
    >
      {children}
    </button>
  );
}

function DangerBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-transparent border border-red-500/30 hover:border-red-500/60 text-red-400 hover:text-red-300 font-medium py-3 px-4 rounded-xl transition-colors text-sm"
    >
      {children}
    </button>
  );
}
