import { useState, useEffect, useRef } from 'react';
import type { PublicRestaurantProfile, PublicSlot, AvailabilityResponse, BookingAlternative, BookingResult, PublicWaitlistResult } from '../types';
import { api, ApiError } from '../api';

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
  | { phase: 'slot-taken'; alternatives: BookingAlternative[] }
  | { phase: 'error';      message: string }
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

const OCCASIONS = ['Birthday', 'Anniversary', 'Business', 'Date Night', 'Other'];

// ─── Formatting helpers ────────────────────────────────────────────────────────

const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fmt12(t: string): string {
  const [h, min] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${period}`;
}

function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAY_NAMES[dt.getDay()]}, ${MONTH_NAMES[dt.getMonth()]} ${d}`;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function BookingPage({ slug }: Props) {
  const [profile,  setProfile]  = useState<PublicRestaurantProfile | null>(null);
  const [state,    setState]    = useState<BookingPhase>({ phase: 'loading' });
  const [mounted,  setMounted]  = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [form,     setForm]     = useState<FormState>({
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
        // Pre-select today or first open day
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
      });
      setState({ phase: 'confirmed', result });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') {
        const details = err.details as { alternatives?: BookingAlternative[] } | undefined;
        setState({ phase: 'slot-taken', alternatives: details?.alternatives ?? [] });
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
    });
    setState({ phase: 'waitlist-success', result });
  }

  const fade = (delay: number) => ({
    className: `transition-all duration-500 ease-out ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`,
    style: { transitionDelay: `${delay}ms` } as React.CSSProperties,
  });

  const hasCover = !!profile?.coverImageUrl;

  return (
    <div className="relative min-h-screen flex flex-col items-center overflow-x-hidden" style={{ paddingBottom: 'clamp(24px, 5vh, 64px)' }}>
      <AtmosphericBg />

      {/* Restaurant hero */}
      <div className={`w-full ${fade(0).className}`} style={fade(0).style}>
        {hasCover && profile ? (
          <BookingCoverHero profile={profile} />
        ) : (
          <div className="pt-10 px-4 w-full flex flex-col items-center">
            <div className="w-full max-w-[500px]">
              <BookingHeroFallback profile={profile} />
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div
        className={`w-full max-w-[500px] px-4 ${hasCover ? '-mt-16 relative z-10' : ''} ${fade(80).className}`}
        style={fade(80).style}
      >
        {state.phase === 'loading' && (
          <GlassCard>
            <div className="py-14 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            </div>
          </GlassCard>
        )}

        {state.phase === 'not-found' && (
          <GlassCard>
            <div className="py-6 text-center">
              <p className="text-white/80 text-lg font-medium mb-2">Restaurant not found</p>
              <p className="text-white/40 text-sm">This booking link may be invalid or the restaurant is no longer active.</p>
            </div>
          </GlassCard>
        )}

        {(state.phase === 'select' || state.phase === 'slots-loading') && profile && (
          <GlassCard>
            <SectionLabel>Party size</SectionLabel>
            <PartySelector
              value={partySize}
              max={profile.maxPartySize}
              onChange={setPartySize}
            />

            <div className="h-px" style={{ margin: 'clamp(14px, 2.5vh, 24px) 0', background: 'rgba(255,255,255,0.055)' }} />

            <SectionLabel>Select a date</SectionLabel>
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
                {state.phase === 'slots-loading' ? 'Checking availability…' : 'Find a table'}
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

            <div className="h-px" style={{ margin: 'clamp(12px, 2vh, 20px) 0', background: 'rgba(255,255,255,0.055)' }} />

            {state.data.isClosed && (
              <StatusBanner icon="✕" color="red" text={`${fmtDateShort(state.date)} — closed`} />
            )}

            {state.data.isPast && (
              <StatusBanner icon="⏎" color="amber" text="That date has passed" />
            )}

            {/* Fully booked with no alternatives → premium dead-end avoidance */}
            {!state.data.isClosed && !state.data.isPast && state.data.isFullyBooked && state.data.alternatives.length === 0 && (
              <div className="py-2 text-center">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', fontSize: '22px', color: 'rgba(255,255,255,0.30)' }}
                >
                  ◌
                </div>
                <h3 className="font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '16px' }}>
                  No tables available
                </h3>
                <p className="text-[13px] leading-relaxed mb-6 px-4" style={{ color: 'rgba(255,255,255,0.38)' }}>
                  {fmtDateShort(state.date)} is fully booked for {state.partySize} {state.partySize === 1 ? 'guest' : 'guests'}.
                  Join the waitlist and we'll reach out if something opens up.
                </p>
                <PrimaryBtn onClick={() => setState({ phase: 'waitlist', date: state.date, partySize: state.partySize, slotsData: state.data })}>
                  Join the waitlist
                </PrimaryBtn>
              </div>
            )}

            {/* Available slots */}
            {!state.data.isFullyBooked && state.data.slots.length === 0 && !state.data.isClosed && !state.data.isPast && (
              <StatusBanner icon="○" color="neutral" text="No times available for this date" />
            )}
            {!state.data.isFullyBooked && state.data.slots.length > 0 && (
              <SlotGrid slots={state.data.slots} onSelect={handleSlotSelect} />
            )}

            {/* Alternatives */}
            {state.data.alternatives.length > 0 && (
              <div className="mt-6">
                <SectionLabel>
                  {state.data.isFullyBooked ? 'Nearby availability' : 'Other options'}
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
              <div className="mt-6 pt-5 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}>
                <p className="text-[13px] mb-1" style={{ color: 'rgba(255,255,255,0.52)' }}>None of these work?</p>
                <p className="text-[12px] mb-4 leading-relaxed" style={{ color: 'rgba(255,255,255,0.32)' }}>
                  Join the waitlist — we'll contact you if a table opens up for {fmtDateShort(state.date)}.
                </p>
                <button
                  onClick={() => setState({ phase: 'waitlist', date: state.date, partySize: state.partySize, slotsData: state.data })}
                  className="w-full rounded-[18px] text-[14px] font-medium transition-all active:scale-[0.98]"
                  style={{ padding: '13px 24px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.72)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
                >
                  Join the waitlist
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
            <div className="h-px" style={{ margin: 'clamp(12px, 2vh, 20px) 0', background: 'rgba(255,255,255,0.055)' }} />
            <div className="mb-5">
              <h3 className="font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.88)', fontSize: '17px' }}>Join the waitlist</h3>
              <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.40)' }}>
                We'll reach out if a table becomes available on {fmtDateShort(state.date)} for {state.partySize} {state.partySize === 1 ? 'guest' : 'guests'}.
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
            <div className="h-px" style={{ margin: 'clamp(12px, 2vh, 20px) 0', background: 'rgba(255,255,255,0.055)' }} />
            <GuestForm
              form={form}
              onChange={setForm}
              onSubmit={handleSubmit}
            />
          </GlassCard>
        )}

        {state.phase === 'submitting' && (
          <GlassCard>
            <div className="py-14 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
              <p className="text-white/40 text-sm">Securing your table…</p>
            </div>
          </GlassCard>
        )}

        {state.phase === 'confirmed' && (
          <ConfirmedCard result={state.result} profile={profile} />
        )}

        {state.phase === 'slot-taken' && (
          <GlassCard>
            <div className="text-center mb-6">
              <div
                className="w-[64px] h-[64px] rounded-full flex items-center justify-center text-2xl mx-auto mb-4"
                style={{ background: 'rgba(251,191,36,0.12)', border: '1.5px solid rgba(251,191,36,0.30)', color: '#fbbf24' }}
              >
                ⏱
              </div>
              <h2 className="text-white text-xl font-semibold mb-2">That time just filled up</h2>
              <p className="text-white/40 text-sm leading-relaxed">
                Another guest booked that slot a moment ago. Here are the next available times:
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
              <p className="text-white/40 text-sm text-center">No alternatives found. Please try a different date.</p>
            )}

            <button
              onClick={() => setState({ phase: 'select' })}
              className="w-full mt-5 text-center text-[13px] py-2.5 transition-colors"
              style={{ color: 'rgba(255,255,255,0.50)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.75)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.50)'; }}
            >
              Choose a different date
            </button>
          </GlassCard>
        )}

        {state.phase === 'error' && (
          <GlassCard>
            <div className="text-center py-4">
              <div
                className="w-[64px] h-[64px] rounded-full flex items-center justify-center text-2xl mx-auto mb-4"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1.5px solid rgba(239,68,68,0.25)', color: '#f87171' }}
              >
                ✕
              </div>
              <h2 className="text-white text-xl font-semibold mb-2">Something went wrong</h2>
              <p className="text-white/40 text-sm leading-relaxed mb-5">{state.message}</p>
              <button
                onClick={() => setState({ phase: 'select' })}
                className="text-[13px] py-2.5 px-5 rounded-full transition-colors"
                style={{ color: 'rgba(255,255,255,0.60)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                Try again
              </button>
            </div>
          </GlassCard>
        )}
      </div>

      {/* Footer */}
      {state.phase !== 'loading' && state.phase !== 'not-found' && (
        <div className={`mt-6 ${fade(200).className}`} style={fade(200).style}>
          <p className="text-white/[0.14] text-[10px] tracking-widest uppercase text-center">
            Powered by Iron Booking
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Atmospheric background ────────────────────────────────────────────────────

function AtmosphericBg() {
  return (
    <>
      <div
        className="fixed inset-0 -z-20"
        style={{
          background: [
            'radial-gradient(ellipse 140% 55% at 50% -15%, rgba(34,197,94,0.09) 0%, transparent 50%)',
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

// ─── Cover image hero ──────────────────────────────────────────────────────────

function BookingCoverHero({ profile }: { profile: PublicRestaurantProfile }) {
  const displayName = profile.name;
  const initial = displayName.charAt(0).toUpperCase();

  // Hero and logo scale down on short viewports; tall screens keep full cinematic height
  const heroH     = 'min(320px, 44vh)';
  const discS     = 'min(80px, 11.5vh)';
  const logoH     = 'min(42px, 6.2vh)';
  const bottomPos = 'min(72px, 10.5vh)';

  return (
    <div className="relative w-full" style={{ height: heroH }}>
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={profile.coverImageUrl!}
          alt=""
          className="w-full h-full object-cover"
          style={{ transform: 'scale(1.04)', transformOrigin: 'center 40%' }}
        />
      </div>
      <div
        className="absolute inset-0"
        style={{
          background: [
            'linear-gradient(to bottom,',
            '  rgba(9,12,18,0.10) 0%,',
            '  rgba(9,12,18,0.30) 35%,',
            '  rgba(9,12,18,0.72) 65%,',
            '  rgba(9,12,18,1.00) 100%)',
          ].join(' '),
        }}
      />
      {/* Bleed */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          bottom: '-64px', height: '128px',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(9,12,18,0.55) 50%, rgba(9,12,18,0.92) 100%)',
        }}
      />
      <div className="absolute left-0 right-0 flex flex-col items-center px-5" style={{ bottom: bottomPos }}>
        <div className="relative flex items-center justify-center mb-3">
          <div className="absolute rounded-full pointer-events-none" style={{ width: '120px', height: '120px', background: 'radial-gradient(circle, rgba(255,255,255,0.055) 0%, transparent 65%)' }} />
          {profile.logoUrl ? (
            <div
              className="relative flex items-center justify-center rounded-full backdrop-blur-xl"
              style={{ width: discS, height: discS, background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.80)' }}
            >
              <img src={profile.logoUrl} alt={displayName} className="object-contain" style={{ height: logoH, maxWidth: '62px' }} />
            </div>
          ) : (
            <div
              className="relative rounded-full flex items-center justify-center backdrop-blur-xl select-none"
              style={{ width: discS, height: discS, background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.80)' }}
            >
              <span className="text-white/75 text-2xl font-light">{initial}</span>
            </div>
          )}
        </div>
        <h1 className="text-[1.3rem] font-medium tracking-[-0.018em] text-center" style={{ color: '#f2ece0', textShadow: '0 2px 20px rgba(0,0,0,0.80)' }}>
          {displayName}
        </h1>
        {profile.cuisine && (
          <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{profile.cuisine}</p>
        )}
      </div>
    </div>
  );
}

// ─── Gradient hero (no cover image) ───────────────────────────────────────────

function BookingHeroFallback({ profile }: { profile: PublicRestaurantProfile | null }) {
  const displayName = profile?.name;
  const initial = displayName?.charAt(0).toUpperCase() ?? '◆';

  return (
    <div className="text-center mb-5">
      <div className="relative flex items-center justify-center mb-3">
        <div className="absolute rounded-full pointer-events-none" style={{ width: '120px', height: '120px', background: 'radial-gradient(circle, rgba(255,255,255,0.045) 0%, rgba(34,197,94,0.03) 50%, transparent 70%)' }} />
        {profile?.logoUrl ? (
          <img src={profile.logoUrl} alt={displayName} className="relative object-contain" style={{ height: '64px', maxWidth: '200px' }} />
        ) : (
          <div className="relative rounded-full flex items-center justify-center backdrop-blur-xl select-none" style={{ width: '80px', height: '80px', background: 'linear-gradient(145deg, rgba(16,20,34,0.72) 0%, rgba(6,8,16,0.82) 100%)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.65)' }}>
            <span className="text-white/75 text-2xl font-light">{initial}</span>
          </div>
        )}
      </div>
      {displayName && (
        <h1 className="text-[1.4rem] font-medium tracking-[-0.020em]" style={{ color: '#f2ece0' }}>{displayName}</h1>
      )}
      {profile?.cuisine && (
        <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.42)' }}>{profile.cuisine}</p>
      )}
    </div>
  );
}

// ─── Glass card ────────────────────────────────────────────────────────────────

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full rounded-[28px] backdrop-blur-[100px]"
      style={{
        padding: 'clamp(20px, 3.5vh, 28px)',
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

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.20em] mb-3" style={{ color: 'rgba(255,255,255,0.28)' }}>
      {children}
    </p>
  );
}

// ─── Party size selector ───────────────────────────────────────────────────────

function PartySelector({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-5">
      <button
        onClick={() => onChange(Math.max(1, value - 1))}
        className="w-11 h-11 rounded-full flex items-center justify-center text-lg transition-all active:scale-95"
        style={{ background: 'rgba(255,255,255,0.068)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.70)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.068)'; }}
      >
        −
      </button>
      <div className="flex-1 text-center">
        <span className="text-3xl font-light" style={{ color: '#f8f5ef', letterSpacing: '-0.03em' }}>{value}</span>
        <span className="text-[13px] ml-2" style={{ color: 'rgba(255,255,255,0.40)' }}>{value === 1 ? 'guest' : 'guests'}</span>
      </div>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-11 h-11 rounded-full flex items-center justify-center text-lg transition-all active:scale-95"
        style={{ background: 'rgba(255,255,255,0.068)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.70)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.068)'; }}
      >
        +
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

  // Track scroll edges so arrows show/hide correctly
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncScrollState();
    el.addEventListener('scroll', syncScrollState, { passive: true });
    const ro = new ResizeObserver(syncScrollState);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', syncScrollState); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll selected into view on mount
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

      {/* Left arrow + fade */}
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

      <div
        ref={scrollRef}
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
              className="flex flex-col items-center shrink-0 rounded-2xl px-3 py-3 transition-all active:scale-95"
              style={{
                minWidth: '52px',
                scrollSnapAlign: 'start',
                background: isSelected
                  ? 'rgba(34,197,94,0.18)'
                  : 'rgba(255,255,255,0.048)',
                border: isSelected
                  ? '1px solid rgba(34,197,94,0.45)'
                  : '1px solid rgba(255,255,255,0.09)',
                opacity: isOpen ? 1 : 0.35,
                cursor: isOpen ? 'pointer' : 'not-allowed',
              }}
            >
              <span
                className="text-[10px] font-medium uppercase tracking-wide mb-1"
                style={{ color: isSelected ? 'rgba(74,222,128,0.90)' : 'rgba(255,255,255,0.40)' }}
              >
                {DAY_NAMES[d.getDay()]}
              </span>
              <span
                className="text-[18px] font-semibold leading-none"
                style={{ color: isSelected ? '#f8f5ef' : 'rgba(255,255,255,0.70)' }}
              >
                {d.getDate()}
              </span>
              <span
                className="text-[10px] mt-1"
                style={{ color: isSelected ? 'rgba(74,222,128,0.70)' : 'rgba(255,255,255,0.30)' }}
              >
                {MONTH_NAMES[d.getMonth()]}
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
  const lunch  = slots.filter(s => s.time < '17:00');
  const dinner = slots.filter(s => s.time >= '17:00');

  if (lunch.length === 0 && dinner.length === 0) return null;

  return (
    <div className="space-y-5">
      {lunch.length > 0 && (
        <div>
          <SectionLabel>Lunch</SectionLabel>
          <SlotRow slots={lunch} onSelect={onSelect} />
        </div>
      )}
      {dinner.length > 0 && (
        <div>
          <SectionLabel>Dinner</SectionLabel>
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
  const tierStyle = {
    IDEAL:   { bg: 'rgba(255,255,255,0.072)', border: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.82)' },
    GOOD:    { bg: 'rgba(255,255,255,0.056)', border: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.65)' },
    LIMITED: { bg: 'rgba(251,191,36,0.09)',   border: 'rgba(251,191,36,0.25)',  color: 'rgba(251,191,36,0.90)' },
  }[slot.tier];

  if (!slot.available) {
    return (
      <div
        className="text-center rounded-xl py-3 text-[12px]"
        style={{ background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.048)', color: 'rgba(255,255,255,0.22)', textDecoration: 'line-through' }}
      >
        {fmt12(slot.time)}
      </div>
    );
  }

  // Sub-label: LIMITED takes visual priority; soft states are ambient-only
  const subLabel: string | null =
    slot.tier === 'LIMITED' && slot.softState === 'HIGH_DEMAND' ? 'Last table · Popular' :
    slot.tier === 'LIMITED'                                      ? 'Last table' :
    slot.softState === 'HIGH_DEMAND'                             ? 'Popular' :
    slot.softState === 'SHORT_WINDOW'                            ? 'Near closing' :
    null;

  const subLabelOpacity =
    slot.tier === 'LIMITED'          ? 0.70 :
    slot.softState === 'HIGH_DEMAND' ? 0.55 :
    0.45;  // SHORT_WINDOW

  return (
    <button
      onClick={() => onSelect(slot.time)}
      className="rounded-xl py-3 text-[13px] font-medium transition-all active:scale-95"
      style={{ background: tierStyle.bg, border: `1px solid ${tierStyle.border}`, color: tierStyle.color }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.14)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(34,197,94,0.38)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = tierStyle.bg; (e.currentTarget as HTMLButtonElement).style.borderColor = tierStyle.border; }}
    >
      <span className="block">{fmt12(slot.time)}</span>
      {subLabel && (
        <span
          className="block text-[9px] mt-0.5 uppercase tracking-wide"
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
  return (
    <button
      onClick={() => onSelect(alt)}
      className="w-full flex items-center justify-between rounded-2xl px-5 py-3.5 transition-all active:scale-[0.98]"
      style={{ background: 'rgba(255,255,255,0.052)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.72)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.10)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(34,197,94,0.30)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.052)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.10)'; }}
    >
      <div className="text-left">
        {showDate && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.42)' }}>{fmtDateShort(alt.date)}</p>
        )}
        <p className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>{fmt12(alt.time)}</p>
        {!showDate && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.38)' }}>{fmtDateShort(alt.date)}</p>
        )}
      </div>
      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '18px' }}>›</span>
    </button>
  );
}

// ─── Booking summary bar ───────────────────────────────────────────────────────

function BookingSummaryBar({
  date, partySize, slot, onBack,
}: { date: string; partySize: number; slot?: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-all"
        style={{ background: 'rgba(255,255,255,0.058)', border: '1px solid rgba(255,255,255,0.11)', color: 'rgba(255,255,255,0.55)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.90)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)'; }}
      >
        ‹
      </button>
      <div className="flex-1">
        <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.80)' }}>
          {slot ? `${fmt12(slot)}` : fmtDateShort(date)}
          {slot && <span className="font-light ml-2" style={{ color: 'rgba(255,255,255,0.42)' }}>{fmtDateShort(date)}</span>}
        </p>
        <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.38)' }}>
          {partySize} {partySize === 1 ? 'guest' : 'guests'}
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
  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.040)',
    border: '1px solid rgba(255,255,255,0.095)',
    borderRadius: '14px',
    padding: '14px 16px',
    color: 'rgba(255,255,255,0.88)',
    fontSize: '15px',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  function field(key: keyof FormState, value: string) {
    onChange({ ...form, [key]: value });
  }

  const isValid = form.guestName.trim().length > 0 && form.guestPhone.trim().length >= 3;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <FieldLabel required>Name</FieldLabel>
        <input
          type="text"
          required
          autoFocus
          placeholder="Your full name"
          value={form.guestName}
          onChange={e => field('guestName', e.target.value)}
          style={inputStyle}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
      </div>

      <div>
        <FieldLabel required>Phone</FieldLabel>
        <input
          type="tel"
          required
          placeholder="+1 (555) 000-0000"
          value={form.guestPhone}
          onChange={e => field('guestPhone', e.target.value)}
          style={inputStyle}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
        <p className="text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.32)' }}>
          Your confirmation will be sent here
        </p>
      </div>

      <div>
        <FieldLabel>Email <span style={{ color: 'rgba(255,255,255,0.28)' }}>(optional)</span></FieldLabel>
        <input
          type="email"
          placeholder="you@example.com"
          value={form.guestEmail}
          onChange={e => field('guestEmail', e.target.value)}
          style={inputStyle}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
      </div>

      <div>
        <FieldLabel>Occasion <span style={{ color: 'rgba(255,255,255,0.28)' }}>(optional)</span></FieldLabel>
        <div className="flex gap-2 flex-wrap">
          {OCCASIONS.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => field('occasion', form.occasion === o ? '' : o)}
              className="text-[12px] px-3.5 py-1.5 rounded-full transition-all"
              style={{
                background: form.occasion === o ? 'rgba(34,197,94,0.16)' : 'rgba(255,255,255,0.048)',
                border: form.occasion === o ? '1px solid rgba(34,197,94,0.40)' : '1px solid rgba(255,255,255,0.095)',
                color: form.occasion === o ? 'rgba(74,222,128,0.90)' : 'rgba(255,255,255,0.52)',
              }}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>Special requests <span style={{ color: 'rgba(255,255,255,0.28)' }}>(optional)</span></FieldLabel>
        <textarea
          placeholder="Allergies, accessibility needs, seating preferences…"
          value={form.guestNotes}
          onChange={e => field('guestNotes', e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }}
          onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLTextAreaElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
      </div>

      <div className="pt-2">
        <PrimaryBtn type="submit" disabled={!isValid}>
          Complete reservation
        </PrimaryBtn>
      </div>
    </form>
  );
}

// ─── Waitlist form ─────────────────────────────────────────────────────────────

function WaitlistForm({ onSubmit }: { onSubmit: (data: WaitlistFormState) => Promise<void> }) {
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

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.040)', border: '1px solid rgba(255,255,255,0.095)',
    borderRadius: '14px', padding: '14px 16px', color: 'rgba(255,255,255,0.88)',
    fontSize: '15px', width: '100%', outline: 'none', transition: 'border-color 0.2s',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <FieldLabel required>Name</FieldLabel>
        <input
          type="text" required autoFocus placeholder="Your full name"
          value={form.guestName} onChange={e => field('guestName', e.target.value)}
          style={inputStyle}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
      </div>

      <div>
        <FieldLabel required>Phone</FieldLabel>
        <input
          type="tel" required placeholder="+1 (555) 000-0000"
          value={form.guestPhone} onChange={e => field('guestPhone', e.target.value)}
          style={inputStyle}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
        <p className="text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.32)' }}>
          We'll reach out here if a table becomes available
        </p>
      </div>

      <div>
        <FieldLabel required>Preferred time</FieldLabel>
        <input
          type="time" required
          value={form.preferredTime} onChange={e => field('preferredTime', e.target.value)}
          style={{ ...inputStyle, colorScheme: 'dark' } as React.CSSProperties}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
        {/* Flexibility toggle */}
        <button
          type="button"
          onClick={() => field('flexibleTime', !form.flexibleTime)}
          className="flex items-center gap-2 mt-2.5 transition-all"
        >
          <div
            className="w-8 h-4 rounded-full relative shrink-0 transition-all"
            style={{
              background: form.flexibleTime ? 'rgba(34,197,94,0.28)' : 'rgba(255,255,255,0.08)',
              border: form.flexibleTime ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(255,255,255,0.10)',
            }}
          >
            <div
              className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
              style={{
                background: form.flexibleTime ? '#4ade80' : 'rgba(255,255,255,0.35)',
                left: form.flexibleTime ? '18px' : '2px',
              }}
            />
          </div>
          <span className="text-[12px]" style={{ color: form.flexibleTime ? 'rgba(74,222,128,0.85)' : 'rgba(255,255,255,0.38)' }}>
            Flexible ±1 hour
          </span>
        </button>
      </div>

      <div>
        <FieldLabel>Notes <span style={{ color: 'rgba(255,255,255,0.28)' }}>(optional)</span></FieldLabel>
        <textarea
          placeholder="Any preferences or requests…"
          value={form.notes} onChange={e => field('notes', e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }}
          onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'rgba(34,197,94,0.50)'; }}
          onBlur={e =>  { (e.target as HTMLTextAreaElement).style.borderColor = 'rgba(255,255,255,0.095)'; }}
        />
      </div>

      {error && <p className="text-red-400/80 text-[13px] text-center">{error}</p>}

      <div className="pt-2">
        <PrimaryBtn type="submit" disabled={!isValid} loading={loading}>
          {loading ? 'Joining waitlist…' : 'Join the waitlist'}
        </PrimaryBtn>
      </div>
    </form>
  );
}

// ─── Waitlist success card ─────────────────────────────────────────────────────

function WaitlistSuccessCard({ result }: { result: PublicWaitlistResult }) {
  return (
    <GlassCard>
      <div className="text-center mb-7">
        <div
          className="w-[68px] h-[68px] rounded-full flex items-center justify-center text-2xl mx-auto mb-5"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.55)' }}
        >
          ◎
        </div>
        <h2 className="text-white text-2xl font-semibold tracking-tight mb-2">
          You're on the waitlist
        </h2>
        <p className="text-white/40 text-sm leading-relaxed px-3">
          We'll reach out if a table becomes available. Thank you for your patience.
        </p>
      </div>

      <div
        className="rounded-2xl px-5 py-4 mb-6"
        style={{ background: 'rgba(255,255,255,0.038)', border: '1px solid rgba(255,255,255,0.075)' }}
      >
        <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Date</span>
          <span className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.80)' }}>{fmtDateLong(result.date)}</span>
        </div>
        <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Party</span>
          <span className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.80)' }}>{result.partySize} {result.partySize === 1 ? 'guest' : 'guests'}</span>
        </div>
        <div className="flex justify-between items-center py-1.5">
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Preferred time</span>
          <span className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.80)' }}>{fmt12(result.preferredTime)}</span>
        </div>
      </div>

      <p className="text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
        A confirmation has been sent to your phone.
      </p>
    </GlassCard>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-medium uppercase tracking-[0.14em] mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
      {children}{required && <span style={{ color: 'rgba(74,222,128,0.60)' }}> *</span>}
    </label>
  );
}

