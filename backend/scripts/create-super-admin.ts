/**
 * One-time script: create or verify the SUPER_ADMIN user.
 *
 * Usage (Render Shell or locally with DATABASE_URL set):
 *   SUPER_ADMIN_EMAIL=you@example.com \
 *   SUPER_ADMIN_PASSWORD=changeme123 \
 *   SUPER_ADMIN_FIRST=Your \
 *   SUPER_ADMIN_LAST=Name \
 *   npx ts-node --transpile-only scripts/create-super-admin.ts
 *
 * Safe to re-run: exits early if SUPER_ADMIN already exists.
 * Does NOT touch any existing restaurant or host users.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email     = process.env.SUPER_ADMIN_EMAIL?.trim();
  const password  = process.env.SUPER_ADMIN_PASSWORD?.trim();
  const firstName = process.env.SUPER_ADMIN_FIRST?.trim()  ?? 'Admin';
  const lastName  = process.env.SUPER_ADMIN_LAST?.trim()   ?? 'User';

  if (!email || !password) {
    console.error('❌  Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars before running.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌  Password must be at least 8 characters.');
    process.exit(1);
  }

  // ── 1. Guard: abort if a SUPER_ADMIN already exists ──────────────────────────
  const existing = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (existing) {
    console.log('✅  SUPER_ADMIN already exists:');
    console.log(`    id:    ${existing.id}`);
    console.log(`    email: ${existing.email}`);
    console.log(`    role:  ${existing.role}`);
    console.log('\nNo changes made. Log in with the existing credentials.');
    return;
  }

  // ── 2. Upsert the system restaurant ──────────────────────────────────────────
  const restaurant = await prisma.restaurant.upsert({
    where:  { slug: '_system' },
    update: {},
    create: {
      name: 'System', slug: '_system', isSystem: true,
      settings: { defaultTurnMinutes: 90 },
    },
  });
  console.log(`ℹ️   System restaurant: id=${restaurant.id}  slug=${restaurant.slug}`);

  // ── 3. Create the SUPER_ADMIN user ───────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      restaurantId: restaurant.id,
      email,
      passwordHash,
      firstName,
      lastName,
      role: 'SUPER_ADMIN',
    },
  });

  // ── 4. Confirm ────────────────────────────────────────────────────────────────
  console.log('\n✅  SUPER_ADMIN created successfully:');
  console.log(`    id:         ${user.id}`);
  console.log(`    email:      ${user.email}`);
  console.log(`    name:       ${user.firstName} ${user.lastName}`);
  console.log(`    role:       ${user.role}`);
  console.log(`    restaurant: ${restaurant.id} (${restaurant.slug})`);
  console.log('\nYou can now log in at the app. Role-based routing will send you to AdminPortal automatically.');
}

main()
  .catch(err => { console.error('❌  Script failed:', err.message ?? err); process.exit(1); })
  .finally(() => prisma.$disconnect());
