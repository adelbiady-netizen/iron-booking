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
  coverUrl: string | null;
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

function sanitizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = name.trim();
  const lower = t.toLowerCase();
  if (
    lower === 'iron booking dev' ||
    lower === 'iron booking' ||
    lower === 'system' ||
    lower === '_system' ||
    lower === 'test restaurant' ||
    t.length === 0
  ) return null;
  return t;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ConfirmationPage({ token }: Props) {
  const [state,    setState]    = useState<PageState>({ phase: 'loading' });
  const [identity, setIdentity] = useState<RestaurantIdentity | null>(null);
  const [mounted,  setMounted]  = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let aborted = false;
    api.public.getReservation(token)
      .then(r => {
        if (aborted) return;
        setIdentity({ name: r.restaurantName, logoUrl: r.restaurantLogoUrl, coverUrl: r.restaurantCoverImageUrl });
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

  const res      = getReservation(state);
  const hasCover = !!identity?.coverUrl;

  const fade = (delay: number) => ({
    className: `transition-all duration-500 ease-out ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`,
    style:     { transitionDelay: `${delay}ms` } as React.CSSProperties,
  });

  return (
    <div className="relative min-h-screen flex flex-col items-center overflow-x-hidden" style={{ paddingBottom: 'clamp(24px, 4vh, 48px)' }}>

      <AtmosphericBg />

      {/* ── Hero zone ─────────────────────────────────────────────────────── */}
      <div className={`w-full ${fade(0).className}`} style={fade(0).style}>
        {hasCover ? (
          <CoverImageHero identity={identity!} />
        ) : (
          <div className="pt-8 px-4 w-full flex flex-col items-center">
            <div className="w-full max-w-[500px]">
              <RestaurantHero identity={identity} />
            </div>
          </div>
        )}
      </div>

      {/* ── Main card ─────────────────────────────────────────────────────── */}
      <div
        className={`w-full max-w-[500px] px-4 ${hasCover ? '-mt-16 relative z-10' : ''} ${fade(80).className}`}
        style={fade(80).style}
      >

        {state.phase === 'loading' && (
          <GlassCard>
            <div className="py-12 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            </div>
          </GlassCard>
        )}

        {state.phase === 'actioning' && (
          <GlassCard>
            <div className="py-12 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
              <p className="text-white/35 text-sm">
                {state.action === 'confirm' ? 'Confirming your table…'
                  : state.action === 'cancel' ? 'Cancelling your reservation…'
                  : 'Notifying the restaurant…'}
              </p>
            </div>
          </GlassCard>
        )}

        {state.phase === 'error' && (
          <GlassCard>
            <OutcomeIcon variant="error" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">
              {state.code === 'EXPIRED' ? 'Link Expired' : 'Link Not Found'}
            </h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">{state.message}</p>
          </GlassCard>
        )}

        {state.phase === 'cancelled' && (
          <GlassCard>
            <OutcomeIcon variant="neutral" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">Until next time</h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">
              Your reservation has been cancelled. We hope to welcome you soon.
            </p>
          </GlassCard>
        )}

        {state.phase === 'late' && (
          <GlassCard>
            <OutcomeIcon variant="late" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">Your table is being held</h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">
              The restaurant knows you're on the way. Your table will be ready for you.
            </p>
          </GlassCard>
        )}

        {state.phase === 'confirmed' && (() => {
          const r = state.reservation;
          return (
            <GlassCard>
              <OutcomeIcon variant="confirmed" />
              <h1 className="text-white text-2xl font-semibold text-center tracking-tight mb-1">
                See you {fmtWeekday(r.date)}
              </h1>
              <p className="text-white/35 text-sm text-center" style={{ marginBottom: 'clamp(16px, 3vh, 32px)' }}>
                Your table is confirmed for {fmt12Time(r.time)}.
              </p>
              <DateHero date={r.date} time={r.time} partySize={r.partySize} occasion={r.occasion} />
              <Divider />
              <div className="flex flex-col gap-3">
                <LateBtn onClick={handleLate}>I'm running a bit late</LateBtn>
                <CancelLink onClick={handleCancel}>I can't make it</CancelLink>
              </div>
            </GlassCard>
          );
        })()}

        {state.phase === 'ready' && (() => {
          const r = state.reservation;
          return (
            <GlassCard>
              <DateHero date={r.date} time={r.time} partySize={r.partySize} occasion={r.occasion} />

              {(r.isConfirmedByGuest || r.isRunningLate) && (
                <div className="mt-2 mb-5 space-y-2">
                  {r.isConfirmedByGuest && (
                    <StatusNotice icon="✓" color="green" text="Table confirmed" />
                  )}
                  {r.isRunningLate && (
                    <StatusNotice icon="⏱" color="amber" text="Restaurant notified you're on the way" />
                  )}
                </div>
              )}

              <Divider />

              <div className="flex flex-col gap-3">
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

      {/* ── Utility zone ─────────────────────────────────────────────────── */}
      <div
        className={`w-full max-w-[500px] px-4 ${fade(160).className}`}
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

// ─── Atmospheric background ───────────────────────────────────────────────────

function AtmosphericBg() {
  return (
    <>
      <div
        className="fixed inset-0 -z-20"
        style={{
          background: [
            'radial-gradient(ellipse 160% 65% at 50% -20%, rgba(34,197,94,0.11) 0%, transparent 50%)',
            'radial-gradient(ellipse 80% 45% at 10% 105%, rgba(59,130,246,0.04) 0%, transparent 50%)',
            'linear-gradient(170deg, #101520 0%, #0b0f18 40%, #080a10 100%)',
          ].join(', '),
        }}
      />
      <div
        className="fixed -z-10"
        style={{
          top: '20%', left: '50%', transform: 'translateX(-50%)',
          width: '600px', height: '600px',
          background: [
            'radial-gradient(circle at 50% 38%, rgba(255,255,255,0.028) 0%, transparent 52%)',
            'radial-gradient(circle at 50% 62%, rgba(34,197,94,0.022) 0%, transparent 48%)',
          ].join(', '),
          pointerEvents: 'none',
        }}
      />
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 42%, rgba(0,0,0,0.50) 100%)' }}
      />
    </>
  );
}

// ─── Cover image hero ─────────────────────────────────────────────────────────

function CoverImageHero({ identity }: { identity: RestaurantIdentity }) {
  const displayName = sanitizeName(identity.name);
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '◆';

  // Hero shrinks on short viewports; tall screens keep full cinematic height
  const heroH = 'min(380px, 50vh)';
  const discS  = 'min(96px, 13.5vh)';
  const logoH  = 'min(52px, 7.5vh)';
  const bottomPos = 'min(96px, 13vh)';

  return (
    <div className="relative w-full" style={{ height: heroH }}>
      {/* Image — overflow-hidden contained */}
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={identity.coverUrl!}
          alt=""
          className="w-full h-full object-cover"
          style={{ transform: 'scale(1.05)', transformOrigin: 'center 40%' }}
        />
      </div>

      {/* Cinematic gradient — more atmospheric */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            'linear-gradient(to bottom,',
            '  rgba(9,12,18,0.08) 0%,',
            '  rgba(9,12,18,0.22) 30%,',
            '  rgba(9,12,18,0.62) 62%,',
            '  rgba(9,12,18,0.92) 84%,',
            '  rgba(9,12,18,1.00) 100%)',
          ].join(' '),
        }}
      />

      {/* Bleed gradient — extends below image to blend with card */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          bottom: '-80px',
          height: '160px',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(9,12,18,0.60) 50%, rgba(9,12,18,0.95) 100%)',
        }}
      />

      {/* Logo + name — positioned in lower third */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center px-5"
        style={{ bottom: bottomPos }}
      >
        {/* Cinematic glow halo behind logo */}
        <div className="relative flex items-center justify-center mb-3">
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '160px', height: '160px',
              background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 68%)',
            }}
          />
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '120px', height: '120px',
              background: 'radial-gradient(circle, rgba(34,197,94,0.10) 0%, transparent 65%)',
            }}
          />
          {identity.logoUrl ? (
            /* Premium glass disc */
            <div
              className="relative flex items-center justify-center rounded-full backdrop-blur-xl"
              style={{
                width: discS, height: discS,
                background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: [
                  '0 0 0 1px rgba(0,0,0,0.60)',
                  '0 12px 48px rgba(0,0,0,0.80)',
                  '0 4px 16px rgba(0,0,0,0.50)',
                  '0 0 0 8px rgba(255,255,255,0.018)',
                  '0 0 60px rgba(255,255,255,0.05)',
                ].join(', '),
              }}
            >
              <img
                src={identity.logoUrl}
                alt={displayName ?? 'Restaurant'}
                className="object-contain"
                style={{ height: logoH, maxWidth: '76px', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.60))' }}
              />
            </div>
          ) : (
            <div
              className="relative rounded-full flex items-center justify-center backdrop-blur-xl select-none"
              style={{
                width: discS, height: discS,
                background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)',
                border: '1px solid rgba(255,255,255,0.13)',
                boxShadow: [
                  '0 0 0 1px rgba(0,0,0,0.60)',
                  '0 12px 48px rgba(0,0,0,0.80)',
                  '0 0 0 8px rgba(255,255,255,0.018)',
                ].join(', '),
              }}
            >
              <span className="text-white/75 text-3xl font-light">{initial}</span>
            </div>
          )}
        </div>

        {displayName && (
          <h2
            className="text-[1.45rem] font-medium tracking-[-0.020em] text-center"
            style={{ color: '#f2ece0', textShadow: '0 2px 20px rgba(0,0,0,0.80)' }}
          >
            {displayName}
          </h2>
        )}
      </div>
    </div>
  );
}

