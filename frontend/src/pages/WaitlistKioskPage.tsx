import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicRestaurantProfile } from '../types';
import { api } from '../api';
import { useLocale } from '../i18n/useLocale';
import LanguageSwitcher from '../components/LanguageSwitcher';
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

function AtmosphericBg() {
  return (
    <>
      <div
        className="fixed inset-0 -z-20"
        style={{
          background: [
            'radial-gradient(ellipse 140% 55% at 50% -15%, rgb(var(--pub-rgb) / 0.09) 0%, transparent 50%)',
            'radial-gradient(ellipse 80% 40% at 10% 110%, rgba(59,130,246,0.04) 0%, transparent 50%)',
            'linear-gradient(170deg, #101520 0%, #0b0f18 40%, #080a10 100%)',
          ].join(', '),
        }}
      />
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.48) 100%)' }}
      />
    </>
  );
}

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full rounded-[28px] backdrop-blur-[100px]"
      style={{
        padding: 'clamp(24px, 4vh, 36px)',
        background: 'linear-gradient(160deg, rgba(14,18,30,0.72) 0%, rgba(7,9,18,0.80) 100%)',
        border: '1px solid rgba(255,255,255,0.065)',
        boxShadow: [
          '0 2px 0 rgba(255,255,255,0.090) inset',
          '1px 0 0 rgba(255,255,255,0.030) inset',
          '-1px 0 0 rgba(255,255,255,0.016) inset',
          '0 -1px 0 rgba(0,0,0,0.45) inset',
          '0 48px 96px rgba(0,0,0,0.65)',
          '0 18px 48px rgba(0,0,0,0.45)',
        ].join(', '),
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-medium uppercase tracking-[0.20em] mb-3 rtl:tracking-normal"
      style={{ color: 'rgba(255,255,255,0.28)' }}
    >
      {children}
    </p>
  );
}

function GlassInput({
  type = 'text', value, onChange, placeholder, autoComplete, inputMode,
}: {
  type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoComplete?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      className="w-full rounded-2xl outline-none transition-all"
      style={{
        background: 'rgba(255,255,255,0.065)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: 'rgba(255,255,255,0.92)',
        padding: '16px 18px',
        fontSize: '17px',
        lineHeight: 1.4,
      }}
      onFocus={e => { e.currentTarget.style.border = '1px solid rgb(var(--pub-rgb) / 0.55)'; }}
      onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.12)'; }}
    />
  );
}

function GlassTextarea({
  value, onChange, placeholder,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full rounded-2xl outline-none transition-all resize-none"
      style={{
        background: 'rgba(255,255,255,0.065)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: 'rgba(255,255,255,0.92)',
        padding: '16px 18px',
        fontSize: '16px',
        lineHeight: 1.5,
      }}
      onFocus={e => { e.currentTarget.style.border = '1px solid rgb(var(--pub-rgb) / 0.55)'; }}
      onBlur={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,0.12)'; }}
    />
  );
}

// ─── Party size stepper ───────────────────────────────────────────────────────

function PartySelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  const btnStyle: React.CSSProperties = {
    width: 56, height: 56,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.068)',
    border: '1px solid rgba(255,255,255,0.14)',
    color: 'rgba(255,255,255,0.70)',
    fontSize: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  };
  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        style={btnStyle}
        onTouchStart={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.13)'; }}
        onTouchEnd={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.068)'; }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.068)'; }}
      >
        −
      </button>
      <div className="flex-1 text-center" dir="ltr">
        <span style={{ color: '#f8f5ef', fontSize: 42, fontWeight: 200, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.40)', fontSize: 14, marginInlineStart: 8 }}>
          {t('common.guestWord', { count: value })}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, value + 1))}
        style={btnStyle}
        onTouchStart={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.13)'; }}
        onTouchEnd={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.068)'; }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.068)'; }}
      >
        +
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
        <h2 style={{ color: '#f2ece0', fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
          {profile.name}
        </h2>
        {profile.cuisine && (
          <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 13, marginTop: 2 }}>{profile.cuisine}</p>
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
      {/* Checkmark */}
      <div
        style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgb(var(--pub-rgb) / 0.15)',
          border: '1.5px solid rgb(var(--pub-rgb) / 0.40)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--pub-rgb) / 0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <div className="space-y-2">
        <h2 style={{ color: '#f2ece0', fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
          {t('kiosk.successTitle')}
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 17, lineHeight: 1.5 }}>
          {t('kiosk.successSubtitle')}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 14, lineHeight: 1.5 }}>
          {t('kiosk.successWhatsapp')}
        </p>
      </div>

      <p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 13 }}>
        {restaurantName}
      </p>

      <div className="w-full flex flex-col gap-3 pt-2">
        <button
          type="button"
          onClick={onReset}
          className="w-full rounded-2xl font-semibold transition-all active:scale-[0.98]"
          style={{
            padding: '18px',
            fontSize: 17,
            background: 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.16)',
            color: 'rgba(255,255,255,0.82)',
          }}
        >
          {t('kiosk.newGuest')}
        </button>
        <p style={{ color: 'rgba(255,255,255,0.22)', fontSize: 13 }}>
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
      <AtmosphericBg />

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
            <div className="py-16 flex items-center justify-center">
              <div className="w-7 h-7 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            </div>
          </GlassCard>
        )}

        {/* Not found */}
        {phase.phase === 'not-found' && (
          <GlassCard>
            <div className="py-10 text-center space-y-2">
              <p style={{ color: 'rgba(255,255,255,0.80)', fontSize: 20, fontWeight: 500 }}>
                {t('kiosk.notFound')}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 14 }}>
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
              <div style={{ height: 1, background: 'rgba(255,255,255,0.055)', margin: '0 -4px' }} />

              {/* Title */}
              <div className="text-center space-y-1">
                <h1 style={{ color: '#f2ece0', fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2 }}>
                  {t('kiosk.title')}
                </h1>
                <p style={{ color: 'rgba(255,255,255,0.48)', fontSize: 15, lineHeight: 1.5 }}>
                  {t('kiosk.subtitle')}
                </p>
              </div>

              {/* Party size */}
              <div>
                <SectionLabel>{t('kiosk.partySize')}</SectionLabel>
                <PartySelector value={partySize} onChange={setPartySize} />
              </div>

              <div style={{ height: 1, background: 'rgba(255,255,255,0.055)' }} />

              {/* Name */}
              <div>
                <SectionLabel>{t('kiosk.name')}</SectionLabel>
                <GlassInput
                  value={name}
                  onChange={setName}
                  placeholder={t('kiosk.namePlaceholder')}
                  autoComplete="name"
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
                />
              </div>

              {/* Note (optional) */}
              <div>
                <SectionLabel>
                  {t('kiosk.note')}{' '}
                  <span style={{ color: 'rgba(255,255,255,0.20)', textTransform: 'none', letterSpacing: 0 }}>
                    — {t('kiosk.optional')}
                  </span>
                </SectionLabel>
                <GlassTextarea
                  value={note}
                  onChange={setNote}
                  placeholder={t('kiosk.notePlaceholder')}
                />
              </div>

              {/* Error */}
              {phase.phase === 'error' && (
                <p
                  className="text-center rounded-2xl"
                  style={{
                    background: 'rgba(239,68,68,0.10)',
                    border: '1px solid rgba(239,68,68,0.22)',
                    color: 'rgba(252,165,165,0.90)',
                    padding: '12px 16px',
                    fontSize: 14,
                  }}
                >
                  {phase.message}
                </p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || !name.trim() || !phone.trim()}
                className="w-full rounded-2xl font-semibold transition-all active:scale-[0.98]"
                style={{
                  padding: '20px',
                  fontSize: 18,
                  background: (isSubmitting || !name.trim() || !phone.trim())
                    ? 'rgb(var(--pub-rgb) / 0.30)'
                    : 'rgb(var(--pub-rgb) / 0.82)',
                  color: 'white',
                  cursor: (isSubmitting || !name.trim() || !phone.trim()) ? 'not-allowed' : 'pointer',
                  boxShadow: (isSubmitting || !name.trim() || !phone.trim())
                    ? 'none'
                    : '0 4px 24px rgb(var(--pub-rgb) / 0.28)',
                }}
              >
                {isSubmitting ? t('kiosk.submitting') : t('kiosk.submit')}
              </button>

            </form>
          </GlassCard>
        )}

        {/* Powered by */}
        <p
          className="text-center"
          style={{ color: 'rgba(255,255,255,0.14)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}
        >
          {t('common.poweredBy')}
        </p>

      </div>
    </div>
  );
}
