import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type { AlertCenter, GuestAlertRecord, AlertType } from '../types';

interface Props {
  restaurantId: string;
  onBack: () => void;
}

const TYPE_LABEL: Record<AlertType, string> = {
  FEEDBACK_NEGATIVE: 'משוב שלילי',
  VIP_AT_RISK: 'VIP בסיכון',
  HIGH_NOSHOW: 'לא-הגיע חוזר',
  RECOVERY_OPEN: 'שחזור פתוח',
  SILENT_GUEST: 'אורח שקט',
  BIRTHDAY_SOON: 'יום הולדת בקרוב',
  ANNIVERSARY_SOON: 'יום נישואין בקרוב',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface AlertCardProps {
  alert: GuestAlertRecord;
  tier: 'critical' | 'attention' | 'upcoming';
  onDismiss: (id: string) => void;
}

function AlertCard({ alert, tier, onDismiss }: AlertCardProps) {
  const dotColor =
    tier === 'critical' ? 'bg-red-500' :
    tier === 'attention' ? 'bg-yellow-400' :
    'bg-blue-400';

  const g = alert.guest;

  return (
    <div className="bg-white rounded-lg border border-iron-border px-4 py-3 flex gap-3 items-start relative">
      {/* colored dot */}
      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />

      {/* content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-iron-text text-sm">
            {g ? `${g.firstName} ${g.lastName}` : '—'}
          </span>
          {g?.isVip && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">VIP</span>
          )}
          <span className="text-xs text-iron-muted bg-iron-bg px-1.5 py-0.5 rounded">
            {TYPE_LABEL[alert.type]}
          </span>
        </div>

        <p className="text-sm text-iron-text mt-0.5 leading-snug">{alert.headline}</p>

        {alert.context && (
          <p className="text-xs text-iron-muted mt-0.5 leading-snug">{alert.context}</p>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-xs text-iron-muted flex-wrap">
          <span>{fmtDate(alert.createdAt)}</span>
          {g?.visitCount !== undefined && (
            <span>{g.visitCount} ביקורים</span>
          )}
          {g?.phone && (
            <span dir="ltr">{g.phone}</span>
          )}
        </div>
      </div>

      {/* dismiss */}
      <button
        onClick={() => onDismiss(alert.id)}
        className="text-iron-muted hover:text-iron-text text-lg leading-none flex-shrink-0 mt-0.5 transition-colors"
        aria-label="סגור התראה"
      >
        ×
      </button>
    </div>
  );
}

interface SectionProps {
  emoji: string;
  title: string;
  alerts: GuestAlertRecord[];
  tier: 'critical' | 'attention' | 'upcoming';
  onDismiss: (id: string) => void;
}

function AlertSection({ emoji, title, alerts, tier, onDismiss }: SectionProps) {
  const [open, setOpen] = useState(true);

  if (alerts.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        className="flex items-center gap-2 w-full text-right mb-2"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-base">{emoji}</span>
        <span className="font-semibold text-iron-text text-sm">{title}</span>
        <span className="text-xs bg-iron-muted/20 text-iron-muted px-1.5 py-0.5 rounded-full">
          {alerts.length}
        </span>
        <span className="mr-auto text-iron-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {alerts.map(a => (
            <AlertCard key={a.id} alert={a} tier={tier} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AlertCenterPage({ restaurantId, onBack }: Props) {
  const [data, setData] = useState<AlertCenter | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const center = await api.alerts.center(restaurantId);
      setData(center);
      // Fire-and-forget: mark all as read
      const allAlerts = [
        ...center.critical,
        ...center.attention,
        ...center.upcoming,
      ];
      allAlerts.forEach(a => {
        if (!a.isRead) {
          api.alerts.read(restaurantId, a.id).catch(() => {});
        }
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  const handleDismiss = useCallback(async (alertId: string) => {
    await api.alerts.dismiss(restaurantId, alertId).catch(() => {});
    setData(prev => {
      if (!prev) return prev;
      const filter = (arr: GuestAlertRecord[]) => arr.filter(a => a.id !== alertId);
      const critical = filter(prev.critical);
      const attention = filter(prev.attention);
      const upcoming = filter(prev.upcoming);
      const totalCount = critical.length + attention.length + upcoming.length;
      return { ...prev, critical, attention, upcoming, totalCount };
    });
  }, [restaurantId]);

  const handleDismissAll = useCallback(async () => {
    await api.alerts.dismissAll(restaurantId).catch(() => {});
    setData(prev => prev
      ? { ...prev, critical: [], attention: [], upcoming: [], totalCount: 0, unreadCount: 0 }
      : prev
    );
  }, [restaurantId]);

  return (
    <div className="flex flex-col h-full bg-iron-bg" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-iron-border bg-white">
        <button
          onClick={onBack}
          className="text-iron-muted hover:text-iron-text transition-colors p-1"
          aria-label="חזור"
        >
          {/* chevron right visually = back in RTL */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <h1 className="text-base font-semibold text-iron-text flex-1">מרכז התראות</h1>
        {data && data.unreadCount > 0 && (
          <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-tight">
            {data.unreadCount}
          </span>
        )}
        {data && data.totalCount > 0 && (
          <button
            onClick={handleDismissAll}
            className="text-xs text-iron-muted hover:text-iron-text transition-colors"
          >
            נקה הכל
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-iron-border border-t-iron-primary rounded-full animate-spin" />
          </div>
        ) : !data || data.totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="15" stroke="#22c55e" strokeWidth="2"/>
                <path d="M10 16l4 4 8-8" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-iron-muted text-sm">אין התראות פעילות</p>
          </div>
        ) : (
          <>
            <AlertSection
              emoji="🚨"
              title="קריטי"
              alerts={data.critical}
              tier="critical"
              onDismiss={handleDismiss}
            />
            <AlertSection
              emoji="⚠️"
              title="לתשומת לב"
              alerts={data.attention}
              tier="attention"
              onDismiss={handleDismiss}
            />
            <AlertSection
              emoji="📅"
              title="בקרוב"
              alerts={data.upcoming}
              tier="upcoming"
              onDismiss={handleDismiss}
            />
          </>
        )}
      </div>
    </div>
  );
}
