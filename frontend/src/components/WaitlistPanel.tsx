import { useState, useMemo, useEffect } from 'react';
import type { GuestLookupResult, WaitlistEntry } from '../types';
import type { TableSuggestion } from '../utils/seating';
import type { PriorityEntry } from '../utils/flowControl';
import { api } from '../api';
import { useT } from '../i18n/useT';

function waitMins(addedAt: string, opNow: number): number {
  return Math.floor((opNow - new Date(addedAt).getTime()) / 60_000);
}

export interface NextInLineItem {
  entry: WaitlistEntry;
  tableId: string;
  tableName: string;
}

interface EditData {
  partySize?: number;
  guestName?: string;
  notes?: string;
}

// ── Inline accordion details panel ──────────────────────────────────────────

interface DetailsProps {
  entry: WaitlistEntry;
  todayStr: string;
  operationalNow: number;
  isToday: boolean;
  onUpdate?: (entry: WaitlistEntry, data: EditData) => Promise<void>;
  onCancel: (entry: WaitlistEntry) => void;
  onNoShow: (entry: WaitlistEntry) => void;
  onNotify?: (entry: WaitlistEntry) => Promise<void>;
  onSeatAtTable?: (tableId: string, entry: WaitlistEntry) => void;
  entrySuggestions?: Map<string, TableSuggestion[]>;
  onClose: () => void;
}

