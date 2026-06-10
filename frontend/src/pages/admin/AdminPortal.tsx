import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, ApiError } from '../../api';
import GuestHubCmsPanel from './GuestHubCmsPanel';
import { useT } from '../../i18n/useT';
import { validateImageFile, uploadToCloudinary, cloudinaryConfigured } from '../../utils/cloudinaryUpload';
import type { AdminGroup, AdminGroupDetail, AdminRestaurant, AdminRestaurantDetail, AdminUser, AuthState, LocationTonightStats, SmsUsageReport } from '../../types';

// ─── Wizard form types ────────────────────────────────────────────────────────

interface WizardBasic {
  name: string; slug: string; timezone: string;
  phone: string; email: string; address: string;
}
interface WizardSettings {
  defaultTurnMinutes: number; slotIntervalMinutes: number; maxPartySize: number;
  autoConfirm: boolean; bufferBetweenTurnsMinutes: number;
  lastSeatingOffset: number; lateThresholdMinutes: number; noShowThresholdMinutes: number;
}
interface WizardUser { firstName: string; lastName: string; email: string; password: string; role: string; }

interface ScheduleRow { dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string; lastSeating: string; }

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

interface RestrictionForm { date: string; fullDay: boolean; startTime: string; endTime: string; reason: string; guestMessage: string; }

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_SCHEDULE: ScheduleRow[] = [0, 1, 2, 3, 4, 5, 6].map(d => ({
  dayOfWeek: d, isOpen: d !== 0, openTime: '11:00', closeTime: '22:00', lastSeating: '21:00',
}));

const DEFAULT_BASIC: WizardBasic     = { name: '', slug: '', timezone: 'America/New_York', phone: '', email: '', address: '' };
const DEFAULT_SETTINGS: WizardSettings = {
  defaultTurnMinutes: 90, slotIntervalMinutes: 30, maxPartySize: 20,
  autoConfirm: false, bufferBetweenTurnsMinutes: 15,
  lastSeatingOffset: 60, lateThresholdMinutes: 5, noShowThresholdMinutes: 15,
};
const DEFAULT_USER: WizardUser = { firstName: '', lastName: '', email: '', password: '', role: 'HOST' };
const DEFAULT_RESTRICTION_FORM: RestrictionForm = { date: '', fullDay: true, startTime: '', endTime: '', reason: '', guestMessage: '' };

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className="block text-xs text-iron-muted mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-status-danger mt-1">{error}</p>}
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

