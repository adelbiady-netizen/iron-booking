import { useEffect, useState } from 'react';
import type { AuthState } from '../../types';
import { useManagementContext } from '../../hooks/useManagementContext';
import { findModule, DEFAULT_MODULE } from './shell/modules';
import WorkspaceShell from './shell/WorkspaceShell';

// Route entry for the Management Workspace (Mission P0.2).
// Owns the guard (auth + capability) and CLIENT-SIDE module navigation: switching
// modules updates the URL via pushState and swaps only the canvas — the shell
// (header + rail) stays mounted. This is the "modules mount without rebuilding the
// page" foundation; business modules (P0.3+) slot into the canvas unchanged.

interface Props {
  slug: string;
  initialModule: string | null;
  auth: AuthState | null;
  ready: boolean;
  onExitToHost: () => void;
}

function BootScreen({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir="rtl">
      <div className="flex flex-col items-center text-center">
        <div className="w-11 h-11 rounded-2xl bg-iron-green/18 border border-iron-green/35 flex items-center justify-center text-iron-green-light font-bold mb-4">
          {title.slice(0, 1)}
        </div>
        <p className="text-iron-text font-semibold text-sm">{title}</p>
        {subtitle && <p className="text-iron-muted text-xs mt-1">{subtitle}</p>}
        <div className="mt-4 w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

export default function ManagementWorkspace({ slug, initialModule, auth, ready, onExitToHost }: Props) {
  const noAuth = ready && !auth;
  const enabled = ready && !!auth;
  const { state } = useManagementContext(enabled);
  const [activeModule, setActiveModule] = useState<string>(() => findModule(initialModule).key);

  useEffect(() => { if (noAuth) window.location.replace(`/${slug}`); }, [noAuth, slug]);
  const forbidden = state.status === 'forbidden';
  useEffect(() => { if (forbidden) window.location.replace(`/${slug}`); }, [forbidden, slug]);

  // Canonicalize a bare /{slug}/manage → /{slug}/manage/{module} (deep-link safe).
  useEffect(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[1] === 'manage' && !parts[2]) {
      window.history.replaceState(null, '', `/${slug}/manage/${activeModule}`);
    }
    // once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/forward: stay client-side while inside /manage; reload only when leaving it.
  useEffect(() => {
    function onPop() {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts[0] === slug && parts[1] === 'manage') {
        setActiveModule(findModule(parts[2] ?? DEFAULT_MODULE).key);
      } else {
        window.location.reload();
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [slug]);

  function navigate(key: string) {
    if (key === activeModule) return;
    setActiveModule(key);
    window.history.pushState(null, '', `/${slug}/manage/${key}`);
  }

  const restaurantName = auth?.user.restaurant?.name ?? 'Iron Booking';

  if (!ready || noAuth || state.status === 'loading' || forbidden) {
    return <BootScreen title={restaurantName} subtitle="פותח את מרכז הניהול…" />;
  }

  if (state.status === 'error') {
    return (
      <div className="h-full bg-iron-bg flex items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <div className="bg-iron-card border border-iron-border rounded-xl p-6 mb-4">
            <p className="text-status-danger font-semibold mb-1">לא הצלחנו לפתוח את מרכז הניהול</p>
            <p className="text-iron-muted text-sm">{state.message}</p>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => window.location.reload()} className="w-full bg-iron-green hover:bg-iron-green-light text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">נסה שוב</button>
            <button onClick={onExitToHost} className="w-full text-iron-muted text-xs py-2 hover:text-iron-text transition-colors">חזרה למסך המארח →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceShell
      context={state.context}
      userFirstName={auth?.user.firstName ?? ''}
      activeModule={activeModule}
      onNavigate={navigate}
      onExitToHost={onExitToHost}
    />
  );
}
