import { prisma } from '../../lib/prisma';
import { Reservation, ReservationStatus, Prisma } from '@prisma/client';
import { buildMomentQueue, refreshGuestStats } from '../intelligence/engine';
import { generateFeedbackToken } from '../feedback/service';
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from '../../lib/errors';
import { getTableAvailability } from '../../engine/availability';
import { resolveTurnTime } from '../../engine/opProfile';
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
    noShowThresholdMinutes: (s.noShowThresholdMinutes as number) ?? 30,
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
  if (status) {
    where.status = status;
  } else {
    // Default: exclude STANDBY from the main reservation list — it has its own tab
    where.status = { not: 'STANDBY' };
  }
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
  const heuristicCreate = input.partySize >= 3 ? 120 : 90;
  const duration = input.duration ?? await resolveTurnTime(restaurantId, input.partySize, heuristicCreate);
  const date = parseDateArg(input.date);

  // STANDBY: skip all conflict/availability checks — no table assignment, no blocking
  const isStandby = input.status === 'STANDBY';

  if (!isStandby && input.tableId && !input.overrideConflicts) {
    try {
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
    } catch (err) {
      if (err instanceof ConflictError) {
        const det = (err as ConflictError).details as { conflictingReservationId?: string } | null;
        if (det?.conflictingReservationId) {
          const conflictRes = await prisma.reservation.findUnique({
            where: { id: det.conflictingReservationId },
            select: { id: true, guestName: true, time: true, partySize: true },
          });
          if (conflictRes) {
            const [resH, resM] = input.time.split(':').map(Number);
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

  const status: ReservationStatus = isStandby
    ? 'STANDBY'
    : (settings.autoConfirm ? 'CONFIRMED' : 'PENDING');

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
    // Displace host-selected conflicting future reservations before creating the new one.
    if (input.reorganizeIds.length > 0 && input.tableId) {
      const toDisplace = await tx.reservation.findMany({
        where: {
          id:           { in: input.reorganizeIds },
          restaurantId,
          tableId:      input.tableId,
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
            reorganizeFromTableId: input.tableId,
            reorganizedByName:     actorName,
          },
        });
        await logActivity(tx, displaced.id, 'REORGANIZE_TRIGGERED', actorName, {
          displacedFrom:  input.tableId,
          byGuestName:    input.guestName,
        });
      }
    }

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
  const [existing, settings] = await Promise.all([
    assertReservationBelongsToRestaurant(id, restaurantId),
    getRestaurantSettings(restaurantId),
  ]);

  if (['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(existing.status)) {
    throw new BusinessRuleError(`Cannot modify a ${existing.status} reservation`);
  }

  // STANDBY → only CONFIRMED or CANCELLED are valid next statuses
  if (existing.status === 'STANDBY' && input.status && !['CONFIRMED', 'CANCELLED', 'STANDBY'].includes(input.status)) {
    throw new BusinessRuleError(`Cannot transition from STANDBY to ${input.status}`);
  }

  // SEATED guests: date and time are locked; table moves remain allowed so hosts
  // can reassign a party mid-service. Operational fields (party size, notes, duration)
  // are also editable. COMPLETED / NO_SHOW / CANCELLED are blocked above.
  if (existing.status === 'SEATED' && (input.date || input.time)) {
    throw new BusinessRuleError('Cannot change date or time for a seated reservation');
  }
  const date = input.date ? parseDateArg(input.date) : existing.date;
  const time = input.time ?? existing.time;
  const newPartySize = input.partySize ?? existing.partySize;
  const duration = input.duration ?? (
    input.partySize && input.partySize !== existing.partySize
      ? await resolveTurnTime(restaurantId, newPartySize, newPartySize >= 3 ? 120 : 90)
      : existing.duration
  );
  const tableId = input.tableId !== undefined ? input.tableId : existing.tableId;
  const combinedTableIds = input.combinedTableIds !== undefined ? input.combinedTableIds : existing.combinedTableIds;

  // STANDBY edits (date/time/notes/party without confirming) skip conflict checks entirely
  const confirmingStandby = existing.status === 'STANDBY' && input.status === 'CONFIRMED';

  // Skip conflict check for STANDBY-only edits (date/time/notes); always run when confirming.
  const skipConflict = existing.status === 'STANDBY' && !confirmingStandby;

  if (!skipConflict && tableId && (input.date || input.time || input.duration || input.tableId !== undefined || input.combinedTableIds !== undefined || confirmingStandby)) {
    if (!input.overrideConflicts) {
      // When only the table assignment changes (no time/date/duration shift), use
      // bufferMinutes=0 so that adjacent reservations (end==start) are allowed.
      // The buffer is meant to pad auto-suggestions, not block manual host overrides.
      const isTableOnlyChange = !input.date && !input.time && !input.duration &&
        (input.tableId !== undefined || input.combinedTableIds !== undefined);
      const effectiveBuffer = isTableOnlyChange ? 0 : settings.bufferBetweenTurnsMinutes;
      try {
        await validateTableAssignment(
          restaurantId,
          tableId,
          date,
          time,
          duration,
          effectiveBuffer,
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
        // STANDBY → CONFIRMED: stamp status and confirmedAt
        ...(confirmingStandby && { status: 'CONFIRMED', confirmedAt: new Date() }),
        // Assigning a table to a reorganized reservation resolves it
        ...(resolvingReorganize && { reorganizeAt: null }),
        updatedByName: actorName,
      },
      include: { table: true, guest: true },
    });

    await logActivity(tx, id, 'UPDATED', actorName, {
      fromStatus: existing.status,
      toStatus:   confirmingStandby ? 'CONFIRMED' : existing.status,
      tableId:    existing.tableId ?? null,
      changes,
    });

    // STANDBY → CONFIRMED: emit a dedicated audit event
    if (confirmingStandby) {
      await logActivity(tx, id, 'CONFIRMED', actorName, {
        fromStatus: 'STANDBY',
        toStatus:   'CONFIRMED',
        tableId:    input.tableId ?? null,
      });
    }

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
  if (!['PENDING', 'STANDBY'].includes(r.status)) {
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
  reorganizeIds: string[] = [],
  forceOverrideOccupied = false,
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

  // Late-arrival window compression: if the guest arrives after their scheduled
  // time, they have fewer minutes remaining in their planned turn. Using the full
  // original duration from now would extend the validation window into the next
  // reservation's slot, causing false conflicts. Use the remaining window instead.
  const [resHr, resMn] = r.time.split(':').map(Number);
  const scheduledMins = resHr * 60 + resMn;
  const minutesLate = Math.max(0, nowMins - scheduledMins);
  const effectiveDuration = minutesLate > 0 ? Math.max(r.duration - minutesLate, 15) : r.duration;

  // True when the host is seating a guest at the table already assigned to this
  // reservation (late arrival at own table). The reservation owns the table — skip
  // availability validation to prevent self-conflict hard blocks. The occupiedCheck
  // below still guards against actual double-seating.
  const isSameTableReSeat = tableId === r.tableId;

  // Soft-pressure advisory: scan for upcoming reservations within the default
  // turn window. The table is physically free — seating proceeds unconditionally.
  // Advisory is returned on the response so the host sees a non-blocking warning.
  // Hard blocks (blocked periods, inactive tables, actual double-occupancy) are
  // handled separately below and in the occupiedCheck guard.
  type SeatAdvisory = { shortWindow: boolean; minutesUntil: number; nextGuestName: string; minutesLate?: number } | null;
  let seatAdvisory: SeatAdvisory = null;

  if (reorganizeIds.length === 0) {
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
      const nearest = withinWindow[0];
      const [fH, fM] = nearest.time.split(':').map(Number);
      seatAdvisory = {
        shortWindow: true,
        minutesUntil: (fH * 60 + fM) - nowMins,
        nextGuestName: nearest.guestName,
        ...(minutesLate > 0 ? { minutesLate } : {}),
      };
      console.log('[seat:advisory] soft pressure — seating allowed, future reservation preserved', {
        reservationId: id,
        targetTableId: tableId,
        nextReservationId: nearest.id,
        nextGuestName: nearest.guestName,
        minutesUntil: seatAdvisory.minutesUntil,
        minutesLate,
      });
    }
  }

  // Late-arriving guest at their own assigned table: set remaining-window advisory
  // even when no future reservation pressure exists, so the host sees the compressed turn.
  if (isSameTableReSeat && minutesLate > 0 && !seatAdvisory) {
    seatAdvisory = { shortWindow: true, minutesUntil: effectiveDuration, nextGuestName: '', minutesLate };
    console.log('[seat:advisory] late arrival at own table', {
      reservationId: id, targetTableId: tableId, minutesLate, effectiveDuration,
    });
  }

  // Host confirmed "close and seat" — complete any seated reservation on the target
  // table before validation so both validateTableAssignment and the hard guard pass.
  if (forceOverrideOccupied) {
    const todayDateObj = parseDateArg(todayLocal);
    const currentOccupant = await prisma.reservation.findFirst({
      where: {
        restaurantId,
        date: todayDateObj,
        status: 'SEATED',
        id: { not: id },
        OR: [
          { tableId },
          ...resolvedCombinedIds.map(cid => ({ tableId: cid })),
        ],
      },
      select: { id: true, guestName: true },
    });
    if (currentOccupant) {
      await prisma.reservation.update({
        where: { id: currentOccupant.id },
        data: { status: 'COMPLETED' },
      });
      console.log('[seat:forceOverride] completed occupant', {
        completedId:   currentOccupant.id,
        completedName: currentOccupant.guestName,
        seatingId:     id,
        tableId,
      });
    }
  }

  if (!overrideConflicts && !isSameTableReSeat) {
    console.log('[availability:block] seatReservation incoming', {
      reservationId: id,
      reservationStatus: r.status,
      reservationScheduledTime: r.time,
      reservationDate: r.date,
      reservationDuration: r.duration,
      effectiveDuration,
      minutesLate,
      reservationCurrentTableId: r.tableId,
      reservationReorganizeAt: r.reorganizeAt,
      targetTableId: tableId,
      targetCombinedIds: resolvedCombinedIds,
      validationTime: nowTimeStr,
      bufferMinutes: settings.bufferBetweenTurnsMinutes,
      excludeReservationIds: [id],
    });
    // Validate table existence, active status, and blocked periods.
    // Reservation-vs-reservation time overlap is soft pressure (handled above).
    // Only hard errors (blocked period, inactive table, table not found) block seating.
    try {
      await validateTableAssignment(
        restaurantId,
        tableId,
        r.date,
        nowTimeStr,
        effectiveDuration,
        settings.bufferBetweenTurnsMinutes,
        r.partySize,
        [id],
        resolvedCombinedIds
      );
    } catch (err) {
      if (err instanceof ConflictError) {
        const det = (err as ConflictError).details as { conflictingReservationId?: string } | null;
        if (det?.conflictingReservationId) {
          // Future reservation on this table — surface conflict modal instead of silently seating.
          console.log('[SeatConflictTransform]', { reservationId: id, conflictingReservationId: det.conflictingReservationId, tableId });
          const conflictRes = await prisma.reservation.findUnique({
            where: { id: det.conflictingReservationId },
            select: { id: true, guestName: true, time: true, partySize: true, status: true },
          });
          if (conflictRes) {
            // Currently SEATED guest — different flow from a future reservation conflict.
            if (conflictRes.status === 'SEATED') {
              throw new ConflictError('Table is currently occupied', {
                code: 'TABLE_IS_OCCUPIED',
                occupiedBy: {
                  id:        conflictRes.id,
                  guestName: conflictRes.guestName,
                  time:      conflictRes.time,
                  partySize: conflictRes.partySize,
                },
              });
            }
            const [cH, cM] = conflictRes.time.split(':').map(Number);
            const [nH, nM] = nowTimeStr.split(':').map(Number);
            throw new ConflictError('This table has upcoming reservations', {
              code: 'TABLE_HAS_FUTURE_RESERVATIONS',
              conflicts: [{
                id:           conflictRes.id,
                guestName:    conflictRes.guestName,
                time:         conflictRes.time,
                partySize:    conflictRes.partySize,
                minutesUntil: (cH * 60 + cM) - (nH * 60 + nM),
              }],
            });
          }
        }
        // Hard conflict: blocked period, table-level constraint, or conflictRes not found.
        console.log('[SeatHardReject]', { reason: (err as ConflictError).message, tableId, conflictingReservationId: det?.conflictingReservationId ?? null });
        throw err;
      } else {
        // NotFoundError, BusinessRuleError, ValidationError — always hard block.
        console.log('[SeatHardReject]', { reason: (err as Error).message, tableId, errType: (err as Error).constructor?.name });
        throw err;
      }
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
    select: { id: true, guestName: true, time: true, partySize: true },
  });
  if (occupiedCheck) {
    throw new ConflictError('Table is currently occupied', {
      code: 'TABLE_IS_OCCUPIED',
      occupiedBy: {
        id:        occupiedCheck.id,
        guestName: occupiedCheck.guestName,
        time:      occupiedCheck.time,
        partySize: occupiedCheck.partySize,
      },
    });
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

    // ── Overdue PENDING/CONFIRMED release ────────────────────────────────────
    // Before writing the new SEATED row, atomically release any PENDING/CONFIRMED
    // reservation on the target table(s) whose no-show deadline (scheduled time +
    // NO_SHOW_AFTER_MINUTES) has already passed.  Releasing inside this transaction
    // prevents hidden double table-ownership: the old claim is cleared in the same
    // write as the new SEATED assignment, so no intermediate state can leave two
    // reservations simultaneously owning the same table.
    {
      const allTargetTableIds = [tableId, ...resolvedCombinedIds];
      const alreadyHandled   = new Set([id, ...reorganizeIds]);
      const overdueCheckDate = parseDateArg(todayLocal);

      const candidates = await tx.reservation.findMany({
        where: {
          restaurantId,
          date: overdueCheckDate,
          status: { in: ['PENDING', 'CONFIRMED'] },
          id: { notIn: [...alreadyHandled] },
          OR: [
            { tableId: { in: allTargetTableIds } },
            { combinedTableIds: { hasSome: allTargetTableIds } },
          ],
        },
        select: { id: true, tableId: true, combinedTableIds: true, time: true, status: true },
      });

      for (const candidate of candidates) {
        const [cH, cM] = candidate.time.split(':').map(Number);
        if ((cH * 60 + cM) + settings.noShowThresholdMinutes > nowMins) continue;
        await tx.reservation.update({
          where: { id: candidate.id },
          data: { tableId: null, combinedTableIds: [], returnedToListAt: new Date() },
        });
        await logActivity(tx, candidate.id, 'RELEASED_TABLE', actorName, {
          note: 'Table released automatically — reservation overdue at time of new guest seating',
          fromTableId: candidate.tableId ?? null,
          fromCombinedTableIds: candidate.combinedTableIds,
          releasedForReservationId: id,
          reservationStatus: candidate.status,
          overdueMinutes: nowMins - (cH * 60 + cM),
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
  return Object.assign(result, { _advisory: seatAdvisory });
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

  // Hoist now-time outside the overrideConflicts guard so the overdue-release
  // block in the transaction uses the same time anchor as validation.
  const nowTimeStrMove  = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const todayLocalMove  = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date());
  const [nowMoveH, nowMoveM] = nowTimeStrMove.split(':').map(Number);
  const nowMoveMins = nowMoveH * 60 + nowMoveM;

  if (!input.overrideConflicts) {
    try {
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
    } catch (err) {
      if (err instanceof ConflictError) {
        const det = (err as ConflictError).details as { conflictingReservationId?: string } | null;
        if (det?.conflictingReservationId) {
          const conflictRes = await prisma.reservation.findUnique({
            where: { id: det.conflictingReservationId },
            select: { id: true, guestName: true, time: true, partySize: true },
          });
          if (conflictRes) {
            const [nowH, nowM] = nowTimeStrMove.split(':').map(Number);
            const [fH, fM]     = conflictRes.time.split(':').map(Number);
            throw new ConflictError('This table has upcoming reservations', {
              code: 'TABLE_HAS_FUTURE_RESERVATIONS',
              conflicts: [{
                id:           conflictRes.id,
                guestName:    conflictRes.guestName,
                time:         conflictRes.time,
                partySize:    conflictRes.partySize,
                minutesUntil: (fH * 60 + fM) - (nowH * 60 + nowM),
              }],
            });
          }
        }
      }
      throw err;
    }
  }

  // Hard safety guard — never allow moving to an actually occupied table.
  // A SEATED reservation on the target would produce a ConflictError with a
  // conflictingReservationId, which the soft-catch above would absorb as advisory.
  // This explicit check re-adds the hard block for physical occupancy, matching
  // seatReservation's occupiedCheck guard.
  const moveTargetCombinedIds = input.combinedTableIds ?? [];
  const moveOccupiedCheck = await prisma.reservation.findFirst({
    where: {
      restaurantId,
      date: parseDateArg(todayLocalMove),
      status: 'SEATED',
      id: { not: id },
      OR: [
        { tableId: input.tableId },
        ...moveTargetCombinedIds.map(cid => ({ tableId: cid })),
      ],
    },
    select: { id: true },
  });
  if (moveOccupiedCheck) {
    throw new BusinessRuleError('Table is currently occupied — cannot move here');
  }

  console.log(`[perf:move] validation done ${Date.now() - t0}ms`);
  const result = await prisma.$transaction(async (tx) => {
    // Release overdue PENDING/CONFIRMED reservations on the target table(s) atomically,
    // same safety model as seatReservation: clear tableId/combinedTableIds before
    // writing the new table assignment to prevent hidden double ownership.
    {
      const allMoveTargetIds = [input.tableId, ...(input.combinedTableIds ?? [])];
      const moveOverdueDate  = parseDateArg(todayLocalMove);
      const candidates = await tx.reservation.findMany({
        where: {
          restaurantId,
          date: moveOverdueDate,
          status: { in: ['PENDING', 'CONFIRMED'] },
          id: { not: id },
          OR: [
            { tableId: { in: allMoveTargetIds } },
            { combinedTableIds: { hasSome: allMoveTargetIds } },
          ],
        },
        select: { id: true, tableId: true, combinedTableIds: true, time: true, status: true },
      });
      for (const candidate of candidates) {
        const [cH, cM] = candidate.time.split(':').map(Number);
        if ((cH * 60 + cM) + settings.noShowThresholdMinutes > nowMoveMins) continue;
        await tx.reservation.update({
          where: { id: candidate.id },
          data: { tableId: null, combinedTableIds: [], returnedToListAt: new Date() },
        });
        await logActivity(tx, candidate.id, 'RELEASED_TABLE', actorName, {
          note: 'Table released automatically — reservation overdue at time of table move',
          fromTableId: candidate.tableId ?? null,
          fromCombinedTableIds: candidate.combinedTableIds,
          releasedForReservationId: id,
          reservationStatus: candidate.status,
          overdueMinutes: nowMoveMins - (cH * 60 + cM),
        });
      }
    }

    // Displace host-selected conflicting future reservations on the target table.
    if ((input.reorganizeIds ?? []).length > 0) {
      const toDisplace = await tx.reservation.findMany({
        where: {
          id:          { in: input.reorganizeIds },
          restaurantId,
          tableId:     input.tableId,
          date:        r.date,
          status:      { in: ['CONFIRMED', 'PENDING'] },
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
            reorganizeFromTableId: input.tableId,
            reorganizeBySeatingId: id,
            reorganizedByName:     actorName,
          },
        });
        await logActivity(tx, displaced.id, 'REORGANIZE_TRIGGERED', actorName, {
          displacedFrom: input.tableId,
          byReservation: id,
          byGuestName:   r.guestName,
        });
      }
    }

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

  const [resA, resB] = await Promise.all([
    assertReservationBelongsToRestaurant(aId, restaurantId),
    assertReservationBelongsToRestaurant(bId, restaurantId),
  ]);

  const SWAPPABLE = ['SEATED', 'PENDING', 'CONFIRMED'] as const;
  if (!(SWAPPABLE as readonly string[]).includes(resA.status)) throw new BusinessRuleError(`${resA.guestName} cannot be swapped (status: ${resA.status})`);
  if (!(SWAPPABLE as readonly string[]).includes(resB.status)) throw new BusinessRuleError(`${resB.guestName} cannot be swapped (status: ${resB.status})`);
  if (!resA.tableId || !resB.tableId) throw new BusinessRuleError('Both reservations must have a table assigned');
  if (resA.tableId === resB.tableId) throw new BusinessRuleError('Reservations are already at the same table');
  if (resA.reorganizeAt || resB.reorganizeAt) throw new BusinessRuleError('Cannot swap a reservation in reorganize state');

  // Pure table-assignment swap: no availability check.
  // The host explicitly chose both reservations; conflict detection would block legitimate
  // operational swaps (e.g. when a third reservation exists at either table at a different time).
  return prisma.$transaction(async (tx) => {
    const [updatedA, updatedB] = await Promise.all([
      tx.reservation.update({
        where: { id: aId },
        data: {
          tableId: resB.tableId,
          combinedTableIds: resB.combinedTableIds as string[],
          previousTableId: resA.tableId,
          movedByName: actorName,
        },
        include: { table: true },
      }),
      tx.reservation.update({
        where: { id: bId },
        data: {
          tableId: resA.tableId,
          combinedTableIds: resA.combinedTableIds as string[],
          previousTableId: resB.tableId,
          movedByName: actorName,
        },
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
  }).then(async (updated) => {
    // Fire-and-forget: build moment queue + generate feedback token
    Promise.resolve().then(async () => {
      try {
        if (r.guestId) {
          await refreshGuestStats(r.restaurantId, r.guestId);
          await buildMomentQueue(r.restaurantId, r.guestId, r.id);
        }
        await generateFeedbackToken(r.restaurantId, r.id, r.guestId ?? null, r.guestPhone ?? null, r.guestName);
      } catch (err) {
        console.error('[post-completion] hook failed:', err);
      }
    });
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

export async function unseatKeepTable(
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
      data: { status: 'CONFIRMED', seatedAt: null },
      include: { table: true },
    });
    await logActivity(tx, id, 'UNSEAT_KEEP_TABLE', actorName, {
      note: 'Seating reversed — table kept',
      fromStatus: 'SEATED',
      toStatus: 'CONFIRMED',
      tableId: r.tableId ?? null,
    });
    return updated;
  });
}

export async function releaseTableOwnership(
  restaurantId: string,
  id: string,
  actorName: string
) {
  const r = await assertReservationBelongsToRestaurant(id, restaurantId);
  if (!['PENDING', 'CONFIRMED'].includes(r.status)) {
    throw new BusinessRuleError(`Cannot release table for a reservation with status ${r.status}`);
  }
  if (!r.tableId && (r.combinedTableIds as string[]).length === 0) {
    throw new BusinessRuleError('Reservation does not currently hold a table');
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.update({
      where: { id },
      data: { tableId: null, combinedTableIds: [], returnedToListAt: new Date() },
      include: { table: true },
    });
    await logActivity(tx, id, 'RELEASED_TABLE', actorName, {
      note: 'Table released manually — host action on late reservation',
      fromTableId: r.tableId ?? null,
      fromCombinedTableIds: r.combinedTableIds as string[],
      reservationStatus: r.status,
    });
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
      throw new ConflictError(`Table ${combinedName} is not available at that time`, {
        conflictingReservationId: combinedAvail?.conflictingReservationId,
      });
    }
  }
}
