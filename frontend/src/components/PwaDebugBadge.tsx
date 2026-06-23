import { useIsMobile, useIsStandalone } from '../hooks/useIsMobile';

interface Props {
  slug?: string;
}

export default function PwaDebugBadge({ slug }: Props) {
  const isMobile     = useIsMobile();
  const isStandalone = useIsStandalone();
  const vw           = typeof window !== 'undefined' ? window.innerWidth : 0;
  const isTouch      = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const displayMode  = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
    ? 'standalone'
    : (window.navigator as { standalone?: boolean }).standalone
      ? 'ios-standalone'
      : 'browser';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        left: 8,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 10,
        fontFamily: 'monospace',
        lineHeight: 1.6,
        color: '#ccc',
        pointerEvents: 'none',
        maxWidth: 200,
      }}
    >
      <div style={{ color: '#7fc97f', fontWeight: 700, marginBottom: 2 }}>PWA DEBUG</div>
      <div>isMobile: <span style={{ color: isMobile ? '#7fc97f' : '#f87' }}>{String(isMobile)}</span></div>
      <div>standalone: <span style={{ color: isStandalone ? '#7fc97f' : '#f87' }}>{String(isStandalone)}</span></div>
      <div>displayMode: <span style={{ color: '#ffd' }}>{displayMode}</span></div>
      <div>vw: <span style={{ color: '#ffd' }}>{vw}px</span></div>
      <div>touch: <span style={{ color: isTouch ? '#7fc97f' : '#aaa' }}>{String(isTouch)}</span></div>
      {slug && <div>slug: <span style={{ color: '#7fc97f' }}>{slug}</span></div>}
    </div>
  );
}
