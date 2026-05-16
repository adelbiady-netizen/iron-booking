// ─── Guest Hub QR Panel ───────────────────────────────────────────────────────
// Hospitality-grade QR asset management with branded printable card generation.
// Renders a downloadable 1440×1920 px PNG card (3× scale, 300 dpi at A6 size).
//
// ISOLATION: no reservation, waitlist, floor, or SSE imports.
//
// FUTURE (Phase 103+): token rotation, revocation, archive, table-aware metadata.
// See metadata field on QrToken and TODO notes below.

import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';

const CANONICAL_ORIGIN = 'https://www.ironbooking.com';
const DEFAULT_ACCENT   = '#C9A96E'; // warm gold fallback when no primaryColor

// ── Types ──────────────────────────────────────────────────────────────────────

interface QrToken {
  id: string;
  token: string;
  label: string | null;
  isActive: boolean;
  // Reserved for Phase 103+: { tableName?, zone?, campaign?, source? }
  metadata: Record<string, unknown> | null;
}

interface Props {
  slug: string;
  qrTokens: QrToken[];
  publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
  brandingName: string | null;
  brandingTagline: string | null;
  primaryColor: string | null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-1 transition-colors flex-shrink-0"
      title={`Copy ${label}`}
    >
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── Canvas card renderer ───────────────────────────────────────────────────────
// Produces a 1440×1920 px (3× scale) PNG — printable at A6/table-card size.
// Error correction H: 30% damage tolerance for dim/glossy restaurant surfaces.

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
  qrUrl:       string;
  name:        string;
  tagline:     string | null;
  slug:        string;
  accentColor: string;
}): Promise<string> {
  const S  = 3;   // print scale
  const LW = 480; // logical width  → 1440 px canvas
  const LH = 640; // logical height → 1920 px canvas

  // High-quality QR: error correction H for print reliability
  const qrDataUrl = await QRCode.toDataURL(params.qrUrl, {
    width: 256 * S,
    margin: 0,
    color: { dark: '#0C0A09', light: '#FFFFFF' },
    errorCorrectionLevel: 'H',
  });

  const canvas = document.createElement('canvas');
  canvas.width  = LW * S;
  canvas.height = LH * S;
  const ctx = canvas.getContext('2d')!;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#FAFAF8';
  ctx.fillRect(0, 0, LW * S, LH * S);

  // Top accent stripe
  ctx.fillStyle = params.accentColor;
  ctx.fillRect(0, 0, LW * S, 6 * S);

  // ── Restaurant name ─────────────────────────────────────────────────────────
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#1C1512';
  ctx.font         = `bold ${26 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(params.name, (LW / 2) * S, 72 * S, (LW - 48) * S);

  // ── Tagline ─────────────────────────────────────────────────────────────────
  const nameBottom = params.tagline ? 100 : 85;
  if (params.tagline) {
    ctx.fillStyle = '#8B7355';
    ctx.font      = `${13 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(params.tagline, (LW / 2) * S, 100 * S, (LW - 80) * S);
  }

  // ── Separator ───────────────────────────────────────────────────────────────
  const sepY = nameBottom + 22;
  ctx.strokeStyle = '#E2D8CC';
  ctx.lineWidth   = 1 * S;
  ctx.beginPath();
  ctx.moveTo(80 * S, sepY * S);
  ctx.lineTo((LW - 80) * S, sepY * S);
  ctx.stroke();

  // ── QR white card ───────────────────────────────────────────────────────────
  const QR_CARD_SIZE = 268;
  const QR_PAD       = 14;
  const QR_CARD_X    = (LW - QR_CARD_SIZE) / 2;
  const QR_CARD_Y    = sepY + 18;

  ctx.fillStyle = '#FFFFFF';
  drawRoundRect(ctx, QR_CARD_X * S, QR_CARD_Y * S, QR_CARD_SIZE * S, QR_CARD_SIZE * S, 12 * S);
  ctx.fill();

  // Draw QR image onto canvas
  const qrImg = new Image();
  await new Promise<void>(resolve => {
    qrImg.onload  = () => resolve();
    qrImg.onerror = () => resolve();
    qrImg.src = qrDataUrl;
  });
  const qrDrawSize = QR_CARD_SIZE - QR_PAD * 2;
  ctx.drawImage(
    qrImg,
    (QR_CARD_X + QR_PAD) * S, (QR_CARD_Y + QR_PAD) * S,
    qrDrawSize * S, qrDrawSize * S,
  );

  // ── CTA text ────────────────────────────────────────────────────────────────
  const ctaY = QR_CARD_Y + QR_CARD_SIZE + 34;
  ctx.fillStyle = '#1C1512';
  ctx.font      = `bold ${15 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText('Scan to explore our menu', (LW / 2) * S, ctaY * S);

  ctx.fillStyle = '#8B7355';
  ctx.font      = `${13 * S}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText('and reserve a table', (LW / 2) * S, (ctaY + 24) * S);

  // ── Bottom separator ────────────────────────────────────────────────────────
  ctx.strokeStyle = '#E2D8CC';
  ctx.lineWidth   = 1 * S;
  ctx.beginPath();
  ctx.moveTo(80 * S, (LH - 56) * S);
  ctx.lineTo((LW - 80) * S, (LH - 56) * S);
  ctx.stroke();

  // ── URL footnote ────────────────────────────────────────────────────────────
  ctx.fillStyle = '#B0A090';
  ctx.font      = `${10 * S}px "SF Mono", "Fira Code", "Courier New", monospace`;
  ctx.fillText(`ironbooking.com/r/${params.slug}`, (LW / 2) * S, (LH - 36) * S);

  ctx.fillStyle = '#D0C4B8';
  ctx.font      = `${8.5 * S}px -apple-system, system-ui, sans-serif`;
  ctx.fillText('Powered by IronBooking', (LW / 2) * S, (LH - 18) * S);

  return canvas.toDataURL('image/png', 1.0);
}

