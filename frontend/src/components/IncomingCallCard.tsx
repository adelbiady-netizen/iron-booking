import { useState, useEffect } from 'react';
import { useT } from '../i18n/useT';

interface Props {
  phone: string;
  createdAt: string;
  onOpen: () => void;
  onNewReservation: (phone: string) => void;
  onDismiss: () => void;
}

function useElapsed(createdAt: string): string {
  const [secs, setSecs] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000))
  );
  useEffect(() => {
    const id = setInterval(() => {
      setSecs(Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [createdAt]);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function IncomingCallCard({ phone, createdAt, onOpen, onNewReservation, onDismiss }: Props) {
  const T = useT();
  const elapsed = useElapsed(createdAt);

  return (
    // Positioned bottom-left so it never overlaps the right-side workflow drawers.
    // Physical left-4 matches the physical right-0 drawer positioning convention.
    <div className="fixed bottom-4 left-4 z-[60] w-64 bg-iron-elevated border border-iron-green/30 rounded-xl shadow-lg animate-toast overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iron-green opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-iron-green" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-iron-muted/60 text-[10px] font-medium uppercase tracking-widest leading-none mb-0.5">
            {T.callDrawer.title}
          </p>
          <p className="text-iron-text font-semibold text-sm leading-tight truncate tabular-nums">
            {phone || T.callDrawer.unknownCaller}
          </p>
        </div>
        <span className="text-iron-muted/50 text-[10px] tabular-nums shrink-0">{elapsed}</span>
        <button
          onClick={onDismiss}
          className="text-iron-muted/40 hover:text-iron-muted text-lg leading-none w-6 h-6 flex items-center justify-center rounded-md hover:bg-iron-bg/60 transition-colors shrink-0"
          aria-label={T.callDrawer.dismiss}
        >
          ×
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 px-3.5 pb-3">
        <button
          onClick={onOpen}
          className="flex-1 text-[11px] font-medium py-1.5 rounded-md bg-iron-green/12 border border-iron-green/30 text-iron-green-light hover:bg-iron-green/20 transition-colors"
        >
          {T.callDrawer.openFull}
        </button>
        <button
          onClick={() => onNewReservation(phone)}
          className="flex-1 text-[11px] font-medium py-1.5 rounded-md bg-transparent border border-iron-border/30 text-iron-muted hover:text-iron-text hover:border-iron-border/50 transition-colors"
        >
          {T.callDrawer.newReservation}
        </button>
      </div>
    </div>
  );
}
