import { useState, useMemo, useEffect } from 'react';
import type { GuestLookupResult, GuestSearchResult, WaitlistEntry } from '../types';
import type { TableSuggestion } from '../utils/seating';
import type { PriorityEntry } from '../utils/flowControl';
import { api } from '../api';
import { T } from '../strings';

function waitMins(addedAt: string, opNow: number): number {
  return Math.floor((opNow - new Date(addedAt).getTime()) / 60_000);
}

export interface NextInLineItem {
  entry: WaitlistEntry;
  tableId: string;
  tableName: string;
}

interface Props {
  entries: WaitlistEntry[];
  loading: boolean;
  onAdd: (data: { guestName: string; partySize: number; guestPhone?: string }) => Promise<void>;
  onSeat: (entry: WaitlistEntry) => void;
  onNotify?: (entry: WaitlistEntry) => Promise<void>;
  onCancel: (entry: WaitlistEntry) => void;
  onNoShow: (entry: WaitlistEntry) => void;
  nextInLine?: NextInLineItem[];
  onSeatAtTable?: (tableId: string, entry: WaitlistEntry) => void;
  entrySuggestions?: Map<string, TableSuggestion[]>;
  priorityQueue?: PriorityEntry[];
  operationalNow?: number;
}

export default function WaitlistPanel({ entries, loading, onAdd, onSeat, onNotify, onCancel, onNoShow, nextInLine = [], onSeatAtTable, entrySuggestions, priorityQueue, operationalNow }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name,      setName]      = useState('');
  const [partySize, setPartySize] = useState('2');
  const [phone,     setPhone]     = useState('');
  const [guestHint,     setGuestHint]     = useState<GuestLookupResult | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [nameResults,   setNameResults]   = useState<GuestSearchResult[]>([]);
  const [showNameDrop,  setShowNameDrop]  = useState(false);
  const [busyNotify, setBusyNotify] = useState<string | null>(null);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    entryId: string; tableId: string; tableName: string; conflictMin: number;
  } | null>(null);

  // Build lookup maps for rank and urgency from priorityQueue
  const rankMap    = useMemo(() => new Map(priorityQueue?.map(pe => [pe.entry.id, pe.rank])    ?? []), [priorityQueue]);
  const urgencyMap = useMemo(() => new Map(priorityQueue?.map(pe => [pe.entry.id, pe.urgency]) ?? []), [priorityQueue]);

  function resetForm() {
    setName(''); setPartySize('2'); setPhone(''); setError(null);
    setGuestHint(null); setHintDismissed(false);
    setNameResults([]); setShowNameDrop(false);
  }

  // Debounced guest search by name — skipped when phone already identified a guest
  useEffect(() => {
    const q = name.trim();
    if (q.length < 2 || (guestHint && !hintDismissed)) {
      setNameResults([]); setShowNameDrop(false); return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.guests.search(q, 6);
        setNameResults(data);
        setShowNameDrop(data.length > 0);
      } catch { /* non-fatal */ }
    }, 300);
    return () => clearTimeout(t);
  }, [name, guestHint, hintDismissed]);

  // Debounced guest lookup by phone
  useEffect(() => {
    if (!phone.trim()) { setGuestHint(null); setHintDismissed(false); return; }
    const t = setTimeout(async () => {
      try {
        const { guest } = await api.guests.lookupByPhone(phone);
        setGuestHint(guest);
        setHintDismissed(false);
        if (guest) {
          setName(prev => prev === '' ? `${guest.firstName} ${guest.lastName}` : prev);
        }
      } catch { /* non-fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [phone]);

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        guestName: name.trim(),
        partySize: Math.max(1, parseInt(partySize) || 1),
        guestPhone: phone.trim() || undefined,
      });
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add guest');
    } finally {
      setBusy(false);
    }
  }

  const activeRaw = entries.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED');
  const active = priorityQueue
    ? [...activeRaw].sort((a, b) => (rankMap.get(a.id) ?? 999) - (rankMap.get(b.id) ?? 999))
    : activeRaw;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Ready to seat */}
      {nextInLine.length > 0 && (
        <div className="p-3 border-b border-iron-border bg-iron-green/5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-iron-green-light/70">
            {T.waitlistPanel.readyToSeat}
          </p>
          {nextInLine.map(({ entry, tableId, tableName }) => {
            const readyNow = entry.estimatedWaitMin === 0;
            return (
              <div key={entry.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${
                readyNow
                  ? 'bg-iron-green/15 border-iron-green/40'
                  : 'bg-iron-card border-iron-green/20'
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-iron-text text-xs font-medium truncate">{entry.guestName}</p>
                    {readyNow && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-iron-green/30 text-iron-green-light shrink-0">
                        {T.waitlistPanel.etaReady}
                      </span>
                    )}
                  </div>
                  <p className="text-iron-muted text-[10px]">
                    {T.waitlistPanel.guests(entry.partySize)}
                    {' · '}{T.waitlistPanel.tableLabel(tableName)}
                    {' · '}{(() => { const m = waitMins(entry.addedAt, operationalNow ?? Date.now()); return m < 1 ? T.waitlistPanel.justAdded : T.waitlistPanel.waitingMin(m); })()}
                  </p>
                </div>
                <button
                  onClick={() => onSeatAtTable?.(tableId, entry)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors shrink-0"
                >
                  {T.waitlistPanel.seatButton}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      <div className="p-3 border-b border-iron-border">
        {showForm ? (
          <div className="space-y-2">
            <div className="relative">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setShowNameDrop(false);
                  else if (e.key === 'Enter') handleAdd();
                }}
                onBlur={() => setShowNameDrop(false)}
                placeholder={T.waitlistPanel.namePlaceholder}
                className="w-full bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
              />
              {showNameDrop && nameResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-iron-card border border-iron-border rounded-lg shadow-xl z-50 overflow-hidden">
                  {nameResults.map(g => (
                    <button
                      key={g.id}
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setName(`${g.firstName} ${g.lastName}`);
                        setPhone(g.phone ?? '');
                        setShowNameDrop(false);
                        setNameResults([]);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-iron-bg/60 text-left transition-colors border-b border-iron-border/30 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-iron-text">{g.firstName} {g.lastName}</span>
                          {g.isVip && <span className="text-[9px] font-semibold text-amber-400">VIP</span>}
                        </div>
                        <div className="text-[10px] text-iron-muted mt-0.5 flex items-center gap-1.5">
                          {g.phone && <span>{g.phone}</span>}
                          {g.visitCount > 0 && <span className="text-iron-muted/60">{g.visitCount} visit{g.visitCount !== 1 ? 's' : ''}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="number" min={1} max={30}
                value={partySize}
                onChange={e => setPartySize(e.target.value)}
                placeholder={T.waitlistPanel.partyPlaceholder}
                className="w-20 bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs text-center focus:outline-none focus:border-iron-green transition-colors"
              />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder={T.waitlistPanel.phonePlaceholder}
                className="flex-1 bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
              />
            </div>
            {guestHint && !hintDismissed && (
              <div className="rounded-lg border border-iron-green/30 bg-iron-green/5 px-2.5 py-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-iron-green-light text-xs font-medium">{guestHint.firstName} {guestHint.lastName}</span>
                    {guestHint.isVip && <span className="text-[10px] font-semibold text-amber-400">VIP</span>}
                  </div>
                  <button type="button" onClick={() => setHintDismissed(true)} className="text-iron-muted hover:text-iron-text text-base leading-none px-0.5">×</button>
                </div>
                <div className="text-[11px] text-iron-muted space-y-0.5">
                  <div>
                    {guestHint.visitCount} visit{guestHint.visitCount !== 1 ? 's' : ''}
                    {guestHint.noShowCount > 0 && <span className="text-orange-400"> · {guestHint.noShowCount} no-show{guestHint.noShowCount !== 1 ? 's' : ''}</span>}
                    {guestHint.lastVisitAt && <span> · last {new Date(guestHint.lastVisitAt).toLocaleDateString()}</span>}
                  </div>
                  {guestHint.allergies.length > 0 && <div className="text-red-400">⚠ {guestHint.allergies.join(', ')}</div>}
                  {guestHint.internalNotes && <div className="text-iron-muted/70 italic truncate">{guestHint.internalNotes}</div>}
                </div>
              </div>
            )}
            {error && <p className="text-red-400 text-[11px]">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={busy || !name.trim()}
                className="flex-1 text-xs font-medium py-1.5 rounded-md bg-iron-green hover:bg-iron-green-light text-white transition-colors disabled:opacity-40"
              >
                {busy ? T.waitlistPanel.addBusy : T.waitlistPanel.addButton}
              </button>
              <button
                onClick={() => { setShowForm(false); resetForm(); }}
                className="text-xs px-3 py-1.5 text-iron-muted hover:text-iron-text transition-colors"
              >
                {T.waitlistPanel.cancelButton}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-xs font-medium py-1.5 rounded-md border border-dashed border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-green-light transition-colors"
          >
            {T.waitlistPanel.addLink}
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && active.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
            <p className="text-iron-muted text-sm">{T.waitlistPanel.emptyTitle}</p>
            <p className="text-iron-muted text-xs opacity-60">
              {T.waitlistPanel.emptyHint}
            </p>
          </div>
        )}

        {!loading && active.map((entry, i) => {
          const mins    = waitMins(entry.addedAt, operationalNow ?? Date.now());
          const eta     = entry.estimatedWaitMin;
          const etaColor = eta === null ? '' : eta < 10 ? 'text-iron-muted' : eta <= 20 ? 'text-amber-400' : 'text-red-400';
          const urgency = urgencyMap.get(entry.id) ?? 'normal';
          const rank    = rankMap.get(entry.id) ?? (i + 1);
          return (
            <div key={entry.id} className={`px-3 py-2.5 border-b border-iron-border/40 ${urgency === 'critical' ? 'bg-red-900/5' : urgency === 'high' ? 'bg-amber-900/5' : ''}`}>
              <div className="flex items-start gap-2 mb-1.5">
                <span className={`text-[10px] font-mono w-4 shrink-0 mt-0.5 text-right font-semibold ${urgency === 'critical' ? 'text-red-400' : urgency === 'high' ? 'text-amber-400' : 'text-iron-muted'}`}>
                  #{rank}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
                    <p className="text-iron-text text-xs font-medium truncate">{entry.guestName}</p>
                    {urgency === 'critical' && (
                      <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-red-900/30 border border-red-500/30 text-red-400 shrink-0">
                        {T.flowControl.urgencyCritical}
                      </span>
                    )}
                    {urgency === 'high' && (
                      <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-900/30 border border-amber-500/30 text-amber-400 shrink-0">
                        {T.flowControl.urgencyHigh}
                      </span>
                    )}
                  </div>
                  <p className="text-iron-muted text-[10px]">
                    {T.waitlistPanel.guests(entry.partySize)}
                    {' · '}{mins < 1 ? T.waitlistPanel.justAdded : T.waitlistPanel.waitingMin(mins)}
                    {eta !== null && (
                      <span className={etaColor}>
                        {' · '}
                        {eta === 0
                          ? <span className="text-iron-green-light">{T.waitlistPanel.etaReady}</span>
                          : T.waitlistPanel.etaMin(eta)
                        }
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-6">
                <button
                  onClick={() => onSeat(entry)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/30 text-iron-green-light hover:bg-iron-green/25 transition-colors"
                >
                  {T.waitlistPanel.seatButton}
                </button>
                {(() => {
                  if (entry.notifiedAt) {
                    const m = Math.floor((Date.now() - new Date(entry.notifiedAt).getTime()) / 60_000);
                    return (
                      <span className="text-[11px] px-2.5 py-1 rounded-md border border-blue-500/30 text-blue-400 bg-blue-500/10">
                        {m < 1 ? T.waitlistPanel.notifiedJustNow : T.waitlistPanel.notifiedAgo(m)}
                      </span>
                    );
                  }
                  if (entry.guestPhone && onNotify) {
                    return (
                      <button
                        disabled={busyNotify === entry.id}
                        onClick={async () => {
                          setBusyNotify(entry.id);
                          try { await onNotify(entry); } finally { setBusyNotify(null); }
                        }}
                        className="text-[11px] px-2.5 py-1 rounded-md border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-40"
                      >
                        {busyNotify === entry.id ? '…' : T.waitlistPanel.notifyButton}
                      </button>
                    );
                  }
                  return null;
                })()}
                <button
                  onClick={() => onNoShow(entry)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-orange-900/20 text-orange-400 hover:bg-orange-900/10 transition-colors"
                >
                  {T.waitlistPanel.noShow}
                </button>
                <button
                  onClick={() => onCancel(entry)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
                >
                  {T.waitlistPanel.cancelButton}
                </button>
              </div>

              {/* Smart seat suggestion chips */}
              {(() => {
                const sugs = entrySuggestions?.get(entry.id) ?? [];
                if (sugs.length === 0) return null;

                if (pendingConflict?.entryId === entry.id) {
                  return (
                    <div className="mt-1.5 pl-6">
                      <div className="rounded-md bg-amber-900/15 border border-amber-500/30 px-2 py-1.5">
                        <p className="text-amber-400 text-[10px] font-medium mb-1.5">
                          {T.smartSeat.conflictWarn(pendingConflict.conflictMin)}
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              onSeatAtTable?.(pendingConflict.tableId, entry);
                              setPendingConflict(null);
                            }}
                            className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-400 hover:bg-amber-500/30 transition-colors"
                          >
                            {T.smartSeat.seatAnyway}
                          </button>
                          <button
                            onClick={() => setPendingConflict(null)}
                            className="text-[10px] px-2 py-0.5 rounded border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
                          >
                            {T.common.cancel}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="mt-1.5 pl-6 flex flex-wrap gap-1">
                    {sugs.map(sug => {
                      const isAvailableNow = sug.minutesUntilFree === 0;
                      if (!isAvailableNow) {
                        // Table not yet free — show as informational only, not clickable
                        return (
                          <span
                            key={sug.tableId}
                            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-iron-border/40 bg-iron-bg text-iron-muted/50 cursor-default select-none"
                            title={sug.minutesUntilFree != null ? `Frees in ~${sug.minutesUntilFree}m` : 'Not available'}
                          >
                            <span>{sug.tableName}</span>
                            <span className="opacity-60">
                              {sug.minutesUntilFree != null ? `~${sug.minutesUntilFree}m` : sug.label}
                            </span>
                          </span>
                        );
                      }
                      return (
                        <button
                          key={sug.tableId}
                          onClick={() => {
                            if (sug.hasConflict && sug.conflictMin !== null) {
                              setPendingConflict({ entryId: entry.id, tableId: sug.tableId, tableName: sug.tableName, conflictMin: sug.conflictMin });
                            } else {
                              onSeatAtTable?.(sug.tableId, entry);
                            }
                          }}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-iron-border hover:border-iron-text/30 bg-iron-bg text-iron-muted hover:text-iron-text transition-colors"
                        >
                          <span>→ {sug.tableName}</span>
                          <span style={{ color: sug.labelColor }}>· {sug.label}</span>
                          {sug.hasConflict && <span className="text-amber-400 ml-0.5">⚠</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-iron-border text-iron-muted text-[11px] text-center">
        {active.length === 0 ? T.waitlistPanel.footerEmpty : T.waitlistPanel.footerCount(active.length)}
      </div>
    </div>
  );
}
