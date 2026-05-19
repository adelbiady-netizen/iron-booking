import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { normalizePhone } from '../utils/phone';
import type { CallLogItem } from '../types';

interface Props {
  latestCall?: CallLogItem | null;
  onNewReservation: (phone: string) => void;
  onFindGuest: (phone: string) => void;
  onClose: () => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Only allow https/http recording URLs. Blocks javascript: and other schemes.
// Returns null rather than throwing so a bad URL never crashes the row.
function safeRecordingUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const { protocol } = new URL(raw);
    return protocol === 'https:' || protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

const LIMIT = 25;

export default function CallLogPanel({ latestCall, onNewReservation, onFindGuest, onClose }: Props) {
  const T = useT();
  const [calls, setCalls]     = useState<CallLogItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.callLogs.list({ limit: LIMIT, offset: off });
      setCalls(off === 0 ? res.data : prev => [...prev, ...res.data]);
      setTotal(res.meta.total);
      setOffset(off);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0); }, [load]);

  // Prepend live SSE-delivered call without a refetch. Guard by id to prevent duplicates.
  useEffect(() => {
    if (!latestCall) return;
    setCalls(prev => {
      if (prev.some(c => c.id === latestCall.id)) return prev;
      return [latestCall, ...prev];
    });
    setTotal(prev => prev + 1);
  }, [latestCall]);

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return T.callLog.today;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return T.callLog.yesterday;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  const hasMore = calls.length < total;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex flex-col bg-iron-surface border-l border-iron-border shadow-2xl"
      style={{ width: 360 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-iron-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-iron-text">{T.callLog.title}</span>
          {total > 0 && (
            <span className="text-[11px] text-iron-muted tabular-nums">{total}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-iron-muted hover:text-iron-text text-lg leading-none px-1 transition-colors"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && calls.length === 0 && (
          <p className="text-xs text-iron-muted px-4 py-8 text-center">{T.callLog.loading}</p>
        )}

        {error && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-iron-muted mb-2">{T.callLog.loadError}</p>
            <button
              onClick={() => load(0)}
              className="text-xs text-iron-accent hover:underline"
            >
              {T.callLog.retry}
            </button>
          </div>
        )}

        {!loading && !error && calls.length === 0 && (
          <p className="text-xs text-iron-muted px-4 py-8 text-center">{T.callLog.empty}</p>
        )}

        {calls.map(call => {
          const isAnswered  = call.status === 'answered' || call.status === 'ANSWERED';
          const phone       = call.phone || T.callLog.unknownCaller;
          const dateLabel   = fmtDate(call.createdAt);
          const timeLabel   = fmtTime(call.createdAt);
          const normalized  = call.phone ? normalizePhone(call.phone) : '';
          const recordingUrl = safeRecordingUrl(call.recordUrl);

          return (
            <div
              key={call.id}
              className="px-4 py-3 border-b border-iron-border/40 hover:bg-iron-elevated/30 transition-colors"
            >
              {/* Phone + recording */}
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-iron-text tracking-tight truncate">
                  {phone}
                </span>
                {recordingUrl && (
                  <a
                    href={recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-iron-muted hover:text-iron-accent transition-colors flex-shrink-0"
                  >
                    {T.callLog.recording}
                  </a>
                )}
              </div>

              {/* Metadata: status dot · time · duration · group */}
              <div className="flex items-center gap-1.5 text-[11px] text-iron-muted mb-2.5 flex-wrap">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isAnswered ? 'bg-green-400/70' : 'bg-red-400/60'
                  }`}
                />
                <span className={isAnswered ? 'text-green-400/80' : 'text-red-400/70'}>
                  {isAnswered ? T.callLog.answered : T.callLog.missed}
                </span>
                <span className="opacity-30">·</span>
                <span>{dateLabel} {timeLabel}</span>
                {call.duration != null && call.duration > 0 && (
                  <>
                    <span className="opacity-30">·</span>
                    <span>{T.callLog.duration(call.duration)}</span>
                  </>
                )}
                {call.group && (
                  <>
                    <span className="opacity-30">·</span>
                    <span className="truncate max-w-[80px]">{call.group}</span>
                  </>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNewReservation(normalized)}
                  className="text-[11px] text-iron-muted hover:text-iron-text border border-iron-border/60 hover:border-iron-text/20 rounded px-2 py-0.5 transition-colors"
                >
                  {T.callLog.newReservation}
                </button>
                {normalized && (
                  <button
                    onClick={() => onFindGuest(normalized)}
                    className="text-[11px] text-iron-muted hover:text-iron-text border border-iron-border/60 hover:border-iron-text/20 rounded px-2 py-0.5 transition-colors"
                  >
                    {T.callLog.findGuest}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {hasMore && !loading && (
          <button
            onClick={() => load(offset + LIMIT)}
            className="w-full text-xs text-iron-muted hover:text-iron-text py-3 border-t border-iron-border/40 transition-colors"
          >
            {T.callLog.loadMore}
          </button>
        )}

        {loading && calls.length > 0 && (
          <p className="text-xs text-iron-muted text-center py-3">{T.callLog.loading}</p>
        )}
      </div>
    </div>
  );
}
