import { useState, useEffect, useRef } from 'react';
import { api, storeAuth, clearAuth, setSessionToken } from '../api';
import HostSelectionScreen from './HostSelectionScreen';
import HostDashboard from './HostDashboard';
import CinematicRestaurantIntro from '../components/CinematicRestaurantIntro';
import PwaInstallBanner from '../components/PwaInstallBanner';
import { useRestaurantManifest } from '../hooks/useRestaurantManifest';
import { useIsMobile } from '../hooks/useIsMobile';
import type { AuthState, AuthUser } from '../types';
import type { Theme } from '../App';

const ZOOM_STEP = 10;

interface RestaurantInfo {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

interface Props {
  slug: string;
  auth: AuthState | null;
  ready: boolean;
  onLogin: (token: string, user: AuthUser) => void;
  onLogout: () => void;
  onSwitchHost: (() => void) | undefined;
  zoom: number;
  onZoomChange: (n: number) => void;
  theme: Theme;
  onThemeChange: () => void;
  forceLoginPage: boolean;
  onForceLoginPage: () => void;
  onClearForceLoginPage: () => void;
}

export default function RestaurantEntryPage(props: Props) {
  const {
    slug, auth, ready,
    onLogin, onLogout, onSwitchHost,
    zoom, onZoomChange, theme, onThemeChange,
    forceLoginPage, onForceLoginPage, onClearForceLoginPage,
  } = props;

  const [info,           setInfo]           = useState<RestaurantInfo | null | 'not_found'>('loading' as unknown as null);
  const [loadingSlug,    setLoadingSlug]    = useState(true);
  const [slugMismatch,   setSlugMismatch]   = useState(false);
  const introKey = `iron_intro_seen_${slug}`;
  const [showIntro, setShowIntro] = useState(false);
  const authRef = useRef(auth);
  useEffect(() => { authRef.current = auth; }, [auth]);

  // Inject a restaurant-specific manifest so "Add to Home Screen" saves
  // start_url = /slug, not /. Uses a real server URL (/api/manifest?slug=)
  // because iOS Safari ignores blob: manifest URLs.
  useRestaurantManifest(slug);

  const isMobile = useIsMobile();

  // Email login form state
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [formErr,  setFormErr]  = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoadingSlug(true);
    setSlugMismatch(false);
    setShowIntro(false);
    api.public.getRestaurantBySlug(slug)
      .then(r => {
        setInfo(r);
        // Persist slug so PWA fallback in RootPage can redirect here if start_url=/ fires
        try { localStorage.setItem('iron_last_slug', slug); } catch { /* blocked */ }
        // Show intro only when unauthenticated and not already seen this session
        if (!authRef.current && !sessionStorage.getItem(`iron_intro_seen_${slug}`)) {
          setShowIntro(true);
        }
      })
      .catch(() => setInfo('not_found' as unknown as null))
      .finally(() => setLoadingSlug(false));
  }, [slug]);

  // After auth resolves, check restaurant match.
  // Guard against the 'loading' initial value — info starts as the string 'loading'
  // which is truthy, so typeof check is required to avoid a false mismatch before
  // the API call resolves.
  useEffect(() => {
    if (!auth || !info || typeof info === 'string') return;
    const restaurant = (info as RestaurantInfo);

    // IDs match → user belongs to this restaurant (slug may just be stale in cache).
    if (auth.user.restaurant?.id === restaurant.id) {
      if (auth.user.restaurant.slug !== restaurant.slug) {
        // Heal the stale slug in localStorage so future refreshes don't hit this branch.
        storeAuth(auth.token, {
          ...auth.user,
          restaurant: { ...auth.user.restaurant, slug: restaurant.slug },
        });
      }
      setSlugMismatch(false);
      return;
    }

    // Slugs match → same restaurant (id may be missing from an old token cache).
    if (auth.user.restaurant?.slug === restaurant.slug) {
      setSlugMismatch(false);
      return;
    }

    // Neither id nor slug matches → auth belongs to a different restaurant.
    // Clear silently so the host sees the PIN login screen for THIS restaurant.
    clearAuth();
    setSessionToken(null);
    onLogout();
  }, [auth, info, onLogout]);

  function wrapLogin(token: string, user: AuthUser) {
    setSlugMismatch(false);
    onClearForceLoginPage();
    onLogin(token, user);
    // If they authenticated against a different restaurant, redirect to correct slug
    const restaurant = info as RestaurantInfo | null;
    if (restaurant && (restaurant as unknown as string) !== 'not_found') {
      if (user.restaurant?.slug && user.restaurant.slug !== restaurant.slug) {
        window.location.replace(`/${user.restaurant.slug}`);
        return;
      }
    }
    if (user.restaurant?.id) {
      localStorage.setItem('iron_restaurant_id', user.restaurant.id);
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    setFormBusy(true);
    try {
      const r = await api.auth.login(email, password);
      if (r.user.restaurant?.id) {
        localStorage.setItem('iron_restaurant_id', r.user.restaurant.id);
      }
      wrapLogin(r.token, r.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאת כניסה';
      const isWrong = msg.toLowerCase().includes('invalid') ||
        msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('401');
      setFormErr(isWrong ? 'אימייל או סיסמה שגויים.' : msg);
      passwordRef.current?.select();
    } finally {
      setFormBusy(false);
    }
  }

  // ── Spinner while loading slug ────────────────────────────────────────────
  if (loadingSlug || (!ready && !info)) {
    return (
      <div className="h-full bg-iron-bg flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Restaurant not found ─────────────────────────────────────────────────
  if (!info || (info as unknown as string) === 'not_found') {
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
            <p className="text-status-danger font-semibold text-base mb-2">מסעדה לא נמצאה</p>
            <p className="text-iron-muted text-sm mb-4">
              הקישור <span className="font-mono text-iron-text">/{slug}</span> אינו מוכר במערכת.
            </p>
            <p className="text-iron-muted text-sm">
              בדקו שהכתובת נכונה, או פנו למנהל המסעדה.
            </p>
          </div>
          <a href="/" className="text-iron-muted text-xs hover:text-iron-text transition-colors">
            ← חזרה לדף הבית
          </a>
        </div>
      </div>
    );
  }

  const restaurant = info as RestaurantInfo;

  // ── App not ready yet ────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="h-full bg-iron-bg flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Auth set but wrong restaurant ────────────────────────────────────────
  // slugMismatch is the authoritative flag — set by the useEffect above which
  // compares restaurant.id first, then slug, and clears auth for true mismatches.
  if (auth && slugMismatch) {
    // HQ/SUPER_ADMIN don't have a restaurant slug — redirect them cleanly
    if (auth.user.role === 'SUPER_ADMIN' || auth.user.role === 'HQ_ADMIN') {
      window.location.replace('/hq');
      return <></>;
    }
    return (
      <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2.5">
              <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm tracking-tight">IB</span>
              </div>
              <span className="text-iron-text font-semibold text-xl tracking-tight">{restaurant.name}</span>
            </div>
          </div>
          <div className="bg-iron-card border border-iron-border rounded-xl p-6 mb-4 text-center">
            <p className="text-status-danger font-semibold mb-1">החשבון הזה לא שייך למסעדה הזו</p>
            <p className="text-iron-muted text-sm mt-1">
              {auth.user.email ?? `${auth.user.firstName} ${auth.user.lastName}`}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {auth.user.restaurant?.slug && (
              <a
                href={`/${auth.user.restaurant.slug}`}
                className="w-full text-center bg-iron-green hover:bg-iron-green-light text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                עבור למסעדה שלי ←
              </a>
            )}
            <button
              onClick={onLogout}
              className="w-full text-center text-iron-muted text-xs py-2 hover:text-iron-text transition-colors"
            >
              התנתק
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Auth set + slug matches → HostDashboard ──────────────────────────────
  if (auth) {
    return (
      <HostDashboard
        auth={auth}
        zoom={zoom}
        zoomStep={ZOOM_STEP}
        onZoomChange={onZoomChange}
        onLogout={onLogout}
        onSwitchHost={onSwitchHost}
        theme={theme}
        onThemeChange={onThemeChange}
      />
    );
  }

  // Install banner shown on the login screen for unauthenticated mobile users.
  // Rendered here (outside HostDashboard) so it appears before login too,
  // ensuring the user installs from /slug — not from /.
  const installBanner = isMobile ? <PwaInstallBanner /> : null;

  // ── Not authenticated — show mismatch error if needed ────────────────────
  if (slugMismatch) {
    return (
      <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <div className="bg-iron-card border border-iron-border rounded-xl p-6 mb-4">
            <p className="text-status-danger font-semibold mb-1">החשבון הזה לא שייך למסעדה הזו</p>
            <p className="text-iron-muted text-sm">נסו להתחבר עם פרטים של עובד מסעדת {restaurant.name}</p>
          </div>
          <button
            onClick={() => { setSlugMismatch(false); setEmail(''); setPassword(''); }}
            className="text-iron-green text-sm hover:underline"
          >
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  // ── Not authenticated — show cinematic intro once per session ────────────
  if (!forceLoginPage) {
    if (showIntro) {
      return (
        <CinematicRestaurantIntro
          restaurantName={restaurant.name}
          logoUrl={restaurant.logoUrl}
          primaryColor={restaurant.primaryColor}
          onDone={() => {
            sessionStorage.setItem(introKey, '1');
            setShowIntro(false);
          }}
        />
      );
    }
    return (
      <div className="h-full flex flex-col">
        {installBanner}
        <div className="flex-1">
          <HostSelectionScreen
            restaurantId={restaurant.id}
            onLogin={wrapLogin}
            onManagerLogin={onForceLoginPage}
          />
        </div>
      </div>
    );
  }

  // ── Manager email login (only reachable via "Manager login" link) ─────────
  return (
    <div className="h-full flex flex-col bg-iron-bg" dir="rtl">
    {installBanner}
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          {restaurant.logoUrl ? (
            <img
              src={restaurant.logoUrl}
              alt={restaurant.name}
              className="w-12 h-12 rounded-xl object-cover mx-auto mb-3"
            />
          ) : (
            <div className="inline-flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 bg-iron-green rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm tracking-tight">IB</span>
              </div>
            </div>
          )}
          <p className="text-iron-text font-semibold text-xl">{restaurant.name}</p>
          <p className="text-iron-muted text-sm mt-1">כניסת מנהל</p>
        </div>

        <div className="bg-iron-card border border-iron-border rounded-xl p-6">
          <form onSubmit={submitEmail} className="space-y-4" dir="rtl">
            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                אימייל
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                dir="ltr"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="you@restaurant.com"
              />
            </div>

            <div>
              <label className="block text-iron-muted text-xs font-semibold uppercase tracking-wider mb-1.5">
                סיסמה
              </label>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                dir="ltr"
                className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2.5 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
                placeholder="••••••••"
              />
            </div>

            {formErr && (
              <p className="text-status-danger text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {formErr}
              </p>
            )}

            <button
              type="submit"
              disabled={formBusy}
              className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {formBusy ? 'מתחבר…' : 'כניסה'}
            </button>
          </form>
        </div>

        <button
          onClick={onClearForceLoginPage}
          className="w-full text-center text-iron-muted text-xs mt-4 hover:text-iron-text transition-colors"
        >
          ← חזרה לבחירת עובד
        </button>
      </div>
    </div>
    </div>
  );
}
