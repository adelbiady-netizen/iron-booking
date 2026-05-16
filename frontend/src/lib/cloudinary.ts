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

export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET);
}

// Inject f_auto,q_auto into a Cloudinary delivery URL.
// f_auto: serves WebP/AVIF on modern browsers, JPEG on older ones.
// q_auto: Cloudinary picks the optimal quality level automatically.
// The original file is preserved in Cloudinary — only the delivery URL changes.
function applyAutoOptimization(url: string): string {
  return url.replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

export function uploadToCloudinary(
  file: File,
  onProgress?: (pct: number) => void,
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

  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', UPLOAD_PRESET!);

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME!}/image/upload`);

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
          resolve(applyAutoOptimization(url));
        } catch {
          reject(new Error('Unexpected response from upload service'));
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText) as { error?: { message?: string } };
          reject(new Error(data.error?.message ?? `Upload failed (${xhr.status})`));
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
