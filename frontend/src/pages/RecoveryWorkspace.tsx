import { useState, useEffect, useCallback } from 'react';
import type { RecoveryCase, RecoveryAction, RecoveryStats, RecoveryPriority, RecoveryStatus } from '../types';
import { api } from '../api';

interface Props {
  restaurantId: string;
  actorName: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STATUS_LABELS: Record<RecoveryStatus, string> = {
  OPEN: 'פתוח',
  CONTACTED: 'בטיפול',
  RESOLVED: 'נסגר',
};

const PRIORITY_LABELS: Record<RecoveryPriority, string> = {
  CRITICAL: 'קריטי',
  HIGH: 'גבוה',
  NORMAL: 'רגיל',
  LOW: 'נמוך',
};

const PRIORITY_COLORS: Record<RecoveryPriority, string> = {
  CRITICAL: 'bg-red-700 text-white',
  HIGH: 'bg-orange-500 text-white',
  NORMAL: 'bg-blue-500 text-white',
  LOW: 'bg-gray-400 text-white',
};

const STATUS_COLORS: Record<RecoveryStatus, string> = {
  OPEN: 'bg-red-100 text-red-700 border border-red-300',
  CONTACTED: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
  RESOLVED: 'bg-green-100 text-green-700 border border-green-300',
};

type FilterStatus = 'ALL' | RecoveryStatus;

// ── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: RecoveryStats | null }) {
  if (!stats) {
    return (
      <div dir="rtl" className="flex gap-3 flex-wrap mb-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-10 w-24 bg-iron-surface rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const chips = [
    { label: 'פתוחים', value: stats.open, cls: 'bg-red-100 text-red-700 border border-red-300' },
    { label: 'בטיפול', value: stats.contacted, cls: 'bg-yellow-100 text-yellow-700 border border-yellow-300' },
    { label: 'נסגרו', value: stats.resolved, cls: 'bg-green-100 text-green-700 border border-green-300' },
    { label: 'קריטיים', value: stats.criticalOpen, cls: 'bg-red-800 text-white' },
  ];

  return (
    <div dir="rtl" className="flex gap-3 flex-wrap mb-4">
      {chips.map(c => (
        <div key={c.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${c.cls}`}>
          <span>{c.label}</span>
          <span className="font-bold text-base">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({ active, onChange }: { active: FilterStatus; onChange: (s: FilterStatus) => void }) {
  const options: { value: FilterStatus; label: string }[] = [
    { value: 'ALL', label: 'הכל' },
    { value: 'OPEN', label: 'פתוח' },
    { value: 'CONTACTED', label: 'בטיפול' },
    { value: 'RESOLVED', label: 'נסגר' },
  ];

  return (
    <div dir="rtl" className="flex gap-2 mb-4">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active === o.value
              ? 'bg-iron-text text-iron-bg'
              : 'bg-iron-surface text-iron-muted hover:bg-iron-card'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Case Card ────────────────────────────────────────────────────────────────

function CaseCard({ c, onClick }: { c: RecoveryCase; onClick: () => void }) {
  const guest = c.guest;
  const guestName = guest ? `${guest.firstName} ${guest.lastName}` : '—';

  return (
    <button
      dir="rtl"
      onClick={onClick}
      className="w-full text-right bg-iron-card border border-iron-border rounded-xl p-4 hover:border-iron-text/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${PRIORITY_COLORS[c.priority]}`}>
            {PRIORITY_LABELS[c.priority]}
          </span>
          {guest?.isVip && (
            <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded font-medium">
              VIP
            </span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status]}`}>
          {STATUS_LABELS[c.status]}
        </span>
      </div>

      <p className="font-bold text-iron-text text-sm mb-1">{guestName}</p>

      <p className="text-iron-muted text-xs line-clamp-2 mb-3 leading-relaxed">
        {c.description}
      </p>

      <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-iron-muted">
        <div className="flex items-center gap-3">
          {c.assignedTo && (
            <span className="flex items-center gap-1">
              <span>👤</span>
              <span>{c.assignedTo}</span>
            </span>
          )}
          {c.dueDate && (
            <span className="flex items-center gap-1">
              <span>📅</span>
              <span>{fmtDate(c.dueDate)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {guest?.visitCount != null && (
            <span>{guest.visitCount} ביקורים</span>
          )}
          {guest?.phone && (
            <span dir="ltr">{guest.phone}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Action Timeline ──────────────────────────────────────────────────────────

function ActionTimeline({ actions }: { actions: RecoveryAction[] }) {
  if (actions.length === 0) {
    return <p className="text-iron-muted text-sm text-center py-4">אין פעולות עדיין</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {actions.map(a => (
        <div key={a.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full bg-iron-muted mt-1.5 shrink-0" />
            <div className="w-px flex-1 bg-iron-border mt-1" />
          </div>
          <div className="pb-3 flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-medium text-sm text-iron-text">{a.actorName}</span>
              <span className="text-xs text-iron-muted">{fmtDate(a.createdAt)}</span>
            </div>
            <p className="text-sm text-iron-muted leading-relaxed">{a.note}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Case Detail Panel ────────────────────────────────────────────────────────

interface DetailPanelProps {
  c: RecoveryCase;
  actorName: string;
  restaurantId: string;
  onClose: () => void;
  onUpdated: (updated: RecoveryCase) => void;
}

function CaseDetailPanel({ c, actorName, restaurantId, onClose, onUpdated }: DetailPanelProps) {
  const [localCase, setLocalCase] = useState<RecoveryCase>(c);
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [editAssignee, setEditAssignee] = useState(false);
  const [assigneeInput, setAssigneeInput] = useState(c.assignedTo ?? '');
  const [editDue, setEditDue] = useState(false);
  const [dueInput, setDueInput] = useState(c.dueDate ? c.dueDate.slice(0, 10) : '');

  const guest = localCase.guest;
  const guestName = guest ? `${guest.firstName} ${guest.lastName}` : '—';
  const actions = localCase.actions ?? [];

  async function changeStatus(newStatus: RecoveryStatus) {
    setUpdatingStatus(true);
    try {
      const updated = await api.recovery.updateCase(restaurantId, localCase.id, { status: newStatus });
      const merged = { ...updated, actions: localCase.actions, guest: localCase.guest, reservation: localCase.reservation };
      setLocalCase(merged);
      onUpdated(merged);
    } catch {
      // silent
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function saveAssignee() {
    try {
      const updated = await api.recovery.updateCase(restaurantId, localCase.id, { assignedTo: assigneeInput || null });
      const merged = { ...updated, actions: localCase.actions, guest: localCase.guest, reservation: localCase.reservation };
      setLocalCase(merged);
      onUpdated(merged);
    } catch {
      // silent
    } finally {
      setEditAssignee(false);
    }
  }

  async function saveDue() {
    try {
      const updated = await api.recovery.updateCase(restaurantId, localCase.id, { dueDate: dueInput || null });
      const merged = { ...updated, actions: localCase.actions, guest: localCase.guest, reservation: localCase.reservation };
      setLocalCase(merged);
      onUpdated(merged);
    } catch {
      // silent
    } finally {
      setEditDue(false);
    }
  }

  async function submitNote() {
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    try {
      const result = await api.recovery.addAction(restaurantId, localCase.id, { actorName, note: noteText.trim() });
      const merged = {
        ...result.case,
        actions: [...actions, result.action],
        guest: localCase.guest,
        reservation: localCase.reservation,
      };
      setLocalCase(merged);
      onUpdated(merged);
      setNoteText('');
    } catch {
      // silent
    } finally {
      setSubmittingNote(false);
    }
  }

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end"
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* panel */}
      <div className="relative z-10 w-full md:w-[480px] bg-iron-bg border-t md:border-t-0 md:border-r border-iron-border flex flex-col max-h-[90vh] md:max-h-full md:h-full overflow-hidden rounded-t-2xl md:rounded-none shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-iron-border shrink-0">
          <button onClick={onClose} className="text-iron-muted hover:text-iron-text transition-colors text-lg font-bold">✕</button>
          <h2 className="font-bold text-iron-text text-base">פרטי תיק שחזור</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

          {/* Guest strip */}
          <div className="bg-iron-surface rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-iron-card flex items-center justify-center text-lg font-bold text-iron-text shrink-0">
                {guest ? guest.firstName[0] : '?'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-iron-text">{guestName}</span>
                  {guest?.isVip && (
                    <span className="text-xs bg-amber-100 text-amber-700 border border-amber-300 px-1.5 py-0.5 rounded font-medium">VIP</span>
                  )}
                </div>
                {guest?.phone && <p dir="ltr" className="text-iron-muted text-sm">{guest.phone}</p>}
              </div>
            </div>
            <div className="flex gap-4 text-sm text-iron-muted">
              <span>{guest?.visitCount ?? 0} ביקורים</span>
              {guest?.vipScore != null && <span>ציון VIP: {guest.vipScore}</span>}
            </div>
          </div>

          {/* Case header */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${PRIORITY_COLORS[localCase.priority]}`}>
                {PRIORITY_LABELS[localCase.priority]}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[localCase.status]}`}>
                {STATUS_LABELS[localCase.status]}
              </span>
            </div>

            <p className="text-iron-text text-sm leading-relaxed">{localCase.description}</p>

            {/* Assignee */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-iron-muted w-20 shrink-0">אחראי:</span>
              {editAssignee ? (
                <div className="flex gap-2 flex-1">
                  <input
                    value={assigneeInput}
                    onChange={e => setAssigneeInput(e.target.value)}
                    className="flex-1 bg-iron-surface border border-iron-border rounded px-2 py-1 text-iron-text text-sm outline-none focus:border-iron-text"
                    placeholder="שם אחראי"
                  />
                  <button onClick={saveAssignee} className="text-iron-green text-sm font-medium">שמור</button>
                  <button onClick={() => setEditAssignee(false)} className="text-iron-muted text-sm">ביטול</button>
                </div>
              ) : (
                <button
                  onClick={() => setEditAssignee(true)}
                  className="text-iron-text hover:underline"
                >
                  {localCase.assignedTo || <span className="text-iron-muted">לא שויך</span>}
                </button>
              )}
            </div>

            {/* Due date */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-iron-muted w-20 shrink-0">תאריך יעד:</span>
              {editDue ? (
                <div className="flex gap-2 flex-1">
                  <input
                    type="date"
                    value={dueInput}
                    onChange={e => setDueInput(e.target.value)}
                    className="flex-1 bg-iron-surface border border-iron-border rounded px-2 py-1 text-iron-text text-sm outline-none focus:border-iron-text"
                  />
                  <button onClick={saveDue} className="text-iron-green text-sm font-medium">שמור</button>
                  <button onClick={() => setEditDue(false)} className="text-iron-muted text-sm">ביטול</button>
                </div>
              ) : (
                <button onClick={() => setEditDue(true)} className="text-iron-text hover:underline">
                  {localCase.dueDate ? fmtDate(localCase.dueDate) : <span className="text-iron-muted">לא נקבע</span>}
                </button>
              )}
            </div>
          </div>

          {/* Status action buttons */}
          <div className="flex gap-2 flex-wrap">
            {localCase.status === 'OPEN' && (
              <button
                disabled={updatingStatus}
                onClick={() => changeStatus('CONTACTED')}
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                סמן בטיפול
              </button>
            )}
            {localCase.status === 'CONTACTED' && (
              <>
                <button
                  disabled={updatingStatus}
                  onClick={() => changeStatus('RESOLVED')}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  סמן נפתר
                </button>
                <button
                  disabled={updatingStatus}
                  onClick={() => changeStatus('OPEN')}
                  className="flex-1 bg-iron-surface hover:bg-iron-card text-iron-text font-medium py-2 px-4 rounded-lg text-sm border border-iron-border transition-colors disabled:opacity-50"
                >
                  החזר לפתוח
                </button>
              </>
            )}
            {localCase.status === 'RESOLVED' && (
              <button
                disabled={updatingStatus}
                onClick={() => changeStatus('OPEN')}
                className="flex-1 bg-iron-surface hover:bg-iron-card text-iron-text font-medium py-2 px-4 rounded-lg text-sm border border-iron-border transition-colors disabled:opacity-50"
              >
                פתח מחדש
              </button>
            )}
          </div>

          {/* Action timeline */}
          <div>
            <h3 className="font-semibold text-iron-text text-sm mb-3">פעולות</h3>
            <ActionTimeline actions={actions} />
          </div>
        </div>

        {/* Add action form */}
        <div className="border-t border-iron-border px-5 py-4 shrink-0 bg-iron-bg">
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="הוסף הערה או פעולה..."
            rows={3}
            className="w-full bg-iron-surface border border-iron-border rounded-lg px-3 py-2 text-sm text-iron-text placeholder:text-iron-muted outline-none focus:border-iron-text resize-none mb-2"
          />
          <button
            disabled={!noteText.trim() || submittingNote}
            onClick={submitNote}
            className="w-full bg-iron-text text-iron-bg font-medium py-2 rounded-lg text-sm transition-colors disabled:opacity-50 hover:opacity-90"
          >
            {submittingNote ? 'שומר...' : 'הוסף פעולה'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function RecoveryWorkspace({ restaurantId, actorName }: Props) {
  const [stats, setStats] = useState<RecoveryStats | null>(null);
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');
  const [selectedCase, setSelectedCase] = useState<RecoveryCase | null>(null);

  const fetchData = useCallback(async (status: FilterStatus) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50', page: '1' };
      if (status !== 'ALL') params['status'] = status;

      const [listResult, statsResult] = await Promise.all([
        api.recovery.list(restaurantId, params),
        api.recovery.stats(restaurantId),
      ]);

      // Fetch full detail for each case (with actions + guest) in parallel, best-effort
      const withDetails = await Promise.all(
        listResult.data.map(c =>
          api.recovery.getCase(restaurantId, c.id).catch(() => c)
        )
      );

      setCases(withDetails);
      setStats(statsResult);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    void fetchData(filterStatus);
  }, [fetchData, filterStatus]);

  function handleFilterChange(s: FilterStatus) {
    setFilterStatus(s);
  }

  function handleCaseUpdated(updated: RecoveryCase) {
    setCases(prev => prev.map(c => c.id === updated.id ? updated : c));
    if (selectedCase?.id === updated.id) {
      setSelectedCase(updated);
    }
    // Refresh stats silently
    api.recovery.stats(restaurantId).then(setStats).catch(() => {});
  }

  return (
    <div dir="rtl" className="flex flex-col h-full">
      <StatsBar stats={stats} />
      <FilterBar active={filterStatus} onChange={handleFilterChange} />

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-iron-surface rounded-xl animate-pulse" />
          ))}
        </div>
      ) : cases.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-iron-muted py-16 gap-2">
          <span className="text-4xl">✅</span>
          <p className="text-base font-medium">אין תיקים {filterStatus !== 'ALL' ? `בסטטוס "${STATUS_LABELS[filterStatus as RecoveryStatus]}"` : 'פתוחים'}</p>
          <p className="text-sm">כל התיקים טופלו</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto pb-4">
          {cases.map(c => (
            <CaseCard
              key={c.id}
              c={c}
              onClick={() => setSelectedCase(c)}
            />
          ))}
        </div>
      )}

      {selectedCase && (
        <CaseDetailPanel
          c={selectedCase}
          actorName={actorName}
          restaurantId={restaurantId}
          onClose={() => setSelectedCase(null)}
          onUpdated={handleCaseUpdated}
        />
      )}
    </div>
  );
}