// Visual tile selector for button/card/mood options
function StyleTileGroup<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: { value: T; label: string; preview: ReactNode }[];
  value: string;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-iron-muted mb-2">{label}</label>
      <div className="grid grid-cols-4 gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border text-xs transition-colors ${
              value === opt.value
                ? 'border-iron-green bg-iron-green/10 text-iron-green'
                : 'border-iron-border hover:border-iron-green/40 text-iron-muted hover:text-iron-text'
            }`}
          >
            <div className="w-full h-8 rounded flex items-center justify-center overflow-hidden">
              {opt.preview}
            </div>
            <span className="leading-tight text-center">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BrandingPreviewCard({
  primaryColor, logoUrl, restaurantName, buttonStyle, cardStyle, backgroundMood,
  backgroundColorHex, backgroundGradientHex, coverImageUrl,
}: {
  primaryColor: string; logoUrl: string; restaurantName: string;
  buttonStyle: string; cardStyle: string; backgroundMood: string;
  backgroundColorHex: string; backgroundGradientHex: string;
  coverImageUrl?: string;
}) {
  const hex = primaryColor || '#22C55E';
  const initial = restaurantName.charAt(0).toUpperCase();

  const btnRadius = buttonStyle === 'pill' ? '9999px'
    : buttonStyle === 'sharp' ? '4px'
    : buttonStyle === 'luxury' ? '6px'
    : '10px';

  const cardBg = cardStyle === 'solid' ? 'rgba(10,12,18,0.97)'
    : cardStyle === 'luxury-dark' ? 'rgba(8,7,5,0.97)'
    : cardStyle === 'soft-light' ? 'rgba(255,255,255,0.09)'
    : 'linear-gradient(160deg, rgba(14,18,30,0.80) 0%, rgba(7,9,18,0.88) 100%)';
  const cardBorder = cardStyle === 'luxury-dark' ? 'rgba(210,175,80,0.18)'
    : cardStyle === 'soft-light' ? 'rgba(255,255,255,0.18)'
    : 'rgba(255,255,255,0.08)';

  const bgStyle: React.CSSProperties = backgroundColorHex
    ? { background: backgroundGradientHex
        ? `linear-gradient(168deg, ${backgroundColorHex} 0%, ${backgroundGradientHex} 100%)`
        : backgroundColorHex }
    : { background: backgroundMood === 'espresso' ? '#120e08'
        : backgroundMood === 'olive' ? '#0c1009'
        : backgroundMood === 'cream' ? '#141108'
        : backgroundMood === 'warm' ? '#120e05'
        : '#0b0f18' };

  return (
    <div className="relative w-full h-full overflow-hidden" style={bgStyle}>
      {/* Hero area */}
      <div className="relative w-full" style={{ height: '42%' }}>
        {coverImageUrl
          ? <img src={coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,rgba(20,28,48,0.9),rgba(8,12,22,0.98))' }} />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.08) 0%,rgba(0,0,0,0.50) 70%,rgba(0,0,0,0.88) 100%)' }} />
        <div className="absolute bottom-3 left-0 right-0 flex flex-col items-center">
          <div className="w-9 h-9 rounded-full flex items-center justify-center border mb-1.5" style={{ background: 'rgba(12,16,26,0.72)', borderColor: 'rgba(255,255,255,0.15)' }}>
            {logoUrl
              ? <img src={logoUrl} alt="logo" className="object-contain h-6 max-w-[32px]" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              : <span className="text-white/70 text-sm font-light">{initial}</span>}
          </div>
          <p className="text-white/85 text-[10px] font-medium tracking-wide">{restaurantName}</p>
        </div>
      </div>

      {/* Booking card */}
      <div className="px-3 pt-3 pb-4">
        <div
          className="rounded-xl p-3"
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            backdropFilter: cardStyle === 'solid' ? 'none' : 'blur(20px)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/35 text-[9px]">Tonight · 2 guests</span>
            <span className="text-white/35 text-[9px]">◂ ▸</span>
          </div>
          <div className="flex flex-col gap-1.5 mb-2.5">
            {['7:00 PM', '7:30 PM', '8:00 PM'].map((slot, i) => (
              <div
                key={slot}
                className="px-3 py-1.5 text-center text-[10px] font-medium"
                style={i === 1 ? {
                  background: hex,
                  color: '#fff',
                  borderRadius: btnRadius,
                  boxShadow: `0 0 10px ${hex}44`,
                } : {
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  color: 'rgba(255,255,255,0.42)',
                  borderRadius: btnRadius,
                }}
              >{slot}</div>
            ))}
          </div>
          <div
            className="w-full py-1.5 text-center text-[10px] font-semibold"
            style={{ background: hex, color: '#fff', borderRadius: btnRadius, letterSpacing: buttonStyle === 'luxury' ? '0.10em' : undefined }}
          >Reserve a table</div>
        </div>
      </div>
    </div>
  );
}

function NumInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
    />
  );
}

// ─── Content-area error boundary ─────────────────────────────────────────────
// Wraps the right-side content panel so a render crash (e.g. in GuestHubCmsPanel)
// shows an inline error rather than escaping to the full-screen top-level boundary.
// The `key` prop resets it whenever the user navigates to a different view or ID.

interface PanelBoundaryState { hasError: boolean; message: string }

class PanelErrorBoundary extends React.Component<{ children: ReactNode; resetKey: string }, PanelBoundaryState> {
  state: PanelBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): PanelBoundaryState {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-10 h-10 rounded-lg bg-red-900/30 border border-status-danger/30 flex items-center justify-center mx-auto">
              <span className="text-status-danger text-lg font-bold">!</span>
            </div>
            <p className="text-iron-text font-semibold text-sm">Panel error</p>
            <p className="text-iron-muted text-xs font-mono break-all leading-relaxed">{this.state.message}</p>
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-5 py-2.5 rounded-lg bg-iron-green hover:bg-iron-green-light text-white text-sm font-semibold transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  auth: AuthState;
  onLogout: () => void;
  onDashboard?: () => void;
}

export default function AdminPortal({ auth, onLogout, onDashboard }: Props) {
  const T = useT();

  // ── HQ-local theme (iron_hq_theme, independent of restaurant dashboard) ─────
  const [hqTheme, setHqTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('iron_hq_theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = hqTheme;
    document.documentElement.classList.toggle('dark', hqTheme === 'dark');
    localStorage.setItem('iron_hq_theme', hqTheme);
  }, [hqTheme]);

  // Restore the restaurant dashboard theme when the HQ portal unmounts
  useEffect(() => {
    return () => {
      const hostTheme = (localStorage.getItem('iron_theme') ?? 'dark') as 'dark' | 'light';
      document.documentElement.dataset.theme = hostTheme;
      document.documentElement.classList.toggle('dark', hostTheme === 'dark');
    };
  }, []);

  // Restaurant list
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [listLoading, setListLoading]  = useState(true);

  // View state
  const isSuperAdmin      = auth.user.role === 'SUPER_ADMIN';
  const isRestaurantAdmin = auth.user.role === 'RESTAURANT_ADMIN';

  const [view,       setView]       = useState<'splash' | 'create' | 'detail' | 'create-group' | 'group-detail' | 'sms-usage'>('splash');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail,     setDetail]     = useState<AdminRestaurantDetail | null>(null);
  const [users,      setUsers]      = useState<AdminUser[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [activeTab,  setActiveTab]  = useState<'info' | 'settings' | 'users' | 'guest-hub'>('info');

  // Wizard state
  const [wizardStep,              setWizardStep]              = useState(1);
  const [wizardBasic,             setWizardBasic]             = useState<WizardBasic>(DEFAULT_BASIC);
  const [wizardSettings,          setWizardSettings]          = useState<WizardSettings>(DEFAULT_SETTINGS);
  const [wizardUser,              setWizardUser]              = useState<WizardUser>(DEFAULT_USER);
  const [wizardBusy,              setWizardBusy]              = useState(false);
  const [wizardError,             setWizardError]             = useState<string | null>(null);
  const [wizardUserFieldErrors,   setWizardUserFieldErrors]   = useState<Record<string, string | undefined>>({});
  // ID of a restaurant already created in this wizard run — lets step-3 retry without re-creating the restaurant
  const [wizardRestaurantId,      setWizardRestaurantId]      = useState<string | null>(null);

  // Info edit state
  const [editInfo,  setEditInfo]  = useState(false);
  const [infoForm,  setInfoForm]  = useState({ name: '', timezone: '', phone: '', email: '', address: '' });
  const [infoBusy,  setInfoBusy]  = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // Settings edit state
  const [editSettings,  setEditSettings]  = useState(false);
  const [settingsForm,  setSettingsForm]  = useState<WizardSettings>(DEFAULT_SETTINGS);
  const [settingsBusy,  setSettingsBusy]  = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Add user state
  const [showAddUser,      setShowAddUser]      = useState(false);
  const [userForm,         setUserForm]         = useState<WizardUser>(DEFAULT_USER);
  const [userBusy,         setUserBusy]         = useState(false);
  const [userError,        setUserError]        = useState<string | null>(null);
  const [userFieldErrors,  setUserFieldErrors]  = useState<Record<string, string | undefined>>({});

  // Layout seeding
  const [layoutBusy, setLayoutBusy] = useState(false);

  // ── Group state (SUPER_ADMIN only) ───────────────────────────────────────────
  const [sidebarTab,      setSidebarTab]      = useState<'locations' | 'groups' | 'sms'>('locations');
  const [groups,          setGroups]          = useState<AdminGroup[]>([]);
  const [groupsLoading,   setGroupsLoading]   = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupDetail,     setGroupDetail]     = useState<AdminGroupDetail | null>(null);
  const [groupDetailBusy, setGroupDetailBusy] = useState(false);
  // Create group form
  const [groupName,  setGroupName]  = useState('');
  const [groupSlug,  setGroupSlug]  = useState('');
  const [groupBusy,  setGroupBusy]  = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  // Add HQ admin to group
  const [showAddHqUser, setShowAddHqUser] = useState(false);
  const [hqUserForm,    setHqUserForm]    = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [hqUserBusy,    setHqUserBusy]    = useState(false);
  const [hqUserError,   setHqUserError]   = useState<string | null>(null);
  // Assign location to group
  const [assignId,   setAssignId]   = useState('');
  const [assignBusy, setAssignBusy] = useState(false);

  // Tonight stats (group detail operational view)
  const [tonightStatsMap,  setTonightStatsMap]  = useState<Record<string, LocationTonightStats>>({});
  const [tonightLoading,   setTonightLoading]   = useState(false);
  // Which location row's ⋮ actions menu is open
  const [openActionsId,    setOpenActionsId]    = useState<string | null>(null);

  // WhatsApp credentials edit state
  const [editWhatsapp,      setEditWhatsapp]      = useState(false);
  const [whatsappForm,      setWhatsappForm]      = useState({ instanceId: '', token: '', phone: '' });
  const [whatsappBusy,      setWhatsappBusy]      = useState(false);
  const [whatsappTestBusy,  setWhatsappTestBusy]  = useState(false);
  const [whatsappError,     setWhatsappError]     = useState<string | null>(null);

  // SMS service config edit state (stored in restaurant.settings)
  const [editSms,      setEditSms]      = useState(false);
  const [smsForm,      setSmsForm]      = useState({ enabled: false, provider: 'MOCK', senderName: '' });
  const [smsBusy,      setSmsBusy]      = useState(false);
  const [smsTestBusy,  setSmsTestBusy]  = useState(false);
  const [smsTestPhone, setSmsTestPhone] = useState('');
  const [smsError,     setSmsError]     = useState<string | null>(null);

  // SMS usage report (SUPER_ADMIN only)
  const [smsUsage,        setSmsUsage]        = useState<SmsUsageReport | null>(null);
  const [smsUsageMonth,   setSmsUsageMonth]   = useState('');
  const [smsUsageLoading, setSmsUsageLoading] = useState(false);

  // Branding edit state
  const [editBranding,   setEditBranding]   = useState(false);
  const [brandingForm,   setBrandingForm]   = useState({ cuisine: '', primaryColor: '', accentColor: '', publicThemePreset: '', logoUrl: '', coverImageUrl: '', heroVideoUrl: '', buttonStyle: '', cardStyle: '', backgroundMood: '', backgroundColorHex: '', backgroundGradientHex: '', websiteUrl: '', instagramUrl: '', googleMapsUrl: '', wazeUrl: '' });
  const [brandingBusy,   setBrandingBusy]   = useState(false);
  const [brandingError,  setBrandingError]  = useState<string | null>(null);
  const [logoPreview,    setLogoPreview]    = useState<string | null>(null);
  const [coverPreview,   setCoverPreview]   = useState<string | null>(null);
  const [logoUpload,     setLogoUpload]     = useState<{ progress: number | null; error: string | null }>({ progress: null, error: null });
  const [coverUpload,    setCoverUpload]    = useState<{ progress: number | null; error: string | null }>({ progress: null, error: null });

  // Restaurant Portal permissions
  const [portalPermBusy,  setPortalPermBusy]  = useState(false);
  const [portalPermError, setPortalPermError] = useState<string | null>(null);

  // Weekly schedule edit state
  const [editSchedule,  setEditSchedule]  = useState(false);
  const [scheduleRows,  setScheduleRows]  = useState<ScheduleRow[]>(DEFAULT_SCHEDULE);
  const [scheduleBusy,  setScheduleBusy]  = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Online Booking Restrictions state
  const [restrictions,          setRestrictions]          = useState<OnlineRestriction[]>([]);
  const [showAddRestriction,    setShowAddRestriction]    = useState(false);
  const [restrictionForm,       setRestrictionForm]       = useState<RestrictionForm>(DEFAULT_RESTRICTION_FORM);
  const [restrictionCreateBusy, setRestrictionCreateBusy] = useState(false);
  const [restrictionError,      setRestrictionError]      = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Close the location actions menu on any outside click
  useEffect(() => {
    if (!openActionsId) return;
    function handleOutside() { setOpenActionsId(null); }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openActionsId]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadRestaurants = useCallback(async () => {
    setListLoading(true);
    try {
      setRestaurants(await api.admin.restaurants.list());
    } catch { /* ignore */ }
    finally { setListLoading(false); }
  }, []);

  useEffect(() => { loadRestaurants(); }, [loadRestaurants]);

  // RESTAURANT_ADMIN: auto-navigate into their single restaurant on load.
  // view === 'splash' guard prevents re-triggering after they're already inside.
  useEffect(() => {
    if (auth.user.role === 'RESTAURANT_ADMIN' && restaurants.length === 1 && view === 'splash') {
      selectRestaurant(restaurants[0].id);
    }
  // selectRestaurant is stable (only calls setState + loadDetail which is useCallback([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailBusy(true);
    try {
      const [d, u, rl] = await Promise.all([
        api.admin.restaurants.get(id),
        api.admin.users.list(id),
        api.admin.restaurants.onlineRestrictions.list(id).catch(() => [] as OnlineRestriction[]),
      ]);
      setDetail(d);
      setUsers(u);
      setRestrictions(rl);
      const s = d.settings as Record<string, unknown>;
      setInfoForm({ name: d.name, timezone: d.timezone, phone: d.phone ?? '', email: d.email ?? '', address: d.address ?? '' });
      setSettingsForm({
        defaultTurnMinutes:        Number(s.defaultTurnMinutes ?? 90),
        slotIntervalMinutes:       Number(s.slotIntervalMinutes ?? 30),
        maxPartySize:              Number(s.maxPartySize ?? 20),
        autoConfirm:               Boolean(s.autoConfirm ?? false),
        bufferBetweenTurnsMinutes: Number(s.bufferBetweenTurnsMinutes ?? 15),
        lastSeatingOffset:         Number(s.lastSeatingOffset ?? 60),
        lateThresholdMinutes:      Number(s.lateThresholdMinutes ?? 5),
        noShowThresholdMinutes:    Number(s.noShowThresholdMinutes ?? 15),
      });
      setWhatsappForm({ instanceId: d.ultramsgInstanceId ?? '', token: '', phone: d.whatsappPhone ?? '' });
      setSmsForm({
        enabled:    Boolean(s.smsEnabled ?? false),
        provider:   String(s.smsProvider ?? 'MOCK'),
        senderName: String(s.smsSenderName ?? ''),
      });
      setSmsTestPhone(d.phone ?? '');
      setBrandingForm({ cuisine: d.cuisine ?? '', primaryColor: d.primaryColor ?? '', accentColor: d.accentColor ?? '', publicThemePreset: d.publicThemePreset ?? '', logoUrl: d.logoUrl ?? '', coverImageUrl: d.coverImageUrl ?? '', heroVideoUrl: d.heroVideoUrl ?? '', buttonStyle: d.buttonStyle ?? '', cardStyle: d.cardStyle ?? '', backgroundMood: d.backgroundMood ?? '', backgroundColorHex: d.backgroundColorHex ?? '', backgroundGradientHex: d.backgroundGradientHex ?? '', websiteUrl: d.websiteUrl ?? '', instagramUrl: d.instagramUrl ?? '', googleMapsUrl: d.googleMapsUrl ?? '', wazeUrl: d.wazeUrl ?? '' });
      if (d.operatingHours?.length === 7) {
        setScheduleRows(d.operatingHours.map(h => ({
          dayOfWeek: h.dayOfWeek, isOpen: h.isOpen,
          openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating,
        })));
      }
    } catch { /* ignore */ }
    finally { setDetailBusy(false); }
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function selectRestaurant(id: string, tab: 'info' | 'settings' | 'users' | 'guest-hub' = 'info') {
    if (auth.user.role === 'RESTAURANT_ADMIN' && id !== auth.user.restaurant?.id) return;
    setSelectedId(id);
    setView('detail');
    setActiveTab(tab);
    setEditInfo(false);
    setEditSettings(false);
    setEditWhatsapp(false);
    setEditSms(false);
    setSmsError(null);
    setEditBranding(false);
    setShowAddUser(false);
    setShowAddRestriction(false);
    setRestrictionForm(DEFAULT_RESTRICTION_FORM);
    setRestrictionError(null);
    loadDetail(id);
  }

  function openCreate() {
    setView('create');
    setWizardStep(1);
    setWizardBasic(DEFAULT_BASIC);
    setWizardSettings(DEFAULT_SETTINGS);
    setWizardUser(DEFAULT_USER);
    setWizardError(null);
    setWizardUserFieldErrors({});
    setWizardRestaurantId(null);
  }

  // Auto-slug from name
  function handleNameChange(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    setWizardBasic(b => ({ ...b, name, slug }));
  }

  // ── Wizard submit ────────────────────────────────────────────────────────────

  function parseFieldErrors(e: unknown): Record<string, string | undefined> {
    if (!(e instanceof ApiError)) return {};
    return Object.fromEntries(
      Object.entries(e.fieldErrors).map(([k, v]) => [k, Array.isArray(v) ? v[0] : undefined])
    );
  }

  async function handleWizardCreate(skipUser = false) {
    setWizardBusy(true);
    setWizardError(null);
    setWizardUserFieldErrors({});

    try {
      // Reuse already-created restaurant on step-3 retry to avoid duplicate slug error
      let restaurantId = wizardRestaurantId;
      if (!restaurantId) {
        const restaurant = await api.admin.restaurants.create({
          name:     wizardBasic.name,
          slug:     wizardBasic.slug,
          timezone: wizardBasic.timezone || 'America/New_York',
          phone:    wizardBasic.phone   || undefined,
          email:    wizardBasic.email   || undefined,
          address:  wizardBasic.address || undefined,
        });
        await api.admin.restaurants.settings(restaurant.id, wizardSettings as unknown as Record<string, unknown>);
        restaurantId = restaurant.id;
        setWizardRestaurantId(restaurantId);
        await loadRestaurants();
      }

      if (!skipUser && wizardUser.email && wizardUser.password && wizardUser.firstName) {
        try {
          await api.admin.users.create(restaurantId, {
            email:     wizardUser.email,
            password:  wizardUser.password,
            firstName: wizardUser.firstName,
            lastName:  wizardUser.lastName,
            role:      wizardUser.role,
          });
        } catch (userErr: unknown) {
          const fieldErrs = parseFieldErrors(userErr);
          // Conflict on email (409) → show under email field
          if (!fieldErrs.email && userErr instanceof Error && userErr.message.toLowerCase().includes('already exists')) {
            fieldErrs.email = userErr.message;
          }
          if (Object.keys(fieldErrs).length > 0) {
            setWizardUserFieldErrors(fieldErrs);
          } else {
            setWizardError(userErr instanceof Error ? userErr.message : 'Failed to create user');
          }
          setWizardBusy(false);
          return; // Stay on step 3 — restaurant is safe to keep
        }
      }

      showToast(T.admin.restaurantCreated);
      selectRestaurant(restaurantId);
      setWizardRestaurantId(null);
    } catch (e: unknown) {
      setWizardError(e instanceof Error ? e.message : 'Failed to create restaurant');
    } finally {
      setWizardBusy(false);
    }
  }

  // ── Info save ────────────────────────────────────────────────────────────────

  async function handleSaveInfo() {
    if (!selectedId) return;
    setInfoBusy(true);
    setInfoError(null);
    try {
      const updated = await api.admin.restaurants.update(selectedId, {
        name:     infoForm.name,
        timezone: infoForm.timezone,
        phone:    infoForm.phone   || null,
        email:    infoForm.email   || null,
        address:  infoForm.address || null,
      });
      setDetail(d => d ? { ...d, name: updated.name, timezone: updated.timezone, phone: updated.phone, email: updated.email, address: updated.address } : d);
      setRestaurants(rs => rs.map(r => r.id === selectedId ? { ...r, name: updated.name } : r));
      setEditInfo(false);
      showToast(T.admin.settingsSaved);
    } catch (e: any) {
      setInfoError(e.message ?? 'Save failed');
    } finally {
      setInfoBusy(false);
    }
  }

  // ── Settings save ────────────────────────────────────────────────────────────

  async function handleSaveSettings() {
    if (!selectedId) return;
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      const updated = await api.admin.restaurants.settings(selectedId, wizardSettings as unknown as Record<string, unknown>);
      setDetail(d => d ? { ...d, settings: updated.settings } : d);
      setSettingsForm(wizardSettings);
      setEditSettings(false);
      showToast(T.admin.settingsSaved);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSettingsBusy(false); }
  }

  // ── WhatsApp credentials ──────────────────────────────────────────────────────

  async function handleSaveWhatsapp() {
    if (!selectedId) return;
    setWhatsappBusy(true);
    setWhatsappError(null);
    try {
      const result = await api.admin.restaurants.updateWhatsapp(selectedId, {
        ultramsgInstanceId: whatsappForm.instanceId || null,
        ultramsgToken:      whatsappForm.token || null,
        whatsappPhone:      whatsappForm.phone || null,
      });
      setDetail(d => d ? { ...d, ultramsgInstanceId: result.ultramsgInstanceId, whatsappPhone: result.whatsappPhone, tokenSet: result.tokenSet } : d);
      setEditWhatsapp(false);
      showToast('WhatsApp credentials saved');
    } catch (err) {
      setWhatsappError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setWhatsappBusy(false);
    }
  }

  async function handleTestWhatsapp() {
    if (!selectedId) return;
    setWhatsappTestBusy(true);
    try {
      await api.admin.restaurants.testWhatsapp(selectedId);
      showToast('Test message sent');
    } catch (err) {
      setWhatsappError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setWhatsappTestBusy(false);
    }
  }

  // ── SMS service ───────────────────────────────────────────────────────────────

  async function handleSaveSms() {
    if (!selectedId) return;
    setSmsBusy(true);
    setSmsError(null);
    try {
      const payload: Record<string, unknown> = {
        smsEnabled:  smsForm.enabled,
        smsProvider: smsForm.provider,
      };
      const sender = smsForm.senderName.trim();
      if (sender) payload.smsSenderName = sender;
      const updated = await api.admin.restaurants.settings(selectedId, payload);
      setDetail(d => d ? { ...d, settings: updated.settings } : d);
      setEditSms(false);
      showToast('SMS settings saved');
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSmsBusy(false);
    }
  }

  async function handleTestSms() {
    if (!selectedId) return;
    const to = smsTestPhone.trim();
    if (!to) { setSmsError('Enter a phone number to send a test'); return; }
    setSmsTestBusy(true);
    setSmsError(null);
    try {
      const { result, log } = await api.admin.sms.test({
        restaurantId: selectedId,
        to,
        message: `Iron Booking SMS test — ${detail?.name ?? ''}`.trim(),
      });
      if (result.success) {
        showToast(`Test SMS sent via ${log?.provider ?? 'provider'}`);
      } else {
        setSmsError(log?.errorMessage ?? 'Send failed — check provider settings');
      }
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setSmsTestBusy(false);
    }
  }

  // ── SMS usage report ──────────────────────────────────────────────────────────

  const loadSmsUsage = useCallback(async (month?: string) => {
    setSmsUsageLoading(true);
    try {
      const report = await api.admin.sms.usage(month);
      setSmsUsage(report);
      setSmsUsageMonth(report.month);
    } catch { /* ignore */ }
    finally { setSmsUsageLoading(false); }
  }, []);

  function openSmsUsage() {
    setSidebarTab('sms');
    setView('sms-usage');
    setSelectedId(null);
    setSelectedGroupId(null);
    loadSmsUsage(smsUsageMonth || undefined);
  }

  // ── Branding ──────────────────────────────────────────────────────────────────

  async function handleSaveSchedule() {
    if (!selectedId) return;
    setScheduleBusy(true);
    setScheduleError(null);
    try {
      const updated = await api.admin.restaurants.updateOperatingHours(selectedId, scheduleRows);
      setScheduleRows(updated.map(h => ({
        dayOfWeek: h.dayOfWeek, isOpen: h.isOpen,
        openTime: h.openTime, closeTime: h.closeTime, lastSeating: h.lastSeating,
      })));
      setEditSchedule(false);
      showToast('Schedule saved');
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setScheduleBusy(false);
    }
  }

  async function handleCreateRestriction() {
    if (!selectedId) return;
    const f = restrictionForm;
    if (!f.date) { setRestrictionError('Date is required'); return; }
    if (!f.fullDay) {
      if (!f.startTime || !f.endTime) { setRestrictionError('Start time and end time are both required for a time-range rule'); return; }
      if (f.startTime >= f.endTime) { setRestrictionError('Start time must be before end time'); return; }
    }
    setRestrictionCreateBusy(true);
    setRestrictionError(null);
    try {
      await api.admin.restaurants.onlineRestrictions.create(selectedId, {
        date:         f.date,
        startTime:    f.fullDay ? null : f.startTime,
        endTime:      f.fullDay ? null : f.endTime,
        reason:       f.reason || null,
        guestMessage: f.guestMessage || null,
      });
      const updated = await api.admin.restaurants.onlineRestrictions.list(selectedId);
      setRestrictions(updated);
      setShowAddRestriction(false);
      setRestrictionForm(DEFAULT_RESTRICTION_FORM);
      showToast('Restriction added');
    } catch (err) {
      setRestrictionError(err instanceof Error ? err.message : 'Failed to add restriction');
    } finally {
      setRestrictionCreateBusy(false);
    }
  }

  async function handleDeleteRestriction(rid: string) {
    if (!selectedId) return;
    try {
      await api.admin.restaurants.onlineRestrictions.delete(selectedId, rid);
      setRestrictions(r => r.filter(x => x.id !== rid));
    } catch {
      showToast('Failed to delete restriction');
    }
  }

  async function handleSaveBranding() {
    if (!selectedId) return;
    setBrandingBusy(true);
    setBrandingError(null);
    try {
      const result = await api.admin.restaurants.updateBranding(selectedId, {
        cuisine:           brandingForm.cuisine           || null,
        primaryColor:      brandingForm.primaryColor      || null,
        accentColor:       brandingForm.accentColor       || null,
        publicThemePreset: brandingForm.publicThemePreset || null,
        logoUrl:           brandingForm.logoUrl           || null,
        coverImageUrl:     brandingForm.coverImageUrl     || null,
        heroVideoUrl:      brandingForm.heroVideoUrl      || null,
        buttonStyle:           brandingForm.buttonStyle           || null,
        cardStyle:             brandingForm.cardStyle             || null,
        backgroundMood:        brandingForm.backgroundMood        || null,
        backgroundColorHex:    brandingForm.backgroundColorHex    || null,
        backgroundGradientHex: brandingForm.backgroundGradientHex || null,
        websiteUrl:    brandingForm.websiteUrl    || null,
        instagramUrl:  brandingForm.instagramUrl  || null,
        googleMapsUrl: brandingForm.googleMapsUrl || null,
        wazeUrl:       brandingForm.wazeUrl       || null,
      });
      setDetail(d => d ? {
        ...d,
        primaryColor:      result.primaryColor,
        accentColor:       result.accentColor,
        publicThemePreset: result.publicThemePreset,
        logoUrl:           result.logoUrl,
        coverImageUrl:     result.coverImageUrl,
        heroVideoUrl:      result.heroVideoUrl,
        buttonStyle:           result.buttonStyle,
        cardStyle:             result.cardStyle,
        backgroundMood:        result.backgroundMood,
        backgroundColorHex:    result.backgroundColorHex,
        backgroundGradientHex: result.backgroundGradientHex,
        websiteUrl:    result.websiteUrl,
        instagramUrl:  result.instagramUrl,
        googleMapsUrl: result.googleMapsUrl,
        wazeUrl:       result.wazeUrl,
      } : d);
      setEditBranding(false);
      showToast('Branding saved');
    } catch (err) {
      setBrandingError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBrandingBusy(false);
    }
  }

  // ── Portal permissions toggle ──────────────────────────────────────────────────

  async function handleTogglePortalPerm(key: 'canManageOperatingHours' | 'canManageOnlineRestrictions') {
    if (!selectedId || !detail) return;
    setPortalPermBusy(true);
    setPortalPermError(null);
    const current = detail.portalPermissions?.[key] ?? false;
    try {
      const updated = await api.admin.restaurants.updatePortalPermissions(selectedId, { [key]: !current });
      setDetail(d => d ? { ...d, portalPermissions: updated } : d);
    } catch (err) {
      setPortalPermError(err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      setPortalPermBusy(false);
    }
  }

  // ── Add user ──────────────────────────────────────────────────────────────────

  async function handleAddUser() {
    if (!selectedId) return;
    setUserBusy(true);
    setUserError(null);
    setUserFieldErrors({});
    try {
      const u = await api.admin.users.create(selectedId, {
        email:     userForm.email,
        password:  userForm.password,
        firstName: userForm.firstName,
        lastName:  userForm.lastName,
        role:      userForm.role,
      });
      setUsers(us => [...us, u]);
      setShowAddUser(false);
      setUserForm(DEFAULT_USER);
      showToast(T.admin.userCreated);
    } catch (e: unknown) {
      const fieldErrs = parseFieldErrors(e);
      if (!fieldErrs.email && e instanceof Error && e.message.toLowerCase().includes('already exists')) {
        fieldErrs.email = e.message;
      }
      if (Object.keys(fieldErrs).length > 0) {
        setUserFieldErrors(fieldErrs);
      } else {
        setUserError(e instanceof Error ? e.message : 'Failed to create user');
      }
    } finally {
      setUserBusy(false);
    }
  }

  // ── Toggle user active ────────────────────────────────────────────────────────

  async function handleToggleUser(u: AdminUser) {
    try {
      const updated = await api.admin.users.update(u.id, { isActive: !u.isActive });
      setUsers(us => us.map(x => x.id === u.id ? updated : x));
      showToast(T.admin.userUpdated);
    } catch { /* ignore */ }
  }

  // ── Sample layout ──────────────────────────────────────────────────────────────

  async function handleSampleLayout() {
    if (!selectedId) return;
    if (!window.confirm(T.admin.sampleLayoutConfirm)) return;
    setLayoutBusy(true);
    try {
      await api.admin.restaurants.sampleLayout(selectedId);
      showToast(T.admin.sampleLayoutApplied);
    } catch { /* ignore */ }
    finally { setLayoutBusy(false); }
  }

  // ── Group handlers ────────────────────────────────────────────────────────────

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try { setGroups(await api.admin.groups.list()); }
    catch { /* ignore */ }
    finally { setGroupsLoading(false); }
  }, []);

  async function selectGroup(id: string) {
    setSelectedGroupId(id);
    setView('group-detail');
    setShowAddHqUser(false);
    setAssignId('');
    setOpenActionsId(null);
    setGroupDetailBusy(true);
    setTonightLoading(true);
    try {
      const [detail, tonight] = await Promise.all([
        api.admin.groups.get(id),
        api.admin.groups.tonight(id).catch(() => [] as LocationTonightStats[]),
      ]);
      setGroupDetail(detail);
      setTonightStatsMap(Object.fromEntries(tonight.map(s => [s.restaurantId, s])));
    } catch { /* ignore */ }
    finally { setGroupDetailBusy(false); setTonightLoading(false); }
  }

  function openCreateGroup() {
    setView('create-group');
    setGroupName('');
    setGroupSlug('');
    setGroupError(null);
  }

  async function handleCreateGroup() {
    setGroupBusy(true);
    setGroupError(null);
    try {
      const g = await api.admin.groups.create({ name: groupName, slug: groupSlug });
      setGroups(gs => [g, ...gs]);
      showToast(T.admin.groupCreated);
      selectGroup(g.id);
    } catch (e: unknown) {
      setGroupError(e instanceof Error ? e.message : 'Failed to create group');
    } finally {
      setGroupBusy(false);
    }
  }

  async function handleAssignToGroup() {
    if (!selectedGroupId || !assignId) return;
    setAssignBusy(true);
    try {
      await api.admin.groups.addRestaurant(selectedGroupId, assignId);
      setGroupDetail(await api.admin.groups.get(selectedGroupId));
      await loadRestaurants();
      setAssignId('');
      showToast(T.admin.settingsSaved);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to assign location');
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleRemoveFromGroup(restaurantId: string) {
    if (!selectedGroupId) return;
    try {
      await api.admin.groups.removeRestaurant(selectedGroupId, restaurantId);
      setGroupDetail(await api.admin.groups.get(selectedGroupId));
      await loadRestaurants();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to remove location');
    }
  }

  async function handleCreateHqUser() {
    if (!selectedGroupId) return;
    setHqUserBusy(true);
    setHqUserError(null);
    try {
      await api.admin.groups.createHqUser(selectedGroupId, hqUserForm);
      setGroupDetail(await api.admin.groups.get(selectedGroupId));
      setShowAddHqUser(false);
      setHqUserForm({ firstName: '', lastName: '', email: '', password: '' });
      showToast(T.admin.hqAdminCreated);
    } catch (e: unknown) {
      setHqUserError(e instanceof Error ? e.message : 'Failed to create HQ admin');
    } finally {
      setHqUserBusy(false);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  const inputCls = 'w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green';
  const btnPrimary = 'px-4 py-2 bg-iron-green-light hover:bg-iron-green text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50';
  const btnSecondary = 'px-4 py-2 bg-iron-surface border border-iron-border text-iron-text rounded text-sm hover:bg-iron-bg';

  // ── Wizard panels ─────────────────────────────────────────────────────────────

  function renderWizardStep1() {
    return (
      <div className="space-y-4">
        <Field label={T.admin.fieldName}>
          <Input
            value={wizardBasic.name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="e.g. The Grand Brasserie"
            required
          />
        </Field>
        <Field label={T.admin.fieldSlug}>
          <Input
            value={wizardBasic.slug}
            onChange={e => setWizardBasic(b => ({ ...b, slug: e.target.value }))}
            placeholder="e.g. grand-brasserie"
            pattern="[a-z0-9-]+"
            title="Lowercase letters, numbers and hyphens only"
            required
          />
          <p className="text-xs text-iron-muted mt-1">Used in API and internal references</p>
        </Field>
        <Field label={T.admin.fieldTimezone}>
          <Input
            value={wizardBasic.timezone}
            onChange={e => setWizardBasic(b => ({ ...b, timezone: e.target.value }))}
            placeholder="America/New_York"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={T.admin.fieldPhone}>
            <Input value={wizardBasic.phone} onChange={e => setWizardBasic(b => ({ ...b, phone: e.target.value }))} placeholder="+1 555 000 0000" />
          </Field>
          <Field label={T.admin.fieldEmail}>
            <Input type="email" value={wizardBasic.email} onChange={e => setWizardBasic(b => ({ ...b, email: e.target.value }))} placeholder="info@restaurant.com" />
          </Field>
        </div>
        <Field label={T.admin.fieldAddress}>
          <Input value={wizardBasic.address} onChange={e => setWizardBasic(b => ({ ...b, address: e.target.value }))} placeholder="123 Main St, City, State" />
        </Field>
      </div>
    );
  }

  function renderWizardStep2() {
    const s = wizardSettings;
    const set = (k: keyof WizardSettings) => (v: number | boolean) =>
      setWizardSettings(prev => ({ ...prev, [k]: v }));
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label={T.admin.fieldDefaultTurn}>
            <NumInput value={s.defaultTurnMinutes} onChange={set('defaultTurnMinutes') as (v: number) => void} min={15} max={480} />
          </Field>
          <Field label={T.admin.fieldSlotInterval}>
            <NumInput value={s.slotIntervalMinutes} onChange={set('slotIntervalMinutes') as (v: number) => void} min={5} max={60} />
          </Field>
          <Field label={T.admin.fieldMaxParty}>
            <NumInput value={s.maxPartySize} onChange={set('maxPartySize') as (v: number) => void} min={1} max={100} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={T.admin.fieldBuffer}>
            <NumInput value={s.bufferBetweenTurnsMinutes} onChange={set('bufferBetweenTurnsMinutes') as (v: number) => void} min={0} max={60} />
          </Field>
          <Field label={T.admin.fieldLastSeating}>
            <NumInput value={s.lastSeatingOffset} onChange={set('lastSeatingOffset') as (v: number) => void} min={0} max={180} />
          </Field>
          <Field label="">
            <label className="flex items-center gap-2 cursor-pointer pt-6">
              <input
                type="checkbox"
                checked={s.autoConfirm}
                onChange={e => set('autoConfirm')(e.target.checked)}
                className="accent-iron-green w-4 h-4"
              />
              <span className="text-sm text-iron-text">{T.admin.fieldAutoConfirm}</span>
            </label>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={T.admin.fieldLateThreshold}>
            <NumInput value={s.lateThresholdMinutes} onChange={set('lateThresholdMinutes') as (v: number) => void} min={1} max={60} />
          </Field>
          <Field label={T.admin.fieldNoShowThreshold}>
            <NumInput value={s.noShowThresholdMinutes} onChange={set('noShowThresholdMinutes') as (v: number) => void} min={5} max={120} />
          </Field>
        </div>
      </div>
    );
  }

  function renderWizardStep3() {
    const fe = wizardUserFieldErrors;
    const set = (k: keyof WizardUser) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setWizardUser(u => ({ ...u, [k]: e.target.value }));
      if (fe[k]) setWizardUserFieldErrors(prev => ({ ...prev, [k]: undefined }));
    };
    return (
      <div className="space-y-4">
        {wizardRestaurantId && (
          <p className="text-xs text-status-warning bg-status-warning/10 rounded px-3 py-2">
            Location added — fix the errors below to add the first user, or skip.
          </p>
        )}
        <p className="text-sm text-iron-muted">Create the first staff member for this restaurant. You can skip this and add users later.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={T.admin.fieldFirstName} error={fe.firstName}>
            <Input value={wizardUser.firstName} onChange={set('firstName')} />
          </Field>
          <Field label={T.admin.fieldLastName} error={fe.lastName}>
            <Input value={wizardUser.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <Field label={T.admin.fieldUserEmail} error={fe.email}>
          <Input type="email" value={wizardUser.email} onChange={set('email')} />
        </Field>
        <Field label={T.admin.fieldPassword} error={fe.password}>
          <Input type="password" value={wizardUser.password} onChange={set('password')} minLength={8} />
        </Field>
        <Field label={T.admin.fieldRole}>
          <select
            value={wizardUser.role}
            onChange={set('role')}
            className={inputCls}
          >
            {['ADMIN', 'MANAGER', 'HOST', 'SERVER'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
    );
  }

  function renderWizard() {
    const steps = [T.admin.step1Title, T.admin.step2Title, T.admin.step3Title];
    const isLastStep = wizardStep === 3;
    const canAdvance1 = wizardBasic.name.trim().length > 0 && /^[a-z0-9-]+$/.test(wizardBasic.slug);

    return (
      <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                i + 1 < wizardStep ? 'bg-iron-green text-black' :
                i + 1 === wizardStep ? 'bg-iron-green/20 text-iron-green border border-iron-green' :
                'bg-iron-surface border border-iron-border text-iron-muted'
              }`}>
                {i + 1 < wizardStep ? '✓' : i + 1}
              </div>
              <span className={`text-sm ${i + 1 === wizardStep ? 'text-iron-text font-medium' : 'text-iron-muted'}`}>{s}</span>
              {i < steps.length - 1 && <div className="flex-1 h-px bg-iron-border mx-2 w-8" />}
            </div>
          ))}
        </div>

        <h2 className="text-xl font-semibold mb-6">{steps[wizardStep - 1]}</h2>

        {wizardStep === 1 && renderWizardStep1()}
        {wizardStep === 2 && renderWizardStep2()}
        {wizardStep === 3 && renderWizardStep3()}

        {wizardError && (
          <p className="mt-4 text-xs text-status-danger bg-status-danger/10 rounded px-3 py-2">{wizardError}</p>
        )}

        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => wizardStep === 1 ? setView('splash') : setWizardStep(s => s - 1)}
            className={btnSecondary}
          >
            {T.admin.wizardBack}
          </button>
          <div className="flex gap-3">
            {isLastStep && (
              <button onClick={() => handleWizardCreate(true)} disabled={wizardBusy} className={btnSecondary}>
                {T.admin.skipUser}
              </button>
            )}
            {isLastStep ? (
              <button
                onClick={() => handleWizardCreate(false)}
                disabled={wizardBusy}
                className={btnPrimary}
              >
                {wizardBusy ? T.admin.wizardCreateBusy : T.admin.wizardCreate}
              </button>
            ) : (
              <button
                onClick={() => setWizardStep(s => s + 1)}
                disabled={wizardStep === 1 && !canAdvance1}
                className={btnPrimary}
              >
                {T.admin.wizardNext}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Detail panels ──────────────────────────────────────────────────────────────

  function renderInfoTab() {
    if (!detail) return null;
    return (
      <div className="space-y-6">
        {/* Counts row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Users',        value: T.admin.users(detail._count.users) },
            { label: 'Tables',       value: T.admin.tables(detail._count.tables) },
            { label: 'Reservations', value: T.admin.reservations(detail._count.reservations) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-iron-surface rounded-lg p-4 border border-iron-border">
              <div className="text-xs text-iron-muted mb-1">{label}</div>
              <div className="text-xl font-bold text-iron-text">{value}</div>
            </div>
          ))}
        </div>

        {editInfo ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <Field label={T.admin.fieldName}><Input value={infoForm.name} onChange={e => setInfoForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label={T.admin.fieldTimezone}><Input value={infoForm.timezone} onChange={e => setInfoForm(f => ({ ...f, timezone: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={T.admin.fieldPhone}><Input value={infoForm.phone} onChange={e => setInfoForm(f => ({ ...f, phone: e.target.value }))} /></Field>
              <Field label={T.admin.fieldEmail}><Input type="email" value={infoForm.email} onChange={e => setInfoForm(f => ({ ...f, email: e.target.value }))} /></Field>
            </div>
            <Field label={T.admin.fieldAddress}><Input value={infoForm.address} onChange={e => setInfoForm(f => ({ ...f, address: e.target.value }))} /></Field>
            {infoError && <p className="text-xs text-status-danger">{infoError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveInfo} disabled={infoBusy} className={btnPrimary}>{infoBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setEditInfo(false); setInfoError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Details</h3>
              {isSuperAdmin && <button onClick={() => setEditInfo(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['Name',     detail.name],
                ['Slug',     detail.slug],
                ['Timezone', detail.timezone],
                ['Phone',    detail.phone ?? '—'],
                ['Email',    detail.email ?? '—'],
                ['Address',  detail.address ?? '—'],
                ['Created',  new Date(detail.createdAt).toLocaleDateString()],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-iron-muted text-xs mb-0.5">{k}</dt>
                  <dd className="text-iron-text">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Sample layout */}
        <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm mb-1">{T.admin.sampleLayoutBtn}</h3>
              <p className="text-xs text-iron-muted">Seeds 2 sections and 8 default tables. Deletes any existing tables.</p>
            </div>
            <button
              onClick={handleSampleLayout}
              disabled={layoutBusy}
              className="px-3 py-1.5 text-xs border border-iron-border rounded hover:bg-iron-bg text-iron-muted hover:text-iron-text disabled:opacity-50"
            >
              {layoutBusy ? T.admin.sampleLayoutBusy : T.admin.sampleLayoutBtn}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderSettingsTab() {
    if (!detail) return null;
    const s = detail.settings as Record<string, unknown>;
    return (
      <div className="space-y-4">
        {editSettings ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            {renderWizardStep2()}
            {settingsError && (
              <p className="text-status-danger text-xs">{settingsError}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveSettings} disabled={settingsBusy} className={btnPrimary}>{settingsBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setEditSettings(false); setSettingsError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Service settings</h3>
              {isSuperAdmin && <button onClick={() => { setWizardSettings(settingsForm); setEditSettings(true); }} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['Default turn time',   `${s.defaultTurnMinutes ?? 90}m`],
                ['Slot interval',       `${s.slotIntervalMinutes ?? 30}m`],
                ['Max party size',      String(s.maxPartySize ?? 20)],
                ['Auto-confirm',        s.autoConfirm ? 'Yes' : 'No'],
                ['Turn buffer',         `${s.bufferBetweenTurnsMinutes ?? 15}m`],
                ['Last seating offset', `${s.lastSeatingOffset ?? 60}m`],
                ['Late threshold',      `${s.lateThresholdMinutes ?? 5}m`],
                ['No-show threshold',   `${s.noShowThresholdMinutes ?? 15}m`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-iron-muted text-xs mb-0.5">{k}</dt>
                  <dd className="text-iron-text">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Weekly Schedule */}
        {editSchedule ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium">Weekly Schedule</h3>
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
            {scheduleError && <p className="text-xs text-status-danger">{scheduleError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveSchedule} disabled={scheduleBusy} className={btnPrimary}>{scheduleBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setEditSchedule(false); setScheduleError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Weekly Schedule</h3>
              {isSuperAdmin && <button onClick={() => setEditSchedule(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
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
        )}

        {/* Online Booking Restrictions */}
        <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Online Booking Restrictions</h3>
            {!showAddRestriction && (
              <button
                onClick={() => { setShowAddRestriction(true); setRestrictionError(null); }}
                className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
              >+ Add rule</button>
            )}
          </div>
          <p className="text-[11px] text-iron-muted mb-4">
            Blocks online guest booking for specific dates or time windows.
            Staff can still create reservations manually from this dashboard.
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
                  <Input
                    type="date"
                    value={restrictionForm.date}
                    onChange={e => setRestrictionForm(f => ({ ...f, date: e.target.value }))}
                  />
                </Field>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="restrictionFullDay"
                    checked={restrictionForm.fullDay}
                    onChange={e => setRestrictionForm(f => ({ ...f, fullDay: e.target.checked }))}
                    className="w-4 h-4 cursor-pointer accent-iron-green"
                  />
                  <label htmlFor="restrictionFullDay" className="text-sm text-iron-text cursor-pointer select-none">Full day</label>
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

        {/* WhatsApp Integration */}
        {editWhatsapp ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium">WhatsApp Integration</h3>
            <Field label="UltraMsg Instance ID">
              <Input
                value={whatsappForm.instanceId}
                onChange={e => setWhatsappForm(f => ({ ...f, instanceId: e.target.value }))}
                placeholder="instance123456"
              />
            </Field>
            <Field label="UltraMsg Token (leave blank to keep existing)">
              <Input
                type="password"
                value={whatsappForm.token}
                onChange={e => setWhatsappForm(f => ({ ...f, token: e.target.value }))}
                placeholder="••••••••"
              />
            </Field>
            <Field label="Test Phone Number (international format, e.g. +972501234567)">
              <Input
                value={whatsappForm.phone}
                onChange={e => setWhatsappForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+972501234567"
              />
            </Field>
            {whatsappError && <p className="text-xs text-status-danger">{whatsappError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveWhatsapp} disabled={whatsappBusy} className={btnPrimary}>{whatsappBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setEditWhatsapp(false); setWhatsappError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">WhatsApp Integration</h3>
              {isSuperAdmin && <button
                onClick={() => { setEditWhatsapp(true); setWhatsappError(null); }}
                className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
              >{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-4">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Instance ID</dt>
                <dd className="text-iron-text">{detail?.ultramsgInstanceId ?? <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Token</dt>
                <dd className="text-iron-text">{detail?.tokenSet ? '••••••••' : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Test phone</dt>
                <dd className="text-iron-text">{detail?.whatsappPhone ?? <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Status</dt>
                <dd>
                  {detail?.ultramsgInstanceId && detail?.tokenSet
                    ? <span className="text-iron-green text-xs font-medium">Configured</span>
                    : <span className="text-status-warning text-xs font-medium">Not configured — messages will not send</span>}
                </dd>
              </div>
            </dl>
            {detail?.ultramsgInstanceId && detail?.tokenSet && detail?.whatsappPhone && (
              <div>
                {whatsappError && <p className="text-xs text-status-danger mb-2">{whatsappError}</p>}
                <button
                  onClick={handleTestWhatsapp}
                  disabled={whatsappTestBusy}
                  className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg disabled:opacity-50"
                >{whatsappTestBusy ? 'Sending…' : 'Send test message'}</button>
              </div>
            )}
          </div>
        )}

        {/* SMS Service */}
        {editSms ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium">SMS Service</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={smsForm.enabled}
                onChange={e => setSmsForm(f => ({ ...f, enabled: e.target.checked }))}
              />
              Enable SMS for this restaurant
            </label>
            <Field label="Provider">
              <select
                value={smsForm.provider}
                onChange={e => setSmsForm(f => ({ ...f, provider: e.target.value }))}
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-sm text-iron-text"
              >
                <option value="MOCK">MOCK (testing — does not send)</option>
                <option value="INFORU">InforU (live)</option>
              </select>
            </Field>
            <Field label="Sender name (must be pre-approved with InforU, max 11 chars)">
              <Input
                value={smsForm.senderName}
                onChange={e => setSmsForm(f => ({ ...f, senderName: e.target.value.slice(0, 11) }))}
                placeholder="e.g. NAJMA"
              />
            </Field>
            {smsError && <p className="text-xs text-status-danger">{smsError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveSms} disabled={smsBusy} className={btnPrimary}>{smsBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setEditSms(false); setSmsError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">SMS Service</h3>
              {isSuperAdmin && <button
                onClick={() => { setEditSms(true); setSmsError(null); }}
                className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
              >{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-4">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Status</dt>
                <dd>
                  {smsForm.enabled
                    ? <span className="text-iron-green text-xs font-medium">Enabled</span>
                    : <span className="text-status-warning text-xs font-medium">Disabled — no SMS will send</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Provider</dt>
                <dd className="text-iron-text">{smsForm.provider}{smsForm.provider === 'MOCK' && <span className="text-iron-muted"> (test only)</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Sender name</dt>
                <dd className="text-iron-text">{smsForm.senderName || <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
            </dl>
            {isSuperAdmin && smsForm.enabled && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-iron-border/60">
                <span className="text-xs text-iron-muted mt-3">Send a test SMS to:</span>
                <input
                  value={smsTestPhone}
                  onChange={e => setSmsTestPhone(e.target.value)}
                  placeholder="+972501234567"
                  className="mt-3 bg-iron-bg border border-iron-border rounded px-2 py-1 text-xs text-iron-text w-44"
                />
                <button
                  onClick={handleTestSms}
                  disabled={smsTestBusy}
                  className="mt-3 text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg disabled:opacity-50"
                >{smsTestBusy ? 'Sending…' : 'Send test SMS'}</button>
                {smsError && <p className="w-full text-xs text-status-danger mt-1">{smsError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Public Branding */}
        {editBranding ? (
          <div className="space-y-8">

            {/* Two-column layout: controls | phone preview */}
            <div className="flex gap-8 items-start">

              {/* ── LEFT: Settings ─────────────────────────────────────────── */}
              <div className="flex-1 min-w-0 space-y-10">

                {/* Brand Identity */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">Brand Identity</p>

                  {/* Cuisine */}
                  <div className="mb-6">
                    <p className="text-xs text-iron-text font-medium mb-0.5">Cuisine type</p>
                    <p className="text-[11px] text-iron-muted mb-2">Shown on the Guest Hub under the restaurant name. Use a short descriptor like "Italian · Fine Dining" or "Mediterranean · Casual".</p>
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <input
                        value={brandingForm.cuisine}
                        onChange={e => setBrandingForm(f => ({ ...f, cuisine: e.target.value }))}
                        placeholder="e.g. Italian · Fine Dining"
                        maxLength={80}
                        className="flex-1 bg-transparent text-sm text-iron-text placeholder-iron-muted/30 focus:outline-none"
                      />
                      {brandingForm.cuisine && (
                        <span className="text-iron-muted text-[10px] tabular-nums shrink-0">{brandingForm.cuisine.length}/80</span>
                      )}
                    </div>
                  </div>

                  {/* Logo */}
                  <div className="flex items-start gap-4 mb-6">
                    <div
                      className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      {(logoPreview || brandingForm.logoUrl) ? (
                        <img src={logoPreview ?? brandingForm.logoUrl} alt="logo" className="object-contain max-h-[60px] max-w-[68px]" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <span className="text-white/20 text-3xl font-extralight">{(detail?.name ?? 'R').charAt(0)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-iron-text font-medium mb-0.5">Logo</p>
                      <p className="text-[11px] text-iron-muted mb-2.5">PNG · SVG · WEBP · transparent background recommended</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className={`inline-flex items-center gap-1.5 text-xs border border-iron-border rounded-lg px-3 py-1.5 cursor-pointer ${logoUpload.progress !== null ? 'opacity-50 pointer-events-none' : 'hover:bg-iron-bg text-iron-muted hover:text-iron-text'}`}>
                          <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="hidden"
                            onChange={async e => {
                              const file = e.target.files?.[0]; if (!file) return;
                              if (logoPreview) URL.revokeObjectURL(logoPreview);
                              setLogoPreview(URL.createObjectURL(file));
                              setLogoUpload({ progress: null, error: null });
                              const valErr = validateImageFile(file, 'logo');
                              if (valErr) { setLogoUpload({ progress: null, error: valErr }); return; }
                              if (!cloudinaryConfigured()) return;
                              setLogoUpload({ progress: 0, error: null });
                              try {
                                const result = await uploadToCloudinary(file, `iron-booking/restaurants/${selectedId}/logo`, pct => setLogoUpload(u => ({ ...u, progress: pct })));
                                setBrandingForm(f => ({ ...f, logoUrl: result.secure_url }));
                                setLogoUpload({ progress: null, error: null });
                              } catch (err) {
                                setLogoUpload({ progress: null, error: err instanceof Error ? err.message : 'Upload failed' });
                              }
                            }}
                          />
                          {logoUpload.progress !== null ? `${logoUpload.progress}%` : '↑ Upload'}
                        </label>
                        {brandingForm.logoUrl && (
                          <button type="button" onClick={() => { setBrandingForm(f => ({ ...f, logoUrl: '' })); setLogoPreview(p => { if (p) URL.revokeObjectURL(p); return null; }); }} className="text-[11px] text-iron-muted hover:text-status-danger transition-colors">Remove</button>
                        )}
                      </div>
                      {logoUpload.progress !== null && <div className="h-1 bg-iron-border rounded-full overflow-hidden mt-2"><div className="h-full bg-iron-green rounded-full transition-all" style={{ width: `${logoUpload.progress}%` }} /></div>}
                      {logoUpload.error && <p className="text-[11px] text-status-danger mt-1">{logoUpload.error}</p>}
                      <p className="text-[10px] text-iron-muted/50 mt-3 mb-1">Or paste a public URL:</p>
                      <Input value={brandingForm.logoUrl} onChange={e => setBrandingForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…" />
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] text-iron-muted mb-2">Primary color</p>
                      <div className="flex items-center gap-2">
                        <input type="color" value={brandingForm.primaryColor || '#22C55E'} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                        <Input value={brandingForm.primaryColor} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} placeholder="#22C55E" className="font-mono text-xs" />
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-iron-muted mb-2">Accent color</p>
                      <div className="flex items-center gap-2">
                        <input type="color" value={brandingForm.accentColor || '#22C55E'} onChange={e => setBrandingForm(f => ({ ...f, accentColor: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                        <Input value={brandingForm.accentColor} onChange={e => setBrandingForm(f => ({ ...f, accentColor: e.target.value }))} placeholder="#45D4BE" className="font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Hero Media */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">Hero Media</p>

                  {!cloudinaryConfigured() && (
                    <div className="rounded-xl border border-status-warning/20 bg-status-warning/5 px-4 py-3 text-xs text-status-warning/80 mb-5 space-y-1">
                      <p className="font-medium text-status-warning">Image upload not configured</p>
                      <p className="text-status-warning/70">Add <code className="font-mono bg-black/20 px-1 rounded">VITE_CLOUDINARY_CLOUD_NAME</code> and <code className="font-mono bg-black/20 px-1 rounded">VITE_CLOUDINARY_UPLOAD_PRESET</code> to Vercel and redeploy. Until then, paste URLs directly.</p>
                    </div>
                  )}

                  {/* Cover image */}
                  <div className="mb-5">
                    <p className="text-xs text-iron-text font-medium mb-0.5">Cover image</p>
                    <p className="text-[11px] text-iron-muted mb-3">Fills the cinematic hero section on the public page. Minimum 1200 px wide.</p>
                    <div
                      className="relative rounded-xl overflow-hidden border mb-3 group"
                      style={{ height: 180, background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
                    >
                      {(coverPreview || brandingForm.coverImageUrl) ? (
                        <img src={coverPreview ?? brandingForm.coverImageUrl} alt="cover" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-iron-muted/30">
                          <svg viewBox="0 0 24 24" className="w-8 h-8 mb-1.5" fill="none" stroke="currentColor" strokeWidth={1.2}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                          <span className="text-xs">No cover image</span>
                        </div>
                      )}
                      <label className={`absolute inset-0 flex items-end justify-center pb-4 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${coverUpload.progress !== null ? 'pointer-events-none' : ''}`}>
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          onChange={async e => {
                            const file = e.target.files?.[0]; if (!file) return;
                            if (coverPreview) URL.revokeObjectURL(coverPreview);
                            setCoverPreview(URL.createObjectURL(file));
                            setCoverUpload({ progress: null, error: null });
                            const valErr = validateImageFile(file, 'cover');
                            if (valErr) { setCoverUpload({ progress: null, error: valErr }); return; }
                            if (!cloudinaryConfigured()) return;
                            setCoverUpload({ progress: 0, error: null });
                            try {
                              const result = await uploadToCloudinary(file, `iron-booking/restaurants/${selectedId}/cover`, pct => setCoverUpload(u => ({ ...u, progress: pct })));
                              setBrandingForm(f => ({ ...f, coverImageUrl: result.secure_url }));
                              setCoverUpload({ progress: null, error: null });
                            } catch (err) {
                              setCoverUpload({ progress: null, error: err instanceof Error ? err.message : 'Upload failed' });
                            }
                          }}
                        />
                        <span className="text-white text-xs font-medium bg-black/60 rounded-lg px-4 py-2">{coverUpload.progress !== null ? `Uploading ${coverUpload.progress}%` : '↑ Upload cover image'}</span>
                      </label>
                      {coverUpload.progress !== null && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                          <div className="h-full bg-iron-green transition-all" style={{ width: `${coverUpload.progress}%` }} />
                        </div>
                      )}
                    </div>
                  {coverUpload.error && <p className="text-[11px] text-status-danger mt-2">{coverUpload.error}</p>}
                    <p className="text-[10px] text-iron-muted/50 mt-3 mb-1">Or paste a public URL:</p>
                    <Input value={brandingForm.coverImageUrl} onChange={e => setBrandingForm(f => ({ ...f, coverImageUrl: e.target.value }))} placeholder="https://…" className="text-xs" />
                  </div>

                  {/* Hero video */}
                  <div>
                    <p className="text-xs text-iron-text font-medium mb-0.5">Hero video</p>
                    <p className="text-[11px] text-iron-muted mb-2">Muted autoplay on public page. Falls back to cover image when unavailable.</p>
                    <Input value={brandingForm.heroVideoUrl} onChange={e => setBrandingForm(f => ({ ...f, heroVideoUrl: e.target.value }))} placeholder="https://cdn.example.com/hero.mp4" className="text-xs" />
                  </div>
                </section>

                {/* Theme & Colors */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">Theme &amp; Colors</p>

                  {/* Theme preset visual cards */}
                  <div className="mb-7">
                    <p className="text-xs text-iron-text font-medium mb-3">Theme preset</p>
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { value: '',              label: 'Iron',      bg: 'linear-gradient(135deg,#10161e,#080c14)', accent: '#22C55E' },
                        { value: 'italiano',      label: 'Italiano',  bg: 'linear-gradient(135deg,#1c1710,#0e0b06)', accent: '#b5792a' },
                        { value: 'fineDining',    label: 'Elegant',   bg: 'linear-gradient(135deg,#0e0e12,#060609)', accent: '#c8b8f0' },
                        { value: 'luxury',        label: 'Luxury',    bg: 'linear-gradient(135deg,#12100a,#060502)', accent: '#d4b45a' },
                        { value: 'mediterranean', label: 'Med',       bg: 'linear-gradient(135deg,#0a1220,#060e1a)', accent: '#4fb8c8' },
                        { value: 'minimal',       label: 'Minimal',   bg: 'linear-gradient(135deg,#0d0e10,#060708)', accent: '#e8e4dc' },
                        { value: 'casual',        label: 'Casual',    bg: 'linear-gradient(135deg,#1a1208,#0e0b04)', accent: '#e89030' },
                        { value: 'nightlife',     label: 'Night',     bg: 'linear-gradient(135deg,#120a1e,#080510)', accent: '#a060e0' },
                      ] as Array<{ value: string; label: string; bg: string; accent: string }>).map(preset => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setBrandingForm(f => ({ ...f, publicThemePreset: preset.value }))}
                          className={`relative rounded-xl overflow-hidden border transition-all text-left ${brandingForm.publicThemePreset === preset.value ? 'border-iron-green ring-1 ring-iron-green/30' : 'border-white/8 hover:border-white/20'}`}
                          style={{ height: 64 }}
                        >
                          <div className="absolute inset-0" style={{ background: preset.bg }} />
                          <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5" style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.72),transparent)' }}>
                            <div className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: preset.accent }} />
                              <span className="text-[10px] text-white/80 font-medium leading-none">{preset.label}</span>
                            </div>
                          </div>
                          {brandingForm.publicThemePreset === preset.value && (
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-iron-green flex items-center justify-center">
                              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth={2}><polyline points="1.5,5 4,7.5 8.5,2.5" /></svg>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Background mood */}
                  <div className="mb-6">
                    <p className="text-xs text-iron-text font-medium mb-3">Background mood</p>
                    <div className="grid grid-cols-5 gap-2">
                      {([
                        { value: 'dark',     label: 'Dark',     bg: 'linear-gradient(135deg,#101520,#080a10)' },
                        { value: 'espresso', label: 'Espresso', bg: 'linear-gradient(135deg,#1c1710,#0e0b06)' },
                        { value: 'olive',    label: 'Olive',    bg: 'linear-gradient(135deg,#111610,#080c06)' },
                        { value: 'cream',    label: 'Cream',    bg: 'linear-gradient(135deg,#1a1710,#0d0b06)' },
                        { value: 'warm',     label: 'Warm',     bg: 'linear-gradient(135deg,#1a1408,#0d0a04)' },
                      ] as Array<{ value: string; label: string; bg: string }>).map(mood => (
                        <button
                          key={mood.value}
                          type="button"
                          onClick={() => setBrandingForm(f => ({ ...f, backgroundMood: mood.value }))}
                          className={`relative rounded-lg overflow-hidden border transition-all ${brandingForm.backgroundMood === mood.value ? 'border-iron-green' : 'border-white/8 hover:border-white/20'}`}
                          style={{ height: 44 }}
                        >
                          <div className="absolute inset-0" style={{ background: mood.bg }} />
                          <div className="absolute inset-x-0 bottom-0 flex justify-center pb-1">
                            <span className="text-[9px] text-white/50">{mood.label}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom background */}
                  <div>
                    <p className="text-xs text-iron-text font-medium mb-1">Custom background <span className="text-iron-muted font-normal text-[11px]">(overrides mood preset)</span></p>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <p className="text-[10px] text-iron-muted mb-1.5">Base color</p>
                        <div className="flex items-center gap-2">
                          <input type="color" value={brandingForm.backgroundColorHex || '#0b0f18'} onChange={e => setBrandingForm(f => ({ ...f, backgroundColorHex: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                          <Input value={brandingForm.backgroundColorHex} onChange={e => setBrandingForm(f => ({ ...f, backgroundColorHex: e.target.value }))} placeholder="#0b0f18" className="font-mono text-xs" />
                          {brandingForm.backgroundColorHex && (
                            <button type="button" onClick={() => setBrandingForm(f => ({ ...f, backgroundColorHex: '', backgroundGradientHex: '' }))} className="text-iron-muted hover:text-iron-text text-xs shrink-0" title="Clear">✕</button>
                          )}
                        </div>
                        {brandingForm.backgroundColorHex && (() => {
                          const m = brandingForm.backgroundColorHex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
                          if (!m) return null;
                          const lum = [m[1], m[2], m[3]].reduce((acc, c, i) => {
                            const v = parseInt(c, 16) / 255;
                            return acc + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
                          }, 0);
                          return lum > 0.12 ? <p className="text-[11px] text-status-warning mt-1">⚠ Too light — white text may be unreadable</p> : null;
                        })()}
                      </div>
                      <div>
                        <p className="text-[10px] text-iron-muted mb-1.5">Gradient end (optional)</p>
                        <div className="flex items-center gap-2">
                          <input type="color" value={brandingForm.backgroundGradientHex || brandingForm.backgroundColorHex || '#080a10'} onChange={e => setBrandingForm(f => ({ ...f, backgroundGradientHex: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                          <Input value={brandingForm.backgroundGradientHex} onChange={e => setBrandingForm(f => ({ ...f, backgroundGradientHex: e.target.value }))} placeholder="#080a10" className="font-mono text-xs" />
                        </div>
                      </div>
                    </div>
                    {brandingForm.backgroundColorHex && (
                      <div className="rounded-xl h-8 mt-3 border border-white/8" style={{ background: brandingForm.backgroundGradientHex ? `linear-gradient(168deg,${brandingForm.backgroundColorHex} 0%,${brandingForm.backgroundGradientHex} 100%)` : brandingForm.backgroundColorHex }} />
                    )}
                  </div>
                </section>

                {/* Style */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">Style</p>
                  <div className="space-y-5">
                    <StyleTileGroup
                      label="Button style"
                      value={brandingForm.buttonStyle}
                      onChange={v => setBrandingForm(f => ({ ...f, buttonStyle: v }))}
                      options={[
                        { value: 'rounded', label: 'Rounded', preview: <div className="w-full h-5 rounded-lg border border-current opacity-60" /> },
                        { value: 'pill',    label: 'Pill',    preview: <div className="w-full h-5 rounded-full border border-current opacity-60" /> },
                        { value: 'sharp',   label: 'Sharp',   preview: <div className="w-full h-5 rounded-sm border border-current opacity-60" /> },
                        { value: 'luxury',  label: 'Luxury',  preview: <div className="w-full h-5 rounded border border-status-warning/50 opacity-60 tracking-widest text-status-warning text-[8px] flex items-center justify-center">RSRV</div> },
                      ]}
                    />
                    <StyleTileGroup
                      label="Card style"
                      value={brandingForm.cardStyle}
                      onChange={v => setBrandingForm(f => ({ ...f, cardStyle: v }))}
                      options={[
                        { value: 'glass',       label: 'Glass',  preview: <div className="w-full h-6 rounded-lg" style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.14)' }} /> },
                        { value: 'solid',       label: 'Solid',  preview: <div className="w-full h-6 rounded-lg" style={{ background: 'rgba(10,12,18,0.97)', border: '1px solid rgba(255,255,255,0.07)' }} /> },
                        { value: 'luxury-dark', label: 'Luxury', preview: <div className="w-full h-6 rounded-lg" style={{ background: 'rgba(6,5,3,0.97)', border: '1px solid rgba(210,175,80,0.30)' }} /> },
                        { value: 'soft-light',  label: 'Soft',   preview: <div className="w-full h-6 rounded-lg" style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.22)' }} /> },
                      ]}
                    />
                  </div>
                </section>

                {/* Social & Navigation */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">Social &amp; Navigation</p>
                  <div className="space-y-2">
                    {([
                      { key: 'websiteUrl',    label: 'Website',     placeholder: 'https://yourrestaurant.com', icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg> },
                      { key: 'instagramUrl',  label: 'Instagram',   placeholder: 'https://instagram.com/yourpage', icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg> },
                      { key: 'googleMapsUrl', label: 'Google Maps', placeholder: 'https://maps.google.com/?q=…', icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg> },
                      { key: 'wazeUrl',       label: 'Waze',        placeholder: 'https://waze.com/ul?ll=…', icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg> },
                    ] as Array<{ key: keyof typeof brandingForm; label: string; placeholder: string; icon: ReactNode }>).map(({ key, label, placeholder, icon }) => (
                      <div key={key} className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <span className="text-iron-muted/50 shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-iron-muted/60 mb-0.5">{label}</p>
                          <input
                            value={brandingForm[key] as string}
                            onChange={e => setBrandingForm(f => ({ ...f, [key]: e.target.value }))}
                            placeholder={placeholder}
                            className="w-full bg-transparent text-xs text-iron-text placeholder-iron-muted/30 focus:outline-none"
                          />
                        </div>
                        {(brandingForm[key] as string) && <span className="text-iron-green text-[10px] shrink-0">✓</span>}
                      </div>
                    ))}
                  </div>
                </section>

              </div>{/* /left panel */}

              {/* ── RIGHT: Phone mockup preview ─────────────────────────────── */}
              <div className="w-[220px] shrink-0 sticky top-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-4">Live preview</p>
                <div
                  className="relative rounded-[32px] overflow-hidden mx-auto"
                  style={{
                    width: 220,
                    height: 440,
                    border: '2px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.05)',
                    background: '#060810',
                  }}
                >
                  {/* Notch */}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-5 rounded-b-xl z-20" style={{ background: '#060810' }} />
                  <div className="absolute inset-0 overflow-hidden rounded-[30px]">
                    <BrandingPreviewCard
                      primaryColor={brandingForm.primaryColor}
                      logoUrl={logoPreview ?? brandingForm.logoUrl}
                      restaurantName={detail?.name ?? 'Restaurant'}
                      buttonStyle={brandingForm.buttonStyle}
                      cardStyle={brandingForm.cardStyle}
                      backgroundMood={brandingForm.backgroundMood}
                      backgroundColorHex={brandingForm.backgroundColorHex}
                      backgroundGradientHex={brandingForm.backgroundGradientHex}
                      coverImageUrl={coverPreview ?? brandingForm.coverImageUrl}
                    />
                  </div>
                </div>
              </div>

            </div>{/* /two-column */}

            {/* Action bar */}
            {brandingError && <p className="text-xs text-status-danger mt-2">{brandingError}</p>}
            <div className="flex flex-wrap gap-3 pt-6 border-t border-white/5 mt-2">
              <button onClick={handleSaveBranding} disabled={brandingBusy} className={btnPrimary}>{brandingBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button
                onClick={() => {
                  setBrandingForm({ cuisine: '', primaryColor: '', accentColor: '', publicThemePreset: '', logoUrl: '', coverImageUrl: '', heroVideoUrl: '', buttonStyle: '', cardStyle: '', backgroundMood: '', backgroundColorHex: '', backgroundGradientHex: '', websiteUrl: '', instagramUrl: '', googleMapsUrl: '', wazeUrl: '' });
                  setLogoPreview(p => { if (p) URL.revokeObjectURL(p); return null; });
                  setCoverPreview(p => { if (p) URL.revokeObjectURL(p); return null; });
                  setBrandingError(null);
                }}
                className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg text-iron-muted hover:text-iron-text"
              >Reset branding</button>
              <button onClick={() => { setEditBranding(false); setBrandingError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
              {detail?.slug && (
                <a href={`/book/${detail.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg text-iron-muted hover:text-iron-text">Preview public page ↗</a>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Public Page Branding</h3>
              <div className="flex items-center gap-2">
                {detail?.slug && (
                  <a href={`/book/${detail.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">Preview ↗</a>
                )}
                {isSuperAdmin && <button onClick={() => { setEditBranding(true); setBrandingError(null); }} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Primary color</dt>
                <dd className="flex items-center gap-2">
                  {detail?.primaryColor ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.primaryColor }} /><span className="text-iron-text font-mono text-xs">{detail.primaryColor}</span></> : <span className="text-iron-muted italic">Iron default</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Accent color</dt>
                <dd className="flex items-center gap-2">
                  {detail?.accentColor ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.accentColor }} /><span className="text-iron-text font-mono text-xs">{detail.accentColor}</span></> : <span className="text-iron-muted italic">Not set</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Theme preset</dt>
                <dd className="text-iron-text capitalize">{detail?.publicThemePreset ?? <span className="text-iron-muted italic">None</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Button style</dt>
                <dd className="text-iron-text capitalize">{detail?.buttonStyle ?? <span className="text-iron-muted italic">Default</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Card style</dt>
                <dd className="text-iron-text capitalize">{detail?.cardStyle ?? <span className="text-iron-muted italic">Glass</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Background mood</dt>
                <dd className="text-iron-text capitalize">{detail?.backgroundMood ?? <span className="text-iron-muted italic">Dark</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Custom background</dt>
                <dd className="flex items-center gap-2">
                  {detail?.backgroundColorHex ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.backgroundGradientHex ? `linear-gradient(168deg,${detail.backgroundColorHex},${detail.backgroundGradientHex})` : detail.backgroundColorHex }} /><span className="text-iron-text font-mono text-xs">{detail.backgroundColorHex}{detail.backgroundGradientHex ? ` → ${detail.backgroundGradientHex}` : ''}</span></> : <span className="text-iron-muted italic">Not set</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Logo</dt>
                <dd>{detail?.logoUrl ? <img src={detail.logoUrl} alt="logo" className="h-6 object-contain" /> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-iron-muted text-xs mb-0.5">Cover image</dt>
                <dd>{detail?.coverImageUrl ? <div className="mt-1 rounded-md overflow-hidden border border-iron-border" style={{ height: 64 }}><img src={detail.coverImageUrl} alt="cover" className="w-full h-full object-cover" /></div> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Website</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.websiteUrl ? <a href={detail.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.websiteUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Instagram</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.instagramUrl ? <a href={detail.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.instagramUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Google Maps</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.googleMapsUrl ? <a href={detail.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.googleMapsUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Waze</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.wazeUrl ? <a href={detail.wazeUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.wazeUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
            </dl>
          </div>
        )}

        {/* Restaurant Portal Access */}
        <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
          <div className="mb-4">
            <h3 className="font-medium mb-1">Restaurant Portal Access</h3>
            <p className="text-[11px] text-iron-muted">These controls decide what the restaurant can manage inside its own portal.</p>
          </div>
          <div className="space-y-3">
            {([
              { key: 'canManageOperatingHours'     as const, label: 'Manage Operating Hours' },
              { key: 'canManageOnlineRestrictions' as const, label: 'Manage Online Booking Restrictions' },
            ] as const).map(({ key, label }) => {
              const enabled = detail?.portalPermissions?.[key] ?? false;
              return (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-iron-text">{label}</span>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    disabled={portalPermBusy}
                    onClick={() => handleTogglePortalPerm(key)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${enabled ? 'bg-iron-green' : 'bg-iron-border'}`}
                  >
                    <span className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              );
            })}
          </div>
          {portalPermError && <p className="text-xs text-status-danger mt-3">{portalPermError}</p>}
        </div>
      </div>
    );
  }

  function renderUsersTab() {
    return (
      <div className="space-y-4">
        <div className="bg-iron-surface rounded-lg border border-iron-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-iron-border">
                {[T.admin.colName, T.admin.colEmail, T.admin.colRole, T.admin.colActive, T.admin.colLastLogin, ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-iron-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-iron-muted text-sm">No users yet</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="border-b border-iron-border last:border-0 hover:bg-iron-bg">
                  <td className="px-4 py-3 font-medium">{u.firstName} {u.lastName}</td>
                  <td className="px-4 py-3 text-iron-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-iron-bg border border-iron-border rounded text-xs">{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`w-2 h-2 rounded-full inline-block ${u.isActive ? 'bg-iron-green' : 'bg-iron-muted'}`} />
                  </td>
                  <td className="px-4 py-3 text-iron-muted">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : T.admin.neverLoggedIn}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggleUser(u)}
                      className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-surface"
                    >
                      {u.isActive ? T.admin.deactivateBtn : T.admin.activateBtn}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showAddUser ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium text-sm">{T.admin.addUser}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={T.admin.fieldFirstName} error={userFieldErrors.firstName}>
                <Input
                  value={userForm.firstName}
                  onChange={e => { setUserForm(u => ({ ...u, firstName: e.target.value })); setUserFieldErrors(fe => ({ ...fe, firstName: undefined })); }}
                />
              </Field>
              <Field label={T.admin.fieldLastName} error={userFieldErrors.lastName}>
                <Input
                  value={userForm.lastName}
                  onChange={e => { setUserForm(u => ({ ...u, lastName: e.target.value })); setUserFieldErrors(fe => ({ ...fe, lastName: undefined })); }}
                />
              </Field>
            </div>
            <Field label={T.admin.fieldUserEmail} error={userFieldErrors.email}>
              <Input
                type="email"
                value={userForm.email}
                onChange={e => { setUserForm(u => ({ ...u, email: e.target.value })); setUserFieldErrors(fe => ({ ...fe, email: undefined })); }}
              />
            </Field>
            <Field label={T.admin.fieldPassword} error={userFieldErrors.password}>
              <Input
                type="password"
                value={userForm.password}
                onChange={e => { setUserForm(u => ({ ...u, password: e.target.value })); setUserFieldErrors(fe => ({ ...fe, password: undefined })); }}
                minLength={8}
              />
            </Field>
            <Field label={T.admin.fieldRole}>
              <select value={userForm.role} onChange={e => setUserForm(u => ({ ...u, role: e.target.value }))} className={inputCls}>
                {['ADMIN', 'MANAGER', 'HOST', 'SERVER'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            {userError && <p className="text-xs text-status-danger">{userError}</p>}
            <div className="flex gap-3">
              <button onClick={handleAddUser} disabled={userBusy} className={btnPrimary}>{userBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setShowAddUser(false); setUserError(null); setUserFieldErrors({}); setUserForm(DEFAULT_USER); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : isSuperAdmin ? (
          <button onClick={() => setShowAddUser(true)} className={btnSecondary + ' w-full text-center'}>
            {T.admin.addUser}
          </button>
        ) : null}
      </div>
    );
  }

  function renderDetail() {
    if (detailBusy) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (!detail) return null;

    const tabs: Array<{ id: 'info' | 'settings' | 'users' | 'guest-hub'; label: string }> = [
      { id: 'info',      label: T.admin.tabInfo      },
      { id: 'settings',  label: T.admin.tabSettings  },
      { id: 'users',     label: T.admin.tabUsers     },
      { id: 'guest-hub', label: T.admin.tabGuestHub  },
    ];

    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Detail header */}
        <div className="px-8 pt-6 pb-0 border-b border-iron-border">
          <h2 className="text-xl font-semibold mb-4">{detail.name}</h2>
          <div className="flex gap-0">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-iron-green text-iron-text'
                    : 'border-transparent text-iron-muted hover:text-iron-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'info'      && renderInfoTab()}
          {activeTab === 'settings'  && renderSettingsTab()}
          {activeTab === 'users'     && renderUsersTab()}
          {activeTab === 'guest-hub' && <GuestHubCmsPanel restaurantId={detail.id} />}
        </div>
      </div>
    );
  }

  // ── Group panels ──────────────────────────────────────────────────────────────

  function renderCreateGroup() {
    return (
      <div className="flex-1 overflow-y-auto p-8 max-w-lg">
        <h2 className="text-lg font-semibold mb-6">{T.admin.newGroup}</h2>
        <div className="space-y-4">
          <Field label={T.admin.groupName}>
            <Input
              value={groupName}
              onChange={e => {
                const n = e.target.value;
                const s = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                setGroupName(n);
                setGroupSlug(s);
              }}
              placeholder="e.g. Northern Region"
              required
            />
          </Field>
          <Field label={T.admin.groupSlug}>
            <Input
              value={groupSlug}
              onChange={e => setGroupSlug(e.target.value)}
              placeholder="e.g. northern-region"
              pattern="[a-z0-9-]+"
            />
          </Field>
          {groupError && <p className="text-sm text-status-danger">{groupError}</p>}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCreateGroup}
              disabled={groupBusy || !groupName.trim() || !groupSlug.trim()}
              className={btnPrimary}
            >
              {groupBusy ? T.admin.wizardCreateBusy : T.admin.createRestaurant}
            </button>
            <button onClick={() => setView('splash')} className={btnSecondary}>{T.admin.cancelBtn}</button>
          </div>
        </div>
      </div>
    );
  }

  function renderSmsUsage() {
    const rows = smsUsage?.restaurants ?? [];
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">SMS Usage</h2>
              <p className="text-iron-muted text-sm mt-0.5">How many SMS each restaurant actually sent.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={smsUsageMonth}
                onChange={e => { setSmsUsageMonth(e.target.value); loadSmsUsage(e.target.value || undefined); }}
                className="bg-iron-bg border border-iron-border rounded px-3 py-1.5 text-sm text-iron-text"
              />
            </div>
          </div>

          {smsUsageLoading ? (
            <div className="flex justify-center p-10">
              <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-iron-surface rounded-lg p-4 border border-iron-border">
                  <div className="text-2xl font-semibold text-iron-green">{smsUsage?.totals.sent ?? 0}</div>
                  <div className="text-xs text-iron-muted mt-1">Sent ({smsUsage?.month ?? '—'})</div>
                </div>
                <div className="bg-iron-surface rounded-lg p-4 border border-iron-border">
                  <div className="text-2xl font-semibold text-status-danger">{smsUsage?.totals.failed ?? 0}</div>
                  <div className="text-xs text-iron-muted mt-1">Failed</div>
                </div>
                <div className="bg-iron-surface rounded-lg p-4 border border-iron-border">
                  <div className="text-2xl font-semibold text-iron-muted">{smsUsage?.totals.mock ?? 0}</div>
                  <div className="text-xs text-iron-muted mt-1">Mock (not live)</div>
                </div>
              </div>

              <div className="bg-iron-surface rounded-lg border border-iron-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-iron-muted border-b border-iron-border">
                      <th className="px-4 py-3 font-medium">Restaurant</th>
                      <th className="px-4 py-3 font-medium">SMS</th>
                      <th className="px-4 py-3 font-medium text-right">Sent</th>
                      <th className="px-4 py-3 font-medium text-right">Failed</th>
                      <th className="px-4 py-3 font-medium text-right">Mock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-iron-muted">No restaurants</td></tr>
                    ) : rows.map(r => (
                      <tr key={r.restaurantId} className="border-b border-iron-border/60 last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-iron-text">{r.name}</div>
                          {r.smsSenderName && <div className="text-xs text-iron-muted">sender: {r.smsSenderName}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {r.smsEnabled
                            ? <span className="text-iron-green text-xs font-medium">{r.smsProvider === 'INFORU' ? 'Live' : 'Enabled (test)'}</span>
                            : <span className="text-iron-muted text-xs">Off</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{r.sent}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-status-danger">{r.failed || ''}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-iron-muted">{r.mock || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderGroupDetail() {
    if (groupDetailBusy || !groupDetail) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    const memberIds = new Set(groupDetail.restaurants.map(r => r.id));
    const assignable = restaurants.filter(r => !memberIds.has(r.id));

    // Compute tonight aggregate across all locations in the group
    const allStats = groupDetail.restaurants.map(r => tonightStatsMap[r.id]).filter(Boolean);
    const totalBooked   = allStats.reduce((s, x) => s + x.booked, 0);
    const totalSeated   = allStats.reduce((s, x) => s + x.seated, 0);
    const totalLate     = allStats.reduce((s, x) => s + x.late, 0);
    const totalUpcoming = allStats.reduce((s, x) => s + x.upcoming, 0);
    const hasActivity   = totalBooked > 0 || totalSeated > 0;

    const bookingOrigin = window.location.origin;

    return (
      <div className="flex-1 overflow-y-auto p-8 space-y-8">

        {/* Group header */}
        <div>
          <h2 className="text-xl font-bold">{groupDetail.name}</h2>
          <p className="text-xs text-iron-muted mt-1">/{groupDetail.slug}</p>
        </div>

        {/* Tonight aggregate bar */}
        <div className="rounded-xl border border-iron-border bg-iron-surface px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-iron-muted uppercase tracking-wide">Tonight</span>
            {groupDetail.restaurants.length > 0 && (
              <span className="text-xs text-iron-muted">{groupDetail.restaurants.length} location{groupDetail.restaurants.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {tonightLoading ? (
            <div className="flex items-center gap-2 text-xs text-iron-muted">
              <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          ) : !hasActivity ? (
            <p className="text-sm text-iron-muted">Quiet tonight</p>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-semibold">{totalBooked} <span className="font-normal text-iron-muted text-xs">booked</span></span>
              <span className="text-sm font-semibold text-iron-green">{totalSeated} <span className="font-normal text-iron-muted text-xs">seated</span></span>
              {totalUpcoming > 0 && (
                <span className="text-sm font-semibold text-status-reserved">{totalUpcoming} <span className="font-normal text-iron-muted text-xs">arriving soon</span></span>
              )}
              {totalLate > 0 && (
                <span className="text-sm font-semibold text-status-warning">{totalLate} <span className="font-normal text-iron-muted text-xs">late</span></span>
              )}
            </div>
          )}
        </div>

        {/* Member locations */}
        <section>
          <h3 className="text-sm font-semibold text-iron-muted uppercase tracking-wide mb-3">{T.admin.groupMembers}</h3>
          {groupDetail.restaurants.length === 0 ? (
            <p className="text-sm text-iron-muted">{T.admin.noRestaurants}</p>
          ) : (
            <div className="space-y-2">
              {groupDetail.restaurants.map(r => {
                const s = tonightStatsMap[r.id];
                const isMenuOpen = openActionsId === r.id;
                const bookingUrl = `${bookingOrigin}/book/${r.slug}`;

                return (
                  <div key={r.id} className="flex items-center justify-between bg-iron-surface border border-iron-border rounded px-4 py-3 gap-3">
                    {/* Identity */}
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="text-xs text-iron-muted ml-2">/{r.slug}</span>
                    </div>

                    {/* Tonight chips */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {tonightLoading && !s && (
                        <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
                      )}
                      {s && (s.booked > 0 || s.seated > 0) ? (
                        <>
                          {s.booked > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-iron-bg border border-iron-border text-iron-muted">
                              {s.booked}b
                            </span>
                          )}
                          {s.seated > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-iron-green/15 text-iron-green border border-iron-green/20">
                              {s.seated}s
                            </span>
                          )}
                          {s.upcoming > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-status-reserved/10 text-status-reserved border border-status-reserved/20">
                              +{s.upcoming}
                            </span>
                          )}
                          {s.late > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-status-warning/10 text-status-warning border border-status-warning/20">
                              {s.late}⚠
                            </span>
                          )}
                        </>
                      ) : s ? (
                        <span className="text-xs text-iron-muted/50">quiet</span>
                      ) : null}
                    </div>

                    {/* Actions menu */}
                    <div className="relative flex-shrink-0" onMouseDown={e => e.stopPropagation()}>
                      <button
                        onClick={() => setOpenActionsId(isMenuOpen ? null : r.id)}
                        className="w-7 h-7 flex items-center justify-center rounded text-iron-muted hover:text-iron-text hover:bg-iron-bg border border-transparent hover:border-iron-border transition-colors text-base leading-none"
                        title="More actions"
                      >⋮</button>

                      {isMenuOpen && (
                        <div className="absolute right-0 top-8 z-20 w-52 bg-iron-surface border border-iron-border rounded-lg shadow-xl py-1 text-sm">
                          <button
                            onClick={() => { selectRestaurant(r.id); setOpenActionsId(null); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2"
                          >
                            <span className="text-iron-muted text-xs">⚙</span> View Details
                          </button>
                          <button
                            onClick={() => { selectRestaurant(r.id, 'settings'); setOpenActionsId(null); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2"
                          >
                            <span className="text-iron-muted text-xs">✎</span> Location Settings
                          </button>
                          <div className="border-t border-iron-border my-1" />
                          <a
                            href={bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpenActionsId(null)}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2 block"
                          >
                            <span className="text-iron-muted text-xs">↗</span> Open Booking Page
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(bookingUrl);
                              showToast('Booking URL copied');
                              setOpenActionsId(null);
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2"
                          >
                            <span className="text-iron-muted text-xs">⧉</span> Copy Booking URL
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Remove (SUPER_ADMIN only) */}
                    {isSuperAdmin && (
                      <button
                        onClick={() => handleRemoveFromGroup(r.id)}
                        className="text-xs text-status-danger hover:text-status-danger flex-shrink-0"
                      >{T.admin.removeFromGroup}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Assign location (SUPER_ADMIN only) */}
          {isSuperAdmin && assignable.length > 0 && (
            <div className="flex gap-2 mt-3">
              <select
                value={assignId}
                onChange={e => setAssignId(e.target.value)}
                className="flex-1 bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              >
                <option value="">{T.admin.assignLocation}…</option>
                {assignable.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button
                onClick={handleAssignToGroup}
                disabled={!assignId || assignBusy}
                className={btnPrimary}
              >{assignBusy ? '…' : T.admin.addToGroup}</button>
            </div>
          )}
        </section>

        {/* HQ Admins */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-iron-muted uppercase tracking-wide">{T.admin.groupAdmins}</h3>
            {!showAddHqUser && (
              <button onClick={() => setShowAddHqUser(true)} className="text-xs text-iron-green hover:underline">
                {T.admin.createHqUser}
              </button>
            )}
          </div>
          {groupDetail.users.length === 0 && !showAddHqUser && (
            <p className="text-sm text-iron-muted">{T.admin.noHqAdmins}</p>
          )}
          {groupDetail.users.length > 0 && (
            <div className="space-y-2 mb-4">
              {groupDetail.users.map(u => (
                <div key={u.id} className="flex items-center justify-between bg-iron-surface border border-iron-border rounded px-4 py-2.5">
                  <div>
                    <span className="text-sm font-medium">{u.firstName} {u.lastName}</span>
                    <span className="text-xs text-iron-muted ml-2">{u.email}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${u.isActive ? 'bg-iron-green/20 text-iron-green' : 'bg-red-900/20 text-status-danger'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {showAddHqUser && (
            <div className="border border-iron-border rounded p-4 space-y-3 bg-iron-surface">
              <div className="grid grid-cols-2 gap-3">
                <Field label={T.admin.fieldFirstName}>
                  <Input value={hqUserForm.firstName} onChange={e => setHqUserForm(f => ({ ...f, firstName: e.target.value }))} />
                </Field>
                <Field label={T.admin.fieldLastName}>
                  <Input value={hqUserForm.lastName} onChange={e => setHqUserForm(f => ({ ...f, lastName: e.target.value }))} />
                </Field>
              </div>
              <Field label={T.admin.fieldUserEmail}>
                <Input type="email" value={hqUserForm.email} onChange={e => setHqUserForm(f => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label={T.admin.fieldPassword}>
                <Input type="password" value={hqUserForm.password} onChange={e => setHqUserForm(f => ({ ...f, password: e.target.value }))} />
              </Field>
              {hqUserError && <p className="text-xs text-status-danger">{hqUserError}</p>}
              <div className="flex gap-2">
                <button onClick={handleCreateHqUser} disabled={hqUserBusy} className={btnPrimary}>
                  {hqUserBusy ? T.admin.wizardCreateBusy : T.admin.createHqUser}
                </button>
                <button onClick={() => { setShowAddHqUser(false); setHqUserError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  // ── Root render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-iron-bg text-iron-text">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-iron-border bg-iron-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold">Iron Booking</span>
          <span className="text-xs px-2 py-0.5 bg-iron-green/20 text-iron-green rounded font-medium">Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-iron-muted">{auth.user.email ?? ''}</span>
          <button
            onClick={() => setHqTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-iron-border text-iron-muted hover:text-iron-text hover:bg-iron-bg transition-colors text-base"
            title={hqTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {hqTheme === 'dark' ? '☀' : '☾'}
          </button>
          {onDashboard && (
            <button
              onClick={onDashboard}
              className="text-sm text-iron-muted hover:text-iron-text px-3 py-1.5 rounded hover:bg-iron-bg border border-iron-border"
            >
              View Dashboard
            </button>
          )}
          <button
            onClick={onLogout}
            className="text-sm text-iron-muted hover:text-iron-text px-3 py-1.5 rounded hover:bg-iron-bg"
          >
            {T.admin.logout}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — hidden for RESTAURANT_ADMIN (single restaurant, no switching) */}
        {!isRestaurantAdmin && <div className="w-64 border-r border-iron-border flex flex-col bg-iron-surface flex-shrink-0 overflow-hidden">
          {/* Locations / Groups tabs — SUPER_ADMIN only */}
          {isSuperAdmin && (
            <div className="flex border-b border-iron-border flex-shrink-0">
              <button
                onClick={() => { setSidebarTab('locations'); setView('splash'); setSelectedGroupId(null); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === 'locations' ? 'text-iron-green border-b-2 border-iron-green' : 'text-iron-muted hover:text-iron-text'}`}
              >{T.admin.restaurants}</button>
              <button
                onClick={() => { setSidebarTab('groups'); setView('splash'); setSelectedId(null); if (groups.length === 0) loadGroups(); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === 'groups' ? 'text-iron-green border-b-2 border-iron-green' : 'text-iron-muted hover:text-iron-text'}`}
              >{T.admin.groups}</button>
              <button
                onClick={openSmsUsage}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === 'sms' ? 'text-iron-green border-b-2 border-iron-green' : 'text-iron-muted hover:text-iron-text'}`}
              >SMS</button>
            </div>
          )}

          {/* Locations panel */}
          {sidebarTab === 'locations' && (<>
            {isSuperAdmin && (
              <div className="p-4 border-b border-iron-border flex-shrink-0">
                <button onClick={openCreate} className="w-full px-3 py-2 bg-iron-green text-black font-semibold rounded text-sm">
                  {T.admin.newRestaurant}
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {listLoading ? (
                <div className="flex justify-center p-4">
                  <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                </div>
              ) : restaurants.length === 0 ? (
                <p className="text-iron-muted text-sm text-center p-6">{T.admin.noRestaurants}</p>
              ) : (
                restaurants.map(r => (
                  <button
                    key={r.id}
                    onClick={() => selectRestaurant(r.id)}
                    className={`w-full text-left px-4 py-3 border-b border-iron-border hover:bg-iron-bg transition-colors ${
                      selectedId === r.id ? 'border-l-2 border-l-iron-green bg-iron-bg' : ''
                    }`}
                  >
                    <div className="font-medium text-sm truncate">{r.name}</div>
                    <div className="text-xs text-iron-muted mt-0.5">
                      {r._count.users}u · {r._count.tables}t · {r._count.reservations}r
                      {r.groupId && <span className="ml-1 text-iron-green/70">●</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </>)}

          {/* Groups panel (SUPER_ADMIN only) */}
          {sidebarTab === 'groups' && (<>
            <div className="p-4 border-b border-iron-border flex-shrink-0">
              <button onClick={openCreateGroup} className="w-full px-3 py-2 bg-iron-green text-black font-semibold rounded text-sm">
                {T.admin.newGroup}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {groupsLoading ? (
                <div className="flex justify-center p-4">
                  <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                </div>
              ) : groups.length === 0 ? (
                <p className="text-iron-muted text-sm text-center p-6">{T.admin.noGroups}</p>
              ) : (
                groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => selectGroup(g.id)}
                    className={`w-full text-left px-4 py-3 border-b border-iron-border hover:bg-iron-bg transition-colors ${
                      selectedGroupId === g.id ? 'border-l-2 border-l-iron-green bg-iron-bg' : ''
                    }`}
                  >
                    <div className="font-medium text-sm truncate">{g.name}</div>
                    <div className="text-xs text-iron-muted mt-0.5">{g._count.restaurants} locations · {g._count.users} admins</div>
                  </button>
                ))
              )}
            </div>
          </>)}
        </div>}

        {/* Main content */}
        <PanelErrorBoundary resetKey={`${view}-${selectedId ?? ''}-${selectedGroupId ?? ''}`}>
          <div className="flex-1 overflow-hidden flex">
            {view === 'splash' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-iron-muted text-sm">
                    {sidebarTab === 'groups'
                      ? (groups.length === 0 ? T.admin.noGroupsHint : 'Select a group or create a new one')
                      : (restaurants.length === 0 ? T.admin.noRestaurantsHint : T.admin.selectOrCreate)}
                  </p>
                </div>
              </div>
            )}
            {view === 'create'        && renderWizard()}
            {view === 'detail'        && renderDetail()}
            {view === 'create-group'  && renderCreateGroup()}
            {view === 'group-detail'  && renderGroupDetail()}
            {view === 'sms-usage'     && renderSmsUsage()}
          </div>
        </PanelErrorBoundary>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-iron-green text-black px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
