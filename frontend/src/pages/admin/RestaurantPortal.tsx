import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../api';
import type { GroupConfig, GroupConfigSection, GroupConfigBody } from '../../api';
import type { AuthState } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'dashboard' | 'guest-experience' | 'operations' | 'marketing' | 'settings';

interface ScheduleRow {
  dayOfWeek: number; isOpen: boolean;
  openTime: string; closeTime: string; lastSeating: string;
}

interface OnlineRestriction {
  id: string; date: string;
  startTime: string | null; endTime: string | null;
  restrictionType: string; reason: string | null; guestMessage: string | null;
  createdAt: string; createdBy: string;
}

interface RestrictionForm {
  date: string; fullDay: boolean; startTime: string; endTime: string;
  reason: string; guestMessage: string;
}

interface DashData {
  todayCount: number | null;
  tomorrowCount: number | null;
  hubStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE' | null;
  hubSlug: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_SCHEDULE: ScheduleRow[] = [0, 1, 2, 3, 4, 5, 6].map(d => ({
  dayOfWeek: d, isOpen: d !== 0, openTime: '11:00', closeTime: '22:00', lastSeating: '21:00',
}));

const DEFAULT_RESTRICTION_FORM: RestrictionForm = {
  date: '', fullDay: true, startTime: '', endTime: '', reason: '', guestMessage: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeHoursStatus(rows: ScheduleRow[]): { label: string; open: boolean } {
  const now = new Date();
  const row = rows.find(r => r.dayOfWeek === now.getDay());
  if (!row || !row.isOpen) return { label: 'Closed today', open: false };
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hm < row.openTime)  return { label: `Opens ${row.openTime}`, open: false };
  if (hm > row.closeTime) return { label: 'Closed for the day', open: false };
  return { label: `Closes ${row.closeTime}`, open: true };
}

function greeting(firstName: string): string {
  const h = new Date().getHours();
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return firstName ? `Good ${time}, ${firstName}` : `Good ${time}`;
}

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

// ─── Icons ────────────────────────────────────────────────────────────────────

function IcoGrid({ s = 18 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>;
}

function IcoStar({ s = 18 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>;
}

function IcoClock({ s = 18 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" />
  </svg>;
}

function IcoChart({ s = 18 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>;
}

function IcoSliders({ s = 18 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
  </svg>;
}

// ─── Nav definition ───────────────────────────────────────────────────────────

type NavItem = { id: Section; label: string; short: string; Icon: React.FC<{ s?: number }> };

const NAV: NavItem[] = [
  { id: 'dashboard',        label: 'Dashboard',        short: 'Home',  Icon: IcoGrid    },
  { id: 'guest-experience', label: 'Guest Experience', short: 'Guests',Icon: IcoStar    },
  { id: 'operations',       label: 'Operations',       short: 'Ops',   Icon: IcoClock   },
  { id: 'marketing',        label: 'Marketing',        short: 'Market',Icon: IcoChart   },
  { id: 'settings',         label: 'Settings',         short: 'More',  Icon: IcoSliders },
];

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  auth: AuthState;
  onLogout: () => void;
  /** When provided (SUPER_ADMIN managing a specific restaurant), overrides
   *  auth.user.restaurant. Restaurant-bound users (RESTAURANT_ADMIN) leave
   *  this undefined and the component falls back to auth.user.restaurant. */
  managedRestaurantId?: string;
}

export default function RestaurantPortal({ auth, onLogout, managedRestaurantId }: Props) {
  const restaurantId = managedRestaurantId ?? auth.user.restaurant?.id ?? '';

  // ── Active section ────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  // Loaded from the API on first data fetch — overrides auth.user.restaurant.name
  // so SUPER_ADMIN managing a different restaurant sees the correct name.
  const [loadedRestaurantName, setLoadedRestaurantName] = useState<string | null>(null);
  const restaurantName = loadedRestaurantName ?? auth.user.restaurant?.name ?? 'My Restaurant';

  // ── Theme ─────────────────────────────────────────────────────────────────
  const [hqTheme, setHqTheme] = useState<'dark' | 'light'>(() => {
    const s = localStorage.getItem('iron_hq_theme');
    return s === 'light' ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = hqTheme;
    document.documentElement.classList.toggle('dark', hqTheme === 'dark');
    localStorage.setItem('iron_hq_theme', hqTheme);
  }, [hqTheme]);
  useEffect(() => {
    return () => {
      const t = (localStorage.getItem('iron_theme') ?? 'dark') as 'dark' | 'light';
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    };
  }, []);

  // ── Data state ────────────────────────────────────────────────────────────
  const [loading,      setLoading]      = useState(true);
  const [sessionError, setSessionError] = useState<'forbidden' | 'not-found' | null>(null);
  const [toast,        setToast]        = useState<string | null>(null);

  const [dashData, setDashData] = useState<DashData>({
    todayCount: null, tomorrowCount: null, hubStatus: null, hubSlug: null,
  });

  const [scheduleRows,  setScheduleRows]  = useState<ScheduleRow[]>(DEFAULT_SCHEDULE);
  const [editSchedule,  setEditSchedule]  = useState(false);
  const [scheduleBusy,  setScheduleBusy]  = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [restrictions,          setRestrictions]          = useState<OnlineRestriction[]>([]);
  const [showAddRestriction,    setShowAddRestriction]    = useState(false);
  const [restrictionForm,       setRestrictionForm]       = useState<RestrictionForm>(DEFAULT_RESTRICTION_FORM);
  const [restrictionCreateBusy, setRestrictionCreateBusy] = useState(false);
  const [restrictionError,      setRestrictionError]      = useState<string | null>(null);

  const [permissions, setPermissions] = useState<{
    canManageOperatingHours: boolean;
    canManageOnlineRestrictions: boolean;
  } | null>(null);

  // ── Group Allocation Rules state ──────────────────────────────────────────
  const isSuperAdmin = auth.user.role === 'SUPER_ADMIN';
  const [groupConfigs,        setGroupConfigs]        = useState<GroupConfig[]>([]);
  const [gcSections,          setGcSections]          = useState<GroupConfigSection[]>([]);
  const [gcLoading,           setGcLoading]           = useState(false);
  const [gcEditId,            setGcEditId]            = useState<string | 'new' | null>(null);
  const [gcForm,              setGcForm]              = useState<GroupConfigBody>({
    name: '', partySizeMin: 1, partySizeMax: 2, allocationMode: 'SINGLE', tableCount: 1, isActive: false,
  });
  const [gcBusy,              setGcBusy]              = useState(false);
  const [gcError,             setGcError]             = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadGroupConfigs() {
    if (!restaurantId || !isSuperAdmin) return;
    setGcLoading(true);
    try {
      const d = await api.admin.restaurants.groupConfigs.list(restaurantId);
      setGroupConfigs(d.configs);
      setGcSections(d.sections);
    } catch { /* best-effort */ }
    finally { setGcLoading(false); }
  }

  async function refreshPermissions() {
    try {
      const d = await api.admin.restaurants.get(restaurantId);
      setPermissions(d.portalPermissions ?? null);
      setEditSchedule(false);
      setShowAddRestriction(false);
    } catch { /* best-effort */ }
  }

  const loadData = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setSessionError(null);
    try {
      const today    = new Date();
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      const [detail, rl, todayRes, tomorrowRes, hub] = await Promise.all([
        api.admin.restaurants.get(restaurantId),
        api.admin.restaurants.onlineRestrictions.list(restaurantId).catch(() => [] as OnlineRestriction[]),
        api.reservations.list({ date: fmtLocalDate(today),    limit: '1' }).catch(() => null),
        api.reservations.list({ date: fmtLocalDate(tomorrow), limit: '1' }).catch(() => null),
        api.admin.guestHub.get(restaurantId).catch(() => null),
      ]);
      setLoadedRestaurantName(detail.name ?? null);
      setRestrictions(rl);
      setPermissions(detail.portalPermissions ?? null);
      if (detail.operatingHours?.length === 7) {
        setScheduleRows(detail.operatingHours.map(h => ({
          dayOfWeek: h.dayOfWeek, isOpen: h.isOpen,
          openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating,
        })));
      }
      setDashData({
        todayCount:    todayRes?.meta.total    ?? null,
        tomorrowCount: tomorrowRes?.meta.total ?? null,
        hubStatus:     hub?.publicStatus       ?? null,
        hubSlug:       hub?.slug               ?? null,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setSessionError('forbidden');
        else if (err.status === 404) setSessionError('not-found');
      }
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (activeSection === 'operations') loadGroupConfigs(); }, [activeSection, restaurantId]);

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
        reason:       f.reason       || null,
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

  // ── Group config handlers ─────────────────────────────────────────────────

  function openNewConfig() {
    setGcForm({ name: '', partySizeMin: 1, partySizeMax: 2, allocationMode: 'SINGLE', tableCount: 1, isActive: false });
    setGcError(null);
    setGcEditId('new');
  }

  function openEditConfig(c: GroupConfig) {
    setGcForm({
      name: c.name, description: c.description ?? '', partySizeMin: c.partySizeMin,
      partySizeMax: c.partySizeMax, targetSectionId: c.targetSectionId,
      allocationMode: c.allocationMode, tableCount: c.tableCount,
      isActive: c.isActive, sortOrder: c.sortOrder,
    });
    setGcError(null);
    setGcEditId(c.id);
  }

  async function handleSaveConfig() {
    setGcBusy(true); setGcError(null);
    try {
      if (gcEditId === 'new') {
        const created = await api.admin.restaurants.groupConfigs.create(restaurantId, gcForm);
        setGroupConfigs(cs => [...cs, created]);
      } else if (gcEditId) {
        const updated = await api.admin.restaurants.groupConfigs.update(restaurantId, gcEditId, gcForm);
        setGroupConfigs(cs => cs.map(c => c.id === gcEditId ? updated : c));
      }
      setGcEditId(null);
      showToast('נשמר בהצלחה');
    } catch (err) {
      setGcError(err instanceof ApiError ? err.message : 'שגיאה בשמירה');
    } finally { setGcBusy(false); }
  }

  async function handleToggleConfig(c: GroupConfig) {
    try {
      const updated = await api.admin.restaurants.groupConfigs.update(restaurantId, c.id, { isActive: !c.isActive });
      setGroupConfigs(cs => cs.map(x => x.id === c.id ? updated : x));
    } catch { showToast('שגיאה בעדכון'); }
  }

  async function handleDeleteConfig(c: GroupConfig) {
    if (!confirm(`למחוק את הכלל "${c.name}"?`)) return;
    try {
      await api.admin.restaurants.groupConfigs.delete(restaurantId, c.id);
      setGroupConfigs(cs => cs.filter(x => x.id !== c.id));
      if (gcEditId === c.id) setGcEditId(null);
      showToast('הכלל נמחק');
    } catch { showToast('שגיאה במחיקה'); }
  }

  // ── Button styles ─────────────────────────────────────────────────────────
  const btnPrimary   = 'bg-iron-green hover:bg-iron-green-light text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
  const btnSecondary = 'bg-iron-surface hover:bg-iron-bg text-iron-text font-medium text-sm px-4 py-2 rounded-lg border border-iron-border transition-colors';

  // ── Section renders ───────────────────────────────────────────────────────

  function renderDashboard() {
    const hours = computeHoursStatus(scheduleRows);

    const hubLabel = dashData.hubStatus === 'PUBLISHED' ? 'Live'
                   : dashData.hubStatus === 'DRAFT'     ? 'Draft'
                   : dashData.hubStatus === 'INACTIVE'  ? 'Inactive'
                   : 'Not set up';
    const hubColor = dashData.hubStatus === 'PUBLISHED' ? 'text-iron-green'
                   : dashData.hubStatus === 'DRAFT'     ? 'text-status-warning'
                   : 'text-iron-muted';

    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="text-iron-text font-semibold text-lg leading-tight mb-1">
          {greeting(auth.user.firstName ?? '')}
        </h2>
        <p className="text-iron-muted text-sm mb-7">Here's what's happening today.</p>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-7">

          <div className="bg-iron-surface border border-iron-border rounded-xl p-4">
            <p className="text-iron-muted text-xs mb-2">Today</p>
            <p className="text-iron-text text-3xl font-bold leading-none mb-1 tabular-nums">
              {dashData.todayCount ?? '—'}
            </p>
            <p className="text-iron-muted text-xs">reservations</p>
          </div>

          <div className="bg-iron-surface border border-iron-border rounded-xl p-4">
            <p className="text-iron-muted text-xs mb-2">Tomorrow</p>
            <p className="text-iron-text text-3xl font-bold leading-none mb-1 tabular-nums">
              {dashData.tomorrowCount ?? '—'}
            </p>
            <p className="text-iron-muted text-xs">reservations</p>
          </div>

          <div className="bg-iron-surface border border-iron-border rounded-xl p-4">
            <p className="text-iron-muted text-xs mb-2">Guest Hub</p>
            <p className={`text-base font-semibold leading-tight mb-1 ${hubColor}`}>{hubLabel}</p>
            {dashData.hubStatus === 'PUBLISHED' && dashData.hubSlug && (
              <a
                href={`/hub/${dashData.hubSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-iron-muted hover:text-iron-text underline transition-colors"
              >View page ↗</a>
            )}
          </div>

          <div className="bg-iron-surface border border-iron-border rounded-xl p-4">
            <p className="text-iron-muted text-xs mb-2">Hours</p>
            <p className={`text-base font-semibold leading-tight mb-1 ${hours.open ? 'text-iron-green' : 'text-iron-text'}`}>
              {hours.open ? 'Open now' : 'Closed'}
            </p>
            <p className="text-iron-muted text-xs">{hours.label}</p>
          </div>
        </div>

        {/* Quick actions */}
        <p className="text-iron-muted text-xs uppercase tracking-wider mb-3">Quick actions</p>
        <div className="space-y-2">

          {dashData.hubSlug ? (
            <a
              href={`/hub/${dashData.hubSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between w-full bg-iron-surface hover:bg-iron-surface/80 border border-iron-border rounded-xl px-4 py-3 text-iron-text text-sm transition-colors"
            >
              <span>View my page</span>
              <span className="text-iron-muted">↗</span>
            </a>
          ) : (
            <div className="flex items-center justify-between w-full bg-iron-surface border border-iron-border rounded-xl px-4 py-3 text-iron-muted text-sm cursor-not-allowed">
              <span>View my page</span>
              <span className="text-xs">Hub not set up</span>
            </div>
          )}

          <button
            onClick={() => setActiveSection('guest-experience')}
            className="flex items-center justify-between w-full bg-iron-surface hover:bg-iron-surface/80 border border-iron-border rounded-xl px-4 py-3 text-iron-text text-sm transition-colors text-left"
          >
            <span>Edit menu</span>
            <span className="text-iron-muted">→</span>
          </button>

          <button
            onClick={() => setActiveSection('guest-experience')}
            className="flex items-center justify-between w-full bg-iron-surface hover:bg-iron-surface/80 border border-iron-border rounded-xl px-4 py-3 text-iron-text text-sm transition-colors text-left"
          >
            <span>Add promotion</span>
            <span className="text-iron-muted">→</span>
          </button>
        </div>
      </div>
    );
  }

  function renderGuestExperience() {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="text-iron-text font-semibold text-lg mb-1">Guest Experience</h2>
        <p className="text-iron-muted text-sm mb-7">Manage your guest-facing hub, menus, and promotions.</p>
        <div className="space-y-3">
          {(['Menus & Dishes', 'Promotions', 'Events', 'Branding'] as const).map(item => (
            <div key={item} className="bg-iron-surface border border-iron-border rounded-xl px-4 py-4 flex items-center justify-between">
              <span className="text-iron-text text-sm font-medium">{item}</span>
              <span className="text-iron-muted text-xs bg-iron-bg border border-iron-border rounded px-2 py-0.5">Coming soon</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderGroupConfigs() {
    // Validation helpers for the form
    const formSection = gcSections.find(s => s.id === gcForm.targetSectionId);
    const needsCombo  = gcForm.allocationMode === 'COMBINATION';
    const hasCombo    = formSection?.hasCombinations ?? false;
    const canActivate = !needsCombo || hasCombo;

    return (
      <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-iron-text">הגדרות הקצאה לקבוצות גדולות</h3>
          {gcEditId === null && (
            <button onClick={openNewConfig} className="text-xs text-iron-green hover:underline font-medium">
              + כלל חדש
            </button>
          )}
        </div>

        {gcLoading && <p className="text-iron-muted text-sm">טוען…</p>}

        {/* Rule list */}
        {!gcLoading && gcEditId === null && (
          groupConfigs.length === 0
            ? <p className="text-iron-muted text-sm">אין כללים מוגדרים.</p>
            : <div className="space-y-2">
                {groupConfigs.map(c => {
                  const sec = gcSections.find(s => s.id === c.targetSectionId);
                  const comboOk = c.allocationMode !== 'COMBINATION' || (sec?.hasCombinations ?? false);
                  return (
                    <div key={c.id}
                      className="flex items-start justify-between gap-3 bg-iron-bg border border-iron-border rounded-lg px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-iron-text text-sm font-medium">{c.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.isActive ? 'bg-iron-green/15 text-iron-green' : 'bg-iron-surface border border-iron-border text-iron-muted'}`}>
                            {c.isActive ? 'פעיל' : 'לא פעיל'}
                          </span>
                          {c.isActive && !comboOk && (
                            <span className="text-xs text-status-warning">⚠ אין שילוב שולחנות</span>
                          )}
                        </div>
                        <p className="text-iron-muted text-xs mt-0.5">
                          {c.partySizeMin}–{c.partySizeMax} סועדים
                          {sec ? ` · ${sec.name}` : ''}
                          {' · '}{c.allocationMode === 'COMBINATION' ? `שילוב ${c.tableCount} שולחנות` : 'שולחן בודד'}
                        </p>
                        {c.description && <p className="text-iron-muted text-xs mt-0.5 truncate">{c.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleToggleConfig(c)}
                          disabled={!c.isActive && !canActivate && !(gcSections.find(s => s.id === c.targetSectionId)?.hasCombinations ?? true)}
                          title={c.isActive ? 'השבת' : 'הפעל'}
                          className={`w-9 h-5 rounded-full transition-colors relative ${c.isActive ? 'bg-iron-green' : 'bg-iron-border'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${c.isActive ? 'right-0.5' : 'left-0.5'}`} />
                        </button>
                        <button onClick={() => openEditConfig(c)} className="text-iron-muted hover:text-iron-text text-xs">עריכה</button>
                        <button onClick={() => handleDeleteConfig(c)} className="text-iron-muted hover:text-status-danger text-xs">מחק</button>
                      </div>
                    </div>
                  );
                })}
              </div>
        )}

        {/* Create / Edit form */}
        {gcEditId !== null && (
          <div className="space-y-4 pt-1">
            <h4 className="text-sm font-medium text-iron-text">{gcEditId === 'new' ? 'כלל חדש' : 'עריכת כלל'}</h4>

            {/* Name */}
            <div>
              <label className="block text-xs text-iron-muted mb-1">שם הכלל *</label>
              <input value={gcForm.name} onChange={e => setGcForm(f => ({ ...f, name: e.target.value }))}
                placeholder='לדוגמה: קבוצות גדולות — ספות'
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-iron-muted mb-1">הערה פנימית (אופציונלי)</label>
              <input value={gcForm.description ?? ''} onChange={e => setGcForm(f => ({ ...f, description: e.target.value }))}
                placeholder="הערה לצוות"
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              />
            </div>

            {/* Party size */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-iron-muted mb-1">מינימום סועדים *</label>
                <input type="number" min={1} max={50} value={gcForm.partySizeMin}
                  onChange={e => setGcForm(f => ({ ...f, partySizeMin: +e.target.value }))}
                  className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
                />
              </div>
              <div>
                <label className="block text-xs text-iron-muted mb-1">מקסימום סועדים *</label>
                <input type="number" min={1} max={50} value={gcForm.partySizeMax}
                  onChange={e => setGcForm(f => ({ ...f, partySizeMax: +e.target.value }))}
                  className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
                />
              </div>
            </div>

            {/* Section */}
            <div>
              <label className="block text-xs text-iron-muted mb-1">אזור יעד (אופציונלי)</label>
              <select value={gcForm.targetSectionId ?? ''}
                onChange={e => setGcForm(f => ({ ...f, targetSectionId: e.target.value || null }))}
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              >
                <option value="">— כל אזור —</option>
                {gcSections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.hasCombinations ? '' : ' (ללא שילוב שולחנות)'}</option>
                ))}
              </select>
            </div>

            {/* Allocation mode */}
            <div>
              <label className="block text-xs text-iron-muted mb-2">סוג הקצאה *</label>
              <div className="flex gap-2">
                {(['SINGLE', 'COMBINATION'] as const).map(mode => (
                  <button key={mode} type="button"
                    onClick={() => setGcForm(f => ({ ...f, allocationMode: mode, tableCount: mode === 'COMBINATION' ? 2 : 1 }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${gcForm.allocationMode === mode ? 'bg-iron-green text-white border-iron-green' : 'bg-iron-bg text-iron-muted border-iron-border hover:border-iron-text'}`}
                  >
                    {mode === 'SINGLE' ? 'שולחן בודד' : `שילוב שולחנות`}
                  </button>
                ))}
              </div>
            </div>

            {/* Table count — only for COMBINATION */}
            {gcForm.allocationMode === 'COMBINATION' && (
              <div>
                <label className="block text-xs text-iron-muted mb-1">מספר שולחנות לשילוב</label>
                <input type="number" min={2} max={2} value={gcForm.tableCount}
                  onChange={e => setGcForm(f => ({ ...f, tableCount: +e.target.value }))}
                  className="w-24 bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
                />
                <p className="text-iron-muted text-xs mt-1">גרסה 1 תומכת בשילוב 2 שולחנות בלבד.</p>
              </div>
            )}

            {/* COMBINATION warning — no combos in selected section */}
            {needsCombo && formSection && !hasCombo && (
              <div className="flex gap-2 items-start bg-status-warning/10 border border-status-warning/40 rounded-lg px-3 py-2.5">
                <span className="text-status-warning text-sm mt-0.5">⚠</span>
                <p className="text-status-warning text-xs leading-relaxed">
                  אין שילוב שולחנות מוגדר באזור <strong>{formSection.name}</strong>.
                  יש להגדיר שילוב שולחנות בפלאג׳ אחיזת השולחן לפני הפעלת הכלל.
                  ניתן לשמור כלל לא פעיל עכשיו.
                </p>
              </div>
            )}

            {/* Active toggle */}
            <div className="flex items-center gap-3">
              <button type="button"
                onClick={() => setGcForm(f => ({ ...f, isActive: !f.isActive }))}
                disabled={!gcForm.isActive && needsCombo && formSection != null && !hasCombo}
                title={!canActivate && needsCombo ? 'לא ניתן להפעיל — אין שילוב שולחנות' : undefined}
                className={`w-9 h-5 rounded-full transition-colors relative disabled:opacity-40 ${gcForm.isActive ? 'bg-iron-green' : 'bg-iron-border'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${gcForm.isActive ? 'right-0.5' : 'left-0.5'}`} />
              </button>
              <span className="text-sm text-iron-text">{gcForm.isActive ? 'פעיל' : 'לא פעיל'}</span>
            </div>

            {gcError && <p className="text-xs text-status-danger">{gcError}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveConfig} disabled={gcBusy || !gcForm.name.trim() || gcForm.partySizeMin > gcForm.partySizeMax}
                className="bg-iron-green hover:bg-iron-green-light text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {gcBusy ? 'שומר…' : 'שמור'}
              </button>
              <button onClick={() => { setGcEditId(null); setGcError(null); }}
                className="bg-iron-surface hover:bg-iron-bg text-iron-text font-medium text-sm px-4 py-2 rounded-lg border border-iron-border transition-colors"
              >ביטול</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderOperations() {
    const canHours        = permissions?.canManageOperatingHours     ?? false;
    const canRestrictions = permissions?.canManageOnlineRestrictions ?? false;
    const hasAnyTool      = canHours || canRestrictions || isSuperAdmin;

    return (
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h2 className="text-iron-text font-semibold text-lg mb-1">Operations</h2>
          <p className="text-iron-muted text-sm">Manage hours and booking availability.</p>
        </div>

        {!hasAnyTool ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-iron-surface border border-iron-border flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-iron-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-iron-text font-medium mb-1">Portal access is currently limited</p>
            <p className="text-iron-muted text-sm">Contact Iron Booking support to enable tools for your restaurant.</p>
          </div>
        ) : (<>

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
                          <input type="checkbox" checked={row.isOpen}
                            onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, isOpen: e.target.checked } : r))}
                            className="w-4 h-4 cursor-pointer accent-iron-green"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input type="time" value={row.openTime} disabled={!row.isOpen}
                            onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, openTime: e.target.value } : r))}
                            className="bg-iron-bg border border-iron-border rounded px-2 py-1 text-sm text-iron-text focus:outline-none focus:border-iron-green disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input type="time" value={row.closeTime} disabled={!row.isOpen}
                            onChange={e => setScheduleRows(rows => rows.map((r, j) => j === i ? { ...r, closeTime: e.target.value } : r))}
                            className="bg-iron-bg border border-iron-border rounded px-2 py-1 text-sm text-iron-text focus:outline-none focus:border-iron-green disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="py-2">
                          <input type="time" value={row.lastSeating} disabled={!row.isOpen}
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
              {scheduleError && <p className="text-xs text-status-danger">{scheduleError}</p>}
              <div className="flex gap-3 pt-1">
                <button onClick={handleSaveSchedule} disabled={scheduleBusy} className={btnPrimary}>
                  {scheduleBusy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setEditSchedule(false); setScheduleError(null); }} className={btnSecondary}>Cancel</button>
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
          {canRestrictions && (
            <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
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
                        {r.guestMessage && <p className="text-xs text-iron-muted mt-0.5 italic">"{r.guestMessage}"</p>}
                      </div>
                      <button
                        onClick={() => handleDeleteRestriction(r.id)}
                        className="shrink-0 text-xs text-iron-muted hover:text-status-danger px-1.5 py-1 rounded hover:bg-iron-bg transition-colors"
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
                      <Input type="date" value={restrictionForm.date}
                        onChange={e => setRestrictionForm(f => ({ ...f, date: e.target.value }))}
                      />
                    </Field>
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" id="rpFullDay" checked={restrictionForm.fullDay}
                        onChange={e => setRestrictionForm(f => ({ ...f, fullDay: e.target.checked }))}
                        className="w-4 h-4 cursor-pointer accent-iron-green"
                      />
                      <label htmlFor="rpFullDay" className="text-sm text-iron-text cursor-pointer select-none">Full day</label>
                    </div>
                  </div>
                  {!restrictionForm.fullDay && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Start time *">
                        <Input type="time" value={restrictionForm.startTime}
                          onChange={e => setRestrictionForm(f => ({ ...f, startTime: e.target.value }))}
                        />
                      </Field>
                      <Field label="End time *">
                        <Input type="time" value={restrictionForm.endTime}
                          onChange={e => setRestrictionForm(f => ({ ...f, endTime: e.target.value }))}
                        />
                      </Field>
                    </div>
                  )}
                  <Field label="Reason (internal — not shown to guests)">
                    <Input value={restrictionForm.reason}
                      onChange={e => setRestrictionForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder="Private event, staff training, kitchen closed…"
                    />
                  </Field>
                  <Field label="Guest message (optional — shown in booking widget if set)">
                    <Input value={restrictionForm.guestMessage} maxLength={200}
                      onChange={e => setRestrictionForm(f => ({ ...f, guestMessage: e.target.value }))}
                      placeholder="Online booking unavailable for this date. Please call us to reserve."
                    />
                  </Field>
                  {restrictionError && <p className="text-xs text-status-danger">{restrictionError}</p>}
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
            </div>
          )}
          {isSuperAdmin && renderGroupConfigs()}
        </>)}
      </div>
    );
  }

  function renderMarketing() {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="text-iron-text font-semibold text-lg mb-1">Marketing</h2>
        <p className="text-iron-muted text-sm mb-7">Promotions, campaigns, and performance insights.</p>
        <div className="space-y-3">
          {(['Promotions', 'Campaigns', 'Performance'] as const).map(item => (
            <div key={item} className="bg-iron-surface border border-iron-border rounded-xl px-4 py-4 flex items-center justify-between">
              <span className="text-iron-text text-sm font-medium">{item}</span>
              <span className="text-iron-muted text-xs bg-iron-bg border border-iron-border rounded px-2 py-0.5">Coming soon</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="text-iron-text font-semibold text-lg mb-1">Settings</h2>
        <p className="text-iron-muted text-sm mb-7">Account, notifications, and portal preferences.</p>
        <div className="space-y-3">
          {(['Notifications', 'Account', 'Portal access'] as const).map(item => (
            <div key={item} className="bg-iron-surface border border-iron-border rounded-xl px-4 py-4 flex items-center justify-between">
              <span className="text-iron-text text-sm font-medium">{item}</span>
              <span className="text-iron-muted text-xs bg-iron-bg border border-iron-border rounded px-2 py-0.5">Coming soon</span>
            </div>
          ))}
          <div className="pt-4">
            <button
              onClick={() => setHqTheme(t => t === 'dark' ? 'light' : 'dark')}
              className={btnSecondary}
            >
              Switch to {hqTheme === 'dark' ? 'light' : 'dark'} theme
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active section content ────────────────────────────────────────────────
  const sectionMap: Record<Section, () => React.ReactNode> = {
    'dashboard':        renderDashboard,
    'guest-experience': renderGuestExperience,
    'operations':       renderOperations,
    'marketing':        renderMarketing,
    'settings':         renderSettings,
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-iron-bg flex flex-col overflow-hidden">

      {/* Header */}
      <header className="shrink-0 border-b border-iron-border bg-iron-surface px-4 md:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-iron-green rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xs tracking-tight">IB</span>
          </div>
          <div>
            <p className="text-iron-text font-semibold text-sm leading-tight">{restaurantName}</p>
            <p className="text-iron-muted text-xs">Restaurant Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="hidden sm:inline-flex text-iron-muted hover:text-iron-text text-xs px-3 py-1.5 rounded-lg border border-iron-border/50 hover:border-iron-border transition-colors"
          >← Live Operations</a>
          <span className="text-iron-muted text-xs hidden md:block px-1">
            {auth.user.firstName} {auth.user.lastName}
          </span>
          <button
            onClick={() => setHqTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="text-iron-muted hover:text-iron-text text-xs px-2 py-1 rounded hover:bg-iron-bg transition-colors"
            title="Toggle theme"
          >{hqTheme === 'dark' ? '☀' : '☾'}</button>
          <button
            onClick={onLogout}
            className="text-iron-muted hover:text-iron-text text-xs px-3 py-1.5 rounded-lg border border-iron-border hover:border-iron-text/30 transition-colors"
          >Sign out</button>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">

        {/* Desktop sidebar */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-iron-border bg-iron-surface overflow-y-auto">
          <nav className="flex-1 py-3 px-2 space-y-0.5">
            {NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                  activeSection === id
                    ? 'bg-iron-bg text-iron-text font-medium'
                    : 'text-iron-muted hover:text-iron-text hover:bg-iron-bg/60'
                }`}
              >
                <Icon s={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="p-4 border-t border-iron-border">
            <a
              href="/"
              className="flex items-center gap-2 text-xs text-iron-muted hover:text-iron-text transition-colors"
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Live Operations
            </a>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sessionError ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
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
          ) : sectionMap[activeSection]()}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden shrink-0 border-t border-iron-border bg-iron-surface flex">
        {NAV.map(({ id, short, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] transition-colors ${
              activeSection === id ? 'text-iron-green' : 'text-iron-muted hover:text-iron-text'
            }`}
          >
            <Icon s={20} />
            {short}
          </button>
        ))}
      </nav>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 bg-iron-surface border border-iron-border text-iron-text text-sm px-4 py-2 rounded-lg shadow-lg z-50 pointer-events-none whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
