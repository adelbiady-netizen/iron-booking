// ─── QR token resolver ────────────────────────────────────────────────────────
// Mounted at /q/:token in App.tsx.
// Resolves a stable QR token → hub slug, then redirects to /r/:slug.
// The stable token means QR codes never need reprinting when a slug changes.
//
// ISOLATION: no reservation, waitlist, floor, or SSE imports.

import { useEffect, useState } from 'react';
import { BASE } from '../../api';
import './GuestHubPage.css';
import { useHubMeta } from './hooks/useHubMeta';

const C = {
  bg:      '#0C0A09',
  surface: '#141210',
  border:  '#28231E',
  muted:   '#7A6F65',
  sub:     '#4A4139',
  gold:    '#C9A96E',
} as const;

const HUB_BASE = BASE.replace(/\/api$/, '');

export default function GuestHubQrRedirect({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);

  // QR redirect pages must never be indexed — slug is unknown until resolved.
  useHubMeta(null, '', 'noindex, nofollow');

  useEffect(() => {
    fetch(`${HUB_BASE}/api/public/hub/q/${encodeURIComponent(token)}`)
      .then(res => {
        if (!res.ok) throw new Error('not_found');
        return res.json() as Promise<{ slug: string }>;
      })
      .then(({ slug }) => {
        window.location.replace(`/r/${slug}?src=qr`);
      })
      .catch(() => {
        setError('This QR code is no longer active. Please ask staff for assistance.');
      });
  }, [token]);

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
      {error ? (
        <div style={{ maxWidth: 300, textAlign: 'center' }}>
          <div style={{
            width: 52,
            height: 52,
            margin: '0 auto 20px',
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M14 14h3v3M17 20h3M20 17v3"/>
            </svg>
          </div>
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
            {error}
          </p>
        </div>
      ) : (
        /* Gold ring spinner — resolving takes < 1s on a fast API */
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: `2px solid rgba(201,169,110,0.15)`,
          borderTopColor: C.gold,
          animation: 'gh-spin 0.8s linear infinite',
        }} />
      )}
    </div>
  );
}
