import app from './app';
import { config } from './config';
import { prisma } from './lib/prisma';
import { startScheduler, stopScheduler } from './lib/scheduler';
import * as bcrypt from 'bcryptjs';
import { addMinutes, areIntervalsOverlapping } from 'date-fns';
import { parseTimeOnDate } from './engine/availability';

// ─── Global crash guards ──────────────────────────────────────────────────────
// Without these, Node silently closes connections when an exception escapes
// the Express error handler (e.g. in a fire-and-forget async call).
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException — process will exit:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  // Do NOT exit — unhandled rejections in fire-and-forget chains are recoverable
});

// ─── One-time startup bootstrap ───────────────────────────────────────────────
// Triggered by BOOTSTRAP_EMAIL + BOOTSTRAP_PASSWORD env vars in Render dashboard.
//
// Behaviour:
//   • No SUPER_ADMIN exists → create one (+ _system restaurant if needed).
//   • SUPER_ADMIN exists AND BOOTSTRAP_EMAIL matches → update password hash only.
//   • SUPER_ADMIN exists AND BOOTSTRAP_EMAIL does NOT match → skip (safety guard).
//
// Safe to leave in place: all paths are non-destructive.
// Remove BOOTSTRAP_* env vars after confirming login works.
async function maybeBootstrapSuperAdmin() {
  const email     = process.env.BOOTSTRAP_EMAIL?.trim();
  const password  = process.env.BOOTSTRAP_PASSWORD?.trim();
  const firstName = process.env.BOOTSTRAP_FIRST?.trim()  ?? 'Admin';
  const lastName  = process.env.BOOTSTRAP_LAST?.trim()   ?? 'User';

  if (!email || !password) return; // vars not set — normal boot, do nothing

  console.log('[Bootstrap] BOOTSTRAP_EMAIL is set — checking SUPER_ADMIN state…');

  const existing = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });

  if (existing) {
    if ((existing.email ?? '').toLowerCase() !== email.toLowerCase()) {
      // Different email — do not touch the existing account.
      console.log(`[Bootstrap] SUPER_ADMIN already exists (${existing.email ?? 'no-email'}) but BOOTSTRAP_EMAIL does not match — skipping.`);
      return;
    }
    // Same email — update the password hash.
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
    console.log(`[Bootstrap] ✅ SUPER_ADMIN password updated — id: ${existing.id}  email: ${existing.email}`);
    console.log('[Bootstrap] Remove BOOTSTRAP_* env vars after confirming login works.');
    return;
  }

  // No SUPER_ADMIN yet — create one.
  const passwordHash = await bcrypt.hash(password, 12);

  const { user } = await prisma.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.upsert({
      where:  { slug: '_system' },
      update: {},
      create: {
        name: 'System', slug: '_system', isSystem: true,
        settings: { defaultTurnMinutes: 90 },
      },
    });
    const user = await tx.user.create({
      data: { restaurantId: restaurant.id, email, passwordHash, firstName, lastName, role: 'SUPER_ADMIN' },
    });
    return { user };
  });

  console.log(`[Bootstrap] ✅ SUPER_ADMIN created — id: ${user.id}  email: ${user.email}  role: ${user.role}`);
  console.log('[Bootstrap] Remove BOOTSTRAP_* env vars after confirming login works.');
}

