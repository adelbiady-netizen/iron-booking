import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, ApiError } from '../../api';
import { useT } from '../../i18n/useT';
import { validateImageFile, uploadToCloudinary, cloudinaryConfigured } from '../../utils/cloudinaryUpload';
import type { AdminGroup, AdminGroupDetail, AdminRestaurant, AdminRestaurantDetail, AdminUser, AuthState, LocationTonightStats } from '../../types';

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

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className="block text-xs text-iron-muted mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
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
  backgroundColorHex, backgroundGradientHex,
}: {
  primaryColor: string; logoUrl: string; restaurantName: string;
  buttonStyle: string; cardStyle: string; backgroundMood: string;
  backgroundColorHex: string; backgroundGradientHex: string;
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

  // Custom color overrides mood preset in preview
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
    <div
      className="rounded-xl overflow-hidden border border-white/10"
      style={{ ...bgStyle, padding: '16px' }}
    >
      {/* Restaurant header */}
      <div className="flex flex-col items-center gap-2 mb-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center border"
          style={{ background: 'rgba(16,20,34,0.72)', borderColor: 'rgba(255,255,255,0.12)' }}
        >
          {logoUrl
            ? <img src={logoUrl} alt="logo" className="object-contain h-7 max-w-[40px]" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : <span className="text-white/70 text-lg font-light">{initial}</span>}
        </div>
        <p className="text-white/80 text-xs font-medium">{restaurantName}</p>
      </div>

      {/* Card surface preview */}
      <div
        className="rounded-xl p-3 mb-2"
        style={{
          background: cardBg,
          border: `1px solid ${cardBorder}`,
          backdropFilter: cardStyle === 'solid' ? 'none' : 'blur(20px)',
        }}
      >
        {/* Time slots */}
        <div className="flex flex-col gap-1.5 mb-2.5">
          {['7:00 PM', '7:30 PM', '8:00 PM'].map((slot, i) => (
            <div
              key={slot}
              className="px-3 py-1.5 text-center text-xs font-medium"
              style={i === 1 ? {
                background: hex,
                color: '#fff',
                borderRadius: btnRadius,
                boxShadow: `0 0 12px ${hex}44`,
              } : {
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'rgba(255,255,255,0.55)',
                borderRadius: btnRadius,
              }}
            >{slot}</div>
          ))}
        </div>
        {/* CTA button */}
        <div
          className="w-full py-2 text-center text-xs font-semibold"
          style={{ background: hex, color: '#fff', borderRadius: btnRadius, letterSpacing: buttonStyle === 'luxury' ? '0.10em' : undefined }}
        >Reserve a table</div>
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
  const isSuperAdmin = auth.user.role === 'SUPER_ADMIN';

  const [view,       setView]       = useState<'splash' | 'create' | 'detail' | 'create-group' | 'group-detail'>('splash');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail,     setDetail]     = useState<AdminRestaurantDetail | null>(null);
  const [users,      setUsers]      = useState<AdminUser[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [activeTab,  setActiveTab]  = useState<'info' | 'settings' | 'users'>('info');

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
  const [sidebarTab,      setSidebarTab]      = useState<'locations' | 'groups'>('locations');
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

  // Branding edit state
  const [editBranding,   setEditBranding]   = useState(false);
  const [brandingForm,   setBrandingForm]   = useState({ primaryColor: '', accentColor: '', publicThemePreset: '', logoUrl: '', coverImageUrl: '', heroVideoUrl: '', buttonStyle: '', cardStyle: '', backgroundMood: '', backgroundColorHex: '', backgroundGradientHex: '', websiteUrl: '', instagramUrl: '', googleMapsUrl: '', wazeUrl: '' });
  const [brandingBusy,   setBrandingBusy]   = useState(false);
  const [brandingError,  setBrandingError]  = useState<string | null>(null);
  const [logoPreview,    setLogoPreview]    = useState<string | null>(null);
  const [coverPreview,   setCoverPreview]   = useState<string | null>(null);
  const [logoUpload,     setLogoUpload]     = useState<{ progress: number | null; error: string | null }>({ progress: null, error: null });
  const [coverUpload,    setCoverUpload]    = useState<{ progress: number | null; error: string | null }>({ progress: null, error: null });

  // Weekly schedule edit state
  const [editSchedule,  setEditSchedule]  = useState(false);
  const [scheduleRows,  setScheduleRows]  = useState<ScheduleRow[]>(DEFAULT_SCHEDULE);
  const [scheduleBusy,  setScheduleBusy]  = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

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

  const loadDetail = useCallback(async (id: string) => {
    setDetailBusy(true);
    try {
      const [d, u] = await Promise.all([
        api.admin.restaurants.get(id),
        api.admin.users.list(id),
      ]);
      setDetail(d);
      setUsers(u);
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
      setBrandingForm({ primaryColor: d.primaryColor ?? '', accentColor: d.accentColor ?? '', publicThemePreset: d.publicThemePreset ?? '', logoUrl: d.logoUrl ?? '', coverImageUrl: d.coverImageUrl ?? '', heroVideoUrl: d.heroVideoUrl ?? '', buttonStyle: d.buttonStyle ?? '', cardStyle: d.cardStyle ?? '', backgroundMood: d.backgroundMood ?? '', backgroundColorHex: d.backgroundColorHex ?? '', backgroundGradientHex: d.backgroundGradientHex ?? '', websiteUrl: d.websiteUrl ?? '', instagramUrl: d.instagramUrl ?? '', googleMapsUrl: d.googleMapsUrl ?? '', wazeUrl: d.wazeUrl ?? '' });
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

  function selectRestaurant(id: string, tab: 'info' | 'settings' | 'users' = 'info') {
    setSelectedId(id);
    setView('detail');
    setActiveTab(tab);
    setEditInfo(false);
    setEditSettings(false);
    setEditWhatsapp(false);
    setEditBranding(false);
    setShowAddUser(false);
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

  async function handleSaveBranding() {
    if (!selectedId) return;
    setBrandingBusy(true);
    setBrandingError(null);
    try {
      const result = await api.admin.restaurants.updateBranding(selectedId, {
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
  const btnPrimary = 'px-4 py-2 bg-iron-green text-black font-semibold rounded text-sm disabled:opacity-50';
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
          <p className="text-xs text-amber-400 bg-amber-400/10 rounded px-3 py-2">
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
          <p className="mt-4 text-xs text-red-400 bg-red-400/10 rounded px-3 py-2">{wizardError}</p>
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
            {infoError && <p className="text-xs text-red-400">{infoError}</p>}
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
              <p className="text-red-400 text-xs">{settingsError}</p>
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
            {scheduleError && <p className="text-xs text-red-400">{scheduleError}</p>}
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
            {whatsappError && <p className="text-xs text-red-400">{whatsappError}</p>}
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
                    : <span className="text-amber-400 text-xs font-medium">Not configured — messages will not send</span>}
                </dd>
              </div>
            </dl>
            {detail?.ultramsgInstanceId && detail?.tokenSet && detail?.whatsappPhone && (
              <div>
                {whatsappError && <p className="text-xs text-red-400 mb-2">{whatsappError}</p>}
                <button
                  onClick={handleTestWhatsapp}
                  disabled={whatsappTestBusy}
                  className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg disabled:opacity-50"
                >{whatsappTestBusy ? 'Sending…' : 'Send test message'}</button>
              </div>
            )}
          </div>
        )}

        {/* Public Branding */}
        {editBranding ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-5">
            <h3 className="font-medium">Public Page Branding</h3>

            {/* Colors + preset */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Primary color (hex)">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandingForm.primaryColor || '#22C55E'}
                    onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))}
                    className="w-9 h-9 rounded border border-iron-border bg-transparent cursor-pointer"
                  />
                  <Input
                    value={brandingForm.primaryColor}
                    onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))}
                    placeholder="#22C55E"
                  />
                </div>
              </Field>
              <Field label="Accent color (hex)">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandingForm.accentColor || '#22C55E'}
                    onChange={e => setBrandingForm(f => ({ ...f, accentColor: e.target.value }))}
                    className="w-9 h-9 rounded border border-iron-border bg-transparent cursor-pointer"
                  />
                  <Input
                    value={brandingForm.accentColor}
                    onChange={e => setBrandingForm(f => ({ ...f, accentColor: e.target.value }))}
                    placeholder="#45D4BE"
                  />
                </div>
              </Field>
            </div>

            <Field label="Theme preset (overridden by custom color if set)">
              <select
                value={brandingForm.publicThemePreset}
                onChange={e => setBrandingForm(f => ({ ...f, publicThemePreset: e.target.value }))}
                className="w-full bg-iron-bg border border-iron-border rounded-md px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
              >
                <option value="">— No preset (Iron default) —</option>
                <option value="italiano">Italiano (espresso · olive)</option>
                <option value="fineDining">Elegant Dark</option>
                <option value="luxury">Modern Luxury</option>
                <option value="mediterranean">Mediterranean</option>
                <option value="minimal">Japanese Minimal</option>
                <option value="casual">Casual Warm</option>
                <option value="family">Family (green)</option>
                <option value="nightlife">Nightlife (purple)</option>
              </select>
            </Field>

            {/* Cloudinary config notice */}
            {!cloudinaryConfigured() && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300 space-y-1">
                <p className="font-semibold">Image upload not configured</p>
                <p className="text-amber-400/80">Add two env vars to your Vercel frontend project, then redeploy:</p>
                <pre className="text-[10px] bg-black/20 rounded px-2 py-1 font-mono select-all">VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name{'\n'}VITE_CLOUDINARY_UPLOAD_PRESET=your-unsigned-preset</pre>
                <p className="text-amber-400/80">Get both for free at <span className="underline">cloudinary.com</span> → Settings → Upload presets (set mode: Unsigned).</p>
                <p className="text-amber-400/80">Until then, paste a public image URL directly into the field below.</p>
              </div>
            )}

            {/* Logo upload */}
            <Field label="Logo (PNG/SVG/WEBP/JPG · max 2 MB · transparent background recommended)">
              <div className="flex items-center gap-2 mb-2">
                <label className={`flex items-center gap-1.5 text-xs border border-iron-border rounded px-3 py-1.5 text-iron-muted cursor-pointer shrink-0 ${logoUpload.progress !== null ? 'opacity-50 pointer-events-none' : 'hover:bg-iron-bg hover:text-iron-text'}`}>
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/webp,image/jpeg"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      // Always show local preview immediately
                      if (logoPreview) URL.revokeObjectURL(logoPreview);
                      setLogoPreview(URL.createObjectURL(file));
                      setLogoUpload({ progress: null, error: null });
                      // Validate
                      const valErr = validateImageFile(file, 'logo');
                      if (valErr) { setLogoUpload({ progress: null, error: valErr }); return; }
                      // Upload if configured
                      if (!cloudinaryConfigured()) return; // stay on local preview
                      setLogoUpload({ progress: 0, error: null });
                      try {
                        const result = await uploadToCloudinary(
                          file,
                          `iron-booking/restaurants/${selectedId}/logo`,
                          pct => setLogoUpload(u => ({ ...u, progress: pct })),
                        );
                        setBrandingForm(f => ({ ...f, logoUrl: result.secure_url }));
                        setLogoUpload({ progress: null, error: null });
                      } catch (err) {
                        setLogoUpload({ progress: null, error: err instanceof Error ? err.message : 'Upload failed' });
                      }
                    }}
                  />
                  {logoUpload.progress !== null ? `Uploading ${logoUpload.progress}%` : 'Upload image'}
                </label>
                {logoUpload.progress !== null && (
                  <div className="flex-1 h-1.5 bg-iron-border rounded-full overflow-hidden">
                    <div className="h-full bg-iron-green rounded-full transition-all" style={{ width: `${logoUpload.progress}%` }} />
                  </div>
                )}
              </div>
              {logoUpload.error && <p className="text-[11px] text-red-400 mb-1">{logoUpload.error}</p>}
              {(logoPreview || brandingForm.logoUrl) && (
                <div className="mb-2 flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg border border-iron-border bg-iron-bg flex items-center justify-center overflow-hidden shrink-0">
                    <img
                      src={logoPreview ?? brandingForm.logoUrl}
                      alt="logo preview"
                      className="object-contain max-h-[52px] max-w-[56px]"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <div className="text-xs text-iron-muted">
                    {brandingForm.logoUrl && !brandingForm.logoUrl.startsWith('blob:')
                      ? <p className="text-iron-green text-[11px]">✓ Uploaded and saved</p>
                      : !cloudinaryConfigured()
                        ? <p className="text-amber-400 text-[11px]">Local preview · configure Cloudinary to upload</p>
                        : null}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-iron-muted mb-1">Advanced: paste a public URL directly</p>
              <Input
                value={brandingForm.logoUrl}
                onChange={e => setBrandingForm(f => ({ ...f, logoUrl: e.target.value }))}
                placeholder="https://res.cloudinary.com/… or any public URL"
              />
            </Field>

            {/* Cover image upload */}
            <Field label="Cover / hero image (PNG/JPG/WEBP · max 5 MB · ≥1200px wide recommended)">
              <div className="flex items-center gap-2 mb-2">
                <label className={`flex items-center gap-1.5 text-xs border border-iron-border rounded px-3 py-1.5 text-iron-muted cursor-pointer shrink-0 ${coverUpload.progress !== null ? 'opacity-50 pointer-events-none' : 'hover:bg-iron-bg hover:text-iron-text'}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (coverPreview) URL.revokeObjectURL(coverPreview);
                      setCoverPreview(URL.createObjectURL(file));
                      setCoverUpload({ progress: null, error: null });
                      const valErr = validateImageFile(file, 'cover');
                      if (valErr) { setCoverUpload({ progress: null, error: valErr }); return; }
                      if (!cloudinaryConfigured()) return;
                      setCoverUpload({ progress: 0, error: null });
                      try {
                        const result = await uploadToCloudinary(
                          file,
                          `iron-booking/restaurants/${selectedId}/cover`,
                          pct => setCoverUpload(u => ({ ...u, progress: pct })),
                        );
                        setBrandingForm(f => ({ ...f, coverImageUrl: result.secure_url }));
                        setCoverUpload({ progress: null, error: null });
                      } catch (err) {
                        setCoverUpload({ progress: null, error: err instanceof Error ? err.message : 'Upload failed' });
                      }
                    }}
                  />
                  {coverUpload.progress !== null ? `Uploading ${coverUpload.progress}%` : 'Upload image'}
                </label>
                {coverUpload.progress !== null && (
                  <div className="flex-1 h-1.5 bg-iron-border rounded-full overflow-hidden">
                    <div className="h-full bg-iron-green rounded-full transition-all" style={{ width: `${coverUpload.progress}%` }} />
                  </div>
                )}
              </div>
              {coverUpload.error && <p className="text-[11px] text-red-400 mb-1">{coverUpload.error}</p>}
              {(coverPreview || brandingForm.coverImageUrl) && (
                <div className="mb-2">
                  <div className="rounded-lg overflow-hidden border border-iron-border" style={{ height: 96 }}>
                    <img
                      src={coverPreview ?? brandingForm.coverImageUrl}
                      alt="cover preview"
                      className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  {brandingForm.coverImageUrl && !brandingForm.coverImageUrl.startsWith('blob:') && (
                    <p className="text-[11px] text-iron-green mt-1">✓ Uploaded and saved</p>
                  )}
                  {!cloudinaryConfigured() && coverPreview && (
                    <p className="text-[11px] text-amber-400 mt-1">Local preview · configure Cloudinary to upload</p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-iron-muted mb-1">Advanced: paste a public URL directly</p>
              <Input
                value={brandingForm.coverImageUrl}
                onChange={e => setBrandingForm(f => ({ ...f, coverImageUrl: e.target.value }))}
                placeholder="https://res.cloudinary.com/… or any public URL"
              />
            </Field>

            {/* Hero video URL */}
            <Field label="Hero video URL (muted autoplay; MP4 recommended)">
              <Input
                value={brandingForm.heroVideoUrl}
                onChange={e => setBrandingForm(f => ({ ...f, heroVideoUrl: e.target.value }))}
                placeholder="https://cdn.example.com/hero.mp4"
              />
              <p className="text-[11px] text-iron-muted mt-1">Plays silently on the public booking page. Falls back to cover image if unavailable or on reduced-motion devices.</p>
            </Field>

            {/* Button style */}
            <StyleTileGroup
              label="Button style"
              value={brandingForm.buttonStyle}
              onChange={v => setBrandingForm(f => ({ ...f, buttonStyle: v }))}
              options={[
                { value: 'rounded', label: 'Rounded', preview: <div className="w-full h-5 rounded-lg border border-current opacity-60" /> },
                { value: 'pill',    label: 'Pill',    preview: <div className="w-full h-5 rounded-full border border-current opacity-60" /> },
                { value: 'sharp',   label: 'Sharp',   preview: <div className="w-full h-5 rounded-sm border border-current opacity-60" /> },
                { value: 'luxury',  label: 'Luxury',  preview: <div className="w-full h-5 rounded border border-amber-400/50 opacity-60 tracking-widest text-amber-400 text-[8px] flex items-center justify-center">RSRV</div> },
              ]}
            />

            {/* Card style */}
            <StyleTileGroup
              label="Card style"
              value={brandingForm.cardStyle}
              onChange={v => setBrandingForm(f => ({ ...f, cardStyle: v }))}
              options={[
                { value: 'glass',       label: 'Glass',   preview: <div className="w-full h-6 rounded-lg" style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.14)' }} /> },
                { value: 'solid',       label: 'Solid',   preview: <div className="w-full h-6 rounded-lg" style={{ background: 'rgba(10,12,18,0.97)', border: '1px solid rgba(255,255,255,0.07)' }} /> },
                { value: 'luxury-dark', label: 'Luxury',  preview: <div className="w-full h-6 rounded-lg" style={{ background: 'rgba(6,5,3,0.97)', border: '1px solid rgba(210,175,80,0.30)' }} /> },
                { value: 'soft-light',  label: 'Soft',    preview: <div className="w-full h-6 rounded-lg" style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.22)' }} /> },
              ]}
            />

            {/* Background mood preset */}
            <StyleTileGroup
              label="Background mood (preset)"
              value={brandingForm.backgroundMood}
              onChange={v => setBrandingForm(f => ({ ...f, backgroundMood: v }))}
              options={[
                { value: 'dark',     label: 'Dark',     preview: <div className="w-full h-6 rounded" style={{ background: 'linear-gradient(135deg,#101520,#080a10)' }} /> },
                { value: 'espresso', label: 'Espresso', preview: <div className="w-full h-6 rounded" style={{ background: 'linear-gradient(135deg,#1c1710,#0e0b06)' }} /> },
                { value: 'olive',    label: 'Olive',    preview: <div className="w-full h-6 rounded" style={{ background: 'linear-gradient(135deg,#111610,#080c06)' }} /> },
                { value: 'cream',    label: 'Cream',    preview: <div className="w-full h-6 rounded" style={{ background: 'linear-gradient(135deg,#1a1710,#0d0b06)' }} /> },
                { value: 'warm',     label: 'Warm',     preview: <div className="w-full h-6 rounded" style={{ background: 'linear-gradient(135deg,#1a1408,#0d0a04)' }} /> },
              ]}
            />

            {/* Custom background color (overrides mood preset when set) */}
            <div className="space-y-3">
              <label className="block text-xs text-iron-muted">
                Custom background color
                <span className="ml-1 text-iron-muted/60">(overrides mood preset)</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Base color (hex)">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingForm.backgroundColorHex || '#0b0f18'}
                      onChange={e => setBrandingForm(f => ({ ...f, backgroundColorHex: e.target.value }))}
                      className="w-9 h-9 rounded border border-iron-border bg-transparent cursor-pointer shrink-0"
                    />
                    <Input
                      value={brandingForm.backgroundColorHex}
                      onChange={e => setBrandingForm(f => ({ ...f, backgroundColorHex: e.target.value }))}
                      placeholder="#0b0f18"
                    />
                    {brandingForm.backgroundColorHex && (
                      <button
                        type="button"
                        onClick={() => setBrandingForm(f => ({ ...f, backgroundColorHex: '', backgroundGradientHex: '' }))}
                        className="text-iron-muted hover:text-iron-text text-xs shrink-0"
                        title="Clear custom color"
                      >✕</button>
                    )}
                  </div>
                  {/* Contrast warning */}
                  {brandingForm.backgroundColorHex && (() => {
                    const m = brandingForm.backgroundColorHex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
                    if (!m) return null;
                    const lum = [m[1], m[2], m[3]].reduce((acc, c, i) => {
                      const v = parseInt(c, 16) / 255;
                      return acc + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
                    }, 0);
                    return lum > 0.12
                      ? <p className="text-[11px] text-amber-400 mt-1">⚠ Background too light — white text may be unreadable. Use a value darker than #303030.</p>
                      : null;
                  })()}
                </Field>
                <Field label="Gradient end color (optional)">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandingForm.backgroundGradientHex || brandingForm.backgroundColorHex || '#080a10'}
                      onChange={e => setBrandingForm(f => ({ ...f, backgroundGradientHex: e.target.value }))}
                      className="w-9 h-9 rounded border border-iron-border bg-transparent cursor-pointer shrink-0"
                    />
                    <Input
                      value={brandingForm.backgroundGradientHex}
                      onChange={e => setBrandingForm(f => ({ ...f, backgroundGradientHex: e.target.value }))}
                      placeholder="#080a10"
                    />
                  </div>
                </Field>
              </div>
              {brandingForm.backgroundColorHex && (
                <div
                  className="rounded-lg h-10 border border-white/10"
                  style={{
                    background: brandingForm.backgroundGradientHex
                      ? `linear-gradient(168deg, ${brandingForm.backgroundColorHex} 0%, ${brandingForm.backgroundGradientHex} 100%)`
                      : brandingForm.backgroundColorHex,
                  }}
                />
              )}
            </div>

            {/* Navigation & social links */}
            <div className="space-y-3">
              <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider">Navigation &amp; social links</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Website URL">
                  <Input value={brandingForm.websiteUrl} onChange={e => setBrandingForm(f => ({ ...f, websiteUrl: e.target.value }))} placeholder="https://yourrestaurant.com" />
                </Field>
                <Field label="Instagram URL">
                  <Input value={brandingForm.instagramUrl} onChange={e => setBrandingForm(f => ({ ...f, instagramUrl: e.target.value }))} placeholder="https://instagram.com/yourpage" />
                </Field>
                <Field label="Google Maps URL">
                  <Input value={brandingForm.googleMapsUrl} onChange={e => setBrandingForm(f => ({ ...f, googleMapsUrl: e.target.value }))} placeholder="https://maps.google.com/?q=..." />
                </Field>
                <Field label="Waze URL">
                  <Input value={brandingForm.wazeUrl} onChange={e => setBrandingForm(f => ({ ...f, wazeUrl: e.target.value }))} placeholder="https://waze.com/ul?ll=..." />
                </Field>
              </div>
            </div>

            {/* Live preview */}
            <div>
              <p className="text-iron-muted text-xs font-semibold uppercase tracking-wider mb-2">Live preview</p>
              <BrandingPreviewCard
                primaryColor={brandingForm.primaryColor}
                logoUrl={logoPreview ?? brandingForm.logoUrl}
                restaurantName={detail?.name ?? 'Restaurant'}
                buttonStyle={brandingForm.buttonStyle}
                cardStyle={brandingForm.cardStyle}
                backgroundMood={brandingForm.backgroundMood}
                backgroundColorHex={brandingForm.backgroundColorHex}
                backgroundGradientHex={brandingForm.backgroundGradientHex}
              />
            </div>

            {brandingError && <p className="text-xs text-red-400">{brandingError}</p>}
            <div className="flex flex-wrap gap-3 pt-1">
              <button onClick={handleSaveBranding} disabled={brandingBusy} className={btnPrimary}>{brandingBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button
                onClick={() => {
                  setBrandingForm({ primaryColor: '', accentColor: '', publicThemePreset: '', logoUrl: '', coverImageUrl: '', heroVideoUrl: '', buttonStyle: '', cardStyle: '', backgroundMood: '', backgroundColorHex: '', backgroundGradientHex: '', websiteUrl: '', instagramUrl: '', googleMapsUrl: '', wazeUrl: '' });
                  setLogoPreview(p => { if (p) URL.revokeObjectURL(p); return null; });
                  setCoverPreview(p => { if (p) URL.revokeObjectURL(p); return null; });
                  setBrandingError(null);
                }}
                className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg text-iron-muted hover:text-iron-text"
              >Reset branding</button>
              <button onClick={() => { setEditBranding(false); setBrandingError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
              {detail?.slug && (
                <a
                  href={`/book/${detail.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg text-iron-muted hover:text-iron-text"
                >Preview public page ↗</a>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Public Page Branding</h3>
              <div className="flex items-center gap-2">
                {detail?.slug && (
                  <a
                    href={`/book/${detail.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
                  >Preview ↗</a>
                )}
                {isSuperAdmin && <button
                  onClick={() => { setEditBranding(true); setBrandingError(null); }}
                  className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
                >{T.admin.editBtn}</button>}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Primary color</dt>
                <dd className="flex items-center gap-2">
                  {detail?.primaryColor
                    ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.primaryColor }} /><span className="text-iron-text font-mono text-xs">{detail.primaryColor}</span></>
                    : <span className="text-iron-muted italic">Iron default</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Accent color</dt>
                <dd className="flex items-center gap-2">
                  {detail?.accentColor
                    ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.accentColor }} /><span className="text-iron-text font-mono text-xs">{detail.accentColor}</span></>
                    : <span className="text-iron-muted italic">Not set</span>}
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
                  {detail?.backgroundColorHex
                    ? <>
                        <span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.backgroundGradientHex ? `linear-gradient(168deg, ${detail.backgroundColorHex}, ${detail.backgroundGradientHex})` : detail.backgroundColorHex }} />
                        <span className="text-iron-text font-mono text-xs">{detail.backgroundColorHex}{detail.backgroundGradientHex ? ` → ${detail.backgroundGradientHex}` : ''}</span>
                      </>
                    : <span className="text-iron-muted italic">Not set</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Logo</dt>
                <dd>
                  {detail?.logoUrl
                    ? <img src={detail.logoUrl} alt="logo" className="h-6 object-contain" />
                    : <span className="text-iron-muted italic">Not set</span>}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-iron-muted text-xs mb-0.5">Cover image</dt>
                <dd>
                  {detail?.coverImageUrl
                    ? <div className="mt-1 rounded-md overflow-hidden border border-iron-border" style={{ height: 64 }}><img src={detail.coverImageUrl} alt="cover" className="w-full h-full object-cover" /></div>
                    : <span className="text-iron-muted italic">Not set</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Website</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.websiteUrl ? <a href={detail.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{detail.websiteUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Instagram</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.instagramUrl ? <a href={detail.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{detail.instagramUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Google Maps</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.googleMapsUrl ? <a href={detail.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{detail.googleMapsUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Waze</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.wazeUrl ? <a href={detail.wazeUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{detail.wazeUrl}</a> : <span className="text-iron-muted italic">Not set</span>}</dd>
              </div>
            </dl>
          </div>
        )}
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
            {userError && <p className="text-xs text-red-400">{userError}</p>}
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

    const tabs: Array<{ id: 'info' | 'settings' | 'users'; label: string }> = [
      { id: 'info', label: T.admin.tabInfo },
      { id: 'settings', label: T.admin.tabSettings },
      { id: 'users', label: T.admin.tabUsers },
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
          {activeTab === 'info'     && renderInfoTab()}
          {activeTab === 'settings' && renderSettingsTab()}
          {activeTab === 'users'    && renderUsersTab()}
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
          {groupError && <p className="text-sm text-red-400">{groupError}</p>}
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
                <span className="text-sm font-semibold text-blue-400">{totalUpcoming} <span className="font-normal text-iron-muted text-xs">arriving soon</span></span>
              )}
              {totalLate > 0 && (
                <span className="text-sm font-semibold text-amber-400">{totalLate} <span className="font-normal text-iron-muted text-xs">late</span></span>
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
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              +{s.upcoming}
                            </span>
                          )}
                          {s.late > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
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
                        className="text-xs text-red-400 hover:text-red-300 flex-shrink-0"
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
                  <span className={`text-xs px-2 py-0.5 rounded ${u.isActive ? 'bg-iron-green/20 text-iron-green' : 'bg-red-900/20 text-red-400'}`}>
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
              {hqUserError && <p className="text-xs text-red-400">{hqUserError}</p>}
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
        {/* Sidebar */}
        <div className="w-64 border-r border-iron-border flex flex-col bg-iron-surface flex-shrink-0 overflow-hidden">
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
        </div>

        {/* Main content */}
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
        </div>
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
