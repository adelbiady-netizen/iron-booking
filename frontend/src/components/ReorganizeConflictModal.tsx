import { useState, useRef, useEffect } from 'react';
import { useT } from '../i18n/useT';

export interface ReorganizeConflict {
  id: string;
  guestName: string;
  time: string;
  partySize: number;
  minutesUntil: number;
}

interface Props {
  conflicts: ReorganizeConflict[];
  onCancel: () => void;
  onConfirm: (selectedIds: string[]) => void | Promise<void>;
  busy?: boolean;
}

export default function ReorganizeConflictModal({ conflicts, onCancel, onConfirm, busy }: Props) {
  const T = useT();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => conflicts.map(c => c.id));

  useEffect(() => {
    console.log('[reorganize-modal] mounted', { conflictCount: conflicts.length });
    return () => { console.log('[reorganize-modal] unmounted'); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync selection state when the conflict list is replaced without a remount.
  // Serialise IDs so the effect only fires when the actual conflict set changes.
  const conflictKey = conflicts.map(c => c.id).join(',');
  const prevConflictKeyRef = useRef(conflictKey);
  if (prevConflictKeyRef.current !== conflictKey) {
    prevConflictKeyRef.current = conflictKey;
    setSelectedIds(conflicts.map(c => c.id));
  }

  function toggle(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm bg-iron-card border border-amber-500/30 rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-amber-400 text-xl mt-0.5 shrink-0">⚠</span>
          <div>
            <h3 className="text-iron-text font-semibold text-sm">{T.guestDrawer.reorganizeModalTitle}</h3>
            <p className="text-iron-muted text-xs mt-1">
              {T.guestDrawer.reorganizeModalBody(conflicts.length)}
            </p>
          </div>
        </div>
        <div className="space-y-1.5 bg-iron-bg rounded-lg border border-iron-border p-3">
          {conflicts.map(c => (
            <label
              key={c.id}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(c.id)}
                onChange={() => toggle(c.id)}
                disabled={busy}
                className="w-3.5 h-3.5 rounded border-iron-border accent-amber-400 shrink-0"
              />
              <span className="flex-1 text-iron-text text-xs truncate group-has-[:checked]:text-iron-text text-iron-muted">
                {T.guestDrawer.reorganizeModalGuest(c.guestName, c.time, c.partySize)}
              </span>
              <span className="text-amber-400 text-xs shrink-0 tabular-nums">
                {T.guestDrawer.reorganizeModalEta(c.minutesUntil)}
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 text-xs py-2 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text hover:border-iron-border/70 transition-colors disabled:opacity-40"
          >
            {T.common.cancel}
          </button>
          <button
            onClick={() => onConfirm(selectedIds)}
            disabled={busy || selectedIds.length === 0}
            className="flex-1 text-xs font-semibold py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-40"
          >
            {busy ? T.common.processing : T.guestDrawer.reorganizeConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