// ─── One-shot availability diagnostic (TEMPORARY) ────────────────────────────
// Runs once on startup, logs full decision trace for the audit query, then exits.
// Remove after production audit for eataliano-dalla-costa is complete.
async function runAvailabilityDiag() {
  const SLUG      = 'eataliano-dalla-costa';
  const DATE_STR  = '2026-06-20'; // Friday
  const TIME_STR  = '17:30';
  const PARTY     = 5;

  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: SLUG },
      include: { operatingHours: { orderBy: { dayOfWeek: 'asc' } } },
    });
    if (!restaurant) {
      console.log('[AVAIL_DIAG] restaurant not found for slug:', SLUG);
      return;
    }

    const raw = (restaurant.settings ?? {}) as Record<string, unknown>;
    const durationMinutes = (raw['defaultTurnMinutes']        as number) ?? 90;
    const bufferMinutes   = (raw['bufferBetweenTurnsMinutes'] as number) ?? 15;
    const maxOnlineParty  = (raw['maxOnlinePartySize']        as number) ?? 5;

    const date      = new Date(DATE_STR + 'T00:00:00.000Z');
    const dayOfWeek = date.getUTCDay(); // 5 = Friday
    const hours     = restaurant.operatingHours.find(h => h.dayOfWeek === dayOfWeek);

    const slotStart    = parseTimeOnDate(date, TIME_STR);
    const slotEnd      = addMinutes(slotStart, durationMinutes);
    const effStart     = addMinutes(slotStart, -bufferMinutes);
    const effEnd       = addMinutes(slotEnd,    bufferMinutes);
    const slotInterval = { start: effStart, end: effEnd };
    const queryStart   = addMinutes(slotStart, -bufferMinutes - 60);
    const queryEnd     = addMinutes(slotEnd,    bufferMinutes + 60);

    const [allTables, allCombinations, reservations, blocks, restrictions] = await Promise.all([
      prisma.table.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        select: { id: true, name: true, minCovers: true, maxCovers: true, locked: true },
        orderBy: { name: 'asc' },
      }),
      prisma.tableCombination.findMany({
        where: { restaurantId: restaurant.id, isActive: true },
        select: {
          id: true, name: true, tableAId: true, tableBId: true, minCovers: true, maxCovers: true,
          tableA: { select: { id: true, name: true, isActive: true, locked: true } },
          tableB: { select: { id: true, name: true, isActive: true, locked: true } },
        },
      }),
      prisma.reservation.findMany({
        where: {
          restaurantId: restaurant.id,
          date,
          status: { in: ['CONFIRMED', 'SEATED', 'PENDING'] },
          tableId: { not: null },
        },
        select: { id: true, tableId: true, time: true, duration: true, partySize: true, status: true, guestName: true },
      }),
      prisma.blockedPeriod.findMany({
        where: {
          restaurantId: restaurant.id,
          startTime: { lt: queryEnd },
          endTime:   { gt: queryStart },
        },
        select: { tableId: true, startTime: true, endTime: true },
      }),
      prisma.onlineBookingRestriction.findMany({
        where: { restaurantId: restaurant.id, date: DATE_STR, isActive: true },
        select: { startTime: true, endTime: true, guestMessage: true },
      }),
    ]);

    const tableDiag = allTables.map(t => {
      const passesCapacity = t.minCovers <= PARTY && t.maxCovers >= PARTY;
      const tableBlocked   = blocks.some(b =>
        b.tableId === t.id && areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime })
      );
      const conflictingRes = reservations.filter(r => {
        if (r.tableId !== t.id) return false;
        const rStart = parseTimeOnDate(date, r.time);
        return areIntervalsOverlapping(slotInterval, { start: rStart, end: addMinutes(rStart, r.duration) });
      });
      let rejection: string | null = null;
      if (t.locked)          rejection = 'TABLE_LOCKED';
      else if (!passesCapacity) rejection = `CAPACITY_MISMATCH(min=${t.minCovers},max=${t.maxCovers})`;
      else if (tableBlocked) rejection = 'BLOCKED_PERIOD';
      else if (conflictingRes.length) rejection = `CONFLICT:${conflictingRes.map(r => `${r.guestName}@${r.time}[${r.status}]`).join(',')}`;
      return { name: t.name, minCovers: t.minCovers, maxCovers: t.maxCovers, locked: t.locked, available: !rejection, rejection };
    });

    const comboDiag = allCombinations.map(c => {
      const passesCapacity = c.minCovers <= PARTY && c.maxCovers >= PARTY;
      const compIds = [c.tableAId, c.tableBId];
      const anyBlocked = compIds.some(tid =>
        blocks.some(b => b.tableId === tid && areIntervalsOverlapping(slotInterval, { start: b.startTime, end: b.endTime }))
      );
      const conflictingRes = reservations.filter(r =>
        compIds.includes(r.tableId ?? '') &&
        areIntervalsOverlapping(slotInterval, {
          start: parseTimeOnDate(date, r.time),
          end:   addMinutes(parseTimeOnDate(date, r.time), r.duration),
        })
      );
      let rejection: string | null = null;
      if (!passesCapacity)         rejection = `CAPACITY_MISMATCH(min=${c.minCovers},max=${c.maxCovers})`;
      else if (!c.tableA.isActive || c.tableA.locked) rejection = `TABLE_A_BAD(${c.tableA.name})`;
      else if (!c.tableB.isActive || c.tableB.locked) rejection = `TABLE_B_BAD(${c.tableB.name})`;
      else if (anyBlocked)         rejection = 'COMPONENT_BLOCKED';
      else if (conflictingRes.length) rejection = `CONFLICT:${conflictingRes.map(r => `${r.guestName}@${r.time}[${r.status}]`).join(',')}`;
      return { name: c.name, tableA: c.tableA.name, tableB: c.tableB.name, minCovers: c.minCovers, maxCovers: c.maxCovers, available: !rejection, rejection };
    });

    const onlineBlock = restrictions.find(r => !r.startTime || !r.endTime || (TIME_STR >= r.startTime && TIME_STR < r.endTime));
    const availSingle = tableDiag.filter(t => t.available);
    const availCombo  = comboDiag.filter(c => c.available);

    const verdict =
      onlineBlock             ? `ONLINE_RESTRICTION(${onlineBlock.guestMessage ?? ''})` :
      !hours?.isOpen          ? 'CLOSED' :
      TIME_STR < (hours.openTime ?? '') || TIME_STR > (hours.lastSeating ?? '') ? `OUTSIDE_HOURS(${hours.openTime}-${hours.lastSeating})` :
      PARTY > maxOnlineParty  ? `EXCEEDS_MAX_ONLINE_PARTY(limit=${maxOnlineParty})` :
      availSingle.length > 0  ? `AVAILABLE_SINGLE:${availSingle.map(t => t.name).join(',')}` :
      availCombo.length  > 0  ? `AVAILABLE_COMBO:${availCombo.map(c => c.name).join(',')}` :
      'NO_AVAILABILITY';

    // ── Simulate POST /reserve precondition checks (no actual reservation created) ──

    // 1. maxOnlinePartySize gate (same formula as reserve endpoint)
    const reserveBlock_partySize = PARTY > maxOnlineParty
      ? `ONLINE_PARTY_SIZE_LIMIT (partySize=${PARTY} > maxOnlinePartySize=${maxOnlineParty})`
      : null;

    // 2. Online booking restriction (same query as reserve endpoint)
    const reserveOnlineBlock = await prisma.onlineBookingRestriction.findFirst({
      where: {
        restaurantId: restaurant.id,
        date: DATE_STR,
        isActive: true,
        OR: [
          { startTime: null },
          { endTime: null },
          { startTime: { lte: TIME_STR }, endTime: { gt: TIME_STR } },
        ],
      },
      select: { startTime: true, endTime: true, guestMessage: true },
    });
    const reserveBlock_onlineRestriction = reserveOnlineBlock
      ? `ONLINE_BOOKING_BLOCKED (${JSON.stringify(reserveOnlineBlock)})`
      : null;

    // 3. maxOnlineCoversPerWindow gate
    const rawMaxCoversPerWindow = (raw['maxOnlineCoversPerWindow'] as number) ?? 40;
    const slotWindowRes = await prisma.reservation.findMany({
      where: {
        restaurantId: restaurant.id,
        date,
        status: { in: ['CONFIRMED', 'SEATED', 'PENDING'] },
      },
      select: { time: true, duration: true, partySize: true },
    });
    const runningCovers = slotWindowRes.filter(r => {
      const rStart = parseTimeOnDate(date, r.time);
      const rEnd   = addMinutes(rStart, r.duration);
      return areIntervalsOverlapping(slotInterval, { start: rStart, end: rEnd });
    }).reduce((sum, r) => sum + r.partySize, 0);
    const reserveBlock_covers = (runningCovers + PARTY) > rawMaxCoversPerWindow
      ? `ONLINE_CAPACITY_LIMIT (runningCovers=${runningCovers} + partySize=${PARTY} = ${runningCovers + PARTY} > maxOnlineCoversPerWindow=${rawMaxCoversPerWindow})`
      : null;

    // 4. Lead time gate
    const now = new Date();
    const minAdvanceHours = (raw['minAdvanceBookingHours'] as number) ?? 2;
    const minBookingTime  = addMinutes(now, minAdvanceHours * 60);
    const reserveBlock_leadTime = slotStart < minBookingTime
      ? `TOO_SOON (slot=${slotStart.toISOString()} < minBookingTime=${minBookingTime.toISOString()})`
      : null;

    // 5. Table/combination availability inside transaction simulation
    const availableSingleForReserve = tableDiag.filter(t => t.available);
    const availableComboForReserve  = comboDiag.filter(c => c.available);
    const reserveBlock_noTable = availableSingleForReserve.length === 0 && availableComboForReserve.length === 0
      ? 'SLOT_TAKEN (no available table or combination)'
      : null;

    const firstReserveBlock =
      reserveBlock_partySize ??
      reserveBlock_onlineRestriction ??
      reserveBlock_covers ??
      reserveBlock_leadTime ??
      reserveBlock_noTable ??
      null;

    console.log('[AVAIL_DIAG]', JSON.stringify({
      query: { slug: SLUG, date: DATE_STR, time: TIME_STR, partySize: PARTY, dayOfWeek, isOpen: hours?.isOpen, openTime: hours?.openTime, lastSeating: hours?.lastSeating },
      settings: { durationMinutes, bufferMinutes, maxOnlineParty, maxOnlineCoversPerWindow: rawMaxCoversPerWindow, minAdvanceHours },
      slotWindow: { effStart: effStart.toISOString(), effEnd: effEnd.toISOString() },
      tables:       tableDiag,
      combinations: comboDiag,
      reservationsOnDay: reservations.map(r => ({ tableId: r.tableId, name: r.guestName, time: r.time, dur: r.duration, ps: r.partySize, status: r.status })),
      onlineBlock:  onlineBlock ?? null,
      verdict_GET_availability: verdict,
      reserve_checks: {
        partySize:          reserveBlock_partySize          ?? 'PASS',
        onlineRestriction:  reserveBlock_onlineRestriction  ?? 'PASS',
        coversWindow:       reserveBlock_covers             ?? `PASS (runningCovers=${runningCovers}/${rawMaxCoversPerWindow})`,
        leadTime:           reserveBlock_leadTime           ?? `PASS (slot is ${Math.round((slotStart.getTime() - now.getTime()) / 60000)}min from now)`,
        tableAvailability:  reserveBlock_noTable            ?? `PASS (${availableSingleForReserve.length} single, ${availableComboForReserve.length} combo)`,
        FIRST_FAILURE:      firstReserveBlock               ?? 'NONE — reservation would succeed',
      },
    }));
  } catch (e) {
    console.error('[AVAIL_DIAG] error:', e instanceof Error ? e.message : e);
  }
}