// ── Status meta ────────────────────────────────────────────────────────────────

const STATUS_META = {
  PUBLISHED: {
    dot:  'bg-emerald-400',
    text: 'text-emerald-400',
    label: 'Live',
    guestAccess: 'QR scans reach the public menu page.',
    cardNote: null,
  },
  INACTIVE: {
    dot:  'bg-amber-400',
    text: 'text-amber-300',
    label: 'Inactive',
    guestAccess: 'Hub is offline. QR scans show an error page. Reactivate the hub to restore access.',
    cardNote: 'QR will show an error until the hub is reactivated.',
  },
  DRAFT: {
    dot:  'bg-iron-muted',
    text: 'text-iron-muted',
    label: 'Draft',
    guestAccess: 'Hub is not yet live. QR scans show an error page. Publish and activate to enable QR access.',
    cardNote: 'QR will show an error until the hub is activated.',
  },
} as const;

// ── Main component ─────────────────────────────────────────────────────────────

export default function GuestHubQrPanel({
  slug,
  qrTokens,
  publicStatus,
  brandingName,
  brandingTagline,
  primaryColor,
}: Props) {
  const activeToken  = qrTokens.find(t => t.isActive) ?? qrTokens[0] ?? null;
  const publicUrl    = `${CANONICAL_ORIGIN}/r/${slug}`;
  const qrUrl        = activeToken ? `${CANONICAL_ORIGIN}/q/${activeToken.token}` : null;
  const accentColor  = primaryColor ?? DEFAULT_ACCENT;
  const displayName  = brandingName ?? slug;

  // Preview QR (screen quality, ECL M)
  const [previewQr, setPreviewQr] = useState<string | null>(null);
  useEffect(() => {
    if (!qrUrl) { setPreviewQr(null); return; }
    let cancelled = false;
    QRCode.toDataURL(qrUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#0C0A09', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(url => { if (!cancelled) setPreviewQr(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [qrUrl]);

  // Download state
  const [downloadingCard, setDownloadingCard] = useState(false);
  const [downloadingSvg,  setDownloadingSvg]  = useState(false);

  const downloadBrandedCard = useCallback(async () => {
    if (!qrUrl || !activeToken) return;
    setDownloadingCard(true);
    try {
      const dataUrl = await renderBrandedCard({
        qrUrl,
        name:        displayName,
        tagline:     brandingTagline,
        slug,
        accentColor,
      });
      const a = document.createElement('a');
      a.href     = dataUrl;
      a.download = `qr-card-${slug}.png`;
      a.click();
    } catch {
      // silently ignore — canvas render failures are non-critical
    } finally {
      setDownloadingCard(false);
    }
  }, [qrUrl, activeToken, displayName, brandingTagline, slug, accentColor]);

  const downloadSvgQr = useCallback(async () => {
    if (!qrUrl) return;
    setDownloadingSvg(true);
    try {
      const svgStr = await QRCode.toString(qrUrl, {
        type:                 'svg',
        width:                512,
        margin:               2,
        color:                { dark: '#0C0A09', light: '#FFFFFF' },
        errorCorrectionLevel: 'H',
      });
      const blob    = new Blob([svgStr], { type: 'image/svg+xml' });
      const objUrl  = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      a.href     = objUrl;
      a.download = `qr-${slug}.svg`;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch {
      // silently ignore
    } finally {
      setDownloadingSvg(false);
    }
  }, [qrUrl, slug]);

  const sm = STATUS_META[publicStatus];

  return (
    <div className="space-y-5">

      {/* ── Status ──────────────────────────────────────────────────────────────── */}
      <div className="bg-iron-card border border-iron-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
          <span className={`text-sm font-semibold ${sm.text}`}>{sm.label}</span>
        </div>
        <p className="text-xs text-iron-muted leading-relaxed ml-3.5">{sm.guestAccess}</p>
      </div>

      {/* ── Branded card preview + downloads ────────────────────────────────────── */}
      {activeToken ? (
        <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-iron-border flex items-center justify-between">
            <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">Print Card</p>
            <span className="text-[10px] text-iron-muted/60">A6 · 300 dpi · ECL-H</span>
          </div>

          <div className="p-5 flex flex-col items-center gap-5">

            {/* Card preview */}
            <div
              className="relative rounded-xl overflow-hidden shadow-md"
              style={{ width: 200, height: 267, backgroundColor: '#FAFAF8' }}
            >
              {/* Top accent */}
              <div
                className="absolute top-0 left-0 right-0 h-1"
                style={{ backgroundColor: accentColor }}
              />

              {/* Content */}
              <div className="flex flex-col items-center px-4 pt-4 pb-3 h-full">
                {/* Name */}
                <p
                  className="font-bold text-center leading-tight mt-1 text-[#1C1512]"
                  style={{ fontSize: 11.5 }}
                >
                  {displayName}
                </p>

                {/* Tagline */}
                {brandingTagline && (
                  <p
                    className="text-center leading-tight mt-0.5 text-[#8B7355]"
                    style={{ fontSize: 9 }}
                  >
                    {brandingTagline}
                  </p>
                )}

                {/* Separator */}
                <div className="w-3/4 mt-2 mb-2" style={{ height: 1, backgroundColor: '#E2D8CC' }} />

                {/* QR */}
                <div className="bg-white rounded-lg p-1.5 shadow-sm flex-shrink-0">
                  {previewQr ? (
                    <img src={previewQr} alt={`QR code for /r/${slug}`} width={100} height={100} className="block" />
                  ) : (
                    <div className="w-[100px] h-[100px] flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* CTA */}
                <p className="font-bold text-center text-[#1C1512] mt-2" style={{ fontSize: 7.5 }}>
                  Scan to explore our menu
                </p>
                <p className="text-center text-[#8B7355]" style={{ fontSize: 7 }}>
                  and reserve a table
                </p>

                {/* URL */}
                <p className="mt-auto text-[#B0A090] font-mono text-center" style={{ fontSize: 6.5 }}>
                  /r/{slug}
                </p>
              </div>
            </div>

            {/* Status warning on card */}
            {sm.cardNote && (
              <p className="text-xs text-amber-400 text-center max-w-xs leading-relaxed">
                {sm.cardNote}
              </p>
            )}

            {/* Download buttons */}
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => void downloadBrandedCard()}
                disabled={downloadingCard || !previewQr}
                className="flex items-center gap-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {downloadingCard ? (
                  <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                )}
                {downloadingCard ? 'Rendering…' : 'Download branded card (PNG)'}
              </button>

              <button
                type="button"
                onClick={() => void downloadSvgQr()}
                disabled={downloadingSvg || !previewQr}
                className="flex items-center gap-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {downloadingSvg ? (
                  <div className="w-3 h-3 border border-iron-muted border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                )}
                {downloadingSvg ? 'Generating…' : 'Download QR only (SVG)'}
              </button>
            </div>

            <p className="text-[10px] text-iron-muted/60 text-center max-w-xs leading-relaxed">
              PNG card: 1440 × 1920 px (A6 at 300 dpi) · ECL-H for dim lighting &amp; glossy surfaces.
              SVG: raw QR for custom design workflows.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-iron-card border border-iron-border rounded-xl p-5">
          <p className="text-iron-muted text-sm">No QR tokens configured.</p>
          <p className="text-iron-muted/60 text-xs mt-1">
            QR tokens are created automatically when you provision a Guest Hub.
          </p>
        </div>
      )}

      {/* ── Links ───────────────────────────────────────────────────────────────── */}
      <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-iron-border">
          <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">Links</p>
        </div>
        <div className="divide-y divide-iron-border/60">
          <div className="px-5 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-iron-muted mb-0.5">Public page</p>
              <p className="text-sm text-iron-text font-mono truncate">/r/{slug}</p>
            </div>
            <CopyButton text={publicUrl} label="public URL" />
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-1 transition-colors flex-shrink-0"
            >
              Open ↗
            </a>
          </div>

          {qrUrl && activeToken && (
            <div className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-iron-muted mb-0.5">
                  QR redirect
                  {activeToken.label && (
                    <span className="ml-1.5 text-iron-muted/60">({activeToken.label})</span>
                  )}
                </p>
                <p className="text-sm text-iron-text font-mono truncate">/q/{activeToken.token}</p>
              </div>
              <CopyButton text={qrUrl} label="QR URL" />
            </div>
          )}
        </div>
      </div>

      {/* ── All tokens ──────────────────────────────────────────────────────────── */}
      {qrTokens.length > 0 && (
        <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-iron-border">
            <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">
              {qrTokens.length === 1 ? 'Token' : `All Tokens (${qrTokens.length})`}
            </p>
          </div>
          <ul className="divide-y divide-iron-border/60">
            {qrTokens.map(t => {
              const isQrLive = t.isActive && publicStatus === 'PUBLISHED';
              return (
                <li key={t.id} className="px-5 py-3 flex items-start gap-3">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${
                      isQrLive    ? 'bg-emerald-400' :
                      t.isActive  ? 'bg-amber-400'   : 'bg-iron-muted'
                    }`}
                    title={isQrLive ? 'Active — QR resolves' : t.isActive ? 'Active — hub not live' : 'Inactive'}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-iron-muted truncate">{t.token}</p>
                    {t.label && (
                      <p className="text-xs text-iron-muted/60 mt-0.5">{t.label}</p>
                    )}
                    {/* Future: render t.metadata keys here when populated */}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      isQrLive    ? 'bg-emerald-900/30 text-emerald-400' :
                      t.isActive  ? 'bg-amber-900/30 text-amber-400'    :
                      'bg-iron-bg text-iron-muted'
                    }`}>
                      {isQrLive ? 'live' : t.isActive ? 'pending' : 'inactive'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Architecture notes ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-iron-border/50 bg-iron-bg px-5 py-4 space-y-1.5">
        <p className="text-[10px] font-semibold text-iron-muted uppercase tracking-widest mb-2">
          Token architecture · Phase 103+
        </p>
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          <span className="text-iron-muted font-medium">Table metadata</span> — each token can carry{' '}
          <code className="text-iron-muted/80">tableName</code>, <code className="text-iron-muted/80">zone</code>,{' '}
          <code className="text-iron-muted/80">campaign</code>, <code className="text-iron-muted/80">source</code>{' '}
          for table-aware ordering and attribution. Schema ready; UI deferred.
        </p>
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          <span className="text-iron-muted font-medium">Rotation</span> — atomic revoke + new token + re-print flow.
          Old token becomes inactive; attribution preserved.
        </p>
        <p className="text-[11px] text-iron-muted/70 leading-relaxed">
          <span className="text-iron-muted font-medium">Revocation</span> — individual token deactivation without
          affecting other tokens on the same hub.
        </p>
      </div>

    </div>
  );
}
