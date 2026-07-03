import type React from 'react';

// Inline stroke icons for the Management Workspace shell. The app has no icon
// library; these match the existing inline-SVG convention (fill none, currentColor
// stroke). Size + color inherit from the parent (font-size independent, 18px default).

export type IconProps = { size?: number; className?: string };

function make(path: React.ReactNode) {
  return function Icon({ size = 18, className }: IconProps) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {path}
      </svg>
    );
  };
}

// ── Module icons ────────────────────────────────────────────────────────────────
export const IcoDashboard  = make(<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>);
export const IcoOperations = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IcoFloor      = make(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>);
export const IcoGuests     = make(<><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 8.5a3 3 0 0 1 0 5M17.5 20a5.5 5.5 0 0 0-2-4.2" /></>);
export const IcoMarketing  = make(<><path d="M4 10v4a1 1 0 0 0 1 1h2l4 4V5L7 9H5a1 1 0 0 0-1 1z" /><path d="M16 9a4 4 0 0 1 0 6" /></>);
export const IcoAnalytics  = make(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IcoAdmin      = make(<><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9.5 12l1.8 1.8L15 10" /></>);

// ── Chrome icons ─────────────────────────────────────────────────────────────────
export const IcoChevronStart = make(<path d="M15 6l-6 6 6 6" />);   // "back" in RTL
export const IcoBell         = make(<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>);
export const IcoSearch       = make(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>);
export const IcoMenu         = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IcoClose        = make(<path d="M6 6l12 12M18 6L6 18" />);
