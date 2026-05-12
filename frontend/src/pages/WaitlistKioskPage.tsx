import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicRestaurantProfile } from '../types';
import { api } from '../api';
import { useLocale } from '../i18n/useLocale';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { PublicFooter } from '../components/PublicFooter';
import { usePublicTheme } from '../utils/publicTheme';

interface Props { slug: string }

type Phase =
  | { phase: 'loading' }
  | { phase: 'not-found' }
  | { phase: 'form' }
  | { phase: 'submitting' }
  | { phase: 'success'; restaurantName: string }
  | { phase: 'error'; message: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Shared visual primitives (self-contained, matching BookingPage) ───────────

function AtmosphericBg({ coverImageUrl }: { coverImageUrl?: string | null }) {
  return (
    <>
      {coverImageUrl ? (
        <div className="fixed inset-0 -z-20 overflow-hidden">
          <img
            src={coverImageUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ transform: 'scale(1.08)', filter: 'blur(28px) brightness(0.32) saturate(1.2)' }}
          />
        </div>
      ) : (
        <div className="pub-atm-base" />
      )}
      <div className="pub-atm-vignette" />
    </>
  );
}

function GlassCard({ children }: { children: React.ReactNode }) {
  return <div className="pub-card pub-card--lg w-full">{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="pub-section-label">{children}</p>;
}

function GlassInput({
  type = 'text', value, onChange, placeholder, autoComplete, inputMode, 'aria-label': ariaLabel,
}: {
  type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  'aria-label'?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      aria-label={ariaLabel}
      className="pub-input"
      style={{ fontSize: '17px', padding: '16px 18px' }}
    />
  );
}

function GlassTextarea({
  value, onChange, placeholder, 'aria-label': ariaLabel,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; 'aria-label'?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      aria-label={ariaLabel}
      className="pub-textarea"
      style={{ fontSize: '16px', padding: '16px 18px' }}
    />
  );
}

// ─── Party size stepper ───────────────────────────────────────────────────────

function PartySelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label={t('common.decreaseParty')}
        disabled={value <= 1}
        className="pub-counter-btn"
        style={{ width: 56, height: 56, fontSize: 24 }}
      >
        <span aria-hidden="true">−</span>
      </button>
      <div className="flex-1 text-center" dir="ltr" aria-live="polite" aria-atomic="true">
        <span style={{ color: 'var(--pub-text-warm)', fontSize: 42, fontWeight: 200, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ color: 'var(--pub-text-tertiary)', fontSize: 14, marginInlineStart: 8 }}>
          {t('common.guestWord', { count: value })}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, value + 1))}
        aria-label={t('common.increaseParty')}
        disabled={value >= 20}
        className="pub-counter-btn"
        style={{ width: 56, height: 56, fontSize: 24 }}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

// ─── Restaurant header ────────────────────────────────────────────────────────

