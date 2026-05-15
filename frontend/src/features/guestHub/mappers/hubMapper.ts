// ─── Guest Hub mapper ────────────────────────────────────────────────────────
// Converts raw API response shapes into UI-safe GuestHubViewModel.
// This is the only place that knows about both shapes; the page sees only
// ViewModels and never raw API data.
//
// ISOLATION: no reservation, waitlist, floor, or SSE imports.

import type {
  GuestHubViewModel,
  DishViewModel,
  MenuCategoryViewModel,
  PromotionViewModel,
  EventViewModel,
  SocialLinkViewModel,
} from '../types/viewModel';

// ─── Raw API types (mirrors backend GuestHubDto — kept local) ─────────────────

export interface ApiDish {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  tag: string | null;
  isFeatured: boolean;
  imageUrl: string | null;
  gradient: string | null;
}

interface ApiCategory {
  id: string;
  name: string;
  count: number;
  dishes: ApiDish[];
}

interface ApiMenu {
  id: string;
  name: string;
  categories: ApiCategory[];
}

interface ApiPromotion {
  id: string;
  title: string;
  description: string | null;
  schedule: string | null;
  tag: string | null;
  tagColor: string | null;
}

interface ApiEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  tag: string | null;
  tagColor: string | null;
  imageUrl: string | null;
}

interface ApiSocialLink {
  platform: string;
  handle: string;
}

interface ApiBranding {
  name: string;
  tagline: string | null;
  phone: string | null;
  address: string | null;
  directionsUrl: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  themePreset: string | null;
}

export interface ApiGuestHub {
  slug: string;
  branding: ApiBranding | null;
  menus: ApiMenu[];
  featuredDishes: ApiDish[];
  promotions: ApiPromotion[];
  events: ApiEvent[];
  socialLinks: ApiSocialLink[];
}

// ─── Gradient fallback pool ───────────────────────────────────────────────────
// Used when a dish has no gradient in the DB. Each gives a distinct warm hue
// that reads as candlelight rather than a missing-image placeholder.

const DISH_GRADIENT_POOL = [
  'linear-gradient(135deg, #2A1A06 0%, #130E04 100%)',
  'linear-gradient(135deg, #0E2030 0%, #081018 100%)',
  'linear-gradient(135deg, #1A0A0A 0%, #0D0505 100%)',
  'linear-gradient(135deg, #1C0E14 0%, #0D0608 100%)',
  'linear-gradient(135deg, #0A1A12 0%, #050D08 100%)',
];

// ─── Individual field mappers ─────────────────────────────────────────────────

function mapDish(d: ApiDish, index: number): DishViewModel {
  return {
    id:          d.id,
    name:        d.name,
    description: d.description ?? '',
    price:       d.price ?? '',
    tag:         d.tag,
    isFeatured:  d.isFeatured,
    imageUrl:    d.imageUrl,
    gradient:    d.gradient ?? DISH_GRADIENT_POOL[index % DISH_GRADIENT_POOL.length],
  };
}

function mapCategory(c: ApiCategory, baseIndex: number): MenuCategoryViewModel {
  return {
    id:     c.id,
    name:   c.name,
    count:  c.count,
    dishes: c.dishes.map((d, i) => mapDish(d, baseIndex + i)),
  };
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok:    'TikTok',
  website:   'Website',
  twitter:   'Twitter / X',
  facebook:  'Facebook',
  youtube:   'YouTube',
};

function buildSocialHref(platform: string, handle: string): string {
  switch (platform) {
    case 'instagram': return `https://instagram.com/${handle}`;
    case 'tiktok':    return `https://tiktok.com/@${handle}`;
    case 'twitter':   return `https://twitter.com/${handle}`;
    case 'facebook':  return `https://facebook.com/${handle}`;
    case 'youtube':   return `https://youtube.com/@${handle}`;
    case 'website':   return handle.startsWith('http') ? handle : `https://${handle}`;
    default:          return `https://${handle}`;
  }
}

function mapSocialLink(s: ApiSocialLink): SocialLinkViewModel {
  const p = s.platform.toLowerCase();
  return {
    platform:     s.platform,
    handle:       s.handle,
    displayLabel: SOCIAL_LABELS[p] ?? s.platform,
    href:         buildSocialHref(p, s.handle),
  };
}

function mapPromotion(p: ApiPromotion): PromotionViewModel {
  const tc = p.tagColor;
  return {
    id:          p.id,
    title:       p.title,
    description: p.description ?? '',
    schedule:    p.schedule,
    tag:         p.tag,
    tagColor:    tc === 'gold' || tc === 'stone' ? tc : null,
  };
}

function mapEvent(e: ApiEvent): EventViewModel {
  const tc = e.tagColor;
  return {
    id:          e.id,
    title:       e.title,
    description: e.description ?? '',
    startsAt:    e.startsAt,
    endsAt:      e.endsAt,
    tag:         e.tag,
    tagColor:    tc === 'gold' || tc === 'stone' ? tc : null,
    imageUrl:    e.imageUrl,
  };
}

// ─── Root mapper ──────────────────────────────────────────────────────────────

export function mapGuestHub(api: ApiGuestHub): GuestHubViewModel {
  // Flatten menus[].categories → single ordered array for the menu grid.
  // Each category's dishes get a unique gradient index across the full flat list.
  let dishIndex = 0;
  const allCategories = api.menus.flatMap(m =>
    m.categories.map(c => {
      const mapped = mapCategory(c, dishIndex);
      dishIndex += c.dishes.length;
      return mapped;
    })
  );

  return {
    slug:          api.slug,
    name:          api.branding?.name ?? api.slug,
    tagline:       api.branding?.tagline ?? null,
    phone:         api.branding?.phone ?? null,
    address:       api.branding?.address ?? null,
    directionsUrl: api.branding?.directionsUrl ?? null,
    logoUrl:       api.branding?.logoUrl       ?? null,
    coverImageUrl: api.branding?.coverImageUrl ?? null,
    primaryColor:  api.branding?.primaryColor ?? '#C9A96E',
    accentColor:   api.branding?.accentColor  ?? '#8C6F3E',
    featuredDishes: api.featuredDishes.map((d, i) => mapDish(d, i)),
    allCategories,
    promotions:    api.promotions.map(mapPromotion),
    events:        api.events.map(mapEvent),
    socialLinks:   api.socialLinks.map(mapSocialLink),
    hours:         null,  // not yet exposed by the hub API
  };
}
