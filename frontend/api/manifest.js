// Vercel serverless function — serves a restaurant-specific PWA manifest.
// URL: /api/manifest?slug=eataliano-dalla-costa
// iOS Safari reads <link rel="manifest"> at "Add to Home Screen" time.
// A real URL (not blob:) is required for iOS to respect start_url.
export default function handler(req, res) {
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';

  // Basic slug validation — only lowercase letters, digits, hyphens
  if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    res.status(400).json({ error: 'Missing or invalid slug' });
    return;
  }

  const manifest = {
    name: 'Iron Booking',
    short_name: 'Iron Booking',
    description: 'Host dashboard — reservations and floor management',
    start_url: `/${slug}`,
    scope: '/',
    id: `/${slug}`,
    display: 'standalone',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#161A16',
    theme_color: '#435B2A',
    icons: [
      { src: '/pwa-192.png',          sizes: '192x192', type: 'image/png',     purpose: 'any'      },
      { src: '/pwa-512.png',          sizes: '512x512', type: 'image/png',     purpose: 'any'      },
      { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png',     purpose: 'maskable' },
      { src: '/icon.svg',             sizes: 'any',     type: 'image/svg+xml', purpose: 'any'      },
    ],
  };

  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(manifest);
}
