import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../lib/errors';

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
  // Lookup by email first, then phone
  let existing = null;
  if (data.email) {
    existing = await prisma.guest.findFirst({
      where: { restaurantId, email: data.email },
    });
  }
  if (!existing && data.phone) {
    existing = await prisma.guest.findFirst({
      where: { restaurantId, phone: data.phone },
    });
  }

  if (existing) return { guest: existing, created: false };

  const guest = await prisma.guest.create({
    data: {
      restaurantId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email ?? null,
      phone: data.phone ?? null,
    },
  });
  return { guest, created: true };
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
