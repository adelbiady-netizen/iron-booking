// ─── Guest Hub admin service ───────────────────────────────────────────────────
// Authenticated write operations for GuestHubBranding and GuestHubSocialLink.
// ISOLATION: imports from ../../lib/prisma and ../../lib/errors only.
//            No reservation, waitlist, floor, or SSE imports.

import { prisma } from '../../lib/prisma';
import { ValidationError } from '../../lib/errors';
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
  branding: HubAdminBrandingDto | null;
  socialLinks: HubAdminSocialDto[];
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

  for (let i = 0; i < links.length; i++) {
    const l = links[i] as Record<string, unknown>;
    const platform = typeof l.platform === 'string' ? l.platform.toLowerCase().trim() : '';
    if (!ALLOWED_PLATFORMS.has(platform)) {
      err[`links[${i}].platform`] = [`Must be one of: ${[...ALLOWED_PLATFORMS].join(', ')}`];
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
      socialLinks: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!hub) return null;

  return {
    id:           hub.id,
    slug:         hub.slug,
    restaurantId: hub.restaurantId,
    isActive:     hub.isActive,
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
