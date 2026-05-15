import { useState, useEffect, useRef } from 'react';
import './GuestHubPage.css';
import { useGuestHub } from './hooks/useGuestHub';
import GuestHubSkeleton from './components/GuestHubSkeleton';
import GuestHubError    from './components/GuestHubError';
import type { GuestHubViewModel, SocialLinkViewModel, DishAvailability, DishViewModel } from './types/viewModel';
import { getDietaryAbbr } from './mappers/hubMapper';
import { useHubMeta } from './hooks/useHubMeta';

// ─── Colour tokens — guest-facing palette, isolated from iron-* operator UI ──
const C = {
  bg:       '#0C0A09',
  surface:  '#141210',
  elevated: '#1C1916',
  border:   '#28231E',
  borderSub:'#201C18',
  text:     '#F0EBE3',
  muted:    '#7A6F65',
  sub:      '#4A4139',
  gold:     '#C9A96E',
  goldDim:  '#8C6F3E',
} as const;

// ─── Inline SVG icon components ───────────────────────────────────────────────
function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

function IconMap() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
    </svg>
  );
}

function IconTikTok() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.01a8.16 8.16 0 0 0 4.77 1.52V7.07a4.85 4.85 0 0 1-1-.38z"/>
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function getSocialIcon(platform: string) {
  switch (platform.toLowerCase()) {
    case 'instagram': return <IconInstagram />;
    case 'tiktok':    return <IconTikTok />;
    default:          return <IconGlobe />;
  }
}

// ─── Section label — gold uppercase 11px eyebrow text ─────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: C.gold, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
      {children}
    </p>
  );
}

// ─── Full-width horizontal rule between sections ──────────────────────────────
function Rule() {
  return <div style={{ height: 1, background: C.border, marginTop: 40, marginBottom: 40 }} />;
}

// ─── Dietary tag pills ────────────────────────────────────────────────────────
function DietaryPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
      {tags.map(tag => (
        <span
          key={tag}
          title={tag}
          style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
            background: C.elevated, border: `1px solid ${C.border}`, color: C.muted,
          }}
        >
          {getDietaryAbbr(tag)}
        </span>
      ))}
    </div>
  );
}

// ─── Availability badge ───────────────────────────────────────────────────────
const AVAIL_LABELS: Record<string, string> = {
  SOLD_OUT:       'Sold out',
  SEASONAL:       'Seasonal',
  BREAKFAST_ONLY: 'Breakfast',
  DINNER_ONLY:    'Dinner only',
};

function AvailabilityBadge({ availability }: { availability: DishAvailability }) {
  if (availability === 'AVAILABLE') return null;
  const isSoldOut = availability === 'SOLD_OUT';
  return (
    <div style={{
      position: 'absolute', bottom: 8, right: 8,
      background: isSoldOut ? 'rgba(0,0,0,0.75)' : 'rgba(201,169,110,0.15)',
      border: `1px solid ${isSoldOut ? C.border : C.goldDim}`,
      color: isSoldOut ? C.muted : C.gold,
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '3px 7px', borderRadius: 5,
    }}>
      {AVAIL_LABELS[availability] ?? availability}
    </div>
  );
}

// ─── Icon container for social/action rows ────────────────────────────────────
function IconBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 9,
      background: C.elevated, border: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, color: C.muted,
    }}>
      {children}
    </div>
  );
}

// ─── Social link row ──────────────────────────────────────────────────────────
function SocialRow({ link }: { link: SocialLinkViewModel }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="gh-row-link"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 14px',
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, textDecoration: 'none', color: C.text,
      }}
    >
      <IconBox>{getSocialIcon(link.platform)}</IconBox>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{link.displayLabel}</p>
        <p style={{ margin: 0, color: C.muted, fontSize: 12 }}>
          {link.platform === 'website' ? link.handle : `@${link.handle}`}
        </p>
      </div>
      <span style={{ color: C.sub }}><IconChevronRight /></span>
    </a>
  );
}

