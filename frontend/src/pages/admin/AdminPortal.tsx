import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, ApiError } from '../../api';
import GuestHubCmsPanel from './GuestHubCmsPanel';
import { useT } from '../../i18n/useT';
import { validateImageFile, uploadToCloudinary, cloudinaryConfigured } from '../../utils/cloudinaryUpload';
import type { AdminGroup, AdminGroupDetail, AdminRestaurant, AdminRestaurantDetail, AdminUser, AuthState, LocationTonightStats, SmsUsageDetail, SmsUsageReport, ClubMember, ClubStats, AlertCenter, RecoveryStats, MomentRecord, MorningBriefRecord } from '../../types';

// ─── Wizard form types ────────────────────────────────────────────────────────

interface WizardBasic {
  name: string; slug: string; timezone: string;
  phone: string; email: string; address: string;
}
interface WizardSettings {
  defaultTurnMinutes: number; slotIntervalMinutes: number; maxPartySize: number;
  autoConfirm: boolean; bufferBetweenTurnsMinutes: number;
  lastSeatingOffset: number; lateThresholdMinutes: number; noShowThresholdMinutes: number;
  maxOnlinePartySize: number; maxOnlineCoversPerWindow: number;
}
interface WizardUser { firstName: string; lastName: string; email: string; password: string; role: string; }

type IcTab = 'overview' | 'members' | 'alerts' | 'messages' | 'events' | 'backfill';

// Israeli mobile validation — accepts 05XXXXXXXX, +9725XXXXXXXX, or 9725XXXXXXXX
// (spaces / dashes / parens ignored). Rejects landlines and malformed numbers,
// which InforU rejects with StatusId -18 ("no valid recipients").
function isValidIsraeliMobile(raw: string): boolean {
  const p = raw.replace(/[\s\-().]/g, '');
  return /^(?:\+972|972|0)5\d{8}$/.test(p);
}

// ─── SMS templates ────────────────────────────────────────────────────────────
type SmsTplType = 'RESERVATION_RECEIVED' | 'CONFIRMATION_REQUEST' | 'REMINDER';

const SMS_TPL_TYPES: Array<{ key: SmsTplType; label: string; hasLink: boolean }> = [
  { key: 'RESERVATION_RECEIVED', label: 'קבלת הזמנה',   hasLink: false },
  { key: 'CONFIRMATION_REQUEST', label: 'בקשת אישור',   hasLink: true  },
  { key: 'REMINDER',             label: 'תזכורת',       hasLink: true  },
];

const SMS_TPL_VARS = ['{guestName}', '{restaurantName}', '{date}', '{time}', '{partySize}', '{confirmationLink}', '{reservationDuration}'];

// Representative Hebrew defaults shown as placeholder / preview when no custom main
// is set. The real send still uses the backend bilingual default — this is only for
// the editor. The actual default adapts to the guest's language (he/en).
const SMS_DEFAULT_TEMPLATES: Record<SmsTplType, string> = {
  RESERVATION_RECEIVED: 'היי {guestName}, ההזמנה שלך ב-{restaurantName} התקבלה ל-{date} בשעה {time} עבור {partySize} סועדים. השולחן יעמוד לרשותכם למשך {reservationDuration}. מחכים לארח אותך.',
  CONFIRMATION_REQUEST: 'שלום {guestName}, אנא אשר/י את הגעתך ל{restaurantName} בתאריך {date} בשעה {time} ל-{partySize} אנשים. השולחן יעמוד לרשותכם למשך {reservationDuration}. לאישור: {confirmationLink}',
  REMINDER:             'היי {guestName}, תזכורת להזמנה שלך ב{restaurantName} היום בשעה {time}. השולחן יעמוד לרשותכם למשך {reservationDuration}. לאישור: {confirmationLink}',
};

const emptySmsTplForm = (): Record<SmsTplType, { main: string; addon: string }> => ({
  RESERVATION_RECEIVED: { main: '', addon: '' },
  CONFIRMATION_REQUEST: { main: '', addon: '' },
  REMINDER:             { main: '', addon: '' },
});

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

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const DEFAULT_SCHEDULE: ScheduleRow[] = [0, 1, 2, 3, 4, 5, 6].map(d => ({
  dayOfWeek: d, isOpen: d !== 0, openTime: '11:00', closeTime: '22:00', lastSeating: '21:00',
}));

const DEFAULT_BASIC: WizardBasic     = { name: '', slug: '', timezone: 'America/New_York', phone: '', email: '', address: '' };
const DEFAULT_SETTINGS: WizardSettings = {
  defaultTurnMinutes: 90, slotIntervalMinutes: 30, maxPartySize: 20,
  autoConfirm: false, bufferBetweenTurnsMinutes: 15,
  lastSeatingOffset: 60, lateThresholdMinutes: 5, noShowThresholdMinutes: 15,
  maxOnlinePartySize: 5, maxOnlineCoversPerWindow: 40,
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

// ─── Restaurant URL inventory block ──────────────────────────────────────────

const BASE_URL = 'https://www.ironbooking.com';

function CopyUrlRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = React.useState(false);
  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-iron-border/50 last:border-0">
      <div className="min-w-0">
        <p className="text-xs text-iron-muted mb-0.5">{label}</p>
        <p className="text-xs font-mono text-iron-text truncate" dir="ltr">{url}</p>
      </div>
      <button
        onClick={copy}
        className="shrink-0 text-xs px-2.5 py-1 rounded border border-iron-border hover:bg-iron-bg text-iron-muted hover:text-iron-text transition-colors"
      >
        {copied ? '✓ הועתק' : 'העתק'}
      </button>
    </div>
  );
}

