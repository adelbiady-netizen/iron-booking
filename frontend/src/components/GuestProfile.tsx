import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { GuestDetail, GuestIntelligence, GuestMemoryRecord, GuestAlertRecord, RecoveryCaseRecord, ReservationStatus } from '../types';
import { api } from '../api';
import { operationalTags, guestOriginLabel, isImportNote, isCrmImportWithNoHistory, CRM_NO_HISTORY_LABEL } from '../utils/displayHelpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateHe(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

const STATUS_LABEL: Record<ReservationStatus, { text: string; cls: string }> = {
  PENDING:   { text: 'ממתין',   cls: 'bg-status-warning/15 text-status-warning border-status-warning/30' },
  CONFIRMED: { text: 'מאושר',   cls: 'bg-status-reserved/12 text-status-reserved/90 border-status-reserved/25' },
  SEATED:    { text: 'יושב',    cls: 'bg-iron-green/22 text-iron-green-light border-iron-green/35' },
  COMPLETED: { text: 'הסתיים',  cls: 'bg-iron-border/18 text-iron-muted/75 border-iron-border/25' },
  CANCELLED: { text: 'בוטל',    cls: 'bg-red-900/15 text-status-danger border-red-900/25' },
  NO_SHOW:   { text: 'לא הגיע', cls: 'bg-orange-900/15 text-orange-400 border-orange-900/25' },
};

const MEMORY_ICON: Record<string, string> = {
  CELEBRATION: '🎉',
  RECOVERY: '🔧',
  EMOTIONAL_MOMENT: '💙',
  MILESTONE: '🏆',
  PREFERENCE: '⭐',
  GROUP_EVENT: '👥',
};

