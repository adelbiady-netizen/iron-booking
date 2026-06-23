import { useEffect } from 'react';

const ICONS = [
  { src: '/pwa-192.png',         sizes: '192x192',  type: 'image/png',    purpose: 'any'       },
  { src: '/pwa-512.png',         sizes: '512x512',  type: 'image/png',    purpose: 'any'       },
  { src: '/pwa-maskable-512.png',sizes: '512x512',  type: 'image/png',    purpose: 'maskable'  },
  { src: '/icon.svg',            sizes: 'any',      type: 'image/svg+xml',purpose: 'any'       },
];

/**
 * Dynamically replaces the page <link rel="manifest"> with a restaurant-specific
 * manifest blob whose start_url = /${slug}.
 *
 * Browsers (Chrome, Safari 16.4+) read the manifest at "Add to Home Screen" time.
 * With start_url = /eataliano-dalla-costa the installed shortcut opens that URL,
 * not the generic root /.
 *
 * Must be called from a component mounted while the user is on the slug route.
 */
export function useRestaurantManifest(slug: string, restaurantName?: string | null) {
  useEffect(() => {
    if (!slug) return;

    const name      = restaurantName ? `${restaurantName} · Iron Booking` : 'Iron Booking';
    const shortName = restaurantName ?? 'Iron Booking';

    const manifest = {
      name,
      short_name: shortName,
      description: 'Host dashboard — floor management and reservations',
      start_url: `/${slug}`,
      scope: '/',
      id: `/${slug}`,
      display: 'standalone',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'any',
      background_color: '#161A16',
      theme_color: '#435B2A',
      icons: ICONS,
    };

    const json    = JSON.stringify(manifest);
    const blob    = new Blob([json], { type: 'application/manifest+json' });
    const blobUrl = URL.createObjectURL(blob);

    // Swap the manifest link; remember the original href so we can restore on unmount.
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const originalHref = link?.getAttribute('href') ?? null;

    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = blobUrl;

    console.log(`[PWA manifest] injected — start_url=/${slug}`, manifest);

    return () => {
      URL.revokeObjectURL(blobUrl);
      if (link) {
        if (originalHref) {
          link.href = originalHref;
        } else {
          link.remove();
        }
      }
    };
  }, [slug, restaurantName]);
}
