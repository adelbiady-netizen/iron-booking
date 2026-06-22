import crypto from 'crypto';
import { prisma } from './prisma';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOKEN_BYTES    = 32;            // 256 bits of entropy
const TOKEN_TTL_DAYS = 90;
const FRONTEND_BASE  = process.env.FRONTEND_BASE_URL ?? 'https://www.ironbooking.com';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function expiresAt(): Date {
  return new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function buildUnsubscribeUrl(rawToken: string): string {
  return `${FRONTEND_BASE}/unsubscribe/${rawToken}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TokenInput {
  restaurantId: string;
  guestId:      string;
  clubMemberId: string | null;
  phone:        string;
}

export interface TokenResult {
  rawToken:       string;   // included in SMS link — never persisted
  unsubscribeUrl: string;   // full URL ready to append
}

/**
 * Return a valid, non-expired unsubscribe token for this guest+restaurant,
 * reusing an existing one if available to avoid token sprawl.
 * Only the SHA-256 hash is stored — the raw token is ephemeral.
 */
export async function generateOrReuseToken(input: TokenInput): Promise<TokenResult> {
  // Reuse the most recent valid token for this guest at this restaurant
  const existing = await prisma.unsubscribeToken.findFirst({
    where: {
      restaurantId: input.restaurantId,
      guestId:      input.guestId,
      usedAt:       null,
      expiresAt:    { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    // We can't recover the raw token from the hash — issue a new one and
    // update the record so the link is fresh.
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    await prisma.unsubscribeToken.update({
      where: { id: existing.id },
      data: {
        tokenHash:   hashToken(rawToken),
        expiresAt:   expiresAt(),
        clubMemberId: input.clubMemberId ?? null,
        phone:        input.phone,
      },
    });
    return { rawToken, unsubscribeUrl: buildUnsubscribeUrl(rawToken) };
  }

  // No valid token — create fresh
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  await prisma.unsubscribeToken.create({
    data: {
      tokenHash:   hashToken(rawToken),
      restaurantId: input.restaurantId,
      guestId:      input.guestId,
      clubMemberId: input.clubMemberId ?? null,
      phone:        input.phone,
      expiresAt:    expiresAt(),
    },
  });
  return { rawToken, unsubscribeUrl: buildUnsubscribeUrl(rawToken) };
}

// ── Validation result types ───────────────────────────────────────────────────

export type TokenStatus = 'valid' | 'invalid' | 'expired' | 'already_used';

export interface ValidatedToken {
  status:       TokenStatus;
  tokenId?:     string;
  restaurantId?: string;
  guestId?:     string;
  clubMemberId?: string | null;
  phone?:       string;
}

/**
 * Look up a raw token, returning its status and associated IDs.
 * Does NOT modify the token row — call consumeToken() after processing.
 */
export async function validateToken(rawToken: string): Promise<ValidatedToken> {
  if (!rawToken || rawToken.length !== TOKEN_BYTES * 2) return { status: 'invalid' };

  const hash = hashToken(rawToken);
  const row  = await prisma.unsubscribeToken.findUnique({
    where:  { tokenHash: hash },
    select: { id: true, restaurantId: true, guestId: true, clubMemberId: true, phone: true, expiresAt: true, usedAt: true },
  });

  if (!row)               return { status: 'invalid' };
  if (row.usedAt)         return { status: 'already_used' };
  if (row.expiresAt < new Date()) return { status: 'expired' };

  return {
    status:       'valid',
    tokenId:      row.id,
    restaurantId: row.restaurantId,
    guestId:      row.guestId,
    clubMemberId: row.clubMemberId,
    phone:        row.phone,
  };
}

/**
 * Stamp usedAt on the token row. Call only after the unsubscribe has been
 * successfully applied. Idempotent — safe if called twice.
 */
export async function consumeToken(tokenId: string): Promise<void> {
  await prisma.unsubscribeToken.update({
    where: { id: tokenId },
    data:  { usedAt: new Date() },
  });
}
