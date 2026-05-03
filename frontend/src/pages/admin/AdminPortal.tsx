import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../api';
import { useT } from '../../i18n/useT';
import type { AdminRestaurant, AdminRestaurantDetail, AdminUser, AuthState } from '../../types';

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

const DEFAULT_BASIC: WizardBasic     = { name: '', slug: '', timezone: 'America/New_York', phone: '', email: '', address: '' };
const DEFAULT_SETTINGS: WizardSettings = {
  defaultTurnMinutes: 90, slotIntervalMinutes: 15, maxPartySize: 20,
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
  // Restaurant list
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [listLoading, setListLoading]  = useState(true);

  // View state
  const [view,       setView]       = useState<'splash' | 'create' | 'detail'>('splash');
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

  // Add user state
  const [showAddUser,      setShowAddUser]      = useState(false);
  const [userForm,         setUserForm]         = useState<WizardUser>(DEFAULT_USER);
  const [userBusy,         setUserBusy]         = useState(false);
  const [userError,        setUserError]        = useState<string | null>(null);
  const [userFieldErrors,  setUserFieldErrors]  = useState<Record<string, string | undefined>>({});

  // Layout seeding
  const [layoutBusy, setLayoutBusy] = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

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
        slotIntervalMinutes:       Number(s.slotIntervalMinutes ?? 15),
        maxPartySize:              Number(s.maxPartySize ?? 20),
        autoConfirm:               Boolean(s.autoConfirm ?? false),
        bufferBetweenTurnsMinutes: Number(s.bufferBetweenTurnsMinutes ?? 15),
        lastSeatingOffset:         Number(s.lastSeatingOffset ?? 60),
        lateThresholdMinutes:      Number(s.lateThresholdMinutes ?? 5),
        noShowThresholdMinutes:    Number(s.noShowThresholdMinutes ?? 15),
      });
    } catch { /* ignore */ }
    finally { setDetailBusy(false); }
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function selectRestaurant(id: string) {
    setSelectedId(id);
    setView('detail');
    setActiveTab('info');
    setEditInfo(false);
    setEditSettings(false);
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
    try {
      const updated = await api.admin.restaurants.settings(selectedId, settingsForm as unknown as Record<string, unknown>);
      setDetail(d => d ? { ...d, settings: updated.settings } : d);
      setEditSettings(false);
      showToast(T.admin.settingsSaved);
    } catch { /* ignore */ }
    finally { setSettingsBusy(false); }
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
            Restaurant created — fix the errors below to add the first user, or skip.
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
              <button onClick={() => setEditInfo(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>
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
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveSettings} disabled={settingsBusy} className={btnPrimary}>{settingsBusy ? T.admin.saveBusy : T.admin.saveBtn}</button>
              <button onClick={() => setEditSettings(false)} className={btnSecondary}>{T.admin.cancelBtn}</button>
            </div>
          </div>
        ) : (
          <div className="bg-iron-surface rounded-lg p-5 border border-iron-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Service settings</h3>
              <button onClick={() => setEditSettings(true)} className="text-xs text-iron-muted hover:text-iron-text px-2 py-1 rounded hover:bg-iron-bg">{T.admin.editBtn}</button>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['Default turn time',   `${s.defaultTurnMinutes ?? 90}m`],
                ['Slot interval',       `${s.slotIntervalMinutes ?? 15}m`],
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
        ) : (
          <button onClick={() => setShowAddUser(true)} className={btnSecondary + ' w-full text-center'}>
            {T.admin.addUser}
          </button>
        )}
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
          <span className="text-sm text-iron-muted">{auth.user.email}</span>
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
          <div className="p-4 border-b border-iron-border">
            <button
              onClick={openCreate}
              className="w-full px-3 py-2 bg-iron-green text-black font-semibold rounded text-sm"
            >
              {T.admin.newRestaurant}
            </button>
          </div>
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
                  <div className="text-xs text-iron-muted mt-0.5">{r._count.users}u · {r._count.tables}t · {r._count.reservations}r</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex">
          {view === 'splash' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-iron-muted text-sm">
                  {restaurants.length === 0 ? T.admin.noRestaurantsHint : 'Select a restaurant or create a new one'}
                </p>
              </div>
            </div>
          )}
          {view === 'create' && renderWizard()}
          {view === 'detail' && renderDetail()}
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
