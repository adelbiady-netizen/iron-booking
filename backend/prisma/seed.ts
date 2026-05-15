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

  // ── Guest Hub — Ember & Stone demo ───────────────────────────────────────
  // Mirrors the static mock data in frontend/src/features/guestHub/mockData.ts.
  // Slug "ember-stone" matches /api/public/hub/ember-stone.
  // ISOLATION: no joins to reservations, waitlist, or floor tables.
  const hub = await prisma.guestHub.upsert({
    where:  { slug: 'ember-stone' },
    update: {},
    create: { slug: 'ember-stone', isActive: true },
  });

  await prisma.guestHubBranding.upsert({
    where:  { hubId: hub.id },
    update: {},
    create: {
      hubId:        hub.id,
      name:         'Ember & Stone',
      tagline:      'Where fire meets flavour — an intimate dining experience',
      phone:        '+1 212 555 0190',
      address:      '142 West 57th Street, New York, NY 10019',
      directionsUrl: 'https://maps.google.com/?q=142+West+57th+Street+New+York+NY',
      themePreset:  'luxury',
      primaryColor: '#C9A96E',
      accentColor:  '#A07840',
    },
  });

  // Social links
  const socialLinks = [
    { platform: 'instagram', handle: 'emberandstone',     sortOrder: 0 },
    { platform: 'tiktok',    handle: 'emberandstone',     sortOrder: 1 },
    { platform: 'website',   handle: 'emberandstone.com', sortOrder: 2 },
  ];
  for (const s of socialLinks) {
    await prisma.guestHubSocialLink.upsert({
      where:  { hubId_platform: { hubId: hub.id, platform: s.platform } },
      update: {},
      create: { hubId: hub.id, ...s },
    });
  }

  // Main menu with 6 categories + 5 featured dishes
  const menu = await prisma.guestHubMenu.upsert({
    where:  { hubId_name: { hubId: hub.id, name: 'Dinner Menu' } },
    update: {},
    create: { hubId: hub.id, name: 'Dinner Menu', sortOrder: 0 },
  });

  const categories = [
    { name: 'Starters',       sortOrder: 0 },
    { name: 'Mains',          sortOrder: 1 },
    { name: 'Desserts',       sortOrder: 2 },
    { name: 'Wine & Spirits', sortOrder: 3 },
    { name: 'Cocktails',      sortOrder: 4 },
    { name: 'Non-Alcoholic',  sortOrder: 5 },
  ];
  const categoryMap: Record<string, string> = {};
  for (const c of categories) {
    const cat = await prisma.guestHubMenuCategory.upsert({
      where:  { menuId_name: { menuId: menu.id, name: c.name } },
      update: {},
      create: { menuId: menu.id, ...c },
    });
    categoryMap[c.name] = cat.id;
  }

  // Featured dishes (isFeatured = true, shown in the horizontal carousel)
  const dishes = [
    {
      categoryId: categoryMap['Starters']!,
      name:        'Wagyu Tartare',
      description: 'A5 wagyu, truffle emulsion, quail egg, brioche',
      price:       '$38',
      tag:         "Chef's pick",
      isFeatured:  true,
      sortOrder:   0,
      gradient:    'linear-gradient(135deg, #3D1A0E 0%, #1A0C08 100%)',
    },
    {
      categoryId: categoryMap['Mains']!,
      name:        'Charred Octopus',
      description: 'Smoked paprika, preserved lemon, saffron aioli',
      price:       '$29',
      isFeatured:  true,
      sortOrder:   0,
      gradient:    'linear-gradient(135deg, #0E2030 0%, #081018 100%)',
    },
    {
      categoryId: categoryMap['Mains']!,
      name:        'Saffron Risotto',
      description: 'Aged Parmigiano, black truffle, verjuice reduction',
      price:       '$32',
      tag:         'Seasonal',
      isFeatured:  true,
      sortOrder:   1,
      gradient:    'linear-gradient(135deg, #2A1A06 0%, #130E04 100%)',
    },
    {
      categoryId: categoryMap['Mains']!,
      name:        'Dry-Aged Duck',
      description: '21-day aged, cherry jus, pomme terrine',
      price:       '$44',
      isFeatured:  true,
      sortOrder:   2,
      gradient:    'linear-gradient(135deg, #1A0A0A 0%, #0D0505 100%)',
    },
    {
      categoryId: categoryMap['Desserts']!,
      name:        'Valrhona Soufflé',
      description: '72% dark chocolate, vanilla bean crème',
      price:       '$18',
      isFeatured:  true,
      sortOrder:   0,
      gradient:    'linear-gradient(135deg, #1C0E14 0%, #0D0608 100%)',
    },
  ];
  for (const d of dishes) {
    await prisma.guestHubDish.upsert({
      where:  { categoryId_name: { categoryId: d.categoryId, name: d.name } },
      update: {},
      create: d,
    });
  }

  // Promotions
  const promotions = [
    {
      title:       "Chef's Table — Friday Evening",
      description: 'An exclusive 8-course tasting menu prepared tableside by Chef Marco. Limited to 6 guests per seating.',
      schedule:    'Every Friday from 7:00 pm',
      tag:         'Exclusive',
      tagColor:    'gold',
      sortOrder:   0,
    },
    {
      title:       'Summer Truffle Season',
      description: 'A special menu celebrating the finest summer truffles from Périgord, available through end of August.',
      tag:         'Limited time',
      tagColor:    'stone',
      sortOrder:   1,
    },
    {
      title:       'Sunday Garden Brunch',
      description: 'A relaxed exploration of seasonal produce, from morning pastries to dessert wine.',
      schedule:    'Sundays, 11:00 am – 3:00 pm',
      sortOrder:   2,
    },
  ];
  for (const p of promotions) {
    await prisma.guestHubPromotion.upsert({
      where:  { hubId_title: { hubId: hub.id, title: p.title } },
      update: {},
      create: { hubId: hub.id, ...p },
    });
  }

  // Demo QR token (stable — survives slug renames)
  await prisma.guestHubQrToken.upsert({
    where:  { hubId_label: { hubId: hub.id, label: 'Demo QR' } },
    update: {},
    create: { hubId: hub.id, token: 'demo-qr-ember-stone', label: 'Demo QR' },
  });

  console.log(`Guest Hub: ${hub.slug} (${hub.id})`);

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