// ─── Chef's Selection editorial card — full-bleed image + rich text ───────────
function ChefsEditorialCard({ dish }: { dish: DishViewModel }) {
  return (
    <article style={{
      borderRadius: 16, overflow: 'hidden',
      background: C.surface, border: `1px solid ${C.border}`,
    }}>
      {/* Full-bleed image */}
      <div style={{
        height: 192, background: dish.gradient, position: 'relative',
        opacity: dish.isUnavailable ? 0.5 : 1,
        transition: 'opacity 200ms ease',
      }}>
        {dish.imageUrl && (
          <img
            src={dish.imageUrl}
            alt={dish.name}
            loading="lazy"
            decoding="async"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Candlelight center glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 75%, rgba(255,200,120,0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }} />
        {/* Image-to-card blend */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%',
          background: `linear-gradient(to bottom, transparent, ${C.surface})`,
          pointerEvents: 'none',
        }} />
        <AvailabilityBadge availability={dish.availability} />
      </div>
      {/* Content */}
      <div style={{ padding: '4px 20px 22px' }}>
        {dish.tag && (
          <span style={{
            display: 'inline-block', marginBottom: 12,
            background: 'rgba(201,169,110,0.12)',
            color: C.gold,
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', padding: '3px 10px', borderRadius: 5,
            border: `1px solid ${C.goldDim}`,
          }}>
            {dish.tag}
          </span>
        )}
        <h3 style={{
          margin: 0, fontSize: 20, fontWeight: 700,
          letterSpacing: '-0.025em', lineHeight: 1.2,
        }}>
          {dish.name}
        </h3>
        {dish.subtitle && (
          <p style={{
            margin: '5px 0 0', color: C.gold,
            fontSize: 13, fontWeight: 500,
            fontStyle: 'italic', letterSpacing: '0.01em', lineHeight: 1.4,
          }}>
            {dish.subtitle}
          </p>
        )}
        {dish.description && (
          <p style={{
            margin: '12px 0 0', color: C.muted, fontSize: 14, lineHeight: 1.65,
            display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {dish.description}
          </p>
        )}
        <DietaryPills tags={dish.dietaryTags} />
        {dish.price && (
          <p style={{
            margin: '14px 0 0', fontWeight: 700, fontSize: 17,
            letterSpacing: '-0.015em',
            color: dish.isUnavailable ? C.muted : C.gold,
            textDecoration: dish.isUnavailable ? 'line-through' : 'none',
          }}>
            {dish.price}
          </p>
        )}
      </div>
    </article>
  );
}

// ─── Rendered hub page (ViewModel → JSX) ─────────────────────────────────────
function HubContent({ vm, onDemoAction }: { vm: GuestHubViewModel; onDemoAction: () => void }) {
  const [stickyVisible, setStickyVisible] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  // Slide sticky nav in once the hero's bottom edge clears 56px.
  useEffect(() => {
    function onScroll() {
      const bottom = heroRef.current?.getBoundingClientRect().bottom ?? 999;
      setStickyVisible(bottom < 56);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Split featured dishes: chef-tagged items get the editorial treatment; all others go in the carousel.
  const chefsDishes    = vm.featuredDishes.filter(d => /chef/i.test(d.tag ?? ''));
  const carouselDishes = vm.featuredDishes.filter(d => !/chef/i.test(d.tag ?? ''));

  const hasCategories = vm.allCategories.length > 0;
  const hasPromotions = vm.promotions.length > 0;
  const hasSocial     = vm.socialLinks.length > 0;

  return (
    <div style={{
      backgroundColor: C.bg,
      minHeight: '100dvh',
      color: C.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif',
      overflowX: 'hidden',
    }}>

      {/* ── Sticky nav ──────────────────────────────────────────────────────── */}
      <div
        aria-hidden={!stickyVisible}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
          backgroundColor: `${C.bg}F0`,
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderBottom: `1px solid ${stickyVisible ? C.border : 'transparent'}`,
          transform: stickyVisible ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 280ms cubic-bezier(0.4, 0, 0.2, 1), border-color 280ms ease',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {vm.logoUrl && (
            <div style={{
              width: 24, height: 24, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
              background: C.elevated, border: `1px solid ${C.border}`,
            }}>
              <img
                src={vm.logoUrl}
                alt=""
                width={24}
                height={24}
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>
            {vm.name}
          </span>
        </div>
        <button
          type="button"
          className="gh-cta"
          tabIndex={stickyVisible ? 0 : -1}
          onClick={onDemoAction}
          style={{
            backgroundColor: C.gold, color: '#0C0A09',
            fontWeight: 700, fontSize: 13,
            padding: '8px 18px', borderRadius: 8, border: 'none',
            letterSpacing: '0.01em',
          }}
        >
          Reserve
        </button>
      </div>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <div ref={heroRef} style={{ position: 'relative', width: '100%', height: 'min(90vw, 520px)', overflow: 'hidden' }}>
        {/* Deep warm gradient — always rendered under the image as fallback */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, #3A1A06 0%, #1E0E04 35%, #0C0A09 100%)',
        }} />
        {vm.coverImageUrl && (
          <img
            src={vm.coverImageUrl}
            alt={`${vm.name} — cover`}
            loading="eager"
            decoding="async"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Vignette — darkens edges for cinematic depth */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 40%, transparent 25%, rgba(12,10,9,0.60) 100%)',
          pointerEvents: 'none',
        }} />
        {/* Candlelight glow — warm centre bloom */}
        <div style={{
          position: 'absolute', top: '8%', left: '50%',
          transform: 'translateX(-50%)',
          width: '90%', height: '60%',
          background: 'radial-gradient(ellipse, rgba(201,169,110,0.13) 0%, rgba(201,169,110,0.03) 40%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        {/* Bottom fade — strong, starts high for a clean identity block read */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '78%',
          background: `linear-gradient(to bottom, transparent 0%, ${C.bg}99 45%, ${C.bg} 100%)`,
          pointerEvents: 'none',
        }} />
        {/* Restaurant identity */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 24px 40px' }}>
          {vm.logoUrl && (
            <div style={{
              width: 52, height: 52, borderRadius: 14, overflow: 'hidden', marginBottom: 20,
              background: C.elevated,
              border: `1px solid rgba(255,255,255,0.15)`,
              boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            }}>
              <img
                src={vm.logoUrl}
                alt={`${vm.name} logo`}
                width={52}
                height={52}
                loading="eager"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
          {/* Gold accent line — editorial typography anchor */}
          <div style={{ width: 28, height: 2, background: C.gold, borderRadius: 1, marginBottom: 16 }} />
          <h1 style={{
            fontSize: 'clamp(34px, 9vw, 48px)',
            fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05, margin: 0,
          }}>
            {vm.name}
          </h1>
          {vm.tagline && (
            <p style={{
              marginTop: 12, fontSize: 15,
              color: 'rgba(240,235,227,0.62)',
              letterSpacing: '0.02em', lineHeight: 1.5, marginBottom: 0,
              fontWeight: 400,
            }}>
              {vm.tagline}
            </p>
          )}
        </div>
      </div>

      {/* ── Page body ─────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 24px 80px' }}>

        {/* ── Quick actions ─────────────────────────────────────────────────── */}
        <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

          <button
            type="button"
            className="gh-cta"
            onClick={onDemoAction}
            style={{
              gridColumn: '1 / -1',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              backgroundColor: C.gold, color: '#0C0A09',
              fontWeight: 700, fontSize: 15, padding: '16px 20px',
              borderRadius: 12, border: 'none', letterSpacing: '0.01em', width: '100%',
            }}
          >
            <IconCalendar />
            Reserve a table
          </button>

          <button
            type="button"
            className="gh-secondary-btn"
            onClick={onDemoAction}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: C.elevated, border: `1px solid ${C.border}`,
              color: C.text, fontWeight: 600, fontSize: 14,
              padding: '13px 16px', borderRadius: 12,
            }}
          >
            <IconUsers />
            Waitlist
          </button>

          {vm.phone && (
            <a
              href={`tel:${vm.phone}`}
              className="gh-secondary-btn"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: C.elevated, border: `1px solid ${C.border}`,
                color: C.text, fontWeight: 600, fontSize: 14,
                padding: '13px 16px', borderRadius: 12, textDecoration: 'none',
              }}
            >
              <IconPhone />
              Call us
            </a>
          )}

          {vm.directionsUrl && (
            <a
              href={vm.directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gh-ghost-btn"
              style={{
                gridColumn: '1 / -1',
                display: 'flex', alignItems: 'center', gap: 14,
                backgroundColor: 'transparent',
                border: `1px solid ${C.borderSub}`,
                color: C.text, padding: '12px 16px',
                borderRadius: 12, textDecoration: 'none',
              }}
            >
              <span style={{ color: C.muted, flexShrink: 0 }}><IconMap /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>Get directions</span>
                {vm.address && (
                  <span style={{
                    display: 'block', fontSize: 12, color: C.muted, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {vm.address}
                  </span>
                )}
              </span>
              <span style={{ color: C.sub, flexShrink: 0 }}><IconChevronRight /></span>
            </a>
          )}
        </div>

        {/* ── Chef's Selection ──────────────────────────────────────────────── */}
        {chefsDishes.length > 0 && (
          <>
            <Rule />
            <div>
              <SectionLabel>Chef's selection</SectionLabel>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', margin: '10px 0 20px' }}>
                From the kitchen
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {chefsDishes.map(dish => (
                  <ChefsEditorialCard key={dish.id} dish={dish} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Signature dishes carousel ─────────────────────────────────────── */}
        {carouselDishes.length > 0 && (
          <>
            <Rule />
            <div>
              <SectionLabel>Tonight's picks</SectionLabel>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', margin: '10px 0 20px' }}>
                Signature dishes
              </h2>
            </div>
            {/* Negative margin pulls the scroll area to full bleed; cards use 24px padding */}
            <div style={{ position: 'relative', margin: '0 -24px' }}>
              <div
                className="gh-dish-row"
                style={{
                  display: 'flex', gap: 12, overflowX: 'auto',
                  paddingLeft: 24, paddingRight: 24, paddingBottom: 4,
                  scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {carouselDishes.map(dish => (
                  <article
                    key={dish.id}
                    style={{
                      flexShrink: 0, width: 192, borderRadius: 16, overflow: 'hidden',
                      background: C.surface, border: `1px solid ${C.border}`,
                      scrollSnapAlign: 'start',
                    }}
                  >
                    <div style={{
                      height: 148, background: dish.gradient, position: 'relative',
                      opacity: dish.isUnavailable ? 0.45 : 1,
                      transition: 'opacity 200ms ease',
                    }}>
                      {dish.imageUrl && (
                        <img
                          src={dish.imageUrl}
                          alt={dish.name}
                          loading="lazy"
                          decoding="async"
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'radial-gradient(ellipse at 50% 70%, rgba(255,200,120,0.07) 0%, transparent 65%)',
                        pointerEvents: 'none',
                      }} />
                      {dish.tag && dish.availability === 'AVAILABLE' && (
                        <div style={{
                          position: 'absolute', top: 10, left: 10,
                          background: C.elevated,
                          color: C.muted,
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                          textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5,
                        }}>
                          {dish.tag}
                        </div>
                      )}
                      <AvailabilityBadge availability={dish.availability} />
                    </div>
                    <div style={{ padding: '14px 16px 16px' }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                        {dish.name}
                      </p>
                      {dish.subtitle && (
                        <p style={{
                          margin: '3px 0 0', color: C.gold,
                          fontSize: 12, fontWeight: 500,
                          fontStyle: 'italic', letterSpacing: '0.01em', lineHeight: 1.3,
                        }}>
                          {dish.subtitle}
                        </p>
                      )}
                      {dish.description && (
                        <p style={{
                          margin: '6px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.45,
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {dish.description}
                        </p>
                      )}
                      <DietaryPills tags={dish.dietaryTags} />
                      {dish.price && (
                        <p style={{
                          margin: '8px 0 0', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em',
                          color: dish.isUnavailable ? C.muted : C.gold,
                          textDecoration: dish.isUnavailable ? 'line-through' : 'none',
                        }}>
                          {dish.price}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {/* Right-edge fade — hints at more cards without UI chrome */}
              <div style={{
                position: 'absolute', top: 0, right: 0, bottom: 4, width: 40,
                background: `linear-gradient(to right, transparent, ${C.bg})`,
                pointerEvents: 'none',
              }} />
            </div>
          </>
        )}

        {/* ── Menu categories ───────────────────────────────────────────────── */}
        {hasCategories && (
          <>
            <Rule />
            <div>
              <SectionLabel>Full menu</SectionLabel>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', margin: '10px 0 20px' }}>
                Explore by category
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {vm.allCategories.map(cat => (
                  <div
                    key={cat.id}
                    style={{
                      padding: '16px 18px',
                      background: C.surface, border: `1px solid ${C.border}`,
                      borderRadius: 14,
                    }}
                  >
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: C.text }}>{cat.name}</p>
                    {cat.description && (
                      <p style={{
                        margin: '4px 0 0', color: C.muted, fontSize: 11, lineHeight: 1.4,
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {cat.description}
                      </p>
                    )}
                    <p style={{ margin: '5px 0 0', color: C.sub, fontSize: 11 }}>{cat.count} items</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Promotions & events ───────────────────────────────────────────── */}
        {hasPromotions && (
          <>
            <Rule />
            <div>
              <SectionLabel>Upcoming</SectionLabel>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', margin: '10px 0 20px' }}>
                Events & specials
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {vm.promotions.map(promo => (
                  <div
                    key={promo.id}
                    style={{
                      padding: '18px 18px 20px',
                      background: C.surface, border: `1px solid ${C.border}`,
                      borderRadius: 14, position: 'relative', overflow: 'hidden',
                    }}
                  >
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
                      background: promo.tagColor === 'gold' ? C.gold : C.border,
                      borderRadius: '14px 0 0 14px',
                    }} />
                    <div style={{ paddingLeft: 14 }}>
                      {promo.tag && (
                        <span style={{
                          display: 'inline-block', marginBottom: 8,
                          background: promo.tagColor === 'gold' ? 'rgba(201,169,110,0.12)' : C.elevated,
                          color: promo.tagColor === 'gold' ? C.gold : C.muted,
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                          textTransform: 'uppercase', padding: '3px 9px', borderRadius: 5,
                          border: promo.tagColor === 'gold' ? `1px solid ${C.goldDim}` : `1px solid ${C.border}`,
                        }}>
                          {promo.tag}
                        </span>
                      )}
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                        {promo.title}
                      </p>
                      {promo.description && (
                        <p style={{ margin: '7px 0 0', color: C.muted, fontSize: 13, lineHeight: 1.55 }}>
                          {promo.description}
                        </p>
                      )}
                      {promo.schedule && (
                        <p style={{ margin: '10px 0 0', color: C.gold, fontSize: 12, fontWeight: 500, letterSpacing: '0.01em' }}>
                          {promo.schedule}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Hours ─────────────────────────────────────────────────────────── */}
        {vm.hours && vm.hours.length > 0 && (
          <>
            <Rule />
            <div>
              <SectionLabel>Hours</SectionLabel>
              <div style={{
                marginTop: 14, background: C.surface,
                border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden',
              }}>
                {vm.hours.map((h, i) => (
                  <div
                    key={h.label}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '14px 18px',
                      borderBottom: i < vm.hours!.length - 1 ? `1px solid ${C.borderSub}` : undefined,
                    }}
                  >
                    <span style={{ fontSize: 14, color: C.muted }}>{h.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: h.value === 'Closed' ? C.sub : C.text }}>
                      {h.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Social & contact ──────────────────────────────────────────────── */}
        {hasSocial && (
          <>
            <Rule />
            <div>
              <SectionLabel>Connect</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {vm.socialLinks.map(link => (
                  <SocialRow key={link.platform} link={link} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 56, paddingBottom: 16, textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px',
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 20,
          }}>
            <div style={{
              width: 18, height: 18, background: C.gold, borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 900, color: '#0C0A09', letterSpacing: '-0.02em',
            }}>
              IB
            </div>
            <span style={{ fontSize: 12, color: C.sub, fontWeight: 500 }}>
              Powered by Iron Booking
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Main exported page component ────────────────────────────────────────────
// Accepts a slug, handles all loading / error / not-found states, then
// delegates rendering to HubContent once data is ready.

export default function GuestHubPage({ slug }: { slug: string }) {
  const hubState = useGuestHub(slug);

  // SEO + social share metadata — must be called before any conditional returns.
  const metaVm     = hubState.status === 'ready' ? hubState.data : null;
  const metaRobots = hubState.status === 'error' || hubState.status === 'not_found'
    ? 'noindex, nofollow'
    : undefined;
  useHubMeta(metaVm, slug, metaRobots);

  // Set document language so screen readers pronounce content correctly.
  useEffect(() => {
    const prev = document.documentElement.lang;
    document.documentElement.lang = 'en';
    return () => { document.documentElement.lang = prev; };
  }, []);

  // Demo notice state lives here so it survives state transitions
  const [demoNotice,  setDemoNotice]  = useState(false);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (demoTimerRef.current) clearTimeout(demoTimerRef.current); };
  }, []);

  function showDemoNotice() {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    setDemoNotice(true);
    demoTimerRef.current = setTimeout(() => setDemoNotice(false), 2800);
  }

  if (hubState.status === 'loading')   return <GuestHubSkeleton />;
  if (hubState.status === 'not_found') return <GuestHubError notFound onRetry={() => {}} />;
  if (hubState.status === 'error')     return <GuestHubError onRetry={hubState.retry} />;

  return (
    <>
      <HubContent vm={hubState.data} onDemoAction={showDemoNotice} />
      {demoNotice && (
        <div
          role="status"
          aria-live="polite"
          className="gh-demo-notice"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            padding: '10px 20px',
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            fontSize: 13,
            color: C.muted,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          }}
        >
          This is a live preview — connect a restaurant to activate this action
        </div>
      )}
    </>
  );
}
