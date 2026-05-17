import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicRestaurantProfile, PublicSlot, AvailabilityResponse, BookingAlternative, BookingResult, PublicWaitlistResult } from '../types';
import { api, ApiError } from '../api';
import { useLocale } from '../i18n/useLocale';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { PublicFooter } from '../components/PublicFooter';
import { usePublicTheme } from '../utils/publicTheme';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Props { slug: string }

type BookingPhase =
  | { phase: 'loading' }
  | { phase: 'not-found' }
  | { phase: 'select' }
  | { phase: 'slots-loading'; date: string; partySize: number }
  | { phase: 'slots';         date: string; partySize: number; data: AvailabilityResponse }
  | { phase: 'details';       date: string; partySize: number; slot: string }
  | { phase: 'submitting' }
  | { phase: 'confirmed';  result: BookingResult }
  | { phase: 'slot-taken';     alternatives: BookingAlternative[] }
  | { phase: 'online-blocked'; message: string }
  | { phase: 'error';          message: string }
  | { phase: 'waitlist';         date: string; partySize: number; slotsData: AvailabilityResponse }
  | { phase: 'waitlist-success'; result: PublicWaitlistResult };

interface WaitlistFormState {
  guestName:     string;
  guestPhone:    string;
  preferredTime: string;
  flexibleTime:  boolean;
  notes:         string;
}

interface FormState {
  guestName:  string;
  guestPhone: string;
  guestEmail: string;
  occasion:   string;
  guestNotes: string;
}

// API value stays English (sent to backend); tKey is the i18n translation key
const OCCASIONS = [
  { value: 'Birthday',    tKey: 'booking.occasions.birthday'    },
  { value: 'Anniversary', tKey: 'booking.occasions.anniversary' },
  { value: 'Business',    tKey: 'booking.occasions.business'    },
  { value: 'Date Night',  tKey: 'booking.occasions.dateNight'   },
  { value: 'Other',       tKey: 'booking.occasions.other'       },
];

