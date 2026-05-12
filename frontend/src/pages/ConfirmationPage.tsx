import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicReservation } from '../types';
import { api, ApiError } from '../api';
import { useLocale } from '../i18n/useLocale';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { PublicFooter } from '../components/PublicFooter';
import { usePublicTheme } from '../utils/publicTheme';

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
  primaryColor: string | null;
  accentColor: string | null;
  publicThemePreset: string | null;
  buttonStyle: string | null;
  cardStyle: string | null;
  backgroundMood: string | null;
  backgroundColorHex: string | null;
  backgroundGradientHex: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtWeekday(iso: string, intlLocale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(intlLocale, { weekday: 'long' });
}

function fmtMonthDay(iso: string, intlLocale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(intlLocale, { month: 'long', day: 'numeric' });
}

function fmtTime(t: string, isRTL: boolean): string {
  const [h, min] = t.split(':').map(Number);
  if (isRTL) return `${h}:${min.toString().padStart(2, '0')}`;
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
  const { t }              = useTranslation();
  const { dir, isRTL, intlLocale } = useLocale();
  const [state,    setState]    = useState<PageState>({ phase: 'loading' });
  const [identity, setIdentity] = useState<RestaurantIdentity | null>(null);
  const [mounted,  setMounted]  = useState(false);
  usePublicTheme(identity);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let aborted = false;
    api.public.getReservation(token)
      .then(r => {
        if (aborted) return;
        setIdentity({ name: r.restaurantName, logoUrl: r.restaurantLogoUrl, coverUrl: r.restaurantCoverImageUrl, primaryColor: r.restaurantPrimaryColor, accentColor: r.restaurantAccentColor, publicThemePreset: r.restaurantPublicThemePreset, buttonStyle: r.restaurantButtonStyle, cardStyle: r.restaurantCardStyle, backgroundMood: r.restaurantBackgroundMood, backgroundColorHex: r.restaurantBackgroundColorHex, backgroundGradientHex: r.restaurantBackgroundGradientHex });
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
    <div dir={dir} className="relative min-h-screen flex flex-col items-center overflow-x-hidden" style={{ paddingBottom: 'clamp(24px, 4vh, 48px)' }}>

      <AtmosphericBg />

      {/* Language switcher */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher variant="public" />
      </div>

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
            <div role="status" aria-label={t('common.loading')}>
              <div className="pub-skeleton pub-skeleton-circle mb-5 mx-auto" style={{ width: 68, height: 68 }} />
              <div className="pub-skeleton pub-skeleton-title mb-3 mx-auto" />
              <div className="pub-skeleton pub-skeleton-line mb-8 mx-auto" />
              <div className="pub-skeleton pub-skeleton-btn mb-3" />
              <div className="pub-skeleton pub-skeleton-btn" style={{ opacity: 0.5 }} />
            </div>
          </GlassCard>
        )}

        {state.phase === 'actioning' && (
          <GlassCard>
            <div className="py-12 flex flex-col items-center gap-3" role="status">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" aria-hidden="true" />
              <p className="text-white/35 text-sm">
                {state.action === 'confirm' ? t('confirmation.actionConfirming')
                  : state.action === 'cancel' ? t('confirmation.actionCancelling')
                  : t('confirmation.actionNotifying')}
              </p>
            </div>
          </GlassCard>
        )}

        {state.phase === 'error' && (
          <GlassCard>
            <div role="alert">
              <OutcomeIcon variant="error" />
              <h1 className="text-white text-xl font-semibold text-center mb-2">
                {t(state.code === 'EXPIRED' ? 'confirmation.errorExpired' : 'confirmation.errorNotFound')}
              </h1>
              <p className="text-white/40 text-sm text-center leading-relaxed">{state.message}</p>
            </div>
          </GlassCard>
        )}

        {state.phase === 'cancelled' && (
          <GlassCard>
            <OutcomeIcon variant="neutral" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">{t('confirmation.cancelledTitle')}</h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">
              {t('confirmation.cancelledDetail')}
            </p>
          </GlassCard>
        )}

        {state.phase === 'late' && (
          <GlassCard>
            <OutcomeIcon variant="late" />
            <h1 className="text-white text-xl font-semibold text-center mb-2">{t('confirmation.lateTitle')}</h1>
            <p className="text-white/40 text-sm text-center leading-relaxed">
              {t('confirmation.lateDetail')}
            </p>
          </GlassCard>
        )}

        {state.phase === 'confirmed' && (() => {
          const r = state.reservation;
          return (
            <GlassCard>
              <OutcomeIcon variant="confirmed" />
              <h1 className="text-white text-2xl font-semibold text-center tracking-tight mb-1">
                {t('confirmation.confirmedTitle', { weekday: fmtWeekday(r.date, intlLocale) })}
              </h1>
              <p className="text-sm text-center" style={{ color: 'var(--pub-text-muted)', marginBottom: 'clamp(16px, 3vh, 32px)' }}>
                {t('confirmation.confirmedSub', { time: fmtTime(r.time, isRTL) })}
              </p>
              <DateHero date={r.date} time={r.time} partySize={r.partySize} occasion={r.occasion} />
              <Divider />
              <div className="flex flex-col gap-3">
                <LateBtn onClick={handleLate}>{t('confirmation.lateBtn')}</LateBtn>
                <CancelLink onClick={handleCancel}>{t('confirmation.cancelLink')}</CancelLink>
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
                <div className="mt-4 space-y-2">
                  {r.isConfirmedByGuest && (
                    <StatusNotice icon="✓" color="green" text={t('confirmation.tableConfirmed')} />
                  )}
                  {r.isRunningLate && (
                    <StatusNotice icon="⏱" color="amber" text={t('confirmation.restaurantNotified')} />
                  )}
                </div>
              )}

              <Divider />

              <div className="flex flex-col gap-3">
                {!r.isConfirmedByGuest && (
                  <ConfirmBtn onClick={handleConfirm}>{t('confirmation.confirmBtn')}</ConfirmBtn>
                )}
                {!r.isRunningLate && (
                  <LateBtn onClick={handleLate}>{t('confirmation.lateBtn')}</LateBtn>
                )}
                <CancelLink onClick={handleCancel}>{t('confirmation.cancelLink')}</CancelLink>
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
          <InfoBlock label={t('confirmation.infoNote')} icon={<NoteIcon />}>
            {res.restaurantSpecialInstructions}
          </InfoBlock>
        )}
        {res?.restaurantParkingNotes && (
          <InfoBlock label={t('confirmation.infoParking')} icon={<ParkIcon />}>
            {res.restaurantParkingNotes}
          </InfoBlock>
        )}
        {res?.restaurantCancellationPolicy && (
          <InfoBlock label={t('confirmation.infoCancellation')} icon={<PolicyIcon />}>
            {res.restaurantCancellationPolicy}
          </InfoBlock>
        )}

      </div>

      <PublicFooter
        visible={state.phase !== 'loading'}
        restaurant={res ? {
          name:         res.restaurantName,
          address:      res.restaurantAddress,
          phone:        res.restaurantPhone,
          websiteUrl:   res.restaurantWebsiteUrl,
          instagramUrl: res.restaurantInstagramUrl,
          googleMapsUrl: res.restaurantGoogleMapsUrl,
          wazeUrl:      res.restaurantWazeUrl,
        } : null}
      />

    </div>
  );
}

