"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listReservations = listReservations;
exports.getReservation = getReservation;
exports.getReservationTimeline = getReservationTimeline;
exports.createReservation = createReservation;
exports.updateReservation = updateReservation;
exports.confirmReservation = confirmReservation;
exports.seatReservation = seatReservation;
exports.moveReservation = moveReservation;
exports.completeReservation = completeReservation;
exports.markNoShow = markNoShow;
exports.cancelReservation = cancelReservation;
exports.undoReservation = undoReservation;
const prisma_1 = require("../../lib/prisma");
const errors_1 = require("../../lib/errors");
const availability_1 = require("../../engine/availability");
// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getRestaurantSettings(restaurantId) {
    const r = await prisma_1.prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: { settings: true },
    });
    const s = r.settings;
    return {
        defaultTurnMinutes: s.defaultTurnMinutes ?? 90,
        bufferBetweenTurnsMinutes: s.bufferBetweenTurnsMinutes ?? 15,
        autoConfirm: s.autoConfirm ?? false,
    };
}
function parseDateArg(dateStr) {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    if (isNaN(d.getTime()))
        throw new errors_1.ValidationError(`Invalid date: ${dateStr}`);
    return d;
}
async function assertReservationBelongsToRestaurant(id, restaurantId) {
    const r = await prisma_1.prisma.reservation.findUnique({ where: { id } });
    if (!r)
        throw new errors_1.NotFoundError('Reservation', id);
    if (r.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Reservation', id);
    return r;
}
// Two-step write: ORM create (without details) + raw UPDATE with ::jsonb cast.
// The Prisma 7 pg adapter does not correctly serialize plain objects for Json? fields.
async function logActivity(tx, reservationId, action, actor, details) {
    const record = await tx.reservationActivity.create({
        data: { reservationId, action, actor },
        select: { id: true },
    });
    await tx.$executeRaw `
    UPDATE reservation_activity
    SET details = ${JSON.stringify(details)}::jsonb
    WHERE id = ${record.id}
  `;
}
// ─── List ─────────────────────────────────────────────────────────────────────
async function listReservations(restaurantId, query) {
    const { date, dateFrom, dateTo, status, guestId, tableId, search, page, limit, } = query;
    const where = { restaurantId };
    if (date)
        where.date = parseDateArg(date);
    if (dateFrom || dateTo) {
        where.date = {
            ...(dateFrom ? { gte: parseDateArg(dateFrom) } : {}),
            ...(dateTo ? { lte: parseDateArg(dateTo) } : {}),
        };
    }
    if (status)
        where.status = status;
    if (guestId)
        where.guestId = guestId;
    if (tableId)
        where.tableId = tableId;
    if (search) {
        where.OR = [
            { guestName: { contains: search, mode: 'insensitive' } },
            { guestPhone: { contains: search } },
            { guestEmail: { contains: search, mode: 'insensitive' } },
        ];
    }
    const [total, reservations] = await Promise.all([
        prisma_1.prisma.reservation.count({ where }),
        prisma_1.prisma.reservation.findMany({
            where,
            include: {
                table: { select: { id: true, name: true, section: { select: { name: true } } } },
                guest: { select: { id: true, firstName: true, lastName: true, isVip: true, tags: true, visitCount: true, noShowCount: true } },
            },
            orderBy: [{ date: 'asc' }, { time: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return {
        data: reservations,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
}
// ─── Get One ──────────────────────────────────────────────────────────────────
async function getReservation(restaurantId, id) {
    const r = await prisma_1.prisma.reservation.findUnique({
        where: { id },
        include: {
            table: { include: { section: true } },
            guest: true,
            activityLog: { orderBy: { timestamp: 'desc' }, take: 50 },
        },
    });
    if (!r || r.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Reservation', id);
    return r;
}
// ─── Timeline ─────────────────────────────────────────────────────────────────
async function getReservationTimeline(restaurantId, id) {
    const r = await prisma_1.prisma.reservation.findUnique({
        where: { id },
        select: { id: true, restaurantId: true, guestName: true, status: true, date: true, time: true },
    });
    if (!r || r.restaurantId !== restaurantId)
        throw new errors_1.NotFoundError('Reservation', id);
    const activities = await prisma_1.prisma.reservationActivity.findMany({
        where: { reservationId: id },
        orderBy: { timestamp: 'asc' },
    });
    return {
        reservationId: id,
        guestName: r.guestName,
        status: r.status,
        date: r.date,
        time: r.time,
        timeline: activities,
    };
}
// ─── Create ──────────────────────────────────────────────────────────────────
async function createReservation(restaurantId, input, actorName) {
    const settings = await getRestaurantSettings(restaurantId);
    const duration = input.duration ?? settings.defaultTurnMinutes;
    const date = parseDateArg(input.date);
    if (input.tableId) {
        await validateTableAssignment(restaurantId, input.tableId, date, input.time, duration, settings.bufferBetweenTurnsMinutes, input.partySize);
    }
    const status = settings.autoConfirm ? 'CONFIRMED' : 'PENDING';
    return prisma_1.prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.create({
            data: {
                restaurantId,
                guestId: input.guestId ?? null,
                tableId: input.tableId ?? null,
                partySize: input.partySize,
                date,
                time: input.time,
                duration,
                status,
                source: input.source,
                guestName: input.guestName,
                guestPhone: input.guestPhone ?? null,
                guestEmail: input.guestEmail ?? null,
                occasion: input.occasion ?? null,
                guestNotes: input.guestNotes ?? null,
                hostNotes: input.hostNotes ?? null,
                tags: input.tags,
                depositRequired: input.depositRequired,
                depositAmountCents: input.depositAmountCents ?? null,
                confirmedAt: status === 'CONFIRMED' ? new Date() : null,
            },
            include: { table: true, guest: true },
        });
        await logActivity(tx, reservation.id, 'CREATED', actorName, {
            toStatus: status,
            partySize: input.partySize,
            date: input.date,
            time: input.time,
            source: input.source,
            guestName: input.guestName,
            tableId: input.tableId ?? null,
            occasion: input.occasion ?? null,
        });
        if (input.guestId) {
            await tx.guest.update({
                where: { id: input.guestId },
                data: { visitCount: { increment: 1 } },
            });
        }
        return reservation;
    });
}
// ─── Update ──────────────────────────────────────────────────────────────────
async function updateReservation(restaurantId, id, input, actorName) {
    const existing = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(existing.status)) {
        throw new errors_1.BusinessRuleError(`Cannot modify a ${existing.status} reservation`);
    }
    const settings = await getRestaurantSettings(restaurantId);
    const date = input.date ? parseDateArg(input.date) : existing.date;
    const time = input.time ?? existing.time;
    const duration = input.duration ?? existing.duration;
    const tableId = input.tableId !== undefined ? input.tableId : existing.tableId;
    if (tableId && (input.date || input.time || input.duration || input.tableId)) {
        await validateTableAssignment(restaurantId, tableId, date, time, duration, settings.bufferBetweenTurnsMinutes, input.partySize ?? existing.partySize, id);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: {
                ...(input.guestName && { guestName: input.guestName }),
                ...(input.guestPhone !== undefined && { guestPhone: input.guestPhone }),
                ...(input.guestEmail !== undefined && { guestEmail: input.guestEmail }),
                ...(input.partySize && { partySize: input.partySize }),
                ...(input.date && { date }),
                ...(input.time && { time }),
                ...(input.duration && { duration }),
                ...(input.occasion !== undefined && { occasion: input.occasion }),
                ...(input.guestNotes !== undefined && { guestNotes: input.guestNotes }),
                ...(input.hostNotes !== undefined && { hostNotes: input.hostNotes }),
                ...(input.tableId !== undefined && { tableId: input.tableId }),
                ...(input.tags && { tags: input.tags }),
            },
            include: { table: true, guest: true },
        });
        await logActivity(tx, id, 'UPDATED', actorName, {
            fromStatus: existing.status,
            toStatus: existing.status,
            tableId: existing.tableId ?? null,
        });
        return updated;
    });
}
// ─── Status Transitions ──────────────────────────────────────────────────────
async function confirmReservation(restaurantId, id, actorName) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (r.status !== 'PENDING') {
        throw new errors_1.BusinessRuleError(`Cannot confirm a reservation with status ${r.status}`);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        await logActivity(tx, id, 'CONFIRMED', actorName, {
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            tableId: r.tableId ?? null,
        });
        return updated;
    });
}
async function seatReservation(restaurantId, id, tableId, actorName, overrideConflicts = false) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (!['CONFIRMED', 'PENDING'].includes(r.status)) {
        throw new errors_1.BusinessRuleError(`Cannot seat a reservation with status ${r.status}`);
    }
    const settings = await getRestaurantSettings(restaurantId);
    if (!overrideConflicts) {
        await validateTableAssignment(restaurantId, tableId, r.date, r.time, r.duration, settings.bufferBetweenTurnsMinutes, r.partySize, id);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: {
                status: 'SEATED',
                tableId,
                seatedAt: new Date(),
                confirmedAt: r.confirmedAt ?? new Date(),
            },
            include: { table: true },
        });
        await logActivity(tx, id, 'SEATED', actorName, {
            fromStatus: r.status,
            toStatus: 'SEATED',
            tableId,
        });
        return updated;
    });
}
async function moveReservation(restaurantId, id, input, actorName) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (r.status !== 'SEATED') {
        throw new errors_1.BusinessRuleError('Can only move a reservation that is currently seated');
    }
    const settings = await getRestaurantSettings(restaurantId);
    if (!input.overrideConflicts) {
        await validateTableAssignment(restaurantId, input.tableId, r.date, r.time, r.duration, settings.bufferBetweenTurnsMinutes, r.partySize, id);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: {
                tableId: input.tableId,
                previousTableId: r.tableId,
            },
            include: { table: true },
        });
        await logActivity(tx, id, 'MOVED', actorName, {
            fromStatus: 'SEATED',
            toStatus: 'SEATED',
            fromTableId: r.tableId ?? null,
            toTableId: input.tableId,
            reason: input.reason ?? null,
        });
        return updated;
    });
}
async function completeReservation(restaurantId, id, actorName) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (r.status !== 'SEATED') {
        throw new errors_1.BusinessRuleError(`Cannot complete a reservation with status ${r.status}`);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await logActivity(tx, id, 'COMPLETED', actorName, {
            fromStatus: 'SEATED',
            toStatus: 'COMPLETED',
            tableId: r.tableId ?? null,
            seatedAt: r.seatedAt ? r.seatedAt.toISOString() : null,
        });
        if (r.guestId) {
            await tx.guest.update({
                where: { id: r.guestId },
                data: { lastVisitAt: new Date() },
            });
        }
        return updated;
    });
}
async function markNoShow(restaurantId, id, actorName) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (!['CONFIRMED', 'PENDING'].includes(r.status)) {
        throw new errors_1.BusinessRuleError(`Cannot mark no-show for a reservation with status ${r.status}`);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: { status: 'NO_SHOW', noShowAt: new Date() },
        });
        await logActivity(tx, id, 'NO_SHOW', actorName, {
            fromStatus: r.status,
            toStatus: 'NO_SHOW',
            tableId: r.tableId ?? null,
        });
        if (r.guestId) {
            await tx.guest.update({
                where: { id: r.guestId },
                data: { noShowCount: { increment: 1 } },
            });
        }
        return updated;
    });
}
async function cancelReservation(restaurantId, id, reason, actorName) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(r.status)) {
        throw new errors_1.BusinessRuleError(`Reservation is already ${r.status}`);
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.reservation.update({
            where: { id },
            data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        await logActivity(tx, id, 'CANCELLED', actorName, {
            fromStatus: r.status,
            toStatus: 'CANCELLED',
            tableId: r.tableId ?? null,
            reason: reason ?? null,
        });
        if (r.guestId) {
            await tx.guest.update({
                where: { id: r.guestId },
                data: { cancelCount: { increment: 1 } },
            });
        }
        return updated;
    });
}
// ─── Undo ─────────────────────────────────────────────────────────────────────
const UNDOABLE_ACTIONS = ['CONFIRMED', 'NO_SHOW', 'CANCELLED', 'SEATED', 'COMPLETED', 'MOVED'];
function detailsStr(details, key) {
    const v = details[key];
    return typeof v === 'string' ? v : null;
}
async function undoReservation(restaurantId, id, actorName) {
    const r = await assertReservationBelongsToRestaurant(id, restaurantId);
    const lastActivity = await prisma_1.prisma.reservationActivity.findFirst({
        where: { reservationId: id, action: { in: [...UNDOABLE_ACTIONS] } },
        orderBy: { timestamp: 'desc' },
    });
    if (!lastActivity) {
        throw new errors_1.BusinessRuleError('No undoable action found for this reservation');
    }
    const action = lastActivity.action;
    const details = (lastActivity.details ?? {});
    return prisma_1.prisma.$transaction(async (tx) => {
        let updateData;
        let toStatus = r.status;
        switch (action) {
            case 'CONFIRMED':
                toStatus = 'PENDING';
                updateData = { status: 'PENDING', confirmedAt: null };
                break;
            case 'NO_SHOW':
                toStatus = detailsStr(details, 'fromStatus') ?? 'PENDING';
                updateData = { status: toStatus, noShowAt: null };
                if (r.guestId) {
                    await tx.guest.update({
                        where: { id: r.guestId },
                        data: { noShowCount: { decrement: 1 } },
                    });
                }
                break;
            case 'CANCELLED':
                toStatus = detailsStr(details, 'fromStatus') ?? 'PENDING';
                updateData = { status: toStatus, cancelledAt: null };
                if (r.guestId) {
                    await tx.guest.update({
                        where: { id: r.guestId },
                        data: { cancelCount: { decrement: 1 } },
                    });
                }
                break;
            case 'SEATED':
                toStatus = detailsStr(details, 'fromStatus') ?? 'CONFIRMED';
                updateData = { status: toStatus, seatedAt: null, tableId: null };
                break;
            case 'COMPLETED':
                toStatus = detailsStr(details, 'fromStatus') ?? 'SEATED';
                updateData = { status: toStatus, completedAt: null };
                break;
            case 'MOVED':
                updateData = {
                    tableId: detailsStr(details, 'fromTableId'),
                    previousTableId: null,
                };
                break;
        }
        const updated = await tx.reservation.update({
            where: { id },
            data: updateData,
            include: { table: true, guest: true },
        });
        await logActivity(tx, id, 'UNDO', actorName, {
            undoneAction: action,
            undoneActivityId: lastActivity.id,
            fromStatus: r.status,
            toStatus,
        });
        return updated;
    });
}
// ─── Table Assignment Validation ─────────────────────────────────────────────
async function validateTableAssignment(restaurantId, tableId, date, time, duration, bufferMinutes, partySize, excludeReservationId) {
    const table = await prisma_1.prisma.table.findUnique({ where: { id: tableId } });
    if (!table || table.restaurantId !== restaurantId) {
        throw new errors_1.NotFoundError('Table', tableId);
    }
    if (!table.isActive) {
        throw new errors_1.BusinessRuleError(`Table ${table.name} is inactive`);
    }
    if (table.minCovers > partySize) {
        throw new errors_1.BusinessRuleError(`Table ${table.name} minimum is ${table.minCovers} covers, party size is ${partySize}`);
    }
    if (table.maxCovers < partySize) {
        throw new errors_1.BusinessRuleError(`Table ${table.name} maximum is ${table.maxCovers} covers, party size is ${partySize}`);
    }
    const availability = await (0, availability_1.getTableAvailability)(restaurantId, date, time, duration, bufferMinutes);
    const tableAvail = availability.find((a) => a.tableId === tableId);
    if (!tableAvail?.isAvailable) {
        if (tableAvail?.conflictingReservationId &&
            tableAvail.conflictingReservationId === excludeReservationId) {
            return;
        }
        if (tableAvail?.blockedBy) {
            throw new errors_1.ConflictError(`Table ${table.name} is blocked: ${tableAvail.blockedBy}`);
        }
        throw new errors_1.ConflictError(`Table ${table.name} is not available at that time`, {
            conflictingReservationId: tableAvail?.conflictingReservationId,
            nextAvailableAt: tableAvail?.nextAvailableAt,
        });
    }
}
//# sourceMappingURL=service.js.map