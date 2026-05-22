import { prisma } from '../../lib/prisma';
import { Reservation, ReservationStatus, Prisma } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from '../../lib/errors';
import { getTableAvailability } from '../../engine/availability';
import {
  CreateReservationInput,
  UpdateReservationInput,
  AssignTableInput,
  MoveTableInput,
  ListReservationsQuery,
} from './schema';
import { findOrCreateGuest, splitName } from '../guests/service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getRestaurantSettings(restaurantId: string) {
  const r = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { settings: true, timezone: true },
  });
  const s = r.settings as Record<string, any>;
  return {
    timezone: r.timezone,
    defaultTurnMinutes: (s.defaultTurnMinutes as number) ?? 90,
    bufferBetweenTurnsMinutes: (s.bufferBetweenTurnsMinutes as number) ?? 15,
    autoConfirm: (s.autoConfirm as boolean) ?? false,
  };
}

function parseDateArg(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  if (isNaN(d.getTime())) throw new ValidationError(`Invalid date: ${dateStr}`);
  return d;
}

async function assertReservationBelongsToRestaurant(
  id: string,
  restaurantId: string
): Promise<Reservation> {
  const r = await prisma.reservation.findUnique({ where: { id } });
  if (!r) throw new NotFoundError('Reservation', id);
  if (r.restaurantId !== restaurantId) throw new NotFoundError('Reservation', id);
  return r;
}

type ActivityDetails = Record<string, unknown>;

