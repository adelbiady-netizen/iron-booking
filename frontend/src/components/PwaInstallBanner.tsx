import { useState, useEffect } from 'react';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  return (
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

const DISMISS_KEY = 'iron-pwa-banner-dismissed';

export default function PwaInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem(DISMISS_KEY);
    if (!dismissed && isIos() && !isInStandaloneMode()) {
      // Small delay so it doesn't flash before layout settles
      const t = setTimeout(() => setVisible(true), 1800);
      return () => clearTimeout(t);
    }
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      dir="rtl"
      role="status"
      className="flex items-center gap-3 px-4 py-2.5 bg-iron-elevated border-b border-iron-border/40 text-iron-text text-[12px] leading-snug"
      style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}
    >
      {/* App icon placeholder */}
      <span
        className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-white text-base font-bold"
        style={{ background: '#435B2A' }}
        aria-hidden="true"
      >
        IB
      </span>

      <span className="flex-1">
        <strong className="font-semibold">הוסף למסך הבית</strong>
        <span className="text-iron-muted"> — לחץ </span>
        {/* iOS share icon ⬆︎ */}
        <svg
          className="inline-block align-middle mx-0.5 text-iron-muted"
          width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        <span className="text-iron-muted"> ואז </span>
        <strong className="font-medium">"הוסף למסך הבית"</strong>
      </span>

      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 w-6 h-6 flex items-center justify-center text-iron-muted hover:text-iron-text rounded transition-colors"
        aria-label="סגור"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
