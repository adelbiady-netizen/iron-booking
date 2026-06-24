import { useEffect } from 'react';

/**
 * Points <link rel="manifest"> at a static per-restaurant manifest file.
 * iOS Safari requires a real HTTP URL (not blob:) to respect start_url.
 * Static files under /public are served directly — no serverless cold start.
 */
export function useRestaurantManifest(slug: string) {
  useEffect(() => {
    if (!slug) return;

    const manifestUrl = `/manifest-${slug}.webmanifest`;

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
