// ─── ImageUploadField ─────────────────────────────────────────────────────────
// Drop-in replacement for Field + Inp combos where images are needed.
// Combines a Cloudinary upload button with a URL text fallback.
// If Cloudinary is not configured the button is omitted — URL input still works.

import { useRef, useState } from 'react';
import { uploadToCloudinary, isCloudinaryConfigured } from '../lib/cloudinary';

const CAN_UPLOAD = isCloudinaryConfigured();

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
  error?: string;
  hint?: string;
}

export default function ImageUploadField({ label, value, onChange, error, hint }: Props) {
  const [uploading,      setUploading]      = useState(false);
  const [uploadPct,      setUploadPct]      = useState(0);
  const [uploadError,    setUploadError]    = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Allow re-selecting the same file on subsequent uploads
    (e.target as HTMLInputElement).value = '';

    setUploadError(null);
    setUploading(true);
    setUploadPct(0);
    try {
      const url = await uploadToCloudinary(file, setUploadPct);
      onChange(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  const shownError = uploadError ?? error;

  return (
    <div>
      <label className="block text-xs text-iron-muted mb-1.5">{label}</label>

      {/* ── Upload button ── */}
      {CAN_UPLOAD && (
        <div className="mb-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-iron-border rounded text-iron-muted hover:text-iron-text hover:border-iron-green/60 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <>
                <span className="inline-block w-3 h-3 border border-iron-green border-t-transparent rounded-full animate-spin flex-shrink-0" />
                {uploadPct > 0 ? `Uploading ${uploadPct}%…` : 'Uploading…'}
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
                Upload image
              </>
            )}
          </button>

          {/* Progress bar */}
          {uploading && (
            <div className="mt-1.5 h-0.5 w-full bg-iron-border/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-iron-green rounded-full transition-all duration-150"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── URL fallback input ── */}
      {!uploading && (
        <>
          {CAN_UPLOAD && (
            <p className="text-xs text-iron-muted/50 mb-1">or paste URL</p>
          )}
          <input
            type="url"
            value={value}
            onChange={e => { setUploadError(null); onChange(e.target.value); }}
            placeholder="https://..."
            maxLength={500}
            className={`w-full bg-iron-bg border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green transition-colors ${
              shownError ? 'border-red-500/60 focus:border-red-500/60' : 'border-iron-border'
            }`}
          />
        </>
      )}

      {/* ── Preview ── */}
      {value && !uploading && (
        <div className="mt-2">
          <img
            src={value}
            alt=""
            className="h-16 w-auto max-w-full rounded border border-iron-border object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* ── Messages ── */}
      {hint && !shownError && <p className="text-xs text-iron-muted/60 mt-1">{hint}</p>}
      {shownError           && <p className="text-xs text-red-400 mt-1">{shownError}</p>}
    </div>
  );
}
