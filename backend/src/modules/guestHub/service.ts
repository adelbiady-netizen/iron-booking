// ─── Guest Hub service ────────────────────────────────────────────────────────
// Read-only queries for the public Guest Hub experience.
//
// ISOLATION: imports ONLY from ../../lib/prisma and ./dto.
// Never import from reservations/, waitlist/, tables/, or integrations/.
//
// CACHING PHILOSOPHY: these routes are ideal for edge caching (CDN / Redis).
// Add Cache-Control: public, max-age=60 at the router layer (not here) so the
// strategy can be adjusted per-environment without touching service logic.
// When real-time branding edits land, invalidate by slug on hub update.

import { prisma } from '../../lib/prisma';
import type {
  GuestHubDto,
  HubDishDto,
  HubMenuDto,
  HubPromotionDto,
  HubEventDto,
  HubSocialLinkDto,
  HubBrandingDto,
} from './dto';

type PrismaDish = {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  tag: string | null;
  isFeatured: boolean;
  imageUrl: string | null;
  gradient: string | null;
};

function shapeDish(d: PrismaDish): HubDishDto {
  return {
    id:          d.id,
    name:        d.name,
    description: d.description,
    price:       d.price,
    tag:         d.tag,
    isFeatured:  d.isFeatured,
    imageUrl:    d.imageUrl,
    gradient:    d.gradient,
  };
}

export async function getHubBySlug(slug: string): Promise<GuestHubDto | null> {
  const hub = await prisma.guestHub.findFirst({
    where: { slug, isActive: true },
    include: {
      branding: true,
      menus: {
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          categories: {
            where:   { isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
              dishes: {
                where:   { isActive: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
        },
      },
      promotions: {
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      events: {
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      socialLinks: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!hub) return null;

  const branding: HubBrandingDto | null = hub.branding
    ? {
        name:          hub.branding.name,
        tagline:       hub.branding.tagline,
        phone:         hub.branding.phone,
        address:       hub.branding.address,
        directionsUrl: hub.branding.directionsUrl,
        logoUrl:       hub.branding.logoUrl,
        coverImageUrl: hub.branding.coverImageUrl,
        primaryColor:  hub.branding.primaryColor,
        accentColor:   hub.branding.accentColor,
        themePreset:   hub.branding.themePreset,
      }
    : null;

  const menus: HubMenuDto[] = hub.menus.map(m => ({
    id:   m.id,
    name: m.name,
    categories: m.categories.map(c => ({
      id:     c.id,
      name:   c.name,
      count:  c.dishes.length,
      dishes: c.dishes.map(shapeDish),
    })),
  }));

  // Collect all featured dishes across all menus, preserving sortOrder
  const featuredDishes: HubDishDto[] = hub.menus
    .flatMap(m => m.categories.flatMap(c => c.dishes))
    .filter(d => d.isFeatured)
    .map(shapeDish);

  const promotions: HubPromotionDto[] = hub.promotions.map(p => ({
    id:          p.id,
    title:       p.title,
    description: p.description,
    schedule:    p.schedule,
    tag:         p.tag,
    tagColor:    p.tagColor,
  }));

  const events: HubEventDto[] = hub.events.map(e => ({
    id:          e.id,
    title:       e.title,
    description: e.description,
    startsAt:    e.startsAt?.toISOString() ?? null,
    endsAt:      e.endsAt?.toISOString() ?? null,
    tag:         e.tag,
    tagColor:    e.tagColor,
    imageUrl:    e.imageUrl,
  }));

  const socialLinks: HubSocialLinkDto[] = hub.socialLinks.map(s => ({
    platform: s.platform,
    handle:   s.handle,
  }));

  return { slug: hub.slug, branding, menus, featuredDishes, promotions, events, socialLinks };
}

// Resolves a QR token to the hub slug. Token is stable even if the slug changes.
// Returns null when the token or hub is inactive.
export async function resolveQrToken(token: string): Promise<string | null> {
  const record = await prisma.guestHubQrToken.findUnique({
    where:  { token },
    select: { isActive: true, hub: { select: { slug: true, isActive: true } } },
  });
  if (!record || !record.isActive || !record.hub.isActive) return null;
  return record.hub.slug;
}
