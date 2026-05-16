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
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
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

type BrandingForm = {
  name: string;
  tagline: string;
  phone: string;
  address: string;
  logoUrl: string;
  coverImageUrl: string;
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

// ── Main component ────────────────────────────────────────────────────────────

export default function GuestHubCmsPanel({ restaurantId }: { restaurantId: string }) {
  const [activeTab, setActiveTab] = useState<'branding' | 'menu' | 'qr'>('branding');
  const [status, setStatus] = useState<'loading' | 'not_found' | 'ready' | 'error'>('loading');
  const [hub,    setHub]    = useState<HubData | null>(null);

  // Branding edit
  const [editingBranding, setEditingBranding] = useState(false);
  const [brandingForm,    setBrandingForm]    = useState<BrandingForm>({ name: '', tagline: '', phone: '', address: '', logoUrl: '', coverImageUrl: '' });
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

  // Menu summary for publish warnings (fetched silently after hub loads)
  const [menuSummary, setMenuSummary] = useState<{ cats: number; dishes: number } | null>(null);

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
          menus: Array<{ categories: Array<{ dishes: unknown[] }> }>;
        };
        let cats = 0;
        let dishes = 0;
        for (const menu of data.menus) {
          cats += menu.categories.length;
          for (const cat of menu.categories) {
            dishes += cat.dishes.length;
          }
        }
        setMenuSummary({ cats, dishes });
      } catch {
        // silent — warnings are best-effort
      }
    })();
  }, [status, restaurantId]);

  // ── Branding edit ─────────────────────────────────────────────────────────────

  function openBrandingEdit() {
    setBrandingForm({
      name:          hub?.branding?.name          ?? '',
      tagline:       hub?.branding?.tagline        ?? '',
      phone:         hub?.branding?.phone          ?? '',
      address:       hub?.branding?.address        ?? '',
      logoUrl:       hub?.branding?.logoUrl        ?? '',
      coverImageUrl: hub?.branding?.coverImageUrl  ?? '',
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
      const updated = await api.admin.guestHub.updateBranding(restaurantId, {
        name:          brandingForm.name.trim(),
        tagline:       brandingForm.tagline.trim()       || null,
        phone:         brandingForm.phone.trim()         || null,
        address:       brandingForm.address.trim()       || null,
        logoUrl:       brandingForm.logoUrl.trim()       || null,
        coverImageUrl: brandingForm.coverImageUrl.trim() || null,
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
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <BrandingRow label="Display name" value={hub.branding.name} />
                <BrandingRow label="Tagline"      value={hub.branding.tagline} />
                <BrandingRow label="Phone"        value={hub.branding.phone} />
                <BrandingRow label="Address"      value={hub.branding.address} />
                <BrandingRow label="Logo URL"     value={hub.branding.logoUrl} url />
                <BrandingRow label="Cover image"  value={hub.branding.coverImageUrl} url />
              </dl>
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
        <p>• Theme and colour customisation</p>
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
