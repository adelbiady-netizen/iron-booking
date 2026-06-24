import { getStoredAuth } from '../api';

// Build stamp injected at build time — Vite replaces these at bundle time.
// Falls back gracefully if not configured.
declare const __APP_VERSION__: string | undefined;
declare const __GIT_COMMIT__: string | undefined;

function PwaDiagnostic() {
  const auth = getStoredAuth();

  // All localStorage keys (auth-related and all)
  const lsKeys: string[] = [];
  const lsAuthKeys: Record<string, string | null> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        lsKeys.push(k);
        if (k.includes('iron') || k.includes('auth') || k.includes('pwa') || k.includes('token')) {
          lsAuthKeys[k] = localStorage.getItem(k);
        }
      }
    }
  } catch { /* blocked */ }

  const swController = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? (navigator.serviceWorker.controller?.scriptURL ?? 'none')
    : 'unsupported';

  const displayModeStandalone =
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    typeof window !== 'undefined' &&
    (window.navigator as { standalone?: boolean }).standalone === true;

  const buildVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'n/a';
  const gitCommit   = typeof __GIT_COMMIT__   !== 'undefined' ? __GIT_COMMIT__   : 'n/a';

  const rows: [string, string][] = [
    ['href',              window.location.href],
    ['pathname',          window.location.pathname],
    ['search',            window.location.search || '(none)'],
    ['display-mode standalone', String(displayModeStandalone)],
    ['navigator.standalone',    String(iosStandalone)],
    ['SW controller',           swController],
    ['build version',           buildVersion],
    ['git commit',              gitCommit],
    ['─── auth ───',            ''],
    ['has stored auth',         String(!!auth)],
    ['auth.user.role',          auth?.user?.role ?? 'null'],
    ['auth.user.restaurant',    auth?.user?.restaurant ? JSON.stringify({ id: auth.user.restaurant.id, slug: auth.user.restaurant.slug, name: auth.user.restaurant.name }) : 'null'],
    ['─── localStorage ───',    ''],
    ['all keys',                lsKeys.join(', ') || '(empty)'],
  ];
  for (const [k, v] of Object.entries(lsAuthKeys)) {
    // Truncate values so they fit; never log the raw JWT
    const safe = v && v.length > 80 ? v.slice(0, 80) + '…' : (v ?? 'null');
    rows.push([`  ${k}`, safe]);
  }

  return (
    <div
      dir="ltr"
      style={{
        marginTop: 24,
        background: '#0a0a0a',
        border: '1.5px solid #ef4444',
        borderRadius: 10,
        padding: '12px 14px',
        textAlign: 'left',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.65,
        color: '#ccc',
        wordBreak: 'break-all',
      }}
    >
      <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 6, fontSize: 12 }}>
        PWA DIAGNOSTIC — ironbooking.com/?debugPwa=1
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {rows.map(([label, value]) =>
            label.startsWith('─') ? (
              <tr key={label}>
                <td colSpan={2} style={{ color: '#666', paddingTop: 6, paddingBottom: 2, fontSize: 10 }}>
                  {label}
                </td>
              </tr>
            ) : (
              <tr key={label}>
                <td style={{ color: '#888', paddingRight: 10, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                  {label}
                </td>
                <td style={{ color: value === 'null' || value === 'false' || value === 'none' ? '#f87171' : '#86efac' }}>
                  {value}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function RootPage() {
  const auth = getStoredAuth();
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true);

  // PWA fallback: if we have a last-visited slug, redirect immediately.
  // This fires when iOS ignores manifest start_url and opens "/" instead of "/slug".
  const lastSlug = (() => { try { return localStorage.getItem('iron_last_slug') ?? null; } catch { return null; } })();

  console.warn('[RootPage] rendered', {
    href: window.location.href,
    isStandalone,
    hasAuth: !!auth,
    role: auth?.user?.role ?? null,
    restaurant: auth?.user?.restaurant ?? null,
    lastSlug,
  });

  const showDiag = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debugPwa') === '1';

  return (
    <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm text-center">

        <div className="inline-flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm tracking-tight">IB</span>
          </div>
          <span className="text-iron-text font-semibold text-xl tracking-tight">Iron Booking</span>
        </div>

        <div className="bg-iron-card border border-iron-border rounded-xl p-8 mb-4">
          <a
            href="/eataliano-dalla-costa"
            className="block w-full bg-iron-green text-white font-semibold text-base rounded-lg px-4 py-4 text-center mb-6"
          >
            כניסה לאיטליאנו דלה קוסטה
          </a>

          <p className="text-iron-text font-semibold text-base mb-2">
            קיבלתם קישור מסעדה מ-IRON Booking
          </p>
          <p className="text-iron-muted text-sm mb-6">
            הכניסה למערכת מתבצעת דרך הקישור הייחודי של המסעדה שלכם.
          </p>

          <div className="bg-iron-bg border border-iron-border rounded-lg px-4 py-3 mb-4 text-left" dir="ltr">
            <p className="text-iron-muted text-xs mb-1">דוגמה:</p>
            <p className="text-iron-green text-sm font-mono">ironbooking.com/your-restaurant</p>
          </div>

          <p className="text-iron-muted text-sm">
            לא מכירים את הקישור שלכם?<br />
            <span className="text-iron-text">פנו למנהל המסעדה לקבלת הקישור.</span>
          </p>
        </div>

        <p className="text-iron-muted text-xs">Iron Booking · מערכת ניהול הזמנות</p>

        {showDiag && <PwaDiagnostic />}

      </div>
    </div>
  );
}