// ─── Atmospheric background ───────────────────────────────────────────────────

function AtmosphericBg() {
  return (
    <>
      <div className="pub-atm-base" />
      <div className="pub-atm-orb" />
      <div className="pub-atm-vignette" />
    </>
  );
}

// ─── Cover image hero ─────────────────────────────────────────────────────────

function CoverImageHero({ identity }: { identity: RestaurantIdentity }) {
  const displayName = sanitizeName(identity.name);
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '◆';

  const heroH = 'min(380px, 50vh)';
  const discS  = 'min(96px, 13.5vh)';
  const logoH  = 'min(52px, 7.5vh)';
  const bottomPos = 'min(96px, 13vh)';

  return (
    <div className="relative w-full" style={{ height: heroH }}>
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={identity.coverUrl!}
          alt=""
          className="w-full h-full object-cover"
          style={{ transform: 'scale(1.05)', transformOrigin: 'center 40%' }}
        />
      </div>

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

      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          bottom: '-80px',
          height: '160px',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(9,12,18,0.60) 50%, rgba(9,12,18,0.95) 100%)',
        }}
      />

      <div
        className="absolute left-0 right-0 flex flex-col items-center px-5"
        style={{ bottom: bottomPos }}
      >
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
              background: 'radial-gradient(circle, rgb(var(--pub-rgb) / 0.10) 0%, transparent 65%)',
            }}
          />
          {identity.logoUrl ? (
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
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: '140px', height: '140px',
            background: 'radial-gradient(circle, rgba(255,255,255,0.055) 0%, rgb(var(--pub-rgb) / 0.04) 45%, transparent 70%)',
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
                '0 0 50px rgb(var(--pub-rgb) / 0.06)',
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
  return <div className="pub-card pub-card--lg w-full">{children}</div>;
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return <hr className="pub-divider" />;
}

// ─── Date hero ────────────────────────────────────────────────────────────────

function DateHero({ date, time, partySize, occasion }: {
  date: string; time: string; partySize: number; occasion: string | null;
}) {
  const { t }          = useTranslation();
  const { isRTL, intlLocale } = useLocale();
  return (
    <div className="text-center">
      <p className="text-white/22 text-[10px] font-medium uppercase tracking-[0.22em] mb-2 rtl:tracking-normal">
        {fmtWeekday(date, intlLocale)}
      </p>
      <p
        className="font-semibold leading-none"
        style={{ fontSize: 'var(--pub-size-display-hero)', letterSpacing: 'var(--pub-tracking-tighter)', color: 'var(--pub-text-warm)', marginBottom: 'clamp(6px, 1.2vh, 10px)' }}
      >
        {fmtMonthDay(date, intlLocale)}
      </p>
      <p className="text-[19px] font-light tracking-wide" style={{ color: 'var(--pub-text-secondary)', marginBottom: 'clamp(14px, 2.5vh, 24px)' }}>{fmtTime(time, isRTL)}</p>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Chip>{t('common.guestCount', { count: partySize })}</Chip>
        {occasion && <OccasionChip>{occasion}</OccasionChip>}
      </div>
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="pub-chip">{children}</span>;
}

function OccasionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pub-chip pub-chip--warning">
      <span aria-hidden="true">✦</span> {children}
    </span>
  );
}

