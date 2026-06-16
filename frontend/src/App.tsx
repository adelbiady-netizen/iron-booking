import { useState, useEffect } from 'react';
import { api, getStoredAuth, clearAuth, storeAuth, getStoredHQAuth, storeHQAuth, clearHQAuth, setSessionToken } from './api';
import HQLoginPage from './pages/HQLoginPage';
import SetupPage from './pages/SetupPage';
import AdminPortal from './pages/admin/AdminPortal';
import RestaurantPortal from './pages/admin/RestaurantPortal';
import ConfirmationPage from './pages/ConfirmationPage';
import BookingPage from './pages/BookingPage';
import WaitlistKioskPage from './pages/WaitlistKioskPage';
import RootPage from './pages/RootPage';
import RestaurantEntryPage from './pages/RestaurantEntryPage';
import PrivacyPage from './pages/legal/PrivacyPage';
import TermsPage from './pages/legal/TermsPage';
import AccessibilityPage from './pages/legal/AccessibilityPage';
import ContactPage from './pages/legal/ContactPage';
import GuestHubPage        from './features/guestHub/GuestHubPage';
import GuestHubQrRedirect  from './features/guestHub/GuestHubQrRedirect';
import GuestHubPreviewPage from './features/guestHub/GuestHubPreviewPage';
import FeedbackPage from './pages/FeedbackPage';
import JoinPage from './pages/JoinPage';
import type { AuthState } from './types';

export type Theme = 'dark' | 'light';

const ZOOM_MIN  = 75;
const ZOOM_MAX  = 150;

