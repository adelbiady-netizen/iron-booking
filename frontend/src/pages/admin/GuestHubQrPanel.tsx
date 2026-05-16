// ─── Guest Hub QR Panel ───────────────────────────────────────────────────────
// Shows QR tokens, public URL, and downloadable QR image.
// ISOLATION: no reservation, waitlist, floor, or SSE imports.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const CANONICAL_ORIGIN = 'https://www.ironbooking.com';

interface QrToken {
  id: string;
  token: string;
  label: string | null;
  isActive: boolean;
}

interface Props {
  slug: string;
  qrTokens: QrToken[];
  publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
}

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

export default function GuestHubQrPanel({ slug, qrTokens, publicStatus }: Props) {
  const activeToken = qrTokens.find(t => t.isActive) ?? qrTokens[0] ?? null;
  const publicUrl   = `${CANONICAL_ORIGIN}/r/${slug}`;
  const qrUrl       = activeToken ? `${CANONICAL_ORIGIN}/q/${activeToken.token}` : null;

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!qrUrl) { setQrDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(qrUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#0C0A09', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [qrUrl]);

  const statusMeta: Record<'DRAFT' | 'PUBLISHED' | 'INACTIVE', { label: string; color: string; desc: string }> = {
    DRAFT:     { label: 'Draft',    color: 'text-iron-muted',  desc: 'Page is not publicly visible. Activate to go live.' },
    PUBLISHED: { label: 'Live',     color: 'text-emerald-400', desc: 'Page is publicly visible. QR scans resolve normally.' },
    INACTIVE:  { label: 'Inactive', color: 'text-amber-400',   desc: 'Page is offline. QR scans show an error.' },
  };
  const sm = statusMeta[publicStatus];

  return (
    <div className="space-y-5">

      {/* Visibility status */}
      <div className="bg-iron-card border border-iron-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-sm font-semibold ${sm.color}`}>{sm.label}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${
            publicStatus === 'PUBLISHED' ? 'bg-emerald-400' :
            publicStatus === 'INACTIVE'  ? 'bg-amber-400'  : 'bg-iron-muted'
          }`} />
        </div>
        <p className="text-xs text-iron-muted">{sm.desc}</p>
      </div>

      {/* URLs */}
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
                  QR link
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

      {/* QR code */}
      {activeToken ? (
        <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-iron-border flex items-center justify-between">
            <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">QR Code</p>
            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download={`qr-${slug}.png`}
                className="flex items-center gap-1.5 text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2.5 py-1 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download PNG
              </a>
            )}
          </div>
          <div className="p-5 flex flex-col items-center gap-4">
            {qrDataUrl ? (
              <>
                <div className="bg-white p-3 rounded-xl shadow-sm">
                  <img
                    src={qrDataUrl}
                    alt={`QR code for /r/${slug}`}
                    width={160}
                    height={160}
                    className="block"
                  />
                </div>
                <p className="text-xs text-iron-muted text-center max-w-xs leading-relaxed">
                  Scans resolve via <span className="font-mono text-iron-text">/q/{activeToken.token}</span> — stable even if the slug changes.
                  {publicStatus !== 'PUBLISHED' && (
                    <span className="block mt-1 text-amber-400">This QR will show an error until the hub is activated.</span>
                  )}
                </p>
              </>
            ) : (
              <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </div>
      ) : (
        <div className="bg-iron-card border border-iron-border rounded-xl p-5">
          <p className="text-iron-muted text-sm">No QR tokens configured.</p>
          <p className="text-iron-muted/60 text-xs mt-1">
            QR tokens are created automatically when you provision a new Guest Hub.
          </p>
        </div>
      )}

      {/* Token list (all tokens) */}
      {qrTokens.length > 1 && (
        <div className="bg-iron-card border border-iron-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-iron-border">
            <p className="text-xs font-semibold text-iron-muted uppercase tracking-widest">All Tokens</p>
          </div>
          <ul className="divide-y divide-iron-border/60">
            {qrTokens.map(t => (
              <li key={t.id} className="px-5 py-2.5 flex items-center gap-3">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.isActive ? 'bg-emerald-400' : 'bg-iron-muted'}`} />
                <span className="text-xs font-mono text-iron-muted truncate flex-1">{t.token}</span>
                {t.label && <span className="text-xs text-iron-muted/60 flex-shrink-0">{t.label}</span>}
                {!t.isActive && <span className="text-xs text-iron-muted/60 flex-shrink-0">inactive</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}