// ─── Gradient hero (fallback — no cover image) ────────────────────────────────

function RestaurantHero({ identity }: { identity: RestaurantIdentity | null }) {
  const displayName = sanitizeName(identity?.name);
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '◆';

  return (
    <div className="text-center mb-6">
      <div className="relative flex items-center justify-center mb-4">
        {/* Cinematic glow halo */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: '140px', height: '140px',
            background: 'radial-gradient(circle, rgba(255,255,255,0.055) 0%, rgba(34,197,94,0.04) 45%, transparent 70%)',
          }}
        />
        {identity?.logoUrl ? (
          <img
            src={identity.logoUrl}
            alt={displayName ?? 'Restaurant'}
            className="relative object-contain"
            style={{ height: '80px', maxWidth: '240px' }}
          />
        ) : (
          <div
            className="relative rounded-full flex items-center justify-center backdrop-blur-xl select-none"
            style={{
              width: '96px', height: '96px',
              background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: [
                '0 0 0 1px rgba(0,0,0,0.55)',
                '0 12px 48px rgba(0,0,0,0.70)',
                '0 0 0 8px rgba(255,255,255,0.016)',
                '0 0 50px rgba(34,197,94,0.06)',
              ].join(', '),
            }}
          >
            <span className="text-white/75 text-3xl font-light">{initial}</span>
          </div>
        )}
      </div>

      {displayName && (
        <h2
          className="text-[1.5rem] font-medium tracking-[-0.022em]"
          style={{ color: '#f2ece0' }}
        >
          {displayName}
        </h2>
      )}
    </div>
  );
}

