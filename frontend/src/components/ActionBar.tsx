import { useEffect, useRef } from 'react';
import type { FloorInsight } from '../types';
import { useT } from '../i18n/useT';

interface Props {
  insights: FloorInsight[];
  onItemClick: (insight: FloorInsight) => void;
}

const PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export default function ActionBar({ insights, onItemClick }: Props) {
  const T = useT();
  // Deduplicate: one item per reservationId (keeps highest priority)
  const seen = new Set<string>();
  const deduped = [...insights]
    .filter(i => i.priority !== 'LOW')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    .filter(i => {
      const key = i.reservationId ?? i.tableId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);

  // Keep stable refs so the keydown handler never goes stale
  const itemsRef = useRef(deduped);
  const clickRef = useRef(onItemClick);
  itemsRef.current = deduped;
  clickRef.current = onItemClick;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < itemsRef.current.length) {
        clickRef.current(itemsRef.current[idx]);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  if (deduped.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-iron-border bg-iron-card/80 overflow-x-auto shrink-0">
      <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest shrink-0 select-none">
        {T.actionBar.now}
      </span>
      <div className="w-px h-3 bg-iron-border shrink-0" />
      {deduped.map((insight, i) => (
        <button
          key={i}
          onClick={() => onItemClick(insight)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors shrink-0 ${
            i >= 2 ? 'hidden sm:flex' : 'flex'
          } ${
            insight.priority === 'HIGH'
              ? 'bg-red-900/15 border-red-900/25 text-red-400 hover:bg-red-900/25 animate-action-pulse'
              : 'bg-amber-900/10 border-amber-500/20 text-amber-400 hover:bg-amber-900/20'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            insight.priority === 'HIGH' ? 'bg-red-500' : 'bg-amber-400'
          }`} />
          {insight.message}
          <kbd className="ml-1 text-[9px] opacity-40 font-mono border border-current rounded px-0.5 leading-tight select-none">
            {i + 1}
          </kbd>
        </button>
      ))}
    </div>
  );
}
