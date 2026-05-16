// ─── Cloudinary direct upload (unsigned preset) ───────────────────────────────
// Uploads images directly from the browser to Cloudinary without routing
// through the backend. Uses an unsigned upload preset configured in the
// Cloudinary dashboard — no API secret is exposed to the client.
//
// VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET must be set
// as environment variables in both Vercel projects (already configured).

const CLOUD_NAME    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    as string | undefined;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined;
const MAX_BYTES     = 5 * 1024 * 1024; // 5 MB hard limit

export type ImageType = 'logo' | 'cover' | 'dish';

export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET);
}

// Inject type-appropriate Cloudinary transforms into a delivery URL.
// logo:  cap size, preserve transparency (WebP supports alpha)
// cover: wide OG-style crop for hero/cover images
// dish:  square card-friendly crop
// default: format + quality auto only
function applyTransforms(url: string, imageType?: ImageType): string {
  const t: Record<ImageType, string> = {
    logo:  'w_400,c_limit,f_auto,q_auto',
    cover: 'w_1200,h_630,c_fill,f_auto,q_auto',
    dish:  'w_800,h_800,c_fill,f_auto,q_auto',
  };
  const transforms = imageType ? t[imageType] : 'f_auto,q_auto';
  return url.replace('/image/upload/', `/image/upload/${transforms}/`);
}

// Expose config for diagnostics (values, not secrets — preset name is not a secret).
export function getCloudinaryDebugInfo(): { cloudName: string; preset: string; configured: boolean } {
  return {
    cloudName:  CLOUD_NAME  ?? '(not set)',
    preset:     UPLOAD_PRESET ?? '(not set)',
    configured: isCloudinaryConfigured(),
  };
}

export function uploadToCloudinary(
  file: File,
  onProgress?: (pct: number) => void,
  imageType?: ImageType,
): Promise<string> {
  if (!isCloudinaryConfigured()) {
    return Promise.reject(new Error('Image uploads are not configured'));
  }
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('Only image files can be uploaded'));
  }
  if (file.size > MAX_BYTES) {
    return Promise.reject(new Error('Image must be smaller than 5 MB'));
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME!}/image/upload`;

  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', UPLOAD_PRESET!);

  // Log config in dev so mismatches are immediately visible in the console.
  if (import.meta.env.DEV) {
    console.info('[Cloudinary] uploading to:', uploadUrl, '| preset:', UPLOAD_PRESET);
  }

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);

    if (onProgress) {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText) as { secure_url?: string };
          const url  = data.secure_url ?? '';
          if (!url.startsWith('https://')) {
            reject(new Error('Upload returned an insecure URL'));
            return;
          }
          resolve(applyTransforms(url, imageType));
        } catch {
          reject(new Error('Unexpected response from upload service'));
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText) as { error?: { message?: string } };
          const msg  = data.error?.message ?? `Upload failed (${xhr.status})`;
          if (import.meta.env.DEV) {
            console.error('[Cloudinary] error response:', xhr.status, xhr.responseText);
          }
          // "Unknown API key" means the upload preset is set to SIGNED in Cloudinary.
          // Fix: Cloudinary dashboard → Settings → Upload presets → set Signing Mode to Unsigned.
          if (msg.toLowerCase().includes('unknown api key')) {
            reject(new Error('Upload preset must be set to Unsigned in the Cloudinary dashboard'));
          } else {
            reject(new Error(msg));
          }
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed — check your connection')));
    xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled')));
    xhr.send(fd);
  });
}
