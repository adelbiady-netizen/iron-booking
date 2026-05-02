import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Override via env vars in production; fall back to dev defaults.
const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    || 'dev@ironbooking.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'dev123';
const ADMIN_FIRST    = process.env.SEED_ADMIN_FIRST    || 'Dev';
const ADMIN_LAST     = process.env.SEED_ADMIN_LAST     || 'Host';

async function main() {
  console.log('Running seed...');

  // ── Restaurant ────────────────────────────────────────────────────────────
  const restaurant = await prisma.restaurant.upsert({
    where: { slug: 'dev' },
    update: {},
    create: {
      name: 'Iron Booking',
      slug: 'dev',
      timezone: 'America/New_York',
      settings: {
        defaultTurnMinutes: 90,
        slotIntervalMinutes: 15,
        maxPartySize: 20,
        depositRequired: false,
        depositAmountCents: 0,
        autoConfirm: false,
        bufferBetweenTurnsMinutes: 15,
        openingHour: '11:00',
        closingHour: '22:00',
        lastSeatingOffset: 60,
      },
    },
  });
  console.log(`Restaurant: ${restaurant.name} (${restaurant.id})`);

  // ── Admin user ────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { restaurantId_email: { restaurantId: restaurant.id, email: ADMIN_EMAIL } },
    update: {},
    create: {
      restaurantId: restaurant.id,
      email:        ADMIN_EMAIL,
      passwordHash,
      firstName:    ADMIN_FIRST,
      lastName:     ADMIN_LAST,
      role:         'ADMIN',
    },
  });
  console.log(`User: ${user.email}`);

  // ── Operating hours (Mon–Sun, closed Sunday) ──────────────────────────────
  for (let day = 0; day <= 6; day++) {
    await prisma.operatingHour.upsert({
      where: { restaurantId_dayOfWeek: { restaurantId: restaurant.id, dayOfWeek: day } },
      update: {},
      create: {
        restaurantId: restaurant.id,
        dayOfWeek:    day,
        openTime:     '11:00',
        closeTime:    '22:00',
        lastSeating:  '21:00',
        isOpen:       day !== 0,
      },
    });
  }
  console.log('Operating hours: done');

  // ── Sections ──────────────────────────────────────────────────────────────
  const mainDining = await prisma.section.upsert({
    where:  { restaurantId_name: { restaurantId: restaurant.id, name: 'Main Dining' } },
    update: {},
    create: { restaurantId: restaurant.id, name: 'Main Dining', color: '#6366f1', sortOrder: 1 },
  });
  const bar = await prisma.section.upsert({
    where:  { restaurantId_name: { restaurantId: restaurant.id, name: 'Bar' } },
    update: {},
    create: { restaurantId: restaurant.id, name: 'Bar', color: '#f59e0b', sortOrder: 2 },
  });
  const patio = await prisma.section.upsert({
    where:  { restaurantId_name: { restaurantId: restaurant.id, name: 'Patio' } },
    update: {},
    create: { restaurantId: restaurant.id, name: 'Patio', color: '#10b981', sortOrder: 3 },
  });
  console.log(`Sections: ${mainDining.name}, ${bar.name}, ${patio.name}`);

  // ── Tables ────────────────────────────────────────────────────────────────
  const tables = [
    // Main Dining — 5 tables
    { name: 'T1', sectionId: mainDining.id, minCovers: 2, maxCovers: 4, shape: 'RECTANGLE' as const, posX: 50,  posY: 50  },
    { name: 'T2', sectionId: mainDining.id, minCovers: 2, maxCovers: 4, shape: 'RECTANGLE' as const, posX: 200, posY: 50  },
    { name: 'T3', sectionId: mainDining.id, minCovers: 4, maxCovers: 6, shape: 'ROUND'     as const, posX: 350, posY: 50  },
    { name: 'T4', sectionId: mainDining.id, minCovers: 4, maxCovers: 8, shape: 'RECTANGLE' as const, posX: 50,  posY: 200 },
    { name: 'T5', sectionId: mainDining.id, minCovers: 2, maxCovers: 4, shape: 'BOOTH'     as const, posX: 200, posY: 200 },
    // Bar — 2 stools
    { name: 'B1', sectionId: bar.id,        minCovers: 1, maxCovers: 2, shape: 'SQUARE'    as const, posX: 50,  posY: 50  },
    { name: 'B2', sectionId: bar.id,        minCovers: 1, maxCovers: 2, shape: 'SQUARE'    as const, posX: 150, posY: 50  },
    // Patio — 2 tables
    { name: 'P1', sectionId: patio.id,      minCovers: 2, maxCovers: 4, shape: 'ROUND'     as const, posX: 50,  posY: 50  },
    { name: 'P2', sectionId: patio.id,      minCovers: 4, maxCovers: 6, shape: 'RECTANGLE' as const, posX: 200, posY: 50  },
  ];

  for (const t of tables) {
    await prisma.table.upsert({
      where:  { restaurantId_name: { restaurantId: restaurant.id, name: t.name } },
      update: {},
      create: { restaurantId: restaurant.id, ...t },
    });
  }
  console.log(`Tables: ${tables.map(t => t.name).join(', ')}`);

  // ── Sample VIP guest ──────────────────────────────────────────────────────
  await prisma.guest.upsert({
    where:  { restaurantId_email: { restaurantId: restaurant.id, email: 'vip@example.com' } },
    update: {},
    create: {
      restaurantId:  restaurant.id,
      firstName:     'Victoria',
      lastName:      'Pierce',
      email:         'vip@example.com',
      phone:         '555-0001',
      isVip:         true,
      tags:          ['regular', 'wine-lover'],
      allergies:     ['nuts'],
      preferences:   { seatingPref: 'window' },
      internalNotes: 'Always greet by first name. Prefers Burgundy.',
    },
  });

  console.log('Seed complete.');
  console.log('─────────────────────────────────────────────');
  console.log(`Login: POST /api/auth/login`);
  console.log(`       { "email": "${ADMIN_EMAIL}", "password": "${ADMIN_PASSWORD}" }`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Dev:   POST /api/auth/dev-login`);
    console.log(`       { "email": "${ADMIN_EMAIL}" }`);
  }
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
