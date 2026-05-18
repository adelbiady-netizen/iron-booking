import { useState, useEffect, useRef, createContext, useContext } from 'react';
import './GuestHubPage.css';
import { useGuestHub } from './hooks/useGuestHub';
import GuestHubSkeleton from './components/GuestHubSkeleton';
import GuestHubError    from './components/GuestHubError';
import type { GuestHubViewModel, SocialLinkViewModel, DishAvailability, DishViewModel } from './types/viewModel';
import { getDietaryAbbr } from './mappers/hubMapper';
import { useHubMeta } from './hooks/useHubMeta';
import { getHubTheme, type HubColorPalette } from './presets/hubThemes';

// ─── Color context — theme-aware, isolated from iron-* operator UI ─────────────
// Sub-components read colors via useC() instead of a module-level const,
// so they automatically pick up whichever preset HubContent provides.

const ESPRESSO_PALETTE: HubColorPalette = {
  bg: '#0C0A09', surface: '#141210', elevated: '#1C1916',
  border: '#28231E', borderSub: '#201C18',
  text: '#F0EBE3', muted: '#7A6F65', sub: '#4A4139',
  gold: '#C9A96E', goldDim: '#8C6F3E',
};

const ColorsCtx = createContext<HubColorPalette>(ESPRESSO_PALETTE);
const useC = () => useContext(ColorsCtx);

// ─── Inline SVG icon components ───────────────────────────────────────────────
function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <path d="M16 2v4M8 2v4M3 10h18"/>
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

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}

// Returns the hours entry for today's weekday, or null if not available.
function getTodayHours(hours: { label: string; value: string }[] | null): { label: string; value: string } | null {
  if (!hours || hours.length === 0) return null;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return hours.find(h => h.label.toLowerCase() === today.toLowerCase()) ?? null;
}

function getSocialIcon(platform: string) {
  switch (platform.toLowerCase()) {
    case 'instagram': return <IconInstagram />;
    case 'tiktok':    return <IconTikTok />;
    default:          return <IconGlobe />;
  }
}

// ─── Feature vocabulary — keys must match backend VALID_FEATURES set ─────────
const FEATURE_LABELS: Record<string, string> = {
  OUTDOOR_SEATING: 'Outdoor Seating',
  PRIVATE_DINING:  'Private Dining',
  LIVE_MUSIC:      'Live Music',
  VEGAN_OPTIONS:   'Vegan Options',
  ROOFTOP:         'Rooftop',
  CHEFS_CHOICE:    "Chef's Choice",
};

