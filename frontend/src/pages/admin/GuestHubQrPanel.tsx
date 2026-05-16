// ─── Guest Hub QR Panel ───────────────────────────────────────────────────────
// Full QR token management: list, create, edit label/metadata, deactivate/reactivate.
// Renders a downloadable 1440×1920 px branded card (3× scale ≈ A6 at 300 dpi).
//
// ISOLATION: no reservation, waitlist, floor, or SSE imports.
//
// TODO Phase 104+: scan analytics (scanCount, lastScannedAt, source → reservation attribution)
// TODO Phase 104+: token rotation UI (create new + deactivate old in one action)

import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { api, ApiError } from '../../api';

const CANONICAL_ORIGIN = 'https://www.ironbooking.com';
const DEFAULT_ACCENT   = '#C9A96E';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TokenMeta {
  tableName?: string;
  zone?:      string;
  campaign?:  string;
  source?:    string;
}

interface QrToken {
  id:        string;
  token:     string;
  label:     string | null;
  isActive:  boolean;
  metadata:  TokenMeta;
  createdAt: string;
}

interface TokenForm {
  label:     string;
  tableName: string;
  zone:      string;
  campaign:  string;
  source:    string;
}

interface Props {
  restaurantId:   string;
  slug:           string;
  publicStatus:   'DRAFT' | 'PUBLISHED' | 'INACTIVE';
  brandingName:   string | null;
  brandingTagline: string | null;
  primaryColor:   string | null;
}

const EMPTY_FORM: TokenForm = { label: '', tableName: '', zone: '', campaign: '', source: '' };

// ── Canvas card renderer ───────────────────────────────────────────────────────

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function renderBrandedCard(params: {
  qrUrl: string; name: string; tagline: string | null;
  slug: string; accentColor: string;
}): Promise<string> {
  const S = 3; const LW = 480; const LH = 640;

  const qrDataUrl = await QRCode.toDataURL(params.qrUrl, {
    width: 256 * S, margin: 0,
    color: { dark: '#0C0A09', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });

  const canvas = document.createElement('canvas');
  canvas.width = LW * S; canvas.height = LH * S;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FAFAF8'; ctx.fillRect(0, 0, LW * S, LH * S);
  ctx.fillStyle = params.accentColor; ctx.fillRect(0, 0, LW * S, 6 * S);

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1C1512';
  ctx.font = `bold ${26 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(params.name, (LW / 2) * S, 72 * S, (LW - 48) * S);

  const nameBottom = params.tagline ? 100 : 85;
  if (params.tagline) {
    ctx.fillStyle = '#8B7355';
    ctx.font = `${13 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(params.tagline, (LW / 2) * S, 100 * S, (LW - 80) * S);
  }

  const sepY = nameBottom + 22;
  ctx.strokeStyle = '#E2D8CC'; ctx.lineWidth = 1 * S;
  ctx.beginPath(); ctx.moveTo(80 * S, sepY * S); ctx.lineTo((LW - 80) * S, sepY * S); ctx.stroke();

  const QR_CARD_SIZE = 268; const QR_PAD = 14;
  const QR_CARD_X = (LW - QR_CARD_SIZE) / 2; const QR_CARD_Y = sepY + 18;
  ctx.fillStyle = '#FFFFFF';
  drawRoundRect(ctx, QR_CARD_X * S, QR_CARD_Y * S, QR_CARD_SIZE * S, QR_CARD_SIZE * S, 12 * S);
  ctx.fill();

  const qrImg = new Image();
  await new Promise<void>(r => { qrImg.onload = () => r(); qrImg.onerror = () => r(); qrImg.src = qrDataUrl; });
  const qrDrawSize = QR_CARD_SIZE - QR_PAD * 2;
  ctx.drawImage(qrImg, (QR_CARD_X + QR_PAD) * S, (QR_CARD_Y + QR_PAD) * S, qrDrawSize * S, qrDrawSize * S);

  const ctaY = QR_CARD_Y + QR_CARD_SIZE + 34;
  ctx.fillStyle = '#1C1512';
  ctx.font = `bold ${15 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText('Scan to explore our menu', (LW / 2) * S, ctaY * S);
  ctx.fillStyle = '#8B7355';
  ctx.font = `${13 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText('and reserve a table', (LW / 2) * S, (ctaY + 24) * S);

  ctx.strokeStyle = '#E2D8CC'; ctx.lineWidth = 1 * S;
  ctx.beginPath(); ctx.moveTo(80 * S, (LH - 56) * S); ctx.lineTo((LW - 80) * S, (LH - 56) * S); ctx.stroke();

  ctx.fillStyle = '#B0A090';
  ctx.font = `${10 * S}px "SF Mono", "Fira Code", "Courier New", monospace`;
  ctx.fillText(`ironbooking.com/r/${params.slug}`, (LW / 2) * S, (LH - 36) * S);
  ctx.fillStyle = '#D0C4B8';
  ctx.font = `${8.5 * S}px -apple-system, system-ui, sans-serif`;
  ctx.fillText('Powered by IronBooking', (LW / 2) * S, (LH - 18) * S);

  return canvas.toDataURL('image/png', 1.0);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000);
      })}
      className="flex items-center gap-1 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-1 transition-colors flex-shrink-0"
      title={`Copy ${label}`}
    >
      {copied ? (
        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
      ) : (
        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
      )}
    </button>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-iron-bg text-[10px] text-iron-muted border border-iron-border/60">
      {children}
    </span>
  );
}

