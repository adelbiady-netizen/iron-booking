"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFloorState = getFloorState;
exports.listTables = listTables;
exports.getTable = getTable;
exports.createTable = createTable;
exports.updateTable = updateTable;
exports.deleteTable = deleteTable;
exports.blockTable = blockTable;
exports.unblockTable = unblockTable;
exports.listBlocks = listBlocks;
exports.getTableSuggestions = getTableSuggestions;
exports.getFloorSuggestions = getFloorSuggestions;
exports.getFloorInsights = getFloorInsights;
exports.listSections = listSections;
exports.upsertSection = upsertSection;
const prisma_1 = require("../../lib/prisma");
const errors_1 = require("../../lib/errors");
const tableMatcher_1 = require("../../engine/tableMatcher");
const date_fns_1 = require("date-fns");
const availability_1 = require("../../engine/availability");
const ACTIVE_STATUSES = ['CONFIRMED', 'SEATED', 'PENDING'];
// ─── Floor State ─────────────────────────────────────────────────────────────
// Returns all tables with their live status for a given date/time.
// This is what powers the host's table board.
async function getFloorState(restaurantId, date, time) {
    const [tables, reservations, blocks] = await Promise.all([
        prisma_1.prisma.table.findMany({
            where: { restaurantId, isActive: true },
            include: { section: true },
            orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
        }),
        prisma_1.prisma.reservation.findMany({
            where: {
                restaurantId,
                date,
                status: { in: ACTIVE_STATUSES },
            },
            include: {
                guest: { select: { id: true, firstName: true, lastName: true, isVip: true, tags: true } },
            },
        }),
        prisma_1.prisma.blockedPeriod.findMany({
            where: {
                restaurantId,
                startTime: { lte: (0, availability_1.parseTimeOnDate)(date, time) },
                endTime: { gte: (0, availability_1.parseTimeOnDate)(date, time) },
            },
        }),
    ]);
    const slotTime = (0, availability_1.parseTimeOnDate)(date, time);
    return tables.map((table) => {
        // Check blocks first
        const block = blocks.find((b) => b.tableId === table.id || b.tableId === null);
        if (block) {
            return {
                ...table,
                liveStatus: 'BLOCKED',
                blockReason: block.reason,
                blockType: block.type,
                currentReservation: null,
                upcomingReservations: [],
            };
        }
        // Find seated reservation
        const seated = reservations.find((r) => r.tableId === table.id && r.status === 'SEATED');
        if (seated) {
            const seatedAt = seated.seatedAt ?? (0, availability_1.parseTimeOnDate)(date, seated.time);
            const expectedEnd = (0, date_fns_1.addMinutes)(seatedAt, seated.duration);
            const minutesRemaining = Math.round((expectedEnd.getTime() - slotTime.getTime()) / 60000);
            return {
                ...table,
                liveStatus: 'OCCUPIED',
                currentReservation: { ...seated, minutesRemaining },
                upcomingReservations: [],
            };
        }
        // Find upcoming reservations for this table on this date
        const upcoming = reservations
            .filter((r) => r.tableId === table.id && r.status !== 'SEATED')
            .sort((a, b) => a.time.localeCompare(b.time));
        const nextRes = upcoming[0];
        if (nextRes) {
            const nextTime = (0, availability_1.parseTimeOnDate)(date, nextRes.time);
            const minutesUntil = Math.round((nextTime.getTime() - slotTime.getTime()) / 60000);
            return {
                ...table,
                liveStatus: minutesUntil <= 15 ? 'RESERVED_SOON' : 'RESERVED',
                currentReservation: null,
                upcomingReservations: upcoming.slice(0, 3).map((r) => ({
                    ...r,
                    minutesUntil: Math.round(((0, availability_1.parseTimeOnDate)(date, r.time).getTime() - slotTime.getTime()) / 60000),
                })),
            };
        }
        return {
            ...table,
            liveStatus: 'AVAILABLE',
            currentReservation: null,
            upcomingReservations: [],
        };
    });
}
// ─── Table CRUD ───────────────────────────────────────────────────────────────
async function listTables(restaurantId) {
    return prisma_1.prisma.table.findMany({
        where: { restaurantId },
        include: { section: true },
        orderBy: [{ section: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
}
async function getTable(restaurantId, tableId) {
    const t = await prisma_1.prisma.table.findUnique({ where: { id: tableId }, include: { section: true } });
    if (!t || t.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Table', tableId);
    return t;
}
async function createTable(restaurantId, data) {
    return prisma_1.prisma.table.create({
        data: {
            restaurantId,
            name: data.name,
            sectionId: data.sectionId ?? null,
            minCovers: data.minCovers,
            maxCovers: data.maxCovers,
            shape: data.shape ?? 'RECTANGLE',
            isCombinable: data.isCombinable ?? false,
            posX: data.posX ?? 0,
            posY: data.posY ?? 0,
            width: data.width ?? 80,
            height: data.height ?? 80,
            rotation: data.rotation ?? 0,
            turnTimeMinutes: data.turnTimeMinutes ?? null,
            notes: data.notes ?? null,
        },
        include: { section: true },
    });
}
async function updateTable(restaurantId, tableId, data) {
    const t = await prisma_1.prisma.table.findUnique({ where: { id: tableId } });
    if (!t || t.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Table', tableId);
    return prisma_1.prisma.table.update({ where: { id: tableId }, data, include: { section: true } });
}
async function deleteTable(restaurantId, tableId) {
    const t = await prisma_1.prisma.table.findUnique({ where: { id: tableId } });
    if (!t || t.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Table', tableId);
    // Check for active reservations
    const active = await prisma_1.prisma.reservation.count({
        where: { tableId, status: { in: ACTIVE_STATUSES } },
    });
    if (active > 0) {
        throw new errors_1.BusinessRuleError('Cannot delete table with active reservations');
    }
    return prisma_1.prisma.table.delete({ where: { id: tableId } });
}
// ─── Block / Unblock ─────────────────────────────────────────────────────────
async function blockTable(restaurantId, data) {
    if (data.tableId) {
        const t = await prisma_1.prisma.table.findUnique({ where: { id: data.tableId } });
        if (!t || t.restaurantId !== restaurantId)
            throw new errors_1.NotFoundError('Table', data.tableId);
    }
    return prisma_1.prisma.blockedPeriod.create({
        data: {
            restaurantId,
            tableId: data.tableId ?? null,
            reason: data.reason,
            type: data.type,
            startTime: data.startTime,
            endTime: data.endTime,
            createdBy: data.createdBy,
        },
    });
}
async function unblockTable(restaurantId, blockId) {
    const block = await prisma_1.prisma.blockedPeriod.findUnique({ where: { id: blockId } });
    if (!block || block.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Block', blockId);
    return prisma_1.prisma.blockedPeriod.delete({ where: { id: blockId } });
}
async function listBlocks(restaurantId, tableId) {
    return prisma_1.prisma.blockedPeriod.findMany({
        where: {
            restaurantId,
            ...(tableId ? { tableId } : {}),
            endTime: { gte: new Date() },
        },
        orderBy: { startTime: 'asc' },
    });
}
// ─── Table Suggestions ───────────────────────────────────────────────────────
async function getTableSuggestions(restaurantId, query) {
    const restaurant = await prisma_1.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { settings: true },
    });
    const s = restaurant.settings;
    const duration = query.duration ?? s.defaultTurnMinutes ?? 90;
    const buffer = s.bufferBetweenTurnsMinutes ?? 15;
    return (0, tableMatcher_1.suggestTables)({
        restaurantId,
        date: new Date(query.date + 'T00:00:00.000Z'),
        time: query.time,
        partySize: query.partySize,
        durationMinutes: duration,
        bufferMinutes: buffer,
        occasion: query.occasion,
        guestIsVip: query.guestIsVip,
    });
}
async function getFloorSuggestions(restaurantId, date, time) {
    const dateObj = new Date(date + 'T00:00:00.000Z');
    const [floorState, reservations] = await Promise.all([
        getFloorState(restaurantId, dateObj, time),
        prisma_1.prisma.reservation.findMany({
            where: {
                restaurantId,
                date: dateObj,
                status: { in: ['PENDING', 'CONFIRMED'] },
                tableId: null,
            },
            select: { id: true, guestName: true, partySize: true, time: true, status: true },
        }),
    ]);
    const availableTables = floorState.filter((t) => t.liveStatus === 'AVAILABLE');
    if (availableTables.length === 0 || reservations.length === 0)
        return [];
    const [nowH, nowM] = time.split(':').map(Number);
    const nowMinutes = nowH * 60 + nowM;
    const suggestions = [];
    for (const table of availableTables) {
        let bestId = null;
        let bestScore = -1;
        let bestReason = '';
        let bestRes = null;
        for (const res of reservations) {
            if (res.partySize > table.maxCovers)
                continue; // can't seat — hard skip
            // Party size fit (0–40)
            let partySizeScore;
            if (res.partySize >= table.minCovers && res.partySize <= table.maxCovers) {
                const slack = table.maxCovers - res.partySize;
                partySizeScore = slack === 0 ? 40 : slack === 1 ? 35 : slack <= 2 ? 28 : 20;
            }
            else {
                partySizeScore = 5; // under minCovers — possible but non-ideal
            }
            // Time proximity (0–40)
            const [rH, rM] = res.time.split(':').map(Number);
            const diff = rH * 60 + rM - nowMinutes;
            const timeScore = diff >= 0 && diff <= 30 ? 40 :
                diff > 30 && diff <= 60 ? 30 :
                    diff > 60 && diff <= 120 ? 20 :
                        diff > 120 ? 10 :
                            diff >= -30 ? 25 : // slightly late, still relevant
                                5;
            // Status (0–20)
            const statusScore = res.status === 'CONFIRMED' ? 20 : 10;
            const score = partySizeScore + timeScore + statusScore;
            if (score <= bestScore)
                continue;
            // Reason describes the fit — time is shown separately in the UI
            const fit = res.partySize >= table.minCovers && res.partySize <= table.maxCovers;
            const slack = table.maxCovers - res.partySize;
            const fitLabel = fit
                ? (slack <= 1 ? `Perfect fit for ${table.minCovers}–${table.maxCovers} covers`
                    : `Good fit for ${table.minCovers}–${table.maxCovers} covers`)
                : `Works for party of ${res.partySize}`;
            const reason = res.status === 'CONFIRMED' ? `${fitLabel} · confirmed` : fitLabel;
            bestId = res.id;
            bestScore = score;
            bestReason = reason;
            bestRes = res;
        }
        if (bestId && bestRes) {
            suggestions.push({
                tableId: table.id,
                suggestedReservationId: bestId,
                score: bestScore,
                reason: bestReason,
                reservation: {
                    guestName: bestRes.guestName,
                    partySize: bestRes.partySize,
                    time: bestRes.time,
                    status: bestRes.status,
                },
            });
        }
    }
    return suggestions;
}
async function getFloorInsights(restaurantId, date, time) {
    const dateObj = new Date(date + 'T00:00:00.000Z');
    const [floorState, unassigned] = await Promise.all([
        getFloorState(restaurantId, dateObj, time),
        prisma_1.prisma.reservation.findMany({
            where: {
                restaurantId,
                date: dateObj,
                status: { in: ['PENDING', 'CONFIRMED'] },
                tableId: null,
            },
            select: { id: true, guestName: true, partySize: true, time: true, status: true },
        }),
    ]);
    const [nowH, nowM] = time.split(':').map(Number);
    const nowMinutes = nowH * 60 + nowM;
    const insights = [];
    for (const table of floorState) {
        // ── ENDING_SOON: occupied table where turn is nearly up ──────────────────
        if (table.liveStatus === 'OCCUPIED' && table.currentReservation) {
            const mr = table.currentReservation.minutesRemaining;
            if (mr < 10) {
                insights.push({
                    type: 'ENDING_SOON',
                    priority: 'MEDIUM',
                    tableId: table.id,
                    message: mr > 0
                        ? `Table ${table.name} ends in ${mr}m`
                        : `Table ${table.name} — over by ${Math.abs(mr)}m`,
                });
            }
        }
        // ── LATE_GUEST: assigned reservation whose time has already passed ───────
        if (table.liveStatus === 'RESERVED_SOON') {
            const nextRes = table.upcomingReservations[0];
            if (nextRes && nextRes.minutesUntil < 0) {
                insights.push({
                    type: 'LATE_GUEST',
                    priority: 'HIGH',
                    tableId: table.id,
                    reservationId: nextRes.id,
                    message: `${nextRes.guestName} is ${Math.abs(nextRes.minutesUntil)}m late`,
                });
            }
        }
        // ── SEAT_NOW: available table + best-scoring unassigned reservation ──────
        if (table.liveStatus === 'AVAILABLE' && unassigned.length > 0) {
            let bestRes = null;
            let bestScore = -1;
            for (const res of unassigned) {
                if (res.partySize > table.maxCovers)
                    continue;
                const fit = res.partySize >= table.minCovers && res.partySize <= table.maxCovers;
                const slack = table.maxCovers - res.partySize;
                const partySizeScore = fit
                    ? (slack === 0 ? 40 : slack === 1 ? 35 : slack <= 2 ? 28 : 20)
                    : 5;
                const [rH, rM] = res.time.split(':').map(Number);
                const diff = rH * 60 + rM - nowMinutes;
                const timeScore = diff >= 0 && diff <= 30 ? 40 :
                    diff > 30 && diff <= 60 ? 30 :
                        diff > 60 && diff <= 120 ? 20 :
                            diff > 120 ? 10 :
                                diff >= -30 ? 25 : 5;
                const statusScore = res.status === 'CONFIRMED' ? 20 : 10;
                const score = partySizeScore + timeScore + statusScore;
                if (score > bestScore) {
                    bestScore = score;
                    bestRes = res;
                }
            }
            if (bestRes) {
                const [rH, rM] = bestRes.time.split(':').map(Number);
                const diff = rH * 60 + rM - nowMinutes;
                const fit = bestRes.partySize >= table.minCovers && bestRes.partySize <= table.maxCovers;
                const reason = fit
                    ? `Good fit for ${table.minCovers}–${table.maxCovers} covers`
                    : `Works for party of ${bestRes.partySize}`;
                insights.push({
                    type: 'SEAT_NOW',
                    priority: 'HIGH',
                    tableId: table.id,
                    reservationId: bestRes.id,
                    message: diff < 0
                        ? `Seat ${bestRes.guestName} now — ${Math.abs(diff)}m late`
                        : `Seat ${bestRes.guestName} at ${table.name}`,
                    reservation: {
                        guestName: bestRes.guestName,
                        partySize: bestRes.partySize,
                        time: bestRes.time,
                        status: bestRes.status,
                    },
                    reason,
                });
            }
        }
    }
    return insights;
}
// ─── Sections ─────────────────────────────────────────────────────────────────
async function listSections(restaurantId) {
    return prisma_1.prisma.section.findMany({
        where: { restaurantId },
        include: { tables: { where: { isActive: true } } },
        orderBy: { sortOrder: 'asc' },
    });
}
async function upsertSection(restaurantId, data) {
    return prisma_1.prisma.section.upsert({
        where: { restaurantId_name: { restaurantId, name: data.name } },
        create: { restaurantId, name: data.name, color: data.color ?? '#6366f1', sortOrder: data.sortOrder ?? 0 },
        update: { color: data.color, sortOrder: data.sortOrder },
    });
}
//# sourceMappingURL=service.js.map