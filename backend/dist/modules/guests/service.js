"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchGuests = searchGuests;
exports.getGuest = getGuest;
exports.findOrCreateGuest = findOrCreateGuest;
exports.createGuest = createGuest;
exports.updateGuest = updateGuest;
exports.mergeGuests = mergeGuests;
const prisma_1 = require("../../lib/prisma");
const errors_1 = require("../../lib/errors");
async function assertGuest(restaurantId, id) {
    const g = await prisma_1.prisma.guest.findUnique({ where: { id } });
    if (!g || g.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Guest', id);
    return g;
}
async function searchGuests(restaurantId, query) {
    const where = { restaurantId };
    if (query.search) {
        where.OR = [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
            { email: { contains: query.search, mode: 'insensitive' } },
        ];
    }
    if (query.isVip !== undefined)
        where.isVip = query.isVip;
    if (query.isBlacklisted !== undefined)
        where.isBlacklisted = query.isBlacklisted;
    if (query.tag)
        where.tags = { has: query.tag };
    const [total, guests] = await Promise.all([
        prisma_1.prisma.guest.count({ where }),
        prisma_1.prisma.guest.findMany({
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
async function getGuest(restaurantId, id) {
    const g = await prisma_1.prisma.guest.findUnique({
        where: { id },
        include: {
            reservations: {
                orderBy: { date: 'desc' },
                take: 20,
                include: { table: { select: { name: true } } },
            },
        },
    });
    if (!g || g.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Guest', id);
    return g;
}
async function findOrCreateGuest(restaurantId, data) {
    // Lookup by email first, then phone
    let existing = null;
    if (data.email) {
        existing = await prisma_1.prisma.guest.findFirst({
            where: { restaurantId, email: data.email },
        });
    }
    if (!existing && data.phone) {
        existing = await prisma_1.prisma.guest.findFirst({
            where: { restaurantId, phone: data.phone },
        });
    }
    if (existing)
        return { guest: existing, created: false };
    const guest = await prisma_1.prisma.guest.create({
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
async function createGuest(restaurantId, data) {
    return prisma_1.prisma.guest.create({
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
async function updateGuest(restaurantId, id, data) {
    await assertGuest(restaurantId, id);
    return prisma_1.prisma.guest.update({ where: { id }, data: data });
}
async function mergeGuests(restaurantId, primaryId, duplicateId) {
    const [primary, duplicate] = await Promise.all([
        assertGuest(restaurantId, primaryId),
        assertGuest(restaurantId, duplicateId),
    ]);
    return prisma_1.prisma.$transaction(async (tx) => {
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
//# sourceMappingURL=service.js.map