import type React from 'react';
import { CANVAS, SHELL } from './tokens';

// The canonical page layout for EVERY Management module. A module renders
// <WorkspacePage title subtitle breadcrumbs actions filters state>…</WorkspacePage>
// and gets a consistent anatomy: breadcrumbs → title + toolbar → filters → scroll
// region, plus standard loading / empty / error / permission-denied states.
// Nothing about a module's chrome is bespoke — consistency comes from here.

export interface Breadcrumb { label: string; onClick?: () => void }
export type PageState = 'ready' | 'loading' | 'empty' | 'error' | 'denied';

interface Props {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  /** Toolbar — primary action first, secondary after; rendered at the row end. */
  actions?: React.ReactNode;
  /** Optional filter controls, shown in their own row below the title. */
  filters?: React.ReactNode;
  state?: PageState;
  empty?: { title: string; hint?: string; action?: React.ReactNode };
  error?: { message: string; onRetry?: () => void };
  children?: React.ReactNode;
}

function StateWrap({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center p-8">{children}</div>;
}

function Loading() {
  return (
    <div className="flex-1 p-1" aria-busy="true" aria-live="polite">
      <span className="sr-only">טוען…</span>
      <div className="space-y-3 animate-pulse" style={{ opacity: 0.7 }}>
        <div className="h-9 rounded-lg bg-iron-card" />
        <div className="h-24 rounded-xl bg-iron-card" />
        <div className="h-24 rounded-xl bg-iron-card" />
      </div>
    </div>
  );
}

export default function WorkspacePage({
  title, subtitle, breadcrumbs, actions, filters, state = 'ready', empty, error, children,
}: Props) {
  return (
    <div className="h-full flex flex-col min-h-0" dir="rtl">
      <div
        className="w-full mx-auto flex flex-col min-h-0 flex-1"
        style={{ maxWidth: SHELL.pageMaxWidth, paddingInline: CANVAS.paddingX }}
      >
        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="נתיב ניווט" className="flex items-center gap-1.5 text-[11px] text-iron-muted/70 pt-3">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-iron-muted/40">/</span>}
                {b.onClick ? (
                  <button onClick={b.onClick} className="hover:text-iron-text transition-colors">{b.label}</button>
                ) : (
                  <span className={i === breadcrumbs.length - 1 ? 'text-iron-text/80' : ''}>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {/* Title + toolbar */}
        <div className="flex items-start justify-between gap-4" style={{ paddingTop: CANVAS.paddingY, paddingBottom: filters ? 12 : CANVAS.paddingY }}>
          <div className="min-w-0">
            <h1 className="text-iron-text text-lg font-semibold leading-tight truncate">{title}</h1>
            {subtitle && <p className="text-iron-muted text-xs mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>

        {/* Filters row */}
        {filters && <div className="flex items-center gap-2 flex-wrap pb-4">{filters}</div>}

        {/* Content / state region — the only part that scrolls */}
        <div className="flex-1 min-h-0 overflow-auto pb-8 flex flex-col">
          {state === 'loading' && <Loading />}
          {state === 'error' && (
            <StateWrap>
              <div className="text-center max-w-sm">
                <p className="text-status-danger font-semibold text-sm mb-1">משהו השתבש</p>
                <p className="text-iron-muted text-xs mb-4">{error?.message ?? 'לא הצלחנו לטעון את הנתונים.'}</p>
                {error?.onRetry && (
                  <button onClick={error.onRetry} className="text-xs font-semibold bg-iron-green hover:bg-iron-green-light text-white px-4 py-2 rounded-lg transition-colors">נסה שוב</button>
                )}
              </div>
            </StateWrap>
          )}
          {state === 'denied' && (
            <StateWrap>
              <div className="text-center max-w-sm">
                <p className="text-iron-text font-semibold text-sm mb-1">אין לך גישה לאזור הזה</p>
                <p className="text-iron-muted text-xs">פנה לבעל/ת המסעדה כדי לקבל הרשאה.</p>
              </div>
            </StateWrap>
          )}
          {state === 'empty' && (
            <StateWrap>
              <div className="text-center max-w-sm">
                <p className="text-iron-text font-semibold text-sm mb-1">{empty?.title ?? 'אין כאן עדיין כלום'}</p>
                {empty?.hint && <p className="text-iron-muted text-xs mb-4">{empty.hint}</p>}
                {empty?.action}
              </div>
            </StateWrap>
          )}
          {state === 'ready' && children}
        </div>
      </div>
    </div>
  );
}
