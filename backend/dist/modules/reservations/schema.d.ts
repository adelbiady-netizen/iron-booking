import { z } from 'zod';
export declare const CreateReservationSchema: z.ZodObject<{
    guestName: z.ZodString;
    guestPhone: z.ZodOptional<z.ZodString>;
    guestEmail: z.ZodOptional<z.ZodString>;
    guestId: z.ZodOptional<z.ZodString>;
    partySize: z.ZodNumber;
    date: z.ZodString;
    time: z.ZodString;
    duration: z.ZodOptional<z.ZodNumber>;
    occasion: z.ZodOptional<z.ZodString>;
    guestNotes: z.ZodOptional<z.ZodString>;
    hostNotes: z.ZodOptional<z.ZodString>;
    tableId: z.ZodOptional<z.ZodString>;
    source: z.ZodDefault<z.ZodEnum<{
        ONLINE: "ONLINE";
        PHONE: "PHONE";
        WALK_IN: "WALK_IN";
        OPENTABLE: "OPENTABLE";
        RESY: "RESY";
        INTERNAL: "INTERNAL";
    }>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    depositRequired: z.ZodDefault<z.ZodBoolean>;
    depositAmountCents: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const UpdateReservationSchema: z.ZodObject<{
    guestName: z.ZodOptional<z.ZodString>;
    guestPhone: z.ZodOptional<z.ZodString>;
    guestEmail: z.ZodOptional<z.ZodString>;
    partySize: z.ZodOptional<z.ZodNumber>;
    date: z.ZodOptional<z.ZodString>;
    time: z.ZodOptional<z.ZodString>;
    duration: z.ZodOptional<z.ZodNumber>;
    occasion: z.ZodOptional<z.ZodString>;
    guestNotes: z.ZodOptional<z.ZodString>;
    hostNotes: z.ZodOptional<z.ZodString>;
    tableId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const AssignTableSchema: z.ZodObject<{
    tableId: z.ZodString;
    overrideConflicts: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const MoveTableSchema: z.ZodObject<{
    tableId: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
    overrideConflicts: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ListReservationsQuerySchema: z.ZodObject<{
    date: z.ZodOptional<z.ZodString>;
    dateFrom: z.ZodOptional<z.ZodString>;
    dateTo: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        PENDING: "PENDING";
        CONFIRMED: "CONFIRMED";
        SEATED: "SEATED";
        COMPLETED: "COMPLETED";
        CANCELLED: "CANCELLED";
        NO_SHOW: "NO_SHOW";
    }>>;
    guestId: z.ZodOptional<z.ZodString>;
    tableId: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export type UpdateReservationInput = z.infer<typeof UpdateReservationSchema>;
export type AssignTableInput = z.infer<typeof AssignTableSchema>;
export type MoveTableInput = z.infer<typeof MoveTableSchema>;
export type ListReservationsQuery = z.infer<typeof ListReservationsQuerySchema>;
//# sourceMappingURL=schema.d.ts.map