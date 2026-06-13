import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import type { MorningBriefRecord, MomentRecord, MomentStatus } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRestaurantId(): string {
  return localStorage.getItem('iron_restaurant_id') ?? '';
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

const MOMENT_LABEL: Record<string, { icon: string; title: string; color: string }> = {
  LONG_RETURN:      { icon: '🌿', title: 'חזרה לאחר היעדרות',  color: 'border-iron-green/35 bg-iron-green/8' },
  BIRTHDAY_ECHO:    { icon: '🎂', title: 'יום הולדת',          color: 'border-status-warning/35 bg-status-warning/8' },
  ANNIVERSARY_ECHO: { icon: '💍', title: 'יום נישואין',        color: 'border-pink-500/35 bg-pink-900/8' },
  RECOVERY_SEALED:  { icon: '🤝', title: 'לקוח שחזר לאחר תקלה', color: 'border-status-reserved/35 bg-status-reserved/8' },
};

// ─── Edit Message Modal ────────────────────────────────────────────────────────

function EditMessageModal({
  moment,
  onSave,
  onCancel,
}: {
  moment: MomentRecord;
  onSave: (msg: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(moment.finalMessage ?? moment.draftMessage);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/60 z-[70]" onClick={onCancel} />
      <div
        dir="rtl"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[75] w-full max-w-[460px] rounded-2xl bg-iron-card flex flex-col"
        style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 8px 48px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-iron-border/30">
          <div className="flex items-center justify-between">
            <h3 className="text-iron-text font-bold text-[15px]">עריכת הודעה</h3>
            <button onClick={onCancel} className="text-iron-muted/50 hover:text-iron-text text-xl leading-none w-7 h-7 flex items-center justify-center">×</button>
          </div>
          <p className="text-iron-muted/55 text-[12px] mt-0.5">
            {MOMENT_LABEL[moment.type]?.icon} {MOMENT_LABEL[moment.type]?.title} — {moment.guest.firstName} {moment.guest.lastName}
          </p>
        </div>
        <div className="px-5 py-4">
          <textarea
            ref={ref}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={5}
            dir="rtl"
            className="w-full bg-iron-bg border border-iron-border/50 rounded-xl px-4 py-3 text-iron-text text-[13px] leading-relaxed resize-none focus:outline-none focus:border-iron-green/60 transition-colors"
            placeholder="הקלד הודעה..."
          />
          <p className="text-iron-muted/40 text-[11px] mt-1.5 text-left" dir="ltr">{text.length} תווים</p>
        </div>
        <div className="px-5 pb-5 flex gap-2.5">
          <button
            onClick={() => onSave(text)}
            disabled={!text.trim()}
            className="flex-1 py-2.5 rounded-xl bg-iron-green text-white font-semibold text-[13px] hover:bg-iron-green-light transition-colors disabled:opacity-40"
          >
            אשר ושלח
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-iron-border/50 text-iron-muted/70 text-[13px] hover:text-iron-text hover:border-iron-border transition-colors"
          >
            ביטול
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Moment Card ──────────────────────────────────────────────────────────────

function MomentCard({
  moment,
  onApprove,
  onReject,
  onEdit,
  busy,
}: {
  moment: MomentRecord;
  onApprove: (id: string, msg?: string) => void;
  onReject: (id: string) => void;
  onEdit: (moment: MomentRecord) => void;
  busy: string | null;
}) {
  const meta = MOMENT_LABEL[moment.type] ?? { icon: '✉️', title: moment.type, color: 'border-iron-border/30 bg-iron-card' };
  const isBusy = busy === moment.id;
  const displayMsg = moment.finalMessage ?? moment.draftMessage;

  const STATUS_BADGE: Record<MomentStatus, { label: string; cls: string }> = {
    PENDING:  { label: 'ממתין',  cls: 'bg-status-warning/15 text-status-warning border-status-warning/30' },
    APPROVED: { label: 'אושר',   cls: 'bg-iron-green/15 text-iron-green-light border-iron-green/30' },
    REJECTED: { label: 'נדחה',   cls: 'bg-iron-border/20 text-iron-muted/55 border-iron-border/30' },
    SENT:     { label: 'נשלח',   cls: 'bg-status-success/15 text-status-success border-status-success/30' },
  };

  const badge = STATUS_BADGE[moment.status];

  return (
    <div className={`rounded-2xl border px-5 py-4 mb-3 ${meta.color}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{meta.icon}</span>
          <div>
            <p className="text-iron-text font-bold text-[14px] leading-snug">{moment.guest.firstName} {moment.guest.lastName}</p>
            <p className="text-iron-muted/60 text-[11px]">{meta.title}</p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {/* Message preview */}
      <div className="bg-iron-bg/60 rounded-xl px-4 py-3 mb-3" dir="rtl">
        <p className="text-iron-text/90 text-[13px] leading-relaxed">{displayMsg}</p>
        {moment.finalMessage && moment.finalMessage !== moment.draftMessage && (
          <p className="text-iron-muted/40 text-[10px] mt-1.5">✏️ נערך</p>
        )}
      </div>

      {/* Actions */}
      {moment.status === 'PENDING' && (
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(moment.id)}
            disabled={isBusy}
            className="flex-1 py-2 rounded-xl bg-iron-green text-white font-semibold text-[12px] hover:bg-iron-green-light transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {isBusy ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : '✓'}
            אשר ושלח
          </button>
          <button
            onClick={() => onEdit(moment)}
            disabled={isBusy}
            className="px-3.5 py-2 rounded-xl border border-iron-border/50 text-iron-muted/70 text-[12px] hover:text-iron-text hover:border-iron-border transition-colors disabled:opacity-40"
            title="ערוך לפני שליחה"
          >
            ✏️
          </button>
          <button
            onClick={() => onReject(moment.id)}
            disabled={isBusy}
            className="px-3.5 py-2 rounded-xl border border-iron-border/40 text-iron-muted/50 text-[12px] hover:text-status-danger hover:border-status-danger/40 transition-colors disabled:opacity-40"
            title="דחה"
          >
            ✕
          </button>
        </div>
      )}

      {moment.status === 'APPROVED' && (
        <div className="flex items-center justify-between">
          <span className="text-iron-green-light text-[12px] font-medium">מאושר — יישלח בהמשך</span>
          <button
            onClick={() => onApprove(moment.id)}
            disabled={isBusy}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-iron-green/20 text-iron-green-light border border-iron-green/30 hover:bg-iron-green/30 transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            {isBusy ? <span className="w-3 h-3 border-2 border-iron-green/30 border-t-iron-green-light rounded-full animate-spin" /> : null}
            שלח עכשיו
          </button>
        </div>
      )}

      {moment.status === 'SENT' && moment.sentAt && (
        <p className="text-iron-muted/50 text-[11px]">נשלח ב־{fmtTime(moment.sentAt)}</p>
      )}
    </div>
  );
}

// ─── Morning Brief ────────────────────────────────────────────────────────────

function MorningBriefPanel({ restaurantId }: { restaurantId: string }) {
  const [brief, setBrief] = useState<MorningBriefRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.intelligence.getMorningBrief(restaurantId)
      .then(setBrief)
      .catch(() => setBrief(null))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  if (loading) {
    return (
      <div className="space-y-2 mb-6">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-iron-border/15 animate-pulse" />)}
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="rounded-2xl border border-iron-border/25 bg-iron-card px-5 py-6 mb-6 text-center">
        <p className="text-iron-muted/50 text-[13px]">הבריפינג הבוקר יהיה מוכן ב־06:00</p>
        <p className="text-iron-muted/35 text-[11px] mt-1">המערכת מחשבת אוטומטית כל לילה</p>
      </div>
    );
  }

  const { content } = brief;
  const hasContent = content.vipArrivals.length + content.birthdays.length + content.anniversaries.length + content.silentReturns.length > 0;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile value={content.totalCovers} label="סועדים היום" icon="🍽️" />
        <StatTile value={content.openRecovery} label="מקרי טיפול פתוחים" icon="🔧" warn={content.openRecovery > 0} />
      </div>

      {!hasContent && (
        <div className="rounded-xl bg-iron-card border border-iron-border/20 px-4 py-3 text-center">
          <p className="text-iron-muted/50 text-[12px]">אין אירועים מיוחדים היום</p>
        </div>
      )}

      {content.birthdays.length > 0 && (
        <BriefSection icon="🎂" title="ימי הולדת היום" color="text-status-warning">
          {content.birthdays.map((b, i) => (
            <BriefRow key={i} name={b.name} time={b.time} />
          ))}
        </BriefSection>
      )}

      {content.anniversaries.length > 0 && (
        <BriefSection icon="💍" title="ימי נישואין היום" color="text-pink-400">
          {content.anniversaries.map((a, i) => (
            <BriefRow key={i} name={a.name} time={a.time} />
          ))}
        </BriefSection>
      )}

      {content.vipArrivals.length > 0 && (
        <BriefSection icon="⭐" title="אורחי VIP היום" color="text-status-warning">
          {content.vipArrivals.map((v, i) => (
            <BriefRow key={i} name={v.name} time={v.time} sub={`${v.partySize} סועדים`} />
          ))}
        </BriefSection>
      )}

      {content.silentReturns.length > 0 && (
        <BriefSection icon="🌿" title="חזרו לאחר היעדרות" color="text-iron-green-light">
          {content.silentReturns.map((s, i) => (
            <BriefRow key={i} name={s.name} sub={s.silentScore ? `ציון היעדרות: ${s.silentScore}` : undefined} />
          ))}
        </BriefSection>
      )}
    </div>
  );
}

function StatTile({ value, label, icon, warn }: { value: number; label: string; icon: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-center ${warn && value > 0 ? 'border-status-danger/30 bg-red-900/8' : 'border-iron-border/25 bg-iron-card'}`}>
      <div className="text-[22px] mb-0.5">{icon}</div>
      <div className={`text-[26px] font-black tabular-nums ${warn && value > 0 ? 'text-status-danger' : 'text-iron-text'}`}>{value}</div>
      <div className="text-iron-muted/55 text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function BriefSection({ icon, title, color, children }: {
  icon: string; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-iron-card border border-iron-border/20 px-4 py-3 mb-2">
      <p className={`text-[11px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${color}`}>
        {icon} {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function BriefRow({ name, time, sub }: { name: string; time?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-iron-text font-semibold text-[13px]">{name}</span>
        {sub && <span className="text-iron-muted/50 text-[11px] ms-2">{sub}</span>}
      </div>
      {time && <span className="text-iron-green-light font-bold text-[12px] tabular-nums">{time}</span>}
    </div>
  );
}

// ─── Moments Panel ────────────────────────────────────────────────────────────

type MomentTab = 'PENDING' | 'APPROVED' | 'SENT';

function MomentsPanel({ restaurantId }: { restaurantId: string }) {
  const [moments, setMoments] = useState<MomentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MomentTab>('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<MomentRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await api.intelligence.getMoments(restaurantId);
      setMoments(all);
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  async function approve(id: string, msg?: string) {
    setBusy(id);
    try {
      const updated = await api.intelligence.reviewMoment(restaurantId, id, {
        action: 'approve',
        ...(msg ? { finalMessage: msg } : {}),
      });
      setMoments(prev => prev.map(m => m.id === id ? { ...m, ...updated } : m));
      setEditing(null);
    } catch { /* noop */ }
    finally { setBusy(null); }
  }

  async function reject(id: string) {
    setBusy(id);
    try {
      const updated = await api.intelligence.reviewMoment(restaurantId, id, { action: 'reject' });
      setMoments(prev => prev.map(m => m.id === id ? { ...m, ...updated } : m));
    } catch { /* noop */ }
    finally { setBusy(null); }
  }

  const byStatus: Record<MomentTab, MomentRecord[]> = {
    PENDING:  moments.filter(m => m.status === 'PENDING'),
    APPROVED: moments.filter(m => m.status === 'APPROVED'),
    SENT:     moments.filter(m => m.status === 'SENT'),
  };

  const TABS: { id: MomentTab; label: string }[] = [
    { id: 'PENDING',  label: 'ממתין לאישור' },
    { id: 'APPROVED', label: 'אושר' },
    { id: 'SENT',     label: 'נשלח' },
  ];

  return (
    <div>
      {/* Tab strip */}
      <div className="flex gap-1 mb-4 bg-iron-bg/60 p-1 rounded-xl">
        {TABS.map(t => {
          const count = byStatus[t.id].length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                tab === t.id
                  ? 'bg-iron-card text-iron-text shadow-sm'
                  : 'text-iron-muted/55 hover:text-iron-text'
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0 rounded-full ${
                  tab === t.id && t.id === 'PENDING'
                    ? 'bg-status-warning/25 text-status-warning'
                    : 'bg-iron-border/30 text-iron-muted/60'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-32 rounded-2xl bg-iron-border/15 animate-pulse" />)}
        </div>
      )}

      {!loading && byStatus[tab].length === 0 && (
        <div className="text-center py-10">
          <p className="text-iron-muted/40 text-[13px]">
            {tab === 'PENDING' ? 'אין הודעות הממתינות לאישור' :
             tab === 'APPROVED' ? 'אין הודעות מאושרות' :
             'אין הודעות שנשלחו'}
          </p>
          {tab === 'PENDING' && (
            <p className="text-iron-muted/30 text-[11px] mt-1">ייוצרו אוטומטית בעת השלמת הזמנות</p>
          )}
        </div>
      )}

      {!loading && byStatus[tab].map(m => (
        <MomentCard
          key={m.id}
          moment={m}
          onApprove={approve}
          onReject={reject}
          onEdit={setEditing}
          busy={busy}
        />
      ))}

      {editing && (
        <EditMessageModal
          moment={editing}
          onSave={msg => approve(editing.id, msg)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type PageSection = 'brief' | 'moments';

interface Props {
  onBack: () => void;
}

export default function IntelligencePage({ onBack }: Props) {
  const restaurantId = getRestaurantId();
  const [section, setSection] = useState<PageSection>('brief');

  return (
    <div className="min-h-screen bg-iron-bg flex flex-col" dir="rtl">
      {/* ── Top bar ── */}
      <div
        className="shrink-0 bg-iron-card border-b border-iron-border/35 px-5 py-3 flex items-center gap-4"
        style={{ backgroundImage: 'linear-gradient(180deg, rgba(111,138,60,0.10) 0%, transparent 100%)' }}
      >
        <button
          onClick={onBack}
          className="text-iron-muted/60 hover:text-iron-text text-[12px] font-medium flex items-center gap-1.5 transition-colors touch-manipulation shrink-0"
        >
          ← חזור
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-iron-text font-black text-[18px] leading-none">Intelligence</h1>
          <p className="text-iron-muted/50 text-[11px] mt-0.5">מרכז המידע של הבעלים</p>
        </div>

        {/* Section switcher */}
        <div className="flex gap-1 bg-iron-bg/70 p-0.5 rounded-xl shrink-0">
          <button
            onClick={() => setSection('brief')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              section === 'brief'
                ? 'bg-iron-card text-iron-text shadow-sm'
                : 'text-iron-muted/55 hover:text-iron-text'
            }`}
          >
            ☀️ בריפינג
          </button>
          <button
            onClick={() => setSection('moments')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              section === 'moments'
                ? 'bg-iron-card text-iron-text shadow-sm'
                : 'text-iron-muted/55 hover:text-iron-text'
            }`}
          >
            ✉️ הודעות
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] mx-auto px-4 py-5">

          {section === 'brief' && (
            <>
              <div className="mb-4">
                <h2 className="text-iron-text font-bold text-[15px]">בריפינג הבוקר</h2>
                <p className="text-iron-muted/50 text-[12px]">
                  {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              </div>
              <MorningBriefPanel restaurantId={restaurantId} />

              {/* Link to moments */}
              <button
                onClick={() => setSection('moments')}
                className="w-full rounded-2xl border border-iron-border/30 bg-iron-card px-5 py-4 text-right hover:border-iron-border/55 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-iron-text font-semibold text-[13px]">✉️ הודעות אישיות לאישור</p>
                    <p className="text-iron-muted/50 text-[12px] mt-0.5">ברך לקוחות בצורה אישית — טיפול ידני</p>
                  </div>
                  <span className="text-iron-muted/40 group-hover:text-iron-muted/70 transition-colors">←</span>
                </div>
              </button>
            </>
          )}

          {section === 'moments' && (
            <>
              <div className="mb-4">
                <h2 className="text-iron-text font-bold text-[15px]">הודעות אישיות</h2>
                <p className="text-iron-muted/50 text-[12px]">אשר, ערוך ושלח — כל הודעה מחייבת אישור ידני</p>
              </div>
              <MomentsPanel restaurantId={restaurantId} />
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// React import for JSX types
import type React from 'react';
