import type { Theme } from '../App';
import { useT } from '../i18n/useT';
import LanguageSwitcher from './LanguageSwitcher';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

interface Props {
  userName: string;
  restaurantName: string;
  theme: Theme;
  onThemeChange: () => void;
  onLogout: () => void;
  onSwitchHost?: () => void;
  onAdminPortal?: () => void;
  onIntelligencePage?: () => void;
  onGuestsPage?: () => void;
  guestsPageEnabled?: boolean;
}

export default function MobileMorePanel({
  userName,
  restaurantName,
  theme,
  onThemeChange,
  onLogout,
  onSwitchHost,
  onAdminPortal,
  onIntelligencePage,
  onGuestsPage,
  guestsPageEnabled = true,
}: Props) {
  const T = useT();
  const light = theme === 'light';

  return (
    <div
      dir="rtl"
      className="flex flex-col h-full overflow-y-auto bg-iron-bg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* User identity header */}
      <div
        className="px-5 py-6 flex items-center gap-4 border-b border-iron-border/40"
        style={{ background: light ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)' }}
      >
        <div className="w-12 h-12 rounded-full bg-iron-green/20 border-2 border-iron-green/35 flex items-center justify-center text-iron-green-light text-lg font-bold shrink-0 uppercase">
          {userName.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-iron-text font-semibold text-base truncate">{userName}</p>
          <p className="text-iron-muted/70 text-sm truncate">{restaurantName}</p>
        </div>
      </div>

      {/* Navigation links — secondary pages */}
      <div className="px-4 pt-5 pb-2">
        <p className="text-iron-muted/50 text-[11px] font-semibold tracking-widest uppercase px-1 mb-2">ניווט</p>
        <div className="flex flex-col gap-1">
          {onGuestsPage && (
            <button
              onClick={onGuestsPage}
              disabled={!guestsPageEnabled}
              className={`flex items-center gap-3 w-full px-4 py-3.5 rounded-xl text-start text-sm font-medium transition-colors ${
                guestsPageEnabled
                  ? 'text-iron-text/85 hover:bg-iron-elevated active:bg-iron-card'
                  : 'text-iron-muted/35 cursor-not-allowed'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {T.topBar.guestsButton}
            </button>
          )}
          {onIntelligencePage && (
            <button
              onClick={onIntelligencePage}
              className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl text-start text-sm font-medium text-iron-text/85 hover:bg-iron-elevated active:bg-iron-card transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Intelligence
            </button>
          )}
          {onAdminPortal && (
            <button
              onClick={onAdminPortal}
              className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl text-start text-sm font-medium text-iron-text/85 hover:bg-iron-elevated active:bg-iron-card transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
              </svg>
              {T.topBar.adminButton}
            </button>
          )}
        </div>
      </div>

      {/* Preferences */}
      <div className="px-4 pt-3 pb-2">
        <p className="text-iron-muted/50 text-[11px] font-semibold tracking-widest uppercase px-1 mb-2">הגדרות</p>
        <div className="flex flex-col gap-1">
          {/* Language */}
          <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-iron-elevated/60">
            <span className="text-iron-text/85 text-sm font-medium">{T.topBar.language}</span>
            <LanguageSwitcher />
          </div>
          {/* Theme toggle */}
          <button
            onClick={onThemeChange}
            className="flex items-center justify-between w-full px-4 py-3.5 rounded-xl text-iron-text/85 hover:bg-iron-elevated active:bg-iron-card transition-colors"
          >
            <span className="text-sm font-medium">{theme === 'dark' ? T.topBar.switchToLight : T.topBar.switchToDark}</span>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      <div className="flex-1" />

      {/* Session actions */}
      <div className="px-4 pb-4 flex flex-col gap-1 border-t border-iron-border/30 pt-4">
        {onSwitchHost && (
          <button
            onClick={onSwitchHost}
            className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl text-start text-sm font-semibold text-iron-green-light hover:bg-iron-elevated active:bg-iron-card transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <polyline points="16 11 18 13 22 9" />
            </svg>
            {T.topBar.switchHost}
          </button>
        )}
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-4 py-3.5 rounded-xl text-start text-sm font-medium text-iron-muted/70 hover:text-status-danger hover:bg-iron-elevated active:bg-iron-card transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {T.topBar.signOut}
        </button>
      </div>
    </div>
  );
}
