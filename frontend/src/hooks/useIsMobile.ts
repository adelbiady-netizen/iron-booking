import { useState, useEffect } from 'react';

function computeIsMobile(): boolean {
  if (typeof window === 'undefined') return false;
  // Viewport width breakpoint — covers regular browser on phone/narrow tablet
  if (window.matchMedia('(max-width: 767px)').matches) return true;
  // Standalone / installed PWA on a touch device.
  // We force mobile shell whenever the app runs installed, regardless of declared viewport,
  // because installed PWAs on phones always expect the mobile layout.
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  const isTouch =
    window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0;
  return isStandalone && isTouch;
}

/** Returns true when viewport ≤ 767px OR when running as an installed PWA on a touch device. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(computeIsMobile);

  useEffect(() => {
    const mqWidth      = window.matchMedia('(max-width: 767px)');
    const mqStandalone = window.matchMedia('(display-mode: standalone)');
    const handler = () => setIsMobile(computeIsMobile());
    mqWidth.addEventListener('change', handler);
    mqStandalone.addEventListener('change', handler);
    return () => {
      mqWidth.removeEventListener('change', handler);
      mqStandalone.removeEventListener('change', handler);
    };
  }, []);

  return isMobile;
}

/** Returns true when the app is running as an installed PWA (standalone display mode). */
export function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    );
  });

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const handler = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return standalone;
}
