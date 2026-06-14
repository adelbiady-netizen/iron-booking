import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type { ClubMember, ClubStats, PendingApproval, ClubMemberStatus } from '../types';

type Tab = 'members' | 'recovery' | 'approvals' | 'alerts';

const STATUS_LABEL: Record<ClubMemberStatus, string> = {
  ACTIVE: 'פעיל',
  PAUSED: 'מושהה',
  OPTED_OUT: 'יצא',
};
const STATUS_COLOR: Record<ClubMemberStatus, string> = {
  ACTIVE: 'text-green-600 bg-green-50',
  PAUSED: 'text-yellow-600 bg-yellow-50',
  OPTED_OUT: 'text-red-600 bg-red-50',
};

const SOURCE_LABEL: Record<string, string> = {
  HOST_STAFF: 'צוות',
  RESERVATION_LINK: 'הזמנה',
  FEEDBACK_FLOW: 'משוב',
  QR_CODE: 'QR',
  WEBSITE: 'אתר',
  IMPORT: 'ייבוא',
  MANUAL: 'ידני',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMonthDay(mmdd: string | null | undefined): string {
  if (!mmdd) return '—';
  const [m, d] = mmdd.split('-');
  return `${d}/${m}`;
}

interface Props {
  restaurantId: string;
  onBack: () => void;
}

export default function ClubCenterPage({ restaurantId, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('members');
  const [stats, setStats] = useState<ClubStats | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ClubMember | null>(null);
  const LIMIT = 30;

  const loadStats = useCallback(async () => {
    try { setStats(await api.club.stats(restaurantId)); } catch { /* ignore */ }
  }, [restaurantId]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.club.members(restaurantId, {
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        limit: LIMIT,
      });
      setMembers(res.data);
      setTotal(res.meta.total);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [restaurantId, search, statusFilter, page]);

  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try { setApprovals(await api.club.pendingApprovals(restaurantId)); }
    catch { /* ignore */ }
    finally { setApprovalsLoading(false); }
  }, [restaurantId]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === 'members') loadMembers(); }, [tab, loadMembers]);
  useEffect(() => { if (tab === 'approvals') loadApprovals(); }, [tab, loadApprovals]);

  const totalPages = Math.ceil(total / LIMIT);

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'members',   label: 'חברים', badge: stats?.active },
    { id: 'approvals', label: 'ממתינים לאישור', badge: approvals.length || undefined },
    { id: 'recovery',  label: 'שחזור' },
    { id: 'alerts',    label: 'התראות' },
  ];

  return (
    <div className="min-h-screen bg-iron-bg text-iron-text" dir="rtl">
      {/* Header */}
      <div className="bg-iron-surface border-b border-iron-border px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-iron-card text-iron-muted">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">♦</span>
            <h1 className="font-bold text-lg">IRON CLUB</h1>
          </div>
          <p className="text-xs text-iron-muted">מרכז ניהול חברות</p>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="flex gap-3 px-4 py-3 border-b border-iron-border bg-iron-surface overflow-x-auto">
          {[
            { label: 'סה"כ חברים', value: stats.total, color: 'text-iron-text' },
            { label: 'פעילים', value: stats.active, color: 'text-green-600' },
            { label: 'הושהו', value: stats.paused, color: 'text-yellow-600' },
            { label: 'יצאו', value: stats.optedOut, color: 'text-red-600' },
          ].map(s => (
            <div key={s.label} className="flex-shrink-0 rounded-xl bg-iron-card border border-iron-border/40 px-4 py-2 text-center">
              <div className={`text-xl font-black tabular-nums ${s.color}`}>{s.value}</div>
              <div className="text-[10px] text-iron-muted/60 uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-iron-border bg-iron-surface px-4">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors relative flex items-center gap-1.5 ${
              tab === t.id
                ? 'border-iron-green text-iron-green'
                : 'border-transparent text-iron-muted hover:text-iron-text'
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="bg-iron-green text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Members tab */}
      {tab === 'members' && (
        <div className="p-4 space-y-3">
          {/* Filters */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="חיפוש לפי שם, טלפון..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="flex-1 text-sm bg-iron-card border border-iron-border rounded-xl px-3 py-2 text-iron-text placeholder-iron-muted/50 focus:outline-none focus:border-iron-green/60"
            />
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="text-sm bg-iron-card border border-iron-border rounded-xl px-3 py-2 text-iron-text"
            >
              <option value="">כל הסטטוסים</option>
              <option value="ACTIVE">פעיל</option>
              <option value="PAUSED">מושהה</option>
              <option value="OPTED_OUT">יצא</option>
            </select>
          </div>

          {/* List */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-iron-border border-t-iron-green rounded-full animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12 text-iron-muted/50 text-sm">
              {search || statusFilter ? 'לא נמצאו חברים התואמים לחיפוש' : 'אין חברי קלאב עדיין'}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {members.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMember(m)}
                    className="w-full bg-iron-card border border-iron-border/40 rounded-xl p-3 text-right hover:border-iron-green/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-iron-text">
                            {m.guest?.firstName} {m.guest?.lastName}
                          </span>
                          {m.guest?.isVip && (
                            <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5 font-semibold">VIP</span>
                          )}
                          <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${STATUS_COLOR[m.status]}`}>
                            {STATUS_LABEL[m.status]}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {m.guest?.phone && (
                            <span className="text-xs text-iron-muted">{m.guest.phone}</span>
                          )}
                          <span className="text-xs text-iron-muted/50">
                            {m.guest?.visitCount ?? 0} ביקורים
                          </span>
                          {m.guest?.lastVisitAt && (
                            <span className="text-xs text-iron-muted/50">ביקור אחרון: {fmtDate(m.guest.lastVisitAt)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-left flex-shrink-0 space-y-1">
                        <div className="text-[10px] text-iron-muted/50">
                          {SOURCE_LABEL[m.source] ?? m.source}
                        </div>
                        <div className="text-[10px] text-iron-muted/50">
                          {fmtDate(m.joinDate)}
                        </div>
                        {m.birthday && (
                          <div className="text-[10px] text-iron-muted/50">🎂 {fmtMonthDay(m.birthday)}</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-sm text-iron-muted disabled:opacity-40 px-3 py-1.5 rounded-lg hover:bg-iron-card"
                  >
                    הקודם
                  </button>
                  <span className="text-xs text-iron-muted">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-sm text-iron-muted disabled:opacity-40 px-3 py-1.5 rounded-lg hover:bg-iron-card"
                  >
                    הבא
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Approvals tab */}
      {tab === 'approvals' && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-iron-muted">הודעות SMS ממתינות לאישורך לפני שליחה לאורחים.</p>
          {approvalsLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-iron-border border-t-iron-green rounded-full animate-spin" />
            </div>
          ) : approvals.length === 0 ? (
            <div className="text-center py-12 text-iron-muted/50 text-sm">אין הודעות ממתינות לאישור</div>
          ) : (
            <div className="space-y-2">
              {approvals.map(a => (
                <div key={a.id} className="bg-iron-card border border-iron-border/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{a.guest?.firstName} {a.guest?.lastName}</p>
                      <p className="text-xs text-iron-muted">{a.guest?.phone}</p>
                    </div>
                    <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5 font-semibold">
                      {a.type === 'FEEDBACK_REQUEST' ? 'בקשת משוב' : a.type}
                    </span>
                  </div>
                  <div className="bg-iron-surface rounded-lg px-3 py-2 text-sm text-iron-text/80 leading-relaxed">
                    {a.draftMessage}
                  </div>
                  <p className="text-[10px] text-iron-muted/50">
                    נוצר: {fmtDate(a.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recovery tab — placeholder for Phase 2 */}
      {tab === 'recovery' && (
        <div className="p-4">
          <div className="text-center py-16 text-iron-muted/40">
            <p className="text-3xl mb-3">🔧</p>
            <p className="text-sm font-medium">ניהול שחזור</p>
            <p className="text-xs mt-1">זמין בגרסה הבאה</p>
          </div>
        </div>
      )}

      {/* Alerts tab — placeholder for Phase 2 */}
      {tab === 'alerts' && (
        <div className="p-4">
          <div className="text-center py-16 text-iron-muted/40">
            <p className="text-3xl mb-3">🔔</p>
            <p className="text-sm font-medium">התראות קלאב</p>
            <p className="text-xs mt-1">זמין בגרסה הבאה</p>
          </div>
        </div>
      )}

      {/* Member detail drawer */}
      {selectedMember && (
        <MemberDetail
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          onUpdate={async (patch) => {
            try {
              const updated = await api.club.updateMember(restaurantId, selectedMember.id, patch);
              setSelectedMember(updated);
              setMembers(prev => prev.map(m => m.id === updated.id ? updated : m));
              loadStats();
            } catch { /* ignore */ }
          }}
        />
      )}
    </div>
  );
}

// ── Member Detail Panel ────────────────────────────────────────────────────────

function MemberDetail({
  member,
  onClose,
  onUpdate,
}: {
  member: ClubMember;
  onClose: () => void;
  onUpdate: (patch: Partial<{ status: ClubMemberStatus; smsConsent: boolean; marketingConsent: boolean; notes: string | null }>) => void;
}) {
  const g = member.guest;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-iron-surface rounded-t-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        <div className="px-4 py-3 border-b border-iron-border flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base">{g?.firstName} {g?.lastName}</h2>
            <p className="text-xs text-iron-muted">{g?.phone ?? '—'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-iron-card text-iron-muted text-xl leading-none">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Status */}
          <div>
            <p className="text-xs text-iron-muted mb-1.5">סטטוס חברות</p>
            <div className="flex gap-2">
              {(['ACTIVE', 'PAUSED', 'OPTED_OUT'] as ClubMemberStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => onUpdate({ status: s })}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    member.status === s
                      ? STATUS_COLOR[s] + ' border-current'
                      : 'text-iron-muted border-iron-border hover:border-iron-text/30'
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Consent */}
          <div>
            <p className="text-xs text-iron-muted mb-1.5">הסכמות</p>
            <div className="space-y-2">
              {([
                { key: 'smsConsent', label: 'SMS' },
                { key: 'marketingConsent', label: 'שיווק' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-iron-green"
                    checked={!!(member as unknown as Record<string, unknown>)[key]}
                    onChange={e => onUpdate({ [key]: e.target.checked } as Parameters<typeof onUpdate>[0])}
                  />
                  <span className="text-sm text-iron-text">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-3 flex-wrap">
            <Chip label="ביקורים" value={String(g?.visitCount ?? 0)} />
            {g?.vipScore != null && <Chip label="VIP" value={String(g.vipScore)} accent />}
            {member.birthday && <Chip label="יום הולדת" value={fmtMonthDay(member.birthday)} />}
            {member.anniversary && <Chip label="יום נישואין" value={fmtMonthDay(member.anniversary)} />}
          </div>

          {/* Join info */}
          <div className="text-xs text-iron-muted/60 space-y-0.5">
            <p>הצטרף: {new Date(member.joinDate).toLocaleDateString('he-IL')}</p>
            <p>מקור: {SOURCE_LABEL[member.source] ?? member.source}</p>
          </div>

          {member.notes && (
            <div className="bg-iron-card rounded-xl px-3 py-2 text-sm text-iron-text/70">
              {member.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-iron-card border border-iron-border/40 px-3 py-2 text-center">
      <div className={`text-base font-black tabular-nums ${accent ? 'text-yellow-500' : 'text-iron-text'}`}>{value}</div>
      <div className="text-[9px] text-iron-muted/50 uppercase tracking-wider">{label}</div>
    </div>
  );
}
