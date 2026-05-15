import '../GuestHubPage.css';

const C = {
  bg:      '#0C0A09',
  surface: '#141210',
  border:  '#28231E',
  text:    '#F0EBE3',
  muted:   '#7A6F65',
  sub:     '#4A4139',
  gold:    '#C9A96E',
} as const;

interface Props {
  onRetry: () => void;
  notFound?: boolean;
}

export default function GuestHubError({ onRetry, notFound = false }: Props) {
  return (
    <div style={{
      backgroundColor: C.bg,
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>

        {/* Icon housing */}
        <div style={{
          width: 60,
          height: 60,
          margin: '0 auto 24px',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {notFound ? (
            // QR / broken link icon
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M14 14h3v3M17 20h3M20 17v3"/>
            </svg>
          ) : (
            // Wifi-off / connection icon
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
              <line x1="12" y1="20" x2="12.01" y2="20"/>
            </svg>
          )}
        </div>

        <h2 style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '0 0 10px',
          color: C.text,
        }}>
          {notFound ? 'Page not found' : 'Something went wrong'}
        </h2>

        <p style={{
          fontSize: 14,
          color: C.muted,
          lineHeight: 1.65,
          margin: '0 0 32px',
        }}>
          {notFound
            ? 'This restaurant page may have moved or the QR code may be outdated. Please ask staff for the current link.'
            : "We couldn’t reach the restaurant right now. Check your connection and try again."}
        </p>

        {!notFound && (
          <button
            type="button"
            className="gh-cta"
            onClick={onRetry}
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${C.border}`,
              color: C.gold,
              fontSize: 14,
              fontWeight: 600,
              padding: '12px 32px',
              borderRadius: 10,
              letterSpacing: '0.01em',
            }}
          >
            Try again
          </button>
        )}

      </div>
    </div>
  );
}
