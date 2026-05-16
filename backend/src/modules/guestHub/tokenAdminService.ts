// ─── Guest Hub QR Token admin service ─────────────────────────────────────────
// CRUD for GuestHubQrToken.
// hubId is ALWAYS derived from restaurantId — never accepted from the client.
//
// ISOLATION: imports from ../../lib/prisma and ../../lib/errors only.
//            No reservation, waitlist, floor, or SSE imports.

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NotFoundError, ValidationError, BusinessRuleError } from '../../lib/errors';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TokenMetadata {
  tableName?: string; // physical table identifier — "T12", "Bar 3", "Patio 7"
  zone?:      string; // seating area — "terrace", "bar", "private-dining", "main-floor"
  campaign?:  string; // attribution label — "summer-2026", "happy-hour", "launch-week"
  source?:    string; // print channel — "table-tent", "entrance-sign", "window-sticker"
  // TODO Phase 104+: scanCount (atomic increment on each /q/:token hit)
  // TODO Phase 104+: lastScannedAt — requires scan-event infrastructure
  // TODO Phase 104+: source → reservation conversion attribution
}

export interface QrTokenAdminDto {
  id:        string;
  token:     string;
  label:     string | null;
  isActive:  boolean;
  metadata:  TokenMetadata;
  createdAt: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function requireHubId(restaurantId: string): Promise<string> {
  const hub = await prisma.guestHub.findFirst({
    where:  { restaurantId },
    select: { id: true },
  });
  if (!hub) throw new NotFoundError('Hub', restaurantId);
  return hub.id;
}

function shapeToken(t: {
  id: string; token: string; label: string | null;
  isActive: boolean; metadata: unknown; createdAt: Date;
}): QrTokenAdminDto {
  return {
    id:        t.id,
    token:     t.token,
    label:     t.label,
    isActive:  t.isActive,
    metadata:  (t.metadata as TokenMetadata | null) ?? {},
    createdAt: t.createdAt.toISOString(),
  };
}

function generateToken(): string {
  // 18 bytes → 24-char URL-safe base64, no padding
  return crypto.randomBytes(18).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateLabel(label: string | null): void {
  if (label !== null && label.length > 100) {
    throw new ValidationError('label must be 100 characters or fewer', {});
  }
}

function parseMetadata(raw: unknown): TokenMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const m   = raw as Record<string, unknown>;
  const out: TokenMetadata = {};

  const str = (key: keyof TokenMetadata, max: number) => {
    if (!(key in m)) return;
    const v = typeof m[key] === 'string' ? (m[key] as string).trim() : '';
    if (v.length > max) {
      throw new ValidationError(`${key} must be ${max} characters or fewer`, {});
    }
    if (v) out[key] = v;
  };

  str('tableName', 50);
  str('zone',      50);
  str('campaign', 100);
  str('source',    50);
  return out;
}

async function assertLabelUnique(
  hubId:          string,
  label:          string,
  excludeTokenId?: string,
): Promise<void> {
  const conflict = await prisma.guestHubQrToken.findFirst({
    where: {
      hubId,
      label,
      ...(excludeTokenId ? { id: { not: excludeTokenId } } : {}),
    },
    select: { id: true },
  });
  if (conflict) {
    throw new ValidationError(`A token labelled "${label}" already exists for this hub`, {});
  }
}

// ── Queries ────────────────────────────────────────────────────────────────────

export async function listTokens(restaurantId: string): Promise<QrTokenAdminDto[]> {
  const hubId  = await requireHubId(restaurantId);
  const tokens = await prisma.guestHubQrToken.findMany({
    where:   { hubId },
    orderBy: { createdAt: 'asc' },
  });
  return tokens.map(shapeToken);
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function createToken(
  restaurantId: string,
  body:         Record<string, unknown>,
): Promise<QrTokenAdminDto> {
  const hubId = await requireHubId(restaurantId);

  const label    = typeof body.label === 'string' ? body.label.trim() || null : null;
  validateLabel(label);
  if (label) await assertLabelUnique(hubId, label);

  const metadata = parseMetadata(body.metadata);

  // Prevent runaway token provisioning
  const count = await prisma.guestHubQrToken.count({ where: { hubId } });
  if (count >= 50) {
    throw new BusinessRuleError('Maximum 50 QR tokens per hub');
  }

  const created = await prisma.guestHubQrToken.create({
    data: {
      hubId,
      token:    generateToken(),
      label,
      isActive: true,
      metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : undefined,
    },
  });

  return shapeToken(created);
}

// Updates label and/or metadata only — token string is immutable.
export async function updateToken(
  restaurantId: string,
  tokenId:      string,
  body:         Record<string, unknown>,
): Promise<QrTokenAdminDto> {
  const hubId    = await requireHubId(restaurantId);
  const existing = await prisma.guestHubQrToken.findFirst({
    where: { id: tokenId, hubId },
  });
  if (!existing) throw new NotFoundError('QrToken', tokenId);

  const label = 'label' in body
    ? (typeof body.label === 'string' ? body.label.trim() || null : null)
    : existing.label;

  validateLabel(label);
  if (label && label !== existing.label) {
    await assertLabelUnique(hubId, label, tokenId);
  }

  const metadata = 'metadata' in body
    ? parseMetadata(body.metadata)
    : ((existing.metadata as TokenMetadata | null) ?? {});

  const updated = await prisma.guestHubQrToken.update({
    where: { id: tokenId },
    data:  {
      label,
      metadata: Object.keys(metadata).length > 0
        ? (metadata as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });

  return shapeToken(updated);
}

// Stops QR resolution — any printed card pointing to this token shows an error.
export async function deactivateToken(
  restaurantId: string,
  tokenId:      string,
): Promise<QrTokenAdminDto> {
  const hubId    = await requireHubId(restaurantId);
  const existing = await prisma.guestHubQrToken.findFirst({
    where: { id: tokenId, hubId },
  });
  if (!existing) throw new NotFoundError('QrToken', tokenId);

  const updated = await prisma.guestHubQrToken.update({
    where: { id: tokenId },
    data:  { isActive: false },
  });
  return shapeToken(updated);
}

// Restores QR resolution — re-activates existing printed cards.
export async function reactivateToken(
  restaurantId: string,
  tokenId:      string,
): Promise<QrTokenAdminDto> {
  const hubId    = await requireHubId(restaurantId);
  const existing = await prisma.guestHubQrToken.findFirst({
    where: { id: tokenId, hubId },
  });
  if (!existing) throw new NotFoundError('QrToken', tokenId);

  const updated = await prisma.guestHubQrToken.update({
    where: { id: tokenId },
    data:  { isActive: true },
  });
  return shapeToken(updated);
}
