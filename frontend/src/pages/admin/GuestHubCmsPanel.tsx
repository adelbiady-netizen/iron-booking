// ─── Guest Hub CMS Panel ───────────────────────────────────────────────────────
// Structured editor for GuestHubBranding and GuestHubSocialLink.
// Rendered inside AdminPortal's "Guest Hub" restaurant detail tab.
//
// Scope: branding fields + social links only.
// Not in scope: menu, dishes, promotions, events, theme builder, image uploads.

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../api';
import GuestHubMenuPanel from './GuestHubMenuPanel';
import GuestHubQrPanel from './GuestHubQrPanel';
import ImageUploadField from '../../components/ImageUploadField';

// ── Types (mirrors backend HubAdminDto) ───────────────────────────────────────

interface HubBranding {
  id: string;
  name: string;
  tagline: string | null;
  about: string | null;
  estYear: number | null;
  features: string[];
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  themePreset: string | null;
  galleryImages: string[];
  galleryEnabled: boolean;
}

interface HubSocial {
  id: string;
  platform: string;
  handle: string;
  sortOrder: number;
}

interface HubQrToken {
  id: string;
  token: string;
  label: string | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
}

interface HubData {
  id: string;
  slug: string;
  isActive: boolean;
  publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
  lastPublishedAt: string | null;
  draftUpdatedAt: string | null;
  branding: HubBranding | null;
  socialLinks: HubSocial[];
  publishedBranding: HubBranding | null;
  publishedSocialLinks: HubSocial[];
  qrTokens: HubQrToken[];
}

// Controlled preset keys — must match hubThemes.ts PRESETS keys
const PRESET_OPTIONS = [
  { id: 'ESPRESSO', label: 'Espresso', swatch: '#C9A96E', bg: '#0D0A07', description: 'Warm Italian evening · amber candlelight', useCase: 'Fine dining · Trattorias · Whisky bars',          recommendation: 'Recommended for Italian evening dining' },
  { id: 'OLIVE',    label: 'Olive',    swatch: '#96C070', bg: '#0A0D08', description: 'Mediterranean garden · natural earth warmth', useCase: 'Farm-to-table · Garden terraces',              recommendation: 'Ideal for Mediterranean hospitality' },
  { id: 'WINE',     label: 'Wine',     swatch: '#C06882', bg: '#0C0609', description: 'Deep burgundy · premium dinner service',     useCase: 'Wine bars · Romantic bistros',                 recommendation: 'Perfect for premium dinner atmosphere' },
  { id: 'MIDNIGHT', label: 'Midnight', swatch: '#6098D8', bg: '#080A12', description: 'Dark cocktail lounge · city-light depth',   useCase: 'Cocktail lounges · Rooftop bars',               recommendation: 'Best for cocktail lounges & late-night venues' },
  { id: 'SAND',     label: 'Sand',     swatch: '#D4A840', bg: '#100C07', description: 'Golden hour warmth · coastal café',         useCase: 'Brunch spots · Mediterranean cafés',           recommendation: 'Great for cafés and daylight brunch' },
  { id: 'SLATE',    label: 'Slate',    swatch: '#8AAFC8', bg: '#0A0C10', description: 'Modern urban precision · cool neutral',     useCase: 'Contemporary restaurants · Michelin dining',   recommendation: 'Best for modern sushi & contemporary concepts' },
] as const;

const FEATURE_OPTIONS = [
  { id: 'OUTDOOR_SEATING', label: 'Outdoor Seating' },
  { id: 'PRIVATE_DINING',  label: 'Private Dining' },
  { id: 'LIVE_MUSIC',      label: 'Live Music' },
  { id: 'VEGAN_OPTIONS',   label: 'Vegan Options' },
  { id: 'ROOFTOP',         label: 'Rooftop' },
  { id: 'CHEFS_CHOICE',    label: "Chef's Choice" },
] as const;

type BrandingForm = {
  name: string;
  tagline: string;
  about: string;
  estYear: string;      // string in form, parsed to int on save; '' = not set
  features: string[];
  phone: string;
  address: string;
  logoUrl: string;
  coverImageUrl: string;
  themePreset: string;  // '' = use default (Espresso)
  galleryImages: string[];
  galleryEnabled: boolean;
};

type SocialRow = { platform: string; handle: string };

// ── Validation helper ─────────────────────────────────────────────────────────