// ─── Glass card ───────────────────────────────────────────────────────────────

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full rounded-[32px] backdrop-blur-[100px]"
      style={{
        padding: 'clamp(20px, 3.8vh, 32px)',
        background: 'linear-gradient(160deg, rgba(14,18,30,0.72) 0%, rgba(7,9,18,0.80) 100%)',
        border: '1px solid rgba(255,255,255,0.065)',
        boxShadow: [
          '0 2px 0 rgba(255,255,255,0.095) inset',
          '1px 0 0 rgba(255,255,255,0.032) inset',
          '-1px 0 0 rgba(255,255,255,0.018) inset',
          '0 -1px 0 rgba(0,0,0,0.45) inset',
          '0 60px 120px rgba(0,0,0,0.70)',
          '0 24px 60px rgba(0,0,0,0.50)',
          '0 6px 18px rgba(0,0,0,0.40)',
          '0 0 0 0.5px rgba(255,255,255,0.030)',
        ].join(', '),
      }}
    >
      {children}
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="h-px" style={{ margin: 'clamp(16px, 2.8vh, 28px) 0', background: 'rgba(255,255,255,0.055)' }} />;
}

// ─── Date hero ────────────────────────────────────────────────────────────────

function DateHero({ date, time, partySize, occasion }: {
  date: string; time: string; partySize: number; occasion: string | null;
}) {
  return (
    <div className="text-center">
      <p className="text-white/22 text-[10px] font-medium uppercase tracking-[0.22em] mb-2">
        {fmtWeekday(date)}
      </p>
      <p
        className="font-semibold leading-none"
        style={{ fontSize: 'clamp(2rem, 4.5vh, 2.8rem)', letterSpacing: '-0.035em', color: '#f8f5ef', marginBottom: 'clamp(6px, 1.2vh, 10px)' }}
      >
        {fmtMonthDay(date)}
      </p>
      <p className="text-white/40 text-[19px] font-light tracking-wide" style={{ marginBottom: 'clamp(14px, 2.5vh, 24px)' }}>{fmt12Time(time)}</p>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Chip>{partySize === 1 ? '1 guest' : `${partySize} guests`}</Chip>
        {occasion && <OccasionChip>{occasion}</OccasionChip>}
      </div>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-5 py-1.5 text-white/45 text-[13px] tracking-wide"
      style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.085)' }}
    >
      {children}
    </span>
  );
}

function OccasionChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-5 py-1.5 text-amber-300/80 text-[13px] tracking-wide"
      style={{ background: 'rgba(251,191,36,0.09)', border: '1px solid rgba(251,191,36,0.22)' }}
    >
      ✦ {children}
    </span>
  );
}

// ─── Status notices ───────────────────────────────────────────────────────────

function StatusNotice({ icon, color, text }: { icon: string; color: 'green' | 'amber'; text: string }) {
  const styles = {
    green: { bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.20)',  textCls: 'text-[#4ade80]/80' },
    amber: { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.20)', textCls: 'text-amber-300/80' },
  }[color];
  return (
    <div
      className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5"
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
    confirmed: { bg: 'rgba(34,197,94,0.12)',   ring: 'rgba(34,197,94,0.28)',   glow: 'rgba(34,197,94,0.12)',   icon: '✓',  color: '#4ade80' },
    late:      { bg: 'rgba(251,191,36,0.12)',  ring: 'rgba(251,191,36,0.28)',  glow: 'rgba(251,191,36,0.10)',  icon: '⏱', color: '#fbbf24' },
    error:     { bg: 'rgba(239,68,68,0.10)',   ring: 'rgba(239,68,68,0.25)',   glow: 'rgba(239,68,68,0.07)',   icon: '✕',  color: '#f87171' },
    neutral:   { bg: 'rgba(255,255,255,0.07)', ring: 'rgba(255,255,255,0.14)', glow: 'transparent',            icon: '○',  color: 'rgba(255,255,255,0.35)' },
  }[variant];
  return (
    <div className="flex items-center justify-center" style={{ marginBottom: 'clamp(12px, 2.2vh, 24px)' }}>
      <div
        className="w-[68px] h-[68px] rounded-full flex items-center justify-center text-2xl"
        style={{
          background: cfg.bg,
          border: `1.5px solid ${cfg.ring}`,
          boxShadow: `0 0 48px ${cfg.glow}`,
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
  const base = [
    '0 1px 0 rgba(255,255,255,0.70) inset',
    '0 -1px 0 rgba(110,80,30,0.16) inset',
    '0 14px 38px rgba(0,0,0,0.35)',
    '0 3px 10px rgba(0,0,0,0.25)',
  ].join(', ');
  const hover = [
    '0 1px 0 rgba(255,255,255,0.75) inset',
    '0 -1px 0 rgba(110,80,30,0.16) inset',
    '0 14px 42px rgba(0,0,0,0.38)',
    '0 3px 10px rgba(0,0,0,0.25)',
    '0 0 60px rgba(245,240,228,0.16)',
  ].join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full active:scale-[0.98] rounded-[20px] text-[16px] transition-all"
      style={{
        padding: 'clamp(14px, 2.2vh, 18px) 24px',
        background: 'linear-gradient(180deg, #f6f1e5 0%, #ede3cc 100%)',
        color: '#0c0e14',
        letterSpacing: '0.018em',
        fontWeight: 600,
        boxShadow: base,
      }}
      onMouseEnter={e => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = 'linear-gradient(180deg, #faf5e8 0%, #f2e8d4 100%)';
        b.style.boxShadow = hover;
      }}
      onMouseLeave={e => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = 'linear-gradient(180deg, #f6f1e5 0%, #ede3cc 100%)';
        b.style.boxShadow = base;
      }}
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
      className="w-full active:scale-[0.98] font-light rounded-[20px] text-[15px] transition-all"
      style={{
        padding: 'clamp(11px, 1.9vh, 15px) 24px',
        background: 'rgba(148,115,50,0.12)',
        border: '1px solid rgba(185,148,72,0.34)',
        color: 'rgba(220,185,118,0.90)',
        letterSpacing: '0.012em',
      }}
      onMouseEnter={e => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = 'rgba(148,115,50,0.20)';
        b.style.color = 'rgba(228,196,132,1.0)';
      }}
      onMouseLeave={e => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = 'rgba(148,115,50,0.12)';
        b.style.color = 'rgba(220,185,118,0.90)';
      }}
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
      className="w-full text-center text-[12px] py-2.5 transition-colors"
      style={{ color: 'rgba(255,255,255,0.40)', letterSpacing: '0.015em' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.62)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.40)'; }}
    >
      {children}
    </button>
  );
}

