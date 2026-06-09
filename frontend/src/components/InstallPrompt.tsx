import { useEffect, useState } from 'react';

// The beforeinstallprompt event is not in the standard TS lib.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'iron_install_dismissed';

// Install affordance is for staff/admin surfaces, not the guest-facing pages.
function isPublicRoute(path: string): boolean {
  return /^\/(r|q|book|c|confirm|waitlist|privacy|terms|accessibility|contact|r-preview)(\/|$)/.test(path);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua);
  const webkit = /webkit/i.test(ua);
  const notChrome = !/crios|fxios|edgios/i.test(ua);
  return iOS && webkit && notChrome;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isPublicRoute(window.location.pathname)) return;
    if (isStandalone()) return;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari never fires beforeinstallprompt — show a manual hint instead.
    if (isIosSafari()) {
      setIosHint(true);
      setVisible(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 left-4 z-[1000] max-w-[320px] rounded-xl border border-iron-border bg-iron-elevated shadow-2xl p-3 flex items-start gap-3">
      <img src="/pwa-192.png" alt="" className="w-9 h-9 rounded-lg shrink-0" />
      <div className="min-w-0 flex-1">
        {iosHint ? (
          <>
            <p className="text-sm font-semibold text-iron-text">התקן את Iron Booking</p>
            <p className="text-xs text-iron-muted mt-0.5 leading-snug">
              הקש על <span className="font-semibold">שתף</span> ואז{' '}
              <span className="font-semibold">הוסף למסך הבית</span>.
            </p>
            <button
              onClick={dismiss}
              className="mt-2 text-xs text-iron-muted hover:text-iron-text underline"
            >
              הבנתי
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-iron-text">התקן כאפליקציה</p>
            <p className="text-xs text-iron-muted mt-0.5 leading-snug">
              פתח במסך מלא ישירות מהמסך הראשי.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={install}
                className="rounded-lg bg-iron-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-iron-green-light transition-colors"
              >
                התקן
              </button>
              <button
                onClick={dismiss}
                className="px-2 py-1.5 text-xs text-iron-muted hover:text-iron-text"
              >
                לא עכשיו
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
