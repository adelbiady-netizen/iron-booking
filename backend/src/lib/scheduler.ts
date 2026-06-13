import { prisma } from './prisma';
import { sendReservationReminders } from './reminder';
import { runIntelligenceTick, sendApprovedMoments } from '../modules/intelligence/engine';

// Next tick starts only after the previous tick fully finishes (recursive setTimeout).
// This eliminates overlap by design, but the shouldStop flag + kill-switch check are
// kept as explicit defensive layers for graceful shutdown and env-var kill.
const INTERVAL_MS = 5 * 60 * 1000;

let started    = false;
let shouldStop = false;

// ── Timezone helpers ───────────────────────────────────────────────────────────
// Intentional mirror of the private helpers in reminder.ts — kept separate to
// avoid coupling scheduler to reminder internals.

function localDateYMD(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function localTimeHHmm(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour   = parts.find(p => p.type === 'hour')!.value;
  const minute = parts.find(p => p.type === 'minute')!.value;
  return `${hour}:${minute}`;
}

// ── Tick ───────────────────────────────────────────────────────────────────────

async function runSchedulerTick(dryRun: boolean, allowlist: string[] | null): Promise<void> {
  const now = new Date();

  try {
    const restaurants = await prisma.restaurant.findMany({
      where:  { isSystem: false },
      select: { id: true, name: true, timezone: true, settings: true },
    });

    const eligible = restaurants.filter(r => {
      const s = r.settings as Record<string, unknown>;
      const passesAllowlist = allowlist === null || allowlist.includes(r.id);
      return passesAllowlist && s.smsEnabled === true && s.reminderEnabled !== false;
    });

    console.log(
      `[scheduler] tick | ${now.toISOString()} | total=${restaurants.length} | eligible=${eligible.length}` +
      ` | dryRun=${dryRun}` +
      (allowlist !== null ? ` | allowlist=${allowlist.length}` : '')
    );

    for (const restaurant of eligible) {
      // Per-restaurant isolation: one bad entry must not abort the whole tick
      try {
        const settings    = restaurant.settings as Record<string, unknown>;
        const timezone    = restaurant.timezone ?? 'UTC';
        const localDate   = localDateYMD(timezone, now);
        const localTime   = localTimeHHmm(timezone, now);
        const leadMinutes = typeof settings.reminderLeadMinutes === 'number'
          ? settings.reminderLeadMinutes
          : 60;

        const result = await sendReservationReminders(restaurant.id, localDate, leadMinutes, { dryRun });

        console.log(
          `[scheduler] ${restaurant.name} | restaurantId=${restaurant.id}` +
          ` | localDate=${localDate} | localTime=${localTime}` +
          ` | eligible=${result.total} | sent=${result.sent} | skipped=${result.skipped} | failed=${result.failed.length}` +
          (dryRun ? ` | dryRunWouldSend=${result.dryRunWouldSend ?? 0}` : '')
        );

        if (result.failed.length > 0) {
          console.error(`[scheduler] ${restaurant.name} | FAILED reservations: ${result.failed.join(', ')}`);
        }

        // Guest Intelligence: run nightly at 06:00 local time, send approved moments every tick
        try {
          if (localTime >= '06:00' && localTime < '06:10') {
            await runIntelligenceTick(restaurant.id);
            console.log(`[scheduler] ${restaurant.name} | intelligence tick done`);
          }
          await sendApprovedMoments(restaurant.id);
        } catch (gicErr) {
          console.error(`[scheduler] ${restaurant.name} | GIC error:`, gicErr instanceof Error ? gicErr.message : gicErr);
        }
      } catch (err) {
        console.error(
          `[scheduler] Error processing restaurant ${restaurant.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    // DB query failure — tick is skipped, next scheduled tick will retry
    console.error('[scheduler] Tick DB query failed:', err instanceof Error ? err.message : err);
  }
}

// ── Recursive loop ─────────────────────────────────────────────────────────────
// All config is re-read from env on every cycle so a Render env-var update
// (which triggers a redeploy) takes effect immediately on the new process.

async function schedulerLoop(): Promise<void> {
  // Kill switch: checked on every cycle before doing any work
  if (process.env.REMINDER_SCHEDULER_ENABLED !== 'true' || shouldStop) {
    console.log('[scheduler] Kill switch activated — scheduler loop stopped');
    started = false;
    return;
  }

  const dryRun       = process.env.REMINDER_SCHEDULER_DRY_RUN !== 'false';
  const allowlistEnv = process.env.REMINDER_SCHEDULER_RESTAURANTS?.trim();
  const allowlist    = allowlistEnv
    ? allowlistEnv.split(',').map(s => s.trim()).filter(Boolean)
    : null;

  await runSchedulerTick(dryRun, allowlist);

  // Next tick scheduled only after this one fully completes — no overlap possible
  setTimeout(() => void schedulerLoop(), INTERVAL_MS);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  if (process.env.REMINDER_SCHEDULER_ENABLED !== 'true') {
    console.log('[scheduler] REMINDER_SCHEDULER_ENABLED is not "true" — scheduler disabled');
    return;
  }
  if (started) {
    console.warn('[scheduler] startScheduler() called more than once — ignoring duplicate');
    return;
  }
  started = true;

  const dryRun       = process.env.REMINDER_SCHEDULER_DRY_RUN !== 'false';
  const allowlistEnv = process.env.REMINDER_SCHEDULER_RESTAURANTS?.trim();
  const allowlist    = allowlistEnv
    ? allowlistEnv.split(',').map(s => s.trim()).filter(Boolean)
    : null;

  console.log(
    `[scheduler] Starting | interval=${INTERVAL_MS / 1000}s | dryRun=${dryRun}` +
    (allowlist ? ` | allowlist=[${allowlist.join(', ')}]` : ' | allowlist=none (all eligible)')
  );

  // First tick fires immediately on startup — subsequent ticks follow the interval
  void schedulerLoop();
}

export function stopScheduler(): void {
  if (!started) return;
  shouldStop = true;
  console.log('[scheduler] Stop requested — will halt after current tick completes');
}
