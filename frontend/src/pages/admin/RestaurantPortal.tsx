import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../api';
import type { AuthState } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleRow {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  lastSeating: string;
}

interface OnlineRestriction {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  restrictionType: string;
  reason: string | null;
  guestMessage: string | null;
  createdAt: string;
  createdBy: string;
}

interface RestrictionForm {
  date: string;
  fullDay: boolean;
  startTime: string;
  endTime: string;
  reason: string;
  guestMessage: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_SCHEDULE: ScheduleRow[] = [0, 1, 2, 3, 4, 5, 6].map(d => ({
  dayOfWeek: d, isOpen: d !== 0, openTime: '11:00', closeTime: '22:00', lastSeating: '21:00',
}));

const DEFAULT_RESTRICTION_FORM: RestrictionForm = {
  date: '', fullDay: true, startTime: '', endTime: '', reason: '', guestMessage: '',
};

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-iron-muted mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green ${props.className ?? ''}`}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  auth: AuthState;
  onLogout: () => void;
}

export default function RestaurantPortal({ auth, onLogout }: Props) {
  const restaurantId = auth.user.restaurant?.id ?? '';
  const restaurantName = auth.user.restaurant?.name ?? 'My Restaurant';

  // ── Theme ─────────────────────────────────────────────────────────────────

  const [hqTheme, setHqTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('iron_hq_theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = hqTheme;
    document.documentElement.classList.toggle('dark', hqTheme === 'dark');
    localStorage.setItem('iron_hq_theme', hqTheme);
  }, [hqTheme]);

  useEffect(() => {
    return () => {
      const hostTheme = (localStorage.getItem('iron_theme') ?? 'dark') as 'dark' | 'light';
      document.documentElement.dataset.theme = hostTheme;
      document.documentElement.classList.toggle('dark', hostTheme === 'dark');
    };
  }, []);

  // ── Data state ────────────────────────────────────────────────────────────

  const [loading, setLoading] = useState(true);

  // Operating hours
  const [scheduleRows,  setScheduleRows]  = useState<ScheduleRow[]>(DEFAULT_SCHEDULE);
  const [editSchedule,  setEditSchedule]  = useState(false);
  const [scheduleBusy,  setScheduleBusy]  = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Online restrictions
  const [restrictions,          setRestrictions]          = useState<OnlineRestriction[]>([]);
  const [showAddRestriction,    setShowAddRestriction]    = useState(false);
  const [restrictionForm,       setRestrictionForm]       = useState<RestrictionForm>(DEFAULT_RESTRICTION_FORM);
  const [restrictionCreateBusy, setRestrictionCreateBusy] = useState(false);
  const [restrictionError,      setRestrictionError]      = useState<string | null>(null);

  // Portal permissions (from GET /restaurants/:id response)
  const [permissions, setPermissions] = useState<{
    canManageOperatingHours: boolean;
    canManageOnlineRestrictions: boolean;
  } | null>(null);

  // Session / access error (shown instead of content)
  const [sessionError, setSessionError] = useState<'forbidden' | 'not-found' | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  // Re-fetches only permissions — called after a 403 mutation so the section
  // collapses immediately without a full page reload.
  async function refreshPermissions() {
    try {
      const detail = await api.admin.restaurants.get(restaurantId);
      setPermissions(detail.portalPermissions ?? null);
      setEditSchedule(false);
      setShowAddRestriction(false);
    } catch { /* best-effort — full reload will fix any remaining stale state */ }
  }

  const loadData = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setSessionError(null);
    try {
      const [detail, rl] = await Promise.all([
        api.admin.restaurants.get(restaurantId),
        api.admin.restaurants.onlineRestrictions.list(restaurantId).catch(() => [] as OnlineRestriction[]),
      ]);
      setRestrictions(rl);
      setPermissions(detail.portalPermissions ?? null);
      if (detail.operatingHours?.length === 7) {
        setScheduleRows(detail.operatingHours.map(h => ({
          dayOfWeek: h.dayOfWeek, isOpen: h.isOpen,
          openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating,
        })));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setSessionError('forbidden');
        else if (err.status === 404) setSessionError('not-found');
        // 401 is handled globally by api.ts — it clears auth and redirects to login
      }
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSaveSchedule() {
    setScheduleBusy(true);
    setScheduleError(null);
    try {
      const updated = await api.admin.restaurants.updateOperatingHours(restaurantId, scheduleRows);
      setScheduleRows(updated.map(h => ({
        dayOfWeek: h.dayOfWeek, isOpen: h.isOpen,
        openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating,
      })));
      setEditSchedule(false);
      showToast('Schedule saved');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setScheduleError('Access to this tool has been removed. Contact your administrator.');
        refreshPermissions();
      } else {
        setScheduleError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setScheduleBusy(false);
    }
  }

  async function handleCreateRestriction() {
    const f = restrictionForm;
    if (!f.date) { setRestrictionError('Date is required'); return; }
    if (!f.fullDay) {
      if (!f.startTime || !f.endTime) {
        setRestrictionError('Start time and end time are both required for a time-range rule');
        return;
      }
      if (f.startTime >= f.endTime) {
        setRestrictionError('Start time must be before end time');
        return;
      }
    }
    setRestrictionCreateBusy(true);
    setRestrictionError(null);
    try {
      await api.admin.restaurants.onlineRestrictions.create(restaurantId, {
        date:         f.date,
        startTime:    f.fullDay ? null : f.startTime,
        endTime:      f.fullDay ? null : f.endTime,
        reason:       f.reason || null,
        guestMessage: f.guestMessage || null,
      });
      const updated = await api.admin.restaurants.onlineRestrictions.list(restaurantId);
      setRestrictions(updated);
      setShowAddRestriction(false);
      setRestrictionForm(DEFAULT_RESTRICTION_FORM);
      showToast('Restriction added');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setRestrictionError('Access to this tool has been removed. Contact your administrator.');
        refreshPermissions();
      } else {
        setRestrictionError(err instanceof Error ? err.message : 'Failed to add restriction');
      }
    } finally {
      setRestrictionCreateBusy(false);
    }
  }

  async function handleDeleteRestriction(rid: string) {
    try {
      await api.admin.restaurants.onlineRestrictions.delete(restaurantId, rid);
      setRestrictions(r => r.filter(x => x.id !== rid));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        refreshPermissions();
      } else {
        showToast('Failed to delete restriction');
      }
    }
  }

  // ── Button styles ─────────────────────────────────────────────────────────

  const btnPrimary   = 'bg-iron-green hover:bg-iron-green-light text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
  const btnSecondary = 'bg-iron-surface hover:bg-iron-bg text-iron-text font-medium text-sm px-4 py-2 rounded-lg border border-iron-border transition-colors';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-iron-bg flex flex-col overflow-hidden">

      {/* Header */}
      <header className="shrink-0 border-b border-iron-border bg-iron-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-iron-green rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xs tracking-tight">IB</span>
          </div>
          <div>
            <p className="text-iron-text font-semibold text-sm leading-tight">{restaurantName}</p>
            <p className="text-iron-muted text-xs">Restaurant Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-iron-muted text-xs hidden sm:block">
            {auth.user.firstName} {auth.user.lastName}
          </span>
          <button
            onClick={() => setHqTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="text-iron-muted hover:text-iron-text text-xs px-2 py-1 rounded hover:bg-iron-bg transition-colors"
            title="Toggle theme"
          >
            {hqTheme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            onClick={onLogout}
            className="text-iron-muted hover:text-iron-text text-xs px-3 py-1.5 rounded-lg border border-iron-border hover:border-iron-text/30 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sessionError ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-iron-surface border border-iron-border flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-iron-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              {sessionError === 'not-found' ? (
                <>
                  <p className="text-iron-text font-medium mb-1">Restaurant not found</p>
                  <p className="text-iron-muted text-sm">This restaurant may have been removed. Contact Iron Booking support.</p>
                </>
              ) : (
                <>
                  <p className="text-iron-text font-medium mb-1">Access denied</p>
                  <p className="text-iron-muted text-sm">Your account does not have access to this restaurant. Contact Iron Booking support.</p>
                </>
              )}
              <button onClick={onLogout} className="mt-6 text-xs text-iron-muted hover:text-iron-text underline transition-colors">
                Sign out
              </button>
            </div>
          ) : (() => {
            const canHours        = permissions?.canManageOperatingHours     ?? false;
            const canRestrictions = permissions?.canManageOnlineRestrictions ?? false;
            const hasAnyTool      = canHours || canRestrictions;

            if (!hasAnyTool) {
              return (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-12 h-12 rounded-full bg-iron-surface border border-iron-border flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-iron-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <p className="text-iron-text font-medium mb-1">Your portal access is currently limited</p>
                  <p className="text-iron-muted text-sm">Please contact Iron Booking support to enable tools for your restaurant.</p>
                </div>
              );
            }

            return (
            <>
              <p className="text-iron-muted text-sm">Manage the tools Iron has enabled for your restaurant.</p>

              {/* Weekly Schedule */}
              {canHours && (editSchedule ? (
                <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
                  <h3 className="font-medium text-iron-text">Weekly Schedule</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-iron-muted border-b border-iron-border">
                          <th className="pb-2 pr-4 font-normal w-24">Day</th>
                          <th className="pb-2 pr-4 font-normal w-12">Open</th>
                          <th className="pb-2 pr-4 font-normal">Service starts</th>
                          <th className="pb-2 pr-4 font-normal">Closes</th>
                          <th className="pb-2 font-normal">Last seating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleRows.map((row, i) => (
                          <tr key={row.dayOfWeek} className="border-b border-iron-border/20 last:border-0">
                            <td className="py-2 pr-4 text-iron-muted text-xs">{DAY_NAMES[row.dayOfWeek]}</td>
                            <td className="py-2 pr-4">
                              <input
                                type="checkbox"
                                checked={row.isOpen}
                                onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, isOpen: e.target.checked } : r))}
                                className="w-4 h-4 cursor-pointer accent-iron-green"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                type="time"
                                value={row.openTime}
                                disabled={!row.isOpen}
                                onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, openTime: e.target.value } : r))}
                                className="bg-iron-bg border border-iron-border rounded px-2 py-1 text-sm text-iron-text focus:outline-none focus:border-iron-green disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <input
                                type="time"
                                value={row.closeTime}
                                disabled={!row.isOpen}
                                onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, closeTime: e.target.value } : r))}
                                className="bg-iron-bg border border-iron-border rounded px-2 py-1 text-sm text-iron-text focus:outline-none focus:border-iron-green disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="py-2">
                              <input
                                type="time"
                                value={row.lastSeating}
                                disabled={!row.isOpen}
                                onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, lastSeating: e.target.value } : r))}
                                className="bg-iron-bg border border-iron-border rounded px-2 py-1 text-sm text-iron-text focus:outline-none focus:border-iron-green disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-iron-muted">Service starts = first booking slot on the public page. Last seating = last reservation allowed.</p>
                  {scheduleError && <p className="text-xs text-red-400">{scheduleError}</p>}
                  <div className="flex gap-3 pt-1">
                    <button onClick={handleSaveSchedule} disabled={scheduleBusy} className={btnPrimary}>
                      {scheduleBusy ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditSchedule(false); setScheduleError(null); }} className={btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-iron-text">Weekly Schedule</h3>
                    <button onClick={() => setEditSchedule(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">
                      Edit
                    </button>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    {scheduleRows.map(row => (
                      <div key={row.dayOfWeek} className="flex items-baseline gap-3">
                        <span className="text-iron-muted text-xs w-24 shrink-0">{DAY_NAMES[row.dayOfWeek]}</span>
                        {row.isOpen
                          ? <span className="text-iron-text">{row.openTime} – {row.closeTime} <span className="text-iron-muted text-xs">last seating {row.lastSeating}</span></span>
                          : <span className="text-iron-muted italic text-xs">Closed</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Online Booking Restrictions */}
              {canRestrictions && <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium text-iron-text">Online Booking Restrictions</h3>
                  {!showAddRestriction && (
                    <button
                      onClick={() => { setShowAddRestriction(true); setRestrictionError(null); }}
                      className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
                    >+ Add rule</button>
                  )}
                </div>
                <p className="text-[11px] text-iron-muted mb-4">
                  Blocks online guest booking for specific dates or time windows.
                  Staff can still create reservations manually from the dashboard.
                </p>

                {restrictions.length === 0 && !showAddRestriction && (
                  <p className="text-xs text-iron-muted italic">No active restrictions.</p>
                )}

                {restrictions.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {restrictions.map(r => (
                      <div key={r.id} className="flex items-start justify-between gap-3 bg-iron-bg rounded px-3 py-2.5 border border-iron-border/50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-iron-text font-medium">{r.date}</span>
                            <span dir="ltr" className="text-xs text-iron-muted bg-iron-surface px-1.5 py-0.5 rounded">
                              {r.startTime && r.endTime ? `${r.startTime} – ${r.endTime}` : 'Full day'}
                            </span>
                          </div>
                          {r.reason && <p className="text-xs text-iron-muted mt-0.5">{r.reason}</p>}
                          {r.guestMessage && (
                            <p className="text-xs text-iron-muted mt-0.5 italic">"{r.guestMessage}"</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteRestriction(r.id)}
                          className="shrink-0 text-xs text-iron-muted hover:text-red-400 px-1.5 py-1 rounded hover:bg-iron-bg transition-colors"
                          title="Delete restriction"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {showAddRestriction && (
                  <div className="border-t border-iron-border/50 pt-4 mt-2 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Date *">
                        <Input
                          type="date"
                          value={restrictionForm.date}
                          onChange={e => setRestrictionForm(f => ({ ...f, date: e.target.value }))}
                        />
                      </Field>
                      <div className="flex items-center gap-2 pt-5">
                        <input
                          type="checkbox"
                          id="rpFullDay"
                          checked={restrictionForm.fullDay}
                          onChange={e => setRestrictionForm(f => ({ ...f, fullDay: e.target.checked }))}
                          className="w-4 h-4 cursor-pointer accent-iron-green"
                        />
                        <label htmlFor="rpFullDay" className="text-sm text-iron-text cursor-pointer select-none">Full day</label>
                      </div>
                    </div>
                    {!restrictionForm.fullDay && (
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Start time *">
                          <Input
                            type="time"
                            value={restrictionForm.startTime}
                            onChange={e => setRestrictionForm(f => ({ ...f, startTime: e.target.value }))}
                          />
                        </Field>
                        <Field label="End time *">
                          <Input
                            type="time"
                            value={restrictionForm.endTime}
                            onChange={e => setRestrictionForm(f => ({ ...f, endTime: e.target.value }))}
                          />
                        </Field>
                      </div>
                    )}
                    <Field label="Reason (internal — not shown to guests)">
                      <Input
                        value={restrictionForm.reason}
                        onChange={e => setRestrictionForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="Private event, staff training, kitchen closed…"
                      />
                    </Field>
                    <Field label="Guest message (optional — shown in booking widget if set)">
                      <Input
                        value={restrictionForm.guestMessage}
                        maxLength={200}
                        onChange={e => setRestrictionForm(f => ({ ...f, guestMessage: e.target.value }))}
                        placeholder="Online booking unavailable for this date. Please call us to reserve."
                      />
                    </Field>
                    {restrictionError && <p className="text-xs text-red-400">{restrictionError}</p>}
                    <div className="flex gap-3 pt-1">
                      <button onClick={handleCreateRestriction} disabled={restrictionCreateBusy} className={btnPrimary}>
                        {restrictionCreateBusy ? 'Adding…' : 'Add rule'}
                      </button>
                      <button
                        onClick={() => { setShowAddRestriction(false); setRestrictionForm(DEFAULT_RESTRICTION_FORM); setRestrictionError(null); }}
                        className={btnSecondary}
                      >Cancel</button>
                    </div>
                  </div>
                )}
              </div>}
            </>
            );
          })()}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-iron-surface border border-iron-border text-iron-text text-sm px-4 py-2 rounded-lg shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}
