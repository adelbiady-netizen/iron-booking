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

// ── Edit drawer ─────────────────────────────────────────────────────────────

interface DrawerProps {
  entry: WaitlistEntry;
  todayStr: string;
  onClose: () => void;
  onSave: (data: EditData) => Promise<void>;
  onSeat: () => void;
  onCancel: () => void;
  onNoShow: () => void;
  onNotify?: () => Promise<void>;
}

function WaitlistEditDrawer({ entry, todayStr, onClose, onSave, onSeat, onCancel, onNoShow, onNotify }: DrawerProps) {
  const T = useT();
  const [localName,  setLocalName]  = useState(entry.guestName);
  const [localParty, setLocalParty] = useState(String(entry.partySize));
  const [localNotes, setLocalNotes] = useState(entry.notes ?? '');
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);

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
      await onSave(data);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : T.waitlistPanel.drawerSaveError);
    } finally {
      setSaving(false);
    }
  }

  const isSeatDisabled = entry.date.slice(0, 10) > todayStr;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-sm bg-iron-card border-t border-iron-border rounded-t-xl shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-iron-border">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-iron-text text-sm font-semibold truncate">{entry.guestName}</p>
            {entry.source === 'PUBLIC_ONLINE' && (
              <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-sky-900/30 border border-sky-500/30 text-sky-400 shrink-0">
                {T.waitlistPanel.sourceOnline}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-iron-muted hover:text-iron-text text-xl leading-none px-1 shrink-0">×</button>
        </div>

        {/* Meta row */}
        <div className="px-4 pt-3 pb-0 flex items-center gap-2 flex-wrap text-[10px]">
          <span className={`px-1.5 py-0.5 rounded border ${
            entry.status === 'NOTIFIED'
              ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
              : 'border-iron-border text-iron-muted'
          }`}>
            {entry.status === 'NOTIFIED' ? T.waitlistPanel.statusNotified : T.waitlistPanel.statusWaiting}
          </span>
          <span className="text-iron-muted">
            {T.waitlistPanel.labelAddedAt}: {new Date(entry.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {entry.guestPhone && (
            <span className="text-iron-muted font-mono">{entry.guestPhone}</span>
          )}
        </div>

        {/* Editable fields */}
        <div className="px-4 pt-3 pb-1 space-y-3 max-h-[45vh] overflow-y-auto">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-iron-muted block mb-1">{T.waitlistPanel.labelName}</label>
              <input
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                className="w-full bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs focus:outline-none focus:border-iron-green transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] text-iron-muted block mb-1">{T.waitlistPanel.labelParty}</label>
              <input
                type="number" min={1} max={30}
                value={localParty}
                onChange={e => setLocalParty(e.target.value)}
                className="w-16 bg-iron-bg border border-iron-border rounded-md px-2 py-1.5 text-iron-text text-xs text-center focus:outline-none focus:border-iron-green transition-colors"
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
              className="w-full bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors resize-none"
            />
          </div>

          {entry.preferredTime && (
            <p className="text-iron-muted text-[10px]">
              {T.waitlistPanel.labelPreferredTime}: {entry.preferredTime}{entry.flexibleTime ? ' ±1h' : ''}
            </p>
          )}

          {saveError && <p className="text-red-400 text-[11px]">{saveError}</p>}
        </div>

        {/* Actions */}
        <div className="px-4 pt-2 pb-4 border-t border-iron-border mt-2 space-y-2">
          {isDirty && (
            <button
              disabled={saving || !localName.trim()}
              onClick={handleSave}
              className="w-full text-xs font-medium py-2 rounded-md bg-iron-green hover:bg-iron-green-light text-white transition-colors disabled:opacity-40"
            >
              {saving ? '…' : T.waitlistPanel.saveButton}
            </button>
          )}
          <div className="flex gap-2">
            <button
              disabled={isSeatDisabled}
              title={isSeatDisabled ? T.waitlistPanel.seatFutureDisabled : undefined}
              onClick={onSeat}
              className="flex-1 text-[11px] font-medium py-1.5 rounded-md bg-iron-green/15 border border-iron-green/30 text-iron-green-light hover:bg-iron-green/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {T.waitlistPanel.seatButton}
            </button>
            {onNotify && !entry.notifiedAt && (
              <button
                disabled={notifyBusy}
                onClick={async () => { setNotifyBusy(true); try { await onNotify(); } finally { setNotifyBusy(false); } }}
                className="flex-1 text-[11px] py-1.5 rounded-md border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-40"
              >
                {notifyBusy ? '…' : T.waitlistPanel.notifyButton}
              </button>
            )}
            <button
              onClick={onNoShow}
              className="text-[11px] px-2.5 py-1.5 rounded-md border border-orange-900/20 text-orange-400 hover:bg-orange-900/10 transition-colors"
            >
              {T.waitlistPanel.noShow}
            </button>
            <button
              onClick={onCancel}
              className="text-[11px] px-2.5 py-1.5 rounded-md border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
            >
              {T.waitlistPanel.cancelButton}
            </button>
          </div>
        </div>
      </div>
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

export default function WaitlistPanel({ entries, loading, onAdd, onSeat, onNotify, onUpdate, onCancel, onNoShow, nextInLine = [], onSeatAtTable, entrySuggestions, priorityQueue, operationalNow, isToday = true }: Props) {
  const T = useT();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [showForm,       setShowForm]       = useState(false);
  const [name,           setName]           = useState('');
  const [partySize,      setPartySize]      = useState('2');
  const [phone,          setPhone]          = useState('');
  const [guestHint,      setGuestHint]      = useState<GuestLookupResult | null>(null);
  const [hintDismissed,  setHintDismissed]  = useState(false);
  const [busyNotify,     setBusyNotify]     = useState<string | null>(null);
  const [busy,           setBusy]           = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [editDrawerEntry, setEditDrawerEntry] = useState<WaitlistEntry | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    entryId: string; tableId: string; tableName: string; conflictMin: number;
  } | null>(null);

  // Build lookup maps for rank and urgency from priorityQueue
  const rankMap    = useMemo(() => new Map(priorityQueue?.map(pe => [pe.entry.id, pe.rank])    ?? []), [priorityQueue]);
  const urgencyMap = useMemo(() => new Map(priorityQueue?.map(pe => [pe.entry.id, pe.urgency]) ?? []), [priorityQueue]);

  function resetForm() {
    setName(''); setPartySize('2'); setPhone(''); setError(null);
    setGuestHint(null); setHintDismissed(false);
  }

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
  // Preserve backend addedAt ASC order; priorityQueue is used only for urgency/rank badges
  const active = activeRaw;

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
                  <p className="text-iron-muted text-[10px]">
                    {T.waitlistPanel.guests(entry.partySize)}
                    {entry.guestPhone && (
                      <span className="text-iron-muted/70"> · {entry.guestPhone}</span>
                    )}
                    {entry.preferredTime && (
                      <span className="text-iron-muted/70">
                        {' · '}pref {entry.preferredTime}{entry.flexibleTime ? ' ±1h' : ''}
                      </span>
                    )}
                    {isToday && <>{' · '}{mins < 1 ? T.waitlistPanel.justAdded : T.waitlistPanel.waitingMin(mins)}</>}
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
                  disabled={entry.date.slice(0, 10) > todayStr}
                  title={entry.date.slice(0, 10) > todayStr ? T.waitlistPanel.seatFutureDisabled : undefined}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-iron-green/15 border border-iron-green/30 text-iron-green-light hover:bg-iron-green/25 transition-colors active:scale-[0.96] touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
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
                {onUpdate && (
                  <button
                    onClick={() => setEditDrawerEntry(entry)}
                    className="text-[11px] px-2.5 py-1 rounded-md border border-iron-border text-iron-muted hover:text-iron-text hover:border-iron-text/30 transition-colors"
                  >
                    {T.waitlistPanel.editButton}
                  </button>
                )}
              </div>

              {/* Smart seat suggestion chips */}
              {(() => {
                if (entry.date.slice(0, 10) > todayStr) return null;
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

      {/* Edit drawer */}
      {editDrawerEntry && (
        <WaitlistEditDrawer
          entry={editDrawerEntry}
          todayStr={todayStr}
          onClose={() => setEditDrawerEntry(null)}
          onSave={async (data) => {
            await onUpdate?.(editDrawerEntry, data);
            setEditDrawerEntry(null);
          }}
          onSeat={() => { onSeat(editDrawerEntry); setEditDrawerEntry(null); }}
          onCancel={() => { onCancel(editDrawerEntry); setEditDrawerEntry(null); }}
          onNoShow={() => { onNoShow(editDrawerEntry); setEditDrawerEntry(null); }}
          onNotify={editDrawerEntry.guestPhone && onNotify
            ? async () => { await onNotify(editDrawerEntry); }
            : undefined}
        />
      )}
    </div>
  );
}