// ─── TEMPORARY: Club members audit for Eataliano ─────────────────────────────
// Remove after reading Render logs.
async function runClubMembersAudit() {
  const SLUG = 'eataliano-dalla-costa';
  try {
    const restaurant = await prisma.restaurant.findFirst({
      where: { slug: SLUG },
      select: { id: true, name: true },
    });
    if (!restaurant) {
      console.log('[CLUB_MEMBERS_AUDIT] restaurant not found:', SLUG);
      return;
    }

    const maskPhone = (p: string | null): string => {
      if (!p) return '—';
      const d = p.replace(/\D/g, '');
      if (d.length < 4) return '****';
      return d.slice(0, 3) + '****' + d.slice(-3);
    };

    const [total, active, paused, optedOut, withBday, withAnniv, withBoth, newest] =
      await Promise.all([
        prisma.clubMember.count({ where: { restaurantId: restaurant.id } }),
        prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'ACTIVE' } }),
        prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'PAUSED' } }),
        prisma.clubMember.count({ where: { restaurantId: restaurant.id, status: 'OPTED_OUT' } }),
        prisma.clubMember.count({ where: { restaurantId: restaurant.id, birthday: { not: null } } }),
        prisma.clubMember.count({ where: { restaurantId: restaurant.id, anniversary: { not: null } } }),
        prisma.clubMember.count({ where: { restaurantId: restaurant.id, birthday: { not: null }, anniversary: { not: null } } }),
        prisma.clubMember.findMany({
          where: { restaurantId: restaurant.id },
          orderBy: { joinDate: 'desc' },
          take: 10,
          select: {
            joinDate: true, source: true, status: true,
            birthday: true, anniversary: true,
            guest: { select: { firstName: true, lastName: true, phone: true } },
          },
        }),
      ]);

    console.log('[CLUB_MEMBERS_AUDIT]', JSON.stringify({
      restaurant: restaurant.name,
      counts: { total, active, paused, optedOut, withBirthday: withBday, withAnniversary: withAnniv, withBoth },
      newest10: newest.map(m => ({
        name: `${m.guest.firstName} ${m.guest.lastName}`,
        phone: maskPhone(m.guest.phone),
        joinDate: m.joinDate.toISOString().slice(0, 10),
        source: m.source,
        status: m.status,
        birthday: m.birthday ?? null,
        anniversary: m.anniversary ?? null,
      })),
    }));
  } catch (e) {
    console.error('[CLUB_MEMBERS_AUDIT] error:', e instanceof Error ? e.message : e);
  }
}

