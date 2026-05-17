import { useLocale } from '../i18n/useLocale';

function fmtDate(dateStr: string, intlLocale: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  return new Intl.DateTimeFormat(intlLocale, {
    weekday: intlLocale === 'he-IL' ? 'long' : 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
}

export default function LocalizedDateInput({ value, onValueChange, className }: Props) {
  const { intlLocale } = useLocale();
  return (
    <div className={`relative inline-flex items-center ${className ?? ''}`}>
      <span className="pointer-events-none whitespace-nowrap">{fmtDate(value, intlLocale)}</span>
      <input
        type="date"
        value={value}
        onChange={e => onValueChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        tabIndex={-1}
        aria-hidden={true}
      />
    </div>
  );
}
