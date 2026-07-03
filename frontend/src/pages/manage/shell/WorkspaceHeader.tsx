import { useEffect, useRef, useState } from 'react';
import { SHELL } from './tokens';
import { IcoBell, IcoSearch, IcoMenu, IcoChevronStart } from './icons';

interface Props {
  restaurantName: string;
  restaurantSlug: string;
  userFirstName: string;
  roleLabel: string;
  onExitToHost: () => void;
  onToggleRail?: () => void; // mobile/overlay only
  showRailToggle: boolean;
}

const IS_PROD = import.meta.env.PROD;

export default function WorkspaceHeader({
  restaurantName, restaurantSlug, userFirstName, roleLabel, onExitToHost, onToggleRail, showRailToggle,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const initial = (userFirstName || restaurantName).slice(0, 1);

  return (
    <header
      dir="rtl"
      className="shrink-0 bg-iron-elevated border-b border-iron-border/60 flex items-center gap-3 px-4"
      style={{ height: SHELL.headerHeight }}
    >
      {showRailToggle && (
        <button onClick={onToggleRail} aria-label="פתח ניווט" className="text-iron-muted hover:text-iron-text p-1.5 rounded-lg hover:bg-iron-bg/50 transition-colors">
          <IcoMenu />
        </button>
      )}

      {/* Restaurant identity */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-iron-green/20 border border-iron-green/35 flex items-center justify-center text-iron-green-light text-sm font-bold shrink-0">
          {restaurantName.slice(0, 1)}
        </div>
        <div className="min-w-0 leading-tight hidden sm:block">
          <p className="text-iron-text font-semibold text-sm truncate">{restaurantName}</p>
          <p className="text-iron-muted/70 text-[11px] truncate">מרכז הניהול · /{restaurantSlug}</p>
        </div>
      </div>

      {/* Env badge */}
      <span
        className={`hidden md:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded ${IS_PROD ? 'bg-iron-green/12 text-iron-green-light border border-iron-green/25' : 'bg-status-warning/12 text-status-warning border border-status-warning/25'}`}
        title={IS_PROD ? 'סביבת ייצור' : 'סביבת פיתוח'}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${IS_PROD ? 'bg-iron-green-light' : 'bg-status-warning'}`} />
        {IS_PROD ? 'Production' : 'Development'}
      </span>

      {/* Future-ready search entry (command palette wiring lands later) */}
      <button
        className="hidden lg:flex items-center gap-2 mx-2 flex-1 max-w-[340px] text-iron-muted/60 bg-iron-bg/50 border border-iron-border/50 rounded-lg px-3 py-1.5 hover:border-iron-border transition-colors"
        title="חיפוש — בקרוב"
        aria-label="חיפוש"
      >
        <IcoSearch size={15} />
        <span className="text-xs">חיפוש במרכז הניהול…</span>
        <span className="ms-auto text-[10px] text-iron-muted/50 border border-iron-border/50 rounded px-1">⌘K</span>
      </button>

      <div className="flex-1 lg:flex-none" />

      {/* Notifications placeholder */}
      <button className="text-iron-muted/70 hover:text-iron-text p-1.5 rounded-lg hover:bg-iron-bg/50 transition-colors" title="התראות — בקרוב" aria-label="התראות">
        <IcoBell />
      </button>

      <div className="w-px h-6 bg-iron-border/40" />

      {/* Account chip + profile menu placeholder */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`flex items-center gap-2 rounded-lg ps-1 pe-2 py-1 border transition-colors ${menuOpen ? 'bg-iron-bg/60 border-iron-border/45' : 'border-transparent hover:bg-iron-bg/50 hover:border-iron-border/35'}`}
        >
          <span className="w-8 h-8 rounded-full bg-iron-green/15 border border-iron-green/30 flex items-center justify-center text-iron-green-light text-xs font-bold uppercase">{initial}</span>
          <span className="hidden md:flex flex-col items-end leading-tight max-w-[140px]">
            <span className="text-iron-text/85 text-xs font-medium truncate w-full text-end">{userFirstName}</span>
            {roleLabel && <span className="text-iron-muted/60 text-[10px]">{roleLabel}</span>}
          </span>
        </button>
        {menuOpen && (
          <div dir="rtl" role="menu" className="absolute left-0 mt-2 min-w-[200px] rounded-xl border border-iron-border/50 bg-iron-elevated py-1.5 z-[9999]" style={{ boxShadow: '0 14px 36px rgba(0,0,0,0.45)' }}>
            <div className="px-3.5 py-2 mb-1 border-b border-iron-border/30">
              <p className="text-iron-text/85 text-xs font-semibold truncate">{userFirstName}</p>
              {roleLabel && <p className="text-iron-muted/55 text-[10px]">{roleLabel}</p>}
            </div>
            <button onClick={() => { setMenuOpen(false); onExitToHost(); }} role="menuitem" className="w-full flex items-center gap-2 text-start px-3.5 py-2 text-xs font-semibold text-iron-green-light hover:bg-iron-border/20 transition-colors">
              <IcoChevronStart size={14} /> מסך המארח
            </button>
            <div className="px-3.5 py-2 text-xs text-iron-muted/45 select-none">פרופיל · בקרוב</div>
          </div>
        )}
      </div>

      {/* Prominent workspace switch */}
      <button
        onClick={onExitToHost}
        title="חזרה למסך המארח — אותו חשבון, אותה מסעדה"
        className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-iron-muted hover:text-iron-text border border-iron-border/60 hover:border-iron-border rounded-lg px-3 py-2 transition-colors"
      >
        <IcoChevronStart size={15} /> מסך המארח
      </button>
    </header>
  );
}
