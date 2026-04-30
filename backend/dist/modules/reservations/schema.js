"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListReservationsQuerySchema = exports.MoveTableSchema = exports.AssignTableSchema = exports.UpdateReservationSchema = exports.CreateReservationSchema = void 0;
const zod_1 = require("zod");
const TimeString = zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:mm');
const DateString = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
exports.CreateReservationSchema = zod_1.z.object({
    guestName: zod_1.z.string().min(1).max(100),
    guestPhone: zod_1.z.string().optional(),
    guestEmail: zod_1.z.string().email().optional(),
    guestId: zod_1.z.string().uuid().optional(), // link to existing guest record
    partySize: zod_1.z.number().int().min(1).max(30),
    date: DateString,
    time: TimeString,
    duration: zod_1.z.number().int().min(30).max(480).optional(), // override in minutes
    occasion: zod_1.z.string().optional(),
    guestNotes: zod_1.z.string().max(1000).optional(),
    hostNotes: zod_1.z.string().max(1000).optional(),
    tableId: zod_1.z.string().uuid().optional(), // optionally assign table at creation
    source: zod_1.z
        .enum(['ONLINE', 'PHONE', 'WALK_IN', 'OPENTABLE', 'RESY', 'INTERNAL'])
        .default('PHONE'),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    depositRequired: zod_1.z.boolean().default(false),
    depositAmountCents: zod_1.z.number().int().optional(),
});
exports.UpdateReservationSchema = zod_1.z.object({
    guestName: zod_1.z.string().min(1).max(100).optional(),
    guestPhone: zod_1.z.string().optional(),
    guestEmail: zod_1.z.string().email().optional(),
    partySize: zod_1.z.number().int().min(1).max(30).optional(),
    date: DateString.optional(),
    time: TimeString.optional(),
    duration: zod_1.z.number().int().min(30).max(480).optional(),
    occasion: zod_1.z.string().optional(),
    guestNotes: zod_1.z.string().max(1000).optional(),
    hostNotes: zod_1.z.string().max(1000).optional(),
    tableId: zod_1.z.string().uuid().nullable().optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.AssignTableSchema = zod_1.z.object({
    tableId: zod_1.z.string().uuid(),
    overrideConflicts: zod_1.z.boolean().default(false), // host can force-assign
});
exports.MoveTableSchema = zod_1.z.object({
    tableId: zod_1.z.string().uuid(),
    reason: zod_1.z.string().optional(),
    overrideConflicts: zod_1.z.boolean().default(false),
});
exports.ListReservationsQuerySchema = zod_1.z.object({
    date: DateString.optional(),
    dateFrom: DateString.optional(),
    dateTo: DateString.optional(),
    status: zod_1.z
        .enum(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
        .optional(),
    guestId: zod_1.z.string().uuid().optional(),
    tableId: zod_1.z.string().uuid().optional(),
    search: zod_1.z.string().optional(), // search by guest name/phone
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(500).default(50),
});
//# sourceMappingURL=schema.js.map