// ─── TEMPORARY: Backfill dry-run ─────────────────────────────────────────────
// Remove after reading Render logs.
async function runClubBackfillDryRun() {
  try {
    const { ClubJoinSource } = await import('@prisma/client');
    void ClubJoinSource; // type-only reference

    const candidates = await prisma.reservation.findMany({
      where: { source: 'ONLINE', marketingOptIn: true, guestId: { not: null } },
      select: {
        restaurantId: true,
        guestId:      true,
        birthday:     true,
        anniversary:  true,
        restaurant:   { select: { name: true } },
      },
    });

    const pairs = candidates.map(r => ({ restaurantId: r.restaurantId, guestId: r.guestId! }));
    const existing = pairs.length > 0
      ? await prisma.clubMember.findMany({
          where: { OR: pairs.map(p => ({ restaurantId: p.restaurantId, guestId: p.guestId })) },
          select: { restaurantId: true, guestId: true },
        })
      : [];
    const existingSet = new Set(existing.map(e => `${e.restaurantId}:${e.guestId}`));

    const toCreate = candidates.filter(r => !existingSet.has(`${r.restaurantId}:${r.guestId!}`));

    // Deduplicate per (restaurantId, guestId) — same logic as the write script
    const seen = new Set<string>();
    const deduped = toCreate.filter(r => {
      const key = `${r.restaurantId}:${r.guestId!}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const byRestaurant: Record<string, { name: string; count: number }> = {};
    for (const r of deduped) {
      const entry = byRestaurant[r.restaurantId] ?? { name: r.restaurant.name, count: 0 };
      entry.count++;
      byRestaurant[r.restaurantId] = entry;
    }

    console.log('[CLUB_BACKFILL_DRY_RUN]', JSON.stringify({
      totalCandidates:      candidates.length,
      alreadyMembers:       candidates.length - toCreate.length,
      wouldCreate:          deduped.length,
      withBirthday:         deduped.filter(r => r.birthday).length,
      withAnniversary:      deduped.filter(r => r.anniversary).length,
      byRestaurant:         Object.values(byRestaurant).map(v => ({ restaurant: v.name, wouldCreate: v.count })),
    }));
  } catch (e) {
    console.error('[CLUB_BACKFILL_DRY_RUN] error:', e instanceof Error ? e.message : e);
  }
}

async function main() {
  // ─── BOOT VERSION MARKER ─────────────────────────────────────────────────────
  // If this line does NOT appear in Render logs after a deploy, the new binary
  // is not running — check the build log for compile/seed failures.
  console.log('BOOT VERSION: phase-5b-reminder-scheduler');
  console.log('🔥 SERVER BOOTED AT', new Date().toISOString());

  // Verify DB connection before accepting traffic
  await prisma.$connect();
  console.log('[DB] Connected');

  await runAvailabilityDiag();    // TEMPORARY — remove after eataliano audit
  await runClubMembersAudit();    // TEMPORARY — remove after reading Render logs
  await runClubBackfillDryRun();  // TEMPORARY — remove after reading Render logs
  await maybeBootstrapSuperAdmin();

  const server = app.listen(config.port);

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[Fatal] Failed to start server:', err.message);
    process.exit(1);
  });

  server.on('listening', () => {
    console.log(`[Iron Booking] Server running on port ${config.port} (${config.nodeEnv})`);
    console.log('🔥 SERVER LISTENING');
    startScheduler(); // no-op unless REMINDER_SCHEDULER_ENABLED=true
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[${signal}] Shutting down...`);
    stopScheduler(); // prevent new ticks from being scheduled during shutdown
    server.close(async () => {
      await prisma.$disconnect();
      console.log('[DB] Disconnected');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