// ─── Confirmed card ────────────────────────────────────────────────────────────

function ConfirmedCard({ result, profile }: { result: BookingResult; profile: PublicRestaurantProfile | null }) {
  return (
    <GlassCard>
      <div className="text-center mb-7">
        <div
          className="w-[68px] h-[68px] rounded-full flex items-center justify-center text-2xl mx-auto mb-5"
          style={{ background: 'rgba(34,197,94,0.12)', border: '1.5px solid rgba(34,197,94,0.30)', boxShadow: '0 0 48px rgba(34,197,94,0.12)', color: '#4ade80' }}
        >
          ✓
        </div>
        <h2 className="text-white text-2xl font-semibold tracking-tight mb-1">
          You're on the list
        </h2>
        <p className="text-white/40 text-sm">
          {result.status === 'CONFIRMED'
            ? 'Your table is confirmed.'
            : 'We\'ll confirm your reservation shortly.'}
        </p>
      </div>

      {/* Booking summary */}
      <div
        className="rounded-2xl px-5 py-4 mb-6 text-center"
        style={{ background: 'rgba(255,255,255,0.038)', border: '1px solid rgba(255,255,255,0.075)' }}
      >
        <p className="text-white/28 text-[10px] font-medium uppercase tracking-[0.18em] mb-1">
          {fmtDateLong(result.date)}
        </p>
        <p className="text-white text-[2rem] font-light leading-none mb-2" style={{ letterSpacing: '-0.03em' }}>
          {fmt12(result.time)}
        </p>
        <p className="text-white/45 text-[14px]">
          {result.partySize} {result.partySize === 1 ? 'guest' : 'guests'}
          {result.status === 'PENDING' && (
            <span className="ml-2 text-amber-400/80">· Pending confirmation</span>
          )}
        </p>
      </div>

      {/* Navigation chips if address available */}
      {profile?.address && (
        <div className="text-center mb-2">
          <p className="text-[13px] leading-relaxed mb-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {profile.address}
          </p>
          <div className="flex gap-3 justify-center">
            {profile.googleMapsUrl && (
              <NavPill href={profile.googleMapsUrl} icon={<PinIcon />} label="Maps" />
            )}
            {profile.wazeUrl && (
              <NavPill href={profile.wazeUrl} icon={<CarIcon />} label="Waze" />
            )}
          </div>
        </div>
      )}

      <p className="text-center text-[12px] mt-5" style={{ color: 'rgba(255,255,255,0.32)' }}>
        A confirmation has been sent to your phone.
      </p>
    </GlassCard>
  );
}

