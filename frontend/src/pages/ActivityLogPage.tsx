import { useState, useEffect, useCallback } from 'react';
import type { ActivityLogEntry } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';

interface Props {
  onBack: () => void;
  userRole: string;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(entry: ActivityLogEntry, locale: 'en' | 'he'): string {
  const actor = entry.actor;
  const guest = entry.guestName;
  const from  = entry.fromTableName;
  const to    = entry.toTableName;
  const tbl   = entry.tableName;

  if (locale === 'he') {
    switch (entry.action) {
      case 'CREATED':
        return `${actor} יצר הזמנה עבור ${guest}`;
      case 'UPDATED':
        return `${actor} עדכן את הזמנתו של ${guest}`;
      case 'CONFIRMED':
        return `${actor} אישר את הזמנתו של ${guest}`;
      case 'REVERTED_TO_PENDING':
        return `${actor} החזיר את ${guest} למצב ממתין`;
      case 'SEATED':
        return tbl ? `${actor} הושיב את ${guest} בשולחן ${tbl}` : `${actor} הושיב את ${guest}`;
      case 'MOVED':
      case 'TABLE_MOVED':
        return from && to
          ? `${actor} העביר את ${guest} מ${from} ל${to}`
          : `${actor} העביר את ${guest}`;
      case 'TABLE_ASSIGNED':
        return tbl ? `${actor} שייך שולחן ${tbl} ל${guest}` : `${actor} שייך שולחן ל${guest}`;
      case 'COMPLETED':
        return `${actor} סיים את הביקור של ${guest}`;
      case 'CANCELLED':
        return `${actor} ביטל את הזמנתו של ${guest}`;
      case 'NO_SHOW':
        return `${actor} סימן את ${guest} כלא הגיע`;
      case 'RETURN_TO_LIST':
        return `${actor} החזיר את ${guest} לרשימה`;
      case 'REORGANIZE_TRIGGERED':
        return `${actor} הפעיל ארגון מחדש עבור ${guest}`;
      case 'REORGANIZE_RESOLVED':
        return `${actor} פתר ארגון מחדש עבור ${guest}`;
      default:
        return `${actor} — ${entry.action}`;
    }
  }

  switch (entry.action) {
    case 'CREATED':
      return `${actor} created reservation for ${guest}`;
    case 'UPDATED':
      return `${actor} updated ${guest}'s reservation`;
    case 'CONFIRMED':
      return `${actor} confirmed ${guest}`;
    case 'REVERTED_TO_PENDING':
      return `${actor} reverted ${guest} to pending`;
    case 'SEATED':
      return tbl ? `${actor} seated ${guest} at ${tbl}` : `${actor} seated ${guest}`;
    case 'MOVED':
    case 'TABLE_MOVED':
      return from && to
        ? `${actor} moved ${guest} from ${from} to ${to}`
        : `${actor} moved ${guest}`;
    case 'TABLE_ASSIGNED':
      return tbl ? `${actor} assigned ${tbl} to ${guest}` : `${actor} assigned table to ${guest}`;
    case 'COMPLETED':
      return `${actor} completed ${guest}'s visit`;
    case 'CANCELLED':
      return `${actor} cancelled ${guest}'s reservation`;
    case 'NO_SHOW':
      return `${actor} marked ${guest} as no-show`;
    case 'RETURN_TO_LIST':
      return `${actor} returned ${guest} to list`;
    case 'REORGANIZE_TRIGGERED':
      return `${actor} triggered reorganize for ${guest}`;
    case 'REORGANIZE_RESOLVED':
      return `${actor} resolved reorganize for ${guest}`;
    default:
      return `${actor} — ${entry.action}`;
  }
}

const ACTION_BADGE: Record<string, string> = {
  CREATED:              'bg-blue-500/20 text-blue-300',
  UPDATED:              'bg-iron-muted/20 text-iron-muted',
  CONFIRMED:            'bg-green-500/20 text-green-300',
  REVERTED_TO_PENDING:  'bg-amber-500/20 text-amber-300',
  SEATED:               'bg-emerald-500/20 text-emerald-300',
  MOVED:                'bg-purple-500/20 text-purple-300',
  TABLE_ASSIGNED:       'bg-indigo-500/20 text-indigo-300',
  TABLE_MOVED:          'bg-purple-500/20 text-purple-300',
  COMPLETED:            'bg-iron-muted/20 text-iron-muted',
  CANCELLED:            'bg-red-500/20 text-red-300',
  NO_SHOW:              'bg-red-500/20 text-red-300',
  RETURN_TO_LIST:       'bg-amber-500/20 text-amber-300',
  REORGANIZE_TRIGGERED: 'bg-orange-500/20 text-orange-300',
  REORGANIZE_RESOLVED:  'bg-teal-500/20 text-teal-300',
};

export default function ActivityLogPage({ onBack, userRole }: Props) {
  const T = useT();
  const { locale, dir } = useLocale();
  const isManager = ['MANAGER', 'ADMIN', 'OWNER', 'HQ_ADMIN', 'GROUP_MANAGER', 'SUPER_ADMIN'].includes(userRole);

  const [date,         setDate]         = useState(todayStr());
  const [actorFilter,  setActorFilter]  = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entries,      setEntries]      = useState<ActivityLogEntry[]>([]);
  const [total,        setTotal]        = useState(0);
  const [page,         setPage]         = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  const LIMIT = 50;

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    setError('');
    const nextPage = reset ? 1 : page + 1;
    try {
      const result = await api.reservations.activityLog({
        date,
        actor:  actorFilter.trim() || undefined,
        action: actionFilter || undefined,
        page:   nextPage,
        limit:  LIMIT,
      });
      if (reset) {
        setEntries(result.data);
        setPage(1);
      } else {
        setEntries(prev => [...prev, ...result.data]);
        setPage(nextPage);
      }
      setTotal(result.meta.total);
    } catch {
      setError(T.activityLog.loadError);
    } finally {
      setLoading(false);
    }
  }, [date, actorFilter, actionFilter, page, T]);

  // Reload on filter change
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, actorFilter, actionFilter]);

  const hasMore = entries.length < total;

  return (
    <div className="h-full flex flex-col bg-iron-bg" dir={dir}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-iron-border bg-iron-card shrink-0">
        <button
          onClick={onBack}
          className="text-sm text-iron-muted hover:text-iron-text transition-colors"
        >
          {T.activityLog.backButton}
        </button>
        <h1 className="text-iron-text font-semibold text-base flex-1">{T.activityLog.title}</h1>
        {total > 0 && (
          <span className="text-xs text-iron-muted">
            {total} {T.activityLog.totalEntries}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-iron-border bg-iron-card shrink-0">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-iron-muted">{T.activityLog.filterDate}</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="text-xs bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text focus:outline-none focus:border-iron-text/40"
          />
        </div>
        {isManager && (
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-iron-muted">{T.activityLog.filterHost}</label>
            <input
              type="text"
              value={actorFilter}
              onChange={e => setActorFilter(e.target.value)}
              placeholder={T.activityLog.allHosts}
              className="text-xs bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text placeholder:text-iron-muted/50 focus:outline-none focus:border-iron-text/40 w-32"
            />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-iron-muted">{T.activityLog.filterAction}</label>
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="text-xs bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text focus:outline-none focus:border-iron-text/40"
          >
            <option value="">{T.activityLog.allActions}</option>
            {Object.keys(T.activityLog.actions).map(a => (
              <option key={a} value={a}>{T.activityLog.actions[a]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && entries.length === 0 && (
          <p className="text-iron-muted text-sm text-center py-10">{T.activityLog.loading}</p>
        )}
        {error && (
          <p className="text-red-400 text-sm text-center py-10">{error}</p>
        )}
        {!loading && !error && entries.length === 0 && (
          <p className="text-iron-muted text-sm text-center py-10">{T.activityLog.empty}</p>
        )}

        {entries.length > 0 && (
          <div className="divide-y divide-iron-border/50">
            {entries.map(entry => {
              const badgeCls = ACTION_BADGE[entry.action] ?? 'bg-iron-muted/20 text-iron-muted';
              return (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-iron-card/50 transition-colors">
                  <span className="text-xs text-iron-muted w-12 shrink-0 pt-0.5">
                    {fmtTime(entry.timestamp)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-iron-text leading-snug">
                      {describe(entry, locale)}
                    </p>
                  </div>
                  <span className={`text-xs rounded px-1.5 py-0.5 shrink-0 ${badgeCls}`}>
                    {T.activityLog.actions[entry.action] ?? entry.action}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              onClick={() => load(false)}
              disabled={loading}
              className="text-xs text-iron-muted hover:text-iron-text border border-iron-border hover:border-iron-text/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              {loading ? T.activityLog.loading : T.activityLog.loadMore}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
