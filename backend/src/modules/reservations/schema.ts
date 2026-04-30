import { z } from 'zod';

const TimeString = z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:mm');
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const CreateReservationSchema = z.object({
  guestName: z.string().min(1).max(100),
  guestPhone: z.string().optional(),
  guestEmail: z.string().email().optional(),
  guestId: z.string().uuid().optional(), // link to existing guest record
  partySize: z.number().int().min(1).max(30),
  date: DateString,
  time: TimeString,
  duration: z.number().int().min(30).max(480).optional(), // override in minutes
  occasion: z.string().optional(),
  guestNotes: z.string().max(1000).optional(),
  hostNotes: z.string().max(1000).optional(),
  tableId: z.string().uuid().optional(), // optionally assign table at creation
  source: z
    .enum(['ONLINE', 'PHONE', 'WALK_IN', 'OPENTABLE', 'RESY', 'INTERNAL'])
    .default('PHONE'),
  tags: z.array(z.string()).default([]),
  depositRequired: z.boolean().default(false),
  depositAmountCents: z.number().int().optional(),
});

export const UpdateReservationSchema = z.object({
  guestName: z.string().min(1).max(100).optional(),
  guestPhone: z.string().optional(),
  guestEmail: z.string().email().optional(),
  partySize: z.number().int().min(1).max(30).optional(),
  date: DateString.optional(),
  time: TimeString.optional(),
  duration: z.number().int().min(30).max(480).optional(),
  occasion: z.string().optional(),
  guestNotes: z.string().max(1000).optional(),
  hostNotes: z.string().max(1000).optional(),
  tableId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export const AssignTableSchema = z.object({
  tableId: z.string().uuid(),
  overrideConflicts: z.boolean().default(false), // host can force-assign
});

export const MoveTableSchema = z.object({
  tableId: z.string().uuid(),
  reason: z.string().optional(),
  overrideConflicts: z.boolean().default(false),
});

export const ListReservationsQuerySchema = z.object({
  date: DateString.optional(),
  dateFrom: DateString.optional(),
  dateTo: DateString.optional(),
  status: z
    .enum(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
  guestId: z.string().uuid().optional(),
  tableId: z.string().uuid().optional(),
  search: z.string().optional(), // search by guest name/phone
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export type UpdateReservationInput = z.infer<typeof UpdateReservationSchema>;
export type AssignTableInput = z.infer<typeof AssignTableSchema>;
export type MoveTableInput = z.infer<typeof MoveTableSchema>;
export type ListReservationsQuery = z.infer<typeof ListReservationsQuerySchema>;