function RestaurantUrlBlock({ restaurantSlug, guestHubSlug }: { restaurantSlug: string; guestHubSlug: string | null }) {
  const slugMismatch = guestHubSlug !== null && guestHubSlug !== restaurantSlug;
  return (
    <div className="bg-iron-surface rounded-lg p-5 border border-iron-border" dir="rtl">
      <h3 className="font-medium text-sm mb-3">קישורי מסעדה</h3>
      <div className="space-y-0">
        <CopyUrlRow label="כניסת צוות" url={`${BASE_URL}/${restaurantSlug}`} />
        <CopyUrlRow label="הזמנות אונליין" url={`${BASE_URL}/book/${restaurantSlug}`} />
        {guestHubSlug && (
          <CopyUrlRow label="עמוד אורחים (QR)" url={`${BASE_URL}/r/${guestHubSlug}`} />
        )}
      </div>
      {slugMismatch && (
        <div className="mt-3 bg-status-warning/10 border border-status-warning/30 rounded-lg px-3 py-2.5">
          <p className="text-xs text-status-warning leading-relaxed">
            <span className="font-semibold">שים לב:</span> קישור עמוד האורחים שונה מקישור כניסת הצוות. זה תקין, אבל לצוות יש לשלוח רק את קישור כניסת הצוות.
          </p>
        </div>
      )}
    </div>
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
            <p className="text-iron-text font-semibold text-sm">שגיאת פאנל</p>
            <p className="text-iron-muted text-xs font-mono break-all leading-relaxed">{this.state.message}</p>
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-5 py-2.5 rounded-lg bg-iron-green hover:bg-iron-green-light text-white text-sm font-semibold transition-colors"
            >
              נסה שוב
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
  const [sidebarTab,      setSidebarTab]      = useState<'locations' | 'groups' | 'sms' | 'intelligence'>('locations');
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
  const [linkGroupsInput, setLinkGroupsInput] = useState('');
  const [linkGroupsBusy,  setLinkGroupsBusy]  = useState(false);
  const [linkGroupsError, setLinkGroupsError] = useState<string | null>(null);
  const [unresolvedGroups, setUnresolvedGroups] = useState<Array<{ group: string; unresolvedCount: number; lastSeen: string | null; assignedTo: string | null }>>([]);
  const [smsBusy,      setSmsBusy]      = useState(false);
  const [smsTestBusy,  setSmsTestBusy]  = useState(false);
  const [smsTestPhone, setSmsTestPhone] = useState('');
  const [smsError,     setSmsError]     = useState<string | null>(null);
  const [smsTestResult, setSmsTestResult] = useState<{ ok: boolean; status: string; providerMessageId: string | null; error: string | null; to: string } | null>(null);

  // SMS templates edit state (main override + free-text addon per message type)
  const [smsTplForm,  setSmsTplForm]  = useState(emptySmsTplForm());
  const [smsTplBusy,  setSmsTplBusy]  = useState(false);
  const [smsTplError, setSmsTplError] = useState<string | null>(null);

  // SMS usage report (SUPER_ADMIN only)
  const [smsUsage,        setSmsUsage]        = useState<SmsUsageReport | null>(null);
  const [smsUsageMonth,   setSmsUsageMonth]   = useState('');
  const [smsUsageLoading, setSmsUsageLoading] = useState(false);
  const [smsDetail,       setSmsDetail]       = useState<SmsUsageDetail | null>(null);
  const [smsDetailId,     setSmsDetailId]     = useState<string | null>(null);
  const [smsDetailLoading, setSmsDetailLoading] = useState(false);

  // GIC V2 Backfill (SUPER_ADMIN only)
  type BackfillResult = {
    total: number; processed: number; errors: number;
    errorDetails: Array<{ guestId: string; error: string }>;
    labelDistribution: Record<string, number>;
    scoreStats: { scored: number; avgLoyalty: number; avgEngagement: number; maxLoyalty: number | null; minLoyalty: number | null };
    dryRun?: boolean;
  };
  const [backfillRestaurantId, setBackfillRestaurantId] = useState('');
  const [backfillBusy,         setBackfillBusy]         = useState(false);
  const [backfillResult,       setBackfillResult]       = useState<BackfillResult | null>(null);
  const [backfillError,        setBackfillError]        = useState<string | null>(null);

  // IRON CLUB management center
  const [icTab,          setIcTab]          = useState<IcTab>('overview');
  const [icClubStats,    setIcClubStats]    = useState<ClubStats | null>(null);
  const [icRecovStats,   setIcRecovStats]   = useState<RecoveryStats | null>(null);
  const [icAlerts,       setIcAlerts]       = useState<AlertCenter | null>(null);
  const [icMembers,      setIcMembers]      = useState<ClubMember[] | null>(null);
  const [icMoments,      setIcMoments]      = useState<MomentRecord[] | null>(null);
  const [icBrief,        setIcBrief]        = useState<MorningBriefRecord | null>(null);
  const [icLoading,      setIcLoading]      = useState(false);
  const [icError,        setIcError]        = useState<string | null>(null);
  const [icMemberSearch, setIcMemberSearch] = useState('');

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

  // IRON CLUB — fetch data when restaurant or tab changes
  useEffect(() => {
    if (!backfillRestaurantId || sidebarTab !== 'intelligence' || icTab === 'backfill') return;
    setIcLoading(true); setIcError(null);
    const rid = backfillRestaurantId;
    let cancelled = false;
    (async () => {
      try {
        if (icTab === 'overview') {
          const [stats, recov, alerts] = await Promise.all([
            api.club.stats(rid),
            api.recovery.stats(rid),
            api.alerts.center(rid),
          ]);
          if (!cancelled) { setIcClubStats(stats); setIcRecovStats(recov); setIcAlerts(alerts); }
        } else if (icTab === 'members') {
          const r = await api.club.members(rid);
          if (!cancelled) setIcMembers(r.data);
        } else if (icTab === 'alerts') {
          const r = await api.alerts.center(rid);
          if (!cancelled) setIcAlerts(r);
        } else if (icTab === 'messages') {
          const r = await api.intelligence.getMoments(rid);
          if (!cancelled) setIcMoments(r);
        } else if (icTab === 'events') {
          const [brief, alerts] = await Promise.all([
            api.intelligence.getMorningBrief(rid),
            api.alerts.center(rid),
          ]);
          if (!cancelled) { setIcBrief(brief); setIcAlerts(alerts); }
        }
      } catch (e) {
        if (!cancelled) setIcError(e instanceof Error ? e.message : 'שגיאה בטעינת הנתונים');
      } finally {
        if (!cancelled) setIcLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [backfillRestaurantId, icTab, sidebarTab]);

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
        maxOnlinePartySize:        Number(s.maxOnlinePartySize ?? 5),
        maxOnlineCoversPerWindow:  Number(s.maxOnlineCoversPerWindow ?? 40),
      });
      setWhatsappForm({ instanceId: d.ultramsgInstanceId ?? '', token: '', phone: d.whatsappPhone ?? '' });
      setSmsForm({
        enabled:    Boolean(s.smsEnabled ?? false),
        provider:   String(s.smsProvider ?? 'MOCK'),
        senderName: String(s.smsSenderName ?? ''),
      });
      const lg = s.linkGroupIds;
      setLinkGroupsInput(Array.isArray(lg) ? (lg as unknown[]).map(String).join(', ') : '');
      if (isSuperAdmin) {
        api.admin.telephony.unresolvedGroups()
          .then(r => setUnresolvedGroups(r.groups))
          .catch(() => setUnresolvedGroups([]));
      }
      setSmsTestPhone(d.phone ?? '');
      const tpls = (s.smsTemplates ?? {}) as Record<string, { main?: string | null; addon?: string | null } | undefined>;
      const tplForm = emptySmsTplForm();
      (Object.keys(tplForm) as SmsTplType[]).forEach(k => {
        tplForm[k] = { main: tpls[k]?.main ?? '', addon: tpls[k]?.addon ?? '' };
      });
      setSmsTplForm(tplForm);
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
    setSmsTestResult(null);
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
      showToast('פרטי WhatsApp נשמרו');
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
      showToast('הודעת בדיקה נשלחה');
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
      showToast('הגדרות SMS נשמרו');
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSmsBusy(false);
    }
  }

  function parseGroupIds(input: string): string[] {
    return Array.from(new Set(input.split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d+$/.test(x))));
  }

  async function handleSaveLinkGroups(idsOverride?: string[]) {
    if (!selectedId) return;
    setLinkGroupsBusy(true);
    setLinkGroupsError(null);
    try {
      const ids = idsOverride ?? parseGroupIds(linkGroupsInput);
      const updated = await api.admin.restaurants.settings(selectedId, { linkGroupIds: ids });
      setDetail(d => d ? { ...d, settings: updated.settings } : d);
      setLinkGroupsInput(ids.join(', '));
      const r = await api.admin.telephony.unresolvedGroups();
      setUnresolvedGroups(r.groups);
      showToast('קבוצות Link נשמרו');
    } catch (err) {
      setLinkGroupsError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLinkGroupsBusy(false);
    }
  }

  function handleAssignGroup(group: string) {
    const ids = Array.from(new Set([...parseGroupIds(linkGroupsInput), group]));
    void handleSaveLinkGroups(ids);
  }

  async function handleSaveSmsTemplates() {
    if (!selectedId) return;
    setSmsTplBusy(true);
    setSmsTplError(null);
    try {
      const smsTemplates: Record<string, { main: string | null; addon: string | null }> = {};
      (Object.keys(smsTplForm) as SmsTplType[]).forEach(k => {
        smsTemplates[k] = {
          main:  smsTplForm[k].main.trim()  || null,
          addon: smsTplForm[k].addon.trim() || null,
        };
      });
      const updated = await api.admin.restaurants.settings(selectedId, { smsTemplates });
      setDetail(d => d ? { ...d, settings: updated.settings } : d);
      showToast('תבניות SMS נשמרו');
    } catch (err) {
      setSmsTplError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSmsTplBusy(false);
    }
  }

  // Compose the final SMS preview with sample data (mirrors backend composeSms).
  function previewSmsTemplate(type: SmsTplType): string {
    const f = smsTplForm[type];
    const sample: Record<string, string> = {
      '{guestName}': 'דנה לוי',
      '{restaurantName}': detail?.name ?? 'המסעדה',
      '{date}': '12/06/2026',
      '{time}': '20:00',
      '{partySize}': '4',
      '{confirmationLink}': 'https://ironbooking.com/c/abc123',
      '{reservationDuration}': 'כשעה וחצי',
    };
    const mainTpl = f.main.trim() || SMS_DEFAULT_TEMPLATES[type];
    const rendered = SMS_TPL_VARS.reduce((acc, v) => acc.split(v).join(sample[v] ?? ''), mainTpl);
    const addon = f.addon.trim();
    return addon ? `${rendered}\n${addon}` : rendered;
  }

  async function handleTestSms() {
    if (!selectedId) return;
    const to = smsTestPhone.trim();
    if (!to) { setSmsError('Enter a phone number to send a test'); return; }
    // Validate locally before hitting the provider — InforU rejects bad numbers
    // with StatusId -18, so catch landlines / typos here.
    if (!isValidIsraeliMobile(to)) {
      setSmsError('Not a valid Israeli mobile. Use 05XXXXXXXX or +9725XXXXXXXX (landlines are not allowed).');
      return;
    }
    setSmsTestBusy(true);
    setSmsError(null);
    setSmsTestResult(null);
    try {
      const { result, log } = await api.admin.sms.test({
        restaurantId: selectedId,
        to,
        message: `Iron Booking SMS test — ${detail?.name ?? ''}`.trim(),
      });
      setSmsTestResult({
        ok:                result.success,
        status:            log?.status ?? (result.success ? 'SENT' : 'FAILED'),
        providerMessageId: log?.providerMessageId ?? result.providerMessageId ?? null,
        error:             log?.errorMessage ?? null,
        to,
      });
      if (result.success) showToast(`Test SMS sent via ${log?.provider ?? 'provider'}`);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setSmsTestBusy(false);
    }
  }

  // ── SMS usage report ──────────────────────────────────────────────────────────

  const loadSmsUsage = useCallback(async (month?: string) => {
    setSmsUsageLoading(true);
    setSmsDetail(null);
    setSmsDetailId(null);
    try {
      const report = await api.admin.sms.usage(month);
      setSmsUsage(report);
      setSmsUsageMonth(report.month);
    } catch { /* ignore */ }
    finally { setSmsUsageLoading(false); }
  }, []);

  async function toggleSmsDetail(restaurantId: string) {
    if (smsDetailId === restaurantId) { setSmsDetailId(null); setSmsDetail(null); return; }
    setSmsDetailId(restaurantId);
    setSmsDetail(null);
    setSmsDetailLoading(true);
    try {
      setSmsDetail(await api.admin.sms.usageDetail(restaurantId, smsUsageMonth || undefined));
    } catch { /* ignore */ }
    finally { setSmsDetailLoading(false); }
  }

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
      showToast('לוח זמנים נשמר');
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
      showToast('הגבלה נוספה');
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
      showToast('מיתוג נשמר');
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
            placeholder="לדוג׳ The Grand Brasserie"
            required
          />
        </Field>
        <Field label={T.admin.fieldSlug}>
          <Input
            value={wizardBasic.slug}
            onChange={e => setWizardBasic(b => ({ ...b, slug: e.target.value }))}
            placeholder="לדוג׳ grand-brasserie"
            pattern="[a-z0-9-]+"
            title="אותיות קטנות, ספרות ומקפים בלבד"
            required
          />
          <p className="text-xs text-iron-muted mt-1">משמש ב-API ולזיהוי פנימי</p>
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
            <Input value={wizardBasic.phone} onChange={e => setWizardBasic(b => ({ ...b, phone: e.target.value }))} placeholder="+972 50 000 0000" />
          </Field>
          <Field label={T.admin.fieldEmail}>
            <Input type="email" value={wizardBasic.email} onChange={e => setWizardBasic(b => ({ ...b, email: e.target.value }))} placeholder="info@restaurant.com" />
          </Field>
        </div>
        <Field label={T.admin.fieldAddress}>
          <Input value={wizardBasic.address} onChange={e => setWizardBasic(b => ({ ...b, address: e.target.value }))} placeholder="רח׳ הראשי 1, עיר" />
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-iron-muted mb-1">מקסימום סועדים להזמנה אונליין</label>
            <NumInput value={s.maxOnlinePartySize} onChange={set('maxOnlinePartySize') as (v: number) => void} min={1} max={100} />
            <p className="text-xs text-iron-muted mt-1">מעל מספר זה האורח יתבקש ליצור קשר עם המסעדה</p>
          </div>
          <div>
            <label className="block text-xs text-iron-muted mb-1">מקסימום סועדים אונליין בחלון זמן</label>
            <NumInput value={s.maxOnlineCoversPerWindow} onChange={set('maxOnlineCoversPerWindow') as (v: number) => void} min={1} max={500} />
            <p className="text-xs text-iron-muted mt-1">מגביל רק הזמנות שהגיעו מהאתר, לא הזמנות טלפוניות או ידניות</p>
          </div>
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
            מסעדה נוצרה — תקן/י את השגיאות למטה להוספת משתמש ראשון, או דלג/י.
          </p>
        )}
        <p className="text-sm text-iron-muted">צור/י את איש הצוות הראשון במסעדה. ניתן לדלג ולהוסיף משתמשים מאוחר יותר.</p>
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
            { label: 'משתמשים',   value: T.admin.users(detail._count.users) },
            { label: 'שולחנות',   value: T.admin.tables(detail._count.tables) },
            { label: 'הזמנות',    value: T.admin.reservations(detail._count.reservations) },
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
              <h3 className="font-medium">פרטים</h3>
              {isSuperAdmin && <button onClick={() => setEditInfo(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['שם',        detail.name],
                ['Slug',      detail.slug],
                ['אזור זמן',  detail.timezone],
                ['טלפון',     detail.phone ?? '—'],
                ['אימייל',    detail.email ?? '—'],
                ['כתובת',     detail.address ?? '—'],
                ['נוצר',      new Date(detail.createdAt).toLocaleDateString()],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-iron-muted text-xs mb-0.5">{k}</dt>
                  <dd className="text-iron-text">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Ghost restaurant warning */}
        {detail._count.users === 0 && detail._count.tables === 0 && (
          <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-4" dir="rtl">
            <p className="text-sm font-semibold text-status-warning mb-2">⚠ מסעדה לא פעילה / חסרת הגדרה</p>
            <ul className="text-xs text-status-warning/80 space-y-1">
              <li>• אין משתמשים ({detail._count.users})</li>
              <li>• אין שולחנות ({detail._count.tables})</li>
              <li>• {detail.operatingHours?.length === 0 ? 'אין שעות פעילות מוגדרות' : `${detail.operatingHours?.length} שעות פעילות`}</li>
              <li>• {detail.address ? `כתובת: ${detail.address}` : 'אין כתובת'}</li>
              <li>• הזמנות: {detail._count.reservations}</li>
            </ul>
            <p className="text-xs text-status-warning/70 mt-3 pt-3 border-t border-status-warning/20">
              אל תשלחו את קישורי המסעדה הזו לצוות. יש לאשר מחיקה/ארכיון לפני שנוקטים פעולה.
            </p>
          </div>
        )}

        {/* URL Inventory */}
        <RestaurantUrlBlock
          restaurantSlug={detail.slug}
          guestHubSlug={detail.guestHubSlug}
        />

        {/* Sample layout */}
        <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm mb-1">{T.admin.sampleLayoutBtn}</h3>
              <p className="text-xs text-iron-muted">יוצר 2 אזורים ו-8 שולחנות ברירת מחדל. מוחק שולחנות קיימים.</p>
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
              <h3 className="font-medium">הגדרות שירות</h3>
              {isSuperAdmin && <button onClick={() => { setWizardSettings(settingsForm); setEditSettings(true); }} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['זמן ישיבה ברירת מחדל', `${s.defaultTurnMinutes ?? 90}דק׳`],
                ['מרווח בין סלוטים',     `${s.slotIntervalMinutes ?? 30}דק׳`],
                ['גודל מסיבה מקסימלי',  String(s.maxPartySize ?? 20)],
                ['אישור אוטומטי',        s.autoConfirm ? 'כן' : 'לא'],
                ['חיץ בין תורות',        `${s.bufferBetweenTurnsMinutes ?? 15}דק׳`],
                ['קיזוז ישיבה אחרונה',  `${s.lastSeatingOffset ?? 60}דק׳`],
                ['סף איחור',            `${s.lateThresholdMinutes ?? 5}דק׳`],
                ['סף אי-הופעה',         `${s.noShowThresholdMinutes ?? 15}דק׳`],
                ['מקס׳ סועדים אונליין', String(s.maxOnlinePartySize ?? 5)],
                ['מקס׳ סועדים בחלון',  String(s.maxOnlineCoversPerWindow ?? 40)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-iron-muted text-xs mb-0.5">{k}</dt>
                  <dd className="text-iron-text">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Feature flags + IRON CLUB */}
        {isSuperAdmin && (
          <>
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <h3 className="font-medium mb-4">תכונות</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-iron-text">אורחים CRM</p>
                <p className="text-xs text-iron-muted mt-0.5">הפעלה/כיבוי של דף האורחים למסעדה זו</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 cursor-pointer accent-iron-green"
                  checked={s.guestsPageEnabled !== false}
                  onChange={async (e) => {
                    try {
                      await api.admin.restaurants.settings(selectedId!, { guestsPageEnabled: e.target.checked });
                      await loadDetail(selectedId!);
                    } catch {
                      // ignore
                    }
                  }}
                />
                <span className="text-sm text-iron-text">{s.guestsPageEnabled !== false ? 'פעיל' : 'כבוי'}</span>
              </label>
            </div>
          </div>

          {/* ── IRON CLUB ── */}
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-base">♦</span>
              <h3 className="font-medium text-iron-text text-sm">IRON CLUB</h3>
            </div>

            {/* Master switch */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-iron-text">מופעל</p>
                <p className="text-xs text-iron-muted mt-0.5">הפעלת כל מודולי IRON CLUB למסעדה זו</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 cursor-pointer accent-iron-green"
                  checked={!!s.ironClubEnabled}
                  onChange={async (e) => {
                    try { await api.admin.restaurants.settings(selectedId!, { ironClubEnabled: e.target.checked }); await loadDetail(selectedId!); } catch { /* ignore */ }
                  }}
                />
                <span className="text-sm text-iron-text">{s.ironClubEnabled ? 'פעיל' : 'כבוי'}</span>
              </label>
            </div>

            {/* Tier selector */}
            {!!s.ironClubEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-iron-text">רמת קלאב</p>
                    <p className="text-xs text-iron-muted mt-0.5">קובע אילו יכולות זמינות למסעדה</p>
                  </div>
                  <select
                    className="text-sm bg-iron-card border border-iron-border rounded-lg px-3 py-1.5 text-iron-text"
                    value={(s.ironClubTier as string) ?? 'STARTER'}
                    onChange={async (e) => {
                      try { await api.admin.restaurants.settings(selectedId!, { ironClubTier: e.target.value as 'NONE' | 'STARTER' | 'MEMBER' | 'INTELLIGENCE' | 'LUXURY' }); await loadDetail(selectedId!); } catch { /* ignore */ }
                    }}
                  >
                    <option value="NONE">NONE — ללא גישה</option>
                    <option value="STARTER">STARTER — משוב + התראות</option>
                    <option value="MEMBER">MEMBER — + חברות + שחזור</option>
                    <option value="INTELLIGENCE">INTELLIGENCE — + VIP + תור הודעות</option>
                    <option value="LUXURY">LUXURY — + מתנות + אוטומציה מלאה</option>
                  </select>
                </div>

                {/* Feedback approval mode */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-iron-text">אישור הודעות משוב</p>
                    <p className="text-xs text-iron-muted mt-0.5">דורש אישור מנהל לפני שליחת SMS משוב</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 cursor-pointer accent-iron-green"
                      checked={s.feedbackApprovalRequired !== false}
                      onChange={async (e) => {
                        try { await api.admin.restaurants.settings(selectedId!, { feedbackApprovalRequired: e.target.checked }); await loadDetail(selectedId!); } catch { /* ignore */ }
                      }}
                    />
                    <span className="text-sm text-iron-text">{s.feedbackApprovalRequired !== false ? 'נדרש אישור' : 'שליחה אוטומטית'}</span>
                  </label>
                </div>
              </>
            )}
          </div>
          </>
        )}

        {/* Weekly Schedule */}
        {editSchedule ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium">לוח שבועי</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-iron-muted border-b border-iron-border">
                    <th className="pb-2 pr-4 font-normal w-24">יום</th>
                    <th className="pb-2 pr-4 font-normal w-12">פתוח</th>
                    <th className="pb-2 pr-4 font-normal">פתיחת הזמנות</th>
                    <th className="pb-2 pr-4 font-normal">סגירה</th>
                    <th className="pb-2 font-normal">ישיבה אחרונה</th>
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
            <p className="text-[11px] text-iron-muted">פתיחת הזמנות = סלוט ראשון בדף הציבורי. ישיבה אחרונה = ההזמנה האחרונה המותרת.</p>
            {scheduleError && <p className="text-xs text-status-danger">{scheduleError}</p>}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveSchedule} disabled={scheduleBusy} className={btnPrimary}>{scheduleBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => { setEditSchedule(false); setScheduleError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">לוח שבועי</h3>
              {isSuperAdmin && <button onClick={() => setEditSchedule(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
            </div>
            <div className="space-y-1.5 text-sm">
              {scheduleRows.map(row => (
                <div key={row.dayOfWeek} className="flex items-baseline gap-3">
                  <span className="text-iron-muted text-xs w-24 shrink-0">{DAY_NAMES[row.dayOfWeek]}</span>
                  {row.isOpen
                    ? <span className="text-iron-text">{row.openTime} – {row.closeTime} <span className="text-iron-muted text-xs">ישיבה אחרונה {row.lastSeating}</span></span>
                    : <span className="text-iron-muted italic text-xs">סגור</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Online Booking Restrictions */}
        <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">הגבלות הזמנה מקוונת</h3>
            {!showAddRestriction && (
              <button
                onClick={() => { setShowAddRestriction(true); setRestrictionError(null); }}
                className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
              >+ הוסף כלל</button>
            )}
          </div>
          <p className="text-[11px] text-iron-muted mb-4">
            חוסם הזמנות מקוונות לתאריכים או חלונות זמן ספציפיים.
            הצוות יכול עדיין ליצור הזמנות ידנית מלוח הבקרה.
          </p>

          {restrictions.length === 0 && !showAddRestriction && (
            <p className="text-xs text-iron-muted italic">אין הגבלות פעילות.</p>
          )}

          {restrictions.length > 0 && (
            <div className="space-y-2 mb-4">
              {restrictions.map(r => (
                <div key={r.id} className="flex items-start justify-between gap-3 bg-iron-bg rounded px-3 py-2.5 border border-iron-border/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-iron-text font-medium">{r.date}</span>
                      <span dir="ltr" className="text-xs text-iron-muted bg-iron-surface px-1.5 py-0.5 rounded">
                        {r.startTime && r.endTime ? `${r.startTime} – ${r.endTime}` : 'כל היום'}
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
                <Field label="תאריך *">
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
                  <label htmlFor="restrictionFullDay" className="text-sm text-iron-text cursor-pointer select-none">כל היום</label>
                </div>
              </div>
              {!restrictionForm.fullDay && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="שעת התחלה *">
                    <Input
                      type="time"
                      value={restrictionForm.startTime}
                      onChange={e => setRestrictionForm(f => ({ ...f, startTime: e.target.value }))}
                    />
                  </Field>
                  <Field label="שעת סיום *">
                    <Input
                      type="time"
                      value={restrictionForm.endTime}
                      onChange={e => setRestrictionForm(f => ({ ...f, endTime: e.target.value }))}
                    />
                  </Field>
                </div>
              )}
              <Field label="סיבה (פנימי — לא מוצג לאורחים)">
                <Input
                  value={restrictionForm.reason}
                  onChange={e => setRestrictionForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="אירוע פרטי, הכשרת צוות, מטבח סגור…"
                />
              </Field>
              <Field label="הודעה לאורח (אופציונלי — מוצגת בווידג׳ט אם מוגדרת)">
                <Input
                  value={restrictionForm.guestMessage}
                  maxLength={200}
                  onChange={e => setRestrictionForm(f => ({ ...f, guestMessage: e.target.value }))}
                  placeholder="הזמנה מקוונת אינה זמינה לתאריך זה. צרו קשר בטלפון."
                />
              </Field>
              {restrictionError && <p className="text-xs text-status-danger">{restrictionError}</p>}
              <div className="flex gap-3 pt-1">
                <button onClick={handleCreateRestriction} disabled={restrictionCreateBusy} className={btnPrimary}>
                  {restrictionCreateBusy ? 'מוסיף…' : 'הוסף כלל'}
                </button>
                <button
                  onClick={() => { setShowAddRestriction(false); setRestrictionForm(DEFAULT_RESTRICTION_FORM); setRestrictionError(null); }}
                  className={btnSecondary}
                >{T.admin.cancelBtn}</button>
              </div>
            </div>
          )}
        </div>

        {/* WhatsApp Integration */}
        {editWhatsapp ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium">חיבור WhatsApp</h3>
            <Field label="UltraMsg Instance ID">
              <Input
                value={whatsappForm.instanceId}
                onChange={e => setWhatsappForm(f => ({ ...f, instanceId: e.target.value }))}
                placeholder="instance123456"
              />
            </Field>
            <Field label="UltraMsg Token (השאר ריק לשמירת הקיים)">
              <Input
                type="password"
                value={whatsappForm.token}
                onChange={e => setWhatsappForm(f => ({ ...f, token: e.target.value }))}
                placeholder="••••••••"
              />
            </Field>
            <Field label="מספר טלפון לבדיקה (פורמט בינלאומי, לדוג׳ +972501234567)">
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
              <h3 className="font-medium">חיבור WhatsApp</h3>
              {isSuperAdmin && <button
                onClick={() => { setEditWhatsapp(true); setWhatsappError(null); }}
                className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
              >{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-4">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Instance ID</dt>
                <dd className="text-iron-text">{detail?.ultramsgInstanceId ?? <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Token</dt>
                <dd className="text-iron-text">{detail?.tokenSet ? '••••••••' : <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">טלפון לבדיקה</dt>
                <dd className="text-iron-text">{detail?.whatsappPhone ?? <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">סטטוס</dt>
                <dd>
                  {detail?.ultramsgInstanceId && detail?.tokenSet
                    ? <span className="text-iron-green text-xs font-medium">מוגדר</span>
                    : <span className="text-status-warning text-xs font-medium">לא מוגדר — הודעות לא יישלחו</span>}
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
                >{whatsappTestBusy ? 'שולח…' : 'שלח הודעת בדיקה'}</button>
              </div>
            )}
          </div>
        )}

        {/* SMS Service */}
        {editSms ? (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <h3 className="font-medium">שירות SMS</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={smsForm.enabled}
                onChange={e => setSmsForm(f => ({ ...f, enabled: e.target.checked }))}
              />
              הפעל SMS למסעדה זו
            </label>
            <Field label="ספק">
              <select
                value={smsForm.provider}
                onChange={e => setSmsForm(f => ({ ...f, provider: e.target.value }))}
                className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-sm text-iron-text"
              >
                <option value="MOCK">MOCK (בדיקות — לא שולח)</option>
                <option value="INFORU">InforU (חי)</option>
              </select>
            </Field>
            <Field label="שם שולח (חייב להיות מאושר מראש ב-InforU, עד 11 תווים)">
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
              <h3 className="font-medium">שירות SMS</h3>
              {isSuperAdmin && <button
                onClick={() => { setEditSms(true); setSmsError(null); }}
                className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg"
              >{T.admin.editBtn}</button>}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-4">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">סטטוס</dt>
                <dd>
                  {smsForm.enabled
                    ? <span className="text-iron-green text-xs font-medium">פעיל</span>
                    : <span className="text-status-warning text-xs font-medium">כבוי — SMS לא יישלחו</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">ספק</dt>
                <dd className="text-iron-text">{smsForm.provider}{smsForm.provider === 'MOCK' && <span className="text-iron-muted"> (בדיקות בלבד)</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">שם שולח</dt>
                <dd className="text-iron-text">{smsForm.senderName || <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
            </dl>
            {isSuperAdmin && smsForm.enabled && (() => {
              const trimmed = smsTestPhone.trim();
              const invalid = trimmed.length > 0 && !isValidIsraeliMobile(trimmed);
              return (
                <div className="pt-3 border-t border-iron-border/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-iron-muted">טלפון לבדיקה:</span>
                    <input
                      value={smsTestPhone}
                      onChange={e => setSmsTestPhone(e.target.value)}
                      placeholder="+972501234567"
                      className={`bg-iron-bg border rounded px-2 py-1 text-xs text-iron-text w-44 ${invalid ? 'border-status-danger' : 'border-iron-border'}`}
                    />
                    <button
                      onClick={handleTestSms}
                      disabled={smsTestBusy || trimmed.length === 0 || invalid}
                      className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg disabled:opacity-50"
                    >{smsTestBusy ? 'שולח…' : 'שלח SMS בדיקה'}</button>
                  </div>
                  <p className="text-[11px] text-iron-muted mt-1">מספר ישראלי בלבד — 05XXXXXXXX או +9725XXXXXXXX. קווים ארציים נדחים על ידי הספק.</p>
                  {invalid && <p className="text-xs text-status-danger mt-1">מספר נייד ישראלי לא תקין.</p>}
                  {smsError && <p className="text-xs text-status-danger mt-1">{smsError}</p>}

                  {smsTestResult && (
                    <div className={`mt-3 rounded-lg border p-3 text-xs ${smsTestResult.ok ? 'border-iron-green/40 bg-iron-green/5' : 'border-status-danger/40 bg-status-danger/5'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-semibold ${smsTestResult.ok ? 'text-iron-green' : 'text-status-danger'}`}>
                          {smsTestResult.ok ? '✓ נשלח' : '✕ ' + smsTestResult.status}
                        </span>
                        <span className="text-iron-muted">→ {smsTestResult.to}</span>
                      </div>
                      {smsTestResult.providerMessageId && (
                        <div className="text-iron-muted">מזהה ספק: <span className="text-iron-text font-mono">{smsTestResult.providerMessageId}</span></div>
                      )}
                      {smsTestResult.error && (
                        <div className="text-status-danger mt-0.5">תגובת ספק: {smsTestResult.error}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Link Telephony — ring-group routing */}
        {isSuperAdmin && (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-4">
            <div>
              <h3 className="font-medium">Link Telephony — מספרי קבוצה</h3>
              <p className="text-xs text-iron-muted mt-0.5">מזהי קבוצות Link מופרדים בפסיק (לדוג׳ 205, 206, 207). שיחות נכנסות לקבוצות אלו יופיעו ביומן השיחות של המסעדה.</p>
            </div>
            <Field label="מזהי קבוצות Link">
              <Input
                value={linkGroupsInput}
                onChange={e => setLinkGroupsInput(e.target.value)}
                placeholder="לדוג׳ 205, 206, 207"
              />
            </Field>
            {linkGroupsError && <p className="text-xs text-status-danger">{linkGroupsError}</p>}
            <div className="flex gap-3">
              <button onClick={() => handleSaveLinkGroups()} disabled={linkGroupsBusy} className={btnPrimary}>{linkGroupsBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
            </div>
            {unresolvedGroups.filter(g => !g.assignedTo).length > 0 && (
              <div className="pt-3 border-t border-iron-border/60">
                <p className="text-xs text-iron-muted mb-2">קבוצות Link לא משויכות שנצפו ביומן השיחות. לחץ להוספה למסעדה זו:</p>
                <div className="flex flex-wrap gap-2">
                  {unresolvedGroups.filter(g => !g.assignedTo).map(g => (
                    <button
                      key={g.group}
                      onClick={() => handleAssignGroup(g.group)}
                      disabled={linkGroupsBusy}
                      className="text-xs px-2.5 py-1 rounded-md border border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20 disabled:opacity-50"
                      title={`${g.unresolvedCount} unresolved call(s)${g.lastSeen ? ` · last ${new Date(g.lastSeen).toLocaleString()}` : ''}`}
                    >
                      + {g.group} <span className="opacity-70">({g.unresolvedCount})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SMS Message Templates */}
        {isSuperAdmin && smsForm.enabled && (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border space-y-5">
            <div>
              <h3 className="font-medium">תבניות הודעות SMS</h3>
              <p className="text-xs text-iron-muted mt-0.5">לכל סוג הודעה: תבנית ראשית (עם משתנים) ותוספת טקסט חופשי בשורה נפרדת. השאר ריק לשמירה על ברירת המחדל המובנית (שמתאימה לשפת האורח).</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-iron-muted me-1">משתנים:</span>
              {SMS_TPL_VARS.map(v => (
                <code key={v} className="text-[11px] bg-iron-bg border border-iron-border rounded px-1.5 py-0.5 text-iron-green">{v}</code>
              ))}
            </div>

            {SMS_TPL_TYPES.map(({ key, label, hasLink }) => (
              <div key={key} className="border-t border-iron-border/60 pt-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-iron-text">{label}</span>
                  {!smsTplForm[key].main.trim() && <span className="text-[10px] text-iron-muted bg-iron-bg rounded px-1.5 py-0.5">ברירת מחדל</span>}
                </div>
                <div>
                  <label className="text-[11px] text-iron-muted">תבנית ראשית{hasLink ? '' : ' (אין קישור אישור לסוג זה)'}</label>
                  <textarea
                    value={smsTplForm[key].main}
                    onChange={e => setSmsTplForm(f => ({ ...f, [key]: { ...f[key], main: e.target.value } }))}
                    placeholder={SMS_DEFAULT_TEMPLATES[key]}
                    rows={2}
                    dir="auto"
                    className="w-full mt-1 bg-iron-bg border border-iron-border rounded px-2 py-1.5 text-xs text-iron-text placeholder-iron-muted/40 resize-y"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-iron-muted">תוספת (טקסט חופשי — חניה, מדיניות, הערות; אופציונלי)</label>
                  <textarea
                    value={smsTplForm[key].addon}
                    onChange={e => setSmsTplForm(f => ({ ...f, [key]: { ...f[key], addon: e.target.value } }))}
                    placeholder="e.g. חניה חינם במגרש ממול · ביטול עד 24 שעות מראש"
                    rows={2}
                    dir="auto"
                    className="w-full mt-1 bg-iron-bg border border-iron-border rounded px-2 py-1.5 text-xs text-iron-text placeholder-iron-muted/40 resize-y"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-iron-muted">תצוגה מקדימה</label>
                  <pre dir="auto" className="w-full mt-1 bg-iron-bg/60 border border-iron-border/60 rounded px-2 py-1.5 text-xs text-iron-text whitespace-pre-wrap font-sans">{previewSmsTemplate(key)}</pre>
                </div>
              </div>
            ))}

            {smsTplError && <p className="text-xs text-status-danger">{smsTplError}</p>}
            <div className="flex gap-3 pt-1 border-t border-iron-border/60">
              <button onClick={handleSaveSmsTemplates} disabled={smsTplBusy} className={btnPrimary}>{smsTplBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
            </div>
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">זהות מותג</p>

                  {/* Cuisine */}
                  <div className="mb-6">
                    <p className="text-xs text-iron-text font-medium mb-0.5">סוג מטבח</p>
                    <p className="text-[11px] text-iron-muted mb-2">מוצג ב-Guest Hub מתחת לשם המסעדה. השתמש בתיאור קצר כמו "איטלקי · גורמה" או "ים תיכוני · קז׳ואל".</p>
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <input
                        value={brandingForm.cuisine}
                        onChange={e => setBrandingForm(f => ({ ...f, cuisine: e.target.value }))}
                        placeholder="לדוג׳ איטלקי · גורמה"
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
                      <p className="text-xs text-iron-text font-medium mb-0.5">לוגו</p>
                      <p className="text-[11px] text-iron-muted mb-2.5">PNG · SVG · WEBP · רקע שקוף מומלץ</p>
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
                          {logoUpload.progress !== null ? `${logoUpload.progress}%` : '↑ העלה'}
                        </label>
                        {brandingForm.logoUrl && (
                          <button type="button" onClick={() => { setBrandingForm(f => ({ ...f, logoUrl: '' })); setLogoPreview(p => { if (p) URL.revokeObjectURL(p); return null; }); }} className="text-[11px] text-iron-muted hover:text-status-danger transition-colors">הסר</button>
                        )}
                      </div>
                      {logoUpload.progress !== null && <div className="h-1 bg-iron-border rounded-full overflow-hidden mt-2"><div className="h-full bg-iron-green rounded-full transition-all" style={{ width: `${logoUpload.progress}%` }} /></div>}
                      {logoUpload.error && <p className="text-[11px] text-status-danger mt-1">{logoUpload.error}</p>}
                      <p className="text-[10px] text-iron-muted/50 mt-3 mb-1">או הדבק כתובת URL ציבורית:</p>
                      <Input value={brandingForm.logoUrl} onChange={e => setBrandingForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…" />
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] text-iron-muted mb-2">צבע ראשי</p>
                      <div className="flex items-center gap-2">
                        <input type="color" value={brandingForm.primaryColor || '#22C55E'} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                        <Input value={brandingForm.primaryColor} onChange={e => setBrandingForm(f => ({ ...f, primaryColor: e.target.value }))} placeholder="#22C55E" className="font-mono text-xs" />
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-iron-muted mb-2">צבע הדגשה</p>
                      <div className="flex items-center gap-2">
                        <input type="color" value={brandingForm.accentColor || '#22C55E'} onChange={e => setBrandingForm(f => ({ ...f, accentColor: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                        <Input value={brandingForm.accentColor} onChange={e => setBrandingForm(f => ({ ...f, accentColor: e.target.value }))} placeholder="#45D4BE" className="font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Hero Media */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">מדיה ראשית</p>

                  {!cloudinaryConfigured() && (
                    <div className="rounded-xl border border-status-warning/20 bg-status-warning/5 px-4 py-3 text-xs text-status-warning/80 mb-5 space-y-1">
                      <p className="font-medium text-status-warning">העלאת תמונות לא מוגדרת</p>
                      <p className="text-status-warning/70">הוסף <code className="font-mono bg-black/20 px-1 rounded">VITE_CLOUDINARY_CLOUD_NAME</code> ו-<code className="font-mono bg-black/20 px-1 rounded">VITE_CLOUDINARY_UPLOAD_PRESET</code> ל-Vercel ופרס מחדש. בינתיים, הדבק כתובות URL ישירות.</p>
                    </div>
                  )}

                  {/* Cover image */}
                  <div className="mb-5">
                    <p className="text-xs text-iron-text font-medium mb-0.5">תמונת שער</p>
                    <p className="text-[11px] text-iron-muted mb-3">ממלאת את אזור ה-Hero בדף הציבורי. מינימום 1200 פיקסל רוחב.</p>
                    <div
                      className="relative rounded-xl overflow-hidden border mb-3 group"
                      style={{ height: 180, background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
                    >
                      {(coverPreview || brandingForm.coverImageUrl) ? (
                        <img src={coverPreview ?? brandingForm.coverImageUrl} alt="cover" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-iron-muted/30">
                          <svg viewBox="0 0 24 24" className="w-8 h-8 mb-1.5" fill="none" stroke="currentColor" strokeWidth={1.2}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                          <span className="text-xs">אין תמונת שער</span>
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
                        <span className="text-white text-xs font-medium bg-black/60 rounded-lg px-4 py-2">{coverUpload.progress !== null ? `מעלה ${coverUpload.progress}%` : '↑ העלה תמונת שער'}</span>
                      </label>
                      {coverUpload.progress !== null && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                          <div className="h-full bg-iron-green transition-all" style={{ width: `${coverUpload.progress}%` }} />
                        </div>
                      )}
                    </div>
                  {coverUpload.error && <p className="text-[11px] text-status-danger mt-2">{coverUpload.error}</p>}
                    <p className="text-[10px] text-iron-muted/50 mt-3 mb-1">או הדבק כתובת URL ציבורית:</p>
                    <Input value={brandingForm.coverImageUrl} onChange={e => setBrandingForm(f => ({ ...f, coverImageUrl: e.target.value }))} placeholder="https://…" className="text-xs" />
                  </div>

                  {/* Hero video */}
                  <div>
                    <p className="text-xs text-iron-text font-medium mb-0.5">וידאו ראשי</p>
                    <p className="text-[11px] text-iron-muted mb-2">הפעלה אוטומטית ללא קול בדף הציבורי. חוזר לתמונת שער כאשר לא זמין.</p>
                    <Input value={brandingForm.heroVideoUrl} onChange={e => setBrandingForm(f => ({ ...f, heroVideoUrl: e.target.value }))} placeholder="https://cdn.example.com/hero.mp4" className="text-xs" />
                  </div>
                </section>

                {/* Theme & Colors */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">ערכת נושא וצבעים</p>

                  {/* Theme preset visual cards */}
                  <div className="mb-7">
                    <p className="text-xs text-iron-text font-medium mb-3">ערכת נושא</p>
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
                    <p className="text-xs text-iron-text font-medium mb-3">אווירת רקע</p>
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
                    <p className="text-xs text-iron-text font-medium mb-1">רקע מותאם אישית <span className="text-iron-muted font-normal text-[11px]">(עוקף את אווירת הרקע)</span></p>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <p className="text-[10px] text-iron-muted mb-1.5">צבע בסיס</p>
                        <div className="flex items-center gap-2">
                          <input type="color" value={brandingForm.backgroundColorHex || '#0b0f18'} onChange={e => setBrandingForm(f => ({ ...f, backgroundColorHex: e.target.value }))} className="w-8 h-8 rounded-lg border border-iron-border bg-transparent cursor-pointer shrink-0" />
                          <Input value={brandingForm.backgroundColorHex} onChange={e => setBrandingForm(f => ({ ...f, backgroundColorHex: e.target.value }))} placeholder="#0b0f18" className="font-mono text-xs" />
                          {brandingForm.backgroundColorHex && (
                            <button type="button" onClick={() => setBrandingForm(f => ({ ...f, backgroundColorHex: '', backgroundGradientHex: '' }))} className="text-iron-muted hover:text-iron-text text-xs shrink-0" title="נקה">✕</button>
                          )}
                        </div>
                        {brandingForm.backgroundColorHex && (() => {
                          const m = brandingForm.backgroundColorHex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
                          if (!m) return null;
                          const lum = [m[1], m[2], m[3]].reduce((acc, c, i) => {
                            const v = parseInt(c, 16) / 255;
                            return acc + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
                          }, 0);
                          return lum > 0.12 ? <p className="text-[11px] text-status-warning mt-1">⚠ בהיר מדי — טקסט לבן עשוי להיות בלתי קריא</p> : null;
                        })()}
                      </div>
                      <div>
                        <p className="text-[10px] text-iron-muted mb-1.5">צבע סיום גרדיאנט (אופציונלי)</p>
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">סגנון</p>
                  <div className="space-y-5">
                    <StyleTileGroup
                      label="סגנון כפתור"
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
                      label="סגנון כרטיס"
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-5">רשתות חברתיות וניווט</p>
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-iron-green/70 mb-4">תצוגה מקדימה</p>
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
              >איפוס מיתוג</button>
              <button onClick={() => { setEditBranding(false); setBrandingError(null); }} className={btnSecondary}>{T.admin.cancelBtn}</button>
              {detail?.slug && (
                <a href={`/book/${detail.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs border border-iron-border rounded px-3 py-1.5 hover:bg-iron-bg text-iron-muted hover:text-iron-text">תצוגה מקדימה ↗</a>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">מיתוג דף ציבורי</h3>
              <div className="flex items-center gap-2">
                {detail?.slug && (
                  <a href={`/book/${detail.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">תצוגה מקדימה ↗</a>
                )}
                {isSuperAdmin && <button onClick={() => { setEditBranding(true); setBrandingError(null); }} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">צבע ראשי</dt>
                <dd className="flex items-center gap-2">
                  {detail?.primaryColor ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.primaryColor }} /><span className="text-iron-text font-mono text-xs">{detail.primaryColor}</span></> : <span className="text-iron-muted italic">ברירת מחדל</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">צבע הדגשה</dt>
                <dd className="flex items-center gap-2">
                  {detail?.accentColor ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.accentColor }} /><span className="text-iron-text font-mono text-xs">{detail.accentColor}</span></> : <span className="text-iron-muted italic">לא מוגדר</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">ערכת נושא</dt>
                <dd className="text-iron-text capitalize">{detail?.publicThemePreset ?? <span className="text-iron-muted italic">ללא</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">סגנון כפתור</dt>
                <dd className="text-iron-text capitalize">{detail?.buttonStyle ?? <span className="text-iron-muted italic">ברירת מחדל</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">סגנון כרטיס</dt>
                <dd className="text-iron-text capitalize">{detail?.cardStyle ?? <span className="text-iron-muted italic">Glass</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">אווירת רקע</dt>
                <dd className="text-iron-text capitalize">{detail?.backgroundMood ?? <span className="text-iron-muted italic">כהה</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">רקע מותאם</dt>
                <dd className="flex items-center gap-2">
                  {detail?.backgroundColorHex ? <><span className="w-4 h-4 rounded-full border border-iron-border shrink-0" style={{ background: detail.backgroundGradientHex ? `linear-gradient(168deg,${detail.backgroundColorHex},${detail.backgroundGradientHex})` : detail.backgroundColorHex }} /><span className="text-iron-text font-mono text-xs">{detail.backgroundColorHex}{detail.backgroundGradientHex ? ` → ${detail.backgroundGradientHex}` : ''}</span></> : <span className="text-iron-muted italic">לא מוגדר</span>}
                </dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">לוגו</dt>
                <dd>{detail?.logoUrl ? <img src={detail.logoUrl} alt="logo" className="h-6 object-contain" /> : <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-iron-muted text-xs mb-0.5">תמונת שער</dt>
                <dd>{detail?.coverImageUrl ? <div className="mt-1 rounded-md overflow-hidden border border-iron-border" style={{ height: 64 }}><img src={detail.coverImageUrl} alt="cover" className="w-full h-full object-cover" /></div> : <span className="text-iron-muted italic">לא מוגדרת</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">אתר</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.websiteUrl ? <a href={detail.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.websiteUrl}</a> : <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Instagram</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.instagramUrl ? <a href={detail.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.instagramUrl}</a> : <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Google Maps</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.googleMapsUrl ? <a href={detail.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.googleMapsUrl}</a> : <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
              <div>
                <dt className="text-iron-muted text-xs mb-0.5">Waze</dt>
                <dd className="text-iron-text text-xs truncate">{detail?.wazeUrl ? <a href={detail.wazeUrl} target="_blank" rel="noopener noreferrer" className="text-status-reserved hover:underline">{detail.wazeUrl}</a> : <span className="text-iron-muted italic">לא מוגדר</span>}</dd>
              </div>
            </dl>
          </div>
        )}

        {/* Restaurant Portal Access */}
        <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
          <div className="mb-4">
            <h3 className="font-medium mb-1">הרשאות פורטל</h3>
            <p className="text-[11px] text-iron-muted">הגדרות אלו קובעות מה המסעדה יכולה לנהל בפורטל שלה.</p>
          </div>
          <div className="space-y-3">
            {([
              { key: 'canManageOperatingHours'     as const, label: 'ניהול שעות פעילות' },
              { key: 'canManageOnlineRestrictions' as const, label: 'ניהול הגבלות הזמנה מקוונת' },
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
                <tr><td colSpan={6} className="px-4 py-6 text-center text-iron-muted text-sm">אין משתמשים עדיין</td></tr>
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
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold">{detail.name}</h2>
            {detail._count.users === 0 && detail._count.tables === 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-status-warning/15 text-status-warning border border-status-warning/30 font-medium">
                לא פעילה / חסרת הגדרה
              </span>
            )}
          </div>
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

  function renderIronClub() {
    const IC_TABS: Array<{ key: IcTab; label: string }> = [
      { key: 'overview',  label: 'סקירה' },
      { key: 'members',   label: 'חברים' },
      { key: 'alerts',    label: 'התראות' },
      { key: 'messages',  label: 'מסרים' },
      { key: 'events',    label: 'אירועים' },
      { key: 'backfill',  label: 'עדכון ניקוד' },
    ];
    const MEMBER_STATUS_HE: Record<string, string> = { ACTIVE: 'פעיל', PAUSED: 'מושהה', OPTED_OUT: 'ביטל' };
    const MEMBER_STATUS_COLOR: Record<string, string> = {
      ACTIVE: 'text-iron-green bg-iron-green/10 border border-iron-green/20',
      PAUSED: 'text-status-warning bg-status-warning/10 border border-status-warning/20',
      OPTED_OUT: 'text-iron-muted bg-iron-border border border-iron-border',
    };
    const ALERT_TYPE_HE: Record<string, string> = {
      FEEDBACK_NEGATIVE: 'משוב שלילי', VIP_AT_RISK: 'VIP בסיכון', HIGH_NOSHOW: 'אי-הופעות רבות',
      RECOVERY_OPEN: 'מקרה פתוח', SILENT_GUEST: 'אורח שקט',
      BIRTHDAY_SOON: 'יום הולדת קרוב', ANNIVERSARY_SOON: 'יובל קרוב',
    };
    const MOMENT_STATUS_HE: Record<string, string> = {
      DRAFT: 'טיוטה', PENDING: 'ממתין לשליחה', SENT: 'נשלח', APPROVED: 'אושר',
      REJECTED: 'נדחה', SCHEDULED: 'מתוזמן', CANCELLED: 'בוטל',
    };
    const MOMENT_STATUS_COLOR: Record<string, string> = {
      DRAFT: 'text-iron-muted bg-iron-border border border-iron-border',
      PENDING: 'text-status-warning bg-status-warning/10 border border-status-warning/20',
      SENT: 'text-iron-green bg-iron-green/10 border border-iron-green/20',
      APPROVED: 'text-status-reserved bg-status-reserved/10 border border-status-reserved/20',
      REJECTED: 'text-status-danger bg-status-danger/10 border border-status-danger/20',
      SCHEDULED: 'text-status-reserved bg-status-reserved/10 border border-status-reserved/20',
      CANCELLED: 'text-iron-muted bg-iron-border border border-iron-border',
    };
    const SOURCE_HE: Record<string, string> = {
      HOST_STAFF: 'צוות', RESERVATION_LINK: 'לינק הזמנה', FEEDBACK_FLOW: 'טופס משוב',
      QR_CODE: 'QR קוד', WEBSITE: 'אתר', IMPORT: 'ייבוא', MANUAL: 'ידני',
    };

    const Spinner = () => (
      <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
    );
    const LoadingRow = () => (
      <div className="flex items-center justify-center gap-2 text-iron-muted text-sm py-20">
        <Spinner /><span>טוען נתונים...</span>
      </div>
    );
    const EmptyRow = ({ msg }: { msg: string }) => (
      <p className="text-center text-iron-muted text-sm py-20">{msg}</p>
    );
    const ErrorRow = ({ msg }: { msg: string }) => (
      <div className="m-4 text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded-lg p-4 flex items-start gap-2">
        <span className="shrink-0 mt-0.5">⚠</span><span>{msg}</span>
      </div>
    );
    const NoRestaurant = () => (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-3xl">🏪</p>
          <p className="text-iron-text font-medium text-sm">בחר מסעדה</p>
          <p className="text-iron-muted text-xs">בחר מסעדה בסרגל הצד כדי לצפות בנתוני IRON CLUB</p>
        </div>
      </div>
    );

    // ── סקירה ──────────────────────────────────────────────────
    const renderOverview = () => {
      if (!backfillRestaurantId) return <NoRestaurant />;
      if (icLoading) return <LoadingRow />;
      if (icError) return <ErrorRow msg={icError} />;
      const kpis = [
        {
          label: 'חברים רשומים',
          help: 'מספר האורחים שהצטרפו למועדון',
          value: icClubStats?.total ?? '—',
          sub: `מתוכם ${icClubStats?.active ?? 0} פעילים`,
          color: 'text-iron-green',
          border: 'border-iron-green/20',
        },
        {
          label: 'לא פעילים',
          help: 'מושהים או ביטלו הצטרפות',
          value: (icClubStats?.paused ?? 0) + (icClubStats?.optedOut ?? 0),
          sub: `${icClubStats?.optedOut ?? 0} הסירו את עצמם`,
          color: 'text-iron-muted',
          border: 'border-iron-border',
        },
        {
          label: 'דורשות טיפול',
          help: 'התראות שטרם טופלו — לחץ על "התראות" לפרטים',
          value: icAlerts?.unreadCount ?? '—',
          sub: `${icAlerts?.critical.length ?? 0} קריטיות`,
          color: (icAlerts?.critical.length ?? 0) > 0 ? 'text-status-danger' : 'text-iron-text',
          border: (icAlerts?.critical.length ?? 0) > 0 ? 'border-status-danger/20' : 'border-iron-border',
        },
        {
          label: 'אורחים בסיכון',
          help: 'אורחים שלא חזרו זמן רב או שנפגעו מאירוע — מחכים לפנייה',
          value: (icRecovStats?.open ?? 0) + (icRecovStats?.contacted ?? 0),
          sub: `${icRecovStats?.criticalOpen ?? 0} דחופים`,
          color: (icRecovStats?.criticalOpen ?? 0) > 0 ? 'text-status-warning' : 'text-iron-text',
          border: (icRecovStats?.criticalOpen ?? 0) > 0 ? 'border-status-warning/20' : 'border-iron-border',
        },
        {
          label: 'אורחים שחזרו',
          help: 'מקרים שטופלו בהצלחה — אורח שחזר אחרי מעקב',
          value: icRecovStats?.resolved ?? '—',
          sub: 'טופלו בהצלחה',
          color: 'text-iron-text',
          border: 'border-iron-border',
        },
        {
          label: 'אירועים השבוע',
          help: 'ימי הולדת ויובלים של אורחים — מוצג בלשונית "אירועים"',
          value: icAlerts?.upcoming.length ?? '—',
          sub: 'ימי הולדת ויובלים',
          color: 'text-status-reserved',
          border: 'border-status-reserved/20',
        },
      ];
      return (
        <div className="p-5 space-y-6 overflow-y-auto h-full" dir="rtl">
          <div className="grid grid-cols-3 gap-3">
            {kpis.map(c => (
              <div key={c.label} className={`bg-iron-card border ${c.border} rounded-lg p-4 group relative`}>
                <p className="text-[11px] text-iron-muted mb-0.5 leading-tight">{c.label}</p>
                <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                <p className="text-[10px] text-iron-muted/70 mt-1 leading-tight">{c.sub}</p>
                <p className="text-[10px] text-iron-muted/40 mt-2 leading-snug hidden group-hover:block">{c.help}</p>
              </div>
            ))}
          </div>
          {icAlerts && icAlerts.critical.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-status-danger mb-3 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-status-danger" />
                התראות קריטיות — דורשות טיפול מיידי
              </p>
              <div className="space-y-2">
                {icAlerts.critical.slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-start gap-3 text-xs bg-red-900/10 border border-red-900/25 rounded-lg p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-iron-text font-semibold leading-snug">{a.headline}</p>
                      {a.context && <p className="text-iron-muted mt-0.5 leading-snug">{a.context}</p>}
                      {a.guest && (
                        <p className="text-iron-muted mt-1">
                          {a.guest.firstName} {a.guest.lastName}
                          {a.guest.visitCount > 0 && <span className="text-iron-muted/60"> · {a.guest.visitCount} ביקורים</span>}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-status-danger/70 shrink-0 font-medium mt-0.5 bg-red-900/20 px-1.5 py-0.5 rounded">
                      {ALERT_TYPE_HE[a.type] ?? a.type}
                    </span>
                  </div>
                ))}
                {icAlerts.critical.length > 5 && (
                  <p className="text-xs text-iron-muted text-center py-1">ועוד {icAlerts.critical.length - 5} — ראה לשונית "התראות"</p>
                )}
              </div>
            </div>
          )}
          {(!icClubStats && !icRecovStats && !icAlerts) && (
            <div className="text-center py-10 space-y-2">
              <p className="text-iron-muted text-sm">אין נתונים עדיין</p>
              <p className="text-iron-muted/60 text-xs">לחץ על "עדכון ניקוד" כדי לאתחל את IRON CLUB עבור מסעדה זו</p>
            </div>
          )}
        </div>
      );
    };

    // ── חברים ──────────────────────────────────────────────────
    const renderMembers = () => {
      if (!backfillRestaurantId) return <NoRestaurant />;
      if (icLoading && !icMembers) return <LoadingRow />;
      if (icError) return <ErrorRow msg={icError} />;
      const all = icMembers ?? [];
      const q = icMemberSearch.toLowerCase().trim();
      const filtered = q
        ? all.filter(m => {
            const g = m.guest;
            if (!g) return false;
            return `${g.firstName} ${g.lastName}`.toLowerCase().includes(q) ||
              (g.phone ?? '').includes(q) || ((g as { email?: string | null }).email ?? '').toLowerCase().includes(q);
          })
        : all;
      const activeCount  = all.filter(m => m.status === 'ACTIVE').length;
      const pausedCount  = all.filter(m => m.status === 'PAUSED').length;
      const optedCount   = all.filter(m => m.status === 'OPTED_OUT').length;
      return (
        <div className="flex flex-col h-full" dir="rtl">
          {/* Header bar */}
          <div className="px-4 pt-3 pb-2.5 border-b border-iron-border shrink-0 space-y-2">
            <div className="flex items-center gap-3">
              <input
                className="flex-1 bg-iron-card border border-iron-border rounded-lg px-3 py-1.5 text-sm text-iron-text placeholder:text-iron-muted focus:outline-none focus:border-iron-green/50 transition-colors"
                placeholder="חיפוש לפי שם, טלפון..."
                value={icMemberSearch}
                onChange={e => setIcMemberSearch(e.target.value)}
              />
              <span className="text-xs text-iron-muted shrink-0 tabular-nums">{filtered.length} / {all.length}</span>
            </div>
            {!q && all.length > 0 && (
              <div className="flex items-center gap-3 text-[11px] text-iron-muted">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-iron-green inline-block" />{activeCount} פעילים</span>
                {pausedCount > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-status-warning inline-block" />{pausedCount} מושהים</span>}
                {optedCount > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-iron-muted inline-block" />{optedCount} ביטלו</span>}
              </div>
            )}
          </div>
          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-iron-border/50">
            {filtered.length === 0
              ? <EmptyRow msg={q ? 'לא נמצאו חברים התואמים לחיפוש' : 'אין חברי מועדון'} />
              : filtered.map(m => {
                  const g = m.guest;
                  const gExt = g as { email?: string | null; visitCount?: number };
                  const fullName = g ? `${g.firstName} ${g.lastName}`.trim() : '—';
                  const visits = gExt?.visitCount;
                  const hasBirthday = !!m.birthday;
                  return (
                    <div key={m.id} className="px-4 py-3 hover:bg-iron-card/40 transition-colors">
                      <div className="flex items-start gap-3">
                        {/* Avatar initials */}
                        <div className="w-8 h-8 rounded-full bg-iron-card border border-iron-border flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[11px] font-semibold text-iron-text">
                            {g ? (g.firstName[0] ?? '') + (g.lastName[0] ?? '') : '?'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Row 1: name + status */}
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-semibold text-iron-text leading-tight">{fullName}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${MEMBER_STATUS_COLOR[m.status] ?? 'text-iron-muted bg-iron-border border border-iron-border'}`}>
                              {MEMBER_STATUS_HE[m.status] ?? m.status}
                            </span>
                          </div>
                          {/* Row 2: phone */}
                          {g?.phone && (
                            <p className="text-xs text-iron-muted" dir="ltr">{g.phone}</p>
                          )}
                          {/* Row 3: meta */}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            {visits !== undefined && visits > 0 && (
                              <span className="text-[11px] text-iron-muted">{visits} ביקורים</span>
                            )}
                            <span className="text-[11px] text-iron-muted/60">הצטרף דרך {SOURCE_HE[m.source] ?? m.source}</span>
                            <span className="text-[11px] text-iron-muted/60">{new Date(m.joinDate).toLocaleDateString('he-IL')}</span>
                            {hasBirthday && (
                              <span className="text-[11px] text-status-reserved">🎂 {m.birthday}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>
      );
    };

    // ── התראות ─────────────────────────────────────────────────
    const renderAlerts = () => {
      if (!backfillRestaurantId) return <NoRestaurant />;
      if (icLoading && !icAlerts) return <LoadingRow />;
      if (icError) return <ErrorRow msg={icError} />;
      const center = icAlerts;
      if (!center) return <EmptyRow msg="אין נתונים" />;
      const sections: Array<{
        key: 'critical' | 'attention' | 'upcoming';
        label: string;
        sublabel: string;
        dotColor: string;
        headingColor: string;
        bgClass: string;
        borderClass: string;
        dismissLabel: string;
      }> = [
        {
          key: 'critical',
          label: 'קריטי',
          sublabel: 'דורש טיפול מיידי',
          dotColor: 'bg-status-danger',
          headingColor: 'text-status-danger',
          bgClass: 'bg-red-900/8',
          borderClass: 'border-red-900/25',
          dismissLabel: 'טופל',
        },
        {
          key: 'attention',
          label: 'דורש תשומת לב',
          sublabel: 'לא דחוף, אך מומלץ לטפל',
          dotColor: 'bg-status-warning',
          headingColor: 'text-status-warning',
          bgClass: 'bg-yellow-900/8',
          borderClass: 'border-yellow-900/20',
          dismissLabel: 'טופל',
        },
        {
          key: 'upcoming',
          label: 'אירועים קרובים',
          sublabel: 'ימי הולדת ויובלים',
          dotColor: 'bg-status-reserved',
          headingColor: 'text-status-reserved',
          bgClass: 'bg-blue-900/8',
          borderClass: 'border-blue-900/20',
          dismissLabel: 'סגור',
        },
      ];
      const total = center.critical.length + center.attention.length + center.upcoming.length;
      if (total === 0) return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-2xl">✓</p>
            <p className="text-iron-text font-medium text-sm">אין התראות פעילות</p>
            <p className="text-iron-muted text-xs">כל ההתראות טופלו</p>
          </div>
        </div>
      );
      return (
        <div className="p-4 space-y-5 overflow-y-auto h-full" dir="rtl">
          {sections.map(s => {
            const alerts = center[s.key];
            if (alerts.length === 0) return null;
            return (
              <div key={s.key}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${s.dotColor}`} />
                  <p className={`text-xs font-semibold ${s.headingColor}`}>{s.label}</p>
                  <span className={`text-[10px] ${s.headingColor} opacity-60`}>({alerts.length})</span>
                  <span className="text-[10px] text-iron-muted/50 mr-1">{s.sublabel}</span>
                </div>
                <div className="space-y-2">
                  {alerts.map(a => (
                    <div key={a.id} className={`bg-iron-card border ${s.borderClass} rounded-lg p-3.5 flex items-start gap-3 group`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-iron-text font-medium leading-snug">{a.headline}</p>
                        {a.context && <p className="text-xs text-iron-muted mt-1 leading-relaxed">{a.context}</p>}
                        {a.guest && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <p className="text-xs text-iron-muted">
                              {a.guest.firstName} {a.guest.lastName}
                            </p>
                            {a.guest.visitCount > 0 && (
                              <span className="text-[11px] text-iron-muted/60 bg-iron-border px-1.5 py-0.5 rounded">{a.guest.visitCount} ביקורים</span>
                            )}
                          </div>
                        )}
                        <p className="text-[10px] text-iron-muted/40 mt-1.5">{ALERT_TYPE_HE[a.type] ?? a.type}</p>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await api.alerts.dismiss(backfillRestaurantId, a.id);
                            setIcAlerts(prev => prev ? {
                              ...prev,
                              [s.key]: (prev[s.key] as typeof alerts).filter(x => x.id !== a.id),
                              totalCount: prev.totalCount - 1,
                              unreadCount: Math.max(0, prev.unreadCount - 1),
                            } : prev);
                          } catch { /* ignore */ }
                        }}
                        className="text-[11px] text-iron-muted border border-iron-border rounded px-2 py-1 hover:border-iron-green/40 hover:text-iron-green transition-colors shrink-0 mt-0.5 opacity-0 group-hover:opacity-100"
                        title="סמן כטופל וסגור התראה"
                      >
                        {s.dismissLabel} ✓
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    };

    // ── מסרים ──────────────────────────────────────────────────
    const renderMessages = () => {
      if (!backfillRestaurantId) return <NoRestaurant />;
      if (icLoading && !icMoments) return <LoadingRow />;
      if (icError) return <ErrorRow msg={icError} />;
      if (!icMoments || icMoments.length === 0) return <EmptyRow msg="אין מסרים" />;

      // Group by status priority: PENDING → DRAFT → SENT → rest
      const statusOrder = ['PENDING', 'DRAFT', 'SENT', 'APPROVED', 'SCHEDULED', 'REJECTED', 'CANCELLED'];
      const grouped = statusOrder.map(s => ({
        status: s,
        items: icMoments.filter(m => m.status === s),
      })).filter(g => g.items.length > 0);

      return (
        <div className="flex flex-col h-full" dir="rtl">
          {/* Status bar */}
          <div className="px-4 py-2.5 border-b border-iron-border shrink-0 flex items-center gap-3 overflow-x-auto">
            {grouped.map(g => (
              <span key={g.status} className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${MOMENT_STATUS_COLOR[g.status] ?? 'text-iron-muted bg-iron-border border border-iron-border'}`}>
                {MOMENT_STATUS_HE[g.status] ?? g.status} ({g.items.length})
              </span>
            ))}
          </div>
          {/* Cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {grouped.map(g => (
              <div key={g.status}>
                {grouped.length > 1 && (
                  <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${
                    g.status === 'PENDING' ? 'text-status-warning' :
                    g.status === 'SENT' ? 'text-iron-green' :
                    g.status === 'REJECTED' ? 'text-status-danger' : 'text-iron-muted'
                  }`}>
                    {MOMENT_STATUS_HE[g.status] ?? g.status}
                  </p>
                )}
                <div className="space-y-2 mb-4">
                  {g.items.map(m => (
                    <div key={m.id} className="bg-iron-card border border-iron-border rounded-lg p-3.5">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className="text-sm font-semibold text-iron-text">{m.guest.firstName} {m.guest.lastName}</span>
                          {m.guest.phone && <p className="text-xs text-iron-muted mt-0.5" dir="ltr">{m.guest.phone}</p>}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${MOMENT_STATUS_COLOR[m.status] ?? 'text-iron-muted bg-iron-border border border-iron-border'}`}>
                          {MOMENT_STATUS_HE[m.status] ?? m.status}
                        </span>
                      </div>
                      <div className="bg-iron-bg rounded p-2.5 text-[11px] text-iron-muted leading-relaxed">
                        {m.draftMessage}
                      </div>
                      {m.finalMessage && m.finalMessage !== m.draftMessage && (
                        <div className="mt-2 bg-iron-green/5 border border-iron-green/20 rounded p-2.5 text-[11px] text-iron-green leading-relaxed">
                          <span className="font-medium text-[10px] block mb-1 text-iron-green/70">נשלח:</span>
                          {m.finalMessage}
                        </div>
                      )}
                      <p className="text-[10px] text-iron-muted/40 mt-2">{new Date(m.createdAt).toLocaleDateString('he-IL')}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    };

    // ── אירועים ────────────────────────────────────────────────
    const renderEvents = () => {
      if (!backfillRestaurantId) return <NoRestaurant />;
      if (icLoading && !icBrief && !icAlerts) return <LoadingRow />;
      if (icError) return <ErrorRow msg={icError} />;
      const todayBirthdays = icBrief?.content.birthdays    ?? [];
      const todayAnniv     = icBrief?.content.anniversaries ?? [];
      const vipArrivals    = icBrief?.content.vipArrivals  ?? [];
      const upcomingAlerts = icAlerts?.upcoming ?? [];
      const bdayAlerts     = upcomingAlerts.filter(a => a.type === 'BIRTHDAY_SOON');
      const annivAlerts    = upcomingAlerts.filter(a => a.type === 'ANNIVERSARY_SOON');
      const hasAny = todayBirthdays.length + todayAnniv.length + vipArrivals.length + bdayAlerts.length + annivAlerts.length > 0;
      if (!hasAny && (icBrief || upcomingAlerts.length >= 0)) return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-2xl">🗓</p>
            <p className="text-iron-text font-medium text-sm">אין אירועים קרובים</p>
            <p className="text-iron-muted text-xs">ימי הולדת ויובלים של אורחים יופיעו כאן</p>
          </div>
        </div>
      );
      if (!icBrief && upcomingAlerts.length === 0) return <EmptyRow msg="אין נתונים" />;

      const SectionHeader = ({ emoji, title, count, highlight }: { emoji: string; title: string; count: number; highlight?: boolean }) => (
        <div className={`flex items-center gap-2 mb-2.5 pb-2 border-b ${highlight ? 'border-iron-green/20' : 'border-iron-border/50'}`}>
          <span className="text-base">{emoji}</span>
          <p className={`text-xs font-semibold ${highlight ? 'text-iron-green' : 'text-iron-text'}`}>{title}</p>
          <span className="text-[10px] text-iron-muted">({count})</span>
          {highlight && <span className="text-[10px] text-iron-green/60 bg-iron-green/10 px-1.5 py-0.5 rounded">היום</span>}
        </div>
      );

      return (
        <div className="p-4 space-y-6 overflow-y-auto h-full" dir="rtl">
          {/* VIP today — top priority */}
          {vipArrivals.length > 0 && (
            <div>
              <SectionHeader emoji="⭐" title="VIP מגיעים הלילה" count={vipArrivals.length} highlight />
              <div className="space-y-2">
                {vipArrivals.map((v, i) => (
                  <div key={i} className="flex items-center gap-3 bg-iron-green/5 border border-iron-green/20 rounded-lg p-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-iron-text">{v.name}</p>
                      <p className="text-xs text-iron-muted mt-0.5">{v.partySize} סועדים</p>
                    </div>
                    <span className="text-xs font-medium text-iron-green bg-iron-green/10 px-2 py-1 rounded" dir="ltr">{v.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Today's birthdays */}
          {todayBirthdays.length > 0 && (
            <div>
              <SectionHeader emoji="🎂" title="ימי הולדת היום" count={todayBirthdays.length} highlight />
              <div className="space-y-2">
                {todayBirthdays.map((b, i) => (
                  <div key={i} className="flex items-center gap-3 bg-iron-card border border-iron-border rounded-lg p-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-iron-text">{b.name}</p>
                    </div>
                    <span className="text-xs text-iron-muted" dir="ltr">{b.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Upcoming birthdays */}
          {bdayAlerts.length > 0 && (
            <div>
              <SectionHeader emoji="🎂" title="ימי הולדת השבוע" count={bdayAlerts.length} />
              <div className="space-y-2">
                {bdayAlerts.map(a => (
                  <div key={a.id} className="bg-iron-card border border-iron-border rounded-lg p-3">
                    <p className="text-sm font-medium text-iron-text">{a.headline}</p>
                    {a.guest && <p className="text-xs text-iron-muted mt-0.5">{a.guest.firstName} {a.guest.lastName}</p>}
                    {a.context && <p className="text-xs text-iron-muted/70 mt-0.5">{a.context}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Today's anniversaries */}
          {todayAnniv.length > 0 && (
            <div>
              <SectionHeader emoji="💍" title="יובלים היום" count={todayAnniv.length} highlight />
              <div className="space-y-2">
                {todayAnniv.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 bg-iron-card border border-iron-border rounded-lg p-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-iron-text">{a.name}</p>
                    </div>
                    <span className="text-xs text-iron-muted" dir="ltr">{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Upcoming anniversaries */}
          {annivAlerts.length > 0 && (
            <div>
              <SectionHeader emoji="💍" title="יובלים השבוע" count={annivAlerts.length} />
              <div className="space-y-2">
                {annivAlerts.map(a => (
                  <div key={a.id} className="bg-iron-card border border-iron-border rounded-lg p-3">
                    <p className="text-sm font-medium text-iron-text">{a.headline}</p>
                    {a.guest && <p className="text-xs text-iron-muted mt-0.5">{a.guest.firstName} {a.guest.lastName}</p>}
                    {a.context && <p className="text-xs text-iron-muted/70 mt-0.5">{a.context}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    };

    // ── עדכון ניקוד (backfill) ─────────────────────────────────
    const renderBackfill = () => {
      const HE: Record<string, string> = { VIP: 'VIP', LOYAL: 'נאמן', VIP_CANDIDATE: 'מועמד VIP', HIGH_ENGAGEMENT: 'מעורב מאוד', RECOVERED: 'חזר אלינו', AT_RISK: 'בסיכון', SILENT: 'לא חזר', CRM_MEMBER: 'חבר CRM', NEEDS_ATTENTION: 'דורש מעקב', NEW: 'חדש' };
      return (
        <div className="p-5 max-w-lg space-y-5 overflow-y-auto h-full" dir="rtl">
          {/* Explanation panel */}
          <div className="bg-iron-card border border-iron-border rounded-lg p-4 space-y-3">
            <p className="text-sm font-semibold text-iron-text">עדכון ניקוד אורחים — מה זה?</p>
            <div className="space-y-2 text-xs text-iron-muted leading-relaxed">
              <div className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5 shrink-0">✓</span>
                <span><strong className="text-iron-text">מה הפעולה עושה:</strong> מחשבת מחדש את ציון הנאמנות לכל אורח, על סמך מספר הביקורים, תדירות ההגעה, ומשוב שהשאיר.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5 shrink-0">✓</span>
                <span><strong className="text-iron-text">על אילו אורחים:</strong> כל האורחים הרשומים במסעדה, כולל אורחים מיובאים מ-CRM.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5 shrink-0">✓</span>
                <span><strong className="text-iron-text">מה מתעדכן:</strong> רמת החברות (VIP / נאמן / חדש / בסיכון וכד') ב-IRON CLUB — כך שהתראות ומסרים יהיו מדויקים יותר.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-status-danger mt-0.5 shrink-0">✕</span>
                <span><strong className="text-iron-text">מה לא קורה:</strong> לא נשלחות הודעות SMS או WhatsApp. לא נוצרות הזמנות. לא מושפעת שום הגדרה אחרת.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-iron-muted mt-0.5 shrink-0">💡</span>
                <span><strong className="text-iron-text">מתי להפעיל:</strong> אחרי ייבוא רשימת לקוחות מ-CRM, או אחת לחודש לרענון הנתונים.</span>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-iron-muted mb-1">מסעדה</label>
            <select
              className="w-full text-sm bg-iron-card border border-iron-border rounded-lg px-3 py-2 text-iron-text"
              value={backfillRestaurantId}
              onChange={e => { setBackfillRestaurantId(e.target.value); setBackfillResult(null); setBackfillError(null); }}
            >
              <option value="">— בחר —</option>
              {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              disabled={!backfillRestaurantId || backfillBusy}
              onClick={async () => {
                if (!backfillRestaurantId) return;
                setBackfillBusy(true); setBackfillResult(null); setBackfillError(null);
                try { setBackfillResult(await api.intelligence.backfillV2(backfillRestaurantId, true)); }
                catch (e) { setBackfillError(e instanceof Error ? e.message : String(e)); }
                finally { setBackfillBusy(false); }
              }}
              className="flex-1 px-3 py-2 border border-iron-border rounded text-xs font-medium text-iron-text hover:bg-iron-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {backfillBusy ? <span className="flex items-center gap-1.5 justify-center"><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />סימולציה...</span> : 'סימולציה'}
            </button>
            <button
              disabled={!backfillRestaurantId || backfillBusy}
              onClick={async () => {
                if (!backfillRestaurantId) return;
                if (!window.confirm('להריץ עדכון ניקוד אמיתי ולעדכן את כל האורחים?')) return;
                setBackfillBusy(true); setBackfillResult(null); setBackfillError(null);
                try { setBackfillResult(await api.intelligence.backfillV2(backfillRestaurantId, false)); }
                catch (e) { setBackfillError(e instanceof Error ? e.message : String(e)); }
                finally { setBackfillBusy(false); }
              }}
              className="flex-1 px-3 py-2 bg-iron-green text-black rounded text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {backfillBusy ? <span className="flex items-center gap-1.5 justify-center"><span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />מעדכן...</span> : 'עדכן ניקוד אורחים'}
            </button>
          </div>
          {backfillBusy && <div className="flex items-center gap-2 text-xs text-iron-muted"><Spinner /><span>מעבד אורחים...</span></div>}
          {backfillError && <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded p-3">{backfillError}</div>}
          {backfillResult && (
            <div className="space-y-3">
              <div className={`text-xs font-semibold px-2 py-1 rounded inline-block ${backfillResult.dryRun ? 'bg-yellow-900/30 text-yellow-400' : 'bg-green-900/30 text-green-400'}`}>
                {backfillResult.dryRun ? 'סימולציה — לא בוצעו שינויים' : '✓ עדכון ניקוד הושלם'}
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                {[['סה״כ אורחים', backfillResult.total], ['עובדו', backfillResult.processed], ['שגיאות', backfillResult.errors]].map(([k, v]) => (
                  <div key={String(k)} className="bg-iron-card rounded p-2">
                    <dt className="text-iron-muted">{k}</dt>
                    <dd className={`font-semibold text-sm mt-0.5 ${k === 'שגיאות' && Number(v) > 0 ? 'text-red-400' : 'text-iron-text'}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              {Object.keys(backfillResult.labelDistribution).length > 0 && (
                <div>
                  <p className="text-xs text-iron-muted mb-2">התפלגות רמות חברות</p>
                  <div className="space-y-1">
                    {Object.entries(backfillResult.labelDistribution).sort((a, b) => b[1] - a[1]).map(([label, count]) => {
                      const pct = backfillResult.total > 0 ? Math.round(count / backfillResult.total * 100) : 0;
                      return (
                        <div key={label} className="flex items-center gap-2 text-xs">
                          <span className="w-28 text-iron-muted shrink-0">{HE[label] ?? label}</span>
                          <div className="flex-1 bg-iron-border rounded-full h-1.5"><div className="bg-iron-green h-1.5 rounded-full" style={{ width: `${pct}%` }} /></div>
                          <span className="w-14 text-right text-iron-text">{count} <span className="text-iron-muted">({pct}%)</span></span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {backfillResult.errorDetails.length > 0 && (
                <div>
                  <p className="text-xs text-iron-muted mb-1">שגיאות:</p>
                  {backfillResult.errorDetails.map((e, i) => (
                    <div key={i} className="text-xs text-red-400 font-mono bg-iron-card rounded px-2 py-1 mb-1">{e.guestId}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    const tabContentMap: Record<IcTab, () => React.ReactNode> = {
      overview: renderOverview, members: renderMembers, alerts: renderAlerts,
      messages: renderMessages, events: renderEvents, backfill: renderBackfill,
    };

    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden" dir="rtl">
        {/* Sub-tab nav */}
        <div className="border-b border-iron-border flex items-center px-2 shrink-0 bg-iron-bg">
          {IC_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setIcTab(t.key)}
              className={`px-3 py-3 text-xs font-medium transition-colors whitespace-nowrap border-b-2 -mb-px ${
                icTab === t.key
                  ? 'text-iron-green border-iron-green'
                  : 'text-iron-muted hover:text-iron-text border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {tabContentMap[icTab]()}
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
              <h2 className="text-lg font-semibold">ניצול SMS</h2>
              <p className="text-iron-muted text-sm mt-0.5">כמה SMS כל מסעדה שלחה בפועל.</p>
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
                  <div className="text-xs text-iron-muted mt-1">נשלחו ({smsUsage?.month ?? '—'})</div>
                </div>
                <div className="bg-iron-surface rounded-lg p-4 border border-iron-border">
                  <div className="text-2xl font-semibold text-status-danger">{smsUsage?.totals.failed ?? 0}</div>
                  <div className="text-xs text-iron-muted mt-1">נכשלו</div>
                </div>
                <div className="bg-iron-surface rounded-lg p-4 border border-iron-border">
                  <div className="text-2xl font-semibold text-iron-muted">{smsUsage?.totals.mock ?? 0}</div>
                  <div className="text-xs text-iron-muted mt-1">Mock (בדיקות)</div>
                </div>
              </div>

              <div className="bg-iron-surface rounded-lg border border-iron-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-iron-muted border-b border-iron-border">
                      <th className="px-4 py-3 font-medium">מסעדה</th>
                      <th className="px-4 py-3 font-medium">SMS</th>
                      <th className="px-4 py-3 font-medium text-right">נשלחו</th>
                      <th className="px-4 py-3 font-medium text-right">נכשלו</th>
                      <th className="px-4 py-3 font-medium text-right">Mock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-iron-muted">אין מסעדות</td></tr>
                    ) : rows.map(r => (
                      <React.Fragment key={r.restaurantId}>
                        <tr
                          onClick={() => toggleSmsDetail(r.restaurantId)}
                          className={`border-b border-iron-border/60 last:border-0 cursor-pointer hover:bg-iron-bg ${smsDetailId === r.restaurantId ? 'bg-iron-bg' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-iron-text">{smsDetailId === r.restaurantId ? '▾' : '▸'} {r.name}</div>
                            {r.smsSenderName && <div className="text-xs text-iron-muted ms-4">שולח: {r.smsSenderName}</div>}
                          </td>
                          <td className="px-4 py-3">
                            {r.smsEnabled
                              ? <span className="text-iron-green text-xs font-medium">{r.smsProvider === 'INFORU' ? 'חי' : 'פעיל (בדיקות)'}</span>
                              : <span className="text-iron-muted text-xs">כבוי</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">{r.sent}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-status-danger">{r.failed || ''}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-iron-muted">{r.mock || ''}</td>
                        </tr>
                        {smsDetailId === r.restaurantId && (
                          <tr className="border-b border-iron-border/60">
                            <td colSpan={5} className="px-4 py-4 bg-iron-bg/50">
                              {smsDetailLoading || !smsDetail ? (
                                <div className="flex justify-center py-4">
                                  <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-iron-muted mb-2">פירוט לפי סוג ({smsDetail.month})</p>
                                    {smsDetail.byType.length === 0 ? (
                                      <p className="text-xs text-iron-muted">אין הודעות החודש.</p>
                                    ) : (
                                      <div className="flex flex-wrap gap-2">
                                        {smsDetail.byType.map(t => (
                                          <span key={t.messageType} className="text-xs bg-iron-surface border border-iron-border rounded px-2 py-1">
                                            {t.messageType}: <span className="text-iron-green">{t.sent}</span>
                                            {t.failed > 0 && <span className="text-status-danger"> / {t.failed} נכשלו</span>}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-iron-muted mb-2">הודעות אחרונות</p>
                                    {smsDetail.latest.length === 0 ? (
                                      <p className="text-xs text-iron-muted">אין הודעות מתועדות.</p>
                                    ) : (
                                      <div className="space-y-1">
                                        {smsDetail.latest.map(m => (
                                          <div key={m.id} className="text-xs flex items-center gap-2 flex-wrap">
                                            <span className={m.status === 'SENT' || m.status === 'DELIVERED' ? 'text-iron-green' : m.status === 'FAILED' ? 'text-status-danger' : 'text-iron-muted'}>{m.status}</span>
                                            <span className="text-iron-muted">{new Date(m.createdAt).toLocaleString()}</span>
                                            <span className="text-iron-text">{m.messageType}</span>
                                            <span className="text-iron-muted">→ {m.phone}</span>
                                            {m.senderName && <span className="text-iron-muted">[{m.senderName}]</span>}
                                            {m.errorMessage && <span className="text-status-danger italic">{m.errorMessage}</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
            <span className="text-xs font-semibold text-iron-muted uppercase tracking-wide">הלילה</span>
            {groupDetail.restaurants.length > 0 && (
              <span className="text-xs text-iron-muted">{groupDetail.restaurants.length} סניף{groupDetail.restaurants.length !== 1 ? 'ים' : ''}</span>
            )}
          </div>
          {tonightLoading ? (
            <div className="flex items-center gap-2 text-xs text-iron-muted">
              <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
              טוען…
            </div>
          ) : !hasActivity ? (
            <p className="text-sm text-iron-muted">שקט הלילה</p>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-semibold">{totalBooked} <span className="font-normal text-iron-muted text-xs">הוזמנו</span></span>
              <span className="text-sm font-semibold text-iron-green">{totalSeated} <span className="font-normal text-iron-muted text-xs">יושבים</span></span>
              {totalUpcoming > 0 && (
                <span className="text-sm font-semibold text-status-reserved">{totalUpcoming} <span className="font-normal text-iron-muted text-xs">מגיעים בקרוב</span></span>
              )}
              {totalLate > 0 && (
                <span className="text-sm font-semibold text-status-warning">{totalLate} <span className="font-normal text-iron-muted text-xs">מאחרים</span></span>
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
                      <a
                        href={`${BASE_URL}/${r.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-iron-green/70 hover:text-iron-green ml-2 transition-colors"
                        title="כניסת צוות"
                        dir="ltr"
                      >
                        /{r.slug} ↗
                      </a>
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
                        <span className="text-xs text-iron-muted/50">שקט</span>
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
                            <span className="text-iron-muted text-xs">⚙</span> פרטי מסעדה
                          </button>
                          <button
                            onClick={() => { selectRestaurant(r.id, 'settings'); setOpenActionsId(null); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2"
                          >
                            <span className="text-iron-muted text-xs">✎</span> הגדרות סניף
                          </button>
                          <div className="border-t border-iron-border my-1" />
                          <a
                            href={bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpenActionsId(null)}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2 block"
                          >
                            <span className="text-iron-muted text-xs">↗</span> פתח דף הזמנות
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(bookingUrl);
                              showToast('לינק הועתק');
                              setOpenActionsId(null);
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-iron-bg text-iron-text flex items-center gap-2"
                          >
                            <span className="text-iron-muted text-xs">⧉</span> העתק לינק הזמנה
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
                    {u.isActive ? 'פעיל' : 'לא פעיל'}
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
          <span className="text-xs px-2 py-0.5 bg-iron-green/20 text-iron-green rounded font-medium">מנהל</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-iron-muted">{auth.user.email ?? ''}</span>
          <button
            onClick={() => setHqTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-iron-border text-iron-muted hover:text-iron-text hover:bg-iron-bg transition-colors text-base"
            title={hqTheme === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה'}
          >
            {hqTheme === 'dark' ? '☀' : '☾'}
          </button>
          {onDashboard && (
            <button
              onClick={onDashboard}
              className="text-sm text-iron-muted hover:text-iron-text px-3 py-1.5 rounded hover:bg-iron-bg border border-iron-border"
            >
              לוח בקרה
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
              <button
                onClick={() => { setSidebarTab('intelligence'); setView('splash'); setSelectedId(null); setSelectedGroupId(null); setBackfillResult(null); setBackfillError(null); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === 'intelligence' ? 'text-iron-green border-b-2 border-iron-green' : 'text-iron-muted hover:text-iron-text'}`}
              >IRON CLUB</button>
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
                restaurants.map(r => {
                  const isGhost = r._count.users === 0 && r._count.tables === 0;
                  return (
                  <button
                    key={r.id}
                    onClick={() => selectRestaurant(r.id)}
                    className={`w-full text-left px-4 py-3 border-b border-iron-border hover:bg-iron-bg transition-colors ${
                      selectedId === r.id ? 'border-l-2 border-l-iron-green bg-iron-bg' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{r.name}</span>
                      {isGhost && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning border border-status-warning/30 font-medium">
                          לא פעילה
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-iron-muted mt-0.5">
                      {r._count.users}מ · {r._count.tables}ש · {r._count.reservations}ה
                      {r.groupId && <span className="ml-1 text-iron-green/70">●</span>}
                    </div>
                  </button>
                  );
                })
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
                    <div className="text-xs text-iron-muted mt-0.5">{g._count.restaurants} סניפים · {g._count.users} מנהלים</div>
                  </button>
                ))
              )}
            </div>
          </>)}

          {/* IRON CLUB — compact restaurant selector in sidebar */}
          {sidebarTab === 'intelligence' && (
            <div className="p-3 border-b border-iron-border shrink-0" dir="rtl">
              <p className="text-[10px] font-semibold text-iron-green uppercase tracking-wide mb-1.5">IRON CLUB</p>
              <select
                className="w-full text-sm bg-iron-card border border-iron-border rounded-lg px-3 py-2 text-iron-text"
                value={backfillRestaurantId}
                onChange={e => {
                  setBackfillRestaurantId(e.target.value);
                  setBackfillResult(null); setBackfillError(null);
                  setIcClubStats(null); setIcRecovStats(null); setIcAlerts(null);
                  setIcMembers(null); setIcMoments(null); setIcBrief(null);
                }}
              >
                <option value="">— בחר מסעדה —</option>
                {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
        </div>}

        {/* Main content */}
        <PanelErrorBoundary resetKey={`${view}-${selectedId ?? ''}-${selectedGroupId ?? ''}`}>
          <div className="flex-1 overflow-hidden flex">
            {view === 'splash' && sidebarTab === 'intelligence' && renderIronClub()}
            {view === 'splash' && sidebarTab !== 'intelligence' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-iron-muted text-sm">
                    {sidebarTab === 'groups'
                      ? (groups.length === 0 ? T.admin.noGroupsHint : 'בחר קבוצה או צור קבוצה חדשה')
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