function RestaurantHeader({ profile }: { profile: PublicRestaurantProfile | null }) {
  if (!profile) return null;
  const initial = profile.name.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-3 pb-2">
      {profile.logoUrl ? (
        <img
          src={profile.logoUrl}
          alt={profile.name}
          className="object-contain"
          style={{ height: 52, maxWidth: 160 }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full select-none"
          style={{
            width: 64, height: 64,
            background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
            fontSize: 26, fontWeight: 600, color: 'rgba(255,255,255,0.80)',
          }}
        >
          {initial}
        </div>
      )}
      <div className="text-center">
        <h2 style={{ color: 'var(--pub-text-warm)', fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          {profile.name}
        </h2>
        {profile.cuisine && (
          <p style={{ color: 'var(--pub-text-tertiary)', fontSize: 13, marginTop: 2 }}>{profile.cuisine}</p>
        )}
      </div>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────

function SuccessScreen({ restaurantName, onReset }: { restaurantName: string; onReset: () => void }) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(15);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(n => {
        if (n <= 1) { onReset(); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [onReset]);

  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      <div
        aria-hidden="true"
        className="flex items-center justify-center rounded-full mx-auto"
        style={{
          width: 80, height: 80,
          background: 'var(--pub-brand-subtle)',
          border: '1.5px solid var(--pub-brand-border)',
          boxShadow: '0 0 48px var(--pub-brand-glow)',
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--pub-brand-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <div className="space-y-2">
        <h2 style={{ color: 'var(--pub-text-warm)', fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
          {t('kiosk.successTitle')}
        </h2>
        <p style={{ color: 'var(--pub-text-secondary)', fontSize: 17, lineHeight: 1.5 }}>
          {t('kiosk.successSubtitle')}
        </p>
        <p style={{ color: 'var(--pub-text-muted)', fontSize: 14, lineHeight: 1.5 }}>
          {t('kiosk.successWhatsapp')}
        </p>
      </div>

      <p style={{ color: 'var(--pub-text-micro)', fontSize: 13 }}>
        {restaurantName}
      </p>

      <div className="w-full flex flex-col gap-3 pt-2">
        <button type="button" onClick={onReset} className="pub-btn pub-btn-secondary" style={{ fontSize: 17, padding: '18px' }}>
          {t('kiosk.newGuest')}
        </button>
        <p style={{ color: 'var(--pub-text-micro)', fontSize: 13 }}>
          {t('kiosk.resetIn', { n: countdown })}
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WaitlistKioskPage({ slug }: Props) {
  const { t, i18n }              = useTranslation();
  const { dir, locale }          = useLocale();
  const [profile, setProfile]    = useState<PublicRestaurantProfile | null>(null);
  const [phase,   setPhase]      = useState<Phase>({ phase: 'loading' });
  usePublicTheme(profile);

  // Form state
  const [name,      setName]      = useState('');
  const [phone,     setPhone]     = useState('');
  const [partySize, setPartySize] = useState(2);
  const [note,      setNote]      = useState('');

  // Initialise language from ?lang= URL param
  useEffect(() => {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang === 'he' || urlLang === 'en') i18n.changeLanguage(urlLang);
  }, [i18n]);

  // Load restaurant profile
  useEffect(() => {
    api.public.book.getProfile(slug)
      .then(p => { setProfile(p); setPhase({ phase: 'form' }); })
      .catch(() => setPhase({ phase: 'not-found' }));
  }, [slug]);

  function resetForm() {
    setName(''); setPhone(''); setPartySize(2); setNote('');
    setPhase({ phase: 'form' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setPhase({ phase: 'submitting' });
    try {
      const result = await api.public.book.joinWaitlist(slug, {
        guestName:     name.trim(),
        guestPhone:    phone.trim(),
        partySize,
        date:          todayStr(),
        preferredTime: nowTimeStr(),
        flexibleTime:  true,
        notes:         note.trim() || undefined,
        lang:          locale as 'en' | 'he',
      });
      setPhase({ phase: 'success', restaurantName: result.restaurantName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('booking.errorTitle');
      setPhase({ phase: 'error', message: msg });
    }
  }

  const isForm       = phase.phase === 'form';
  const isSubmitting = phase.phase === 'submitting';

  return (
    <div
      dir={dir}
      className="relative min-h-screen flex flex-col items-center"
      style={{ paddingBottom: 'clamp(24px, 5vh, 64px)' }}
    >
      <AtmosphericBg coverImageUrl={profile?.coverImageUrl} />

      {/* Language switcher */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher variant="public" />
      </div>

      {/* Content */}
      <div
        className="w-full max-w-[480px] px-4 flex flex-col gap-4"
        style={{ paddingTop: 'clamp(40px, 8vh, 80px)' }}
      >

        {/* Loading */}
        {phase.phase === 'loading' && (
          <GlassCard>
            <div role="status" aria-label={t('common.loading')}>
              <div className="pub-skeleton pub-skeleton-circle mb-5 mx-auto" style={{ width: 64, height: 64 }} />
              <div className="pub-skeleton pub-skeleton-title mb-3 mx-auto" />
              <div className="pub-skeleton pub-skeleton-line mb-8 mx-auto" />
              <div className="pub-skeleton pub-skeleton-input mb-3" />
              <div className="pub-skeleton pub-skeleton-input mb-3" />
              <div className="pub-skeleton pub-skeleton-btn" />
            </div>
          </GlassCard>
        )}

        {/* Not found */}
        {phase.phase === 'not-found' && (
          <GlassCard>
            <div className="py-10 text-center space-y-2">
              <p style={{ color: 'var(--pub-text-secondary)', fontSize: 20, fontWeight: 500 }}>
                {t('kiosk.notFound')}
              </p>
              <p style={{ color: 'var(--pub-text-muted)', fontSize: 14 }}>
                {t('kiosk.notFoundDetail')}
              </p>
            </div>
          </GlassCard>
        )}

        {/* Success */}
        {phase.phase === 'success' && (
          <GlassCard>
            <SuccessScreen restaurantName={phase.restaurantName} onReset={resetForm} />
          </GlassCard>
        )}

        {/* Form + Error */}
        {(isForm || isSubmitting || phase.phase === 'error') && (
          <GlassCard>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">

              {/* Restaurant header */}
              <RestaurantHeader profile={profile} />

              {/* Divider */}
              <hr className="pub-divider" style={{ margin: '0 -4px' }} />

              {/* Title */}
              <div className="text-center space-y-1">
                <h1 style={{ color: 'var(--pub-text-warm)', fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2 }}>
                  {t('kiosk.title')}
                </h1>
                <p style={{ color: 'var(--pub-text-tertiary)', fontSize: 15, lineHeight: 1.5 }}>
                  {t('kiosk.subtitle')}
                </p>
              </div>

              {/* Party size */}
              <div>
                <SectionLabel>{t('kiosk.partySize')}</SectionLabel>
                <PartySelector value={partySize} onChange={setPartySize} />
              </div>

              <hr className="pub-divider" />

              {/* Name */}
              <div>
                <SectionLabel>{t('kiosk.name')}</SectionLabel>
                <GlassInput
                  value={name}
                  onChange={setName}
                  placeholder={t('kiosk.namePlaceholder')}
                  autoComplete="name"
                  aria-label={t('kiosk.name')}
                />
              </div>

              {/* Phone */}
              <div>
                <SectionLabel>{t('kiosk.phone')}</SectionLabel>
                <GlassInput
                  type="tel"
                  value={phone}
                  onChange={setPhone}
                  placeholder={t('kiosk.phonePlaceholder')}
                  autoComplete="tel"
                  inputMode="tel"
                  aria-label={t('kiosk.phone')}
                />
              </div>

              {/* Note (optional) */}
              <div>
                <SectionLabel>
                  {t('kiosk.note')}{' '}
                  <span style={{ color: 'var(--pub-text-micro)', textTransform: 'none', letterSpacing: 0 }}>
                    — {t('kiosk.optional')}
                  </span>
                </SectionLabel>
                <GlassTextarea
                  value={note}
                  onChange={setNote}
                  placeholder={t('kiosk.notePlaceholder')}
                  aria-label={t('kiosk.note')}
                />
              </div>

              {/* Error */}
              {phase.phase === 'error' && (
                <p className="pub-alert pub-alert--error" role="alert">{phase.message}</p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || !name.trim() || !phone.trim()}
                className="pub-btn pub-btn-primary"
                style={{ fontSize: 18, padding: '20px' }}
              >
                {isSubmitting ? t('kiosk.submitting') : t('kiosk.submit')}
              </button>

            </form>
          </GlassCard>
        )}

      </div>

      <PublicFooter visible={phase.phase !== 'loading' && phase.phase !== 'not-found'} />

    </div>
  );
}
