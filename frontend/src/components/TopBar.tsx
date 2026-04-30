import type React from 'react';
import type { Theme } from '../App';
import { T } from '../strings';

interface Props {
  date: string;
  time: string;
  onDateChange: (d: string) => void;
  onTimeChange: (t: string) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onPrev15: () => void;
  onNext15: () => void;
  onNow: () => void;
  isLive: boolean;
  restaurantName: string;
  userName: string;
  onLogout: () => void;
  zoom: number;
  zoomStep: number;
  onZoomChange: (v: number) => void;
  theme: Theme;
  onThemeChange: () => void;
  onAdminPortal?: () => void;
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function NavBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-1.5 py-1.5 rounded border border-iron-border text-iron-muted hover:text-iron-text hover:border-iron-text/40 transition-colors text-xs leading-none select-none shrink-0"
    >
      {children}
    </button>
  );
}

export default function TopBar({
  date, time, onDateChange, onTimeChange,
  onPrevDay, onNextDay, onPrev15, onNext15, onNow, isLive,
  restaurantName, userName, onLogout,
  zoom, zoomStep, onZoomChange,
  theme, onThemeChange,
  onAdminPortal,
}: Props) {
  const atMin  = zoom <= 75;
  const atMax  = zoom >= 150;
  const atNorm = zoom === 100;

  return (
    <header className="h-14 shrink-0 bg-iron-card border-b border-iron-border flex items-center px-4 gap-3">
      {/* Brand */}
      <div className="flex items-center gap-2 mr-1 shrink-0">
        <div className="w-7 h-7 bg-iron-green rounded flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-xs">IB</span>
        </div>
        <span className="text-iron-text font-semibold text-sm tracking-tight hidden md:block">
          {T.topBar.brand}
        </span>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-1">
        <NavBtn onClick={onPrevDay} title={T.topBar.prevDay}>‹</NavBtn>
        <input
          type="date"
          value={date}
          onChange={e => onDateChange(e.target.value)}
          className="bg-iron-bg border border-iron-border rounded-md px-2 py-1.5 text-iron-text text-sm focus:outline-none focus:border-iron-green transition-colors cursor-pointer"
        />
        <NavBtn onClick={onNextDay} title={T.topBar.nextDay}>›</NavBtn>
      </div>

      {/* Time navigation */}
      <div className="flex items-center gap-1">
        <NavBtn onClick={onPrev15} title={T.topBar.prev15}>{T.topBar.prev15}</NavBtn>
        <input
          type="time"
          value={time}
          onChange={e => onTimeChange(e.target.value)}
          className="bg-iron-bg border border-iron-border rounded-md px-2 py-1.5 text-iron-text text-sm focus:outline-none focus:border-iron-green transition-colors cursor-pointer w-[6.5rem]"
        />
        <NavBtn onClick={onNext15} title={T.topBar.next15}>{T.topBar.next15}</NavBtn>
      </div>

      {/* Now button — highlighted when not live */}
      <button
        onClick={onNow}
        title="Jump to today's current time"
        className={`text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors shrink-0 ${
          isLive
            ? 'border-iron-border text-iron-muted opacity-40 cursor-default'
            : 'border-iron-green text-iron-green-light hover:bg-iron-green/10 cursor-pointer'
        }`}
      >
        {T.topBar.nowBtn}
      </button>

      {/* Zoom control */}
      <div
        className="flex items-center divide-x divide-iron-border border border-iron-border rounded-md overflow-hidden"
        title={T.topBar.zoomTitle}
      >
        <button
          onClick={() => onZoomChange(zoom - zoomStep)}
          disabled={atMin}
          aria-label={T.topBar.zoomOut}
          className="px-2 py-1.5 text-sm leading-none text-iron-muted hover:text-iron-text hover:bg-iron-bg disabled:opacity-25 disabled:cursor-not-allowed transition-colors select-none"
        >
          −
        </button>
        <button
          onClick={() => onZoomChange(100)}
          title={T.topBar.resetZoom}
          className={`px-2.5 py-1.5 text-xs font-semibold tabular-nums leading-none hover:bg-iron-bg transition-colors select-none w-12 text-center ${
            atNorm ? 'text-iron-muted' : 'text-iron-green-light'
          }`}
        >
          {zoom}%
        </button>
        <button
          onClick={() => onZoomChange(zoom + zoomStep)}
          disabled={atMax}
          aria-label={T.topBar.zoomIn}
          className="px-2 py-1.5 text-sm leading-none text-iron-muted hover:text-iron-text hover:bg-iron-bg disabled:opacity-25 disabled:cursor-not-allowed transition-colors select-none"
        >
          +
        </button>
      </div>

      <div className="flex-1" />

      {/* Theme toggle */}
      <button
        onClick={onThemeChange}
        title={theme === 'dark' ? T.topBar.switchToLight : T.topBar.switchToDark}
        className="text-iron-muted hover:text-iron-text border border-iron-border rounded-md px-2 py-1.5 transition-colors"
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

      {/* User / session */}
      <div className="flex items-center gap-3">
        {onAdminPortal && (
          <button
            onClick={onAdminPortal}
            className="text-iron-green text-xs border border-iron-green/40 px-3 py-1.5 rounded-md hover:bg-iron-green/10 transition-colors font-medium"
          >
            Admin
          </button>
        )}
        <div className="text-right hidden lg:block">
          <p className="text-iron-text text-xs font-medium leading-tight">{userName}</p>
          <p className="text-iron-muted text-xs leading-tight">{restaurantName}</p>
        </div>
        <button
          onClick={onLogout}
          className="text-iron-muted hover:text-iron-text text-xs border border-iron-border px-3 py-1.5 rounded-md transition-colors"
        >
          {T.topBar.signOut}
        </button>
      </div>
    </header>
  );
}
