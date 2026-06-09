import { useEffect, useRef } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error';
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ItemProps {
  toast: ToastMessage;
  onRemove: (id: number) => void;
}

function ToastItem({ toast, onRemove }: ItemProps) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const ms = toast.duration ?? (toast.action ? 10000 : 3200);
    timerRef.current = window.setTimeout(() => onRemove(toast.id), ms);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [toast.id, onRemove]);

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-lg border shadow-xl text-sm font-medium
        animate-toast
        ${toast.type === 'success'
          ? 'bg-iron-card border-iron-green/60 text-iron-text'
          : 'bg-iron-card border-status-danger/50 text-status-danger'}
      `}
    >
      {toast.type === 'success'
        ? <span className="text-iron-green-light text-base leading-none">✓</span>
        : <span className="text-status-danger text-base leading-none">✕</span>
      }
      <span className="flex-1">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="ms-1 text-iron-green-light text-xs font-bold underline underline-offset-2 hover:opacity-75 shrink-0"
          onClick={() => {
            onRemove(toast.id);
            toast.action!.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

interface Props {
  toasts: ToastMessage[];
  onRemove: (id: number) => void;
}

export default function ToastContainer({ toasts, onRemove }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[70] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}
