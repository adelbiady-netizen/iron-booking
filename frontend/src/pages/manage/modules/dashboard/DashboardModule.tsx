import type { ManagementContext } from '../../../../types';
import WorkspacePage from '../../shell/WorkspacePage';
import { useDashboardData } from './useDashboardData';
import type { AttentionItem, AttentionTier, DashboardData, GuestMemory } from './model';

interface Props {
  context: ManagementContext;
  userFirstName: string;
  onNavigate: (moduleKey: string) => void;
}

const TIER: Record<AttentionTier, { label: string; color: string; bg: string }> = {
  now:  { label: 'עכשיו',   color: 'var(--status-danger, #ef4444)',  bg: 'rgba(239,68,68,0.9)' },
  soon: { label: 'עוד מעט', color: '#f59e0b',                        bg: 'rgba(245,158,11,0.9)' },
  nice: { label: 'הזדמנות', color: '#6f8a3c',                        bg: 'rgba(111,138,60,0.9)' },
};

function MemoryLine({ m }: { m: GuestMemory }) {
  const parts: string[] = [];
  if (m.visitCount != null) parts.push(`${m.visitCount} ביקורים`);
  if (m.isVip) parts.push('VIP');
  if (m.tags && m.tags.length) parts.push(m.tags.slice(0, 2).join(' · '));
  if (parts.length === 0) return null;
  return <p className="text-iron-muted/70 text-[11px] mt-1">{m.guestName} · {parts.join(' · ')}</p>;
}

function AttentionRow({ item, onNavigate }: { item: AttentionItem; onNavigate: (k: string) => void }) {
  const t = TIER[item.tier];
  return (
    <div className="flex items-start gap-3 bg-iron-card border border-iron-border rounded-xl px-4 py-3" style={{ borderInlineStart: `3px solid ${t.bg}` }}>
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 shrink-0" style={{ color: t.color, background: `${t.bg.replace('0.9', '0.12')}` }}>{t.label}</span>
      <div className="flex-1 min-w-0">
        <p className="text-iron-text text-[13px] font-medium leading-snug">{item.title}</p>
        {item.context && <p className="text-iron-muted text-[11px] mt-0.5">{item.context}</p>}
        {item.memory && <MemoryLine m={item.memory} />}
      </div>
      {item.actionLabel && item.target && (
        <button
          onClick={() => onNavigate(item.target!)}
          className={`text-[11px] font-medium px-3 py-1.5 rounded-lg shrink-0 transition-colors ${item.tier === 'now' ? 'bg-iron-green text-white hover:bg-iron-green-light' : 'text-iron-muted border border-iron-border/70 hover:text-iron-text hover:border-iron-border'}`}
        >
          {item.actionLabel}
        </button>
      )}
    </div>
  );
}

function PulseCard({ label, value, sub, bar }: { label: string; value: string; sub?: string; bar?: number | null }) {
  return (
    <div className="bg-iron-elevated/40 rounded-xl px-3 py-2.5">
      <div className="text-[10px] text-iron-muted">{label}</div>
      <div className="text-[19px] font-semibold text-iron-text leading-tight">{value}{sub && <span className="text-[11px] text-iron-muted font-normal"> {sub}</span>}</div>
      {bar != null && (
        <div className="mt-1.5 h-1 rounded-full bg-iron-border/40 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(4, Math.round(bar * 100)))}%`, background: bar >= 1 ? '#6f8a3c' : bar < 0.8 ? '#f59e0b' : 'rgb(var(--iron-muted))' }} />
        </div>
      )}
    </div>
  );
}

function HealthPill({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-iron-elevated/40 rounded-lg px-3 py-2">
      <div className="text-[10px] text-iron-muted">{label}</div>
      <div className={`text-[15px] font-semibold ${warn ? 'text-status-warning' : 'text-iron-text'}`}>{value}</div>
    </div>
  );
}

const QUICK_ACTIONS: { label: string; target: string }[] = [
  { label: 'הזמנות היום', target: 'operations' },
  { label: 'שעות פעילות', target: 'operations' },
  { label: 'עורך המפה', target: 'floor' },
  { label: 'הזמנות אונליין', target: 'operations' },
  { label: 'ספריית אורחים', target: 'guests' },
  { label: 'IRON CLUB', target: 'guests' },
  { label: 'שיווק', target: 'marketing' },
  { label: 'הגדרות', target: 'admin' },
];