const ALERT_ICON: Record<string, string> = {
  BIRTHDAY_SOON: '🎂',
  ANNIVERSARY_SOON: '💍',
  SILENT_GUEST: '😶',
  HIGH_NOSHOW: '⚠️',
  RECOVERY_OPEN: '🔧',
};

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = 'details' | 'upcoming' | 'history' | 'memory';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResRow({ r }: { r: GuestDetail['reservations'][number] }) {
  const s = STATUS_LABEL[r.status];
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-iron-border/20 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-iron-text font-semibold text-[13px] tabular-nums">{fmtDate(r.date)}</span>
          <span className="text-iron-muted/60 text-[12px]">•</span>
          <span className="text-iron-green-light font-bold text-[13px] tabular-nums">{r.time}</span>
          {r.table && (
            <>
              <span className="text-iron-muted/60 text-[12px]">•</span>
              <span className="text-iron-muted/80 text-[12px]">{r.table.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-iron-muted/60 text-[11px]">{r.partySize} סועדים</span>
          {r.occasion && (
            <>
              <span className="text-iron-muted/40 text-[11px]">•</span>
              <span className="text-iron-muted/70 text-[11px]">{r.occasion}</span>
            </>
          )}
        </div>
      </div>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${s.cls}`}>
        {s.text}
      </span>
    </div>
  );
}

function MemoryCard({ memory, onSuppress }: { memory: GuestMemoryRecord; onSuppress?: (id: string) => void }) {
  return (
    <div className="rounded-xl bg-iron-card border border-iron-border/25 px-4 py-3 mb-2">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5 shrink-0">{MEMORY_ICON[memory.category] ?? '📌'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-iron-text text-[13px] font-semibold leading-snug">{memory.headline}</p>
          {memory.context && (
            <p className="text-iron-muted/60 text-[12px] mt-0.5">{memory.context}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-iron-muted/45">{fmtDateHe(memory.occurredAt)}</span>
            {memory.isRecurring && (
              <span className="text-[10px] bg-status-warning/12 text-status-warning border border-status-warning/25 px-1.5 py-0 rounded-full">שנתי</span>
            )}
            <span className={`text-[10px] px-1.5 py-0 rounded-full border ${
              memory.source === 'HOST_ADDED'
                ? 'bg-status-reserved/10 text-status-reserved/70 border-status-reserved/20'
                : 'bg-iron-border/15 text-iron-muted/45 border-iron-border/20'
            }`}>
              {memory.source === 'HOST_ADDED' ? 'ידני' : 'אוטומטי'}
            </span>
            <div className="flex gap-0.5">
              {Array.from({ length: Math.min(10, memory.emotionalWeight) }, (_, i) => (
                <div key={i} className={`w-1 h-1 rounded-full ${i < memory.emotionalWeight ? 'bg-iron-green/70' : 'bg-iron-border/25'}`} />
              ))}
            </div>
          </div>
        </div>
        {onSuppress && (
          <button
            onClick={() => onSuppress(memory.id)}
            className="text-iron-muted/30 hover:text-iron-muted/60 text-[11px] shrink-0 transition-colors"
            title="הסתר"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function AlertBadge({ alert, onDismiss }: { alert: GuestAlertRecord; onDismiss: (id: string) => void }) {
  const colors: Record<string, string> = {
    BIRTHDAY_SOON: 'bg-status-warning/12 border-status-warning/30 text-status-warning',
    ANNIVERSARY_SOON: 'bg-pink-900/12 border-pink-900/25 text-pink-400',
    SILENT_GUEST: 'bg-iron-border/20 border-iron-border/40 text-iron-muted/70',
    HIGH_NOSHOW: 'bg-orange-900/15 border-orange-900/30 text-orange-400',
    RECOVERY_OPEN: 'bg-red-900/12 border-red-900/25 text-status-danger',
  };

  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 mb-2 ${colors[alert.type] ?? 'bg-iron-card border-iron-border/25 text-iron-text'}`}>
      <span className="text-base leading-none shrink-0">{ALERT_ICON[alert.type] ?? '⚡'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold">{alert.headline}</p>
        {alert.context && <p className="text-[11px] opacity-70 mt-0.5">{alert.context}</p>}
      </div>
      <button
        onClick={() => onDismiss(alert.id)}
        className="text-current opacity-40 hover:opacity-70 text-base leading-none transition-opacity shrink-0"
        title="סגור"
      >
        ×
      </button>
    </div>
  );
}

// ─── Guest Intelligence Panel (always-visible header strip) ─────────────────

function loyaltyTier(visits: number): { label: string; cls: string } {
  if (visits >= 25) return { label: 'נאמן מאוד', cls: 'text-status-warning bg-status-warning/14 border-status-warning/28' };
  if (visits >= 13) return { label: 'נאמן',      cls: 'text-iron-green-light bg-iron-green/12 border-iron-green/25' };
  if (visits >= 6)  return { label: 'קבוע',      cls: 'text-iron-green-light bg-iron-green/10 border-iron-green/20' };
  if (visits >= 3)  return { label: 'מוכר',      cls: 'text-iron-muted/70 bg-iron-border/15 border-iron-border/28' };
  return              { label: 'חדש',            cls: 'text-iron-muted/50 bg-iron-border/10 border-iron-border/20' };
}

function silentRisk(score: number | null | undefined): { label: string; cls: string } | null {
  if (!score || score < 30) return null;
  if (score >= 80) return { label: `בסיכון גבוה · ${score}`, cls: 'text-status-danger bg-red-900/12 border-red-900/25' };
  if (score >= 60) return { label: `בסיכון · ${score}`,      cls: 'text-orange-400 bg-orange-900/12 border-orange-900/25' };
  return                   { label: `במעקב · ${score}`,      cls: 'text-iron-muted/70 bg-iron-border/15 border-iron-border/25' };
}

function daysAgoLabel(iso: string | null): string {
  if (!iso) return 'טרם ביקר';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'ביקר היום';
  if (days === 1) return 'ביקר אתמול';
  return `לפני ${days} ימים`;
}

function IntelPanel({ guest, intel }: { guest: GuestDetail; intel: GuestIntelligence | null }) {
  const gicStats = intel?.guest;
  const alerts   = intel?.alerts ?? [];
  const memories = intel?.memories ?? [];

  const tier   = loyaltyTier(guest.visitCount);
  const silent = silentRisk(gicStats?.silentScore);

  const recoveryAlert    = alerts.find(a => a.type === 'RECOVERY_OPEN');
  const birthdayAlert    = alerts.find(a => a.type === 'BIRTHDAY_SOON');
  const anniversaryAlert = alerts.find(a => a.type === 'ANNIVERSARY_SOON');

  // best memory to preview: preference first, then highest emotional weight
  const topMemory = memories.find(m => m.category === 'PREFERENCE')
    ?? (memories.length > 0
        ? memories.reduce((best, m) => m.emotionalWeight > best.emotionalWeight ? m : best)
        : null);

  const hasAlertRow = !!(recoveryAlert || birthdayAlert || anniversaryAlert);

  return (
    <div className="space-y-2">
      {/* ── Row 1: loyalty + last visit + silent risk ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {isCrmImportWithNoHistory(guest.visitCount, guest.tags, guest.internalNotes) ? (
          <span className="text-[11px] text-iron-muted/60 italic px-2 py-0.5">{CRM_NO_HISTORY_LABEL}</span>
        ) : (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tier.cls}`}>
            {guest.visitCount} ביקורים · {tier.label}
          </span>
        )}

        <span className="text-iron-muted/50 text-[11px]">
          ·
        </span>
        <span className="text-iron-muted/60 text-[11px] font-medium">
          {daysAgoLabel(guest.lastVisitAt)}
        </span>

        {silent && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${silent.cls}`}>
            <span className="text-[10px]">⚠️</span>
            {silent.label}
          </span>
        )}

        {guest.noShowCount > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-orange-900/10 border-orange-900/20 text-orange-400">
            {guest.noShowCount}× לא הגיע
          </span>
        )}
      </div>

      {/* ── Row 2: urgent alert signals (read-only, non-dismissible) ── */}
      {hasAlertRow && (
        <div className="flex flex-col gap-1.5">
          {recoveryAlert && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border bg-red-900/10 border-red-900/22 text-status-danger">
              <span className="text-[13px] leading-none shrink-0">🔧</span>
              <span className="text-[12px] font-semibold">{recoveryAlert.headline}</span>
            </div>
          )}
          {birthdayAlert && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border bg-status-warning/10 border-status-warning/22 text-status-warning">
              <span className="text-[13px] leading-none shrink-0">🎂</span>
              <span className="text-[12px] font-semibold">{birthdayAlert.headline}</span>
            </div>
          )}
          {anniversaryAlert && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border bg-pink-900/10 border-pink-900/22 text-pink-400">
              <span className="text-[13px] leading-none shrink-0">💍</span>
              <span className="text-[12px] font-semibold">{anniversaryAlert.headline}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Row 3: top memory preview ── */}
      {topMemory && (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="text-[14px] leading-none shrink-0">{MEMORY_ICON[topMemory.category] ?? '📌'}</span>
          <span className="text-iron-muted/65 text-[11px] truncate">{topMemory.headline}</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RecoverySection({
  cases,
  restaurantId,
  guestId,
  onUpdate,
}: {
  cases: RecoveryCaseRecord[];
  restaurantId: string;
  guestId: string;
  onUpdate: () => void;
}) {
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function createCase() {
    if (!newDesc.trim() || creating) return;
    setCreating(true);
    try {
      await api.intelligence.createRecovery(restaurantId, guestId, { description: newDesc.trim() });
      setNewDesc('');
      setShowForm(false);
      onUpdate();
    } finally {
      setCreating(false);
    }
  }

  async function resolve(caseId: string) {
    await api.intelligence.resolveRecovery(restaurantId, caseId);
    onUpdate();
  }

  const openCases = cases.filter(c => c.status !== 'RESOLVED');
  const closedCases = cases.filter(c => c.status === 'RESOLVED');

  return (
    <div className="space-y-2">
      {openCases.length === 0 && closedCases.length === 0 && !showForm && (
        <p className="text-iron-muted/45 text-[12px] italic text-center py-3">אין מקרי טיפול</p>
      )}

      {openCases.map(c => (
        <div key={c.id} className="rounded-xl bg-red-900/8 border border-red-900/20 px-4 py-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-iron-text text-[13px] font-semibold">{c.description}</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-status-danger/15 text-status-danger border border-status-danger/25 shrink-0">פתוח</span>
          </div>
          {c.actions.map(a => (
            <div key={a.id} className="text-[12px] text-iron-muted/70 border-t border-red-900/15 pt-1 mt-1">
              <span className="font-semibold text-iron-text/80">{a.actorName}:</span> {a.note}
            </div>
          ))}
          <button
            onClick={() => resolve(c.id)}
            className="mt-2 text-[11px] font-semibold px-3 py-1 rounded-lg bg-iron-green/15 text-iron-green-light border border-iron-green/25 hover:bg-iron-green/25 transition-colors"
          >
            סמן כפתור
          </button>
        </div>
      ))}

      {closedCases.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] text-iron-muted/40 uppercase tracking-wider mb-1">סגורים</p>
          {closedCases.map(c => (
            <div key={c.id} className="rounded-xl bg-iron-card border border-iron-border/20 px-4 py-2 mb-1.5 opacity-60">
              <p className="text-iron-text text-[12px]">{c.description}</p>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="space-y-2 mt-2">
          <textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            rows={2}
            className="w-full text-[13px] bg-iron-card border border-iron-border/55 rounded-lg px-3 py-2 text-iron-text resize-none focus:outline-none focus:border-red-700/60"
            placeholder="תאר מה קרה..."
            dir="rtl"
          />
          <div className="flex gap-2">
            <button
              onClick={createCase}
              disabled={creating || !newDesc.trim()}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-status-danger/80 text-white hover:bg-status-danger transition-colors disabled:opacity-50"
            >
              {creating ? 'שומר...' : 'פתח מקרה'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-iron-border/50 text-iron-muted hover:text-iron-text transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-red-900/30 text-status-danger/70 hover:border-status-danger/50 hover:text-status-danger transition-colors mt-1"
        >
          + פתח מקרה טיפול
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  guestId: string;
  restaurantId?: string;
  onClose: () => void;
}

export default function GuestProfile({ guestId, restaurantId: restaurantIdProp, onClose }: Props) {
  const restaurantId = restaurantIdProp ?? localStorage.getItem('iron_restaurant_id') ?? '';
  if (!guestId) return null;

  const [guest, setGuest]         = useState<GuestDetail | null>(null);
  const [intel, setIntel]         = useState<GuestIntelligence | null>(null);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<Tab>('details');
  const [savingVip, setSavingVip] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [notesVal, setNotesVal]   = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [newMemory, setNewMemory] = useState('');
  const [addingMemory, setAddingMemory] = useState(false);
  const [showMemoryForm, setShowMemoryForm] = useState(false);

  const loadGuest = useCallback(async () => {
    try {
      const g = await api.guests.getById(guestId);
      setGuest(g);
      // Don't pre-fill textarea with import metadata — hosts should start with a blank slate
      setNotesVal(g.internalNotes && !isImportNote(g.internalNotes) ? g.internalNotes : '');
    } catch { /* noop */ }
  }, [guestId]);

  const loadIntel = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const i = await api.intelligence.getGuest(restaurantId, guestId);
      setIntel(i);
    } catch { /* noop */ }
  }, [restaurantId, guestId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadGuest(), loadIntel()]).finally(() => setLoading(false));
  }, [loadGuest, loadIntel]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (guest?.reservations ?? []).filter(
    r => ['PENDING', 'CONFIRMED'].includes(r.status) && r.date >= today,
  );
  const history = (guest?.reservations ?? []).filter(
    r => !['PENDING', 'CONFIRMED'].includes(r.status) || r.date < today,
  );

  async function toggleVip() {
    if (!guest || savingVip) return;
    setSavingVip(true);
    try {
      const updated = await api.guests.update(guest.id, { isVip: !guest.isVip });
      setGuest(updated);
    } finally {
      setSavingVip(false);
    }
  }

  async function saveNotes() {
    if (!guest || savingNotes) return;
    setSavingNotes(true);
    try {
      const updated = await api.guests.update(guest.id, { internalNotes: notesVal || null });
      setGuest(updated);
      setEditNotes(false);
    } finally {
      setSavingNotes(false);
    }
  }

  async function dismissAlert(alertId: string) {
    if (!restaurantId) return;
    await api.intelligence.dismissAlert(restaurantId, alertId);
    setIntel(prev => prev ? { ...prev, alerts: prev.alerts.filter(a => a.id !== alertId) } : prev);
  }

  async function addMemory() {
    if (!newMemory.trim() || addingMemory || !restaurantId) return;
    setAddingMemory(true);
    try {
      await api.intelligence.addMemory(restaurantId, guestId, {
        category: 'EMOTIONAL_MOMENT',
        headline: newMemory.trim(),
        occurredAt: new Date().toISOString(),
        emotionalWeight: 6,
      });
      setNewMemory('');
      setShowMemoryForm(false);
      await loadIntel();
    } finally {
      setAddingMemory(false);
    }
  }

  const memories = intel?.memories ?? [];
  const alerts = intel?.alerts ?? [];
  const recoveryCases = intel?.recoveryCases ?? [];
  const gicStats = intel?.guest;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'details',  label: 'פרטי לקוח' },
    { id: 'memory',   label: 'זיכרונות', count: memories.length },
    { id: 'upcoming', label: 'עתידיות',  count: upcoming.length },
    { id: 'history',  label: 'היסטוריה', count: history.length },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/55 z-[55]" onClick={onClose} />

      <div
        dir="rtl"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-full max-w-[480px] max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 8px 64px rgba(0,0,0,0.72)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="bg-iron-card px-5 pt-5 pb-0 shrink-0"
          style={{ backgroundImage: 'linear-gradient(180deg, rgba(111,138,60,0.12) 0%, transparent 100%)' }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0 pe-3">
              {loading ? (
                <div className="h-8 w-40 bg-iron-border/20 rounded animate-pulse" />
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-iron-text font-black text-[26px] tracking-tight leading-none">
                    {guest ? `${guest.firstName} ${guest.lastName}` : '—'}
                  </h2>
                  {guest?.isVip && (
                    <span className="text-status-warning text-[11px] font-semibold bg-status-warning/14 px-2 py-0.5 rounded-full border border-status-warning/28 shrink-0">
                      VIP ⭐
                    </span>
                  )}
                  {guest?.isBlacklisted && (
                    <span className="text-status-danger text-[11px] font-semibold bg-red-900/18 px-2 py-0.5 rounded-full border border-red-900/30 shrink-0">
                      חסום
                    </span>
                  )}
                </div>
              )}

              {!loading && guest && (
                <div className="mt-2.5">
                  <IntelPanel guest={guest} intel={intel} />
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="text-iron-muted/50 hover:text-iron-text w-8 h-8 flex items-center justify-center rounded-xl hover:bg-iron-border/20 transition-colors text-lg leading-none touch-manipulation shrink-0 mt-0.5"
              aria-label="סגור"
            >
              ×
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-end gap-0 border-b border-iron-border/40 -mx-5 px-5 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-[12px] font-semibold px-3 py-2 border-b-2 transition-colors whitespace-nowrap touch-manipulation shrink-0 ${
                  tab === t.id
                    ? 'border-status-reserved text-status-reserved'
                    : 'border-transparent text-iron-muted/60 hover:text-iron-text'
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="ms-1 text-[10px] bg-iron-border/30 text-iron-muted/70 px-1.5 py-0.5 rounded-full">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
            <button
              disabled
              className="text-[12px] font-semibold px-3 py-2 border-b-2 border-transparent text-iron-muted/30 cursor-not-allowed whitespace-nowrap shrink-0"
              title="בקרוב"
            >
              סקרים ✨
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto bg-iron-bg px-5 py-4">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-iron-border/15 rounded animate-pulse" />
              ))}
            </div>
          )}

          {!loading && !guest && (
            <p className="text-iron-muted/60 text-sm text-center py-8">שגיאה בטעינת פרטי לקוח</p>
          )}

          {!loading && guest && (
            <>
              {/* ── פרטי לקוח ── */}
              {tab === 'details' && (
                <div className="space-y-4">
                  <Section title="פרטי התקשרות">
                    {guest.phone && <InfoRow label="טלפון" value={guest.phone} dir="ltr" />}
                    {guest.email && <InfoRow label="אימייל" value={guest.email} dir="ltr" />}
                    {!guest.phone && !guest.email && (
                      <p className="text-iron-muted/50 text-[12px] italic">אין פרטי התקשרות</p>
                    )}
                  </Section>

                  {(() => {
                    const visTags = operationalTags(guest.tags);
                    return (guest.allergies.length > 0 || visTags.length > 0) ? (
                      <Section title="אלרגיות ותגיות">
                        {guest.allergies.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {guest.allergies.map(a => (
                              <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-status-danger/12 border border-status-danger/25 text-status-danger font-medium">
                                ⚠ {a}
                              </span>
                            ))}
                          </div>
                        )}
                        {visTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {visTags.map(tag => (
                              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-iron-border/20 border border-iron-border/35 text-iron-muted/80">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </Section>
                    ) : null;
                  })()}

                  <Section title="סטטוס">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-iron-text">לקוח VIP</span>
                      <button
                        onClick={toggleVip}
                        disabled={savingVip}
                        className={`relative w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${guest.isVip ? 'bg-status-warning' : 'bg-iron-border/40'}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${guest.isVip ? 'left-5' : 'left-1'}`} />
                      </button>
                    </div>
                  </Section>

                  {/* IRON CLUB membership card */}
                  {guest.clubMembership && (
                    <Section title="♦ IRON CLUB">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-iron-muted">סטטוס חברות</span>
                          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                            guest.clubMembership.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                            guest.clubMembership.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-600'
                          }`}>
                            {guest.clubMembership.status === 'ACTIVE' ? 'פעיל' :
                             guest.clubMembership.status === 'PAUSED' ? 'מושהה' : 'יצא'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-iron-muted">תאריך הצטרפות</span>
                          <span className="text-[12px] text-iron-text">
                            {new Date(guest.clubMembership.joinDate).toLocaleDateString('he-IL')}
                          </span>
                        </div>
                        {guest.clubMembership.birthday && (
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] text-iron-muted">🎂 יום הולדת</span>
                            <span className="text-[12px] text-iron-text">{guest.clubMembership.birthday.split('-').reverse().join('/')}</span>
                          </div>
                        )}
                        {guest.clubMembership.anniversary && (
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] text-iron-muted">💍 יום נישואין</span>
                            <span className="text-[12px] text-iron-text">{guest.clubMembership.anniversary.split('-').reverse().join('/')}</span>
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap mt-1">
                          {guest.clubMembership.smsConsent && (
                            <span className="text-[10px] bg-iron-card border border-iron-border/30 rounded-full px-2 py-0.5 text-iron-muted/70">SMS ✓</span>
                          )}
                          {guest.clubMembership.marketingConsent && (
                            <span className="text-[10px] bg-iron-card border border-iron-border/30 rounded-full px-2 py-0.5 text-iron-muted/70">שיווק ✓</span>
                          )}
                        </div>
                      </div>
                    </Section>
                  )}

                  <Section title="הערות פנימיות">
                    {editNotes ? (
                      <div className="space-y-2">
                        <textarea
                          value={notesVal}
                          onChange={e => setNotesVal(e.target.value)}
                          rows={3}
                          className="w-full text-[13px] bg-iron-card border border-iron-border/55 rounded-lg px-3 py-2 text-iron-text resize-none focus:outline-none focus:border-iron-green/60"
                          placeholder="הערות רק לצוות (לא מוצגות ללקוח)..."
                          dir="rtl"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={saveNotes}
                            disabled={savingNotes}
                            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-iron-green text-white hover:bg-iron-green-light transition-colors disabled:opacity-50"
                          >
                            {savingNotes ? 'שומר...' : 'שמור'}
                          </button>
                          <button
                            onClick={() => { setEditNotes(false); setNotesVal(guest.internalNotes && !isImportNote(guest.internalNotes) ? guest.internalNotes : ''); }}
                            className="text-[11px] px-3 py-1.5 rounded-lg border border-iron-border/50 text-iron-muted hover:text-iron-text transition-colors"
                          >
                            ביטול
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div onClick={() => setEditNotes(true)} className="cursor-pointer group">
                        {(() => {
                          const isImport = guest.internalNotes && isImportNote(guest.internalNotes);
                          const hostNote = !isImport ? guest.internalNotes : null;
                          const originLabel = guestOriginLabel(guest.tags, guest.internalNotes);
                          if (hostNote) {
                            return (
                              <p className="text-[13px] text-iron-text group-hover:text-iron-text/80 transition-colors">
                                {hostNote}
                              </p>
                            );
                          }
                          return (
                            <>
                              <p className="text-[12px] text-iron-muted/45 italic group-hover:text-iron-muted/60 transition-colors">
                                לחץ להוספת הערה...
                              </p>
                              {originLabel && (
                                <p className="text-[10px] text-iron-muted/40 mt-1">{originLabel}</p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </Section>

                  {/* Recovery cases */}
                  {restaurantId && (
                    <Section title="מקרי טיפול">
                      <RecoverySection
                        cases={recoveryCases}
                        restaurantId={restaurantId}
                        guestId={guestId}
                        onUpdate={loadIntel}
                      />
                    </Section>
                  )}
                </div>
              )}

              {/* ── זיכרונות ── */}
              {tab === 'memory' && (
                <div>
                  {/* Dismissible alerts */}
                  {alerts.length > 0 && (
                    <div className="mb-3 space-y-1.5">
                      {alerts.map(a => (
                        <AlertBadge key={a.id} alert={a} onDismiss={dismissAlert} />
                      ))}
                    </div>
                  )}

                  {/* GIC stats strip */}
                  {gicStats && (
                    <div className="flex gap-3 mb-4 flex-wrap">
                      {gicStats.silentScore !== null && gicStats.silentScore !== undefined && (
                        <div className="rounded-xl bg-iron-card border border-iron-border/25 px-3 py-2 text-center">
                          <div className="text-[18px] font-black tabular-nums text-iron-text">{gicStats.silentScore}</div>
                          <div className="text-[9px] text-iron-muted/50 uppercase tracking-wider">ציון שקט</div>
                        </div>
                      )}
                      {gicStats.vipScore !== null && gicStats.vipScore !== undefined && (
                        <div className="rounded-xl bg-iron-card border border-iron-border/25 px-3 py-2 text-center">
                          <div className="text-[18px] font-black tabular-nums text-status-warning">{gicStats.vipScore}</div>
                          <div className="text-[9px] text-iron-muted/50 uppercase tracking-wider">ציון VIP</div>
                        </div>
                      )}
                      {gicStats.nextExpectedVisitDate && (
                        <div className="rounded-xl bg-iron-card border border-iron-border/25 px-3 py-2">
                          <div className="text-[12px] font-semibold text-iron-text">{fmtDate(gicStats.nextExpectedVisitDate)}</div>
                          <div className="text-[9px] text-iron-muted/50 uppercase tracking-wider">ביקור צפוי</div>
                        </div>
                      )}
                    </div>
                  )}

                  {memories.length === 0 && (
                    <p className="text-iron-muted/45 text-[12px] italic text-center py-4">
                      אין זיכרונות עדיין — יתמלאו אוטומטית עם הביקורים הבאים
                    </p>
                  )}
                  {memories.map(m => <MemoryCard key={m.id} memory={m} />)}

                  {/* Add manual memory */}
                  {showMemoryForm ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={newMemory}
                        onChange={e => setNewMemory(e.target.value)}
                        rows={2}
                        className="w-full text-[13px] bg-iron-card border border-iron-border/55 rounded-lg px-3 py-2 text-iron-text resize-none focus:outline-none focus:border-iron-green/60"
                        placeholder="רשום זיכרון... (למשל: אוהב שולחן ליד החלון)"
                        dir="rtl"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={addMemory}
                          disabled={addingMemory || !newMemory.trim()}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-iron-green text-white hover:bg-iron-green-light transition-colors disabled:opacity-50"
                        >
                          {addingMemory ? 'שומר...' : 'שמור זיכרון'}
                        </button>
                        <button
                          onClick={() => { setShowMemoryForm(false); setNewMemory(''); }}
                          className="text-[11px] px-3 py-1.5 rounded-lg border border-iron-border/50 text-iron-muted hover:text-iron-text transition-colors"
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowMemoryForm(true)}
                      className="mt-3 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-iron-border/35 text-iron-muted/60 hover:border-iron-green/40 hover:text-iron-green-light transition-colors"
                    >
                      + הוסף זיכרון ידנית
                    </button>
                  )}
                </div>
              )}

              {/* ── הזמנות עתידיות ── */}
              {tab === 'upcoming' && (
                <div>
                  {upcoming.length === 0 ? (
                    <p className="text-iron-muted/50 text-sm text-center py-8">אין הזמנות עתידיות</p>
                  ) : (
                    upcoming.map(r => <ResRow key={r.id} r={r} />)
                  )}
                </div>
              )}

              {/* ── היסטוריה ── */}
              {tab === 'history' && (
                <div>
                  {history.length === 0 ? (
                    <p className="text-iron-muted/50 text-sm text-center py-8">אין היסטוריית ביקורים</p>
                  ) : (
                    history.map(r => <ResRow key={r.id} r={r} />)
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Small atoms ──────────────────────────────────────────────────────────────


function Section({ title, children }: { title: string; children: import('react').ReactNode }) {
  return (
    <div className="rounded-xl bg-iron-card border border-iron-border/25 px-4 py-3">
      <h3 className="text-[10px] font-semibold text-iron-muted/55 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-iron-muted/60 text-[12px] font-medium shrink-0">{label}</span>
      <span className="text-iron-text text-[13px] font-semibold text-left" dir={dir ?? 'rtl'}>{value}</span>
    </div>
  );
}
