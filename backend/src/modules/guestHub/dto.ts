// ─── Guest Hub public DTO types ───────────────────────────────────────────────
// Shapes returned by guestHub/router.ts — never raw Prisma objects.
// ISOLATION: no reservation, waitlist, floor, or SSE types referenced here.

export interface HubDishDto {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  tag: string | null;
  isFeatured: boolean;
  imageUrl: string | null;
  gradient: string | null;
}

export interface HubMenuCategoryDto {
  id: string;
  name: string;
  count: number;
  dishes: HubDishDto[];
}

export interface HubMenuDto {
  id: string;
  name: string;
  categories: HubMenuCategoryDto[];
}

export interface HubPromotionDto {
  id: string;
  title: string;
  description: string | null;
  schedule: string | null;
  tag: string | null;
  tagColor: string | null;
}

export interface HubEventDto {
  id: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  tag: string | null;
  tagColor: string | null;
  imageUrl: string | null;
}

export interface HubSocialLinkDto {
  platform: string;
  handle: string;
}

export interface HubBrandingDto {
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

export interface GuestHubDto {
  slug: string;
  branding: HubBrandingDto | null;
  menus: HubMenuDto[];
  featuredDishes: HubDishDto[];
  promotions: HubPromotionDto[];
  events: HubEventDto[];
  socialLinks: HubSocialLinkDto[];
}
