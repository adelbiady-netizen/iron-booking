// Floating phone button for the floor map. Presentational + pure — no data
// fetching, no hooks — so the container (HostDashboard) owns the authoritative
// count and its refetch, and this stays trivially testable.
//
// Visual language matches the existing floor floating controls (the map-zoom
// stack in FloorBoard): rounded, iron-elevated, subtle border + shadow.
//
// Badge-text logic lives in utils/callbackBadge (formatCallBadge) so it can be
// unit-tested without a JSX runtime.
import { formatCallBadge } from '../utils/callbackBadge';

interface Props {
  /** Server-authoritative unresolved callback count (PENDING + IN_PROGRESS). */
  count: number;
  onClick: () => void;
  /** Accessible label (Hebrew, supplied by the caller so this stays i18n-free). */
  label?: string;
  className?: string;
}

export default function CallFab({ count, onClick, label, className }: Props) {
  const badge = formatCallBadge(count);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? 'Calls'}
      title={label ?? 'Calls'}
      className={`relative w-12 h-12 rounded-full bg-iron-elevated/95 border border-iron-border/60 text-iron-text/85 hover:text-iron-text hover:bg-iron-bg/70 flex items-center justify-center transition-colors ${className ?? ''}`}
      style={{ boxShadow: '0 6px 22px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)' }}
    >
      {/* Phone handset icon (mirrors MobileBottomNav's calls icon idiom) */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>

      {badge !== null && (
        <span
          data-testid="call-fab-badge"
          className="absolute -top-1 -end-1 min-w-[20px] h-5 px-1 rounded-full bg-iron-green text-white text-[11px] font-bold leading-5 text-center tabular-nums"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.45)' }}
          dir="ltr"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
