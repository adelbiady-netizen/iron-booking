import { useEffect, useState } from 'react';
import { BREAKPOINTS } from './tokens';

export type RailMode = 'expanded' | 'collapsed' | 'overlay';

export interface Viewport {
  width: number;
  isMobile: boolean;   // < 640
  isTablet: boolean;   // 640–1023
  isDesktop: boolean;  // ≥ 1024
  railMode: RailMode;
}

function measure(width: number): Viewport {
  const isMobile = width < BREAKPOINTS.mobile;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isTablet = !isMobile && !isDesktop;
  // Rail: expanded on desktop, icon-collapsed on tablet-landscape, off-canvas
  // overlay on tablet-portrait + mobile.
  const railMode: RailMode = isDesktop
    ? 'expanded'
    : width >= BREAKPOINTS.tabletPortrait
      ? 'collapsed'
      : 'overlay';
  return { width, isMobile, isTablet, isDesktop, railMode };
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() =>
    measure(typeof window === 'undefined' ? 1280 : window.innerWidth),
  );
  useEffect(() => {
    let raf = 0;
    function onResize() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(measure(window.innerWidth)));
    }
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);
  return vp;
}