// Two-step write: ORM create (without details) + raw UPDATE with ::jsonb cast.
// The Prisma 7 pg adapter does not correctly serialize plain objects for Json? fields.
async function logActivity(
  tx: Prisma.TransactionClient,
  reservationId: string,
  action: string,
  actor: string,
  details: ActivityDetails
): Promise<void> {
  const record = await tx.reservationActivity.create({
    data: { reservationId, action, actor },
    select: { id: true },
  });
  await tx.$executeRaw`
    UPDATE reservation_activity
    SET details = ${JSON.stringify(details)}::jsonb
    WHERE id = ${record.id}
  `;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listReservations(restaurantId: string, query: ListReservationsQuery) {
  const {
    date, dateFrom, dateTo, status, guestId, tableId, search, page, limit,
  } = query;

  const where: Prisma.ReservationWhereInput = { restaurantId };

  if (date) where.date = parseDateArg(date);
  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: parseDateArg(dateFrom) } : {}),
      ...(dateTo ? { lte: parseDateArg(dateTo) } : {}),
    };
  }
  if (status) where.status = status;
  if (guestId) where.guestId = guestId;
  if (tableId) where.tableId = tableId;
  if (search) {
    where.OR = [
      { guestName: { contains: search, mode: 'insensitive' } },
      { guestPhone: { contains: search } },
      { guestEmail: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [total, reservations] = await Promise.all([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
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

export async function getReservation(restaurantId: string, id: string) {
  const r = await prisma.reservation.findUnique({
    where: { id },
    include: {
      table: { include: { section: true } },
      guest: true,
      activityLog: { orderBy: { timestamp: 'desc' }, take: 50 },
    },
  });
  if (!r || r.restaurantId !== restaurantId) throw new NotFoundError('Reservation', id);
  return r;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export async function getReservationTimeline(restaurantId: string, id: string) {
  const r = await prisma.reservation.findUnique({
    where: { id },
    select: { id: true, restaurantId: true, guestName: true, status: true, date: true, time: true },
  });
  if (!r || r.restaurantId !== restaurantId) throw new NotFoundError('Reservation', id);

  const activities = await prisma.reservationActivity.findMany({
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

export async function createReservation(
  restaurantId: string,
  input: CreateReservationInput,
  actorName: string
) {
  const settings = await getRestaurantSettings(restaurantId);
  const duration = input.duration ?? (input.partySize >= 3 ? 120 : 90);
  const date = parseDateArg(input.date);

  if (input.tableId) {
    await validateTableAssignment(
      restaurantId,
      input.tableId,
      date,
      input.time,
      duration,
      settings.bufferBetweenTurnsMinutes,
      input.partySize,
      [],
      input.combinedTableIds
    );
  }

  const status: ReservationStatus = settings.autoConfirm ? 'CONFIRMED' : 'PENDING';

  // Auto-link Guest CRM record when phone or email is present and no explicit guestId provided
  let resolvedGuestId = input.guestId ?? null;
  if (!resolvedGuestId && (input.guestPhone || input.guestEmail)) {
    try {
      const { firstName, lastName } = splitName(input.guestName);
      const { guest } = await findOrCreateGuest(restaurantId, {
        firstName,
        lastName,
        email: input.guestEmail,
        phone: input.guestPhone,
      });
      resolvedGuestId = guest.id;
    } catch {
      // Non-fatal: reservation proceeds without a guest link
    }
  }

  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.create({
      data: {
        restaurantId,
        guestId: resolvedGuestId,
        tableId: input.tableId ?? null,
        combinedTableIds: input.combinedTableIds ?? [],
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
        guestLang: input.lang ?? null,
        tags: input.tags,
        depositRequired: input.depositRequired,
        depositAmountCents: input.depositAmountCents ?? null,
        confirmedAt: status === 'CONFIRMED' ? new Date() : null,
        createdByName: actorName,
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

    if (resolvedGuestId) {
      await tx.guest.update({
        where: { id: resolvedGuestId },
        data: { visitCount: { increment: 1 } },
      });
    }

    return reservation;
  });
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateReservation(
  restaurantId: string,
  id: string,
  input: UpdateReservationInput,
  actorName: string
) {
  const existing = await assertReservationBelongsToRestaurant(id, restaurantId);

  if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(existing.status)) {
    throw new BusinessRuleError(`Cannot modify a ${existing.status} reservation`);
  }

  // SEATED guests: date, time, and table are locked; operational fields (party size, notes, duration) remain editable
  if (existing.status === 'SEATED' && (
    input.date || input.time ||
    input.tableId !== undefined || input.combinedTableIds !== undefined
  )) {
    throw new BusinessRuleError('Cannot change date, time, or table for a seated reservation');
  }

  const settings = await getRestaurantSettings(restaurantId);
  const date = input.date ? parseDateArg(input.date) : existing.date;
  const time = input.time ?? existing.time;
  const duration = input.duration ?? (
    input.partySize && input.partySize !== existing.partySize
      ? (input.partySize >= 3 ? 120 : 90)
      : existing.duration
  );
  const tableId = input.tableId !== undefined ? input.tableId : existing.tableId;
  const combinedTableIds = input.combinedTableIds !== undefined ? input.combinedTableIds : existing.combinedTableIds;

  if (tableId && (input.date || input.time || input.duration || input.tableId !== undefined || input.combinedTableIds !== undefined)) {
    if (!input.overrideConflicts) {
      try {
        await validateTableAssignment(
          restaurantId,
          tableId,
          date,
          time,
          duration,
          settings.bufferBetweenTurnsMinutes,
          input.partySize ?? existing.partySize,
          [id],
          combinedTableIds
        );
      } catch (err) {
        if (err instanceof ConflictError) {
          const det = (err as ConflictError).details as { conflictingReservationId?: string } | null;
          if (det?.conflictingReservationId) {
            const conflictRes = await prisma.reservation.findUnique({
              where: { id: det.conflictingReservationId },
              select: { id: true, guestName: true, time: true, partySize: true },
            });
            if (conflictRes) {
              const [resH, resM] = time.split(':').map(Number);
              const [fH, fM]     = conflictRes.time.split(':').map(Number);
              throw new ConflictError('This table has upcoming reservations', {
                code: 'TABLE_HAS_FUTURE_RESERVATIONS',
                conflicts: [{
                  id:           conflictRes.id,
                  guestName:    conflictRes.guestName,
                  time:         conflictRes.time,
                  partySize:    conflictRes.partySize,
                  minutesUntil: (fH * 60 + fM) - (resH * 60 + resM),
                }],
              });
            }
          }
        }
        throw err;
      }
    }
  }

  // Build a before/after diff for the audit trail
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (input.guestName && input.guestName !== existing.guestName)
    changes.guestName = { from: existing.guestName, to: input.guestName };
  if (input.guestPhone !== undefined && input.guestPhone !== existing.guestPhone)
    changes.guestPhone = { from: existing.guestPhone, to: input.guestPhone };
  if (input.partySize && input.partySize !== existing.partySize)
    changes.partySize = { from: existing.partySize, to: input.partySize };
  if (input.date && input.date !== existing.date.toISOString().split('T')[0])
    changes.date = { from: existing.date.toISOString().split('T')[0], to: input.date };
  if (input.time && input.time !== existing.time)
    changes.time = { from: existing.time, to: input.time };
  if (input.duration && input.duration !== existing.duration)
    changes.duration = { from: existing.duration, to: input.duration };
  if (input.guestNotes !== undefined && input.guestNotes !== existing.guestNotes)
    changes.guestNotes = { from: existing.guestNotes, to: input.guestNotes };
  if (input.hostNotes !== undefined && input.hostNotes !== existing.hostNotes)
    changes.hostNotes = { from: existing.hostNotes, to: input.hostNotes };

  const resolvingReorganize = !!existing.reorganizeAt && !!input.tableId;

  return prisma.$transaction(async (tx) => {
    // Displace host-selected conflicting reservations to the reorganize queue.
    // Validates membership: only displaces reservations that actually belong to
    // this restaurant, are on the same table, date, and are still seateable.
    if (input.reorganizeIds.length > 0 && tableId) {
      const toDisplace = await tx.reservation.findMany({
        where: {
          id:           { in: input.reorganizeIds },
          restaurantId,
          tableId,
          date,
          status:       { in: ['CONFIRMED', 'PENDING'] },
        },
        select: { id: true, guestName: true },
      });
      for (const displaced of toDisplace) {
        await tx.reservation.update({
          where: { id: displaced.id },
          data: {
            tableId:               null,
            combinedTableIds:      [],
            reorganizeAt:          new Date(),
            reorganizeFromTableId: tableId,
            reorganizeBySeatingId: id,
            reorganizedByName:     actorName,
          },
        });
        await logActivity(tx, displaced.id, 'REORGANIZE_TRIGGERED', actorName, {
          displacedFrom: tableId,
          byReservation: id,
          byGuestName:   existing.guestName,
        });
      }
    }

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
        ...(input.combinedTableIds !== undefined && { combinedTableIds: input.combinedTableIds }),
        ...(input.tags && { tags: input.tags }),
        // Assigning a table to a reorganized reservation resolves it
        ...(resolvingReorganize && { reorganizeAt: null }),
        updatedByName: actorName,
      },
      include: { table: true, guest: true },
    });

    await logActivity(tx, id, 'UPDATED', actorName, {
      fromStatus: existing.status,
      toStatus:   existing.status,
      tableId:    existing.tableId ?? null,
      changes,
    });

    // Separate table-change audit so it appears as a distinct timeline event
    if (input.tableId !== undefined && input.tableId !== existing.tableId) {
      const tableAction = existing.tableId ? 'TABLE_MOVED' : 'TABLE_ASSIGNED';
      await logActivity(tx, id, tableAction, actorName, {
        fromTableId: existing.tableId ?? null,
        toTableId:   input.tableId,
      });
    }

    if (resolvingReorganize) {
      await logActivity(tx, id, 'REORGANIZE_RESOLVED', actorName, {
        assignedTableId: input.tableId,
        previouslyFrom: existing.reorganizeFromTableId ?? null,
      });
    }

    return updated;
  });
}

// ─── Status Transitions ──────────────────────────────────────────────────────

export async function confirmReservation(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (r.status !== 'PENDING') {
    throw new BusinessRuleError(`Cannot confirm a reservation with status ${r.status}`);
  }
  return prisma.$transaction(async (tx) => {
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

export async function seatReservation(
  restaurantId: string,
  id: string,
  tableId: string,
  actorName: string,
  overrideConflicts = false,
  combinedTableIds?: string[],
  reorganizeIds: string[] = []
) {
  const t0 = Date.now();
  const [r, settings] = await Promise.all([
    assertReservationBelongsToRestaurant(id, restaurantId),
    getRestaurantSettings(restaurantId),
  ]);
  console.log(`[perf:seat] init queries ${Date.now() - t0}ms`);

  if (!['CONFIRMED', 'PENDING'].includes(r.status)) {
    throw new BusinessRuleError(`Cannot seat a reservation with status ${r.status}`);
  }

  // Seating is only allowed on the reservation's own service date.
  // Use the restaurant's configured timezone so late-night service (past UTC midnight)
  // in UTC+ restaurants doesn't block valid same-day seats.
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date());
  const resDate = r.date instanceof Date
    ? r.date.toISOString().slice(0, 10)
    : String(r.date).slice(0, 10);
  if (resDate !== todayLocal) {
    throw new BusinessRuleError(
      'This reservation belongs to another service date and cannot be seated today.'
    );
  }
  // Never fall back to the DB's existing combinedTableIds — doing so would
  // preserve stale IDs from a previous combined-table seat and cause ghost
  // occupancy on unrelated tables.  Always use what the caller provides,
  // defaulting to [] (single-table seat) when the argument is omitted.
  const resolvedCombinedIds = combinedTableIds ?? [];

  // Current time in the restaurant's local timezone — used for both the
  // near-term reorganize check and the availability validation below.
  // Seating is a live operation: availability must be anchored to NOW, not to
  // the reservation's original scheduled time, so both checks see the same state
  // as the floor board (which also uses current time as its anchor).
  const nowTimeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [nowH, nowM] = nowTimeStr.split(':').map(Number);
  const nowMins = nowH * 60 + nowM;

  // Check for near-term reservations on the target table. Only flag reservations
  // within the effective validator window (defaultTurnMinutes + buffer) from
  // now — matches the board visibility threshold (reservationIsUpcoming forward cap)
  // so a table shown AVAILABLE always passes this check and vice versa.
  // Skip this check when the caller has already selected IDs to reorganize,
  // or when the host has explicitly acknowledged the conflict (overrideConflicts=true).
  if (reorganizeIds.length === 0 && !overrideConflicts) {
    const todayDateObj = parseDateArg(todayLocal);
    const windowEndMins = nowMins + settings.defaultTurnMinutes + settings.bufferBetweenTurnsMinutes;

    const allOnTable = await prisma.reservation.findMany({
      where: {
        restaurantId,
        date: todayDateObj,
        tableId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        id: { not: id },
      },
      select: { id: true, guestName: true, time: true, partySize: true },
      orderBy: { time: 'asc' },
    });

    const withinWindow = allOnTable.filter(f => {
      const [fH, fM] = f.time.split(':').map(Number);
      const resMins = fH * 60 + fM;
      return resMins > nowMins && resMins <= windowEndMins;
    });

    if (withinWindow.length > 0) {
      const conflicts = withinWindow.map(f => {
        const [fH, fM] = f.time.split(':').map(Number);
        return {
          id: f.id,
          guestName: f.guestName,
          time: f.time,
          partySize: f.partySize,
          minutesUntil: (fH * 60 + fM) - nowMins,
        };
      });
      throw new ConflictError('This table has upcoming reservations', {
        code: 'TABLE_HAS_FUTURE_RESERVATIONS',
        conflicts,
      });
    }
  }

  if (!overrideConflicts) {
    // Use nowTimeStr (current restaurant-local time) instead of r.time so the
    // conflict check matches what the floor board already shows.
    // When validateTableAssignment detects a conflict it means the incoming
    // reservation's duration would physically overlap a future booking on this
    // table (e.g. r.duration > defaultTurnMinutes). Surface this as an
    // overrideable TABLE_HAS_FUTURE_RESERVATIONS rather than a hard block so
    // the host gets the ReorganizeConflictModal and can choose to proceed.
    try {
      await validateTableAssignment(
        restaurantId,
        tableId,
        r.date,
        nowTimeStr,
        r.duration,
        settings.bufferBetweenTurnsMinutes,
        r.partySize,
        [id],
        resolvedCombinedIds
      );
    } catch (err) {
      if (err instanceof ConflictError) {
        const det = (err as ConflictError).details as { conflictingReservationId?: string } | null;
        if (det?.conflictingReservationId) {
          const conflictRes = await prisma.reservation.findUnique({
            where: { id: det.conflictingReservationId },
            select: { id: true, guestName: true, time: true, partySize: true },
          });
          if (conflictRes) {
            const [fH, fM] = conflictRes.time.split(':').map(Number);
            throw new ConflictError('This table has upcoming reservations', {
              code: 'TABLE_HAS_FUTURE_RESERVATIONS',
              conflicts: [{
                id:          conflictRes.id,
                guestName:   conflictRes.guestName,
                time:        conflictRes.time,
                partySize:   conflictRes.partySize,
                minutesUntil: (fH * 60 + fM) - nowMins,
              }],
            });
          }
        }
      }
      throw err;
    }
  }

  // Hard safety guard — never allow double-seating regardless of overrideConflicts.
  // Checks for a currently SEATED reservation on the target table (or any combined table).
  const occupiedCheck = await prisma.reservation.findFirst({
    where: {
      restaurantId,
      date: parseDateArg(todayLocal),
      status: 'SEATED',
      id: { not: id },
      OR: [
        { tableId },
        ...resolvedCombinedIds.map(cid => ({ tableId: cid })),
      ],
    },
    select: { id: true },
  });
  if (occupiedCheck) {
    throw new BusinessRuleError('Table is currently occupied — cannot seat another guest');
  }

  console.log(`[perf:seat] validation done ${Date.now() - t0}ms`);
  const result = await prisma.$transaction(async (tx) => {
    // Walk-in override: unassign future reservations on the target table so they
    // surface in the ללא שולחן list for immediate reassignment by the host.
    // Uses the same conflict window as Check 1 (defaultTurnMinutes + buffer from now).
    if (overrideConflicts && reorganizeIds.length === 0) {
      const todayDateObj = parseDateArg(todayLocal);
      const windowEndMins = nowMins + settings.defaultTurnMinutes + settings.bufferBetweenTurnsMinutes;
      const futureOnTable = await tx.reservation.findMany({
        where: {
          restaurantId,
          date: todayDateObj,
          tableId,
          status: { in: ['CONFIRMED', 'PENDING'] },
          id: { not: id },
        },
        select: { id: true, guestName: true, time: true },
      });
      for (const displaced of futureOnTable.filter(f => {
        const [fH, fM] = f.time.split(':').map(Number);
        const resMins = fH * 60 + fM;
        return resMins > nowMins && resMins <= windowEndMins;
      })) {
        await tx.reservation.update({
          where: { id: displaced.id },
          data: { tableId: null, combinedTableIds: [] },
        });
        await logActivity(tx, displaced.id, 'REORGANIZE_TRIGGERED', actorName, {
          displacedFrom: tableId,
          byReservation: id,
          byGuestName: r.guestName,
        });
      }
    }

    // Displace only the reservations the host explicitly selected.
    // Validate each: must belong to this restaurant, table, date, and be seateable.
    if (reorganizeIds.length > 0) {
      const toDisplace = await tx.reservation.findMany({
        where: {
          id: { in: reorganizeIds },
          restaurantId,
          tableId,
          date: r.date,
          status: { in: ['CONFIRMED', 'PENDING'] },
        },
        select: { id: true, guestName: true },
      });
      for (const displaced of toDisplace) {
        await tx.reservation.update({
          where: { id: displaced.id },
          data: {
            tableId: null,
            combinedTableIds: [],
            reorganizeAt: new Date(),
            reorganizeFromTableId: tableId,
            reorganizeBySeatingId: id,
            reorganizedByName: actorName,
          },
        });
        await logActivity(tx, displaced.id, 'REORGANIZE_TRIGGERED', actorName, {
          displacedFrom: tableId,
          byReservation: id,
          byGuestName: r.guestName,
        });
      }
    }

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        status: 'SEATED',
        tableId,
        combinedTableIds: resolvedCombinedIds,
        seatedAt: new Date(),
        confirmedAt: r.confirmedAt ?? new Date(),
        returnedToListAt: null,
        reorganizeAt: null,
        seatedByName: actorName,
      },
      include: { table: true },
    });
    await logActivity(tx, id, 'SEATED', actorName, {
      fromStatus: r.status,
      toStatus: 'SEATED',
      tableId,
      previousTableId: r.tableId ?? null,
    });
    return updated;
  });
  console.log(`[perf:seat] total seatReservation ${Date.now() - t0}ms`);
  return result;
}

export async function moveReservation(
  restaurantId: string,
  id: string,
  input: MoveTableInput,
  actorName: string
) {
  const t0 = Date.now();
  const [r, settings] = await Promise.all([
    assertReservationBelongsToRestaurant(id, restaurantId),
    getRestaurantSettings(restaurantId),
  ]);
  console.log(`[perf:move] init queries ${Date.now() - t0}ms`);

  if (r.status !== 'SEATED') {
    throw new BusinessRuleError('Can only move a reservation that is currently seated');
  }

  if (!input.overrideConflicts) {
    // Same as seatReservation: use current restaurant-local time so the conflict
    // check stays consistent with what the floor board shows.
    const nowTimeStrMove = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    await validateTableAssignment(
      restaurantId,
      input.tableId,
      r.date,
      nowTimeStrMove,
      r.duration,
      settings.bufferBetweenTurnsMinutes,
      r.partySize,
      [id],
      input.combinedTableIds ?? []
    );
  }

  console.log(`[perf:move] validation done ${Date.now() - t0}ms`);
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: {
        tableId: input.tableId,
        previousTableId: r.tableId,
        combinedTableIds: input.combinedTableIds ?? [],
        movedByName: actorName,
      },
      include: { table: true },
    });
    await logActivity(tx, id, 'MOVED', actorName, {
      fromStatus: 'SEATED',
      toStatus: 'SEATED',
      fromTableId: r.tableId ?? null,
      fromCombinedTableIds: r.combinedTableIds,
      toTableId: input.tableId,
      reason: input.reason ?? null,
    });
    return updated;
  });
  console.log(`[perf:move] total moveReservation ${Date.now() - t0}ms`);
  return result;
}

export async function swapReservations(
  restaurantId: string,
  aId: string,
  bId: string,
  actorName: string
) {
  if (aId === bId) throw new BusinessRuleError('Cannot swap a reservation with itself');

  const [resA, resB, settings] = await Promise.all([
    assertReservationBelongsToRestaurant(aId, restaurantId),
    assertReservationBelongsToRestaurant(bId, restaurantId),
    getRestaurantSettings(restaurantId),
  ]);

  const SWAPPABLE = ['SEATED', 'PENDING', 'CONFIRMED'] as const;
  if (!(SWAPPABLE as readonly string[]).includes(resA.status)) throw new BusinessRuleError(`${resA.guestName} cannot be swapped (status: ${resA.status})`);
  if (!(SWAPPABLE as readonly string[]).includes(resB.status)) throw new BusinessRuleError(`${resB.guestName} cannot be swapped (status: ${resB.status})`);
  if (!resA.tableId || !resB.tableId) throw new BusinessRuleError('Both reservations must have a table assigned');
  if (resA.tableId === resB.tableId) throw new BusinessRuleError('Reservations are already at the same table');
  if ((resA.combinedTableIds as string[]).length > 0 || (resB.combinedTableIds as string[]).length > 0) {
    throw new BusinessRuleError('Swapping combined-table reservations is not supported');
  }
  if (resA.reorganizeAt || resB.reorganizeAt) throw new BusinessRuleError('Cannot swap a reservation in reorganize state');

  const nowTimeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

  // Mutual exclusion: both A and B are simultaneously vacating their tables.
  // Exclude both IDs from every validation call so they don't block each other.
  const swapExclude = [aId, bId];
  console.log('[swap:validation] validating A→tableB', { reservationId: aId, targetTableId: resB.tableId, excludedIds: swapExclude });
  await validateTableAssignment(restaurantId, resB.tableId, resA.date, nowTimeStr, resA.duration, settings.bufferBetweenTurnsMinutes, resA.partySize, swapExclude);
  console.log('[swap:validation] validating B→tableA', { reservationId: bId, targetTableId: resA.tableId, excludedIds: swapExclude });
  await validateTableAssignment(restaurantId, resA.tableId, resB.date, nowTimeStr, resB.duration, settings.bufferBetweenTurnsMinutes, resB.partySize, swapExclude);
  console.log('[swap:validation] both validations passed');

  return prisma.$transaction(async (tx) => {
    const [updatedA, updatedB] = await Promise.all([
      tx.reservation.update({
        where: { id: aId },
        data: { tableId: resB.tableId, previousTableId: resA.tableId, movedByName: actorName },
        include: { table: true },
      }),
      tx.reservation.update({
        where: { id: bId },
        data: { tableId: resA.tableId, previousTableId: resB.tableId, movedByName: actorName },
        include: { table: true },
      }),
    ]);
    await Promise.all([
      logActivity(tx, aId, 'TABLE_SWAP', actorName, {
        fromTableId: resA.tableId,
        toTableId: resB.tableId,
        swappedWithReservationId: bId,
        swappedWithGuest: resB.guestName,
      }),
      logActivity(tx, bId, 'TABLE_SWAP', actorName, {
        fromTableId: resB.tableId,
        toTableId: resA.tableId,
        swappedWithReservationId: aId,
        swappedWithGuest: resA.guestName,
      }),
    ]);
    return { reservationA: updatedA, reservationB: updatedB };
  });
}

export async function markArrived(
  restaurantId: string,
  id: string,
  actorName: string,
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (!['PENDING', 'CONFIRMED'].includes(r.status)) {
    throw new BusinessRuleError(`Cannot mark arrived for a ${r.status} reservation`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { isArrived: true, arrivedAt: new Date() },
    });
    await logActivity(tx, id, 'ARRIVED', actorName, {
      fromStatus: r.status,
      toStatus:   r.status,
      tableId:    r.tableId ?? null,
    });
    return updated;
  });
}

