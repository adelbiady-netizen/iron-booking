import type React from 'react';
import type { Theme } from '../App';
import { useT } from '../i18n/useT';
import type { SseStatus } from '../hooks/useServerEvents';
import LanguageSwitcher from './LanguageSwitcher';
import LocalizedDateInput from './LocalizedDateInput';

// 30-minute time slots covering the full day — guarantees 24h display regardless of browser locale
const TIME_SLOTS_24H: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

interface Props {
  date: string;
  time: string;
  onDateChange: (d: string) => void;
  onTimeChange: (t: string) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onPrev30: () => void;
  onNext30: () => void;
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
  onGuestsPage?: () => void;
  onSwitchHost?: () => void;
  onBulkConfirm?: () => void;
  sseStatus?: SseStatus;
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
      className="flex items-center justify-center w-9 self-stretch text-iron-text/45 hover:text-iron-text hover:bg-white/[0.05] active:bg-white/[0.08] transition-colors text-base leading-none select-none shrink-0 touch-manipulation"
    >
      {children}
    </button>
  );
}

export default function TopBar({
  date, time, onDateChange, onTimeChange,
  onPrevDay, onNextDay, onPrev30, onNext30, onNow, isLive,
  restaurantName, userName, onLogout,
  zoom, zoomStep, onZoomChange,
  theme, onThemeChange,
  onAdminPortal,
  onGuestsPage,
  onSwitchHost,
  onBulkConfirm,
  sseStatus,
}: Props) {
  const T = useT();
  const atMin  = zoom <= 75;
  const atMax  = zoom >= 150;
  const atNorm = zoom === 100;

  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday  = date === todayStr;

  return (
    <header className="h-[70px] shrink-0 bg-iron-elevated flex items-center px-5 gap-3" style={{ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.024) 0%, rgba(0,0,0,0.06) 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 0 rgba(0,0,0,0.30), 0 20px 80px rgba(0,0,0,0.72)', borderBottom: '1px solid rgba(255,215,130,0.22)' }}>
      {/* Brand */}
      <div className="flex items-center gap-2.5 mr-3 shrink-0">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(145deg, rgba(111,138,60,0.28) 0%, rgba(75,95,42,0.16) 100%)', border: '1px solid rgba(120,120,60,0.36)', boxShadow: '0 0 16px rgba(111,138,60,0.16), 0 0 8px rgba(255,215,130,0.07), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
          <span className="text-iron-green-light font-bold text-sm">IB</span>
        </div>
        <span className="text-iron-text/85 font-semibold text-sm tracking-tight hidden md:block">
          {T.topBar.brand}
        </span>
      </div>

      {/* ── Date / Time Command Cluster ──────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-stretch rounded-2xl border border-white/[0.08] bg-iron-bg overflow-hidden" style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.52), 0 1px 0 rgba(255,255,255,0.09), 0 0 0 1px rgba(255,255,255,0.05)' }}>
          {/* Date nav — quiet, compact secondary */}
          <NavBtn onClick={onPrevDay} title={T.topBar.prevDay}>‹</NavBtn>
          <div className="flex items-center gap-1 px-2.5 border-x border-iron-border/30">
            <LocalizedDateInput
              value={date}
              onValueChange={onDateChange}
              className="text-iron-text/75 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
            />
            {!isToday && (
              <button
                onClick={onNow}
                title={T.topBar.backToToday}
                className="w-3.5 h-3.5 rounded-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/35 transition-colors flex items-center justify-center text-[8px] font-bold leading-none shrink-0"
                aria-label={T.topBar.backToToday}
              >
                ×
              </button>
            )}
          </div>
          <NavBtn onClick={onNextDay} title={T.topBar.nextDay}>›</NavBtn>

          {/* Divider */}
          <div className="w-px bg-iron-border/35 my-3 shrink-0" />

          {/* Time — operationally dominant, large display */}
          <NavBtn onClick={onPrev30} title={T.topBar.prev30}>‹</NavBtn>
          <div className="relative flex items-center justify-center px-3 py-2.5">
            <span
              className="text-iron-text font-bold tabular-nums leading-none pointer-events-none select-none"
              style={{ fontSize: '40px', letterSpacing: '-0.045em' }}
            >
              {time}
            </span>
            <select
              value={time}
              onChange={e => onTimeChange(e.target.value)}
              aria-label="Set service time"
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              style={{ colorScheme: 'dark' } as React.CSSProperties}
            >
              {TIME_SLOTS_24H.map(slot => (
                <option key={slot} value={slot}>{slot}</option>
              ))}
            </select>
          </div>
          <NavBtn onClick={onNext30} title={T.topBar.next30}>›</NavBtn>
        </div>

        {/* ── Service State — adjacent to time ─────────────────── */}
        {isLive ? (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-iron-green/14 border border-iron-green/30 shrink-0" style={{ boxShadow: '0 0 0 3px rgba(111,138,60,0.07), inset 0 1px 0 rgba(255,255,255,0.05)' }}>
            <span className="w-2 h-2 rounded-full bg-iron-green-light animate-pulse shrink-0" style={{ animationDuration: '2.4s', boxShadow: '0 0 6px rgba(111,138,60,0.5)' }} />
            <span className="text-iron-green-light text-[11px] font-bold tracking-[0.18em]">LIVE</span>
          </div>
        ) : (
          <button
            onClick={onNow}
            title="Return to live service view"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-iron-green/10 border border-iron-green/30 text-iron-green-light text-xs font-semibold hover:bg-iron-green/18 transition-colors shrink-0"
          >
            ↩ {T.topBar.nowBtn}
          </button>
        )}
      </div>

      {/* Zoom control — quiet utility */}
      <div
        className="flex items-center bg-iron-bg/60 rounded-xl overflow-hidden divide-x divide-iron-border/25"
        style={{ boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(255,255,255,0.03)' }}
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

      {/* Bulk confirmation — live operational action */}
      {onBulkConfirm && (
        <button
          onClick={onBulkConfirm}
          className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-iron-green/25 text-iron-green-light hover:bg-iron-green/10 transition-colors shrink-0"
        >
          {T.topBar.bulkConfirmButton}
        </button>
      )}

      {/* SSE connection status — only shown when degraded */}
      {sseStatus === 'reconnecting' && (
        <div className="flex items-center gap-1.5 text-amber-400 text-xs shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="hidden sm:block">{T.topBar.sseReconnecting}</span>
        </div>
      )}
      {sseStatus === 'disconnected' && (
        <div className="flex items-center gap-1.5 text-red-400 text-xs shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="hidden sm:block">{T.topBar.sseOffline}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Visual divider — operational zone ← → utility zone */}
      <div className="w-px h-5 bg-iron-border/35 shrink-0" />

      <LanguageSwitcher />

      {/* Theme toggle — borderless, icon only */}
      <button
        onClick={onThemeChange}
        title={theme === 'dark' ? T.topBar.switchToLight : T.topBar.switchToDark}
        className="text-iron-text/45 hover:text-iron-text/85 rounded-lg p-1.5 hover:bg-iron-bg/60 transition-colors"
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

      {/* User / session */}
      <div className="flex items-center gap-2">
        {onGuestsPage && (
          <button
            onClick={onGuestsPage}
            className="text-iron-muted/60 text-xs px-2.5 py-1 rounded-md hover:text-iron-text/85 hover:bg-iron-bg/50 transition-colors duration-100 font-medium"
          >
            {T.topBar.guestsButton}
          </button>
        )}
        {onAdminPortal && (
          <button
            onClick={onAdminPortal}
            className="text-iron-muted/60 text-xs px-2.5 py-1 rounded-md hover:text-iron-text/85 hover:bg-iron-bg/50 transition-colors duration-100 font-medium"
          >
            {T.topBar.adminButton}
          </button>
        )}

        {/* Active host badge (host-selection-aware sessions) */}
        {onSwitchHost ? (
          <div className="hidden lg:flex items-center gap-1.5 rounded-md px-2 py-0.5">
            <span className="text-iron-muted/75 text-xs leading-tight">{T.topBar.activeHost(userName)}</span>
            <span className="text-iron-border/60 text-xs">·</span>
            <button
              onClick={onSwitchHost}
              className="text-iron-green-light text-xs font-semibold hover:text-iron-green transition-colors leading-tight whitespace-nowrap"
            >
              {T.topBar.switchHost}
            </button>
          </div>
        ) : (
          <div className="text-right hidden lg:block">
            <p className="text-iron-text/85 text-xs font-medium leading-tight">{userName}</p>
            <p className="text-iron-muted/65 text-xs leading-tight">{restaurantName}</p>
          </div>
        )}

        {/* On small screens, show a compact Switch Host button instead of badge */}
        {onSwitchHost && (
          <button
            onClick={onSwitchHost}
            className="lg:hidden text-iron-green-light hover:text-iron-green text-xs px-2 py-1 rounded-md hover:bg-iron-bg/50 transition-colors font-medium"
          >
            {T.topBar.switchHost}
          </button>
        )}

        <button
          onClick={onLogout}
          className="text-iron-muted/45 hover:text-iron-muted/80 text-xs px-2.5 py-1 rounded-md hover:bg-iron-bg/50 transition-colors duration-100"
        >
          {T.topBar.signOut}
        </button>
      </div>
    </header>
  );
}
