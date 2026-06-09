import { useEffect, useState, useCallback, Fragment } from 'react';
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

type Scope = 'today' | 'all';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Format Israeli phone numbers for human scanning: 052 · 815 · 1537 or +972 52 · 815 · 1537
function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('972')) return `+972 ${d.slice(3, 5)} · ${d.slice(5, 8)} · ${d.slice(8)}`;
  if (d.length === 10 && d.startsWith('0'))   return `${d.slice(0, 3)} · ${d.slice(3, 6)} · ${d.slice(6)}`;
  return raw;
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
  const [scope, setScope]     = useState<Scope>('today');

  const load = useCallback(async (off: number, filterDate?: string) => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.callLogs.list({ limit: LIMIT, offset: off, date: filterDate });
      if (off === 0) {
        // Merge: keep any SSE-prepended calls not yet returned by the DB (e.g. arrived
        // just after UTC midnight when the date filter targets the previous UTC day).
        setCalls(prev => {
          const dbIds = new Set(res.data.map(c => c.id));
          const liveOnly = prev.filter(c => !dbIds.has(c.id));
          return [...liveOnly, ...res.data];
        });
      } else {
        setCalls(prev => [...prev, ...res.data]);
      }
      setTotal(res.meta.total);
      setOffset(off);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload from scratch whenever scope changes.
  // Compute the UTC date fresh each time so stale-mount dates never filter out recent calls.
  useEffect(() => {
    const filterDate = scope === 'today' ? new Date().toISOString().slice(0, 10) : undefined;
    console.log('[call:panel] scope effect — scope:', scope, 'filterDate:', filterDate, 'latestCallId:', latestCall?.id ?? 'none');
    setCalls([]);
    setTotal(0);
    setOffset(0);
    load(0, filterDate);
  }, [load, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prepend live SSE-delivered call without a refetch. Guard by id to prevent duplicates.
  useEffect(() => {
    if (!latestCall) return;
    console.log('[call:panel] ④ latestCall effect fired', { id: latestCall.id, phone: latestCall.phone, status: latestCall.status });
    setCalls(prev => {
      const isDupe = prev.some(c => c.id === latestCall.id);
      console.log('[call:panel] ⑤ setCalls — prevLen:', prev.length, 'isDupe:', isDupe, 'result:', isDupe ? prev.length : prev.length + 1);
      if (isDupe) return prev;
      return [latestCall, ...prev];
    });
    setTotal(prev => prev + 1);
  }, [latestCall]);

  function fmtDateLabel(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return T.callLog.today;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return T.callLog.yesterday;
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  const missedCount = calls.filter(c => c.status !== 'answered' && c.status !== 'ANSWERED').length;
  const hasMore = calls.length < total;

  return (
    <div className="h-full flex flex-col bg-iron-elevated border-s border-iron-border/60" style={{ boxShadow: '-1px 0 0 rgba(255,255,255,0.06), -3px 0 0 rgba(0,0,0,0.12), -20px 0 60px rgba(0,0,0,0.62)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-iron-border/40"
        style={{ boxShadow: missedCount > 0 ? '0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.22), inset 0 -2px 0 rgba(239,68,68,0.16)' : '0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.22)' }}
      >
        <div>
          <div className="flex items-center gap-2">
            <p className="text-iron-text font-semibold text-sm leading-tight">{T.callLog.title}</p>
            {missedCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-status-danger/15 border border-status-danger/30 text-status-danger tabular-nums leading-none">
                {missedCount} {T.callLog.missed.toLowerCase()}
              </span>
            )}
          </div>
          {total > 0 && (
            <p className="text-iron-muted/55 text-[11px] font-medium leading-tight mt-0.5 tabular-nums">
              {total} {T.callLog.title.toLowerCase()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Scope toggle: Today / All */}
          <div className="flex items-center bg-iron-bg/40 rounded-xl overflow-hidden divide-x divide-iron-border/20">
            {(['today', 'all'] as Scope[]).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  scope === s
                    ? 'bg-iron-green/18 text-iron-green-light'
                    : 'text-iron-muted/70 hover:text-iron-text hover:bg-iron-bg/60'
                }`}
              >
                {s === 'today' ? T.callLog.today : T.callLog.all}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="text-iron-muted/50 hover:text-iron-text text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-iron-bg/60 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>
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
              onClick={() => load(0, scope === 'today' ? new Date().toISOString().slice(0, 10) : undefined)}
              className="text-xs font-medium text-iron-green-light hover:text-iron-green transition-colors"
            >
              {T.callLog.retry}
            </button>
          </div>
        )}

        {!loading && !error && calls.length === 0 && (
          <div className="px-5 py-12 text-center space-y-3">
            <p className="text-iron-muted/55 text-sm">
              {scope === 'today' ? T.callLog.empty : T.callLog.empty}
            </p>
            {scope === 'today' && (
              <button
                onClick={() => setScope('all')}
                className="text-[11px] font-medium text-iron-muted/70 hover:text-iron-text transition-colors"
              >
                {T.callLog.loadMore}
              </button>
            )}
          </div>
        )}

        {/* Call list with date group headers */}
        {(() => {
          let lastDateKey = '';
          return calls.map(call => {
            const isAnswered   = call.status === 'answered' || call.status === 'ANSWERED';
            const rawPhone     = call.phone || '';
            const displayPhone = rawPhone ? fmtPhone(rawPhone) : T.callLog.unknownCaller;
            const normalized   = rawPhone ? normalizePhone(rawPhone) : '';
            const recordingUrl = safeRecordingUrl(call.recordUrl);
            const timeLabel    = fmtTime(call.createdAt);
            const hasPhone     = !!rawPhone;

            const dateKey = new Date(call.createdAt).toDateString();
            const showDateHeader = scope === 'all' && dateKey !== lastDateKey;
            lastDateKey = dateKey;

            return (
              <Fragment key={call.id}>
                {showDateHeader && (
                  <div className="px-5 py-2 flex items-center gap-3 bg-iron-bg/25 border-b border-iron-border/15">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-iron-muted/60 leading-none">
                      {fmtDateLabel(call.createdAt)}
                    </span>
                    <div className="flex-1 h-px bg-iron-border/15" />
                  </div>
                )}
                <div
                  className={`relative px-5 py-4 transition-colors duration-100 border-b border-iron-border/15 ${
                    !isAnswered
                      ? 'border-s-2 border-s-red-500/60 hover:bg-red-950/18'
                      : 'border-s-2 border-s-transparent hover:bg-iron-bg/35'
                  }${call.id === latestCall?.id ? ' animate-row-in' : ''}`}
                >
                  {/* Row 1: status + time */}
                  <div className="flex items-center justify-between gap-3 mb-2.5">
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                      isAnswered
                        ? 'bg-iron-green/12 border-iron-green/30 text-iron-green-light'
                        : 'bg-status-danger/12 border-status-danger/30 text-status-danger'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAnswered ? 'bg-iron-green-light' : 'bg-status-danger'}`} />
                      {isAnswered ? T.callLog.answered : T.callLog.missed}
                    </div>
                    <span className="text-iron-muted/55 text-[11px] font-medium tabular-nums shrink-0">
                      {timeLabel}
                    </span>
                  </div>

                  {/* Row 2: caller identity — guest name first when matched, phone below */}
                  {call.guestName ? (
                    <div className="mb-3">
                      <p className="font-semibold text-iron-text text-[17px] leading-tight">{call.guestName}</p>
                      <p className="text-iron-muted/55 text-[12px] tabular-nums leading-tight mt-0.5">{displayPhone}</p>
                    </div>
                  ) : (
                    <p className={`font-bold tabular-nums tracking-tight leading-none mb-3 ${
                      hasPhone
                        ? 'text-iron-text text-[20px]'
                        : 'text-iron-muted/60 text-[15px] italic font-normal'
                    }`}>
                      {displayPhone}
                    </p>
                  )}

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
              </Fragment>
            );
          });
        })()}

        {hasMore && !loading && (
          <button
            onClick={() => load(offset + LIMIT, scope === 'today' ? new Date().toISOString().slice(0, 10) : undefined)}
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
