import { useLocale } from '../i18n/useLocale';

const HE_MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('he-IL', { month: 'long' }).format(new Date(2024, i, 1))
);

function parse(v: string) {
  if (!v) return null;
  const parts = v.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function fmt(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  required?: boolean;
}

const SEL = 'bg-iron-bg border border-iron-border/50 rounded-md px-2 py-1.5 text-iron-text text-sm focus:outline-none focus:border-iron-green/50 transition-colors cursor-pointer';

export default function LocalizedDateInput({ value, onValueChange, className, required }: Props) {
  const { locale } = useLocale();

  if (locale !== 'he') {
    return (
      <input
        type="date"
        value={value}
        onChange={e => onValueChange(e.target.value)}
        className={className}
        required={required}
      />
    );
  }

  const today = new Date();
  const thisYear = today.getFullYear();
  const years = Array.from({ length: 4 }, (_, i) => thisYear - 1 + i);
  const p = parse(value) ?? { year: thisYear, month: today.getMonth() + 1, day: today.getDate() };
  const maxDay = new Date(p.year, p.month, 0).getDate();

  function set(field: 'y' | 'm' | 'd', n: number) {
    const y = field === 'y' ? n : p.year;
    const m = field === 'm' ? n : p.month;
    const d = field === 'd' ? n : p.day;
    onValueChange(fmt(y, m, Math.min(d, new Date(y, m, 0).getDate())));
  }

  return (
    <div className="flex gap-1 w-full">
      <select value={p.day} onChange={e => set('d', +e.target.value)} className={`${SEL} w-14 shrink-0`} required={required}>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select value={p.month} onChange={e => set('m', +e.target.value)} className={`${SEL} flex-1 min-w-0`}>
        {HE_MONTHS.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>
      <select value={p.year} onChange={e => set('y', +e.target.value)} className={`${SEL} w-20 shrink-0`}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
