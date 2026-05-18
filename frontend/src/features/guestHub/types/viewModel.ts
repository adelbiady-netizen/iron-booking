// ─── Guest Hub ViewModel types ────────────────────────────────────────────────
// UI-safe types that GuestHubPage renders from.
// All API nullables are either resolved to safe defaults by the mapper or
// kept as typed | null (never undefined). The mapper enforces this contract.
//
// ISOLATION: no reservation, waitlist, floor, or SSE types here.

export type DishAvailability =
  | 'AVAILABLE'
  | 'SOLD_OUT'
  | 'SEASONAL'
  | 'BREAKFAST_ONLY'
  | 'DINNER_ONLY';

export interface DishViewModel {
  id: string;
  name: string;
  subtitle: string | null;
  description: string;    // safe default: ''
  price: string;          // safe default: ''
  tag: string | null;
  dietaryTags: string[];
  availability: DishAvailability;
  isUnavailable: boolean; // true for SOLD_OUT, BREAKFAST_ONLY, DINNER_ONLY
  isFeatured: boolean;
  featuredRank: number | null;
  imageUrl: string | null;
  gradient: string;       // always present — mapper supplies fallback
}

export interface MenuCategoryViewModel {
  id: string;
  name: string;
  description: string | null;
  count: number;
  dishes: DishViewModel[];
}

export interface PromotionViewModel {
  id: string;
  title: string;
  description: string;    // safe default: ''
  schedule: string | null;
  tag: string | null;
  tagColor: 'gold' | 'stone' | null;
}

export interface EventViewModel {
  id: string;
  title: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  tag: string | null;
  tagColor: 'gold' | 'stone' | null;
  imageUrl: string | null;
}

export interface SocialLinkViewModel {
  platform: string;
  handle: string;
  displayLabel: string;   // e.g. "Instagram", "TikTok", "Website"
  href: string;           // fully-formed URL ready for <a href>
}

export interface GuestHubViewModel {
  slug: string;
  name: string;               // safe default: slug if branding missing
  tagline: string | null;
  cuisine: string | null;
  phone: string | null;
  address: string | null;
  directionsUrl: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string;       // safe default: '#C9A96E'
  accentColor: string;        // safe default: '#8C6F3E'
  themePreset: string | null; // e.g. 'ESPRESSO' | 'OLIVE' | 'WINE' | 'MIDNIGHT' | 'SAND' | 'SLATE'
  featuredDishes: DishViewModel[];
  allCategories: MenuCategoryViewModel[];  // flattened from menus[].categories
  promotions: PromotionViewModel[];
  events: EventViewModel[];
  socialLinks: SocialLinkViewModel[];
  hours: { label: string; value: string }[] | null;  // null until API exposes it
}
