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
    <div className="fixed bottom-4 right-4 z-[60] w-72 bg-iron-elevated border border-iron-green/50 rounded-2xl shadow-2xl animate-toast overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-iron-green opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-iron-green" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-iron-muted/70 text-[10px] font-semibold uppercase tracking-widest leading-none mb-0.5">
            {T.callDrawer.title}
          </p>
          <p className="text-iron-text font-bold text-sm leading-tight truncate tabular-nums">
            {phone || T.callDrawer.unknownCaller}
          </p>
        </div>
        <span className="text-iron-muted/60 text-[11px] tabular-nums shrink-0 font-medium">{elapsed}</span>
        <button
          onClick={onDismiss}
          className="text-iron-muted/50 hover:text-iron-text text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-iron-bg/60 transition-colors shrink-0"
          aria-label={T.callDrawer.dismiss}
        >
          ×
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 pb-3.5">
        <button
          onClick={onOpen}
          className="flex-1 text-xs font-semibold py-2 rounded-lg bg-iron-green/18 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/28 transition-colors"
        >
          {T.callDrawer.openFull}
        </button>
        <button
          onClick={() => onNewReservation(phone)}
          className="flex-1 text-xs font-semibold py-2 rounded-lg bg-iron-bg/60 border border-iron-border/40 text-iron-text hover:bg-iron-bg transition-colors"
        >
          {T.callDrawer.newReservation}
        </button>
      </div>
    </div>
  );
}
