// Cloudinary unsigned direct-browser upload.
// Backend never handles binary data — the browser uploads straight to Cloudinary CDN.
// Credentials come from Vite env vars (safe to expose: unsigned preset by design).

export interface CloudinaryResult {
  secure_url: string;
  public_id:  string;
  format:     string;
  bytes:      number;
  width?:     number;
  height?:    number;
}

export type ImageSlot = 'logo' | 'cover';

const LOGO_MAX  = 2 * 1024 * 1024; // 2 MB
const COVER_MAX = 5 * 1024 * 1024; // 5 MB

const LOGO_TYPES  = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const COVER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function validateImageFile(file: File, slot: ImageSlot): string | null {
  const types  = slot === 'logo' ? LOGO_TYPES  : COVER_TYPES;
  const maxBytes = slot === 'logo' ? LOGO_MAX : COVER_MAX;
  const label    = slot === 'logo' ? 'PNG, JPG, WEBP, SVG' : 'PNG, JPG, WEBP';
  if (!types.has(file.type)) return `Invalid type. Allowed: ${label}`;
  if (file.size > maxBytes) return `File too large. Max: ${maxBytes / 1024 / 1024} MB`;
  return null;
}

export function cloudinaryConfigured(): boolean {
  return !!(
    import.meta.env.VITE_CLOUDINARY_CLOUD_NAME &&
    import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
  );
}

// Uploads with XHR so we get progress events.
// folder: e.g. "iron-booking/restaurants/abc123/logo"
export function uploadToCloudinary(
  file: File,
  folder: string,
  onProgress: (pct: number) => void,
): Promise<CloudinaryResult> {
  const cloudName    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;

  const form = new FormData();
  form.append('file',          file);
  form.append('upload_preset', uploadPreset);
  form.append('folder',        folder);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText) as CloudinaryResult);
      } else {
        const body = JSON.parse(xhr.responseText) as { error?: { message?: string } };
        reject(new Error(body?.error?.message ?? `Upload failed (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error — check your connection'));
    xhr.send(form);
  });
}
