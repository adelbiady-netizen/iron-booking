// ─── Guest Hub admin service ───────────────────────────────────────────────────
// Authenticated write operations for GuestHubBranding and GuestHubSocialLink.
// ISOLATION: imports from ../../lib/prisma and ../../lib/errors only.
//            No reservation, waitlist, floor, or SSE imports.

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { ValidationError, NotFoundError } from '../../lib/errors';
import type { AuthPayload } from '../../middleware/auth';

// ── DTOs (admin-facing, a superset of the public DTO) ─────────────────────────

export interface HubAdminBrandingDto {
  id: string;
  name: string;
  tagline: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
}

export interface HubAdminSocialDto {
  id: string;
  platform: string;
  handle: string;
  sortOrder: number;
}

export interface HubAdminDto {
  id: string;
  slug: string;
  restaurantId: string | null;
  isActive: boolean;
  lastPublishedAt: string | null;
  draftUpdatedAt: string | null;
  branding: HubAdminBrandingDto | null;
  socialLinks: HubAdminSocialDto[];
  publishedBranding: HubAdminBrandingDto | null;
  publishedSocialLinks: HubAdminSocialDto[];
}

// ── Validation ─────────────────────────────────────────────────────────────────

const ALLOWED_PLATFORMS = new Set([
  'instagram', 'tiktok', 'website', 'facebook', 'twitter', 'youtube',
]);

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function validateBrandingInput(body: Record<string, unknown>): Record<string, string[]> {
  const err: Record<string, string[]> = {};

  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  if (name === undefined || name === '') {
    err.name = ['Display name is required'];
  } else if (name.length > 100) {
    err.name = ['Display name must be 100 characters or fewer'];
  }

  const tagline = typeof body.tagline === 'string' ? body.tagline.trim() : '';
  if (tagline.length > 200) err.tagline = ['Tagline must be 200 characters or fewer'];

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (phone.length > 30) err.phone = ['Phone must be 30 characters or fewer'];

  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (address.length > 300) err.address = ['Address must be 300 characters or fewer'];

  const logoUrl = typeof body.logoUrl === 'string' ? body.logoUrl.trim() : '';
  if (logoUrl) {
    if (logoUrl.length > 500) err.logoUrl = ['URL must be 500 characters or fewer'];
    else if (!isValidUrl(logoUrl)) err.logoUrl = ['Must be a valid http/https URL'];
  }

  const coverImageUrl = typeof body.coverImageUrl === 'string' ? body.coverImageUrl.trim() : '';
  if (coverImageUrl) {
    if (coverImageUrl.length > 500) err.coverImageUrl = ['URL must be 500 characters or fewer'];
    else if (!isValidUrl(coverImageUrl)) err.coverImageUrl = ['Must be a valid http/https URL'];
  }

  return err;
}

interface SocialInput { platform: string; handle: string; }

function validateSocialInput(links: unknown): Record<string, string[]> {
  const err: Record<string, string[]> = {};
  if (!Array.isArray(links)) { err.links = ['links must be an array']; return err; }
  if (links.length > 10) { err.links = ['Maximum 10 social links allowed']; return err; }

  const seenPlatforms = new Set<string>();

  for (let i = 0; i < links.length; i++) {
    const l = links[i] as Record<string, unknown>;
    const platform = typeof l.platform === 'string' ? l.platform.toLowerCase().trim() : '';
    if (!ALLOWED_PLATFORMS.has(platform)) {
      err[`links[${i}].platform`] = [`Must be one of: ${[...ALLOWED_PLATFORMS].join(', ')}`];
    } else if (seenPlatforms.has(platform)) {
      err[`links[${i}].platform`] = [`Duplicate platform: each platform may appear only once`];
    } else {
      seenPlatforms.add(platform);
    }
    const handle = typeof l.handle === 'string' ? l.handle.trim() : '';
    if (!handle) err[`links[${i}].handle`] = ['Handle is required'];
    else if (handle.length > 200) err[`links[${i}].handle`] = ['Handle must be 200 characters or fewer'];
  }

  return err;
}

