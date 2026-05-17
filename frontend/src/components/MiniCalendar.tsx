import { useState, useEffect } from 'react';
import { useLocale } from '../i18n/useLocale';

// Sunday Jan 5 2025 is a known Sunday — anchor for generating weekday labels in order
const WEEKDAY_ANCHOR = new Date(2025, 0, 5);

function weekdayLabels(intlLocale: string): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(WEEKDAY_ANCHOR);
    d.setDate(WEEKDAY_ANCHOR.getDate() + i);
    return fmt.format(d);
  });
}

function monthHeader(year: number, month: number, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1)
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function toYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface Props {
  value: string; // YYYY-MM-DD
  onValueChange: (v: string) => void;
}

export default function MiniCalendar({ value, onValueChange }: Props) {
  const { intlLocale } = useLocale();

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [selYear, selMonth] = value
    ? value.split('-').map(Number)
    : [today.getFullYear(), today.getMonth() + 1];

  const [viewYear, setViewYear] = useState(selYear ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selMonth ?? today.getMonth() + 1);

  // Follow external date changes (e.g. top-bar day navigation) to the correct month
  useEffect(() => {
    if (!value) return;
    const [y, m] = value.split('-').map(Number);
    if (y && m) { setViewYear(y); setViewMonth(m); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function prevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); }
    else setViewMonth(m => m + 1);
  }

  const labels = weekdayLabels(intlLocale);
  const header = monthHeader(viewYear, viewMonth, intlLocale);
  const numDays = daysInMonth(viewYear, viewMonth);
  const startOffset = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0 = Sun

  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-iron-bg border border-iron-border rounded-lg p-3 select-none">
      {/* Month / year navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="w-6 h-6 flex items-center justify-center rounded text-iron-muted hover:text-iron-text hover:bg-iron-border/25 transition-colors text-base leading-none"
        >
          ‹
        </button>
        <span className="text-iron-text text-sm font-semibold">{header}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="w-6 h-6 flex items-center justify-center rounded text-iron-muted hover:text-iron-text hover:bg-iron-border/25 transition-colors text-base leading-none"
        >
          ›
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {labels.map((wd, i) => (
          <div key={i} className="text-center text-iron-muted text-[10px] font-semibold py-0.5 truncate">
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const ds = toYMD(viewYear, viewMonth, day);
          const isSelected = ds === value;
          const isToday = ds === todayStr;
          return (
            <div key={i} className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => onValueChange(ds)}
                className={`w-7 h-7 text-xs rounded-full font-medium transition-colors leading-none ${
                  isSelected
                    ? 'bg-iron-green text-white'
                    : isToday
                    ? 'border border-iron-green/50 text-iron-green-light hover:bg-iron-green/10'
                    : 'text-iron-text hover:bg-iron-border/25'
                }`}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
