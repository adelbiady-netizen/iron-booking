import { useTranslation } from 'react-i18next';

// Active legal links.
const LINKS = [
  { key: 'privacy',       href: 'https://www.ironbooking.com/privacy' },
  { key: 'terms',         href: 'https://www.ironbooking.com/terms' },
  { key: 'accessibility', href: 'https://www.ironbooking.com/accessibility' },
  { key: 'contact',       href: 'https://www.ironbooking.com/contact' },
] as const;

export interface PublicFooterRestaurant {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  googleMapsUrl?: string | null;
  wazeUrl?: string | null;
}

interface Props {
  visible?: boolean;
  restaurant?: PublicFooterRestaurant | null;
}

export function PublicFooter({ visible = true, restaurant }: Props) {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  if (!visible) return null;

  const hasAddress = !!restaurant?.address;
  const hasPhone   = !!restaurant?.phone;
  const hasMaps    = !!restaurant?.googleMapsUrl;
  const hasWaze    = !!restaurant?.wazeUrl;
  const hasWeb     = !!restaurant?.websiteUrl;
  const hasInsta   = !!restaurant?.instagramUrl;
  const hasPills   = hasPhone || hasMaps || hasWaze || hasWeb || hasInsta;
  const hasRestaurantSection = hasAddress || hasPills;

  const pillBase: React.CSSProperties = {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            '5px',
    padding:        '6px 14px',
    borderRadius:   '999px',
    border:         '1px solid rgba(93,127,50,0.32)',
    background:     'rgba(93,127,50,0.10)',
    color:          'rgba(205,228,165,0.88)',
    fontSize:       '12px',
    fontWeight:     500,
    textDecoration: 'none',
    transition:     'background 0.15s, color 0.15s, border-color 0.15s',
    whiteSpace:     'nowrap',
  };

  function pillEnter(e: React.MouseEvent<HTMLAnchorElement>) {
    const el = e.currentTarget;
    el.style.background  = 'rgba(93,127,50,0.22)';
    el.style.borderColor = 'rgba(93,127,50,0.58)';
    el.style.color       = 'rgba(222,244,182,1)';
  }
  function pillLeave(e: React.MouseEvent<HTMLAnchorElement>) {
    const el = e.currentTarget;
    el.style.background  = 'rgba(93,127,50,0.10)';
    el.style.borderColor = 'rgba(93,127,50,0.32)';
    el.style.color       = 'rgba(205,228,165,0.88)';
  }

  return (
    <footer className="pub-footer" aria-label="Iron Booking">
      <div className="pub-footer-inner">

      {/* ── Restaurant info section ─────────────────────────────────────── */}
      {hasRestaurantSection && (
        <div
          style={{
            width:        '100%',
            marginBottom: '20px',
            textAlign:    'center',
          }}
        >
          {hasAddress && (
            <p
              style={{
                fontSize:    '13px',
                lineHeight:  1.6,
                color:       'rgba(200,224,158,0.72)',
                marginBottom: hasPills ? '12px' : '0',
              }}
            >
              {restaurant!.address}
            </p>
          )}

          {hasPills && (
            <div
              dir="ltr"
              style={{
                display:        'flex',
                flexWrap:       'wrap',
                gap:            '8px',
                justifyContent: 'center',
              }}
            >
              {hasPhone && (
                <a
                  href={`tel:${restaurant!.phone}`}
                  style={pillBase}
                  onMouseEnter={pillEnter}
                  onMouseLeave={pillLeave}
                  aria-label={t('common.call')}
                >
                  <PhoneIcon />
                  {t('common.call')}
                </a>
              )}
              {hasMaps && (
                <a
                  href={restaurant!.googleMapsUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={pillBase}
                  onMouseEnter={pillEnter}
                  onMouseLeave={pillLeave}
                  aria-label={t('common.maps')}
                >
                  <PinIcon />
                  {t('common.maps')}
                </a>
              )}
              {hasWaze && (
                <a
                  href={restaurant!.wazeUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={pillBase}
                  onMouseEnter={pillEnter}
                  onMouseLeave={pillLeave}
                  aria-label={t('common.waze')}
                >
                  <CarIcon />
                  {t('common.waze')}
                </a>
              )}
              {hasWeb && (
                <a
                  href={restaurant!.websiteUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={pillBase}
                  onMouseEnter={pillEnter}
                  onMouseLeave={pillLeave}
                  aria-label={t('common.website')}
                >
                  <GlobeIcon />
                  {t('common.website')}
                </a>
              )}
              {hasInsta && (
                <a
                  href={restaurant!.instagramUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={pillBase}
                  onMouseEnter={pillEnter}
                  onMouseLeave={pillLeave}
                  aria-label={t('common.instagram')}
                >
                  <InstagramIcon />
                  {t('common.instagram')}
                </a>
              )}
            </div>
          )}

          {/* Thin rule between restaurant and platform sections */}
          <div
            aria-hidden="true"
            style={{
              margin:     '20px auto 0',
              width:      '40px',
              height:     '1px',
              background: 'rgba(93,127,50,0.40)',
            }}
          />
        </div>
      )}

      {/* ── Iron Booking wordmark ───────────────────────────────────────── */}
      <p className="pub-footer-brand" aria-label="Iron Booking">
        <span className="pub-footer-diamond" aria-hidden="true">◆</span>
        IRON BOOKING
      </p>

      {/* ── Legal nav ──────────────────────────────────────────────────── */}
      <nav aria-label={t('footer.navLabel')}>
        <ul className="pub-footer-links" role="list">
          {LINKS.map(l => (
            <li key={l.key}>
              <a
                href={l.href}
                className="pub-footer-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(`footer.${l.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── Copyright ──────────────────────────────────────────────────── */}
      <p className="pub-footer-copy">{t('footer.copyright', { year })}</p>

      </div>{/* /pub-footer-inner */}
    </footer>
  );
}

// ─── SVG icons ─────────────────────────────────────────────────────────────────

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, flexShrink: 0 }} fill="currentColor" aria-hidden="true">
      <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, flexShrink: 0 }} fill="currentColor" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, flexShrink: 0 }} fill="currentColor" aria-hidden="true">
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, flexShrink: 0 }} fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, flexShrink: 0 }} fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}
