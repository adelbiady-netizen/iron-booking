import { useState, useEffect, useCallback } from 'react';
import { api, type ShiftMetrics } from '../api';
import { useT } from '../i18n/useT';

interface Props {
  initialDate: string;
  onClose: () => void;
}

type Tab = 'all' | 'lunch' | 'dinner';

interface ReportData {
  date: string;
  lunchStart: string;
  dinnerStart: string;
  all: ShiftMetrics;
  lunch: ShiftMetrics;
  dinner: ShiftMetrics;
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-iron-border/40 last:border-0">
      <span className="text-iron-muted text-xs">{label}</span>
      <span className="text-iron-text text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold text-iron-muted/60 uppercase tracking-wider mb-1">{title}</p>
      <div className="bg-iron-bg rounded-lg border border-iron-border px-3 py-0.5">
        {children}
      </div>
    </div>
  );
}

function ShiftPanel({ data, T }: { data: ShiftMetrics; T: ReturnType<typeof useT> }) {
  const sr = T.serviceReport;

  if (data.totalReservations === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-iron-muted text-sm">
        {sr.noData}
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <MetricSection title={sr.labelReservations}>
        <MetricRow label={sr.labelReservations}  value={data.totalReservations} />
        <MetricRow label={sr.labelExpectedGuests} value={data.totalExpectedGuests} />
        <MetricRow label={sr.labelPending}        value={data.pendingReservations} />
        <MetricRow label={sr.labelConfirmed}      value={data.confirmedReservations} />
      </MetricSection>

      <MetricSection title={sr.labelSeated}>
        <MetricRow label={sr.labelSeated}    value={`${data.seatedReservations} (${data.seatedGuests}p)`} />
        <MetricRow label={sr.labelCompleted} value={`${data.completedReservations} (${data.completedGuests}p)`} />
      </MetricSection>

      <MetricSection title={sr.labelNoShows}>
        <MetricRow label={sr.labelNoShows}        value={`${data.noShowReservations} (${data.noShowGuests}p)`} />
        <MetricRow label={sr.labelNoShowPct}      value={sr.pct(data.noShowPct)} />
        <MetricRow label={sr.labelCancelled}       value={`${data.cancelledReservations} (${data.cancelledGuests}p)`} />
        <MetricRow label={sr.labelCancellationPct} value={sr.pct(data.cancellationPct)} />
      </MetricSection>

      <MetricSection title={sr.labelWalkIns}>
        <MetricRow label={sr.labelWalkIns} value={data.walkIns} />
        <MetricRow label={sr.labelPhone}   value={data.phoneReservations} />
        <MetricRow label={sr.labelOnline}  value={data.onlineReservations} />
      </MetricSection>
    </div>
  );
}

export default function ServiceReportPanel({ initialDate, onClose }: Props) {
  const T = useT();
  const sr = T.serviceReport;

  const [date, setDate]     = useState(initialDate);
  const [tab, setTab]       = useState<Tab>('all');
  const [data, setData]     = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(false);
    try {
      const result = await api.analytics.shiftSummary(d);
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) setDate(e.target.value);
  };

  const tabData = data ? (tab === 'all' ? data.all : tab === 'lunch' ? data.lunch : data.dinner) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-iron-card border border-iron-border rounded-xl shadow-2xl w-80 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-iron-border shrink-0">
          <h2 className="text-iron-text font-semibold text-sm">{sr.title}</h2>
          <button
            onClick={onClose}
            className="text-iron-muted hover:text-iron-text transition-colors text-lg leading-none"
            aria-label={sr.close}
          >
            ×
          </button>
        </div>

        {/* Date picker */}
        <div className="px-4 py-2.5 border-b border-iron-border shrink-0">
          <input
            type="date"
            value={date}
            onChange={handleDateChange}
            className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-1.5 text-xs text-iron-text focus:outline-none focus:border-iron-text/30"
          />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-iron-border shrink-0">
          {(['all', 'lunch', 'dinner'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === t
                  ? 'text-iron-text border-b-2 border-iron-text -mb-px'
                  : 'text-iron-muted hover:text-iron-text'
              }`}
            >
              {t === 'all' ? sr.tabAll : t === 'lunch' ? sr.tabLunch : sr.tabDinner}
            </button>
          ))}
        </div>

        {/* Shift label */}
        {data && (
          <div className="px-4 pt-2 shrink-0">
            <p className="text-[11px] text-iron-muted/70">
              {tab === 'lunch'
                ? sr.lunchShift(data.lunchStart, data.dinnerStart)
                : tab === 'dinner'
                ? sr.dinnerShift(data.dinnerStart)
                : null}
            </p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading && (
            <div className="flex items-center justify-center h-32 text-iron-muted text-sm">
              {sr.loading}
            </div>
          )}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <p className="text-iron-muted text-sm">{sr.error}</p>
              <button
                onClick={() => load(date)}
                className="text-xs text-iron-text border border-iron-border rounded px-3 py-1 hover:border-iron-text/30 transition-colors"
              >
                {sr.retry}
              </button>
            </div>
          )}
          {!loading && !error && tabData && (
            <ShiftPanel data={tabData} T={T} />
          )}
        </div>
      </div>
    </div>
  );
}