// ─── Status notices ───────────────────────────────────────────────────────────

function StatusNotice({ icon, color, text }: { icon: string; color: 'green' | 'amber'; text: string }) {
  const mod = color === 'green' ? 'success' : 'warning';
  return (
    <div className={`pub-banner pub-banner--${mod}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ─── Outcome icons ────────────────────────────────────────────────────────────

function OutcomeIcon({ variant }: { variant: 'confirmed' | 'late' | 'error' | 'neutral' }) {
  const mod = variant === 'confirmed' ? 'brand' : variant === 'late' ? 'warning' : variant;
  const icon = { confirmed: '✓', late: '⏱', error: '✕', neutral: '○' }[variant];
  return <div className={`pub-outcome-icon pub-outcome-icon--${mod}`} aria-hidden="true">{icon}</div>;
}

// ─── Action buttons ───────────────────────────────────────────────────────────

function ConfirmBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="pub-btn pub-btn-primary">
      {children}
    </button>
  );
}

function LateBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="pub-btn pub-btn-ghost">
      {children}
    </button>
  );
}

function CancelLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="pub-btn pub-btn-bare">
      {children}
    </button>
  );
}

// ─── Navigation chips ─────────────────────────────────────────────────────────

function NavChips({ address, googleMapsUrl, wazeUrl }: {
  address: string | null; googleMapsUrl: string | null; wazeUrl: string | null;
}) {
  const { t } = useTranslation();
  if (!address && !googleMapsUrl && !wazeUrl) return null;

  return (
    <div className="mt-5 text-center">
      {address && (
        <p className="text-[13px] leading-relaxed mb-4 mx-auto" style={{ color: 'var(--pub-text-secondary)', maxWidth: '300px' }}>
          {address}
        </p>
      )}
      {(googleMapsUrl || wazeUrl) && (
        <div className="flex gap-3 justify-center">
          {googleMapsUrl && (
            <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="pub-nav-pill">
              <PinIcon /> {t('common.maps')}
            </a>
          )}
          {wazeUrl && (
            <a href={wazeUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="pub-nav-pill">
              <CarIcon /> {t('common.waze')}
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
    <div className="pub-inset mt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color: 'var(--pub-text-micro)' }} aria-hidden="true">{icon}</span>
        <p className="pub-section-label" style={{ marginBottom: 0 }}>{label}</p>
      </div>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--pub-text-tertiary)' }}>{children}</p>
    </div>
  );
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  );
}

function ParkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z" />
    </svg>
  );
}

function PolicyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8zm0-4h8v2H8z" />
    </svg>
  );
}