// ── Token form (create / edit) ─────────────────────────────────────────────────

function TokenForm({
  initial,
  onSave,
  onCancel,
  busy,
  error,
  isEdit,
}: {
  initial:  TokenForm;
  onSave:   (form: TokenForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
  isEdit:   boolean;
}) {
  const [form, setForm] = useState<TokenForm>(initial);
  const set = (k: keyof TokenForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4 p-5">
      {isEdit && (
        <div className="text-[11px] text-amber-400/80 bg-amber-950/20 border border-amber-900/30 rounded-lg px-3 py-2 leading-relaxed">
          Changing the label does not affect printed QR codes — the token URL stays the same.
        </div>
      )}

      {/* Label */}
      <div>
        <label className="block text-xs text-iron-muted mb-1">
          Label <span className="text-iron-muted/50">(optional — for your reference)</span>
        </label>
        <input
          value={form.label}
          onChange={set('label')}
          maxLength={100}
          placeholder='e.g. "Table 12", "Bar Area", "Entrance"'
          className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
        />
      </div>

      {/* Physical location */}
      <div>
        <p className="text-[10px] font-semibold text-iron-muted uppercase tracking-widest mb-2">
          Physical location <span className="font-normal normal-case">(optional · for future table-mode)</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-iron-muted mb-1">Table name</label>
            <input
              value={form.tableName}
              onChange={set('tableName')}
              maxLength={50}
              placeholder="T12, Bar 3, Patio 7"
              className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
            />
          </div>
          <div>
            <label className="block text-xs text-iron-muted mb-1">Zone</label>
            <input
              value={form.zone}
              onChange={set('zone')}
              maxLength={50}
              placeholder="terrace, bar, main floor"
              className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
            />
          </div>
        </div>
      </div>

      {/* Attribution */}
      <div>
        <p className="text-[10px] font-semibold text-iron-muted uppercase tracking-widest mb-2">
          Attribution <span className="font-normal normal-case">(optional · for analytics · Phase 104+)</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-iron-muted mb-1">Campaign</label>
            <input
              value={form.campaign}
              onChange={set('campaign')}
              maxLength={100}
              placeholder="summer-menu, launch-week"
              className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
            />
          </div>
          <div>
            <label className="block text-xs text-iron-muted mb-1">Source</label>
            <input
              value={form.source}
              onChange={set('source')}
              maxLength={50}
              placeholder="table-tent, window-sticker"
              className="w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green"
            />
          </div>
        </div>
      </div>

      {!isEdit && (
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          Each token generates a unique, stable QR URL. Print it on cards, tents, or signs —
          the URL never changes even if you rename it.
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onSave(form)}
          disabled={busy}
          className="px-4 py-2 bg-iron-green hover:bg-iron-green-light text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
        >
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create token'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 border border-iron-border text-iron-muted hover:text-iron-text text-sm rounded transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Status meta ────────────────────────────────────────────────────────────────

const STATUS_META = {
  PUBLISHED: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Live',
    guestAccess: 'QR scans reach the public menu page.' },
  INACTIVE:  { dot: 'bg-amber-400',   text: 'text-amber-300',   label: 'Inactive',
    guestAccess: 'Hub is offline. QR scans show an error page. Reactivate the hub to restore access.' },
  DRAFT:     { dot: 'bg-iron-muted',  text: 'text-iron-muted',  label: 'Draft',
    guestAccess: 'Hub is not yet live. QR scans show an error page. Publish and activate to enable QR access.' },
} as const;

// ── Main component ─────────────────────────────────────────────────────────────

export default function GuestHubQrPanel({
  restaurantId, slug, publicStatus, brandingName, brandingTagline, primaryColor,
}: Props) {
  const accentColor = primaryColor ?? DEFAULT_ACCENT;
  const displayName = brandingName ?? slug;

  // Token state
  const [tokens,          setTokens]          = useState<QrToken[]>([]);
  const [loadingTokens,   setLoadingTokens]   = useState(true);
  const [loadError,       setLoadError]       = useState<string | null>(null);
  const [selectedId,      setSelectedId]      = useState<string | null>(null);
  const [creating,        setCreating]        = useState(false);
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [formBusy,        setFormBusy]        = useState(false);
  const [formError,       setFormError]       = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [actionBusy,      setActionBusy]      = useState<Record<string, boolean>>({});

  // Preview QR for selected token
  const [previewQr,       setPreviewQr]       = useState<string | null>(null);
  const [downloadingCard, setDownloadingCard] = useState(false);
  const [downloadingSvg,  setDownloadingSvg]  = useState(false);

  // ── Load tokens ─────────────────────────────────────────────────────────────

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    setLoadError(null);
    try {
      const { tokens: t } = await api.admin.guestHub.tokens.list(restaurantId);
      setTokens(t);
      // Auto-select active token, or first token
      setSelectedId(prev => {
        if (prev && t.find(x => x.id === prev)) return prev;
        return t.find(x => x.isActive)?.id ?? t[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load tokens');
    } finally {
      setLoadingTokens(false);
    }
  }, [restaurantId]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

  // ── Preview QR (screen quality) ──────────────────────────────────────────────

  const selectedToken = tokens.find(t => t.id === selectedId) ?? null;
  const qrUrl = selectedToken
    ? `${CANONICAL_ORIGIN}/q/${selectedToken.token}`
    : null;

  useEffect(() => {
    if (!qrUrl) { setPreviewQr(null); return; }
    let cancelled = false;
    QRCode.toDataURL(qrUrl, {
      width: 240, margin: 1,
      color: { dark: '#0C0A09', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(url => { if (!cancelled) setPreviewQr(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [qrUrl]);

  // ── Token CRUD ───────────────────────────────────────────────────────────────

  async function handleCreate(form: TokenForm) {
    setFormBusy(true); setFormError(null);
    try {
      const metadata = buildMeta(form);
      const t = await api.admin.guestHub.tokens.create(restaurantId, {
        label: form.label.trim() || null, metadata,
      });
      setTokens(prev => [...prev, t]);
      setSelectedId(t.id);
      setCreating(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create token');
    } finally { setFormBusy(false); }
  }

  async function handleUpdate(tokenId: string, form: TokenForm) {
    setFormBusy(true); setFormError(null);
    try {
      const metadata = buildMeta(form);
      const t = await api.admin.guestHub.tokens.update(restaurantId, tokenId, {
        label: form.label.trim() || null, metadata,
      });
      setTokens(prev => prev.map(x => x.id === tokenId ? t : x));
      setEditingId(null);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save changes');
    } finally { setFormBusy(false); }
  }

  async function handleDeactivate(tokenId: string) {
    setActionBusy(prev => ({ ...prev, [tokenId]: true }));
    try {
      const t = await api.admin.guestHub.tokens.deactivate(restaurantId, tokenId);
      setTokens(prev => prev.map(x => x.id === tokenId ? t : x));
      setConfirmDeactivate(null);
    } catch { /* non-critical */ }
    finally { setActionBusy(prev => ({ ...prev, [tokenId]: false })); }
  }

  async function handleReactivate(tokenId: string) {
    setActionBusy(prev => ({ ...prev, [tokenId]: true }));
    try {
      const t = await api.admin.guestHub.tokens.reactivate(restaurantId, tokenId);
      setTokens(prev => prev.map(x => x.id === tokenId ? t : x));
    } catch { /* non-critical */ }
    finally { setActionBusy(prev => ({ ...prev, [tokenId]: false })); }
  }

  function openEdit(t: QrToken) {
    setEditingId(t.id);
    setFormError(null);
    setCreating(false);
  }

  function openCreate() {
    setCreating(true);
    setEditingId(null);
    setFormError(null);
  }

  // ── Downloads ────────────────────────────────────────────────────────────────

  const downloadBrandedCard = useCallback(async () => {
    if (!qrUrl) return;
    setDownloadingCard(true);
    try {
      const dataUrl = await renderBrandedCard({ qrUrl, name: displayName, tagline: brandingTagline, slug, accentColor });
      const a = document.createElement('a');
      a.href = dataUrl; a.download = `qr-card-${slug}.png`; a.click();
    } catch { /* ignore */ } finally { setDownloadingCard(false); }
  }, [qrUrl, displayName, brandingTagline, slug, accentColor]);

  const downloadSvgQr = useCallback(async () => {
    if (!qrUrl) return;
    setDownloadingSvg(true);
    try {
      const svgStr = await QRCode.toString(qrUrl, {
        type: 'svg', width: 512, margin: 2,
        color: { dark: '#0C0A09', light: '#FFFFFF' },
        errorCorrectionLevel: 'H',
      });
      const blob   = new Blob([svgStr], { type: 'image/svg+xml' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl; a.download = `qr-${slug}.svg`; a.click();
      URL.revokeObjectURL(objUrl);
    } catch { /* ignore */ } finally { setDownloadingSvg(false); }
  }, [qrUrl, slug]);

  const sm = STATUS_META[publicStatus];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Hub status ──────────────────────────────────────────────────────────── */}
      <div className="bg-iron-card border border-iron-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
          <span className={`text-sm font-semibold ${sm.text}`}>{sm.label}</span>
        </div>
        <p className="text-xs text-iron-muted leading-relaxed ml-3.5">{sm.guestAccess}</p>
      </div>

      {/* ── Token library ───────────────────────────────────────────────────────── */}
      <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-iron-border flex items-center justify-between">
          <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">
            QR Tokens {!loadingTokens && tokens.length > 0 && `(${tokens.length})`}
          </p>
          {!creating && !editingId && (
            <button
              type="button"
              onClick={openCreate}
              disabled={tokens.length >= 50}
              className="flex items-center gap-1 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2.5 py-1 transition-colors disabled:opacity-40"
              title={tokens.length >= 50 ? 'Maximum 50 tokens per hub' : undefined}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New token
            </button>
          )}
        </div>

        {loadingTokens && (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {loadError && (
          <div className="px-5 py-4 text-sm text-red-400">{loadError}</div>
        )}

        {!loadingTokens && !loadError && tokens.length === 0 && !creating && (
          <div className="px-5 py-6 text-center">
            <p className="text-sm text-iron-muted mb-1">No QR tokens yet.</p>
            <p className="text-xs text-iron-muted/60">Create one to get a printable QR for this hub.</p>
          </div>
        )}

        {/* Create form */}
        {creating && (
          <div className="border-b border-iron-border">
            <div className="px-5 py-3 bg-iron-bg/50">
              <p className="text-xs font-medium text-iron-text">New QR Token</p>
            </div>
            <TokenForm
              initial={EMPTY_FORM}
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
              busy={formBusy}
              error={formError}
              isEdit={false}
            />
          </div>
        )}

        {/* Token list */}
        {!loadingTokens && tokens.length > 0 && (
          <ul className="divide-y divide-iron-border/60">
            {tokens.map(t => {
              const isLive   = t.isActive && publicStatus === 'PUBLISHED';
              const isBusy   = actionBusy[t.id] ?? false;
              const isSelected = selectedId === t.id;
              const hasMetadata = !!(t.metadata.tableName || t.metadata.zone || t.metadata.campaign || t.metadata.source);

              return (
                <li key={t.id}>
                  {/* Main row */}
                  <div
                    className={`px-5 py-3.5 transition-colors ${isSelected ? 'bg-iron-bg/60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Status dot */}
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                          isLive ? 'bg-emerald-400' : t.isActive ? 'bg-amber-400' : 'bg-iron-muted/40'
                        }`}
                        title={isLive ? 'Live' : t.isActive ? 'Active — hub not published' : 'Inactive'}
                      />

                      {/* Identity */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${t.label ? 'text-iron-text' : 'text-iron-muted/60 italic'}`}>
                            {t.label ?? 'Unlabeled'}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isLive      ? 'bg-emerald-900/40 text-emerald-400' :
                            t.isActive  ? 'bg-amber-900/30 text-amber-400'    :
                            'bg-iron-bg text-iron-muted'
                          }`}>
                            {isLive ? 'live' : t.isActive ? 'pending' : 'inactive'}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-iron-muted/50 mt-0.5 truncate">/q/{t.token}</p>

                        {/* Metadata pills */}
                        {hasMetadata && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {t.metadata.tableName && <MetaPill>Table: {t.metadata.tableName}</MetaPill>}
                            {t.metadata.zone      && <MetaPill>Zone: {t.metadata.zone}</MetaPill>}
                            {t.metadata.campaign  && <MetaPill>Campaign: {t.metadata.campaign}</MetaPill>}
                            {t.metadata.source    && <MetaPill>Source: {t.metadata.source}</MetaPill>}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                        <button
                          type="button"
                          onClick={() => { setSelectedId(t.id); setEditingId(null); setCreating(false); }}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            isSelected
                              ? 'border-iron-green/50 text-iron-green bg-iron-green/10'
                              : 'border-iron-border text-iron-muted hover:text-iron-text'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Preview'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          className="text-xs px-2 py-1 rounded border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
                        >
                          Edit
                        </button>
                        {t.isActive ? (
                          confirmDeactivate === t.id ? (
                            <button
                              type="button"
                              onClick={() => void handleDeactivate(t.id)}
                              disabled={isBusy}
                              className="text-xs px-2 py-1 rounded border border-red-800/60 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-50"
                            >
                              {isBusy ? '…' : 'Confirm stop'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeactivate(t.id)}
                              className="text-xs px-2 py-1 rounded border border-iron-border text-iron-muted hover:text-amber-400 hover:border-amber-900/50 transition-colors"
                            >
                              Deactivate
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleReactivate(t.id)}
                            disabled={isBusy}
                            className="text-xs px-2 py-1 rounded border border-iron-border text-iron-muted hover:text-emerald-400 transition-colors disabled:opacity-50"
                          >
                            {isBusy ? '…' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Deactivation warning */}
                    {confirmDeactivate === t.id && (
                      <div className="ml-4 mt-2 flex items-center gap-2">
                        <p className="text-[11px] text-amber-400 flex-1">
                          Deactivating stops all printed QR codes for this token from working.
                        </p>
                        <button
                          type="button"
                          onClick={() => setConfirmDeactivate(null)}
                          className="text-[11px] text-iron-muted hover:text-iron-text transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline edit form */}
                  {editingId === t.id && (
                    <div className="border-t border-iron-border/60 bg-iron-bg/40">
                      <div className="px-5 pt-3 pb-1">
                        <p className="text-xs font-medium text-iron-muted">Edit token</p>
                      </div>
                      <TokenForm
                        initial={tokenToForm(t)}
                        onSave={(form) => void handleUpdate(t.id, form)}
                        onCancel={() => { setEditingId(null); setFormError(null); }}
                        busy={formBusy}
                        error={formError}
                        isEdit
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Print card preview + downloads ──────────────────────────────────────── */}
      {selectedToken && (
        <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-iron-border flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">Print Card</p>
              {selectedToken.label && (
                <p className="text-[10px] text-iron-muted/60 mt-0.5">{selectedToken.label}</p>
              )}
            </div>
            <span className="text-[10px] text-iron-muted/60">A6 · 300 dpi · ECL-H</span>
          </div>

          <div className="p-5 flex flex-col items-center gap-5">
            {/* Card preview */}
            <div className="relative rounded-xl overflow-hidden shadow-md" style={{ width: 200, height: 267, backgroundColor: '#FAFAF8' }}>
              <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: accentColor }} />
              <div className="flex flex-col items-center px-4 pt-4 pb-3 h-full">
                <p className="font-bold text-center leading-tight mt-1 text-[#1C1512]" style={{ fontSize: 11.5 }}>
                  {displayName}
                </p>
                {brandingTagline && (
                  <p className="text-center leading-tight mt-0.5 text-[#8B7355]" style={{ fontSize: 9 }}>
                    {brandingTagline}
                  </p>
                )}
                <div className="w-3/4 mt-2 mb-2" style={{ height: 1, backgroundColor: '#E2D8CC' }} />
                <div className="bg-white rounded-lg p-1.5 shadow-sm flex-shrink-0">
                  {previewQr ? (
                    <img src={previewQr} alt={`QR code for /r/${slug}`} width={100} height={100} className="block" />
                  ) : (
                    <div className="w-[100px] h-[100px] flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <p className="font-bold text-center text-[#1C1512] mt-2" style={{ fontSize: 7.5 }}>
                  Scan to explore our menu
                </p>
                <p className="text-center text-[#8B7355]" style={{ fontSize: 7 }}>and reserve a table</p>
                <p className="mt-auto text-[#B0A090] font-mono text-center" style={{ fontSize: 6.5 }}>/r/{slug}</p>
              </div>
            </div>

            {!selectedToken.isActive && (
              <p className="text-xs text-amber-400 text-center max-w-xs leading-relaxed">
                This token is inactive. Printed cards will show an error page.
              </p>
            )}
            {selectedToken.isActive && publicStatus !== 'PUBLISHED' && (
              <p className="text-xs text-amber-400 text-center max-w-xs leading-relaxed">
                Hub is not live yet. QR codes will show an error page until activated.
              </p>
            )}

            {/* Downloads */}
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => void downloadBrandedCard()}
                disabled={downloadingCard || !previewQr}
                className="flex items-center gap-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {downloadingCard
                  ? <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                }
                {downloadingCard ? 'Rendering…' : 'Download branded card (PNG)'}
              </button>
              <button
                type="button"
                onClick={() => void downloadSvgQr()}
                disabled={downloadingSvg || !previewQr}
                className="flex items-center gap-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {downloadingSvg
                  ? <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                }
                {downloadingSvg ? 'Generating…' : 'Download QR only (SVG)'}
              </button>
            </div>

            <p className="text-[10px] text-iron-muted/60 text-center max-w-xs leading-relaxed">
              PNG: 1440×1920 px (A6 at 300 dpi) · ECL-H for dim lighting &amp; glossy surfaces.
              SVG: raw QR for custom design workflows.
            </p>
          </div>

          {/* Links */}
          <div className="border-t border-iron-border divide-y divide-iron-border/60">
            <div className="px-5 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-iron-muted mb-0.5">Public page</p>
                <p className="text-sm text-iron-text font-mono truncate">/r/{slug}</p>
              </div>
              <CopyButton text={`${CANONICAL_ORIGIN}/r/${slug}`} label="public URL" />
              <a
                href={`${CANONICAL_ORIGIN}/r/${slug}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-1 transition-colors flex-shrink-0"
              >Open ↗</a>
            </div>
            <div className="px-5 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-iron-muted mb-0.5">
                  QR redirect
                  {selectedToken.label && <span className="ml-1.5 text-iron-muted/60">({selectedToken.label})</span>}
                </p>
                <p className="text-sm text-iron-text font-mono truncate">/q/{selectedToken.token}</p>
              </div>
              <CopyButton text={`${CANONICAL_ORIGIN}/q/${selectedToken.token}`} label="QR URL" />
            </div>
          </div>
        </div>
      )}

      {/* ── Architecture notes ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-iron-border/50 bg-iron-bg px-5 py-4 space-y-1.5">
        <p className="text-[10px] font-semibold text-iron-muted uppercase tracking-widest mb-2">
          Token architecture · Phase 104+
        </p>
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          <span className="text-iron-muted font-medium">Rotation</span> — create a new token, re-print affected cards, then deactivate the old one.
          Old printed QR codes fail gracefully (error page) if their token is inactive.
        </p>
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          <span className="text-iron-muted font-medium">Analytics</span> — scan count, last scanned time, and source-to-reservation attribution
          require scan-event infrastructure. Metadata fields (campaign, source) are ready for attribution when analytics land.
        </p>
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          <span className="text-iron-muted font-medium">Table-mode ordering</span> — tableName and zone metadata will be read by the
          ordering system to scope the order to the correct table and zone.
        </p>
      </div>

    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildMeta(form: TokenForm): TokenMeta {
  const m: TokenMeta = {};
  if (form.tableName.trim()) m.tableName = form.tableName.trim();
  if (form.zone.trim())      m.zone      = form.zone.trim();
  if (form.campaign.trim())  m.campaign  = form.campaign.trim();
  if (form.source.trim())    m.source    = form.source.trim();
  return m;
}

function tokenToForm(t: QrToken): TokenForm {
  return {
    label:     t.label ?? '',
    tableName: t.metadata.tableName ?? '',
    zone:      t.metadata.zone      ?? '',
    campaign:  t.metadata.campaign  ?? '',
    source:    t.metadata.source    ?? '',
  };
}