// ── Queries ────────────────────────────────────────────────────────────────────

export async function getHubForRestaurant(restaurantId: string): Promise<HubAdminDto | null> {
  const hub = await prisma.guestHub.findFirst({
    where: { restaurantId },
    include: {
      branding: true,
      socialLinks:          { orderBy: { sortOrder: 'asc' } },
      publishedBranding:    true,
      publishedSocialLinks: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!hub) return null;

  // Most recent draft modification across branding and social links
  const draftTs = [
    hub.branding?.updatedAt,
    ...hub.socialLinks.map(s => s.createdAt),
  ].filter((t): t is Date => t instanceof Date);
  const draftUpdatedAt = draftTs.length > 0
    ? draftTs.sort((a, b) => b.getTime() - a.getTime())[0].toISOString()
    : null;

  return {
    id:              hub.id,
    slug:            hub.slug,
    restaurantId:    hub.restaurantId,
    isActive:        hub.isActive,
    lastPublishedAt: hub.lastPublishedAt?.toISOString() ?? null,
    draftUpdatedAt,
    branding: hub.branding ? {
      id:            hub.branding.id,
      name:          hub.branding.name,
      tagline:       hub.branding.tagline,
      phone:         hub.branding.phone,
      address:       hub.branding.address,
      logoUrl:       hub.branding.logoUrl,
      coverImageUrl: hub.branding.coverImageUrl,
    } : null,
    socialLinks: hub.socialLinks.map(s => ({
      id:        s.id,
      platform:  s.platform,
      handle:    s.handle,
      sortOrder: s.sortOrder,
    })),
    publishedBranding: hub.publishedBranding ? {
      id:            hub.publishedBranding.id,
      name:          hub.publishedBranding.name,
      tagline:       hub.publishedBranding.tagline,
      phone:         hub.publishedBranding.phone,
      address:       hub.publishedBranding.address,
      logoUrl:       hub.publishedBranding.logoUrl,
      coverImageUrl: hub.publishedBranding.coverImageUrl,
    } : null,
    publishedSocialLinks: hub.publishedSocialLinks.map(s => ({
      id:        s.id,
      platform:  s.platform,
      handle:    s.handle,
      sortOrder: s.sortOrder,
    })),
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────────

// Upserts GuestHubBranding for a hub. Creates on first save; updates thereafter.
// Caller must supply hubId (the GuestHub.id, not restaurantId).
export async function upsertHubBranding(
  hubId: string,
  body: Record<string, unknown>,
  _actor: AuthPayload,
): Promise<HubAdminBrandingDto> {
  const fieldErrors = validateBrandingInput(body);
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Validation failed', { fieldErrors });
  }

  const name          = (body.name as string).trim();
  const tagline       = typeof body.tagline === 'string'       ? body.tagline.trim()       || null : null;
  const phone         = typeof body.phone === 'string'         ? body.phone.trim()         || null : null;
  const address       = typeof body.address === 'string'       ? body.address.trim()       || null : null;
  const logoUrl       = typeof body.logoUrl === 'string'       ? body.logoUrl.trim()       || null : null;
  const coverImageUrl = typeof body.coverImageUrl === 'string' ? body.coverImageUrl.trim() || null : null;

  const result = await prisma.guestHubBranding.upsert({
    where:  { hubId },
    create: { hubId, name, tagline, phone, address, logoUrl, coverImageUrl },
    update: {        name, tagline, phone, address, logoUrl, coverImageUrl },
  });

  // TODO: append to centralized audit log when available

  return {
    id:            result.id,
    name:          result.name,
    tagline:       result.tagline,
    phone:         result.phone,
    address:       result.address,
    logoUrl:       result.logoUrl,
    coverImageUrl: result.coverImageUrl,
  };
}

// Atomically replaces all social links for a hub.
// Passing an empty array clears all links.
export async function replaceHubSocialLinks(
  hubId: string,
  links: unknown,
  _actor: AuthPayload,
): Promise<HubAdminSocialDto[]> {
  const fieldErrors = validateSocialInput(links);
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Validation failed', { fieldErrors });
  }

  const clean = (links as SocialInput[]).map((l, i) => ({
    platform:  l.platform.toLowerCase().trim(),
    handle:    l.handle.trim(),
    sortOrder: i,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.guestHubSocialLink.deleteMany({ where: { hubId } });
    for (const link of clean) {
      await tx.guestHubSocialLink.create({ data: { hubId, ...link } });
    }
  });

  // TODO: append to centralized audit log when available

  const fresh = await prisma.guestHubSocialLink.findMany({
    where:   { hubId },
    orderBy: { sortOrder: 'asc' },
  });

  return fresh.map(s => ({
    id:        s.id,
    platform:  s.platform,
    handle:    s.handle,
    sortOrder: s.sortOrder,
  }));
}

// Atomically copies draft branding + social links to the published tables.
// Requires branding to exist before publishing.
export async function publishHub(
  hubId: string,
  _actor: AuthPayload,
): Promise<{ publishedAt: string }> {
  const hub = await prisma.guestHub.findUnique({
    where: { id: hubId },
    include: {
      branding:    true,
      socialLinks: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!hub) throw new ValidationError('Hub not found', {});
  if (!hub.branding) {
    throw new ValidationError('Cannot publish: save branding first', {
      fieldErrors: { branding: ['Branding is required before publishing'] },
    });
  }

  const now = new Date();
  const b   = hub.branding;

  await prisma.$transaction(async (tx) => {
    await tx.guestHubPublishedBranding.upsert({
      where:  { hubId },
      create: { hubId, name: b.name, tagline: b.tagline, phone: b.phone, address: b.address, logoUrl: b.logoUrl, coverImageUrl: b.coverImageUrl, publishedAt: now },
      update: {        name: b.name, tagline: b.tagline, phone: b.phone, address: b.address, logoUrl: b.logoUrl, coverImageUrl: b.coverImageUrl, publishedAt: now },
    });

    await tx.guestHubPublishedSocialLink.deleteMany({ where: { hubId } });
    for (const link of hub.socialLinks) {
      await tx.guestHubPublishedSocialLink.create({
        data: { hubId, platform: link.platform, handle: link.handle, sortOrder: link.sortOrder },
      });
    }

    await tx.guestHub.update({ where: { id: hubId }, data: { lastPublishedAt: now } });
  });

  return { publishedAt: now.toISOString() };
}

// ── Provisioning ───────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')     // non-alnum → hyphen
    .replace(/^-+|-+$/g, '')         // trim leading/trailing hyphens
    .slice(0, 50)                     // max 50 chars
    || 'restaurant';
}

async function generateUniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i <= 99; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing = await prisma.guestHub.findUnique({
      where:  { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error('Cannot generate a unique slug after 100 attempts');
}

// Idempotent: creates hub + branding + menu + QR token for a restaurant.
// If the restaurant already has a hub, returns it without modification.
// Does NOT publish — hub starts in draft state. Admin must review and publish.
export async function provisionHub(restaurantId: string): Promise<HubAdminDto> {
  const existing = await getHubForRestaurant(restaurantId);
  if (existing) return existing;

  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { id: true, name: true, phone: true, address: true },
  });
  if (!restaurant) throw new NotFoundError('Restaurant', restaurantId);

  const slug  = await generateUniqueSlug(restaurant.name);
  // 18 bytes → 24-char URL-safe base64 (no padding; 18 is divisible by 3)
  const token = crypto.randomBytes(18).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  await prisma.guestHub.create({
    data: {
      slug,
      restaurantId,
      isActive: true,
      branding: {
        create: {
          name:    restaurant.name,
          phone:   restaurant.phone   ?? null,
          address: restaurant.address ?? null,
        },
      },
      menus:    { create: { name: 'Menu', sortOrder: 0 } },
      qrTokens: { create: { token, label: 'Default' } },
    },
  });

  const created = await getHubForRestaurant(restaurantId);
  if (!created) throw new Error('Provision failed: hub not found after creation');
  return created;
}
