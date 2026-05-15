// ─── Guest Hub meta hook ──────────────────────────────────────────────────────
// Manages document.title, meta tags, Open Graph, Twitter card, canonical link,
// and JSON-LD Restaurant structured data for /r/:slug pages.
//
// Strategy:
//   Every element we create is marked data-hub-meta="".
//   Cleanup does querySelectorAll('[data-hub-meta]').forEach(remove).
//   This is safe even when effects re-run: cleanup fires before the next run.
//
// Callers:
//   GuestHubPage     — full meta when ready; noindex on error/not_found
//   GuestHubPreviewPage — always noindex, nofollow
//   GuestHubQrRedirect  — always noindex, nofollow

import { useEffect } from 'react';
import type { GuestHubViewModel } from '../types/viewModel';

const CANONICAL_ORIGIN = 'https://www.ironbooking.com';
const HUB_META_ATTR    = 'data-hub-meta';

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function setMetaName(name: string, content: string): void {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    el.setAttribute(HUB_META_ATTR, '');
    document.head.appendChild(el);
  }
  el.content = content;
}

function setMetaProp(property: string, content: string): void {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    el.setAttribute(HUB_META_ATTR, '');
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLinkRel(rel: string, href: string): void {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    el.setAttribute(HUB_META_ATTR, '');
    document.head.appendChild(el);
  }
  el.href = href;
}

// ─── Content builders ─────────────────────────────────────────────────────────

function buildTitle(name: string, tagline: string | null): string {
  if (tagline) {
    const candidate = `${name} — ${tagline}`;
    if (candidate.length <= 60) return candidate;
  }
  return `${name} | Reserve a Table`;
}

function buildDescription(
  name: string,
  tagline: string | null,
  address: string | null,
): string {
  const suffix = `Explore the menu and reserve a table at ${name}.`;
  const parts: string[] = [];
  if (tagline) parts.push(tagline);
  if (address) parts.push(address);
  const body = parts.join(' · ');
  const full  = body ? `${body} ${suffix}` : suffix;
  return full.length <= 155 ? full : `${full.slice(0, 152)}...`;
}

function buildRestaurantJsonLd(vm: GuestHubViewModel, canonicalUrl: string): string {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type':    'Restaurant',
    name:       vm.name,
    url:        canonicalUrl,
  };
  if (vm.phone)         schema.telephone = vm.phone;
  if (vm.address)       schema.address   = { '@type': 'PostalAddress', streetAddress: vm.address };
  if (vm.directionsUrl) schema.hasMap    = vm.directionsUrl;
  if (vm.coverImageUrl) schema.image     = vm.coverImageUrl;
  const sameAs = vm.socialLinks.map(s => s.href).filter(Boolean);
  if (sameAs.length > 0) schema.sameAs = sameAs;
  schema.hasMenu = canonicalUrl;
  return JSON.stringify(schema);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHubMeta(
  vm: GuestHubViewModel | null,
  slug: string,
  robots?: string,
): void {
  useEffect(() => {
    const prevTitle    = document.title;
    const canonicalUrl = slug
      ? `${CANONICAL_ORIGIN}/r/${slug}`
      : CANONICAL_ORIGIN;

    // Always apply robots directive when provided (noindex for preview/QR/error states).
    if (robots) {
      setMetaName('robots', robots);
    }

    if (vm) {
      const title       = buildTitle(vm.name, vm.tagline);
      const description = buildDescription(vm.name, vm.tagline, vm.address);

      document.title = title;

      // Standard meta
      setMetaName('description', description);
      setLinkRel('canonical', canonicalUrl);

      // Open Graph
      setMetaProp('og:type',        'website');
      setMetaProp('og:url',         canonicalUrl);
      setMetaProp('og:title',       title);
      setMetaProp('og:description', description);
      setMetaProp('og:site_name',   'Iron Booking');
      if (vm.coverImageUrl) {
        setMetaProp('og:image',     vm.coverImageUrl);
        setMetaProp('og:image:alt', `${vm.name} cover image`);
      }

      // Twitter card
      const card = vm.coverImageUrl ? 'summary_large_image' : 'summary';
      setMetaName('twitter:card',        card);
      setMetaName('twitter:title',       title);
      setMetaName('twitter:description', description);
      if (vm.coverImageUrl) {
        setMetaName('twitter:image', vm.coverImageUrl);
      }

      // JSON-LD — Restaurant structured data
      const ldScript = document.createElement('script');
      ldScript.type        = 'application/ld+json';
      ldScript.textContent = buildRestaurantJsonLd(vm, canonicalUrl);
      ldScript.setAttribute(HUB_META_ATTR, '');
      document.head.appendChild(ldScript);
    }

    return () => {
      document.title = prevTitle;
      document.querySelectorAll(`[${HUB_META_ATTR}]`).forEach(el => el.remove());
    };
  }, [vm, slug, robots]);
}

// ─── Future SEO work (not yet implemented) ───────────────────────────────────
// TODO(seo): sitemap.xml — generate /sitemap.xml listing all published /r/:slug URLs.
//   Requires a backend endpoint: GET /api/public/hub/sitemap → { slugs: string[] }.
//   Serve from /public/sitemap.xml (static, regenerated on publish) or as an API route.
//   Once live, add `Sitemap: https://www.ironbooking.com/sitemap.xml` to robots.txt.
//
// TODO(seo): hreflang — add <link rel="alternate" hreflang="..."> when GuestHub.defaultLocale
//   is used and translated content is served. Requires Phase translation tables.
//
// TODO(seo): MenuSection structured data — add `hasMenuItem` to the Restaurant JSON-LD
//   once a menu viewer page or deep-linked category anchor ships (Phase menu viewer).
//
// TODO(seo): discovery portal — /discover pages will need a separate useDiscoveryMeta
//   hook variant. Do not extend useHubMeta for non-restaurant-page use cases.
//
// TODO(seo): og:image dimensions — add og:image:width and og:image:height when the
//   media storage layer records dimensions on upload (avoids layout reflow in share previews).
