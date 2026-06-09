import { useState, useEffect, useRef } from 'react';
import type React from 'react';
import type { Theme } from '../App';
import { useT } from '../i18n/useT';
import type { SseStatus } from '../hooks/useServerEvents';
import LanguageSwitcher from './LanguageSwitcher';
import MiniCalendar from './MiniCalendar';
import { useLocale } from '../i18n/useLocale';

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
  /** Board tools (combine/reorganize/call-log/more) hoisted up from the old secondary bar. */
  toolbarSlot?: React.ReactNode;
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

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function NavBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center w-9 self-stretch text-iron-text/45 hover:text-iron-text hover:bg-white/[0.07] active:bg-white/[0.11] transition-colors text-base leading-none select-none shrink-0 touch-manipulation"
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
  toolbarSlot,
}: Props) {
  const T = useT();
  const { intlLocale } = useLocale();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  function readClock(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const [realClock, setRealClock] = useState(readClock);
  useEffect(() => {
    const id = setInterval(() => setRealClock(readClock()), 15_000);
    return () => clearInterval(id);
  }, []);

  function fmtDate(dateStr: string): string {
    if (!dateStr) return '';
    const [y, mo, d] = dateStr.split('-').map(Number);
    if (!y || !mo || !d) return dateStr;
    return new Intl.DateTimeFormat(intlLocale, {
      weekday: intlLocale === 'he-IL' ? 'long' : 'short',
      day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date(y, mo - 1, d));
  }

  useEffect(() => {
    if (!calendarOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCalendarOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [calendarOpen]);

  useEffect(() => {
    if (!calendarOpen) return;
    function onPointer(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [calendarOpen]);

  useEffect(() => {
    if (!settingsOpen && !userMenuOpen) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (settingsRef.current && !settingsRef.current.contains(t)) setSettingsOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(t)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [settingsOpen, userMenuOpen]);

  const atMin  = zoom <= 75;
  const atMax  = zoom >= 150;
  const atNorm = zoom === 100;

  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday  = date === todayStr;

  return (
    <header dir="ltr" className="ib-compact-top h-[70px] shrink-0 bg-iron-elevated flex items-center px-5 gap-3" style={{ backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.024) 0%, rgba(0,0,0,0.06) 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 0 rgba(0,0,0,0.30), 0 20px 80px rgba(0,0,0,0.72)', borderBottom: '1px solid rgba(255,215,130,0.30)' }}>
      {/* Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(145deg, rgba(111,138,60,0.28) 0%, rgba(75,95,42,0.16) 100%)', border: '1px solid rgba(120,120,60,0.36)', boxShadow: '0 0 18px rgba(111,138,60,0.22), 0 0 10px rgba(255,215,130,0.11), inset 0 1px 0 rgba(255,255,255,0.14)' }}>
          <span className="text-iron-green-light font-bold text-sm">IB</span>
        </div>
        <span className="text-iron-text/85 font-semibold text-sm tracking-tight hidden md:block">
          {T.topBar.brand}
        </span>
      </div>

      {/* Zone separator: brand → command */}
      <div className="w-px h-[28px] bg-iron-border/[0.22] shrink-0" />

      {/* ── Date / Time Command Cluster ──────────────────────────────── */}
      <div ref={calendarRef} className="relative flex items-center gap-2.5 shrink-0">
        <div className="flex items-stretch rounded-2xl border border-white/[0.08] bg-iron-bg overflow-hidden" style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.52), 0 1px 0 rgba(255,255,255,0.09), 0 0 0 1px rgba(255,255,255,0.05)' }}>
          {/* Date nav — quiet, compact secondary */}
          <NavBtn onClick={onPrevDay} title={T.topBar.prevDay}>‹</NavBtn>
          <div className="flex items-center gap-1 px-2.5 border-x border-iron-border/35">
            <button
              type="button"
              onClick={() => setCalendarOpen(o => !o)}
              aria-expanded={calendarOpen}
              aria-haspopup="dialog"
              className="text-iron-text/85 text-[12px] font-semibold whitespace-nowrap tracking-tight hover:text-iron-text transition-colors"
            >
              {fmtDate(date)}
            </button>
            {!isToday && (
              <button
                onClick={onNow}
                title={T.topBar.backToToday}
                className="w-3.5 h-3.5 rounded-full bg-status-reserved/20 text-status-reserved hover:bg-status-reserved/35 transition-colors flex items-center justify-center text-[8px] font-bold leading-none shrink-0"
                aria-label={T.topBar.backToToday}
              >
                ×
              </button>
            )}
          </div>
          <NavBtn onClick={onNextDay} title={T.topBar.nextDay}>›</NavBtn>

          {/* Divider */}
          <div className="w-[2px] bg-iron-border/45 my-2.5 shrink-0" />

          {/* Time — operationally dominant, large display */}
          <NavBtn onClick={onPrev30} title={T.topBar.prev30}>‹</NavBtn>
          <div className="relative flex items-center justify-center px-3 py-1.5" style={{ background: 'rgba(0,0,0,0.14)', borderLeft: '1px solid rgba(255,255,255,0.04)', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
            <span
              dir="ltr"
              className="ib-clock-sm text-iron-text/85 font-bold tabular-nums leading-none pointer-events-none select-none"
              style={{ fontSize: '24px', letterSpacing: '-0.03em', textShadow: '0 1px 12px rgba(0,0,0,0.40)' }}
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

        {/* Calendar popover — outside the overflow-hidden pill to avoid clipping */}
        {calendarOpen && (
          <div
            className="absolute left-0 z-50"
            style={{ top: 'calc(100% + 4px)' }}
            role="dialog"
            aria-label={T.topBar.prevDay}
          >
            <MiniCalendar
              value={date}
              onValueChange={v => { onDateChange(v); setCalendarOpen(false); }}
            />
          </div>
        )}

        {/* Real ("wall") clock — primary at-a-glance time; only meaningful while time-travelling */}
        {!isLive && (
          <div
            dir="ltr"
            className="flex flex-col items-center justify-center px-3 py-1 rounded-lg shrink-0 select-none pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}
          >
            <span className="text-iron-muted/55 text-[9px] font-medium tracking-[0.12em] uppercase leading-none mb-0.5">{T.topBar.realClock}</span>
            <span className="text-iron-text/85 font-bold tabular-nums leading-none" style={{ fontSize: '30px', letterSpacing: '-0.03em' }}>{realClock}</span>
          </div>
        )}

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

      {/* Zone separator: command → utility */}
      <div className="w-px h-[28px] bg-iron-border/[0.22] shrink-0" />

      {/* ── Utility group: zoom + bulk confirm ──────────────────────── */}
      <div className="flex items-center gap-1.5 shrink-0">
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

        {onBulkConfirm && (
          <button
            onClick={onBulkConfirm}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-iron-green-light border border-iron-green-light text-white hover:bg-iron-green transition-colors shrink-0"
          >
            {T.topBar.bulkConfirmButton}
          </button>
        )}
      </div>

      {/* SSE connection status — only shown when degraded */}
      {sseStatus === 'reconnecting' && (
        <div className="flex items-center gap-1.5 text-status-warning text-xs shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
          <span className="hidden sm:block">{T.topBar.sseReconnecting}</span>
        </div>
      )}
      {sseStatus === 'disconnected' && (
        <div className="flex items-center gap-1.5 text-status-danger text-xs shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-status-danger" />
          <span className="hidden sm:block">{T.topBar.sseOffline}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Board tools hoisted up from the old secondary bar */}
      {toolbarSlot && (
        <>
          <div className="flex items-center gap-1.5 shrink-0">{toolbarSlot}</div>
          <div className="w-px h-5 bg-iron-border/35 shrink-0" />
        </>
      )}

      {/* Zone separator: operational ← → preference + session */}
      <div className="w-px h-5 bg-iron-border/35 shrink-0" />

      {/* ── Settings menu: language + theme ──────────────────────── */}
      <div className="relative shrink-0" ref={settingsRef}>
        <button
          onClick={() => { setSettingsOpen(o => !o); setUserMenuOpen(false); }}
          title={T.topBar.settings}
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
          className={`rounded-lg p-1.5 transition-colors ${settingsOpen ? 'text-iron-text/85 bg-iron-bg/60' : 'text-iron-text/45 hover:text-iron-text/85 hover:bg-iron-bg/60'}`}
        >
          <GearIcon />
        </button>
        {settingsOpen && (
          <div
            dir="rtl"
            className="absolute end-0 top-full mt-2 z-50 min-w-[200px] rounded-xl border border-iron-border/50 bg-iron-elevated p-2"
            style={{ boxShadow: '0 14px 36px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center justify-between gap-2 px-1.5 py-1.5">
              <span className="text-iron-muted/70 text-[11px] font-medium">{T.topBar.language}</span>
              <LanguageSwitcher />
            </div>
            <button
              onClick={onThemeChange}
              className="w-full flex items-center justify-between px-1.5 py-1.5 rounded-lg text-iron-muted/80 hover:text-iron-text hover:bg-iron-border/20 transition-colors"
            >
              <span className="text-[11px] font-medium">{theme === 'dark' ? T.topBar.switchToLight : T.topBar.switchToDark}</span>
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        )}
      </div>

      {/* Zone separator: preferences → session */}
      <div className="w-px h-[22px] bg-iron-border/[0.20] shrink-0" />

      {/* User / session */}
      <div className="flex items-center gap-1">
        {onGuestsPage && (
          <button
            onClick={onGuestsPage}
            className="text-iron-muted/60 text-[11px] font-medium px-2.5 py-1.5 rounded-lg hover:text-iron-text/90 hover:bg-iron-bg/60 border border-transparent hover:border-iron-border/35 transition-colors duration-100"
          >
            {T.topBar.guestsButton}
          </button>
        )}
        {onAdminPortal && (
          <button
            onClick={onAdminPortal}
            className="text-iron-muted/60 text-[11px] font-medium px-2.5 py-1.5 rounded-lg hover:text-iron-text/90 hover:bg-iron-bg/60 border border-transparent hover:border-iron-border/35 transition-colors duration-100"
          >
            {T.topBar.adminButton}
          </button>
        )}

        {/* ── User menu: identity + switch host + logout ──────────── */}
        <div className="relative shrink-0" ref={userMenuRef}>
          <button
            onClick={() => { setUserMenuOpen(o => !o); setSettingsOpen(false); }}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className={`flex items-center gap-2 rounded-lg ps-1.5 pe-2 py-1 border transition-colors ${userMenuOpen ? 'bg-iron-bg/60 border-iron-border/45' : 'border-transparent hover:bg-iron-bg/60 hover:border-iron-border/35'}`}
          >
            <span className="w-7 h-7 rounded-full bg-iron-green/20 border border-iron-green/35 flex items-center justify-center text-iron-green-light text-[12px] font-bold shrink-0 uppercase">
              {userName.slice(0, 1)}
            </span>
            <span className="hidden lg:flex flex-col items-start leading-tight">
              <span className="text-iron-text/85 text-xs font-semibold whitespace-nowrap">{userName}</span>
              <span className="text-iron-muted/55 text-[10px] whitespace-nowrap">{restaurantName}</span>
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`text-iron-muted/55 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {userMenuOpen && (
            <div
              dir="rtl"
              className="absolute end-0 top-full mt-2 z-50 min-w-[200px] rounded-xl border border-iron-border/50 bg-iron-elevated py-1.5"
              style={{ boxShadow: '0 14px 36px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)' }}
            >
              <div className="px-3.5 py-2 mb-1 border-b border-iron-border/30 lg:hidden">
                <p className="text-iron-text/85 text-xs font-semibold">{userName}</p>
                <p className="text-iron-muted/55 text-[10px]">{restaurantName}</p>
              </div>
              {onSwitchHost && (
                <button
                  onClick={() => { setUserMenuOpen(false); onSwitchHost(); }}
                  className="w-full text-start px-3.5 py-2 text-xs font-semibold text-iron-green-light hover:bg-iron-border/20 transition-colors"
                >
                  {T.topBar.switchHost}
                </button>
              )}
              <button
                onClick={() => { setUserMenuOpen(false); onLogout(); }}
                className="w-full text-start px-3.5 py-2 text-xs font-medium text-iron-muted/80 hover:text-status-danger hover:bg-iron-border/20 transition-colors"
              >
                {T.topBar.signOut}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
