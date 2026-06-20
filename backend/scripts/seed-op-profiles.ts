/**
 * Phase 1 — Seed Restaurant Operating Profiles
 *
 * Creates a RestaurantOpProfile for every non-system restaurant and seeds
 * TurnTimeRules that mirror current production hardcoded behavior:
 *   partySize 1–2 → 90 min
 *   partySize 3+  → 120 min   (matches `partySize >= 3 ? 120 : 90` in booking.router.ts)
 *
 * If a restaurant already has a profile the script skips it — fully idempotent.
 *
 * Italiano special-case: seeds a BookingGroupConfig for 7–8 guests → ספות section
 * using COMBINATION mode. The config is created INACTIVE if no TableCombination
 * records exist for tables in that section — prevents engine from attempting an
 * allocation that can't complete.
 *
 * Run:
 *   DATABASE_URL="..." npx ts-node --transpile-only scripts/seed-op-profiles.ts
 *
 * Safe to re-run. Already-seeded restaurants are skipped.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── helpers ───────────────────────────────────────────────────────────────────

function setting<T>(settings: unknown, key: string, fallback: T): T {
  const s = settings as Record<string, unknown>;
  const v = s?.[key];
  return v !== undefined && v !== null ? (v as T) : fallback;
}

function pad(s: string, n: number) { return s.padEnd(n).slice(0, n); }

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    where: { isSystem: false },
    select: {
      id: true,
      name: true,
      settings: true,
      sections: {
        select: { id: true, name: true },
      },
      tableCombinations: {
        select: {
          id: true,
          tableA: { select: { sectionId: true } },
          tableB: { select: { sectionId: true } },
        },
      },
      opProfile: {
        select: { id: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  console.log(`\n━━━ Seed Operating Profiles ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Found ${restaurants.length} active restaurant(s).\n`);

  // ── per-restaurant profile + turn rules ──────────────────────────────────────

  const profileMap = new Map<string, string>(); // restaurantId → profileId

  for (const r of restaurants) {
    const prefix = `[${pad(r.name, 24)}]`;

    if (r.opProfile) {
      profileMap.set(r.id, r.opProfile.id);
      console.log(`${prefix} OP Profile already exists (${r.opProfile.id.slice(0, 8)}) — skipping.`);
      continue;
    }

    const defaultTurn = setting<number>(r.settings, 'defaultTurnMinutes', 0);
    const maxParty    = setting<number>(r.settings, 'maxPartySize', 20);

    const profile = await prisma.restaurantOpProfile.create({
      data: { restaurantId: r.id, seatingPhilosophy: 'FILL_THEN_NEXT' },
    });

    profileMap.set(r.id, profile.id);

    // Seed TurnTimeRules to mirror the current production heuristic.
    //
    // The booking engine currently uses:
    //   effectiveTurnMinutes = defaultTurnMinutes || (partySize >= 3 ? 120 : 90)
    //
    // Case A — restaurant has a non-default defaultTurnMinutes set:
    //   A single catch-all rule preserves that value for all party sizes.
    //   This is correct: when defaultTurnMinutes is set it overrides the heuristic.
    //
    // Case B — defaultTurnMinutes is 0 / unset / 90 (the seed default):
    //   Seed the 1-2 / 3+ split that matches the hardcoded heuristic exactly.
    //   Both arms produce a value when the other condition would have: no gap.

    const useCustomTurn = defaultTurn > 0 && defaultTurn !== 90;

    if (useCustomTurn) {
      await prisma.turnTimeRule.create({
        data: {
          profileId:       profile.id,
          name:            'Default turn',
          description:     `Seeded from restaurant.settings.defaultTurnMinutes = ${defaultTurn}`,
          partySizeMin:    1,
          partySizeMax:    maxParty,
          durationMinutes: defaultTurn,
          sortOrder:       0,
        },
      });
      console.log(`${prefix} Created profile + 1 TurnTimeRule (catch-all ${defaultTurn} min).`);
    } else {
      await prisma.turnTimeRule.createMany({
        data: [
          {
            profileId:       profile.id,
            name:            'Standard turn — 1 or 2 guests',
            description:     'Mirrors hardcoded heuristic: partySize < 3 → 90 min',
            partySizeMin:    1,
            partySizeMax:    2,
            durationMinutes: 90,
            sortOrder:       0,
          },
          {
            profileId:       profile.id,
            name:            'Extended turn — 3 or more guests',
            description:     'Mirrors hardcoded heuristic: partySize >= 3 → 120 min',
            partySizeMin:    3,
            partySizeMax:    maxParty,
            durationMinutes: 120,
            sortOrder:       1,
          },
        ],
      });
      console.log(`${prefix} Created profile + 2 TurnTimeRules (1–2→90 min, 3+→120 min).`);
    }
  }

  // ── Italiano: BookingGroupConfig for ספות ───────────────────────────────────

  console.log(`\n━━━ Italiano — BookingGroupConfig (7–8 guests → ספות) ━━━━━━━━━━━━━━━`);

  const italiano = restaurants.find(r =>
    r.name.toLowerCase().includes('italiano') ||
    r.name.toLowerCase().includes('איטליאנו') ||
    r.name.toLowerCase().includes('eataliano')
  );

  if (!italiano) {
    console.log('Italiano restaurant not found — skipping group config.\n');
  } else {
    const profileId = profileMap.get(italiano.id)!;

    // Find the ספות / Sofas section (Hebrew or transliterated)
    const sofaSection = italiano.sections.find(s =>
      s.name.includes('ספות') ||
      s.name.toLowerCase().includes('sofa') ||
      s.name.toLowerCase().includes('ספה')
    );

    if (!sofaSection) {
      console.log(`Sections found in ${italiano.name}:`);
      italiano.sections.forEach(s => console.log(`  • ${s.name}`));
      console.log('ספות section not found — skipping group config. Update the name match above if the section has a different name.\n');
    } else {
      // Check for existing TableCombination records in the ספות section
      const sofaCombinations = italiano.tableCombinations.filter(c =>
        c.tableA.sectionId === sofaSection.id ||
        c.tableB.sectionId === sofaSection.id
      );

      const hasCombinations = sofaCombinations.length > 0;

      // Check idempotency
      const existing = await prisma.bookingGroupConfig.findFirst({
        where: { profileId, partySizeMin: 7, partySizeMax: 8 },
      });

      if (existing) {
        console.log(`BookingGroupConfig for 7–8 guests already exists (${existing.id.slice(0, 8)}) — skipping.\n`);
      } else {
        const config = await prisma.bookingGroupConfig.create({
          data: {
            profileId,
            name:            'קבוצות גדולות — ספות',
            description:     '7–8 אורחים: הזמנות אונליין מופנות לאזור הספות עם שילוב 2 שולחנות',
            partySizeMin:    7,
            partySizeMax:    8,
            targetSectionId: sofaSection.id,
            allocationMode:  'COMBINATION',
            tableCount:      2,
            // SAFETY: only activate if the engine can actually fulfill the allocation.
            // An inactive config is visible in the portal but never consulted by the engine.
            isActive:        hasCombinations,
            sortOrder:       0,
          },
        });

        console.log(`Created BookingGroupConfig (${config.id.slice(0, 8)}):`);
        console.log(`  name:            ${config.name}`);
        console.log(`  partySizeMin:    ${config.partySizeMin}`);
        console.log(`  partySizeMax:    ${config.partySizeMax}`);
        console.log(`  targetSection:   ${sofaSection.name} (${sofaSection.id.slice(0, 8)})`);
        console.log(`  allocationMode:  ${config.allocationMode}`);
        console.log(`  tableCount:      ${config.tableCount}`);
        console.log(`  isActive:        ${config.isActive}`);
        if (!hasCombinations) {
          console.log(`\n  ⚠  INACTIVE — no TableCombination records found for tables in "${sofaSection.name}".`);
          console.log(`     Create the table combination in the host UI, then activate via:`);
          console.log(`     UPDATE booking_group_configs SET "isActive" = true WHERE id = '${config.id}';`);
        } else {
          console.log(`  TableCombination records in section: ${sofaCombinations.length}`);
        }
        console.log('');
      }
    }
  }

  // ── Verification summary ──────────────────────────────────────────────────

  console.log(`━━━ Verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const summary = await prisma.$queryRaw<Array<{
    name:           string;
    profile_id:     string | null;
    philosophy:     string | null;
    turn_rules:     bigint;
    time_windows:   bigint;
    group_configs:  bigint;
  }>>`
    SELECT
      r.name,
      p.id                            AS profile_id,
      p."seatingPhilosophy"           AS philosophy,
      COUNT(DISTINCT t.id)            AS turn_rules,
      COUNT(DISTINCT w.id)            AS time_windows,
      COUNT(DISTINCT g.id)            AS group_configs
    FROM restaurants r
    LEFT JOIN restaurant_op_profiles p  ON p."restaurantId" = r.id
    LEFT JOIN turn_time_rules t         ON t."profileId"    = p.id
    LEFT JOIN booking_time_windows w    ON w."profileId"    = p.id
    LEFT JOIN booking_group_configs g   ON g."profileId"    = p.id
    WHERE r."isSystem" = false
    GROUP BY r.name, p.id, p."seatingPhilosophy"
    ORDER BY r.name
  `;

  console.log(`\n${'Restaurant'.padEnd(28)} ${'Profile'.padEnd(10)} ${'Philosophy'.padEnd(16)} TT  TW  GC`);
  console.log('─'.repeat(76));
  for (const row of summary) {
    const profileShort = row.profile_id ? row.profile_id.slice(0, 8) : 'MISSING ⚠';
    console.log(
      `${pad(row.name, 28)} ${pad(profileShort, 10)} ${pad(row.philosophy ?? '—', 16)}  ${String(row.turn_rules).padStart(2)}  ${String(row.time_windows).padStart(2)}  ${String(row.group_configs).padStart(2)}`
    );
  }
  console.log('\nTT = TurnTimeRules  TW = BookingTimeWindows  GC = BookingGroupConfigs');

  const missing = summary.filter(r => !r.profile_id);
  if (missing.length > 0) {
    console.log(`\n⚠  ${missing.length} restaurant(s) still have no OP Profile — re-run the script.`);
    process.exit(1);
  } else {
    console.log(`\n✓  All restaurants have OP Profiles. Migration complete.\n`);
  }
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
