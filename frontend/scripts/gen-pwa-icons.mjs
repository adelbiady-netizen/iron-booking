// Generate raster PWA icons from the brand SVG.
// Run: node scripts/gen-pwa-icons.mjs
// Outputs into public/: pwa-192.png, pwa-512.png, pwa-maskable-512.png, apple-touch-icon.png
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

// Standard (rounded) icon — the existing brand mark.
const iconSvg = readFileSync(join(PUBLIC, 'icon.svg'));

// Maskable icon — full-bleed background (no rounded corners) with the "IB"
// mark scaled into the ~80% safe zone so platform masks never clip it.
const maskableSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
     <rect width="512" height="512" fill="#4B5F2A"/>
     <text x="50%" y="52%" font-family="-apple-system, Segoe UI, Arial, sans-serif"
           font-size="190" font-weight="700" letter-spacing="-6" fill="#ffffff"
           text-anchor="middle" dominant-baseline="central">IB</text>
   </svg>`
);

const targets = [
  { src: iconSvg, size: 192, out: 'pwa-192.png' },
  { src: iconSvg, size: 512, out: 'pwa-512.png' },
  { src: maskableSvg, size: 512, out: 'pwa-maskable-512.png' },
  { src: iconSvg, size: 180, out: 'apple-touch-icon.png' },
];

for (const t of targets) {
  await sharp(t.src, { density: 384 })
    .resize(t.size, t.size)
    .png()
    .toFile(join(PUBLIC, t.out));
  console.log(`✓ ${t.out} (${t.size}x${t.size})`);
}
console.log('Done.');
