import { useEffect } from 'react';

/**
 * Replaces <link rel="manifest"> with a real server URL that returns a
 * restaurant-specific manifest (start_url = /${slug}).
 *
 * iOS Safari REQUIRES a real HTTP URL — blob: URLs are silently ignored,
 * meaning start_url stays as "/" from the static manifest.webmanifest.
 *
 * The serverless function at /api/manifest?slug=:slug returns the correct
 * manifest JSON with Content-Type: application/manifest+json.
 *
 * Must be mounted while the user is on the /${slug} route so that
 * "Add to Home Screen" reads the injected manifest, not the static one.
 */
export function useRestaurantManifest(slug: string) {
  useEffect(() => {
    if (!slug) return;

    const manifestUrl = `/api/manifest?slug=${encodeURIComponent(slug)}`;

    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const originalHref = link?.getAttribute('href') ?? null;

    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = manifestUrl;

    console.log(`[PWA manifest] → ${manifestUrl} (start_url=/${slug})`);

    return () => {
      if (link) {
        if (originalHref) {
          link.href = originalHref;
        } else {
          link.remove();
        }
      }
    };
  }, [slug]);
}
