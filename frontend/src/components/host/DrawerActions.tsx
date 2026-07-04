// ─── Shared Host drawer action primitive ──────────────────────────────────────
// One definition of the drawer action button + variant classes + action-zone
// layout, shared by every Host drawer. GuestDrawer adopts it now; the table
// panels (TableQuickPanel / ContextPanel) adopt it once their WIP lands, so the
// same action reads the same way — same colors, same padding, same shadow, and
// the same Primary → Secondary → Destructive zone order — in every drawer.
import type { ReactNode } from 'react';

export type ActionVariant = 'green' | 'blue' | 'amber' | 'red' | 'neutral';

// Canonical variant classes. `green` = primary/confirm, `blue` = alt-primary,
// `amber` = caution (no-show / unseat), `red` = destructive (cancel),
// `neutral` = secondary.
export const BTN: Record<ActionVariant, string> = {
  green:   'bg-iron-green-light border-iron-green-light text-white hover:bg-iron-green hover:border-iron-green',
  blue:    'bg-status-reserved/15 border-status-reserved/30 text-status-reserved hover:bg-status-reserved/25',
  amber:   'bg-status-warning/15 border-status-warning/30 text-status-warning hover:bg-status-warning/25',
  red:     'bg-red-900/15 border-red-900/25 text-status-danger hover:bg-red-900/25',
  neutral: 'bg-iron-border/20 border-iron-border/40 text-iron-text hover:bg-iron-border/30',
};

const PRIMARY_SHADOW = { boxShadow: '0 3px 12px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.10)' };

interface ActionButtonProps {
  label: string;
  /** A variant class from BTN (e.g. BTN.green). */
  cls: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}

export function ActionButton({ label, cls, onClick, disabled = false, title, primary }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-xl border transition-[color,background-color,border-color,opacity,transform] duration-100 disabled:opacity-40 active:scale-[0.96] touch-manipulation ${
        primary ? 'text-sm font-semibold px-4 py-4 min-h-[52px] flex-1' : 'text-xs font-semibold px-3 py-3'
      } ${cls}`}
      style={primary ? PRIMARY_SHADOW : undefined}
    >
      {label}
    </button>
  );
}

// ─── Canonical action-zone layout ─────────────────────────────────────────────
// Primary → Secondary → Destructive, destructive separated by a top border.
export const ZONE_PRIMARY = 'flex gap-2';
export const ZONE_SECONDARY = 'flex flex-wrap gap-1.5 mt-2';
export const ZONE_DESTRUCTIVE = 'flex gap-1.5 mt-3 pt-3 border-t border-iron-border/35';

export function ActionZone({ kind, children }: { kind: 'primary' | 'secondary' | 'destructive'; children: ReactNode }) {
  const cls = kind === 'primary' ? ZONE_PRIMARY : kind === 'secondary' ? ZONE_SECONDARY : ZONE_DESTRUCTIVE;
  return <div className={cls}>{children}</div>;
}