// ─── Formatting helpers ────────────────────────────────────────────────────────

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fmtTime(t: string, isRTL: boolean): string {
  const [h, min] = t.split(':').map(Number);
  if (isRTL) return `${h}:${String(min).padStart(2, '0')}`;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${period}`;
}

function fmtDateLong(iso: string, intlLocale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(intlLocale, { weekday: 'long', month: 'long', day: 'numeric' });
}

function fmtDateShort(iso: string, intlLocale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(intlLocale, { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtChipDay(d: Date, intlLocale: string): string {
  return d.toLocaleDateString(intlLocale, { weekday: 'short' });
}

function fmtChipMonth(d: Date, intlLocale: string): string {
  return d.toLocaleDateString(intlLocale, { month: 'short' });
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function BookingPage({ slug }: Props) {
  const { t }                         = useTranslation();
  const { dir, locale, intlLocale }   = useLocale();
  const [profile,  setProfile]        = useState<PublicRestaurantProfile | null>(null);
  const [state,    setState]          = useState<BookingPhase>({ phase: 'loading' });
  usePublicTheme(profile);
  const [mounted,  setMounted]        = useState(false);
  const [partySize, setPartySize]     = useState(2);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [form,     setForm]           = useState<FormState>({
    guestName: '', guestPhone: '', guestEmail: '', occasion: '', guestNotes: '',
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    api.public.book.getProfile(slug)
      .then(p => {
        setProfile(p);
        const today = new Date();
        for (let i = 0; i < p.maxAdvanceBookingDays; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() + i);
          const hours = p.operatingHours.find(h => h.dayOfWeek === d.getDay());
          if (hours?.isOpen) { setSelectedDate(toLocalDateString(d)); break; }
        }
        setState({ phase: 'select' });
      })
      .catch(() => setState({ phase: 'not-found' }));
  }, [slug]);

  async function handleFindTable() {
    if (!selectedDate || !profile) return;
    setState({ phase: 'slots-loading', date: selectedDate, partySize });
    try {
      const data = await api.public.book.getAvailability(slug, selectedDate, partySize);
      setState({ phase: 'slots', date: selectedDate, partySize, data });
    } catch {
      setState({ phase: 'slots', date: selectedDate, partySize, data: {
        date: selectedDate, partySize, timezone: profile.timezone,
        slots: [], isFullyBooked: false, isClosed: false, isPast: false, alternatives: [],
      }});
    }
  }

  function handleSlotSelect(time: string) {
    const s = state;
    if (s.phase !== 'slots') return;
    setState({ phase: 'details', date: s.date, partySize: s.partySize, slot: time });
  }

  function handleAlternativeSelect(alt: BookingAlternative) {
    setState({ phase: 'details', date: alt.date, partySize, slot: alt.time });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = state;
    if (s.phase !== 'details') return;
    if (!form.guestName.trim() || !form.guestPhone.trim()) return;

    setState({ phase: 'submitting' });
    try {
      const result = await api.public.book.reserve(slug, {
        date:       s.date,
        time:       s.slot,
        partySize:  s.partySize,
        guestName:  form.guestName.trim(),
        guestPhone: form.guestPhone.trim(),
        guestEmail: form.guestEmail.trim() || undefined,
        occasion:   form.occasion || undefined,
        guestNotes: form.guestNotes.trim() || undefined,
        lang:       locale,
      });
      setState({ phase: 'confirmed', result });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') {
        const details = err.details as { alternatives?: BookingAlternative[] } | undefined;
        setState({ phase: 'slot-taken', alternatives: details?.alternatives ?? [] });
      } else if (err instanceof ApiError && err.code === 'ONLINE_BOOKING_BLOCKED') {
        setState({ phase: 'online-blocked', message: err.message });
      } else {
        setState({ phase: 'error', message: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.' });
      }
    }
  }

  async function handleJoinWaitlist(wf: WaitlistFormState): Promise<void> {
    const s = state;
    if (s.phase !== 'waitlist') return;
    const result = await api.public.book.joinWaitlist(slug, {
      guestName:     wf.guestName.trim(),
      guestPhone:    wf.guestPhone.trim(),
      partySize:     s.partySize,
      date:          s.date,
      preferredTime: wf.preferredTime,
      flexibleTime:  wf.flexibleTime,
      notes:         wf.notes.trim() || undefined,
      lang:          locale,
    });
    setState({ phase: 'waitlist-success', result });
  }

  const fade = (delay: number) => ({
    className: `transition-all duration-500 ease-out ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`,
    style: { transitionDelay: `${delay}ms` } as React.CSSProperties,
  });

  const hasCover    = !!profile?.coverImageUrl;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const showVideo   = !!profile?.heroVideoUrl && !reducedMotion;

  return (
    <div dir={dir} className="relative flex flex-col overflow-x-hidden" style={{ background: '#090c12' }}>
      <AtmosphericBg />

      {/* Language switcher */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher variant="public" />
      </div>

      {/* ── Hero section — image + identity + booking card ───────────────────── */}
      <div
        className={`relative w-full overflow-hidden flex flex-col items-center min-h-[85vh] md:min-h-[75vh] ${fade(0).className}`}
        style={{ ...fade(0).style, paddingBottom: 'clamp(40px, 7vh, 80px)' }}
      >
        {/* Cover image layer */}
        {hasCover && profile && (
          <>
            <img
              src={profile.coverImageUrl!}
              alt=""
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center',
                transform: 'scale(1.04)', transformOrigin: 'center 40%',
              }}
            />
            {showVideo && (
              <video
                src={profile.heroVideoUrl!}
                autoPlay muted loop playsInline
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.currentTarget as HTMLVideoElement).style.display = 'none'; }}
              />
            )}
            {/* Overlay: subtle top vignette → strong bottom fade */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, rgba(5,8,12,0.30) 0%, rgba(5,8,12,0.42) 35%, rgba(5,8,12,0.78) 70%, rgba(5,8,12,0.97) 100%)',
              }}
            />
          </>
        )}

        {/* Restaurant identity: logo + name */}
        <div
          className="relative z-10 w-full flex flex-col items-center px-4"
          style={{ paddingTop: 'clamp(48px, 8vh, 80px)', marginBottom: 'clamp(20px, 3.5vh, 40px)' }}
        >
          <HeroIdentity profile={profile} />
        </div>

        {/* Booking card — floats inside the hero */}
        <div
          className={`relative z-10 w-full max-w-[500px] px-4 ${fade(80).className}`}
          style={fade(80).style}
        >
        {state.phase === 'loading' && (
          <GlassCard>
            <div role="status" aria-label={t('common.loading')}>
              <div className="pub-skeleton pub-skeleton-title mb-4 mx-auto" />
              <div className="pub-skeleton-group mb-6">
                <div className="pub-skeleton pub-skeleton-line mx-auto" />
                <div className="pub-skeleton pub-skeleton-line-sm mx-auto" />
              </div>
              <div className="flex gap-2 justify-center mb-6">
                {[...Array(5)].map((_, i) => <div key={i} className="pub-skeleton pub-skeleton-chip" />)}
              </div>
              <div className="pub-skeleton pub-skeleton-btn" />
            </div>
          </GlassCard>
        )}

        {state.phase === 'not-found' && (
          <GlassCard>
            <div className="py-6 text-center">
              <p className="text-white/80 text-lg font-medium mb-2">{t('booking.notFound')}</p>
              <p className="text-white/40 text-sm">{t('booking.notFoundDetail')}</p>
            </div>
          </GlassCard>
        )}

        {(state.phase === 'select' || state.phase === 'slots-loading') && profile && (
          <GlassCard>
            <SectionLabel>{t('booking.partySize')}</SectionLabel>
            <PartySelector
              value={partySize}
              max={profile.maxPartySize}
              onChange={setPartySize}
            />

            <hr className="pub-divider" />

            <SectionLabel>{t('booking.selectDate')}</SectionLabel>
            <DateCarousel
              profile={profile}
              selected={selectedDate}
              onSelect={setSelectedDate}
            />

            <div style={{ marginTop: 'clamp(16px, 2.5vh, 28px)' }}>
              <PrimaryBtn
                onClick={handleFindTable}
                disabled={!selectedDate || state.phase === 'slots-loading'}
                loading={state.phase === 'slots-loading'}
              >
                {state.phase === 'slots-loading' ? t('booking.checkingAvailability') : t('booking.findTable')}
              </PrimaryBtn>
            </div>
          </GlassCard>
        )}

        {state.phase === 'slots' && (
          <GlassCard>
            <BookingSummaryBar
              date={state.date}
              partySize={state.partySize}
              onBack={() => setState({ phase: 'select' })}
            />

            <hr className="pub-divider" />

            {state.data.isClosed && (
              <StatusBanner icon="✕" color="red" text={t('booking.closed', { date: fmtDateShort(state.date, intlLocale) })} />
            )}

            {state.data.isPast && (
              <StatusBanner icon="⏎" color="amber" text={t('booking.datePassed')} />
            )}

            {/* Fully booked with no alternatives → premium dead-end avoidance */}
            {!state.data.isClosed && !state.data.isPast && state.data.isFullyBooked && state.data.alternatives.length === 0 && (
              <div className="py-2 text-center">
                <div className="pub-outcome-icon pub-outcome-icon--neutral" aria-hidden="true">◌</div>
                <h3 className="font-semibold mb-1.5" style={{ color: 'var(--pub-text-secondary)', fontSize: '16px' }}>
                  {t('booking.noTablesAvailable')}
                </h3>
                <p className="text-[13px] leading-relaxed mb-6 px-4" style={{ color: 'var(--pub-text-muted)' }}>
                  {t('booking.fullyBookedMessage', { date: fmtDateShort(state.date, intlLocale), count: state.partySize })}
                </p>
                <PrimaryBtn onClick={() => setState({ phase: 'waitlist', date: state.date, partySize: state.partySize, slotsData: state.data })}>
                  {t('booking.joinWaitlist')}
                </PrimaryBtn>
              </div>
            )}

            {/* Available slots */}
            {!state.data.isFullyBooked && state.data.slots.length === 0 && !state.data.isClosed && !state.data.isPast && (
              <StatusBanner icon="○" color="neutral" text={t('booking.noTimesAvailable')} />
            )}
            {/* All slots online-blocked → show calm explanation instead of a fully-dimmed grid */}
            {!state.data.isFullyBooked && state.data.slots.length > 0 && state.data.slots.every(s => s.onlineBlocked) && (
              <StatusBanner
                icon="○" color="neutral"
                text={state.data.slots.find(s => s.onlineBlocked && s.guestMessage)?.guestMessage ?? t('booking.onlineBlockedDefault')}
              />
            )}
            {/* Normal slot grid — shown when at least one slot is not online-blocked */}
            {!state.data.isFullyBooked && state.data.slots.length > 0 && !state.data.slots.every(s => s.onlineBlocked) && (
              <>
                {state.data.slots.some(s => s.onlineBlocked) && (
                  <div className="mb-3">
                    <StatusBanner
                      icon="○" color="neutral"
                      text={state.data.slots.find(s => s.onlineBlocked && s.guestMessage)?.guestMessage ?? t('booking.partialOnlineBlockedNotice')}
                    />
                  </div>
                )}
                <SlotGrid slots={state.data.slots} onSelect={handleSlotSelect} />
              </>
            )}

            {/* Alternatives */}
            {state.data.alternatives.length > 0 && (
              <div className="mt-6">
                <SectionLabel>
                  {t(state.data.isFullyBooked ? 'booking.nearbyAvailability' : 'booking.otherOptions')}
                </SectionLabel>
                <div className="flex flex-col gap-2 mt-3">
                  {state.data.alternatives.map(alt => (
                    <AlternativeRow
                      key={`${alt.date}-${alt.time}`}
                      alt={alt}
                      onSelect={handleAlternativeSelect}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Waitlist CTA — secondary, shown when fully booked with alternatives */}
            {!state.data.isClosed && !state.data.isPast && state.data.isFullyBooked && state.data.alternatives.length > 0 && (
              <div className="mt-6 pt-5 text-center" style={{ borderTop: '1px solid var(--pub-border-1)' }}>
                <p className="text-[13px] mb-1" style={{ color: 'var(--pub-text-tertiary)' }}>{t('booking.noneWork')}</p>
                <p className="text-[12px] mb-4 leading-relaxed" style={{ color: 'var(--pub-text-muted)' }}>
                  {t('booking.waitlistCta', { date: fmtDateShort(state.date, intlLocale) })}
                </p>
                <button
                  onClick={() => setState({ phase: 'waitlist', date: state.date, partySize: state.partySize, slotsData: state.data })}
                  className="pub-btn pub-btn-secondary"
                >
                  {t('booking.joinWaitlist')}
                </button>
              </div>
            )}
          </GlassCard>
        )}

        {/* Waitlist form */}
        {state.phase === 'waitlist' && (
          <GlassCard>
            <BookingSummaryBar
              date={state.date}
              partySize={state.partySize}
              onBack={() => setState({ phase: 'slots', date: state.date, partySize: state.partySize, data: state.slotsData })}
            />
            <hr className="pub-divider" />
            <div className="mb-5">
              <h3 className="font-semibold mb-1.5" style={{ color: 'var(--pub-text-primary)', fontSize: '17px' }}>{t('booking.waitlistForm.title')}</h3>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--pub-text-tertiary)' }}>
                {t('booking.waitlistForm.description', { date: fmtDateShort(state.date, intlLocale), count: state.partySize })}
              </p>
            </div>
            <WaitlistForm onSubmit={handleJoinWaitlist} />
          </GlassCard>
        )}

        {/* Waitlist success */}
        {state.phase === 'waitlist-success' && (
          <WaitlistSuccessCard result={state.result} />
        )}

        {state.phase === 'details' && (
          <GlassCard>
            <BookingSummaryBar
              date={state.date}
              partySize={state.partySize}
              slot={state.slot}
              onBack={() => setState({ phase: 'slots', date: state.date, partySize: state.partySize,
                data: { date: state.date, partySize: state.partySize, timezone: '', slots: [],
                  isFullyBooked: false, isClosed: false, isPast: false, alternatives: [] } })}
            />
            <hr className="pub-divider" />
            <GuestForm
              form={form}
              onChange={setForm}
              onSubmit={handleSubmit}
            />
          </GlassCard>
        )}

        {state.phase === 'submitting' && (
          <GlassCard>
            <div className="py-14 flex flex-col items-center gap-3" role="status">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" aria-hidden="true" />
              <p className="text-white/40 text-sm">{t('booking.securingTable')}</p>
            </div>
          </GlassCard>
        )}

        {state.phase === 'confirmed' && (
          <ConfirmedCard result={state.result} profile={profile} />
        )}

        {state.phase === 'slot-taken' && (
          <GlassCard>
            <div className="text-center mb-6">
              <div className="pub-outcome-icon pub-outcome-icon--warning" aria-hidden="true">⏱</div>
              <h2 className="text-white text-xl font-semibold mb-2">{t('booking.slotTakenTitle')}</h2>
              <p className="text-white/40 text-sm leading-relaxed">
                {t('booking.slotTakenDetail')}
              </p>
            </div>

            {state.alternatives.length > 0 ? (
              <div className="flex flex-col gap-2">
                {state.alternatives.map(alt => (
                  <AlternativeRow
                    key={`${alt.date}-${alt.time}`}
                    alt={alt}
                    onSelect={handleAlternativeSelect}
                    showDate
                  />
                ))}
              </div>
            ) : (
              <p className="text-white/40 text-sm text-center">{t('booking.noAlternatives')}</p>
            )}

            <button onClick={() => setState({ phase: 'select' })} className="pub-btn pub-btn-bare mt-5">
              {t('booking.chooseDifferentDate')}
            </button>
          </GlassCard>
        )}

        {state.phase === 'error' && (
          <GlassCard>
            <div className="text-center py-4" role="alert">
              <div className="pub-outcome-icon pub-outcome-icon--error" aria-hidden="true">✕</div>
              <h2 className="text-white text-xl font-semibold mb-2">{t('booking.errorTitle')}</h2>
              <p className="text-white/40 text-sm leading-relaxed mb-5">{state.message}</p>
              <button onClick={() => setState({ phase: 'select' })} className="pub-btn pub-btn-secondary">
                {t('booking.tryAgain')}
              </button>
            </div>
          </GlassCard>
        )}

        {state.phase === 'online-blocked' && (
          <GlassCard>
            <div className="text-center py-4" role="alert">
              <div className="pub-outcome-icon pub-outcome-icon--neutral" aria-hidden="true">◌</div>
              <h2 className="text-white text-xl font-semibold mb-2">{t('booking.onlineBlockedTitle')}</h2>
              <p className="text-white/40 text-sm leading-relaxed mb-5">{state.message}</p>
              <button onClick={() => setState({ phase: 'select' })} className="pub-btn pub-btn-secondary">
                {t('booking.chooseDifferentDate')}
              </button>
            </div>
          </GlassCard>
        )}
        </div>{/* /booking card */}
      </div>{/* /hero section */}

      {/* Footer — starts after hero */}
      <PublicFooter
        visible={state.phase !== 'loading' && state.phase !== 'not-found'}
        restaurant={profile ? {
          name:         profile.name,
          address:      profile.address,
          phone:        profile.phone,
          websiteUrl:   profile.websiteUrl,
          instagramUrl: profile.instagramUrl,
          googleMapsUrl: profile.googleMapsUrl,
          wazeUrl:      profile.wazeUrl,
        } : null}
      />
    </div>
  );
}

// ─── Atmospheric background ────────────────────────────────────────────────────

function AtmosphericBg() {
  return (
    <>
      <div className="pub-atm-base" />
      <div className="pub-atm-vignette" />
    </>
  );
}

// ─── Hero identity (logo + name, works with and without cover image) ───────────

function HeroIdentity({ profile }: { profile: PublicRestaurantProfile | null }) {
  const displayName = profile?.name;
  const initial = displayName?.charAt(0).toUpperCase() ?? '◆';

  return (
    <div className="text-center">
      <div className="relative flex items-center justify-center mb-3">
        <div className="absolute rounded-full pointer-events-none" style={{ width: '120px', height: '120px', background: 'radial-gradient(circle, rgba(255,255,255,0.055) 0%, transparent 65%)' }} />
        {profile?.logoUrl ? (
          <div
            className="relative flex items-center justify-center rounded-full backdrop-blur-xl w-[88px] h-[88px] sm:w-20 sm:h-20"
            style={{ background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.80)' }}
          >
            <img src={profile.logoUrl} alt={displayName} className="object-contain h-[46px] sm:h-[42px]" style={{ maxWidth: '62px' }} />
          </div>
        ) : (
          <div
            className="relative rounded-full flex items-center justify-center backdrop-blur-xl select-none w-[88px] h-[88px] sm:w-20 sm:h-20"
            style={{ background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.65)' }}
          >
            <span className="text-white/75 text-2xl font-light">{initial}</span>
          </div>
        )}
      </div>
      {displayName && (
        <h1 className="text-[1.4rem] font-medium tracking-[-0.020em]" style={{ color: '#f2ece0', textShadow: '0 2px 20px rgba(0,0,0,0.70)' }}>{displayName}</h1>
      )}
      {profile?.cuisine && (
        <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{profile.cuisine}</p>
      )}
    </div>
  );
}

// ─── Glass card ────────────────────────────────────────────────────────────────

function GlassCard({ children }: { children: React.ReactNode }) {
  return <div className="pub-card w-full">{children}</div>;
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="pub-section-label">{children}</p>;
}

// ─── Party size selector ───────────────────────────────────────────────────────

function PartySelector({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-5">
      <button
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label={t('common.decreaseParty')}
        disabled={value <= 1}
        className="pub-counter-btn"
      >
        <span aria-hidden="true">−</span>
      </button>
      <div className="flex-1 text-center" dir="ltr" aria-live="polite" aria-atomic="true">
        <span className="text-3xl font-light" style={{ color: 'var(--pub-text-warm)', letterSpacing: 'var(--pub-tracking-tighter)' }}>{value}</span>
        <span className="text-[13px] ms-2" style={{ color: 'var(--pub-text-tertiary)' }}>{t('common.guestWord', { count: value })}</span>
      </div>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={t('common.increaseParty')}
        disabled={value >= max}
        className="pub-counter-btn"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

// ─── Date carousel ─────────────────────────────────────────────────────────────

function DateCarousel({
  profile, selected, onSelect,
}: {
  profile: PublicRestaurantProfile; selected: string; onSelect: (d: string) => void;
}) {
  const { intlLocale } = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft,  setCanScrollLeft]  = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const today = new Date();
  const days: Array<{ dateStr: string; d: Date; isOpen: boolean }> = [];
  for (let i = 0; i < profile.maxAdvanceBookingDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const hours = profile.operatingHours.find(h => h.dayOfWeek === d.getDay());
    days.push({ dateStr: toLocalDateString(d), d, isOpen: !!(hours?.isOpen) });
  }

  function syncScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncScrollState();
    el.addEventListener('scroll', syncScrollState, { passive: true });
    const ro = new ResizeObserver(syncScrollState);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', syncScrollState); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!scrollRef.current || !selected) return;
    const idx = days.findIndex(d => d.dateStr === selected);
    if (idx < 0) return;
    const chip = scrollRef.current.children[idx] as HTMLElement | undefined;
    chip?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function nudge(dir: 'left' | 'right') {
    scrollRef.current?.scrollBy({ left: dir === 'right' ? 240 : -240, behavior: 'smooth' });
  }

  const arrowBase: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(20,24,36,0.72)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    color: 'rgba(255,255,255,0.80)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: 1,
    zIndex: 3,
    paddingBottom: '1px',
    transition: 'background 0.15s',
  } as React.CSSProperties;

  return (
    <div className="relative">
      <style>{`[data-date-carousel]::-webkit-scrollbar{display:none}`}</style>

      {/* Left arrow + fade — always LTR temporal direction */}
      {canScrollLeft && (
        <>
          <div aria-hidden="true" style={{
            position: 'absolute', top: 0, left: 0, bottom: 0, width: '52px',
            pointerEvents: 'none', zIndex: 2,
            background: 'linear-gradient(to left, transparent 0%, rgba(9,12,20,0.95) 100%)',
          }} />
          <button aria-label="Earlier dates" onClick={() => nudge('left')} style={{ ...arrowBase, left: '6px' }}>‹</button>
        </>
      )}

      {/* dir="ltr" keeps chips in left-to-right temporal order even inside RTL page */}
      <div
        ref={scrollRef}
        dir="ltr"
        data-date-carousel=""
        className="flex gap-2 overflow-x-auto pb-1"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          paddingRight: '48px',
        } as React.CSSProperties}
      >
        {days.map(({ dateStr, d, isOpen }) => {
          const isSelected = dateStr === selected;
          return (
            <button
              key={dateStr}
              onClick={() => isOpen && onSelect(dateStr)}
              disabled={!isOpen}
              aria-pressed={isSelected}
              aria-label={`${fmtChipDay(d, intlLocale)} ${d.getDate()} ${fmtChipMonth(d, intlLocale)}`}
              className="flex flex-col items-center shrink-0 rounded-2xl px-3 py-3 transition-all active:scale-95"
              style={{
                minWidth: '52px',
                scrollSnapAlign: 'start',
                background: isSelected ? 'rgb(var(--pub-rgb) / 0.18)' : 'rgba(255,255,255,0.048)',
                border: isSelected ? '1px solid rgb(var(--pub-rgb) / 0.45)' : '1px solid rgba(255,255,255,0.09)',
                opacity: isOpen ? 1 : 0.35,
                cursor: isOpen ? 'pointer' : 'not-allowed',
              }}
            >
              <span
                className="text-[10px] font-medium uppercase tracking-wide mb-1"
                style={{ color: isSelected ? 'var(--pub-brand-text)' : 'rgba(255,255,255,0.40)' }}
              >
                {fmtChipDay(d, intlLocale)}
              </span>
              <span
                className="text-[18px] font-semibold leading-none"
                style={{ color: isSelected ? '#f8f5ef' : 'rgba(255,255,255,0.70)' }}
              >
                {d.getDate()}
              </span>
              <span
                className="text-[10px] mt-1"
                style={{ color: isSelected ? 'rgb(var(--pub-rgb) / 0.70)' : 'rgba(255,255,255,0.30)' }}
              >
                {fmtChipMonth(d, intlLocale)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right arrow + fade */}
      {canScrollRight && (
        <>
          <div aria-hidden="true" style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: '52px',
            pointerEvents: 'none', zIndex: 2,
            background: 'linear-gradient(to right, transparent 0%, rgba(9,12,20,0.96) 100%)',
          }} />
          <button aria-label="Later dates" onClick={() => nudge('right')} style={{ ...arrowBase, right: '6px' }}>›</button>
        </>
      )}
    </div>
  );
}

// ─── Slot grid ─────────────────────────────────────────────────────────────────

function SlotGrid({ slots, onSelect }: { slots: PublicSlot[]; onSelect: (time: string) => void }) {
  const { t } = useTranslation();
  const lunch  = slots.filter(s => s.time < '17:00');
  const dinner = slots.filter(s => s.time >= '17:00');

  if (lunch.length === 0 && dinner.length === 0) return null;

  return (
    <div className="space-y-5">
      {lunch.length > 0 && (
        <div>
          <SectionLabel>{t('booking.lunch')}</SectionLabel>
          <SlotRow slots={lunch} onSelect={onSelect} />
        </div>
      )}
      {dinner.length > 0 && (
        <div>
          <SectionLabel>{t('booking.dinner')}</SectionLabel>
          <SlotRow slots={dinner} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

function SlotRow({ slots, onSelect }: { slots: PublicSlot[]; onSelect: (time: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map(slot => (
        <SlotPill key={slot.time} slot={slot} onSelect={onSelect} />
      ))}
    </div>
  );
}

function SlotPill({ slot, onSelect }: { slot: PublicSlot; onSelect: (time: string) => void }) {
  const { t }      = useTranslation();
  const { isRTL }  = useLocale();
  const tierStyle = {
    IDEAL:   { bg: 'rgba(255,255,255,0.072)', border: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.82)' },
    GOOD:    { bg: 'rgba(255,255,255,0.056)', border: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.65)' },
    LIMITED: { bg: 'rgba(251,191,36,0.09)',   border: 'rgba(251,191,36,0.25)',  color: 'rgba(251,191,36,0.90)' },
  }[slot.tier];

  if (!slot.available) {
    // Online-blocked: no line-through (tables are free — booking is restricted online)
    // Capacity-blocked: line-through (tables are genuinely full)
    const isOnlineBlocked = slot.onlineBlocked === true;
    return (
      <div
        className="text-center rounded-xl py-3 text-[12px]"
        style={{
          background: isOnlineBlocked ? 'rgba(255,255,255,0.012)' : 'rgba(255,255,255,0.018)',
          border:     `1px solid ${isOnlineBlocked ? 'rgba(255,255,255,0.036)' : 'rgba(255,255,255,0.048)'}`,
          color:      'rgba(255,255,255,0.20)',
          textDecoration: isOnlineBlocked ? 'none' : 'line-through',
          cursor: 'default',
        }}
      >
        {fmtTime(slot.time, isRTL)}
      </div>
    );
  }

  const subLabel: string | null =
    slot.tier === 'LIMITED' && slot.softState === 'HIGH_DEMAND' ? t('booking.slots.lastTablePopular') :
    slot.tier === 'LIMITED'                                      ? t('booking.slots.lastTable') :
    slot.softState === 'HIGH_DEMAND'                             ? t('booking.slots.popular') :
    slot.softState === 'SHORT_WINDOW'                            ? t('booking.slots.nearClosing') :
    null;

  const subLabelOpacity =
    slot.tier === 'LIMITED'          ? 0.70 :
    slot.softState === 'HIGH_DEMAND' ? 0.55 :
    0.45;

  return (
    <button
      onClick={() => onSelect(slot.time)}
      className="rounded-xl py-3 text-[13px] font-medium transition-all active:scale-95"
      style={{ background: tierStyle.bg, border: `1px solid ${tierStyle.border}`, color: tierStyle.color }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgb(var(--pub-rgb) / 0.14)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgb(var(--pub-rgb) / 0.38)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = tierStyle.bg; (e.currentTarget as HTMLButtonElement).style.borderColor = tierStyle.border; }}
    >
      <span className="block">{fmtTime(slot.time, isRTL)}</span>
      {subLabel && (
        <span
          className="block text-[9px] mt-0.5 uppercase tracking-wide rtl:tracking-normal"
          style={{ opacity: subLabelOpacity }}
        >
          {subLabel}
        </span>
      )}
    </button>
  );
}

// ─── Alternative row ───────────────────────────────────────────────────────────

function AlternativeRow({
  alt, onSelect, showDate = false,
}: { alt: BookingAlternative; onSelect: (alt: BookingAlternative) => void; showDate?: boolean }) {
  const { isRTL, intlLocale } = useLocale();
  return (
    <button
      onClick={() => onSelect(alt)}
      className="w-full flex items-center justify-between rounded-2xl px-5 py-3.5 transition-all active:scale-[0.98]"
      style={{ background: 'rgba(255,255,255,0.052)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.72)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgb(var(--pub-rgb) / 0.10)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgb(var(--pub-rgb) / 0.30)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.052)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.10)'; }}
    >
      <div className="text-start">
        {showDate && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.42)' }}>{fmtDateShort(alt.date, intlLocale)}</p>
        )}
        <p className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>{fmtTime(alt.time, isRTL)}</p>
        {!showDate && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.38)' }}>{fmtDateShort(alt.date, intlLocale)}</p>
        )}
      </div>
      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '18px' }}>{isRTL ? '‹' : '›'}</span>
    </button>
  );
}

// ─── Booking summary bar ───────────────────────────────────────────────────────

function BookingSummaryBar({
  date, partySize, slot, onBack,
}: { date: string; partySize: number; slot?: string; onBack: () => void }) {
  const { t }              = useTranslation();
  const { isRTL, intlLocale } = useLocale();
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        aria-label={t('common.back')}
        className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all hover:brightness-125"
        style={{ background: 'var(--pub-surface-raised)', border: '1px solid var(--pub-border-2)', color: 'var(--pub-text-muted)' }}
      >
        <span aria-hidden="true">{isRTL ? '›' : '‹'}</span>
      </button>
      <div className="flex-1">
        <p className="text-[13px] font-medium" style={{ color: 'var(--pub-text-secondary)' }}>
          {slot ? `${fmtTime(slot, isRTL)}` : fmtDateShort(date, intlLocale)}
          {slot && <span className="font-light ms-2" style={{ color: 'var(--pub-text-tertiary)' }}>{fmtDateShort(date, intlLocale)}</span>}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--pub-text-muted)' }}>
          {t('common.guestCount', { count: partySize })}
        </p>
      </div>
    </div>
  );
}

// ─── Guest form ────────────────────────────────────────────────────────────────

function GuestForm({ form, onChange, onSubmit }: {
  form: FormState;
  onChange: (f: FormState) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { t } = useTranslation();

  function field(key: keyof FormState, value: string) {
    onChange({ ...form, [key]: value });
  }

  const isValid = form.guestName.trim().length > 0 && form.guestPhone.trim().length >= 3;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <FieldLabel required>{t('booking.form.name')}</FieldLabel>
        <input
          type="text" required autoFocus
          placeholder={t('booking.form.namePlaceholder')}
          value={form.guestName}
          onChange={e => field('guestName', e.target.value)}
          className="pub-input"
        />
      </div>

      <div>
        <FieldLabel required>{t('booking.form.phone')}</FieldLabel>
        <input
          type="tel" required
          placeholder={t('booking.form.phonePlaceholder')}
          value={form.guestPhone}
          onChange={e => field('guestPhone', e.target.value)}
          className="pub-input"
        />
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--pub-text-muted)' }}>
          {t('booking.form.phoneHint')}
        </p>
      </div>

      <div>
        <FieldLabel>{t('booking.form.email')} <span style={{ color: 'var(--pub-text-muted)' }}>({t('booking.form.optional')})</span></FieldLabel>
        <input
          type="email"
          placeholder={t('booking.form.emailPlaceholder')}
          value={form.guestEmail}
          onChange={e => field('guestEmail', e.target.value)}
          className="pub-input"
        />
      </div>

      <div>
        <FieldLabel>{t('booking.form.occasion')} <span style={{ color: 'var(--pub-text-muted)' }}>({t('booking.form.optional')})</span></FieldLabel>
        <div className="flex gap-2 flex-wrap">
          {OCCASIONS.map(({ value, tKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => field('occasion', form.occasion === value ? '' : value)}
              className={`pub-chip transition-all${form.occasion === value ? ' pub-chip--brand' : ''}`}
            >
              {t(tKey)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>{t('booking.form.specialRequests')} <span style={{ color: 'var(--pub-text-muted)' }}>({t('booking.form.optional')})</span></FieldLabel>
        <textarea
          placeholder={t('booking.form.specialRequestsPlaceholder')}
          value={form.guestNotes}
          onChange={e => field('guestNotes', e.target.value)}
          rows={3}
          className="pub-textarea"
        />
      </div>

      <div className="pt-2">
        <PrimaryBtn type="submit" disabled={!isValid}>
          {t('booking.form.completeReservation')}
        </PrimaryBtn>
      </div>
    </form>
  );
}

// ─── Waitlist form ─────────────────────────────────────────────────────────────

function WaitlistForm({ onSubmit }: { onSubmit: (data: WaitlistFormState) => Promise<void> }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<WaitlistFormState>({
    guestName: '', guestPhone: '', preferredTime: '', flexibleTime: false, notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function field<K extends keyof WaitlistFormState>(key: K, value: WaitlistFormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.guestName.trim() || !form.guestPhone.trim() || !form.preferredTime) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const isValid = form.guestName.trim().length > 0 && form.guestPhone.trim().length >= 3 && form.preferredTime.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <FieldLabel required>{t('booking.form.name')}</FieldLabel>
        <input
          type="text" required autoFocus placeholder={t('booking.form.namePlaceholder')}
          value={form.guestName} onChange={e => field('guestName', e.target.value)}
          className="pub-input"
        />
      </div>

      <div>
        <FieldLabel required>{t('booking.form.phone')}</FieldLabel>
        <input
          type="tel" required placeholder={t('booking.form.phonePlaceholder')}
          value={form.guestPhone} onChange={e => field('guestPhone', e.target.value)}
          className="pub-input"
        />
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--pub-text-muted)' }}>
          {t('booking.waitlistForm.phoneHint')}
        </p>
      </div>

      <div>
        <FieldLabel required>{t('booking.waitlistForm.preferredTime')}</FieldLabel>
        <input
          type="time" required
          value={form.preferredTime} onChange={e => field('preferredTime', e.target.value)}
          className="pub-input"
          style={{ colorScheme: 'dark' } as React.CSSProperties}
        />
        <button
          type="button"
          role="switch"
          aria-checked={form.flexibleTime}
          onClick={() => field('flexibleTime', !form.flexibleTime)}
          className="flex items-center gap-2 mt-2.5 transition-all"
        >
          <div className="pub-toggle" />
          <span className="text-[12px]" style={{ color: form.flexibleTime ? 'var(--pub-brand-text)' : 'var(--pub-text-muted)' }}>
            {t('booking.waitlistForm.flexibleLabel')}
          </span>
        </button>
      </div>

      <div>
        <FieldLabel>{t('booking.waitlistForm.notes')} <span style={{ color: 'var(--pub-text-muted)' }}>({t('booking.form.optional')})</span></FieldLabel>
        <textarea
          placeholder={t('booking.waitlistForm.notesPlaceholder')}
          value={form.notes} onChange={e => field('notes', e.target.value)}
          rows={3}
          className="pub-textarea"
        />
      </div>

      {error && <p className="pub-alert pub-alert--error" role="alert">{error}</p>}

      <div className="pt-2">
        <PrimaryBtn type="submit" disabled={!isValid} loading={loading}>
          {loading ? t('booking.waitlistForm.submitLoading') : t('booking.waitlistForm.submit')}
        </PrimaryBtn>
      </div>
    </form>
  );
}

// ─── Waitlist success card ─────────────────────────────────────────────────────

function WaitlistSuccessCard({ result }: { result: PublicWaitlistResult }) {
  const { t }                  = useTranslation();
  const { isRTL, intlLocale }  = useLocale();
  return (
    <GlassCard>
      <div className="text-center mb-7">
        <div className="pub-outcome-icon pub-outcome-icon--neutral" aria-hidden="true">◎</div>
        <h2 className="text-white text-2xl font-semibold tracking-tight mb-2">
          {t('booking.waitlistSuccess.title')}
        </h2>
        <p className="text-white/40 text-sm leading-relaxed px-3">
          {t('booking.waitlistSuccess.detail')}
        </p>
      </div>

      <div className="pub-inset mb-6">
        <div className="pub-detail-row">
          <span className="pub-detail-row__label">{t('booking.waitlistSuccess.dateLabel')}</span>
          <span className="pub-detail-row__value">{fmtDateLong(result.date, intlLocale)}</span>
        </div>
        <div className="pub-detail-row">
          <span className="pub-detail-row__label">{t('booking.waitlistSuccess.partyLabel')}</span>
          <span className="pub-detail-row__value">{t('common.guestCount', { count: result.partySize })}</span>
        </div>
        <div className="pub-detail-row">
          <span className="pub-detail-row__label">{t('booking.waitlistSuccess.preferredTimeLabel')}</span>
          <span className="pub-detail-row__value">{fmtTime(result.preferredTime, isRTL)}</span>
        </div>
      </div>

      <p className="text-center text-[12px]" style={{ color: 'var(--pub-text-micro)' }}>
        {t('booking.waitlistSuccess.phoneSent')}
      </p>
    </GlassCard>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="pub-field-label">
      {children}{required && <span className="pub-required"> *</span>}
    </label>
  );
}

// ─── Confirmed card ────────────────────────────────────────────────────────────

function ConfirmedCard({ result, profile }: { result: BookingResult; profile: PublicRestaurantProfile | null }) {
  const { t }                  = useTranslation();
  const { isRTL, intlLocale }  = useLocale();
  return (
    <GlassCard>
      {/* Confirmation icon */}
      <div className="text-center mb-5">
        <div className="pub-outcome-icon pub-outcome-icon--brand" aria-hidden="true">✓</div>
        <h2 className="text-white text-2xl font-semibold tracking-tight mb-1.5">
          {t('booking.confirmed.title')}
        </h2>
        <p className="text-[13px]" style={{ color: 'var(--pub-text-tertiary)' }}>
          {t(result.status === 'CONFIRMED' ? 'booking.confirmed.confirmedSub' : 'booking.confirmed.pendingSub')}
        </p>
      </div>

      {/* Ceremonial date display — open air, no bounding box */}
      <div
        className="text-center py-6 mb-5"
        style={{ borderTop: '1px solid var(--pub-border-0)', borderBottom: '1px solid var(--pub-border-0)' }}
      >
        <p
          className="text-[10px] font-medium uppercase tracking-[0.22em] rtl:tracking-normal mb-3"
          style={{ color: 'var(--pub-text-muted)' }}
        >
          {fmtDateLong(result.date, intlLocale)}
        </p>
        <p
          className="font-light leading-none mb-4"
          style={{ fontSize: 'clamp(2.2rem, 7vw, 2.8rem)', letterSpacing: '-0.035em', color: 'var(--pub-text-warm)' }}
        >
          {fmtTime(result.time, isRTL)}
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <span className="pub-chip">{t('common.guestCount', { count: result.partySize })}</span>
          {result.status === 'PENDING' && (
            <span className="pub-chip pub-chip--warning">{t('booking.confirmed.pendingBadge')}</span>
          )}
        </div>
      </div>

      {profile?.address && (
        <div className="text-center mb-2">
          <p className="text-[13px] leading-relaxed mb-3" style={{ color: 'var(--pub-text-secondary)' }}>
            {profile.address}
          </p>
          <div className="flex gap-3 justify-center">
            {profile.googleMapsUrl && (
              <NavPill href={profile.googleMapsUrl} icon={<PinIcon />} label={t('common.maps')} />
            )}
            {profile.wazeUrl && (
              <NavPill href={profile.wazeUrl} icon={<CarIcon />} label={t('common.waze')} />
            )}
          </div>
        </div>
      )}

      <p className="text-center text-[12px] mt-5" style={{ color: 'var(--pub-text-micro)' }}>
        {t('booking.confirmed.phoneSent')}
      </p>
    </GlassCard>
  );
}

// ─── Nav pills ─────────────────────────────────────────────────────────────────

function NavPill({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" dir="ltr" className="pub-nav-pill">
      {icon} {label}
    </a>
  );
}

// ─── Primary button ────────────────────────────────────────────────────────────

function PrimaryBtn({ onClick, children, disabled, loading, type = 'button' }: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="pub-btn pub-btn-primary">
      {loading ? (
        <>
          <span className="w-4 h-4 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : children}
    </button>
  );
}

// ─── Status banner ─────────────────────────────────────────────────────────────

function StatusBanner({ icon, color, text }: { icon: string; color: 'red' | 'amber' | 'neutral'; text: string }) {
  const mod = color === 'red' ? 'error' : color === 'amber' ? 'warning' : 'neutral';
  return (
    <div className={`pub-banner pub-banner--${mod}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ─── SVG icons ─────────────────────────────────────────────────────────────────

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