// ─── Nav pills ─────────────────────────────────────────────────────────────────

function NavPill({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const base = { background: 'rgba(255,255,255,0.068)', border: '1px solid rgba(255,255,255,0.160)', color: 'rgba(255,255,255,0.64)', boxShadow: '0 4px 14px rgba(0,0,0,0.22)' } as React.CSSProperties;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1.5 rounded-full text-[12px] tracking-wide font-light transition-all no-underline"
      style={{ ...base, padding: '9px 20px' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.background = 'rgba(255,255,255,0.110)'; el.style.color = 'rgba(255,255,255,0.85)'; }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.background = base.background as string; el.style.color = base.color as string; }}
    >
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
  const base = ['0 1px 0 rgba(255,255,255,0.70) inset', '0 -1px 0 rgba(110,80,30,0.16) inset', '0 12px 32px rgba(0,0,0,0.35)', '0 3px 10px rgba(0,0,0,0.25)'].join(', ');
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full active:scale-[0.98] rounded-[18px] text-[15px] font-semibold transition-all"
      style={{
        padding: 'clamp(13px, 2vh, 16px) 24px',
        background: disabled ? 'rgba(255,255,255,0.10)' : 'linear-gradient(180deg, #f6f1e5 0%, #ede3cc 100%)',
        color: disabled ? 'rgba(255,255,255,0.30)' : '#0c0e14',
        letterSpacing: '0.015em',
        boxShadow: disabled ? 'none' : base,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="w-4 h-4 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
          {children}
        </span>
      ) : children}
    </button>
  );
}

// ─── Status banner ─────────────────────────────────────────────────────────────

function StatusBanner({ icon, color, text }: { icon: string; color: 'red' | 'amber' | 'neutral'; text: string }) {
  const styles = {
    red:     { bg: 'rgba(239,68,68,0.08)',    border: 'rgba(239,68,68,0.20)',    text: 'rgba(248,113,113,0.85)' },
    amber:   { bg: 'rgba(251,191,36,0.08)',   border: 'rgba(251,191,36,0.22)',   text: 'rgba(251,191,36,0.85)' },
    neutral: { bg: 'rgba(255,255,255,0.040)', border: 'rgba(255,255,255,0.085)', text: 'rgba(255,255,255,0.50)' },
  }[color];
  return (
    <div className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 mb-4" style={{ background: styles.bg, border: `1px solid ${styles.border}` }}>
      <span style={{ color: styles.text }}>{icon}</span>
      <span className="text-[13px] font-medium" style={{ color: styles.text }}>{text}</span>
    </div>
  );
}

// ─── SVG icons ─────────────────────────────────────────────────────────────────

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