function Content({ data, onNavigate }: { data: DashboardData; onNavigate: (k: string) => void }) {
  const { pulse, health } = data;
  const pct = (n: number | null) => (n == null ? '—' : `${n}%`);
  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* GM's Voice */}
      <p className="text-iron-text text-[15px] font-medium leading-snug">{data.gmVoice}</p>

      {/* Pulse band with pace bars */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <PulseCard label="כיסויים היום" value={String(pulse.coversToday)} bar={pulse.paceVsLastWeek} />
        <PulseCard label="תפוסה עכשיו" value={pct(pulse.occupancyPct)} bar={pulse.occupancyPct == null ? null : pulse.occupancyPct / 100} />
        <PulseCard label="שולחנות פנויים" value={pulse.freeTables == null ? '—' : String(pulse.freeTables)} />
        <PulseCard label="הגעה קרובה" value={pulse.nextArrival ? pulse.nextArrival.time : '—'} sub={pulse.nextArrival ? `${pulse.nextArrival.guestName} · ${pulse.nextArrival.partySize}` : undefined} />
        <PulseCard label="בהמתנה" value={String(pulse.waiting.count)} sub={pulse.waiting.longestMin != null ? `· ${pulse.waiting.longestMin} דק׳` : undefined} />
      </div>
      {(pulse.flags.vip + pulse.flags.birthday + pulse.flags.large) > 0 && (
        <div className="flex flex-wrap gap-2 -mt-3">
          {pulse.flags.vip > 0 && <span className="text-[11px] text-iron-muted bg-iron-elevated/40 rounded-full px-3 py-1">★ {pulse.flags.vip} VIP</span>}
          {pulse.flags.birthday > 0 && <span className="text-[11px] text-iron-muted bg-iron-elevated/40 rounded-full px-3 py-1">🎂 {pulse.flags.birthday} ימי הולדת</span>}
          {pulse.flags.large > 0 && <span className="text-[11px] text-iron-muted bg-iron-elevated/40 rounded-full px-3 py-1">👥 {pulse.flags.large} קבוצות גדולות</span>}
        </div>
      )}

      {/* Attention — the heart */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-iron-text text-sm font-semibold">דורש התייחסות</span>
          {data.attention.length > 0 && <span className="text-iron-muted text-[11px]">{data.attention.length} פריטים</span>}
        </div>
        {data.attention.length > 0 ? (
          <div className="flex flex-col gap-2">
            {data.attention.map(item => <AttentionRow key={item.id} item={item} onNavigate={onNavigate} />)}
          </div>
        ) : (
          /* Calm-day reward */
          <div className="bg-iron-green/8 border border-iron-green/25 rounded-xl px-5 py-6 text-center">
            <p className="text-iron-green-light text-sm font-semibold mb-1">כל השולחנות במקום. ערב חלק.</p>
            <p className="text-iron-muted text-xs">{pulse.coversToday} מוזמנים · {pulse.seatedNow} יושבים · אין מה שדורש התערבות כרגע.</p>
          </div>
        )}
      </div>

      {/* Business health */}
      <div>
        <div className="text-iron-muted text-xs mb-2">בריאות עסקית</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          <HealthPill label="תפוסה" value={pct(health.occupancyPct)} />
          <HealthPill label="אישורים" value={pct(health.confirmationRatePct)} />
          <HealthPill label="אי-הגעה היום" value={pct(health.noShowTodayPct)} warn={(health.noShowTodayPct ?? 0) >= 10} />
          <HealthPill label="גודל סועד ממוצע" value={health.avgPartySize == null ? '—' : String(health.avgPartySize)} />
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <div className="text-iron-muted text-xs mb-2">פעולות מהירות</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} onClick={() => onNavigate(a.target)} className="text-start text-[12px] text-iron-muted bg-iron-elevated/40 hover:bg-iron-elevated/70 hover:text-iron-text rounded-lg px-3 py-2.5 transition-colors">
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardModule({ context, userFirstName, onNavigate }: Props) {
  const settings = context.restaurant.settings ?? null;
  const { state, reload } = useDashboardData(settings, userFirstName);

  const subtitle = state.status === 'ready'
    ? `${state.data.weekdayLabelHe} · ${new Date().toLocaleDateString('he-IL')}`
    : 'מה דורש את תשומת ליבך היום';

  return (
    <WorkspacePage
      title="לוח בקרה"
      subtitle={subtitle}
      breadcrumbs={[{ label: 'מרכז הניהול' }, { label: 'לוח בקרה' }]}
      state={state.status === 'loading' ? 'loading' : state.status === 'error' ? 'error' : 'ready'}
      error={{ message: state.status === 'error' ? state.message : '', onRetry: reload }}
    >
      {state.status === 'ready' && <Content data={state.data} onNavigate={onNavigate} />}
    </WorkspacePage>
  );
}
