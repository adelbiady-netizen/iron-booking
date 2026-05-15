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

async function queryHub(where: { slug: string; isActive?: true }) {
  return prisma.guestHub.findFirst({
    where,
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
      publishedBranding:    true,
      publishedSocialLinks: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

function shapeHub(
  hub: NonNullable<Awaited<ReturnType<typeof queryHub>>>,
  useDraft = false,
): GuestHubDto {
  // Public route uses published snapshot with draft fallback.
  // Preview route uses draft directly.
  const brandingSource = useDraft
    ? hub.branding
    : (hub.publishedBranding ?? hub.branding);
  const socialSource = useDraft
    ? hub.socialLinks
    : (hub.publishedSocialLinks.length > 0 ? hub.publishedSocialLinks : hub.socialLinks);

  const branding: HubBrandingDto | null = brandingSource
    ? {
        name:          brandingSource.name,
        tagline:       brandingSource.tagline,
        phone:         brandingSource.phone,
        address:       brandingSource.address,
        directionsUrl: 'directionsUrl' in brandingSource ? brandingSource.directionsUrl : null,
        logoUrl:       brandingSource.logoUrl,
        coverImageUrl: brandingSource.coverImageUrl,
        primaryColor:  'primaryColor' in brandingSource ? brandingSource.primaryColor : null,
        accentColor:   'accentColor'  in brandingSource ? brandingSource.accentColor  : null,
        themePreset:   'themePreset'  in brandingSource ? brandingSource.themePreset  : null,
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

  const socialLinks: HubSocialLinkDto[] = socialSource.map(s => ({
    platform: s.platform,
    handle:   s.handle,
  }));

  return { slug: hub.slug, branding, menus, featuredDishes, promotions, events, socialLinks };
}

export async function getHubBySlug(slug: string): Promise<GuestHubDto | null> {
  const hub = await queryHub({ slug, isActive: true });
  if (!hub) return null;
  return shapeHub(hub, false);
}

// Used by the authenticated preview endpoint — reads draft tables, no isActive filter.
export async function getHubDraftBySlug(slug: string): Promise<GuestHubDto | null> {
  const hub = await queryHub({ slug });
  if (!hub) return null;
  return shapeHub(hub, true);
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