function isValidUrl(s: string): boolean {
  if (!s.trim()) return true;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ── Shared admin UI primitives (local, consistent with AdminPortal style) ─────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-iron-muted mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function Inp(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green ${props.className ?? ''}`}
    />
  );
}

function Btn({
  onClick, disabled, busy, children, variant = 'primary',
}: {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const base = 'px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50';
  const cls =
    variant === 'primary' ? `${base} bg-iron-green hover:bg-iron-green-light text-white` :
    variant === 'danger'  ? `${base} bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30` :
    `${base} border border-iron-border text-iron-muted hover:text-iron-text`;
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled || busy}>
      {busy ? 'Saving…' : children}
    </button>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok:    'TikTok',
  website:   'Website',
  facebook:  'Facebook',
  twitter:   'Twitter / X',
  youtube:   'YouTube',
};

const ALLOWED_PLATFORMS = ['instagram', 'tiktok', 'website', 'facebook', 'twitter', 'youtube'];

// ── Theme suggestion helper ───────────────────────────────────────────────────
// Pure keyword match against venue name + tagline — no AI, fully deterministic.
// Returns the two best-fit preset IDs and a short venue-type phrase, or null.

type ThemeSuggestion = { themeIds: [string, string]; phrase: string } | null;

function getThemeSuggestion(name: string, tagline: string): ThemeSuggestion {
  const text = `${name} ${tagline}`.toLowerCase();
  const rules: Array<{ terms: string[]; themeIds: [string, string]; phrase: string }> = [
    { terms: ['italian','trattoria','osteria','risotto','pasta','aperitivo'],          themeIds: ['ESPRESSO','WINE'],     phrase: 'Italian evening dining' },
    { terms: ['wine','cellar','bistro','romantic','candlelight','french'],              themeIds: ['WINE','ESPRESSO'],    phrase: 'candlelit dinner service' },
    { terms: ['mediterranean','greek','terrace','garden','levantine','mezze','mezze'], themeIds: ['OLIVE','SAND'],       phrase: 'Mediterranean & garden dining' },
    { terms: ['cocktail','lounge','spirits','rooftop','mixology','speakeasy'],         themeIds: ['MIDNIGHT','SLATE'],   phrase: 'cocktail bars & late-night venues' },
    { terms: ['café','cafe','brunch','breakfast','coffee','bakery','patisserie'],       themeIds: ['SAND','ESPRESSO'],   phrase: 'café, brunch & daylight dining' },
    { terms: ['modern','contemporary','michelin','sushi','fusion','japanese','nordic'], themeIds: ['SLATE','MIDNIGHT'],  phrase: 'contemporary & modern concepts' },
    { terms: ['seafood','coastal','beach','ocean'],                                    themeIds: ['SAND','OLIVE'],       phrase: 'coastal & garden dining' },
    { terms: ['steakhouse','grill','bbq','smokehouse'],                                themeIds: ['ESPRESSO','MIDNIGHT'],  phrase: 'grill & robust dining atmospheres' },
  ];
  for (const rule of rules) {
    if (rule.terms.some(t => text.includes(t))) return { themeIds: rule.themeIds, phrase: rule.phrase };
  }
  return null;
}

// ── Brand readiness calculator ────────────────────────────────────────────────
// Pure function — no side effects. Used in-component for live editorial guidance.

interface ReadinessInput {
  logoUrl:       string | null | undefined;
  coverImageUrl: string | null | undefined;
  tagline:       string | null | undefined;
  address:       string | null | undefined;
  phone:         string | null | undefined;
  hasSocial:     boolean;
  menuCats:      number;
  dishImages:    number;
}

interface ReadinessResult {
  score: number;
  label: string;
  tips:  string[];
}

const READINESS_WEIGHTS = {
  logo:       15,
  cover:      15,
  tagline:    15,
  address:    10,
  phone:      10,
  social:     10,
  menuCats:   15,
  dishImages: 10,
} as const;

function calcReadiness(input: ReadinessInput): ReadinessResult {
  const checks = {
    logo:       !!input.logoUrl?.trim(),
    cover:      !!input.coverImageUrl?.trim(),
    tagline:    !!input.tagline?.trim(),
    address:    !!input.address?.trim(),
    phone:      !!input.phone?.trim(),
    social:     input.hasSocial,
    menuCats:   input.menuCats > 0,
    dishImages: input.dishImages > 0,
  };

  const score = (Object.keys(checks) as Array<keyof typeof checks>).reduce(
    (acc, key) => checks[key] ? acc + READINESS_WEIGHTS[key] : acc, 0,
  );

  const label =
    score < 20 ? 'Starting' :
    score < 40 ? 'Building Presence' :
    score < 70 ? 'Guest Ready' :
    score < 90 ? 'Hospitality Ready' :
                 'Premium Experience Ready';

  const ALL_TIPS: Array<{ key: keyof typeof checks; text: string }> = [
    { key: 'cover',      text: 'Add a cover image to improve first impressions' },
    { key: 'logo',       text: 'A venue logo anchors your brand from first glance' },
    { key: 'tagline',    text: 'A venue description helps guests understand your concept' },
    { key: 'menuCats',   text: 'A menu section builds anticipation before arrival' },
    { key: 'dishImages', text: 'Menu photos help increase browsing engagement' },
    { key: 'address',    text: 'Guests trust restaurants with a visible address' },
    { key: 'phone',      text: 'Guests trust restaurants with visible contact details' },
    { key: 'social',     text: 'An Instagram or website link extends your online presence' },
  ];

  const tips = ALL_TIPS.filter(t => !checks[t.key]).slice(0, 4).map(t => t.text);

  return { score, label, tips };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GuestHubCmsPanel({ restaurantId }: { restaurantId: string }) {
  const [activeTab, setActiveTab] = useState<'branding' | 'menu' | 'qr'>('branding');
  const [status, setStatus] = useState<'loading' | 'not_found' | 'ready' | 'error'>('loading');
  const [hub,    setHub]    = useState<HubData | null>(null);

  // Branding edit
  const [editingBranding, setEditingBranding] = useState(false);
  const [brandingForm,    setBrandingForm]    = useState<BrandingForm>({ name: '', tagline: '', about: '', estYear: '', features: [], phone: '', address: '', logoUrl: '', coverImageUrl: '', themePreset: '', galleryImages: [], galleryEnabled: false });
  const [brandingBusy,    setBrandingBusy]    = useState(false);
  const [brandingErrors,  setBrandingErrors]  = useState<Record<string, string>>({});
  const [brandingError,   setBrandingError]   = useState<string | null>(null);

  // Social edit
  const [editingSocial, setEditingSocial] = useState(false);
  const [socialRows,    setSocialRows]    = useState<SocialRow[]>([]);
  const [socialBusy,    setSocialBusy]    = useState(false);
  const [socialError,   setSocialError]   = useState<string | null>(null);

  // Publish
  const [publishBusy,    setPublishBusy]    = useState(false);
  const [publishError,   setPublishError]   = useState<string | null>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);

  // Menu summary for publish warnings + brand readiness (fetched silently after hub loads)
  const [menuSummary, setMenuSummary] = useState<{ cats: number; dishes: number; dishImages: number } | null>(null);

  // Provision
  const [provisioning,   setProvisioning]   = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Activate / deactivate
  const [activating,    setActivating]    = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Load ──────────────────────────────────────────────────────────────────────

  function handlePublishClick() {
    setPublishConfirm(true);
  }

  async function provision() {
    setProvisioning(true);
    setProvisionError(null);
    try {
      await api.admin.guestHub.provision(restaurantId);
      await load();
    } catch (err) {
      setProvisionError(err instanceof ApiError ? err.message : 'Failed to create Guest Hub');
    } finally {
      setProvisioning(false);
    }
  }

  async function activate() {
    setActivating(true);
    setActivateError(null);
    try {
      const result = await api.admin.guestHub.activate(restaurantId);
      setHub(prev => prev ? { ...prev, publicStatus: result.publicStatus } : prev);
      showToast('Guest Hub is now live');
    } catch (err) {
      setActivateError(err instanceof ApiError ? err.message : 'Failed to activate');
    } finally { setActivating(false); }
  }

  async function deactivate() {
    setActivating(true);
    setActivateError(null);
    try {
      const result = await api.admin.guestHub.deactivate(restaurantId);
      setHub(prev => prev ? { ...prev, publicStatus: result.publicStatus } : prev);
      showToast('Guest Hub taken offline');
    } finally { setActivating(false); }
  }

  async function publish() {
    if (!hub) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      const result = await api.admin.guestHub.publish(restaurantId);
      setHub(prev => prev ? {
        ...prev,
        lastPublishedAt:      result.publishedAt,
        publishedBranding:    prev.branding,
        publishedSocialLinks: prev.socialLinks,
      } : prev);
      setPublishConfirm(false);
      showToast('Published successfully');
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : 'Failed to publish');
    } finally { setPublishBusy(false); }
  }

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await api.admin.guestHub.get(restaurantId);
      setHub(data);
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.message.includes('404'))) {
        setStatus('not_found');
      } else {
        setStatus('error');
      }
    }
  }, [restaurantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (status !== 'ready') return;
    void (async () => {
      try {
        const data = await api.admin.guestHub.menu.get(restaurantId) as {
          menus: Array<{ categories: Array<{ dishes: Array<{ imageUrl?: string | null }> }> }>;
        };
        let cats = 0;
        let dishes = 0;
        let dishImages = 0;
        for (const menu of data.menus) {
          cats += menu.categories.length;
          for (const cat of menu.categories) {
            dishes += cat.dishes.length;
            for (const dish of cat.dishes) {
              if (dish.imageUrl) dishImages++;
            }
          }
        }
        setMenuSummary({ cats, dishes, dishImages });
      } catch {
        // silent — warnings are best-effort
      }
    })();
  }, [status, restaurantId]);

  // ── Branding edit ─────────────────────────────────────────────────────────────

  function openBrandingEdit() {
    setBrandingForm({
      name:           hub?.branding?.name                    ?? '',
      tagline:        hub?.branding?.tagline                 ?? '',
      about:          hub?.branding?.about                   ?? '',
      estYear:        hub?.branding?.estYear?.toString()     ?? '',
      features:       hub?.branding?.features                ?? [],
      phone:          hub?.branding?.phone                   ?? '',
      address:        hub?.branding?.address                 ?? '',
      logoUrl:        hub?.branding?.logoUrl                 ?? '',
      coverImageUrl:  hub?.branding?.coverImageUrl           ?? '',
      themePreset:    hub?.branding?.themePreset             ?? '',
      galleryImages:  hub?.branding?.galleryImages           ?? [],
      galleryEnabled: hub?.branding?.galleryEnabled          ?? false,
    });
    setBrandingErrors({});
    setBrandingError(null);
    setEditingBranding(true);
  }

  function cancelBrandingEdit() {
    setEditingBranding(false);
    setBrandingErrors({});
    setBrandingError(null);
  }

  function validateBrandingForm(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!brandingForm.name.trim())             e.name          = 'Display name is required';
    else if (brandingForm.name.length > 100)   e.name          = 'Max 100 characters';
    if (brandingForm.tagline.length > 200)     e.tagline       = 'Max 200 characters';
    if (brandingForm.about.length > 250)       e.about         = 'Max 250 characters';
    if (brandingForm.estYear.trim()) {
      const y = parseInt(brandingForm.estYear, 10);
      if (isNaN(y) || y < 1850 || y > new Date().getFullYear()) {
        e.estYear = `Must be a year between 1850 and ${new Date().getFullYear()}`;
      }
    }
    if (brandingForm.phone.length > 30)        e.phone         = 'Max 30 characters';
    if (brandingForm.address.length > 300)     e.address       = 'Max 300 characters';
    if (!isValidUrl(brandingForm.logoUrl))     e.logoUrl       = 'Must be a valid https:// URL';
    if (!isValidUrl(brandingForm.coverImageUrl)) e.coverImageUrl = 'Must be a valid https:// URL';
    return e;
  }

  async function saveBranding() {
    const errs = validateBrandingForm();
    if (Object.keys(errs).length > 0) { setBrandingErrors(errs); return; }
    setBrandingBusy(true);
    setBrandingError(null);
    try {
      const parsedEstYear = brandingForm.estYear.trim()
        ? parseInt(brandingForm.estYear.trim(), 10)
        : null;
      const updated = await api.admin.guestHub.updateBranding(restaurantId, {
        name:           brandingForm.name.trim(),
        tagline:        brandingForm.tagline.trim()       || null,
        about:          brandingForm.about.trim()         || null,
        estYear:        parsedEstYear,
        features:       brandingForm.features,
        phone:          brandingForm.phone.trim()         || null,
        address:        brandingForm.address.trim()       || null,
        logoUrl:        brandingForm.logoUrl.trim()       || null,
        coverImageUrl:  brandingForm.coverImageUrl.trim() || null,
        themePreset:    brandingForm.themePreset          || null,
        galleryImages:  brandingForm.galleryImages,
        galleryEnabled: brandingForm.galleryEnabled,
      });
      setHub(prev => prev
        ? { ...prev, branding: prev.branding ? { ...prev.branding, ...updated } : { ...updated }, draftUpdatedAt: new Date().toISOString() }
        : prev);
      setEditingBranding(false);
      showToast('Branding saved');
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors as Record<string, string[]>;
        if (Object.keys(fe).length > 0) {
          setBrandingErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
        }
        setBrandingError(err.message);
      } else {
        setBrandingError('Failed to save branding');
      }
    } finally { setBrandingBusy(false); }
  }

  // ── Social edit ───────────────────────────────────────────────────────────────

  function openSocialEdit() {
    setSocialRows(hub?.socialLinks.map(s => ({ platform: s.platform, handle: s.handle })) ?? []);
    setSocialError(null);
    setEditingSocial(true);
  }

  function cancelSocialEdit() {
    setEditingSocial(false);
    setSocialError(null);
  }

  function addSocialRow() {
    setSocialRows(rows => {
      const usedPlatforms = new Set(rows.map(r => r.platform));
      const next = ALLOWED_PLATFORMS.find(p => !usedPlatforms.has(p)) ?? 'website';
      return [...rows, { platform: next, handle: '' }];
    });
  }

  function removeSocialRow(idx: number) {
    setSocialRows(rows => rows.filter((_, i) => i !== idx));
  }

  function updateSocialRow(idx: number, field: 'platform' | 'handle', value: string) {
    setSocialRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  async function saveSocial() {
    for (const row of socialRows) {
      if (!row.handle.trim()) { setSocialError('All handles must be filled in'); return; }
    }
    setSocialBusy(true);
    setSocialError(null);
    try {
      const { links } = await api.admin.guestHub.updateSocial(restaurantId, socialRows.map(r => ({ platform: r.platform, handle: r.handle.trim() })));
      setHub(prev => prev ? { ...prev, socialLinks: links, draftUpdatedAt: new Date().toISOString() } : prev);
      setEditingSocial(false);
      showToast('Social links saved');
    } catch (err) {
      setSocialError(err instanceof ApiError ? err.message : 'Failed to save social links');
    } finally { setSocialBusy(false); }
  }

  // ── Render states ─────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div className="max-w-lg py-8">
        <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
          <div className="px-6 py-5 border-b border-iron-border">
            <h4 className="text-sm font-semibold text-iron-text">No Guest Hub configured</h4>
            <p className="text-iron-muted text-xs mt-1">
              Initialize a Guest Hub to give this restaurant a public-facing branded page with menu and QR scanning.
            </p>
          </div>

          <div className="px-6 py-5 space-y-3">
            <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">What gets created</p>
            <ul className="space-y-1.5 text-sm text-iron-muted">
              <li className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5">✓</span>
                <span>Public page at <code className="text-iron-green">/r/[slug]</code> — derived from the restaurant name</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5">✓</span>
                <span>Draft branding pre-filled with name, phone, and address from the restaurant record</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5">✓</span>
                <span>A default Menu section, ready for categories and dishes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-iron-green mt-0.5">✓</span>
                <span>A QR token for table-scanning (used by <code className="text-iron-green">/q/[token]</code>)</span>
              </li>
            </ul>

            <div className="bg-amber-950/30 border border-amber-700/40 rounded-lg px-4 py-3">
              <p className="text-xs text-amber-300 leading-relaxed">
                The public page will show draft content immediately, but will not appear in any listing or QR scan until you configure branding and click <strong>Publish</strong>.
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-iron-border">
            {provisionError && (
              <p className="text-xs text-red-400 mb-3">{provisionError}</p>
            )}
            <button
              type="button"
              onClick={provision}
              disabled={provisioning}
              className="px-4 py-2 bg-iron-green hover:bg-iron-green-light text-white text-sm font-semibold rounded transition-colors disabled:opacity-50"
            >
              {provisioning ? 'Creating…' : 'Create Guest Hub'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error' || !hub) {
    return (
      <div className="max-w-lg py-8">
        <div className="bg-iron-card border border-red-900/30 rounded-xl p-6">
          <p className="text-red-400 text-sm">Failed to load Guest Hub data. Try refreshing.</p>
        </div>
      </div>
    );
  }

  const draftPreviewUrl = `/r-preview/${hub.slug}`;
  const liveUrl         = `https://www.ironbooking.com/r/${hub.slug}`;

  const publishWarnings: Array<{ key: string; text: string }> = [];
  if (!hub.branding?.logoUrl)        publishWarnings.push({ key: 'logo',     text: 'No logo — guests will see a text-only header' });
  if (!hub.branding?.coverImageUrl)  publishWarnings.push({ key: 'cover',    text: 'No cover image — page will have a plain background' });
  if (!hub.branding?.phone)          publishWarnings.push({ key: 'phone',    text: 'No phone number — guests cannot call to book' });
  if (!hub.branding?.address)        publishWarnings.push({ key: 'address',  text: "No address — guests won't know your location" });
  if (menuSummary !== null && menuSummary.cats === 0)
    publishWarnings.push({ key: 'nocats',   text: 'No menu categories — the menu section will appear empty' });
  if (menuSummary !== null && menuSummary.cats > 0 && menuSummary.dishes === 0)
    publishWarnings.push({ key: 'nodishes', text: 'Menu has categories but no dishes yet' });

  const draftTheme     = hub.branding?.themePreset ?? null;
  const publishedTheme = hub.publishedBranding?.themePreset ?? null;
  const themeUnpublished = hub.lastPublishedAt !== null && draftTheme !== publishedTheme;

  const hasUnpublishedChanges = !hub.lastPublishedAt ||
    (hub.draftUpdatedAt !== null && hub.draftUpdatedAt > hub.lastPublishedAt);

  function formatPublishedAt(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-iron-card border border-iron-border rounded-lg text-sm text-iron-text shadow-xl pointer-events-none">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-iron-text">Guest Hub Content</h3>
          <p className="text-xs text-iron-muted mt-0.5">
            Slug: <code className="text-iron-green">{hub.slug}</code>
            {!hub.isActive && <span className="ml-2 text-amber-400">(inactive)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={draftPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Preview draft at ${draftPreviewUrl}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text text-xs font-medium transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Preview your page
          </a>
          {hub.publicStatus === 'PUBLISHED' ? (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-700/50 text-emerald-400 hover:text-emerald-300 text-xs font-medium transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              View live
            </a>
          ) : (
            <span
              title="Hub is not yet live — publish and activate first"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-iron-border text-iron-muted/40 text-xs font-medium cursor-not-allowed select-none"
              aria-disabled="true"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              View live
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-iron-border">
        {(['branding', 'menu', 'qr'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-iron-green text-iron-text'
                : 'border-transparent text-iron-muted hover:text-iron-text'
            }`}
          >
            {tab === 'qr' ? 'QR' : tab}
          </button>
        ))}
      </div>

      {/* Menu tab */}
      {activeTab === 'menu' && (
        <GuestHubMenuPanel restaurantId={restaurantId} />
      )}

      {/* QR tab */}
      {activeTab === 'qr' && (
        <GuestHubQrPanel
          restaurantId={restaurantId}
          slug={hub.slug}
          publicStatus={hub.publicStatus}
          brandingName={hub.branding?.name ?? null}
          brandingTagline={hub.branding?.tagline ?? null}
          primaryColor={hub.branding?.primaryColor ?? null}
        />
      )}

      {/* Branding tab content below (publish bar + sections) */}
      {activeTab === 'branding' && <>

      {/* Lifecycle bar */}
      <div className="rounded-xl border border-iron-border bg-iron-card overflow-hidden">

        {/* Row 1 — Page visibility */}
        {(() => {
          const s = hub.publicStatus;
          const isLive     = s === 'PUBLISHED';
          const isInactive = s === 'INACTIVE';
          const canActivate = s !== 'PUBLISHED' && !!hub.publishedBranding;
          return (
            <div className={`px-5 py-3.5 flex items-center justify-between gap-4 ${
              isLive     ? 'bg-emerald-950/30 border-b border-emerald-900/40' :
              isInactive ? 'bg-amber-950/20 border-b border-amber-900/30'    :
              'border-b border-iron-border'
            }`}>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400' : isInactive ? 'bg-amber-400' : 'bg-iron-muted'}`} />
                  <p className={`text-sm font-semibold ${isLive ? 'text-emerald-400' : isInactive ? 'text-amber-300' : 'text-iron-muted'}`}>
                    {isLive ? 'Live — visible to guests' : isInactive ? 'Inactive — page offline' : 'Draft — not yet live'}
                  </p>
                </div>
                <p className="text-xs text-iron-muted/70 mt-0.5 ml-3.5">
                  {isLive     ? `Guests reach this page at /r/${hub.slug}` :
                   isInactive ? 'Reactivate to restore public access' :
                   hub.publishedBranding
                     ? 'Content is published — click Activate to go live'
                     : 'Publish branding first, then activate'}
                </p>
                {activateError && <p className="text-xs text-red-400 mt-1 ml-3.5">{activateError}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {canActivate && (
                  <button
                    type="button"
                    onClick={activate}
                    disabled={activating}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
                  >
                    {activating ? 'Activating…' : isInactive ? 'Reactivate' : 'Activate'}
                  </button>
                )}
                {isLive && (
                  <button
                    type="button"
                    onClick={deactivate}
                    disabled={activating}
                    className="px-3 py-1.5 text-xs font-medium border border-iron-border text-iron-muted hover:text-red-400 hover:border-red-900/50 rounded transition-colors disabled:opacity-50"
                  >
                    {activating ? '…' : 'Deactivate'}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Row 2 — Content state */}
        <div className="px-5 py-3.5 flex items-center justify-between gap-4">
          <div>
            {hasUnpublishedChanges ? (
              <>
                <p className="text-sm font-medium text-amber-300">Unpublished content changes</p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  {hub.lastPublishedAt
                    ? `Last published ${formatPublishedAt(hub.lastPublishedAt)}`
                    : 'Never published — activate requires publishing first'}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-iron-text">Content published</p>
                <p className="text-xs text-iron-muted mt-0.5">
                  {hub.lastPublishedAt ? `Last published ${formatPublishedAt(hub.lastPublishedAt)}` : ''}
                </p>
              </>
            )}
            {!publishConfirm && publishError && (
              <p className="text-xs text-red-400 mt-1">{publishError}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {publishConfirm ? (
              <button
                type="button"
                onClick={() => setPublishConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium border border-iron-border text-iron-muted hover:text-iron-text rounded transition-colors"
              >
                Cancel
              </button>
            ) : hasUnpublishedChanges && hub.branding ? (
              <button
                type="button"
                onClick={handlePublishClick}
                disabled={publishBusy}
                className="px-4 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50 bg-amber-500 hover:bg-amber-400 text-stone-900"
              >
                {publishBusy ? 'Publishing…' : 'Review & publish →'}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="px-4 py-2 rounded text-sm font-medium bg-iron-card border border-iron-border text-iron-muted opacity-50 cursor-default flex items-center gap-1.5"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Up to date
              </button>
            )}
          </div>
        </div>

        {/* Row 3 — Live URL (only when published) */}
        {hub.publicStatus === 'PUBLISHED' && (
          <div className="px-5 py-3 border-t border-emerald-900/30 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 min-w-0 flex-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <span className="font-mono truncate">ironbooking.com/r/{hub.slug}</span>
            </div>
            {hub.qrTokens.filter(t => t.isActive).length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 text-[11px] font-medium flex-shrink-0">
                {hub.qrTokens.filter(t => t.isActive).length} QR active
              </span>
            )}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <CopyButton text={liveUrl} />
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-1 text-xs rounded border border-emerald-700/50 text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Open ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Brand Readiness ─────────────────────────────────────────────────────── */}
      {(() => {
        // Use live form values when editing so the score updates as fields are filled in.
        const effective = editingBranding
          ? { logoUrl: brandingForm.logoUrl, coverImageUrl: brandingForm.coverImageUrl,
              tagline: brandingForm.tagline, address: brandingForm.address, phone: brandingForm.phone }
          : { logoUrl: hub.branding?.logoUrl, coverImageUrl: hub.branding?.coverImageUrl,
              tagline: hub.branding?.tagline, address: hub.branding?.address, phone: hub.branding?.phone };

        const hasSocial = hub.socialLinks.some(
          s => s.platform === 'instagram' || s.platform === 'website',
        );
        const { score, label, tips } = calcReadiness({
          ...effective,
          hasSocial,
          menuCats:   menuSummary?.cats       ?? 0,
          dishImages: menuSummary?.dishImages ?? 0,
        });

        const labelOpacity =
          score < 20 ? 0.32 : score < 40 ? 0.44 : score < 70 ? 0.56 : score < 90 ? 0.72 : 0.88;

        return (
          <div className="rounded-xl border border-iron-border bg-iron-card overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <p className="text-xs font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.36)' }}>
                Brand Readiness
              </p>
              <div className="flex items-baseline gap-2.5">
                <span className="text-xl font-semibold text-iron-text tabular-nums" style={{ letterSpacing: '-0.02em' }}>
                  {score}<span className="text-sm font-normal text-iron-muted">%</span>
                </span>
                <span className="text-xs" style={{ color: `rgba(255,255,255,${labelOpacity})` }}>
                  {label}
                </span>
              </div>
            </div>
            {tips.length > 0 && (
              <div className="border-t border-iron-border/50 px-5 py-3 space-y-1.5">
                {tips.map(tip => (
                  <p key={tip} className="flex items-start gap-2.5 text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.38)' }}>
                    <span className="mt-1.5 flex-shrink-0 w-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }} aria-hidden="true" />
                    {tip}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Pre-publish review panel */}
      {publishConfirm && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-700/30">
            <p className="text-sm font-semibold text-amber-300">Review before publishing</p>
            <p className="text-xs text-amber-400/70 mt-0.5 leading-relaxed">
              These items won't block publishing but may affect how guests see your page.
            </p>
          </div>
          <div className="px-5 py-4">
            {publishWarnings.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Everything looks good — ready to publish
              </div>
            ) : (
              <ul className="space-y-2">
                {publishWarnings.map(w => (
                  <li key={w.key} className="flex items-start gap-2 text-xs text-amber-300 leading-relaxed">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-shrink-0">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    {w.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {publishError && (
            <div className="px-5 pb-3">
              <p className="text-xs text-red-400">{publishError}</p>
            </div>
          )}
          <div className="px-5 py-4 border-t border-amber-700/30 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void publish()}
              disabled={publishBusy}
              className="px-4 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-50 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {publishBusy ? 'Publishing…' : 'Publish now'}
            </button>
            <button
              type="button"
              onClick={() => setPublishConfirm(false)}
              disabled={publishBusy}
              className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 border border-iron-border text-iron-muted hover:text-iron-text"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Branding ────────────────────────────────────────────────────────────── */}
      <section className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-iron-border flex items-center justify-between">
          <h4 className="text-sm font-semibold text-iron-text">Branding</h4>
          {!editingBranding && (
            <Btn variant="ghost" onClick={openBrandingEdit}>Edit</Btn>
          )}
        </div>

        {editingBranding ? (
          <div className="p-6 space-y-4">
            <Field label="Display name *" error={brandingErrors.name}>
              <Inp
                value={brandingForm.name}
                onChange={e => setBrandingForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Ember Stone"
                maxLength={100}
              />
            </Field>
            <Field label="Tagline" error={brandingErrors.tagline}>
              <Inp
                value={brandingForm.tagline}
                onChange={e => setBrandingForm(f => ({ ...f, tagline: e.target.value }))}
                placeholder="e.g. Modern Mediterranean cuisine"
                maxLength={200}
              />
            </Field>
            <Field label="About" error={brandingErrors.about}>
              <div className="relative">
                <textarea
                  value={brandingForm.about}
                  onChange={e => setBrandingForm(f => ({ ...f, about: e.target.value }))}
                  placeholder={`e.g. Family-owned Italian kitchen open since 2014. Handmade pasta, wood-fired grill, and a 70-seat terrace in the heart of Tel Aviv.`}
                  maxLength={250}
                  rows={3}
                  className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green resize-none"
                />
                <span className="absolute bottom-2 right-3 text-[10px] text-iron-muted tabular-nums pointer-events-none">
                  {brandingForm.about.length}/250
                </span>
              </div>
              <p className="text-[10px] text-iron-muted mt-1">Short identity paragraph shown under the restaurant name. Keep it factual and under 2 sentences.</p>
            </Field>
            <Field label="Est. Year" error={brandingErrors.estYear}>
              <Inp
                value={brandingForm.estYear}
                onChange={e => setBrandingForm(f => ({ ...f, estYear: e.target.value }))}
                placeholder="e.g. 2018"
                maxLength={4}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <p className="text-[10px] text-iron-muted mt-1">Displayed as "Est. 2018" in the hero. Leave blank to hide.</p>
            </Field>
            <div>
              <label className="block text-xs text-iron-muted mb-2">Venue features</label>
              <div className="grid grid-cols-2 gap-2">
                {FEATURE_OPTIONS.map(f => (
                  <label key={f.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={brandingForm.features.includes(f.id)}
                      onChange={e => setBrandingForm(prev => ({
                        ...prev,
                        features: e.target.checked
                          ? [...prev.features, f.id]
                          : prev.features.filter(x => x !== f.id),
                      }))}
                      className="w-3.5 h-3.5 rounded accent-iron-green"
                    />
                    <span className="text-sm text-iron-text">{f.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-iron-muted mt-2">Selected signals appear as compact tags on your Guest Hub page.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" error={brandingErrors.phone}>
                <Inp
                  value={brandingForm.phone}
                  onChange={e => setBrandingForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+972 50 000 0000"
                  maxLength={30}
                />
              </Field>
              <Field label="Address" error={brandingErrors.address}>
                <Inp
                  value={brandingForm.address}
                  onChange={e => setBrandingForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="14 Rothschild Blvd, Tel Aviv"
                  maxLength={300}
                />
              </Field>
            </div>
            <ImageUploadField
              label="Logo"
              imageType="logo"
              value={brandingForm.logoUrl}
              onChange={url => setBrandingForm(f => ({ ...f, logoUrl: url }))}
              error={brandingErrors.logoUrl}
            />
            <ImageUploadField
              label="Cover image"
              imageType="cover"
              value={brandingForm.coverImageUrl}
              onChange={url => setBrandingForm(f => ({ ...f, coverImageUrl: url }))}
              error={brandingErrors.coverImageUrl}
            />

            {/* Theme preset selector */}
            <div>
              <label className="block text-xs text-iron-muted mb-2">Visual theme</label>

              {/* Smart suggestion — keyword match only, no AI claims */}
              {(() => {
                const suggestion = getThemeSuggestion(brandingForm.name, brandingForm.tagline);
                if (!suggestion) return null;
                const hasImages = !!(brandingForm.logoUrl || brandingForm.coverImageUrl);
                const [id1, id2] = suggestion.themeIds;
                const p1 = PRESET_OPTIONS.find(p => p.id === id1);
                const p2 = PRESET_OPTIONS.find(p => p.id === id2);
                const prefix = hasImages ? 'Your branding may pair well with' : 'Tends to suit';
                return (
                  <div
                    className="mb-3 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.025)', borderLeft: `2px solid ${p1?.swatch ?? 'rgba(255,255,255,0.12)'}` }}
                  >
                    <p className="text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.42)' }}>
                      {prefix}{' '}
                      {p1 && <span style={{ color: p1.swatch }}>{p1.label}</span>}
                      {p1 && p2 && <span style={{ color: 'rgba(255,255,255,0.28)' }}> or </span>}
                      {p2 && <span style={{ color: p2.swatch }}>{p2.label}</span>}
                      <span style={{ color: 'rgba(255,255,255,0.28)' }}> — well-suited for {suggestion.phrase}</span>
                    </p>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-2">
                {PRESET_OPTIONS.map(preset => {
                  const isActive = brandingForm.themePreset === preset.id ||
                    (!brandingForm.themePreset && preset.id === 'ESPRESSO');
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setBrandingForm(f => ({
                        ...f,
                        themePreset: f.themePreset === preset.id ? '' : preset.id,
                      }))}
                      className="rounded-lg border text-left transition-all overflow-hidden focus:outline-none"
                      style={{
                        backgroundColor: preset.bg,
                        borderColor: isActive ? preset.swatch : 'rgba(255,255,255,0.07)',
                        boxShadow: isActive ? `0 0 0 1px ${preset.swatch}` : 'none',
                      }}
                    >
                      <div style={{ backgroundColor: preset.swatch, height: '3px' }} />
                      <div className="px-3 py-2.5">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="text-xs font-semibold leading-tight"
                            style={{ color: isActive ? preset.swatch : 'rgba(255,255,255,0.75)' }}
                          >
                            {preset.label}
                          </span>
                          {isActive && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: preset.swatch, flexShrink: 0 }} aria-hidden="true">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </div>
                        <p className="text-[10px] leading-tight mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {preset.useCase}
                        </p>
                        <p className="text-[9px] leading-tight mt-1.5" style={{ color: isActive ? `${preset.swatch}99` : 'rgba(255,255,255,0.18)' }}>
                          {preset.recommendation}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Mini live preview */}
              {(() => {
                const active = PRESET_OPTIONS.find(p =>
                  brandingForm.themePreset ? p.id === brandingForm.themePreset : p.id === 'ESPRESSO'
                );
                if (!active) return null;
                return (
                  <div
                    className="mt-2.5 rounded-lg border overflow-hidden"
                    style={{ backgroundColor: active.bg, borderColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <div style={{ backgroundColor: active.swatch, height: '2px' }} />
                    <div className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate" style={{ color: 'rgba(255,255,255,0.82)' }}>
                          {brandingForm.name || 'Restaurant Name'}
                        </p>
                        <p className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.38)' }}>
                          {brandingForm.tagline || 'Your tagline appears here'}
                        </p>
                      </div>
                      <div
                        className="flex-shrink-0 px-2.5 py-1 rounded text-[10px] font-semibold"
                        style={{ backgroundColor: active.swatch, color: active.bg }}
                      >
                        Reserve
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Gallery */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest mb-1">Gallery</p>
                <p className="text-xs text-iron-muted/70">Atmosphere images shown as a square carousel on the Guest Hub. Upload up to 10 images.</p>
              </div>

              {/* Enable toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  role="switch"
                  aria-checked={brandingForm.galleryEnabled}
                  onClick={() => setBrandingForm(f => ({ ...f, galleryEnabled: !f.galleryEnabled }))}
                  className="relative flex-shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer"
                  style={{ background: brandingForm.galleryEnabled ? '#4ade80' : 'rgba(255,255,255,0.12)' }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow"
                    style={{ transform: brandingForm.galleryEnabled ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </div>
                <span className="text-xs text-iron-text">
                  {brandingForm.galleryEnabled ? 'Gallery visible on hub' : 'Gallery hidden (images saved but not shown)'}
                </span>
              </label>

              {/* Image slots */}
              <div className="space-y-2">
                {brandingForm.galleryImages.map((url, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1">
                      <ImageUploadField
                        label={`Image ${idx + 1}`}
                        imageType="dish"
                        value={url}
                        onChange={newUrl => setBrandingForm(f => {
                          const imgs = [...f.galleryImages];
                          imgs[idx] = newUrl;
                          return { ...f, galleryImages: imgs };
                        })}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setBrandingForm(f => ({ ...f, galleryImages: f.galleryImages.filter((_, i) => i !== idx) }))}
                      className="mt-5 flex-shrink-0 px-2 py-1.5 text-xs text-iron-muted hover:text-red-400 border border-iron-border rounded transition-colors"
                      title="Remove image"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {brandingForm.galleryImages.length < 10 && (
                  <button
                    type="button"
                    onClick={() => setBrandingForm(f => ({ ...f, galleryImages: [...f.galleryImages, ''] }))}
                    className="w-full py-2 text-xs text-iron-muted hover:text-iron-text border border-dashed border-iron-border rounded-lg transition-colors"
                  >
                    + Add image {brandingForm.galleryImages.length > 0 ? `(${brandingForm.galleryImages.length}/10)` : ''}
                  </button>
                )}
              </div>
              {brandingErrors.galleryImages && (
                <p className="text-xs text-red-400">{brandingErrors.galleryImages}</p>
              )}
            </div>

            {brandingError && (
              <p className="text-sm text-red-400">{brandingError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Btn variant="primary" onClick={saveBranding} busy={brandingBusy}>Save</Btn>
              <Btn variant="ghost" onClick={cancelBrandingEdit} disabled={brandingBusy}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {hub.branding ? (
              <>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <BrandingRow label="Display name" value={hub.branding.name} />
                  <BrandingRow label="Tagline"      value={hub.branding.tagline} />
                  <BrandingRow label="Phone"        value={hub.branding.phone} />
                  <BrandingRow label="Address"      value={hub.branding.address} />
                  <BrandingRow label="Logo URL"     value={hub.branding.logoUrl} url />
                  <BrandingRow label="Cover image"  value={hub.branding.coverImageUrl} url />
                </dl>
                {/* Active theme badge */}
                {(() => {
                  const draftPreset     = PRESET_OPTIONS.find(p => hub.branding!.themePreset ? p.id === hub.branding!.themePreset : p.id === 'ESPRESSO');
                  const publishedPreset = hub.publishedBranding
                    ? PRESET_OPTIONS.find(p => hub.publishedBranding!.themePreset ? p.id === hub.publishedBranding!.themePreset : p.id === 'ESPRESSO')
                    : null;
                  const hasDrift = themeUnpublished && publishedPreset && draftPreset?.id !== publishedPreset.id;
                  return draftPreset ? (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-xs text-iron-muted">Theme</span>
                        <span
                          className="w-4 h-4 rounded-full ring-1 ring-white/10 flex-shrink-0"
                          style={{ background: `radial-gradient(circle at 40% 40%, ${draftPreset.swatch}, ${draftPreset.bg})` }}
                          aria-hidden="true"
                        />
                        <span className="text-xs text-iron-text font-medium">{draftPreset.label}</span>
                        <span className="text-xs text-iron-muted">— {draftPreset.description}</span>
                        {hasDrift && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 font-medium">
                            Draft
                          </span>
                        )}
                      </div>
                      {hasDrift && publishedPreset && (
                        <div className="flex items-center gap-2 text-[11px] text-amber-400/80">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                          </svg>
                          <span>Live page still shows <strong className="text-amber-300">{publishedPreset.label}</strong> — publish to apply this theme</span>
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
              </>
            ) : (
              <div className="flex flex-col items-center text-center py-6 gap-3">
                <div className="w-10 h-10 bg-iron-bg border border-iron-border rounded-xl flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-iron-muted" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                  </svg>
                </div>
                <div>
                  <p className="text-iron-muted text-sm mb-1">No branding configured</p>
                  <p className="text-iron-muted/60 text-xs">Add your restaurant name, logo, and cover image to go live</p>
                </div>
                <button
                  type="button"
                  onClick={openBrandingEdit}
                  className="px-3 py-1.5 bg-iron-green hover:bg-iron-green-light text-white text-xs font-medium rounded transition-colors"
                >
                  Add branding
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Social links ────────────────────────────────────────────────────────── */}
      <section className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-iron-border flex items-center justify-between">
          <h4 className="text-sm font-semibold text-iron-text">Social Links</h4>
          {!editingSocial && (
            <Btn variant="ghost" onClick={openSocialEdit}>Edit</Btn>
          )}
        </div>

        {editingSocial ? (
          <div className="p-6 space-y-3">
            {socialRows.length === 0 && (
              <p className="text-iron-muted text-sm">No social links. Click + Add to add one.</p>
            )}
            {socialRows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={row.platform}
                  onChange={e => updateSocialRow(idx, 'platform', e.target.value)}
                  className="bg-iron-bg border border-iron-border rounded px-2 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green w-36 flex-shrink-0"
                >
                  {ALLOWED_PLATFORMS.map(p => (
                    <option key={p} value={p}>{PLATFORM_LABELS[p] ?? p}</option>
                  ))}
                </select>
                <Inp
                  value={row.handle}
                  onChange={e => updateSocialRow(idx, 'handle', e.target.value)}
                  placeholder={row.platform === 'website' ? 'https://...' : '@username'}
                  maxLength={200}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeSocialRow(idx)}
                  className="text-iron-muted hover:text-red-400 transition-colors px-1 flex-shrink-0"
                  aria-label="Remove"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ))}
            {socialRows.length < 10 && (
              <button
                type="button"
                onClick={addSocialRow}
                className="text-xs text-iron-muted hover:text-iron-text transition-colors"
              >
                + Add link
              </button>
            )}
            {socialError && (
              <p className="text-sm text-red-400">{socialError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Btn variant="primary" onClick={saveSocial} busy={socialBusy}>Save</Btn>
              <Btn variant="ghost" onClick={cancelSocialEdit} disabled={socialBusy}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {hub.socialLinks.length > 0 ? (
              <ul className="space-y-2">
                {hub.socialLinks.map(s => (
                  <li key={s.id} className="flex items-center gap-3 text-sm">
                    <span className="text-iron-muted w-24 flex-shrink-0 text-xs font-medium uppercase tracking-wide">
                      {PLATFORM_LABELS[s.platform] ?? s.platform}
                    </span>
                    <span className="text-iron-text truncate">{s.handle}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-4">
                <p className="text-iron-muted text-sm">No social links configured</p>
                <p className="text-iron-muted/60 text-xs mt-1">Add Instagram, TikTok, or website links to show on your hub</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── What's not here yet ──────────────────────────────────────────────────── */}
      <div className="bg-iron-bg border border-iron-border rounded-xl p-5 text-xs text-iron-muted space-y-1">
        <p className="font-medium text-iron-text text-sm mb-2">Coming in future phases</p>
        <p>• Promotions and events</p>
        <p>• Custom accent colour overrides within a preset</p>
      </div>

      </>}

    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="px-2 py-1 text-xs rounded border border-iron-border text-iron-muted hover:text-iron-text transition-colors flex-shrink-0"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

// ── Read-mode field display ───────────────────────────────────────────────────

function BrandingRow({ label, value, url }: { label: string; value: string | null; url?: boolean }) {
  return (
    <>
      <dt className="text-iron-muted text-xs">{label}</dt>
      <dd className="text-iron-text truncate">
        {value
          ? url
            ? <a href={value} target="_blank" rel="noopener noreferrer" className="text-iron-green hover:underline truncate block">{value}</a>
            : value
          : <span className="text-iron-muted">—</span>
        }
      </dd>
    </>
  );
}
