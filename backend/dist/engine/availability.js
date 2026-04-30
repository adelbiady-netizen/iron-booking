"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTableAvailability = getTableAvailability;
exports.getAvailableSlots = getAvailableSlots;
exports.parseTimeOnDate = parseTimeOnDate;
exports.formatTime = formatTime;
exports.minutesBetween = minutesBetween;
const prisma_1 = require("../lib/prisma");
const date_fns_1 = require("date-fns");
const OCCUPIED_STATUSES = ['CONFIRMED', 'SEATED', 'PENDING'];
/**
 * Given a date, time string ("HH:mm"), and duration (minutes),
 * compute which tables are available for that slot.
 */
async function getTableAvailability(restaurantId, date, timeStr, durationMinutes, bufferMinutes) {
    const slotStart = parseTimeOnDate(date, timeStr);
    const slotEnd = (0, date_fns_1.addMinutes)(slotStart, durationMinutes);
    // Buffer is added to both ends to account for setup/teardown
    const effectiveStart = (0, date_fns_1.addMinutes)(slotStart, -bufferMinutes);
    const effectiveEnd = (0, date_fns_1.addMinutes)(slotEnd, bufferMinutes);
    const requestedSlot = { start: effectiveStart, end: effectiveEnd };
    // Pull all tables, reservations, and blocks for this date in one pass
    const [tables, reservations, blocks] = await Promise.all([
        prisma_1.prisma.table.findMany({
            where: { restaurantId, isActive: true },
        }),
        prisma_1.prisma.reservation.findMany({
            where: {
                restaurantId,
                date,
                status: { in: OCCUPIED_STATUSES },
                tableId: { not: null },
            },
            select: {
                id: true,
                tableId: true,
                time: true,
                duration: true,
                status: true,
            },
        }),
        prisma_1.prisma.blockedPeriod.findMany({
            where: {
                restaurantId,
                startTime: { lt: effectiveEnd },
                endTime: { gt: effectiveStart },
            },
        }),
    ]);
    return tables.map((table) => {
        // Check blocked periods first
        const block = blocks.find((b) => b.tableId === table.id || b.tableId === null);
        if (block) {
            return {
                tableId: table.id,
                isAvailable: false,
                blockedBy: block.reason,
            };
        }
        // Check reservation conflicts
        const conflict = reservations.find((r) => {
            if (r.tableId !== table.id)
                return false;
            const rStart = parseTimeOnDate(date, r.time);
            const rEnd = (0, date_fns_1.addMinutes)(rStart, r.duration + bufferMinutes);
            return (0, date_fns_1.areIntervalsOverlapping)(requestedSlot, { start: rStart, end: rEnd });
        });
        if (conflict) {
            const cStart = parseTimeOnDate(date, conflict.time);
            return {
                tableId: table.id,
                isAvailable: false,
                conflictingReservationId: conflict.id,
                nextAvailableAt: (0, date_fns_1.addMinutes)(cStart, durationMinutes + bufferMinutes),
            };
        }
        return { tableId: table.id, isAvailable: true };
    });
}
/**
 * Get all available slots for a given party size across a full day.
 * Used for online booking widget.
 */
async function getAvailableSlots(restaurantId, date, partySize, intervalMinutes, openTime, lastSeating, durationMinutes, bufferMinutes) {
    const slots = [];
    let cursor = parseTimeOnDate(date, openTime);
    const cutoff = parseTimeOnDate(date, lastSeating);
    while (cursor <= cutoff) {
        const timeStr = formatTime(cursor);
        const availability = await getTableAvailability(restaurantId, date, timeStr, durationMinutes, bufferMinutes);
        const hasCapableTable = availability.some((a) => a.isAvailable);
        if (hasCapableTable)
            slots.push(timeStr);
        cursor = (0, date_fns_1.addMinutes)(cursor, intervalMinutes);
    }
    return slots;
}
function parseTimeOnDate(date, timeStr) {
    // date is always created as UTC midnight (e.g. new Date('YYYY-MM-DDT00:00:00.000Z')).
    // Extract the UTC calendar date so we get the right day regardless of local timezone,
    // then build a local-time string (no Z) to match seatedAt/confirmedAt timestamps.
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return new Date(`${yyyy}-${mm}-${dd}T${timeStr}:00`);
}
function formatTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function minutesBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 60000);
}
//# sourceMappingURL=availability.js.map