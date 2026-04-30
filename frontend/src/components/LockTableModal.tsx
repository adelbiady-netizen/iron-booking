import { useState } from 'react';
import { api } from '../api';
import type { Table } from '../types';
import { T } from '../strings';

const QUICK_REASONS = ['VIP', 'Broken', 'Staff', 'Reserved', 'Other'] as const;

interface Props {
  table: Table;
  onClose: () => void;
  onLocked: (updated: Table) => void;
}

export default function LockTableModal({ table, onClose, onLocked }: Props) {
  const [reason,      setReason]      = useState('');
  const [lockedUntil, setLockedUntil] = useState('');
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleLock() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.tables.lock(table.id, {
        reason:      reason.trim() || null,
        lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : null,
      });
      onLocked(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : T.lockModal.errorFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div className="bg-iron-card border border-iron-border rounded-xl shadow-2xl p-5 w-80 space-y-4 pointer-events-auto">

          <div className="flex items-center justify-between">
            <h3 className="text-iron-text font-semibold text-sm">{T.lockModal.title(table.name)}</h3>
            <button onClick={onClose} className="text-iron-muted hover:text-iron-text text-xl leading-none">×</button>
          </div>

          <div>
            <p className="text-iron-muted text-xs mb-2">{T.lockModal.reasonLabel} <span className="opacity-50">{T.lockModal.optional}</span></p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {QUICK_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(prev => prev === r ? '' : r)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    reason === r
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                      : 'border-iron-border text-iron-muted hover:border-iron-text/30 hover:text-iron-text'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={T.lockModal.reasonPh}
              className="w-full bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors"
            />
          </div>

          <div>
            <p className="text-iron-muted text-xs mb-1.5">{T.lockModal.lockUntilLabel} <span className="opacity-50">{T.lockModal.optional}</span></p>
            <input
              type="datetime-local"
              value={lockedUntil}
              onChange={e => setLockedUntil(e.target.value)}
              className="w-full bg-iron-bg border border-iron-border rounded-md px-2.5 py-1.5 text-iron-text text-xs focus:outline-none focus:border-iron-green transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded px-2.5 py-1.5">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleLock}
              disabled={busy}
              className="flex-1 text-xs font-semibold py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40"
            >
              {busy ? T.lockModal.lockBusy : T.lockModal.lockButton}
            </button>
            <button
              onClick={onClose}
              className="text-iron-muted text-xs hover:text-iron-text px-3 transition-colors"
            >
              {T.lockModal.cancelButton}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
