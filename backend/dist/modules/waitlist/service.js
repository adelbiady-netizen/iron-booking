"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateWaitMinutes = estimateWaitMinutes;
exports.listWaitlist = listWaitlist;
exports.getWaitlistEntry = getWaitlistEntry;
exports.addToWaitlist = addToWaitlist;
exports.updateWaitlistEntry = updateWaitlistEntry;
exports.notifyGuest = notifyGuest;
exports.seatWaitlistGuest = seatWaitlistGuest;
exports.removeFromWaitlist = removeFromWaitlist;
exports.getWaitlistStats = getWaitlistStats;
const prisma_1 = require("../../lib/prisma");
const errors_1 = require("../../lib/errors");
function parseDateArg(dateStr) {
    return new Date(dateStr + 'T00:00:00.000Z');
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function assertEntry(restaurantId, id) {
    const entry = await prisma_1.prisma.waitlistEntry.findUnique({ where: { id } });
    if (!entry || entry.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Waitlist entry', id);
    return entry;
}
// ─── Real wait time estimation ────────────────────────────────────────────────
// Estimates wait based on current seated count and average turn time.
// Production version: factor in party size, current occupancy, avg turn time.
async function estimateWaitMinutes(restaurantId, date, partySize) {
    const settings = await prisma_1.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { settings: true },
    });
    const s = settings.settings;
    const turnMinutes = s.defaultTurnMinutes ?? 90;
    const [seatedCount, waitingAhead] = await Promise.all([
        prisma_1.prisma.reservation.count({
            where: { restaurantId, date, status: 'SEATED' },
        }),
        prisma_1.prisma.waitlistEntry.count({
            where: { restaurantId, date, status: 'WAITING' },
        }),
    ]);
    const tables = await prisma_1.prisma.table.count({ where: { restaurantId, isActive: true } });
    // Simple model: each table cycles in `turnMinutes`. If seats are occupied,
    // estimate how many will free up in what time.
    if (seatedCount === 0)
        return 0;
    const occupancyRate = Math.min(1, seatedCount / Math.max(1, tables));
    const baseWait = occupancyRate * (turnMinutes / 2); // avg remaining time
    const queueDelay = waitingAhead * (turnMinutes / Math.max(1, tables));
    return Math.round(baseWait + queueDelay);
}
// ─── Service Functions ────────────────────────────────────────────────────────
async function listWaitlist(restaurantId, date) {
    return prisma_1.prisma.waitlistEntry.findMany({
        where: {
            restaurantId,
            date: parseDateArg(date),
            status: { in: ['WAITING', 'NOTIFIED'] },
        },
        orderBy: { addedAt: 'asc' },
    });
}
async function getWaitlistEntry(restaurantId, id) {
    return assertEntry(restaurantId, id);
}
async function addToWaitlist(restaurantId, data) {
    const date = parseDateArg(data.date);
    const quotedWaitMinutes = await estimateWaitMinutes(restaurantId, date, data.partySize);
    return prisma_1.prisma.waitlistEntry.create({
        data: {
            restaurantId,
            date,
            guestName: data.guestName,
            guestPhone: data.guestPhone ?? null,
            partySize: data.partySize,
            source: data.source ?? 'WALK_IN',
            quotedWaitMinutes,
            notes: data.notes ?? null,
        },
    });
}
async function updateWaitlistEntry(restaurantId, id, data) {
    await assertEntry(restaurantId, id);
    return prisma_1.prisma.waitlistEntry.update({ where: { id }, data });
}
async function notifyGuest(restaurantId, id) {
    const entry = await assertEntry(restaurantId, id);
    if (entry.status !== 'WAITING') {
        throw new errors_1.BusinessRuleError(`Entry is already ${entry.status}`);
    }
    return prisma_1.prisma.waitlistEntry.update({
        where: { id },
        data: { status: 'NOTIFIED', notifiedAt: new Date() },
    });
}
async function seatWaitlistGuest(restaurantId, id, tableId) {
    const entry = await assertEntry(restaurantId, id);
    if (!['WAITING', 'NOTIFIED'].includes(entry.status)) {
        throw new errors_1.BusinessRuleError(`Cannot seat a guest with status ${entry.status}`);
    }
    const settings = await prisma_1.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { settings: true },
    });
    const s = settings.settings;
    // Convert to a reservation
    const reservation = await prisma_1.prisma.$transaction(async (tx) => {
        const res = await tx.reservation.create({
            data: {
                restaurantId,
                partySize: entry.partySize,
                date: entry.date,
                time: new Date().toTimeString().slice(0, 5),
                duration: s.defaultTurnMinutes ?? 90,
                status: 'SEATED',
                source: 'WALK_IN',
                guestName: entry.guestName,
                guestPhone: entry.guestPhone,
                tableId: tableId ?? null,
                seatedAt: new Date(),
                confirmedAt: new Date(),
            },
        });
        await tx.waitlistEntry.update({
            where: { id },
            data: {
                status: 'SEATED',
                seatedAt: new Date(),
                reservationId: res.id,
            },
        });
        return res;
    });
    const updated = await prisma_1.prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });
    return { entry: updated, reservation };
}
async function removeFromWaitlist(restaurantId, id, reason) {
    await assertEntry(restaurantId, id);
    return prisma_1.prisma.waitlistEntry.update({
        where: { id },
        data: {
            status: reason,
            leftAt: new Date(),
        },
    });
}
async function getWaitlistStats(restaurantId, date) {
    const d = parseDateArg(date);
    const [waiting, notified, seated, left] = await Promise.all([
        prisma_1.prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'WAITING' } }),
        prisma_1.prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'NOTIFIED' } }),
        prisma_1.prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'SEATED' } }),
        prisma_1.prisma.waitlistEntry.count({ where: { restaurantId, date: d, status: 'LEFT' } }),
    ]);
    const avgWait = await prisma_1.prisma.waitlistEntry.aggregate({
        where: { restaurantId, date: d, status: 'SEATED', seatedAt: { not: null } },
        _avg: { quotedWaitMinutes: true },
    });
    return { waiting, notified, seated, left, avgQuotedWait: avgWait._avg.quotedWaitMinutes };
}
//# sourceMappingURL=service.js.map