// ─── Navigation chips ─────────────────────────────────────────────────────────

function NavChips({ address, googleMapsUrl, wazeUrl }: {
  address: string | null; googleMapsUrl: string | null; wazeUrl: string | null;
}) {
  if (!address && !googleMapsUrl && !wazeUrl) return null;

  const pillBase = {
    background: 'rgba(255,255,255,0.068)',
    border: '1px solid rgba(255,255,255,0.160)',
    color: 'rgba(255,255,255,0.64)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
  };

  return (
    <div className="mt-5 text-center">
      {address && (
        <p
          className="text-[13px] leading-relaxed mb-4 mx-auto"
          style={{ color: 'rgba(255,255,255,0.58)', maxWidth: '300px' }}
        >
          {address}
        </p>
      )}
      {(googleMapsUrl || wazeUrl) && (
        <div className="flex gap-3 justify-center">
          {googleMapsUrl && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-full text-[12px] tracking-wide font-light transition-all no-underline"
              style={{ ...pillBase, padding: '9px 20px' }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background = 'rgba(255,255,255,0.110)';
                el.style.color = 'rgba(255,255,255,0.85)';
                el.style.transform = 'translateY(-2px)';
                el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.24)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background = pillBase.background;
                el.style.color = pillBase.color;
                el.style.transform = '';
                el.style.boxShadow = pillBase.boxShadow;
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
              className="flex items-center justify-center gap-1.5 rounded-full text-[12px] tracking-wide font-light transition-all no-underline"
              style={{ ...pillBase, padding: '9px 20px' }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background = 'rgba(255,255,255,0.110)';
                el.style.color = 'rgba(255,255,255,0.85)';
                el.style.transform = 'translateY(-2px)';
                el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.24)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.background = pillBase.background;
                el.style.color = pillBase.color;
                el.style.transform = '';
                el.style.boxShadow = pillBase.boxShadow;
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
      className="mt-3 rounded-2xl p-5"
      style={{ background: 'rgba(255,255,255,0.028)', border: '1px solid rgba(255,255,255,0.058)' }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-white/22">{icon}</span>
        <p className="text-white/28 text-[10px] font-medium uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="text-white/50 text-[13px] leading-relaxed">{children}</p>
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function PageFooter({ websiteUrl, instagramUrl, restaurantName }: {
  websiteUrl: string | null; instagramUrl: string | null; restaurantName: string | null;
}) {
  const displayName = sanitizeName(restaurantName);
  const hasLinks = websiteUrl || instagramUrl;
  return (
    <div className="mt-6 pb-2 text-center">
      {hasLinks && (
        <>
          <div className="flex items-center gap-4 mb-5 mx-auto" style={{ maxWidth: '240px' }}>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.065)' }} />
            <div className="flex items-center gap-6">
              {websiteUrl && (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 no-underline transition-all"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.color = 'rgba(255,255,255,0.90)';
                    el.style.textShadow = '0 0 20px rgba(255,255,255,0.18)';
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.color = 'rgba(255,255,255,0.65)';
                    el.style.textShadow = '';
                  }}
                >
                  <GlobeIcon />
                  <span className="text-[13px] font-light tracking-wide">Website</span>
                </a>
              )}
              {instagramUrl && (
                <a
                  href={instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 no-underline transition-all"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.color = 'rgba(255,255,255,0.90)';
                    el.style.textShadow = '0 0 20px rgba(255,255,255,0.18)';
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.color = 'rgba(255,255,255,0.65)';
                    el.style.textShadow = '';
                  }}
                >
                  <InstagramIcon />
                  <span className="text-[13px] font-light tracking-wide">Instagram</span>
                </a>
              )}
            </div>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.065)' }} />
          </div>
        </>
      )}
      <p className="text-white/[0.15] text-[10px] tracking-widest uppercase">
        {displayName ? `${displayName} · ` : ''}Powered by Iron Booking
      </p>
    </div>
  );
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor">
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

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}
