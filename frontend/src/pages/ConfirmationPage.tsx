import { useState, useEffect } from 'react';
import type { PublicReservation } from '../types';
import { api, ApiError } from '../api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props { token: string; }

type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; code: string; message: string }
  | { phase: 'ready';     reservation: PublicReservation }
  | { phase: 'actioning'; reservation: PublicReservation; action: 'confirm' | 'cancel' | 'late' }
  | { phase: 'confirmed'; reservation: PublicReservation }
  | { phase: 'cancelled' }
  | { phase: 'late';      reservation: PublicReservation };

interface RestaurantIdentity {
  name: string;
  logoUrl: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtWeekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long' });
}

function fmtMonthDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'long', day: 'numeric' });
}

function fmt12Time(t: string): string {
  const [h, min] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${min.toString().padStart(2, '0')} ${period}`;
}

function getReservation(state: PageState): PublicReservation | null {
  if (
    state.phase === 'ready' ||
    state.phase === 'actioning' ||
    state.phase === 'confirmed' ||
    state.phase === 'late'
  ) return state.reservation;
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ConfirmationPage({ token }: Props) {
  const [state,    setState]    = useState<PageState>({ phase: 'loading' });
  const [identity, setIdentity] = useState<RestaurantIdentity | null>(null);
  const [mounted,  setMounted]  = useState(false);

  // Entry animation — triggers on first paint
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Data fetch
  useEffect(() => {
    let aborted = false;
    api.public.getReservation(token)
      .then(r => {
        if (aborted) return;
        setIdentity({ name: r.restaurantName, logoUrl: r.restaurantLogoUrl });
        if (r.status === 'CANCELLED') {
          setState({ phase: 'cancelled' });
        } else if (r.isConfirmedByGuest && !r.isRunningLate) {
          setState({ phase: 'confirmed', reservation: r });
        } else {
          setState({ phase: 'ready', reservation: r });
        }
      })
      .catch((err: unknown) => {
        if (aborted) return;
        const code    = err instanceof ApiError ? (err.message.toLowerCase().includes('expired') ? 'EXPIRED' : 'ERROR') : 'ERROR';
        const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
        setState({ phase: 'error', code, message });
      });
    return () => { aborted = true; };
  }, [token]);

  // ─── Handlers (logic unchanged) ───────────────────────────────────────────

  async function handleConfirm() {
    if (state.phase !== 'ready') return;
    const r = state.reservation;
    setState({ phase: 'actioning', action: 'confirm', reservation: r });
    try {
      await api.public.confirm(token);
      setState({ phase: 'confirmed', reservation: r });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not confirm. Please try again.';
      setState({ phase: 'error', code: 'ACTION_FAILED', message });
    }
  }

  async function handleCancel() {
    const r = state.phase === 'ready'     ? state.reservation
            : state.phase === 'confirmed' ? state.reservation
            : null;
    if (!r) return;
    setState({ phase: 'actioning', action: 'cancel', reservation: r });
    try {
      await api.public.cancel(token);
      setState({ phase: 'cancelled' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not cancel. Please try again.';
      setState({ phase: 'error', code: 'ACTION_FAILED', message });
    }
  }

  async function handleLate() {
    const r = state.phase === 'ready'     ? state.reservation
            : state.phase === 'confirmed' ? state.reservation
            : null;
    if (!r) return;
    setState({ phase: 'actioning', action: 'late', reservation: r });
    try {
      await api.public.late(token);
      setState({ phase: 'late', reservation: r });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not send notification. Please try again.';
      setState({ phase: 'error', code: 'ACTION_FAILED', message });
    }
  }

  const res = getReservation(state);

  const fade = (delay: number) => ({
    className: `transition-all duration-500 ease-out ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`,
    style:     { transitionDelay: `${delay}ms` } as React.CSSProperties,
  });

  return (
    <div className="relative min-h-screen flex flex-col items-center px-5 pt-12 pb-16 overflow-x-hidden">

      {/* ── Atmospheric background ──────────────────────────────────────── */}
      <AtmosphericBg />

      {/* ── Restaurant identity header ───────────────────────────────────── */}
      <div {...fade(0)} className={`w-full max-w-sm ${fade(0).className}`} style={fade(0).style}>
        <RestaurantHero identity={identity} />
      </div>

      {/* ── Main card ────────────────────────────────────────────────────── */}
      <div {...fade(80)} className={`w-full max-w-sm ${fade(80).className}`} style={fade(80).style}>

        {/* Loading */}
        {state.phase === 'loading' && (
          <GlassCard>
            <div className="py-10 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            </div>
          </GlassCard>
        )}

        {/* Actioning */}
        {state.phase === 'actioning' && (
          <GlassCard>
            <div className="py-10 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
              <p className="text-white/35 text-sm">
                {state.action === 'confirm' ? 'Confirming your table…'
                  : state.action === 'cancel' ? 'Cancelling your reservation…'
                  : 'Notifying the restaurant…'}
              </p>
            </div>
          </GlassCard>
        )}

        {/* Error */}
        {state.phase === 'error' && (
          <GlassCard>
            <OutcomeIcon variant="error" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">
              {state.code === 'EXPIRED' ? 'Link Expired' : 'Link Not Found'}
            </h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">{state.message}</p>
          </GlassCard>
        )}

        {/* Cancelled */}
        {state.phase === 'cancelled' && (
          <GlassCard>
            <OutcomeIcon variant="neutral" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">Until next time</h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">
              Your reservation has been cancelled. We hope to welcome you soon.
            </p>
          </GlassCard>
        )}

        {/* Running late outcome */}
        {state.phase === 'late' && (
          <GlassCard>
            <OutcomeIcon variant="late" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">Your table is being held</h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">
              The restaurant knows you're on the way. Your table will be ready for you.
            </p>
          </GlassCard>
        )}

        {/* Confirmed */}
        {state.phase === 'confirmed' && (() => {
          const r = state.reservation;
          return (
            <GlassCard>
              <OutcomeIcon variant="confirmed" />
              <h1 className="text-white text-2xl font-semibold text-center tracking-tight mb-1">
                See you {fmtWeekday(r.date)}
              </h1>
              <p className="text-white/35 text-sm text-center mb-7">
                Your table is confirmed for {fmt12Time(r.time)}.
              </p>

              <DateHero date={r.date} time={r.time} partySize={r.partySize} occasion={r.occasion} />

              <div className="h-px bg-white/[0.06] my-6" />

              <div className="flex flex-col gap-2.5">
                <LateBtn onClick={handleLate}>I'm running a bit late</LateBtn>
                <CancelLink onClick={handleCancel}>I can't make it</CancelLink>
              </div>
            </GlassCard>
          );
        })()}

        {/* Ready — main action screen */}
        {state.phase === 'ready' && (() => {
          const r = state.reservation;
          return (
            <GlassCard>
              <DateHero date={r.date} time={r.time} partySize={r.partySize} occasion={r.occasion} />

              {(r.isConfirmedByGuest || r.isRunningLate) && (
                <div className="mt-1 mb-5 space-y-2">
                  {r.isConfirmedByGuest && (
                    <StatusNotice icon="✓" color="green" text="Table confirmed" />
                  )}
                  {r.isRunningLate && (
                    <StatusNotice icon="⏱" color="amber" text="Restaurant notified you're on the way" />
                  )}
                </div>
              )}

              <div className="h-px bg-white/[0.06] my-6" />

              <div className="flex flex-col gap-2.5">
                {!r.isConfirmedByGuest && (
                  <ConfirmBtn onClick={handleConfirm}>Confirm my table</ConfirmBtn>
                )}
                {!r.isRunningLate && (
                  <LateBtn onClick={handleLate}>I'm running a bit late</LateBtn>
                )}
                <CancelLink onClick={handleCancel}>I can't make it</CancelLink>
              </div>
            </GlassCard>
          );
        })()}
      </div>

      {/* ── Below-card utility zone ───────────────────────────────────────── */}
      <div
        className={`w-full max-w-sm ${fade(160).className}`}
        style={fade(160).style}
      >
        {res && (
          <NavChips
            address={res.restaurantAddress}
            googleMapsUrl={res.restaurantGoogleMapsUrl}
            wazeUrl={res.restaurantWazeUrl}
          />
        )}

        {res?.restaurantSpecialInstructions && (
          <InfoBlock label="Please note" icon={<NoteIcon />}>
            {res.restaurantSpecialInstructions}
          </InfoBlock>
        )}
        {res?.restaurantParkingNotes && (
          <InfoBlock label="Parking" icon={<ParkIcon />}>
            {res.restaurantParkingNotes}
          </InfoBlock>
        )}
        {res?.restaurantCancellationPolicy && (
          <InfoBlock label="Cancellation" icon={<PolicyIcon />}>
            {res.restaurantCancellationPolicy}
          </InfoBlock>
        )}

        <PageFooter
          websiteUrl={res?.restaurantWebsiteUrl ?? null}
          instagramUrl={res?.restaurantInstagramUrl ?? null}
          restaurantName={identity?.name ?? null}
        />
      </div>

    </div>
  );
}

// ─── Background ───────────────────────────────────────────────────────────────

function AtmosphericBg() {
  return (
    <div
      className="fixed inset-0 -z-10"
      style={{
        background: [
          'radial-gradient(ellipse 140% 55% at 50% -10%, rgba(34,197,94,0.09) 0%, transparent 55%)',
          'radial-gradient(ellipse 80% 45% at 10% 105%, rgba(59,130,246,0.04) 0%, transparent 50%)',
          'linear-gradient(170deg, #111827 0%, #0d1117 45%, #090c12 100%)',
        ].join(', '),
      }}
    />
  );
}

// ─── Restaurant hero ──────────────────────────────────────────────────────────

function RestaurantHero({ identity }: { identity: RestaurantIdentity | null }) {
  return (
    <div className="text-center mb-6">
      <div className="flex items-center justify-center mb-4">
        {identity?.logoUrl ? (
          <img
            src={identity.logoUrl}
            alt={identity.name}
            className="h-14 max-w-[200px] object-contain"
          />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center backdrop-blur-sm select-none"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <span className="text-white/80 text-xl font-semibold">
              {identity?.name ? identity.name.charAt(0).toUpperCase() : '◆'}
            </span>
          </div>
        )}
      </div>

      {identity?.name && (
        <h2 className="text-white text-2xl font-semibold tracking-tight">{identity.name}</h2>
      )}
    </div>
  );
}

// ─── Glass card ───────────────────────────────────────────────────────────────

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full rounded-3xl p-7 backdrop-blur-2xl"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {children}
    </div>
  );
}

// ─── Date hero ────────────────────────────────────────────────────────────────

function DateHero({ date, time, partySize, occasion }: {
  date: string; time: string; partySize: number; occasion: string | null;
}) {
  return (
    <div className="text-center">
      <p className="text-white/25 text-[11px] font-medium uppercase tracking-[0.14em] mb-1">
        {fmtWeekday(date)}
      </p>
      <p className="text-white text-[2rem] font-semibold tracking-tight leading-none mb-1.5">
        {fmtMonthDay(date)}
      </p>
      <p className="text-white/55 text-lg mb-5">{fmt12Time(time)}</p>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Chip>
          {partySize === 1 ? '1 guest' : `${partySize} guests`}
        </Chip>
        {occasion && <OccasionChip>{occasion}</OccasionChip>}
      </div>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-4 py-1.5 text-white/45 text-[13px]"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}
    >
      {children}
    </span>
  );
}

function OccasionChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-amber-300/80 text-[13px]"
      style={{ background: 'rgba(251,191,36,0.09)', border: '1px solid rgba(251,191,36,0.20)' }}
    >
      ✦ {children}
    </span>
  );
}

// ─── Status notices (inside card) ─────────────────────────────────────────────

function StatusNotice({ icon, color, text }: { icon: string; color: 'green' | 'amber'; text: string }) {
  const styles = {
    green: { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.20)',  textCls: 'text-[#4ade80]/80' },
    amber: { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.20)', textCls: 'text-amber-300/80' },
  }[color];
  return (
    <div
      className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2"
      style={{ background: styles.bg, border: `1px solid ${styles.border}` }}
    >
      <span className={`${styles.textCls} text-sm`}>{icon}</span>
      <span className={`${styles.textCls} text-[13px] font-medium`}>{text}</span>
    </div>
  );
}

// ─── Outcome icons ────────────────────────────────────────────────────────────

function OutcomeIcon({ variant }: { variant: 'confirmed' | 'late' | 'error' | 'neutral' }) {
  const cfg = {
    confirmed: { bg: 'rgba(34,197,94,0.12)',   ring: 'rgba(34,197,94,0.28)',   glow: 'rgba(34,197,94,0.10)',   icon: '✓',  color: '#4ade80' },
    late:      { bg: 'rgba(251,191,36,0.12)',  ring: 'rgba(251,191,36,0.28)',  glow: 'rgba(251,191,36,0.08)',  icon: '⏱', color: '#fbbf24' },
    error:     { bg: 'rgba(239,68,68,0.10)',   ring: 'rgba(239,68,68,0.25)',   glow: 'rgba(239,68,68,0.06)',   icon: '✕',  color: '#f87171' },
    neutral:   { bg: 'rgba(255,255,255,0.07)', ring: 'rgba(255,255,255,0.14)', glow: 'transparent',            icon: '○',  color: 'rgba(255,255,255,0.35)' },
  }[variant];
  return (
    <div className="flex items-center justify-center mb-6">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
        style={{
          background: cfg.bg,
          border: `1.5px solid ${cfg.ring}`,
          boxShadow: `0 0 40px ${cfg.glow}`,
          color: cfg.color,
        }}
      >
        {cfg.icon}
      </div>
    </div>
  );
}

// ─── Action buttons ───────────────────────────────────────────────────────────

function ConfirmBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-white hover:bg-white/90 active:scale-[0.98] text-[#0d1117] font-semibold py-4 rounded-2xl text-[15px] tracking-wide transition-all"
    >
      {children}
    </button>
  );
}

function LateBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full active:scale-[0.98] font-medium py-3.5 rounded-2xl text-[14px] text-amber-300/75 bg-amber-500/[0.07] border border-amber-500/[0.20] hover:bg-amber-500/[0.12] transition-all"
    >
      {children}
    </button>
  );
}

function CancelLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-center text-[12px] py-2 mt-0.5 transition-colors text-red-400/30 hover:text-red-400/55"
    >
      {children}
    </button>
  );
}

// ─── Navigation chips (below card) ───────────────────────────────────────────

function NavChips({ address, googleMapsUrl, wazeUrl }: {
  address: string | null; googleMapsUrl: string | null; wazeUrl: string | null;
}) {
  if (!address && !googleMapsUrl && !wazeUrl) return null;
  return (
    <div className="mt-4 text-center">
      {address && (
        <p className="text-white/30 text-[13px] leading-snug mb-3">{address}</p>
      )}
      {(googleMapsUrl || wazeUrl) && (
        <div className="flex gap-2 justify-center">
          {googleMapsUrl && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 max-w-[160px] flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-full text-[13px] text-white/50 hover:text-white/75 transition-all no-underline"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.09)',
              }}
            >
              <PinIcon /> Maps
            </a>
          )}
          {wazeUrl && (
            <a
              href={wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 max-w-[160px] flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-full text-[13px] text-white/50 hover:text-white/75 transition-all no-underline"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.09)',
              }}
            >
              <CarIcon /> Waze
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Info blocks ──────────────────────────────────────────────────────────────

function InfoBlock({ label, icon, children }: { label: string; icon: React.ReactNode; children: string }) {
  return (
    <div
      className="mt-3 rounded-2xl p-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-white/20">{icon}</span>
        <p className="text-white/30 text-[11px] font-medium uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-white/45 text-[13px] leading-relaxed">{children}</p>
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function PageFooter({ websiteUrl, instagramUrl, restaurantName }: {
  websiteUrl: string | null; instagramUrl: string | null; restaurantName: string | null;
}) {
  const hasLinks = websiteUrl || instagramUrl;
  return (
    <div className="mt-10 pb-2 text-center">
      {hasLinks && (
        <div className="flex items-center justify-center gap-6 mb-4">
          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/25 hover:text-white/45 text-[13px] transition-colors no-underline"
            >
              Website
            </a>
          )}
          {instagramUrl && (
            <a
              href={instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/25 hover:text-white/45 text-[13px] transition-colors no-underline"
            >
              Instagram
            </a>
          )}
        </div>
      )}
      <p className="text-white/[0.14] text-[10px] tracking-widest uppercase">
        {restaurantName ? `${restaurantName} · ` : ''}Powered by Iron Booking
      </p>
    </div>
  );
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  );
}

function ParkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z" />
    </svg>
  );
}

function PolicyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8zm0-4h8v2H8z" />
    </svg>
  );
}
