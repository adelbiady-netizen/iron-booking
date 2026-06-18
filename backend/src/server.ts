import app from './app';
import { config } from './config';
import { prisma } from './lib/prisma';
import { startScheduler, stopScheduler } from './lib/scheduler';
import * as bcrypt from 'bcryptjs';

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

async function main() {
  // ─── BOOT VERSION MARKER ─────────────────────────────────────────────────────
  // If this line does NOT appear in Render logs after a deploy, the new binary
  // is not running — check the build log for compile/seed failures.
  console.log('BOOT VERSION: phase-5b-reminder-scheduler');
  console.log('🔥 SERVER BOOTED AT', new Date().toISOString());

  // Verify DB connection before accepting traffic
  await prisma.$connect();
  console.log('[DB] Connected');

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
