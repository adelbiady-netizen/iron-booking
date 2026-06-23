import type React from 'react';

export type MobileTab = 'list' | 'map' | 'calls' | 'guests' | 'more';

interface TabDef {
  id: MobileTab;
  label: string;
  icon: React.ReactNode;
}

function IconList() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function IconCalls() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.23h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.08 6.08l1.04-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z" />
    </svg>
  );
}

function IconGuests() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

const TABS: TabDef[] = [
  { id: 'list',   label: 'רשימה', icon: <IconList /> },
  { id: 'map',    label: 'מפה',   icon: <IconMap /> },
  { id: 'calls',  label: 'שיחות', icon: <IconCalls /> },
  { id: 'guests', label: 'אורחים', icon: <IconGuests /> },
  { id: 'more',   label: 'עוד',   icon: <IconMore /> },
];

interface Props {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

export default function MobileBottomNav({ active, onChange }: Props) {
  return (
    <nav
      dir="rtl"
      className="shrink-0 flex items-stretch border-t border-iron-border/50 bg-iron-elevated"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="ניווט תחתון"
    >
      {TABS.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] transition-colors ${
              isActive
                ? 'text-iron-green-light'
                : 'text-iron-muted hover:text-iron-text active:opacity-60'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className={`transition-transform ${isActive ? 'scale-110' : ''}`}>
              {tab.icon}
            </span>
            <span className={`text-[10px] font-medium leading-none ${isActive ? 'text-iron-green-light' : ''}`}>
              {tab.label}
            </span>
            {isActive && (
              <span
                className="absolute top-0 left-0 right-0 h-[2px] rounded-b"
                style={{ background: '#435B2A' }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
