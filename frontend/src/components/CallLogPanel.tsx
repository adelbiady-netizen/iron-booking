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
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const missedCount = calls.filter(c => c.status !== 'answered' && c.status !== 'ANSWERED').length;
  const hasMore = calls.length < total;

  return (
    <div className="h-full flex flex-col bg-iron-elevated border-s border-iron-border/80" style={{ boxShadow: '-1px 0 0 rgba(255,255,255,0.06), -8px 0 40px rgba(0,0,0,0.48)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-iron-border/40"
        style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.04)' }}
      >
        <div className="flex items-center gap-3">
          <div>
            <p className="text-iron-text font-semibold text-sm leading-tight">{T.callLog.title}</p>
            {total > 0 && (
              <p className="text-iron-muted/60 text-[11px] font-medium leading-tight mt-0.5 tabular-nums">
                {total} {T.callLog.title.toLowerCase()}
                {missedCount > 0 && (
                  <span className="text-red-400/80"> · {missedCount} {T.callLog.missed.toLowerCase()}</span>
                )}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-iron-muted/50 hover:text-iron-text text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-iron-bg/60 transition-colors"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && calls.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
              <p className="text-iron-muted/60 text-xs">{T.callLog.loading}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="px-5 py-12 text-center">
            <p className="text-iron-muted/70 text-sm mb-3">{T.callLog.loadError}</p>
            <button
              onClick={() => load(0)}
              className="text-xs font-medium text-iron-green-light hover:text-iron-green transition-colors"
            >
              {T.callLog.retry}
            </button>
          </div>
        )}

        {!loading && !error && calls.length === 0 && (
          <div className="px-5 py-16 text-center">
            <p className="text-iron-muted/50 text-sm">{T.callLog.empty}</p>
          </div>
        )}

        <div className="divide-y divide-iron-border/15">
          {calls.map(call => {
            const isAnswered   = call.status === 'answered' || call.status === 'ANSWERED';
            const phone        = call.phone || T.callLog.unknownCaller;
            const normalized   = call.phone ? normalizePhone(call.phone) : '';
            const recordingUrl = safeRecordingUrl(call.recordUrl);
            const dateLabel    = fmtDate(call.createdAt);
            const timeLabel    = fmtTime(call.createdAt);
            const hasPhone     = !!call.phone;

            return (
              <div
                key={call.id}
                className={`relative px-5 py-4 hover:bg-iron-bg/35 transition-colors duration-100 group ${
                  !isAnswered ? 'border-s-2 border-s-red-500/55' : 'border-s-2 border-s-transparent'
                }`}
              >
                {/* Row 1: status + time */}
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                    isAnswered
                      ? 'bg-iron-green/12 border-iron-green/30 text-iron-green-light'
                      : 'bg-red-500/12 border-red-500/30 text-red-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAnswered ? 'bg-iron-green-light' : 'bg-red-400'}`} />
                    {isAnswered ? T.callLog.answered : T.callLog.missed}
                  </div>
                  <span className="text-iron-muted/55 text-[11px] font-medium tabular-nums shrink-0">
                    {dateLabel} · {timeLabel}
                  </span>
                </div>

                {/* Row 2: caller identity */}
                <p className={`font-bold tabular-nums tracking-tight leading-none mb-3 ${
                  hasPhone
                    ? 'text-iron-text text-[19px]'
                    : 'text-iron-muted/60 text-[15px] italic'
                }`}>
                  {phone}
                </p>

                {/* Row 3: secondary metadata + actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(call.duration != null && call.duration > 0 || call.group) && (
                    <div className="flex items-center gap-1.5 text-xs text-iron-muted/60 mr-1">
                      {call.duration != null && call.duration > 0 && (
                        <span className="tabular-nums">{T.callLog.duration(call.duration)}</span>
                      )}
                      {call.duration != null && call.duration > 0 && call.group && (
                        <span className="text-iron-muted/30">·</span>
                      )}
                      {call.group && (
                        <span className="truncate max-w-[90px]">{call.group}</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 ml-auto">
                    {recordingUrl && (
                      <a
                        href={recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-iron-muted/55 hover:text-iron-text px-2 py-1 rounded-md hover:bg-iron-bg/60 transition-colors"
                      >
                        {T.callLog.recording}
                      </a>
                    )}
                    {!isAnswered ? (
                      <button
                        onClick={() => onNewReservation(normalized)}
                        className="text-[11px] font-semibold text-iron-green-light hover:text-iron-green px-2.5 py-1 rounded-md bg-iron-green/10 border border-iron-green/25 hover:bg-iron-green/18 transition-colors"
                      >
                        {T.callLog.newReservation}
                      </button>
                    ) : (
                      <button
                        onClick={() => onNewReservation(normalized)}
                        className="text-[11px] font-medium text-iron-muted hover:text-iron-text px-2.5 py-1 rounded-md border border-iron-border/40 hover:border-iron-border/60 hover:bg-iron-bg/50 transition-colors"
                      >
                        {T.callLog.newReservation}
                      </button>
                    )}
                    {hasPhone && (
                      <button
                        onClick={() => onFindGuest(normalized)}
                        className="text-[11px] font-medium text-iron-muted hover:text-iron-text px-2.5 py-1 rounded-md border border-iron-border/40 hover:border-iron-border/60 hover:bg-iron-bg/50 transition-colors"
                      >
                        {T.callLog.findGuest}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && !loading && (
          <button
            onClick={() => load(offset + LIMIT)}
            className="w-full text-xs font-medium text-iron-muted/70 hover:text-iron-text py-4 border-t border-iron-border/20 transition-colors hover:bg-iron-bg/30"
          >
            {T.callLog.loadMore}
          </button>
        )}

        {loading && calls.length > 0 && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