function clampZoom(v: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
}

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export default function App() {
  const [auth,             setAuth]             = useState<AuthState | null>(null);
  const [ready,            setReady]            = useState(false);
  const [bootstrapped,     setBootstrapped]     = useState(true);
  // When true, show email login even if iron_restaurant_id is set (Manager Login from HostSelectionScreen)
  const [forceLoginPage,   setForceLoginPage]   = useState(false);
  const [zoom,  setZoom]  = useState<number>(() =>
    clampZoom(parseInt(localStorage.getItem('iron_zoom') ?? '100'))
  );
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('iron_theme') as Theme | null;
    const t = stored === 'light' ? 'light' : 'dark';
    applyTheme(t);
    return t;
  });

  useEffect(() => {
    // Load auth from the correct store based on entry route.
    // /hq and /restaurant-admin use iron_hq_auth; everything else uses iron_auth.
    const isHQ = window.location.pathname.startsWith('/hq') || window.location.pathname.startsWith('/restaurant-admin');

    if (!isHQ) {
      // On any non-HQ route (including restaurant slug routes), sanitize iron_auth.
      // If it somehow contains an HQ/admin role, it was stored there by mistake —
      // clear it so the slug route renders HostSelectionScreen instead of redirecting to /hq.
      const candidate = getStoredAuth();
      const ADMIN_ROLES = ['SUPER_ADMIN', 'HQ_ADMIN', 'RESTAURANT_ADMIN'];
      if (candidate && ADMIN_ROLES.includes(candidate.user.role)) {
        clearAuth();
      }
    }

    const stored = isHQ ? getStoredHQAuth() : getStoredAuth();
    setSessionToken(stored?.token ?? null);
    setAuth(stored ?? null);

    api.admin.bootstrapStatus()
      .then(({ bootstrapped: b }) => setBootstrapped(b))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    localStorage.setItem('iron_zoom', String(zoom));
  }, [zoom]);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('iron_theme', theme);
  }, [theme]);

  // Proactive JWT refresh — runs every 5 minutes while logged in.
  // Refreshes when within 60 minutes of expiry so the SSE connection never
  // gets a 401 mid-shift due to the 8h (or configured) token lifetime.
  useEffect(() => {
    if (!auth) return;

    function decodeExp(token: string): number | null {
      try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        return typeof payload.exp === 'number' ? payload.exp : null;
      } catch {
        return null;
      }
    }

    async function tryRefresh() {
      if (!auth) return;
      const exp = decodeExp(auth.token);
      if (exp === null) return;
      const secsLeft = exp - Math.floor(Date.now() / 1000);
      if (secsLeft > 3600) return;
      console.log('[auth] token refresh scheduled — expires in', secsLeft, 's');
      try {
        const { token } = await api.auth.refresh();
        const isHQ = window.location.pathname.startsWith('/hq') || window.location.pathname.startsWith('/restaurant-admin');
        if (isHQ) {
          storeHQAuth(token, auth.user);
        } else {
          storeAuth(token, auth.user);
        }
        setSessionToken(token);
        setAuth(prev => prev ? { ...prev, token } : null);
        console.log('[auth] token refreshed successfully');
      } catch (err) {
        console.warn('[auth] token refresh failed', err);
      }
    }

    tryRefresh();
    const id = setInterval(tryRefresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [auth?.token]);

  function handleZoom(next: number) {
    setZoom(clampZoom(next));
  }

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }

  function handleLogin(token: string, user: AuthState['user']) {
    // Route to the correct auth store by role — never let HQ/admin roles pollute iron_auth.
    if (user.role === 'SUPER_ADMIN' || user.role === 'HQ_ADMIN') {
      storeHQAuth(token, user);
      setSessionToken(token);
      setAuth({ token, user });
      window.location.replace('/hq');
      return;
    }
    if (user.role === 'RESTAURANT_ADMIN') {
      storeHQAuth(token, user);
      setSessionToken(token);
      setAuth({ token, user });
      window.location.replace('/restaurant-admin');
      return;
    }
    // HOST / SERVER / MANAGER / OWNER / ADMIN — restaurant floor staff only.
    storeAuth(token, user);
    setSessionToken(token);
    setAuth({ token, user });
  }

  function handleLogout() {
    const isHQ = window.location.pathname.startsWith('/hq') || window.location.pathname.startsWith('/restaurant-admin');
    if (isHQ) {
      clearHQAuth();
    } else {
      clearAuth();
    }
    setSessionToken(null);
    setAuth(null);
    setForceLoginPage(false);
  }

  // Fast host switch — clears the JWT session but keeps iron_restaurant_id
  // so the Host Selection Screen appears immediately for the next staff member.
  function handleSwitchHost() {
    clearAuth();
    setSessionToken(null);
    setAuth(null);
    setForceLoginPage(false);
  }

  const scale = zoom / 100;

  const path = window.location.pathname;

  // ── Dedicated management-portal domains (portal.ironbooking.com, portal.iron-pos.com) ─
  // A portal domain serves the same SPA as www, but its root lands directly on
  // the HQ portal entry (/hq → login → AdminPortal / role-based redirect). Public
  // booking stays primary on www.ironbooking.com; existing www URLs are unchanged.
  const PORTAL_HOSTS = ['portal.ironbooking.com', 'portal.iron-pos.com'];
  const isPortalHost = PORTAL_HOSTS.includes(window.location.hostname);
  if (isPortalHost && (path === '/' || path === '')) {
    window.location.replace('/hq');
    return <></>; // navigation in progress — nothing to render
  }

  // ── /hq/logout ────────────────────────────────────────────────────────────
  // Clear HQ session and redirect to HQ login. Handled before all other
  // routes so it always executes regardless of auth state.
  if (path === '/hq/logout') {
    clearHQAuth();
    setSessionToken(null);
    window.location.replace('/hq');
    return <></>; // navigation in progress — nothing to render
  }

  // ── Guest-facing routes ────────────────────────────────────────────────────
  // Returned BEFORE the scale/overflow container so mobile browsers can scroll
  // naturally. The overflow:hidden on the app shell clips guest page content.
  // ── Guest Hub — isolated QR digital experience (frontend/src/features/guestHub/)
  //    Returns before auth, SSE, and the scale container are initialised.
  //    Removing: delete features/guestHub/ and revert these lines.
  if (path.startsWith('/r-preview/')) {
    const slug = path.split('/')[2];
    if (slug) return <GuestHubPreviewPage slug={slug} />;
  }
  if (path.startsWith('/r/')) {
    const slug        = path.split('/')[2];
    const diningMode  = new URLSearchParams(window.location.search).get('src') === 'qr';
    if (slug) return <GuestHubPage slug={slug} diningMode={diningMode} />;
  }
  if (path.startsWith('/q/')) {
    const token = path.split('/')[2];
    if (token) return <GuestHubQrRedirect token={token} />;
  }
  if (path === '/guest-hub-demo') return <GuestHubPage slug="ember-stone" isDemo />;

  if (path === '/privacy')      return <PrivacyPage />;
  if (path === '/terms')        return <TermsPage />;
  if (path === '/accessibility') return <AccessibilityPage />;
  if (path === '/contact')      return <ContactPage />;

  if (path === '/confirm') {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) return <ConfirmationPage token={token} />;
  }
  if (path.startsWith('/c/')) {
    const token = path.split('/')[2];
    if (token) return <ConfirmationPage token={token} />;
  }
  if (path.startsWith('/f/')) {
    const token = path.split('/')[2];
    if (token) return <FeedbackPage token={token} />;
  }
  if (path.startsWith('/join/')) {
    const token = path.split('/')[2];
    if (token) return <JoinPage token={token} />;
  }
  if (path.startsWith('/book/')) {
    const slug = path.split('/')[2];
    if (slug) return <BookingPage slug={slug} />;
  }
  if (path.startsWith('/waitlist/')) {
    const slug = path.split('/')[2];
    if (slug) return <WaitlistKioskPage slug={slug} />;
  }

  // ── /{slug} — Restaurant-specific entry point ────────────────────────────
  // Single-segment paths that aren't reserved routes are treated as restaurant
  // slugs. The RestaurantEntryPage validates the slug against the backend before
  // showing any login form, and enforces that the authenticated user belongs to
  // that specific restaurant.
  const RESERVED_SEGMENTS = new Set([
    'hq', 'restaurant-admin', 'book', 'waitlist', 'r', 'r-preview', 'q',
    'f', 'c', 'join', 'privacy', 'terms', 'accessibility', 'contact',
    'confirm', 'guest-hub-demo',
  ]);
  const pathParts = path.split('/').filter(Boolean);
  if (pathParts.length === 1 && !RESERVED_SEGMENTS.has(pathParts[0])) {
    const slug = pathParts[0];
    return (
      <div dir="ltr" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <div style={{
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          width:  `${100 / scale}%`,
          height: `${100 / scale}%`,
        }}>
          <RestaurantEntryPage
            slug={slug}
            auth={auth}
            ready={ready}
            onLogin={(token, user) => {
              setForceLoginPage(false);
              handleLogin(token, user);
            }}
            onLogout={handleLogout}
            onSwitchHost={localStorage.getItem('iron_restaurant_id') ? handleSwitchHost : undefined}
            zoom={zoom}
            onZoomChange={handleZoom}
            theme={theme}
            onThemeChange={toggleTheme}
            forceLoginPage={forceLoginPage}
            onForceLoginPage={() => setForceLoginPage(true)}
            onClearForceLoginPage={() => setForceLoginPage(false)}
          />
        </div>
      </div>
    );
  }

  // ── /hq — dedicated HQ portal (completely self-contained) ───────────────────
  if (path === '/hq') {
    // Wait for auth to be read from storage before deciding what to render
    if (!ready) {
      return (
        <div className="h-screen bg-iron-bg flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    // Not logged in → HQ login screen
    if (!auth) {
      return <HQLoginPage onLogin={handleLogin} />;
    }

    // Logged in but wrong role — redirect RESTAURANT_ADMIN to their portal;
    // other low-privilege roles see an access-denied screen without being signed out.
    const isHQRole = auth.user.role === 'SUPER_ADMIN' || auth.user.role === 'HQ_ADMIN';
    if (!isHQRole) {
      if (auth.user.role === 'RESTAURANT_ADMIN') {
        window.location.replace('/restaurant-admin');
        return <></>;
      }
      return (
        <div className="h-screen bg-iron-bg flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2.5">
                <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm tracking-tight">IB</span>
                </div>
                <span className="text-iron-text font-semibold text-xl tracking-tight">Iron Booking HQ</span>
              </div>
            </div>
            <div className="bg-iron-card border border-iron-border rounded-xl p-6 mb-4 text-center">
              <p className="text-iron-text font-medium mb-1">Not authorized for HQ access</p>
              <p className="text-iron-muted text-sm">
                Your account ({auth.user.email ?? `${auth.user.firstName} ${auth.user.lastName}`}) does not have HQ privileges.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <a
                href="/"
                className="w-full text-center bg-iron-green hover:bg-iron-green-light text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                ← Back to Host Dashboard
              </a>
              <button
                onClick={handleLogout}
                className="w-full text-center text-iron-muted text-xs py-2 hover:text-iron-text transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      );
    }

    // SUPER_ADMIN — render AdminPortal inside the scale container.
    // onDashboard is intentionally omitted: HQ users should not switch to
    // the restaurant-facing host dashboard from this route.
    return (
      <div dir="ltr" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <div style={{
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          width:  `${100 / scale}%`,
          height: `${100 / scale}%`,
        }}>
          <AdminPortal
            auth={auth}
            onLogout={handleLogout}
          />
        </div>
      </div>
    );
  }

  // ── /restaurant-admin — scoped portal for RESTAURANT_ADMIN ───────────────────
  if (path.startsWith('/restaurant-admin')) {
    if (!ready) {
      return (
        <div className="h-screen bg-iron-bg flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (!auth) {
      return <HQLoginPage onLogin={handleLogin} />;
    }
    if (auth.user.role !== 'RESTAURANT_ADMIN') {
      window.location.replace('/hq');
      return <></>;
    }
    return (
      <div dir="ltr" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <RestaurantPortal auth={auth} onLogout={handleLogout} />
      </div>
    );
  }

  function renderPage() {
    if (!ready) {
      return (
        <div className="h-full bg-iron-bg flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    // First-time setup (no restaurant configured yet)
    if (!bootstrapped) {
      return (
        <SetupPage
          onSetup={(token, user) => {
            handleLogin(token, user);
            setBootstrapped(true);
          }}
        />
      );
    }

    // Root / — no generic login. Redirect HQ users to /hq, everyone else sees
    // the "use your restaurant link" landing page.
    if (auth?.user.role === 'SUPER_ADMIN' || auth?.user.role === 'HQ_ADMIN') {
      window.location.replace('/hq');
      return <></>;
    }

    return <RootPage />;
  }

  return (
    <div dir="ltr" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div style={{
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        width:  `${100 / scale}%`,
        height: `${100 / scale}%`,
      }}>
        {renderPage()}
      </div>
    </div>
  );
}
