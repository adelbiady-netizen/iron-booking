import { createPortal } from 'react-dom';
import { getStoredAuth } from '../api';

function getBuildHash(): string {
  try {
    // Vite puts the JS bundle in <script src="/assets/index-HASH.js">
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
    const bundle = scripts.find(s => s.src.includes('/assets/index-'));
    if (bundle) {
      const match = bundle.src.match(/index-([^.]+)\.js/);
      if (match) return match[1];
    }
  } catch { /* ignore */ }
  return 'unknown';
}

function getManifestHref(): string {
  try {
    return document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? '—';
  } catch { return '—'; }
}

function getSwStatus(): string {
  try {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const ctrl = navigator.serviceWorker.controller;
    if (!ctrl) return 'none / not controlling';
    return ctrl.scriptURL;
  } catch { return 'error'; }
}

export default function PwaDiagnosticsOverlay() {
  const show = new URLSearchParams(window.location.search).get('debugPwa') === '1';
  if (!show) return null;

  const auth  = getStoredAuth();
  const isStandalone  = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone ?? false;

  const rows: [string, string, boolean?][] = [
    ['href',                 window.location.href],
    ['pathname',             window.location.pathname],
    ['search',               window.location.search || '(none)'],
    ['display-mode standalone', String(isStandalone),   isStandalone],
    ['navigator.standalone', String(iosStandalone),      iosStandalone],
    ['manifest href',        getManifestHref()],
    ['SW active',            getSwStatus()],
    ['build hash',           getBuildHash()],
    ['─',                    ''],
    ['has stored auth',      String(!!auth),             !!auth],
    ['auth.role',            auth?.user?.role ?? 'null'],
    ['auth.restaurant.slug', auth?.user?.restaurant?.slug ?? 'null', !!auth?.user?.restaurant?.slug],
    ['auth.restaurant.name', auth?.user?.restaurant?.name ?? 'null'],
  ];

  const card = (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: '#0d0d0d',
        borderTop: '2px solid #ef4444',
        padding: '12px 16px 20px',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.7,
        color: '#d1d5db',
        overflowY: 'auto',
        maxHeight: '55vh',
      }}
      dir="ltr"
    >
      <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 12, marginBottom: 8 }}>
        PWA DIAGNOSTICS — ?debugPwa=1
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([label, value, good]) => {
            if (label === '─') {
              return (
                <tr key="sep">
                  <td colSpan={2} style={{ borderTop: '1px solid #333', paddingTop: 4, paddingBottom: 2 }} />
                </tr>
              );
            }
            const valueColor =
              good === true  ? '#86efac' :
              good === false ? '#f87171' :
              value.startsWith('blob:') ? '#fbbf24' :
              value === 'null' || value === 'none / not controlling' || value === 'unknown' ? '#f87171' :
              '#e2e8f0';
            return (
              <tr key={label}>
                <td style={{ color: '#9ca3af', paddingRight: 12, whiteSpace: 'nowrap', verticalAlign: 'top', width: '40%' }}>
                  {label}
                </td>
                <td style={{ color: valueColor, wordBreak: 'break-all' }}>
                  {value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return createPortal(card, document.body);
}