export async function unmarkArrived(
  restaurantId: string,
  id: string,
  actorName: string,
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (!['PENDING', 'CONFIRMED'].includes(r.status)) {
    throw new BusinessRuleError(`Cannot undo arrival for a ${r.status} reservation`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { isArrived: false, arrivedAt: null },
    });
    await logActivity(tx, id, 'ARRIVAL_UNDONE', actorName, {
      fromStatus: r.status,
      toStatus:   r.status,
      tableId:    r.tableId ?? null,
    });
    return updated;
  });
}

export async function completeReservation(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (r.status !== 'SEATED') {
    throw new BusinessRuleError(`Cannot complete a reservation with status ${r.status}`);
  }
  return prisma.$transaction(async (tx) => {
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

export async function markNoShow(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (!['CONFIRMED', 'PENDING'].includes(r.status)) {
    throw new BusinessRuleError(`Cannot mark no-show for a reservation with status ${r.status}`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { status: 'NO_SHOW', noShowAt: new Date(), returnedToListAt: null, cancelledByName: actorName },
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

export async function cancelReservation(
  restaurantId: string,
  id: string,
  reason: string | undefined,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(r.status)) {
    throw new BusinessRuleError(`Reservation is already ${r.status}`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), returnedToListAt: null, cancelledByName: actorName },
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

export async function unseatReservation(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (r.status !== 'SEATED') {
    throw new BusinessRuleError(`Cannot unseat a reservation with status ${r.status}`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { status: 'CONFIRMED', tableId: null, combinedTableIds: [], seatedAt: null, returnedToListAt: new Date() },
      include: { table: true },
    });
    await logActivity(tx, id, 'RETURN_TO_LIST', actorName, {
      note: 'Returned to list / seating reversed',
      fromStatus: 'SEATED',
      toStatus: 'CONFIRMED',
      previousTableId: r.tableId ?? null,
    });
    // Revert any linked waitlist entry back to WAITING so it re-appears on the list.
    const linked = await tx.waitlistEntry.findFirst({ where: { reservationId: id } });
    if (linked && linked.status === 'SEATED') {
      await tx.waitlistEntry.update({
        where: { id: linked.id },
        data: { status: 'WAITING', seatedAt: null },
      });
    }
    return updated;
  });
}

export async function unconfirmReservation(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (r.status !== 'CONFIRMED') {
    throw new BusinessRuleError(`Cannot revert a reservation with status ${r.status} to pending`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { status: 'PENDING', confirmedAt: null, returnedToListAt: null },
      include: { table: true },
    });
    await logActivity(tx, id, 'REVERTED_TO_PENDING', actorName, {
      fromStatus: 'CONFIRMED',
      toStatus: 'PENDING',
    });
    return updated;
  });
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

const UNDOABLE_ACTIONS = ['CONFIRMED', 'NO_SHOW', 'CANCELLED', 'SEATED', 'COMPLETED', 'MOVED'] as const;
type UndoableAction = typeof UNDOABLE_ACTIONS[number];

function detailsStr(details: Record<string, unknown>, key: string): string | null {
  const v = details[key];
  return typeof v === 'string' ? v : null;
}

function detailsArr(details: Record<string, unknown>, key: string): string[] | null {
  const v = details[key];
  return Array.isArray(v) ? (v as string[]) : null;
}

export async function undoReservation(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);

  const lastActivity = await prisma.reservationActivity.findFirst({
    where: { reservationId: id, action: { in: [...UNDOABLE_ACTIONS] } },
    orderBy: { timestamp: 'desc' },
  });

  if (!lastActivity) {
    throw new BusinessRuleError('No undoable action found for this reservation');
  }

  const action = lastActivity.action as UndoableAction;
  const details = (lastActivity.details ?? {}) as Record<string, unknown>;

  return prisma.$transaction(async (tx) => {
    let updateData: Prisma.ReservationUncheckedUpdateInput;
    let toStatus: string = r.status;

    switch (action) {
      case 'CONFIRMED':
        toStatus = 'PENDING';
        updateData = { status: 'PENDING', confirmedAt: null };
        break;

      case 'NO_SHOW':
        toStatus = detailsStr(details, 'fromStatus') ?? 'PENDING';
        updateData = { status: toStatus as ReservationStatus, noShowAt: null };
        if (r.guestId) {
          await tx.guest.update({
            where: { id: r.guestId },
            data: { noShowCount: { decrement: 1 } },
          });
        }
        break;

      case 'CANCELLED':
        toStatus = detailsStr(details, 'fromStatus') ?? 'PENDING';
        updateData = { status: toStatus as ReservationStatus, cancelledAt: null };
        if (r.guestId) {
          await tx.guest.update({
            where: { id: r.guestId },
            data: { cancelCount: { decrement: 1 } },
          });
        }
        break;

      case 'SEATED':
        toStatus = detailsStr(details, 'fromStatus') ?? 'CONFIRMED';
        updateData = {
          status: toStatus as ReservationStatus,
          seatedAt: null,
          tableId: detailsStr(details, 'previousTableId'),
          combinedTableIds: [],
        };
        break;

      case 'COMPLETED':
        toStatus = detailsStr(details, 'fromStatus') ?? 'SEATED';
        updateData = { status: toStatus as ReservationStatus, completedAt: null };
        break;

      case 'MOVED':
        updateData = {
          tableId: detailsStr(details, 'fromTableId'),
          combinedTableIds: detailsArr(details, 'fromCombinedTableIds') ?? [],
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
//
export async function deleteReservation(restaurantId: string, id: string) {
  await assertReservationBelongsToRestaurant(id, restaurantId);
  await prisma.reservation.delete({ where: { id } });
}

// combinedTableIds: when non-empty, the booking spans multiple tables.
// Capacity is validated across all tables combined; individual tables may be
// smaller than the full party size, which is expected and valid.

export async function validateTableAssignment(
  restaurantId: string,
  tableId: string,
  date: Date,
  time: string,
  duration: number,
  bufferMinutes: number,
  partySize: number,
  excludeReservationIds: string[] = [],
  combinedTableIds: string[] = []
) {
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  if (!table || table.restaurantId !== restaurantId) {
    throw new NotFoundError('Table', tableId);
  }
  if (!table.isActive) {
    throw new BusinessRuleError(`Table ${table.name} is inactive`);
  }

  // For combined bookings, validate that all combined tables are active.
  // Capacity mismatches (party size vs table min/max covers) are advisory only —
  // hosts may intentionally over-seat (added chairs, VIP override, etc.).
  if (combinedTableIds.length > 0) {
    const combinedTables = await prisma.table.findMany({
      where: { id: { in: combinedTableIds }, restaurantId },
      select: { id: true, name: true, isActive: true },
    });
    const missingOrInactive = combinedTableIds.find(
      id => !combinedTables.find(t => t.id === id && t.isActive)
    );
    if (missingOrInactive) {
      const t = combinedTables.find(t => t.id === missingOrInactive);
      throw new BusinessRuleError(
        t ? `Table ${t.name} is inactive` : `Combined table not found: ${missingOrInactive}`
      );
    }
  }

  const availability = await getTableAvailability(
    restaurantId,
    date,
    time,
    duration,
    bufferMinutes,
    [tableId, ...combinedTableIds],
    excludeReservationIds
  );

  // Check primary table availability — any conflict here is a real third-party conflict
  // (excluded reservations and displaced/reorganize reservations are filtered out inside getTableAvailability)
  const tableAvail = availability.find((a) => a.tableId === tableId);
  console.log('[availability:block] validateTableAssignment', {
    targetTableId: tableId,
    targetTableName: table.name,
    timeWindow: `${time} + ${duration}min (buffer ${bufferMinutes}min)`,
    excludedIds: excludeReservationIds,
    isAvailable: tableAvail?.isAvailable,
    conflictingReservationId: tableAvail?.conflictingReservationId,
    blockedBy: tableAvail?.blockedBy,
    debug: tableAvail?._debug,
  });
  if (!tableAvail?.isAvailable) {
    if (tableAvail?.blockedBy) {
      throw new ConflictError(`Table ${table.name} is blocked: ${tableAvail.blockedBy}`);
    }
    throw new ConflictError(
      `Table ${table.name} is not available at that time`,
      {
        conflictingReservationId: tableAvail?.conflictingReservationId,
        nextAvailableAt: tableAvail?.nextAvailableAt,
        validatorDebug: tableAvail?._debug,
      }
    );
  }

  // Check each combined table's availability — same as primary, excluded IDs already filtered
  for (const combinedId of combinedTableIds) {
    const combinedAvail = availability.find((a) => a.tableId === combinedId);
    if (!combinedAvail?.isAvailable) {
      const combinedName = (await prisma.table.findUnique({
        where: { id: combinedId },
        select: { name: true },
      }))?.name ?? combinedId;
      if (combinedAvail?.blockedBy) {
        throw new ConflictError(`Table ${combinedName} is blocked: ${combinedAvail.blockedBy}`);
      }
      throw new ConflictError(`Table ${combinedName} is not available at that time`);
    }
  }
}
