import { useEffect, useRef } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error';
}

interface ItemProps {
  toast: ToastMessage;
  onRemove: (id: number) => void;
}

function ToastItem({ toast, onRemove }: ItemProps) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    timerRef.current = window.setTimeout(() => onRemove(toast.id), 3200);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [toast.id, onRemove]);

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-2.5 rounded-lg border shadow-xl text-sm font-medium
        animate-toast
        ${toast.type === 'success'
          ? 'bg-iron-card border-iron-green/60 text-iron-text'
          : 'bg-iron-card border-red-500/50 text-red-400'}
      `}
    >
      {toast.type === 'success'
        ? <span className="text-iron-green-light text-base leading-none">✓</span>
        : <span className="text-red-400 text-base leading-none">✕</span>
      }
      {toast.text}
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
