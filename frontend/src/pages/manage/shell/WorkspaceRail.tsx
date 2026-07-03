import { useRef } from 'react';
import type React from 'react';
import { MODULES } from './modules';
import { SHELL } from './tokens';
import type { RailMode } from './useViewport';
import { IcoClose } from './icons';

interface Props {
  activeKey: string;
  onNavigate: (key: string) => void;
  mode: RailMode;
  overlayOpen?: boolean;
  onCloseOverlay?: () => void;
}

function RailNav({ activeKey, onNavigate, collapsed }: { activeKey: string; onNavigate: (k: string) => void; collapsed: boolean }) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving keyboard nav (Up/Down / Home / End) for premium keyboard support.
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = MODULES.length - 1;
    let next = -1;
    if (e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next >= 0) { e.preventDefault(); btnRefs.current[next]?.focus(); }
  }

  return (
    <nav aria-label="ניווט מרכז הניהול" className="flex flex-col gap-0.5 py-3 px-2.5">
      {!collapsed && <p className="text-iron-muted/50 text-[10px] font-semibold tracking-wider px-2.5 pb-2">מודולים</p>}
      {MODULES.map((m, i) => {
        const active = m.key === activeKey;
        return (
          <button
            key={m.key}
            ref={el => { btnRefs.current[i] = el; }}
            onClick={() => onNavigate(m.key)}
            onKeyDown={e => onKeyDown(e, i)}
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? `${m.label} — ${m.subtitle}` : undefined}
            title={collapsed ? m.label : undefined}
            className={`group w-full flex items-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-iron-green/50 ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2'} ${
              active ? 'bg-iron-green/15 text-iron-green-light' : 'text-iron-muted/80 hover:text-iron-text hover:bg-iron-bg/50'
            }`}
          >
            <span className={active ? 'text-iron-green-light' : 'text-iron-muted/60 group-hover:text-iron-text/80'}><m.Icon /></span>
            {!collapsed && (
              <span className="flex-1 min-w-0 text-start">
                <span className="block text-sm font-medium leading-tight truncate">{m.label}</span>
                <span className="block text-[10px] text-iron-muted/55 leading-tight truncate">{m.subtitle}</span>
              </span>
            )}
            {!collapsed && (
              <span className={`text-[9px] font-semibold tabular-nums px-1.5 py-0.5 rounded shrink-0 ${active ? 'bg-iron-green/20 text-iron-green-light' : 'bg-iron-bg/60 text-iron-muted/50'}`}>{m.phase}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export default function WorkspaceRail({ activeKey, onNavigate, mode, overlayOpen, onCloseOverlay }: Props) {
  if (mode === 'overlay') {
    return (
      <>
        {/* Backdrop */}
        <div
          onClick={onCloseOverlay}
          className={`fixed inset-0 z-[9998] bg-black/40 transition-opacity duration-150 ${overlayOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-hidden="true"
        />
        {/* Off-canvas panel (RTL: slides from the right / inline-start) */}
        <div
          dir="rtl"
          role="dialog"
          aria-label="ניווט מרכז הניהול"
          className={`fixed top-0 bottom-0 right-0 z-[9999] bg-iron-elevated border-l border-iron-border/60 transition-transform duration-200 ${overlayOpen ? 'translate-x-0' : 'translate-x-full'}`}
          style={{ width: SHELL.railWidthExpanded }}
        >
          <div className="flex items-center justify-between px-3 h-[60px] border-b border-iron-border/60">
            <span className="text-iron-text text-sm font-semibold">מרכז הניהול</span>
            <button onClick={onCloseOverlay} aria-label="סגור ניווט" className="text-iron-muted hover:text-iron-text p-1.5 rounded-lg hover:bg-iron-bg/50"><IcoClose /></button>
          </div>
          <RailNav activeKey={activeKey} onNavigate={k => { onNavigate(k); onCloseOverlay?.(); }} collapsed={false} />
        </div>
      </>
    );
  }

  const collapsed = mode === 'collapsed';
  return (
    <aside
      dir="rtl"
      className="shrink-0 border-l border-iron-border/60 bg-iron-elevated/30 h-full overflow-y-auto"
      style={{ width: collapsed ? SHELL.railWidthCollapsed : SHELL.railWidthExpanded }}
    >
      <RailNav activeKey={activeKey} onNavigate={onNavigate} collapsed={collapsed} />
    </aside>
  );
}