function WaitlistEntryDetails({
  entry, todayStr, operationalNow, isToday,
  onUpdate, onCancel, onNoShow, onNotify,
  onSeatAtTable, entrySuggestions, onClose,
}: DetailsProps) {
  const T = useT();
  const [localName,  setLocalName]  = useState(entry.guestName);
  const [localParty, setLocalParty] = useState(String(entry.partySize));
  const [localNotes, setLocalNotes] = useState(entry.notes ?? '');
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<{
    tableId: string; tableName: string; conflictMin: number;
  } | null>(null);

  const isDirty =
    localName.trim() !== entry.guestName ||
    parseInt(localParty, 10) !== entry.partySize ||
    localNotes !== (entry.notes ?? '');

  async function handleSave() {
    const n = parseInt(localParty, 10);
    if (!localName.trim() || !n || n < 1 || n > 30) return;
    setSaving(true);
    setSaveError(null);
    try {
      const data: EditData = {};
      if (localName.trim() !== entry.guestName) data.guestName = localName.trim();
      if (n !== entry.partySize) data.partySize = n;
      if (localNotes !== (entry.notes ?? '')) data.notes = localNotes;
      await onUpdate?.(entry, data);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : T.waitlistPanel.drawerSaveError);
    } finally {
      setSaving(false);
    }
  }

  const mins = waitMins(entry.addedAt, operationalNow);
  const sugs = (entry.date.slice(0, 10) <= todayStr ? entrySuggestions?.get(entry.id) : null) ?? [];

  return (
    <div className="bg-iron-bg/40 border-b border-iron-border/40 px-3 pt-2 pb-3 space-y-2.5">

      {/* Meta strip */}
      <div className="pl-6 flex items-center gap-2 flex-wrap text-[10px] text-iron-muted">
        <span className={`px-1.5 py-0.5 rounded border ${
          entry.status === 'NOTIFIED'
            ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
            : 'border-iron-border/60 text-iron-muted'
        }`}>
          {entry.status === 'NOTIFIED' ? T.waitlistPanel.statusNotified : T.waitlistPanel.statusWaiting}
        </span>
        <span>{T.waitlistPanel.labelAddedAt} {new Date(entry.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {isToday && <span>{mins < 1 ? T.waitlistPanel.justAdded : T.waitlistPanel.waitingMin(mins)}</span>}
        {entry.preferredTime && (
          <span>pref {entry.preferredTime}{entry.flexibleTime ? ' ±1h' : ''}</span>
        )}
      </div>

      {/* Edit fields */}
      {onUpdate && (
        <div className="pl-6 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-iron-muted block mb-1">{T.waitlistPanel.labelName}</label>
              <input
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                className="w-full bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text text-xs focus:outline-none focus:border-iron-green transition-colors"
              />
            </div>
            <div className="w-14">
              <label className="text-[10px] text-iron-muted block mb-1">{T.waitlistPanel.labelParty}</label>
              <input
                type="number" min={1} max={30}
                value={localParty}
                onChange={e => setLocalParty(e.target.value)}
                className="w-full bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text text-xs text-center focus:outline-none focus:border-iron-green transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-iron-muted block mb-1">{T.waitlistPanel.labelNotes}</label>
            <textarea
              value={localNotes}
              onChange={e => setLocalNotes(e.target.value)}
              rows={2}
              placeholder={T.waitlistPanel.notesPlaceholder}
              className="w-full bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors resize-none"
            />
          </div>
          {saveError && <p className="text-red-400 text-[11px]">{saveError}</p>}
          {isDirty && (
            <button
              disabled={saving || !localName.trim()}
              onClick={handleSave}
              className="text-xs font-medium px-3 py-1 rounded bg-iron-green hover:bg-iron-green-light text-white transition-colors disabled:opacity-40"
            >
              {saving ? '…' : T.waitlistPanel.saveButton}
            </button>
          )}
        </div>
      )}

      {/* Secondary actions */}
      <div className="pl-6 flex flex-wrap gap-1.5">
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
                disabled={notifyBusy}
                onClick={async () => {
                  setNotifyBusy(true);
                  try { await onNotify(entry); } finally { setNotifyBusy(false); }
                }}
                className="text-[11px] px-2.5 py-1 rounded-md border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-40"
              >
                {notifyBusy ? '…' : T.waitlistPanel.notifyButton}
              </button>
            );
          }
          return null;
        })()}
        <button
          onClick={() => { onNoShow(entry); onClose(); }}
          className="text-[11px] px-2.5 py-1 rounded-md border border-orange-900/20 text-orange-400 hover:bg-orange-900/10 transition-colors"
        >
          {T.waitlistPanel.noShow}
        </button>
        <button
          onClick={() => { onCancel(entry); onClose(); }}
          className="text-[11px] px-2.5 py-1 rounded-md border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
        >
          {T.waitlistPanel.cancelButton}
        </button>
      </div>

      {/* Table suggestions */}
      {sugs.length > 0 && (
        <div className="pl-6">
          {pendingConflict ? (
            <div className="rounded-md bg-amber-900/15 border border-amber-500/30 px-2 py-1.5">
              <p className="text-amber-400 text-[10px] font-medium mb-1.5">
                {T.smartSeat.conflictWarn(pendingConflict.conflictMin)}
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { onSeatAtTable?.(pendingConflict.tableId, entry); setPendingConflict(null); onClose(); }}
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
          ) : (
            <div className="flex flex-wrap gap-1">
              {sugs.map(sug => {
                if (sug.minutesUntilFree !== 0) {
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
                        setPendingConflict({ tableId: sug.tableId, tableName: sug.tableName, conflictMin: sug.conflictMin });
                      } else {
                        onSeatAtTable?.(sug.tableId, entry);
                        onClose();
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
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  entries: WaitlistEntry[];
  loading: boolean;
  onAdd: (data: { guestName: string; partySize: number; guestPhone?: string }) => Promise<void>;
  onSeat: (entry: WaitlistEntry) => void;
  onNotify?: (entry: WaitlistEntry) => Promise<void>;
  onUpdate?: (entry: WaitlistEntry, data: EditData) => Promise<void>;
  onCancel: (entry: WaitlistEntry) => void;
  onNoShow: (entry: WaitlistEntry) => void;
  nextInLine?: NextInLineItem[];
  onSeatAtTable?: (tableId: string, entry: WaitlistEntry) => void;
  entrySuggestions?: Map<string, TableSuggestion[]>;
  priorityQueue?: PriorityEntry[];
  operationalNow?: number;
  isToday?: boolean;
}

export default function WaitlistPanel({
  entries, loading, onAdd, onSeat, onNotify, onUpdate, onCancel, onNoShow,
  nextInLine = [], onSeatAtTable, entrySuggestions, priorityQueue,
  operationalNow, isToday = true,
}: Props) {
  const T = useT();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [showForm,      setShowForm]      = useState(false);
  const [name,          setName]          = useState('');
  const [partySize,     setPartySize]     = useState('2');
  const [phone,         setPhone]         = useState('');
  const [guestHint,     setGuestHint]     = useState<GuestLookupResult | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [busySeat,      setBusySeat]      = useState<string | null>(null);
  const [busy,          setBusy]          = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);

  const rankMap    = useMemo(() => new Map(priorityQueue?.map(pe => [pe.entry.id, pe.rank])    ?? []), [priorityQueue]);
  const urgencyMap = useMemo(() => new Map(priorityQueue?.map(pe => [pe.entry.id, pe.urgency]) ?? []), [priorityQueue]);

  // Close expanded panel if that entry leaves the active list
  const active = entries.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED');
  useEffect(() => {
    if (expandedId && !active.some(e => e.id === expandedId)) {
      setExpandedId(null);
    }
  }, [active, expandedId]);

  function resetForm() {
    setName(''); setPartySize('2'); setPhone(''); setError(null);
    setGuestHint(null); setHintDismissed(false);
  }

  useEffect(() => {
    if (!phone.trim()) { setGuestHint(null); setHintDismissed(false); return; }
    const t = setTimeout(async () => {
      try {
        const { guest } = await api.guests.lookupByPhone(phone);
        setGuestHint(guest);
        setHintDismissed(false);
        if (guest) setName(prev => prev === '' ? `${guest.firstName} ${guest.lastName}` : prev);
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
                readyNow ? 'bg-iron-green/15 border-iron-green/40' : 'bg-iron-card border-iron-green/20'
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-iron-text text-xs font-semibold truncate">{entry.guestName}</p>
                    {readyNow && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-iron-green/30 text-iron-green-light shrink-0">
                        {T.waitlistPanel.etaReady}
                      </span>
                    )}
                  </div>
                  <p className="text-iron-muted text-[10px]">
                    {T.waitlistPanel.guests(entry.partySize)}
                    {' · '}{T.waitlistPanel.tableLabel(tableName)}
                    {isToday && <>{' · '}{(() => { const m = waitMins(entry.addedAt, operationalNow ?? Date.now()); return m < 1 ? T.waitlistPanel.justAdded : T.waitlistPanel.waitingMin(m); })()}</>}
                  </p>
                </div>
                <button
                  onClick={() => onSeatAtTable?.(tableId, entry)}
                  disabled={entry.date.slice(0, 10) > todayStr}
                  title={entry.date.slice(0, 10) > todayStr ? T.waitlistPanel.seatFutureDisabled : undefined}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-iron-green/20 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/30 transition-colors active:scale-[0.96] touch-manipulation shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
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
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder={T.waitlistPanel.namePlaceholder}
              autoComplete="off"
              className="w-full bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
            />
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
            <p className="text-iron-muted text-xs opacity-60">{T.waitlistPanel.emptyHint}</p>
          </div>
        )}

        {!loading && active.map((entry, i) => {
          const eta      = entry.estimatedWaitMin;
          const etaColor = eta === null ? '' : eta <= 20 ? 'text-amber-400' : 'text-red-400';
          const urgency  = urgencyMap.get(entry.id) ?? 'normal';
          const rank     = rankMap.get(entry.id) ?? (i + 1);
          const isOpen   = expandedId === entry.id;
          const isFuture = entry.date.slice(0, 10) > todayStr;

          return (
            <div
              key={entry.id}
              className={`${urgency === 'critical' ? 'bg-red-900/5' : urgency === 'high' ? 'bg-amber-900/5' : ''}`}
            >
              {/* ── Card row ── */}
              <div
                className={`px-3 py-2.5 flex items-center gap-2 cursor-pointer select-none transition-colors border-b border-iron-border/40 ${
                  isOpen ? 'bg-iron-card/60' : 'hover:bg-iron-card/30'
                }`}
                onClick={() => setExpandedId(isOpen ? null : entry.id)}
              >
                {/* Rank */}
                <span className={`text-[10px] font-mono w-4 shrink-0 text-right font-semibold ${
                  urgency === 'critical' ? 'text-red-400' : urgency === 'high' ? 'text-amber-400' : 'text-iron-muted'
                }`}>
                  #{rank}
                </span>

                {/* Name + info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
                    <p className="text-iron-text text-xs font-semibold truncate">{entry.guestName}</p>
                    {entry.source === 'PUBLIC_ONLINE' && (
                      <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-sky-900/30 border border-sky-500/30 text-sky-400 shrink-0">
                        {T.waitlistPanel.sourceOnline}
                      </span>
                    )}
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
                  <p className="text-iron-muted text-[10px] truncate">
                    {entry.partySize}p
                    {entry.guestPhone && <span className="text-iron-muted/70"> · {entry.guestPhone}</span>}
                    {isToday && <> · {
                      (() => {
                        const m = waitMins(entry.addedAt, operationalNow ?? Date.now());
                        return m < 1 ? T.waitlistPanel.justAdded : T.waitlistPanel.waitingMin(m);
                      })()
                    }</>}
                    {eta !== null && (
                      <span className={etaColor}>
                        {' · '}{eta === 0
                          ? <span className="text-iron-green-light">{T.waitlistPanel.etaReady}</span>
                          : T.waitlistPanel.etaMin(eta)
                        }
                      </span>
                    )}
                  </p>
                </div>

                {/* Seat + chevron */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (busySeat === entry.id) return;
                      setBusySeat(entry.id);
                      Promise.resolve(onSeat(entry)).finally(() => setBusySeat(null));
                    }}
                    disabled={isFuture || busySeat === entry.id}
                    title={isFuture ? T.waitlistPanel.seatFutureDisabled : undefined}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/30 text-iron-green-light hover:bg-iron-green/25 transition-colors active:scale-[0.96] touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {busySeat === entry.id ? '…' : T.waitlistPanel.seatButton}
                  </button>
                  <span className={`text-iron-muted/40 text-[11px] transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>›</span>
                </div>
              </div>

              {/* ── Inline details (accordion) ── */}
              {isOpen && (
                <WaitlistEntryDetails
                  entry={entry}
                  todayStr={todayStr}
                  operationalNow={operationalNow ?? Date.now()}
                  isToday={isToday}
                  onUpdate={onUpdate}
                  onCancel={onCancel}
                  onNoShow={onNoShow}
                  onNotify={onNotify}
                  onSeatAtTable={onSeatAtTable}
                  entrySuggestions={entrySuggestions}
                  onClose={() => setExpandedId(null)}
                />
              )}
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
