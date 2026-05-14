import { useState, useEffect } from 'react';
import type { GuestLookupResult, ReservationStatus } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { fmtHostTime, normalizeTime } from '../utils/time';

interface Props {
  phone: string;
  createdAt: string;
  highlight?: boolean;
  onNewReservation: (phone: string) => void;
  onOpenReservation?: (reservationId: string) => void;
  onClose: () => void;
}

const FREQUENT_THRESHOLD = 5;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function statusBadgeClass(status: ReservationStatus): string {
  if (status === 'SEATED')    return 'bg-iron-green/20 border-iron-green/50 text-iron-green-light';
  if (status === 'CONFIRMED') return 'bg-blue-500/15 border-blue-500/30 text-blue-300';
  if (status === 'PENDING')   return 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  return 'bg-iron-border/30 border-iron-border/50 text-iron-muted';
}

export default function CallDrawer({
  phone, createdAt, highlight, onNewReservation, onOpenReservation, onClose,
}: Props) {
  const T = useT();
  const [guest, setGuest] = useState<GuestLookupResult | null | 'loading'>('loading');

  useEffect(() => {
    if (!phone) { setGuest(null); return; }
    let cancelled = false;
    setGuest('loading');
    api.guests.lookupByPhone(phone)
      .then(res => { if (!cancelled) setGuest(res.guest ?? null); })
      .catch(() => { if (!cancelled) setGuest(null); });
    return () => { cancelled = true; };
  }, [phone]);

  const callTime = (() => {
    try { return fmtHostTime(createdAt); }
    catch { return ''; }
  })();

  const today      = todayStr();
  const recentRes  = guest && guest !== 'loading' ? (guest.recentReservations ?? []) : [];
  const todayRes   = recentRes.find(r => r.date.slice(0, 10) === today && !['CANCELLED', 'NO_SHOW'].includes(r.status)) ?? null;
  const lastRes    = recentRes.find(r => r.date.slice(0, 10) < today  && !['CANCELLED', 'NO_SHOW'].includes(r.status)) ?? null;
  const isFrequent = guest && guest !== 'loading' && !guest.isVip && guest.visitCount >= FREQUENT_THRESHOLD;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Drawer */}
      <aside className={`fixed right-0 top-0 h-full w-80 bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl animate-toast${highlight ? ' animate-call-ping' : ''}`}>

        {/* Header */}
        <div className="p-4 border-b border-iron-border shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📞</span>
            <div>
              <p className="text-iron-text font-semibold text-sm">{T.callDrawer.title}</p>
              {callTime && <p className="text-iron-muted text-xs">{callTime}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-iron-muted hover:text-iron-text text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Phone — labelled as incoming call, not just "Phone" */}
          <div className="rounded-xl bg-iron-bg border border-iron-border px-4 py-3.5">
            <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-1">
              {T.callDrawer.incomingLabel}
            </p>
            <p className="text-iron-text font-bold text-xl tracking-wide tabular-nums">
              {phone || T.callDrawer.unknownCaller}
            </p>
          </div>

          {/* Guest section */}
          <section className="space-y-3">
            {guest === 'loading' ? (
              <div className="flex items-center gap-2 py-1">
                <div className="w-3.5 h-3.5 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="text-iron-muted text-xs">{T.callDrawer.lookingUp}</span>
              </div>
            ) : guest ? (
              <>
                {/* Identity card */}
                <div className="rounded-xl bg-iron-bg border border-iron-green/25 px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-iron-text font-semibold text-base">
                      {guest.firstName} {guest.lastName}
                    </span>
                    {guest.isVip && (
                      <span className="text-xs px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400 font-semibold">
                        VIP
                      </span>
                    )}
                    {isFrequent && (
                      <span className="text-xs px-1.5 py-0.5 rounded border bg-iron-green/15 border-iron-green/30 text-iron-green-light font-semibold">
                        {T.callDrawer.frequentGuest}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-iron-muted">
                    <span>{T.callDrawer.visits(guest.visitCount)}</span>
                    {guest.noShowCount > 0 && (
                      <>
                        <span className="text-iron-border">·</span>
                        <span className="text-orange-400">{T.callDrawer.noShows(guest.noShowCount)}</span>
                      </>
                    )}
                  </div>

                  {guest.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {guest.tags.map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-iron-card border border-iron-border rounded-md text-iron-muted">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {guest.internalNotes && (
                    <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                      {guest.internalNotes}
                    </p>
                  )}
                </div>

                {/* Today's reservation — prominent */}
                {todayRes && (
                  <div className="rounded-xl bg-iron-green/10 border border-iron-green/40 px-4 py-3 space-y-2.5">
                    <p className="text-iron-green-light text-[10px] font-semibold uppercase tracking-widest">
                      {T.callDrawer.todayRes}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-iron-text font-semibold text-sm">
                          {normalizeTime(todayRes.time)}
                          <span className="text-iron-muted font-normal"> · {todayRes.partySize}p</span>
                        </p>
                        {todayRes.table && (
                          <p className="text-iron-muted text-xs mt-0.5">{todayRes.table.name}</p>
                        )}
                        {todayRes.occasion && (
                          <p className="text-iron-green-light/70 text-xs mt-0.5">{todayRes.occasion}</p>
                        )}
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${statusBadgeClass(todayRes.status)}`}>
                        {T.reservationStatus[todayRes.status] ?? todayRes.status}
                      </span>
                    </div>
                    {onOpenReservation && (
                      <button
                        onClick={() => onOpenReservation(todayRes.id)}
                        className="w-full text-xs font-semibold py-1.5 rounded-lg bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors"
                      >
                        {T.callDrawer.openReservation}
                      </button>
                    )}
                  </div>
                )}

                {/* Last visit — shown only when no today reservation */}
                {!todayRes && lastRes && (
                  <div className="rounded-xl bg-iron-bg border border-iron-border/60 px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-0.5">
                        {T.callDrawer.lastVisit}
                      </p>
                      <p className="text-iron-text text-xs">
                        {new Date(lastRes.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        {lastRes.table && (
                          <span className="text-iron-muted"> · {lastRes.table.name}</span>
                        )}
                      </p>
                    </div>
                    <span className="text-iron-muted text-xs tabular-nums shrink-0">{lastRes.partySize}p</span>
                  </div>
                )}
              </>
            ) : phone ? (
              <p className="text-iron-muted text-xs italic">{T.callDrawer.noGuest}</p>
            ) : null}
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-iron-border shrink-0 flex gap-2">
          <button
            onClick={() => onNewReservation(phone)}
            className="flex-1 text-xs font-semibold py-2 rounded-lg bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors"
          >
            {T.callDrawer.newReservation}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-iron-muted hover:text-iron-text px-4 transition-colors border border-iron-border/40 rounded-lg hover:border-iron-border"
          >
            {T.callDrawer.dismiss}
          </button>
        </div>
      </aside>
    </>
  );
}
