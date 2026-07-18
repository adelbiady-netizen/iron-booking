import { useState, useEffect } from 'react';
import { useT } from '../i18n/useT';
import HostsSettingsPage from './HostsSettingsPage';
import OnlineReservationsSettings from './OnlineReservationsSettings';

interface Props {
  onBack: () => void;
  userRole: string;
}

type Tab = 'team' | 'online';

// Team management is a Restaurant Manager / Owner operation. Mirrors the backend
// requireRole('MANAGER') minimum-level gate on /api/hosts — MANAGER and above.
// Online-reservation controls stay open to every authenticated Host user.
const TEAM_ROLES = new Set([
  'MANAGER', 'ADMIN', 'OWNER', 'RESTAURANT_ADMIN', 'HQ_ADMIN', 'GROUP_MANAGER', 'SUPER_ADMIN',
]);

// Operational control center for the Host application. Groups the day-to-day
// settings a restaurant manager needs during service into one place. Advanced
// business administration (branding, billing, reports, integrations, operating
// hours, subscription) stays in the Portal.
export default function SettingsPage({ onBack, userRole }: Props) {
  const T = useT();
  const canManageTeam = TEAM_ROLES.has(userRole);
  // Non-managers never see the Team tab, so land them on Online Reservations.
  const [tab, setTab] = useState<Tab>(canManageTeam ? 'team' : 'online');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const tabs: { key: Tab; label: string; soon?: boolean }[] = [
    // Team tab is shown only to Restaurant Managers / Owners.
    ...(canManageTeam ? [{ key: 'team' as Tab, label: T.settingsHub.tabTeam }] : []),
    { key: 'online', label: T.settingsHub.tabOnline },
  ];
  const soonTabs = [T.settingsHub.tabNotifications, T.settingsHub.tabSms];

  return (
    <div className="h-full bg-iron-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-iron-border">
        <button
          onClick={onBack}
          className="text-iron-muted hover:text-iron-text text-sm transition-colors"
        >
          {T.settingsHub.back}
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-iron-text font-semibold leading-tight">{T.settingsHub.title}</h1>
          <p className="text-iron-muted text-xs">{T.settingsHub.subtitle}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-iron-border overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'bg-iron-green/20 text-iron-green-light'
                : 'text-iron-muted hover:text-iron-text'
            }`}
          >
            {t.label}
          </button>
        ))}
        {soonTabs.map(label => (
          <span
            key={label}
            className="px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap text-iron-muted/40 flex items-center gap-1 cursor-default"
          >
            {label}
            <span className="text-[9px] uppercase tracking-wider border border-iron-border rounded px-1 py-0.5">
              {T.settingsHub.soon}
            </span>
          </span>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'team' && canManageTeam && (
          <HostsSettingsPage onBack={onBack} userRole={userRole} embedded />
        )}
        {tab === 'online' && (
          <OnlineReservationsSettings onToast={setToast} />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-iron-card border border-iron-border text-iron-text text-xs px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