// ─── Section label — gold uppercase 11px eyebrow text ─────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  const C = useC();
  return (
    <p style={{ color: C.gold, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
      {children}
    </p>
  );
}

// ─── Full-width horizontal rule between sections ──────────────────────────────
function Rule() {
  const C = useC();
  return <div style={{ height: 1, background: C.border, marginTop: 40, marginBottom: 40 }} />;
}

// ─── Gallery carousel ─────────────────────────────────────────────────────────
// Square 1:1 scroll-snap cards. Hidden in diningMode (guard is in the caller).
// Lazy loads all images. Fallback: if galleryEnabled=false or no images, never renders.
function GalleryCarousel({ images }: { images: string[] }) {
  const C = useC();
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted }}>Gallery</span>
        <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '6px 0 0', color: C.text }}>
          Inside the experience
        </h2>
      </div>
      <div style={{
        margin: '0 -24px',
        paddingLeft: 24,
        paddingRight: 24,
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        {images.map((url, i) => (
          <div
            key={i}
            style={{
              flexShrink: 0,
              width: 'min(72vw, 280px)',
              aspectRatio: '1 / 1',
              borderRadius: 16,
              overflow: 'hidden',
              scrollSnapAlign: 'start',
              position: 'relative',
              background: C.elevated,
              border: `1px solid ${C.border}`,
            }}
          >
            <img
              src={url}
              alt={`Gallery image ${i + 1}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.28) 0%, transparent 55%)',
              pointerEvents: 'none',
            }} />
          </div>
        ))}
        {/* Trailing spacer so last card doesn't hug the edge */}
        <div style={{ flexShrink: 0, width: 8 }} />
      </div>
    </div>
  );
}

// ─── Dietary tag pills ────────────────────────────────────────────────────────
function DietaryPills({ tags }: { tags: string[] }) {
  const C = useC();
  if (tags.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>
      {tags.map(tag => (
        <span
          key={tag}
          title={tag}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
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
  const C = useC();
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
  const C = useC();
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
const SOCIAL_HELPER: Record<string, string> = {
  instagram: 'Follow us on Instagram',
  facebook:  'Like our page',
  tiktok:    'Watch our videos',
  website:   'Visit our website',
  whatsapp:  'Message us on WhatsApp',
};

function SocialRow({ link }: { link: SocialLinkViewModel }) {
  const C = useC();
  const helper = SOCIAL_HELPER[link.platform] ?? 'View';
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
        <p style={{ margin: 0, color: C.muted, fontSize: 12 }}>{helper}</p>
      </div>
      <span style={{ color: C.sub }}><IconChevronRight /></span>
    </a>
  );
}

// ─── Menu dish row card — horizontal layout for category browse view ──────────
function MenuDishCard({ dish }: { dish: DishViewModel }) {
  const C = useC();
  return (
    <article
      className="gh-dish-card"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        padding: '14px 16px',
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 14, opacity: dish.isUnavailable ? 0.55 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            {dish.name}
          </p>
          {dish.tag && !dish.isUnavailable && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
              background: 'rgba(201,169,110,0.10)', border: `1px solid ${C.goldDim}`,
              color: C.gold, flexShrink: 0,
            }}>
              {dish.tag}
            </span>
          )}
          {dish.isUnavailable && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
              background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`,
              color: C.muted, flexShrink: 0,
            }}>
              {AVAIL_LABELS[dish.availability] ?? dish.availability}
            </span>
          )}
        </div>
        {dish.subtitle && (
          <p style={{ margin: '2px 0 0', color: C.gold, fontSize: 12, fontStyle: 'italic', lineHeight: 1.4 }}>
            {dish.subtitle}
          </p>
        )}
        {dish.description && (
          <p style={{
            margin: '6px 0 0', color: C.muted, fontSize: 12.5, lineHeight: 1.55,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {dish.description}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
          <DietaryPills tags={dish.dietaryTags} />
          {dish.price && (
            <p style={{
              margin: 0, fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', flexShrink: 0,
              color: dish.isUnavailable ? C.muted : C.gold,
              textDecoration: dish.isUnavailable ? 'line-through' : 'none',
            }}>
              {dish.price}
            </p>
          )}
        </div>
      </div>
      {dish.imageUrl && (
        <div style={{
          width: 82, height: 82, borderRadius: 10, flexShrink: 0,
          background: dish.gradient, overflow: 'hidden',
        }}>
          <img
            src={dish.imageUrl}
            alt={dish.name}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
    </article>
  );
}

// ─── Chef's Selection editorial card — full-bleed image + rich text ───────────
function ChefsEditorialCard({ dish }: { dish: DishViewModel }) {
  const C = useC();
  return (
    <article style={{
      borderRadius: 16, overflow: 'hidden',
      background: C.surface, border: `1px solid ${C.border}`,
    }}>
      {/* Full-bleed image */}
      <div style={{
        height: 224, background: dish.gradient, position: 'relative',
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
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '42%',
          background: `linear-gradient(to bottom, transparent, ${C.surface})`,
          pointerEvents: 'none',
        }} />
        {/* Tag badge — glass-style overlay on image */}
        {dish.tag && (
          <div style={{
            position: 'absolute', top: 12, left: 12,
            background: 'rgba(12,10,9,0.68)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            color: C.gold,
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6,
            border: `1px solid ${C.goldDim}`,
          }}>
            {dish.tag}
          </div>
        )}
        <AvailabilityBadge availability={dish.availability} />
      </div>
      {/* Content */}
      <div style={{ padding: '16px 20px 22px' }}>
        <h3 style={{
          margin: 0, fontSize: 22, fontWeight: 800,
          letterSpacing: '-0.03em', lineHeight: 1.2,
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
            margin: '10px 0 0', color: C.muted, fontSize: 14, lineHeight: 1.65,
            display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {dish.description}
          </p>
        )}
        <DietaryPills tags={dish.dietaryTags} />
        {dish.price && (
          <p style={{
            margin: '16px 0 0', fontWeight: 800, fontSize: 19,
            letterSpacing: '-0.02em',
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
function HubContent({ vm, onDemoAction, diningMode = false }: {
  vm: GuestHubViewModel;
  onDemoAction: () => void;
  diningMode?: boolean;
}) {
  const theme = getHubTheme(vm.themePreset);
  const C     = theme.colors;

  const [stickyVisible, setStickyVisible] = useState(false);
  const [logoFailed,    setLogoFailed]    = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const heroRef        = useRef<HTMLDivElement>(null);
  const menuRef        = useRef<HTMLDivElement>(null);
  const categoryRef    = useRef<HTMLDivElement>(null);
  const catScrollReady = useRef(false);

  const selectedCat = vm.allCategories.find(c => c.id === selectedCatId) ?? null;

  // Slide sticky nav in once the hero's bottom edge clears 56px.
  useEffect(() => {
    function onScroll() {
      const bottom = heroRef.current?.getBoundingClientRect().bottom ?? 999;
      setStickyVisible(bottom < 56);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // In dining mode (QR table scan), auto-scroll to menu after page settles.
  useEffect(() => {
    if (!diningMode) return;
    const t = setTimeout(() => {
      menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 700);
    return () => clearTimeout(t);
  }, [diningMode]);

  // Scroll to category section when navigating back from a category drill-down.
  // catScrollReady skips the initial mount fire (selectedCatId starts as null
  // but the user hasn't navigated anywhere yet — scrolling would jump past hero).
  useEffect(() => {
    if (!catScrollReady.current) { catScrollReady.current = true; return; }
    const t = setTimeout(() => {
      categoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [selectedCatId]);

  // Split featured dishes: chef-tagged items get the editorial treatment; all others go in the carousel.
  const chefsDishes    = vm.featuredDishes.filter(d => /chef/i.test(d.tag ?? ''));
  const carouselDishes = vm.featuredDishes.filter(d => !/chef/i.test(d.tag ?? ''));

  const hasCategories  = vm.allCategories.length > 0;
  const hasPromotions  = vm.promotions.length > 0;
  const hasSocial      = vm.socialLinks.length > 0;
  const hasMenuContent = hasCategories || chefsDishes.length > 0 || carouselDishes.length > 0;
  const todayHours     = getTodayHours(vm.hours);

  return (
    <ColorsCtx.Provider value={C}>
    <div style={{
      backgroundColor: C.bg,
      minHeight: '100dvh',
      color: C.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif',
      overflowX: 'hidden',
      // CSS custom properties picked up by .gh-* class rules in GuestHubPage.css
      ...theme.css as React.CSSProperties,
      // Core palette tokens for the cat-card background gradient
      ['--gh-surface'  as string]: C.surface,
      ['--gh-elevated' as string]: C.elevated,
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
          {vm.logoUrl && !logoFailed && (
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
                onError={() => setLogoFailed(true)}
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
      <div ref={heroRef} style={{ position: 'relative', width: '100%', height: diningMode ? 'min(52vw, 240px)' : 'min(92vw, 560px)', overflow: 'hidden' }}>
        {/* Preset hero gradient — fallback under the image, warm or cool per theme */}
        <div style={{
          position: 'absolute', inset: 0,
          background: theme.heroGradient,
        }} />
        {vm.coverImageUrl && (
          <img
            src={vm.coverImageUrl}
            alt={`${vm.name} — cover`}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="gh-hero-img"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 65%' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Vignette — darkens edges for cinematic depth */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 40%, transparent 25%, rgba(12,10,9,0.45) 100%)',
          pointerEvents: 'none',
        }} />
        {/* Accent glow — warm or cool centre bloom per preset, animated breathe */}
        <div
          className="gh-glow-breathe"
          style={{
            position: 'absolute', top: '8%', left: '50%',
            transform: 'translateX(-50%)',
            width: '90%', height: '60%',
            background: `radial-gradient(ellipse, ${theme.heroGlowA} 0%, ${theme.heroGlowB} 40%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
        {/* Uniform image darkening — overlay lifts text contrast on any cover photo */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.18)',
          pointerEvents: 'none',
        }} />
        {/* Grain texture — atmospheric film grain at near-zero opacity */}
        <div className="gh-grain" />
        {/* Bottom fade — tight text-protection zone, exposes upper image atmosphere */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '52%',
          background: `linear-gradient(to bottom, transparent 0%, ${C.bg}60 42%, ${C.bg}C8 68%, ${C.bg} 100%)`,
          pointerEvents: 'none',
        }} />
        {/* Restaurant identity — centered column composition */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: diningMode ? '0 20px 18px' : '0 24px 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          {!diningMode && vm.logoUrl && !logoFailed && (
            <div style={{
              width: 52, height: 52, borderRadius: 16, overflow: 'hidden', marginBottom: 14,
              background: C.elevated,
              border: `1px solid rgba(255,255,255,0.18)`,
              boxShadow: '0 4px 28px rgba(0,0,0,0.80)',
            }}>
              <img
                src={vm.logoUrl}
                alt={`${vm.name} logo`}
                width={52}
                height={52}
                loading="eager"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={() => setLogoFailed(true)}
              />
            </div>
          )}
          {/* 3-segment brand line — gold·light·gold, theme-aware */}
          <div style={{ display: 'flex', gap: 3, marginBottom: diningMode ? 10 : 18 }}>
            <div style={{ width: 14, height: 2, background: C.gold, borderRadius: 1 }} />
            <div style={{ width: 8,  height: 2, background: C.text, borderRadius: 1, opacity: 0.30 }} />
            <div style={{ width: 14, height: 2, background: C.gold, borderRadius: 1 }} />
          </div>
          <h1 style={{
            fontSize: diningMode ? 'clamp(22px, 5.5vw, 30px)' : 'clamp(32px, 8.5vw, 46px)',
            fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.05, margin: 0,
            textShadow: '0 2px 24px rgba(0,0,0,0.90), 0 1px 6px rgba(0,0,0,0.60)',
          }}>
            {vm.name}
          </h1>
          {!diningMode && vm.cuisine && (
            <p style={{
              marginTop: 9, fontSize: 12,
              color: 'rgba(201,169,110,0.78)',
              letterSpacing: '0.10em', lineHeight: 1.4, marginBottom: 0,
              fontWeight: 600, textTransform: 'uppercase',
              textShadow: '0 1px 12px rgba(0,0,0,0.80)',
            }}>
              {vm.cuisine}
            </p>
          )}
          {!diningMode && vm.tagline && (
            <p style={{
              marginTop: 12, fontSize: 15,
              color: 'rgba(240,235,227,0.82)',
              letterSpacing: '0.025em', lineHeight: 1.55, marginBottom: 0,
              fontWeight: 400, fontStyle: 'italic',
              textShadow: '0 1px 14px rgba(0,0,0,0.82)',
            }}>
              {vm.tagline}
            </p>
          )}
          {!diningMode && vm.estYear && (
            <p style={{
              marginTop: 10, fontSize: 11,
              color: 'rgba(240,235,227,0.42)',
              letterSpacing: '0.10em', lineHeight: 1.4, marginBottom: 0,
              fontWeight: 500, textTransform: 'uppercase',
            }}>
              Est. {vm.estYear}
            </p>
          )}
        </div>
      </div>

      {/* ── Page body ─────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 24px 80px' }}>

        {/* ── Today's hours strip — instant trust signal ────────────────────── */}
        {todayHours && (
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 11px', borderRadius: 20,
              background: todayHours.value === 'Closed' ? 'rgba(74,65,57,0.35)' : 'rgba(201,169,110,0.10)',
              border: `1px solid ${todayHours.value === 'Closed' ? C.border : C.goldDim}`,
              flexShrink: 0,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: todayHours.value === 'Closed' ? C.sub : C.gold,
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: todayHours.value === 'Closed' ? C.muted : C.gold }}>
                {todayHours.value === 'Closed' ? 'Closed today' : `Open today`}
              </span>
            </span>
            {todayHours.value !== 'Closed' && (
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>
                {todayHours.value}
              </span>
            )}
            {vm.address && !diningMode && (
              vm.directionsUrl ? (
                <a
                  href={vm.directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 12, color: C.sub, textDecoration: 'none',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0,
                  }}
                >
                  <IconMap />
                  {vm.address}
                </a>
              ) : (
                <span style={{
                  fontSize: 12, color: C.sub,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0,
                }}>
                  · {vm.address}
                </span>
              )
            )}
          </div>
        )}

        {/* ── About / identity paragraph — replaces generic microcopy when set ── */}
        {!diningMode && (
          <p style={{
            margin: `${todayHours ? 14 : 22}px 0 0`,
            fontSize: 13, color: C.muted,
            letterSpacing: '0.015em', lineHeight: 1.65,
            textAlign: 'center', opacity: 0.90,
          }}>
            {vm.about ?? 'Browse the menu, discover highlights, and reserve with confidence.'}
          </p>
        )}

        {/* ── Quick actions ─────────────────────────────────────────────────── */}
        <div style={{ marginTop: diningMode ? (todayHours ? 16 : 32) : 14, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Primary CTA */}
          {diningMode ? (
            <button
              type="button"
              onClick={() => menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                backgroundColor: C.gold, color: '#0C0A09',
                fontWeight: 700, fontSize: 15, padding: '16px 20px',
                borderRadius: 12, border: 'none', letterSpacing: '0.01em',
              }}
            >
              <IconMenu />
              View our menu
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                className="gh-cta"
                onClick={onDemoAction}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  backgroundColor: C.gold, color: '#0C0A09',
                  fontWeight: 700, fontSize: 15, padding: '16px 20px',
                  borderRadius: 12, border: 'none', letterSpacing: '0.01em',
                }}
              >
                <IconCalendar />
                Reserve a table
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>No account required</span>
                <span style={{ fontSize: 11, color: C.sub }}>·</span>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>Takes 60 seconds</span>
              </div>
            </div>
          )}

          {/* Secondary CTA — scroll to menu (normal mode only) */}
          {!diningMode && hasMenuContent && (
            <button
              type="button"
              onClick={() => menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: 'transparent', border: `1px solid ${C.border}`,
                color: C.text, fontWeight: 600, fontSize: 14,
                padding: '13px 16px', borderRadius: 12,
              }}
            >
              <IconMenu />
              View our menu
            </button>
          )}

          {/* Category name preview — dim section names hinting at browsable content */}
          {!diningMode && hasCategories && (
            <p style={{
              margin: '-2px 0 0', fontSize: 11, color: C.sub,
              textAlign: 'center', letterSpacing: '0.04em', lineHeight: 1.5,
            }}>
              {vm.allCategories.slice(0, 4).map(c => c.name).join('  ·  ')}
              {vm.allCategories.length > 4 ? '  ·  …' : ''}
            </p>
          )}

          {/* Utility row — Call + Directions */}
          {(vm.phone || (!diningMode && vm.directionsUrl)) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: vm.phone && !diningMode && vm.directionsUrl ? '1fr 1fr' : '1fr',
              gap: 10,
            }}>
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
                  {diningMode ? 'Call for service' : 'Call us'}
                </a>
              )}
              {!diningMode && vm.directionsUrl && (
                <a
                  href={vm.directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gh-secondary-btn"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    backgroundColor: C.elevated, border: `1px solid ${C.border}`,
                    color: C.text, fontWeight: 600, fontSize: 14,
                    padding: '13px 16px', borderRadius: 12, textDecoration: 'none',
                  }}
                >
                  <IconMap />
                  Directions
                </a>
              )}
            </div>
          )}

          {/* ── Feature trust signals — muted pills, hidden in diningMode ──────── */}
          {!diningMode && vm.features.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {vm.features.map(f => (
                <span
                  key={f}
                  style={{
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
                    textTransform: 'uppercase', padding: '4px 10px', borderRadius: 20,
                    background: C.elevated, border: `1px solid ${C.border}`, color: C.muted,
                  }}
                >
                  {FEATURE_LABELS[f] ?? f}
                </span>
              ))}
            </div>
          )}

          {/* Ghost action — bottom tier */}
          {diningMode ? (
            <button
              type="button"
              className="gh-cta"
              onClick={onDemoAction}
              style={{
                background: 'none', border: 'none', color: C.muted,
                fontSize: 13, fontWeight: 500, padding: '4px 0', letterSpacing: '0.01em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <IconCalendar />
              Reserve for your next visit
            </button>
          ) : hasMenuContent ? (
            <button
              type="button"
              onClick={() => menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                background: 'none', border: 'none', color: C.muted,
                fontSize: 12, fontWeight: 500, padding: '2px 0', letterSpacing: '0.01em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer',
              }}
            >
              View our menu ↓
            </button>
          ) : null}
        </div>

        {/* ── Gallery carousel — atmosphere images, opt-in via galleryEnabled ─── */}
        {!diningMode && vm.galleryEnabled && vm.galleryImages.length > 0 && (
          <>
            <Rule />
            <GalleryCarousel images={vm.galleryImages} />
          </>
        )}

        {/* ── Promotions & events — placed above menu so all visitors see them ── */}
        {hasPromotions && (
          <>
            <Rule />
            <div>
              <SectionLabel>Upcoming</SectionLabel>
              <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '8px 0 20px' }}>
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

        {/* Menu scroll anchor — target for 'View our menu' and dining-mode auto-scroll */}
        {hasMenuContent && <div ref={menuRef} style={{ scrollMarginTop: 68 }} />}

        {/* ── Chef's Selection ──────────────────────────────────────────────── */}
        {chefsDishes.length > 0 && (
          <>
            <Rule />
            <div>
              <SectionLabel>Chef's selection</SectionLabel>
              <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '8px 0 20px' }}>
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
              <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '8px 0 20px' }}>
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
                    className="gh-carousel-card"
                    style={{
                      flexShrink: 0, width: 224, borderRadius: 16, overflow: 'hidden',
                      background: C.surface, border: `1px solid ${C.border}`,
                      scrollSnapAlign: 'start',
                    }}
                  >
                    <div style={{
                      height: 178, background: dish.gradient, position: 'relative',
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
                      {/* Bottom image fade */}
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, height: '36%',
                        background: `linear-gradient(to bottom, transparent, ${C.surface})`,
                        pointerEvents: 'none',
                      }} />
                      {dish.tag && dish.availability === 'AVAILABLE' && (
                        <div style={{
                          position: 'absolute', top: 10, left: 10,
                          background: 'rgba(12,10,9,0.65)',
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                          color: C.gold,
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                          textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5,
                          border: `1px solid ${C.goldDim}`,
                        }}>
                          {dish.tag}
                        </div>
                      )}
                      <AvailabilityBadge availability={dish.availability} />
                    </div>
                    <div style={{ padding: '14px 16px 18px' }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em', lineHeight: 1.3 }}>
                        {dish.name}
                      </p>
                      {dish.subtitle && (
                        <p style={{
                          margin: '3px 0 0', color: C.gold,
                          fontSize: 12, fontWeight: 500,
                          fontStyle: 'italic', letterSpacing: '0.01em', lineHeight: 1.35,
                        }}>
                          {dish.subtitle}
                        </p>
                      )}
                      {dish.description && (
                        <p style={{
                          margin: '7px 0 0', color: C.muted, fontSize: 13, lineHeight: 1.5,
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {dish.description}
                        </p>
                      )}
                      <DietaryPills tags={dish.dietaryTags} />
                      {dish.price && (
                        <p style={{
                          margin: '10px 0 0', fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em',
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
            <div ref={categoryRef} style={{ scrollMarginTop: 72 }}>
              {selectedCat ? (
                /* ── Category dish list view ─────────────────────────────── */
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedCatId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'none', border: 'none', padding: '0 0 18px',
                      color: C.muted, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', letterSpacing: '0.01em',
                    }}
                  >
                    ← All categories
                  </button>
                  <SectionLabel>Our menu</SectionLabel>
                  <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '8px 0 0' }}>
                    {selectedCat.name}
                  </h2>
                  {selectedCat.description && (
                    <p style={{ margin: '8px 0 0', color: C.muted, fontSize: 14, lineHeight: 1.55 }}>
                      {selectedCat.description}
                    </p>
                  )}
                  <p style={{ margin: '6px 0 20px', color: C.sub, fontSize: 12, fontWeight: 500 }}>
                    {selectedCat.count > 0
                      ? `${selectedCat.count} ${selectedCat.count === 1 ? 'item' : 'items'}`
                      : 'Coming soon'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {selectedCat.dishes.length > 0
                      ? selectedCat.dishes.map(dish => (
                          <MenuDishCard key={dish.id} dish={dish} />
                        ))
                      : (
                        <p style={{ color: C.muted, fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
                          Dishes coming soon
                        </p>
                      )
                    }
                  </div>
                </div>
              ) : (
                /* ── Category tile grid ───────────────────────────────────── */
                <div>
                  <SectionLabel>Full menu</SectionLabel>
                  <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', margin: '8px 0 6px' }}>
                    Our menu
                  </h2>
                  <p style={{ margin: '0 0 20px', fontSize: 13, color: C.muted, lineHeight: 1.5, letterSpacing: '0.01em' }}>
                    Tap any section to explore
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {vm.allCategories.map(cat => (
                      <div
                        key={cat.id}
                        className="gh-cat-card"
                        role="button"
                        tabIndex={0}
                        style={{ padding: '16px 18px 18px', cursor: 'pointer' }}
                        onClick={() => setSelectedCatId(cat.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedCatId(cat.id);
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4, marginBottom: 4 }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: C.text, lineHeight: 1.25, letterSpacing: '-0.01em' }}>{cat.name}</p>
                          <span style={{ color: C.sub, fontSize: 16, flexShrink: 0, lineHeight: 1.2 }}>›</span>
                        </div>
                        {cat.description && (
                          <p style={{
                            margin: '0 0 0', color: C.muted, fontSize: 12, lineHeight: 1.5,
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {cat.description}
                          </p>
                        )}
                        <div style={{ marginTop: 9 }}>
                          <span style={{
                            display: 'inline-block',
                            fontSize: 10, fontWeight: 600, letterSpacing: '0.03em',
                            padding: '2px 7px', borderRadius: 4,
                            background: cat.count > 0 ? 'rgba(201,169,110,0.08)' : C.elevated,
                            color: cat.count > 0 ? C.goldDim : C.sub,
                            border: `1px solid ${cat.count > 0 ? 'rgba(201,169,110,0.18)' : C.border}`,
                          }}>
                            {cat.count > 0
                              ? `${cat.count} ${cat.count === 1 ? 'item' : 'items'}`
                              : 'Coming soon'}
                          </span>
                        </div>
                        {cat.dishes.length > 0 && (
                          <p style={{ margin: '7px 0 0', color: C.muted, fontSize: 11, lineHeight: 1.45,
                            overflow: 'hidden', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          }}>
                            {cat.dishes.slice(0, 3).map(d => d.name).join('  ·  ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Hours ─────────────────────────────────────────────────────────── */}
        {vm.hours && vm.hours.length > 0 && (
          <>
            <Rule />
            <div>
              <SectionLabel>Hours</SectionLabel>
              {(() => {
                const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long' });
                return (
                  <div style={{
                    marginTop: 14, background: C.surface,
                    border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden',
                  }}>
                    {vm.hours.map((h, i) => {
                      const isToday = h.label.toLowerCase() === todayLabel.toLowerCase();
                      return (
                        <div
                          key={h.label}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '14px 18px',
                            borderBottom: i < vm.hours!.length - 1 ? `1px solid ${C.borderSub}` : undefined,
                          }}
                        >
                          <span style={{ fontSize: 14, color: isToday ? C.gold : C.muted, fontWeight: isToday ? 600 : 400 }}>
                            {h.label}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: isToday ? 700 : 500, color: isToday ? C.gold : h.value === 'Closed' ? C.sub : C.text }}>
                            {h.value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* ── Social & contact ──────────────────────────────────────────────── */}
        {hasSocial && (
          <>
            <Rule />
            <div>
              <SectionLabel>Follow us</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {vm.socialLinks.map(link => (
                  <SocialRow key={link.platform} link={link} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Menu empty state ─────────────────────────────────────────────── */}
        {!hasMenuContent && (
          <>
            <Rule />
            <div style={{ textAlign: 'center', padding: '32px 0 8px' }}>
              <p style={{ color: C.gold, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
                Coming soon
              </p>
              <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, margin: '12px 0 0' }}>
                We're preparing our digital menu.<br />
                Ask our team for today's specials.
              </p>
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
    </ColorsCtx.Provider>
  );
}

// ─── Main exported page component ────────────────────────────────────────────
// Accepts a slug, handles all loading / error / not-found states, then
// delegates rendering to HubContent once data is ready.

export default function GuestHubPage({ slug, diningMode = false, isDemo = false }: { slug: string; diningMode?: boolean; isDemo?: boolean }) {
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

  // On live guest pages navigate to the real booking flow; on the admin
  // preview (/guest-hub-demo) keep the informational toast instead.
  const handleReserveAction = isDemo
    ? showDemoNotice
    : () => {
        if (hubState.status === 'ready') {
          try {
            sessionStorage.setItem(`gh_branding_${slug}`, JSON.stringify({
              primaryColor: hubState.data.primaryColor,
              themePreset:  hubState.data.themePreset,
            }));
          } catch { /* sessionStorage unavailable — private browsing or quota */ }
        }
        window.location.href = `/book/${encodeURIComponent(slug)}`;
      };

  if (hubState.status === 'loading')   return <GuestHubSkeleton />;
  if (hubState.status === 'not_found') return <GuestHubError notFound onRetry={() => {}} />;
  if (hubState.status === 'error')     return <GuestHubError onRetry={hubState.retry} />;

  return (
    <>
      <HubContent vm={hubState.data} onDemoAction={handleReserveAction} diningMode={diningMode} />
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
            background: ESPRESSO_PALETTE.surface,
            border: `1px solid ${ESPRESSO_PALETTE.border}`,
            borderRadius: 10,
            fontSize: 13,
            color: ESPRESSO_PALETTE.muted,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          }}
        >
          {isDemo
            ? 'This is a live preview — connect a restaurant to activate this action'
            : 'Online booking coming soon — call us or ask staff to reserve'}
        </div>
      )}
    </>
  );
}
