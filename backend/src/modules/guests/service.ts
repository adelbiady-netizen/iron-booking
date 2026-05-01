import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../lib/errors';

// ─── Shared helpers (exported for use in other services) ──────────────────────

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  return trimmed.replace(/\D/g, '');
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: trimmed };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() };
}

async function assertGuest(restaurantId: string, id: string) {
  const g = await prisma.guest.findUnique({ where: { id } });
  if (!g || g.restaurantId !== restaurantId) throw new NotFoundError('Guest', id);
  return g;
}

export async function searchGuests(restaurantId: string, query: {
  search?: string;
  isVip?: boolean;
  isBlacklisted?: boolean;
  tag?: string;
  page: number;
  limit: number;
}) {
  const where: Prisma.GuestWhereInput = { restaurantId };

  if (query.search) {
    where.OR = [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.isVip !== undefined) where.isVip = query.isVip;
  if (query.isBlacklisted !== undefined) where.isBlacklisted = query.isBlacklisted;
  if (query.tag) where.tags = { has: query.tag };

  const [total, guests] = await Promise.all([
    prisma.guest.count({ where }),
    prisma.guest.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return {
    data: guests,
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
  };
}

export async function getGuest(restaurantId: string, id: string) {
  const g = await prisma.guest.findUnique({
    where: { id },
    include: {
      reservations: {
        orderBy: { date: 'desc' },
        take: 20,
        include: { table: { select: { name: true } } },
      },
    },
  });
  if (!g || g.restaurantId !== restaurantId) throw new NotFoundError('Guest', id);
  return g;
}

export async function findOrCreateGuest(restaurantId: string, data: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}): Promise<{ guest: any; created: boolean }> {
  const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;

  // Phone-first lookup (normalized match)
  if (normalizedPhone) {
    const byPhone = await prisma.guest.findFirst({
      where: { restaurantId, phone: normalizedPhone },
    });
    if (byPhone) return { guest: byPhone, created: false };
  }

  // Fallback: email lookup
  if (data.email) {
    const byEmail = await prisma.guest.findFirst({
      where: { restaurantId, email: data.email },
    });
    if (byEmail) return { guest: byEmail, created: false };
  }

  // Create new guest record
  try {
    const guest = await prisma.guest.create({
      data: {
        restaurantId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: normalizedPhone ?? null,
      },
    });
    return { guest, created: true };
  } catch (err: any) {
    // P2002 = unique constraint violation — race condition where another request
    // created the same guest between our lookup and create. Re-fetch and return it.
    if (err?.code === 'P2002') {
      const existing = normalizedPhone
        ? await prisma.guest.findFirst({ where: { restaurantId, phone: normalizedPhone } })
        : data.email
        ? await prisma.guest.findFirst({ where: { restaurantId, email: data.email } })
        : null;
      if (existing) return { guest: existing, created: false };
    }
    throw err;
  }
}

export async function createGuest(restaurantId: string, data: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  isVip?: boolean;
  allergies?: string[];
  tags?: string[];
  preferences?: object;
  internalNotes?: string;
}) {
  return prisma.guest.create({
    data: {
      restaurantId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      isVip: data.isVip ?? false,
      allergies: data.allergies ?? [],
      tags: data.tags ?? [],
      preferences: data.preferences ?? {},
      internalNotes: data.internalNotes ?? null,
    },
  });
}

export async function updateGuest(restaurantId: string, id: string, data: Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  isVip: boolean;
  isBlacklisted: boolean;
  allergies: string[];
  tags: string[];
  preferences: object;
  internalNotes: string;
}>) {
  await assertGuest(restaurantId, id);
  return prisma.guest.update({ where: { id }, data: data as any });
}

export async function mergeGuests(restaurantId: string, primaryId: string, duplicateId: string) {
  const [primary, duplicate] = await Promise.all([
    assertGuest(restaurantId, primaryId),
    assertGuest(restaurantId, duplicateId),
  ]);

  return prisma.$transaction(async (tx) => {
    // Move all reservations from duplicate to primary
    await tx.reservation.updateMany({
      where: { guestId: duplicateId },
      data: { guestId: primaryId },
    });

    // Merge stats
    await tx.guest.update({
      where: { id: primaryId },
      data: {
        visitCount: { increment: duplicate.visitCount },
        noShowCount: { increment: duplicate.noShowCount },
        cancelCount: { increment: duplicate.cancelCount },
        // Merge tags uniquely
        tags: [...new Set([...primary.tags, ...duplicate.tags])],
        // Prefer primary's email/phone unless null
        email: primary.email ?? duplicate.email,
        phone: primary.phone ?? duplicate.phone,
      },
    });

    // Delete duplicate
    await tx.guest.delete({ where: { id: duplicateId } });

    return tx.guest.findUniqueOrThrow({ where: { id: primaryId } });
  });
}
