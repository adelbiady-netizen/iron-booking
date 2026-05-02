import { useState, useEffect } from 'react';
import { api, getStoredAuth, clearAuth, storeAuth } from './api';
import LoginPage from './pages/LoginPage';
import HostDashboard from './pages/HostDashboard';
import SetupPage from './pages/SetupPage';
import AdminPortal from './pages/admin/AdminPortal';
import ConfirmationPage from './pages/ConfirmationPage';
import BookingPage from './pages/BookingPage';
import type { AuthState } from './types';

export type Theme = 'dark' | 'light';

const ZOOM_MIN  = 75;
const ZOOM_MAX  = 150;
const ZOOM_STEP = 10;

function clampZoom(v: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
}

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export default function App() {
  const [auth,         setAuth]         = useState<AuthState | null>(null);
  const [ready,        setReady]        = useState(false);
  const [bootstrapped, setBootstrapped] = useState(true);
  // SUPER_ADMIN can toggle between AdminPortal and HostDashboard
  const [adminView,    setAdminView]    = useState(true);
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
    setAuth(getStoredAuth());
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

  function handleZoom(next: number) {
    setZoom(clampZoom(next));
  }

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }

  function handleLogin(token: string, user: AuthState['user']) {
    storeAuth(token, user);
    const authState = { token, user };
    setAuth(authState);
    // SUPER_ADMIN defaults to Admin Portal
    setAdminView(user.role === 'SUPER_ADMIN');
  }

  function handleLogout() {
    clearAuth();
    setAuth(null);
    setAdminView(true);
  }

  const scale = zoom / 100;

  // ── Guest-facing routes ────────────────────────────────────────────────────
  // Returned BEFORE the scale/overflow container so mobile browsers can scroll
  // naturally. The overflow:hidden on the app shell clips guest page content.
  const path = window.location.pathname;
  if (path === '/confirm') {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) return <ConfirmationPage token={token} />;
  }
  if (path.startsWith('/book/')) {
    const slug = path.split('/')[2];
    if (slug) return <BookingPage slug={slug} />;
  }

  function renderPage() {
    if (!ready) {
      return (
        <div className="h-full bg-iron-bg flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    if (auth?.user.role === 'SUPER_ADMIN') {
      if (adminView) {
        return (
          <AdminPortal
            auth={auth}
            onLogout={handleLogout}
            onDashboard={() => setAdminView(false)}
          />
        );
      }
      // SUPER_ADMIN viewing host dashboard — shows system restaurant (empty)
      return (
        <HostDashboard
          auth={auth}
          zoom={zoom}
          zoomStep={ZOOM_STEP}
          onZoomChange={handleZoom}
          onLogout={handleLogout}
          theme={theme}
          onThemeChange={toggleTheme}
          onAdminPortal={() => setAdminView(true)}
        />
      );
    }

    if (!auth && !bootstrapped) {
      return (
        <SetupPage
          onSetup={(token, user) => {
            handleLogin(token, user);
            setBootstrapped(true);
          }}
        />
      );
    }

    if (!auth) {
      return (
        <LoginPage onLogin={handleLogin} />
      );
    }

    return (
      <HostDashboard
        auth={auth}
        zoom={zoom}
        zoomStep={ZOOM_STEP}
        onZoomChange={handleZoom}
        onLogout={handleLogout}
        theme={theme}
        onThemeChange={toggleTheme}
      />
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
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
