/**
 * One-time setup: attach Iron Booking to ATLAS POS and import the table directory.
 *
 * Usage:
 *   npx tsx scripts/setup-pos-attach.ts \
 *     --restaurant-id <uuid> \
 *     --pos-api-base  https://pos-api.example.com \
 *     --hospitality-api-base https://your-api.example.com \
 *     --hospitality-secret <secret-ATLAS-gave-you> \
 *     --pos-secret    <secret-you-choose-for-atlas-to-call-you>
 *
 * What it does:
 *   1. Upserts PosConfig for the restaurant
 *   2. POSTs system.hospitality_attached to ATLAS
 *   3. GETs /hospitality/table-directory from ATLAS
 *   4. Matches ATLAS tables to Iron Booking tables by name, writes atlasTableId
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function arg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || !process.argv[idx + 1]) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return process.argv[idx + 1];
}

async function main() {
  const restaurantId       = arg('--restaurant-id');
  const posApiBase         = arg('--pos-api-base').replace(/\/$/, '');
  const hospitalityApiBase = arg('--hospitality-api-base').replace(/\/$/, '');
  const hospitalitySecret  = arg('--hospitality-secret');
  const posSecret          = arg('--pos-secret');

  // Verify restaurant exists
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) throw new Error(`Restaurant not found: ${restaurantId}`);
  console.log(`Restaurant: ${restaurant.name} (${restaurantId})`);

  // 1. Upsert PosConfig
  const config = await prisma.posConfig.upsert({
    where:  { restaurantId },
    create: { restaurantId, posApiBase, posSecret, hospitalitySecret, attachedAt: null, ackReceivedAt: null },
    update: { posApiBase, posSecret, hospitalitySecret },
  });
  console.log('PosConfig saved.');

  // 2. Send system.hospitality_attached
  const attachEvent = {
    events: [{
      envelope_version: 1,
      event_id:         randomUUID(),
      type:             'system.hospitality_attached',
      version:          1,
      occurred_at:      new Date().toISOString(),
      source:           'hospitality',
      brand_id:         restaurantId,   // use our restaurantId as brand_id placeholder
      location_id:      restaurantId,
      visit_id:         null,
      sequence:         1,
      causation_id:     null,
      payload: {
        hospitality_instance_id: restaurantId,
        hospitality_api_base:    hospitalityApiBase,
        pos_api_base:            posApiBase,
        pos_secret:              posSecret,
        attached_at:             new Date().toISOString(),
      },
    }],
  };

  console.log(`POSTing system.hospitality_attached to ${posApiBase}/api/v1/events/ingest ...`);
  const attachRes = await fetch(`${posApiBase}/api/v1/events/ingest`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${hospitalitySecret}`,
    },
    body: JSON.stringify(attachEvent),
  });

  if (!attachRes.ok) {
    const text = await attachRes.text();
    throw new Error(`Attach failed (${attachRes.status}): ${text}`);
  }
  const attachBody = await attachRes.json() as { accepted: string[]; rejected: unknown[] };
  console.log('Attach response:', attachBody);

  // Record attach timestamp
  await prisma.posConfig.update({
    where: { restaurantId },
    data:  { attachedAt: new Date() },
  });

  // 3. Fetch table directory
  console.log(`\nFetching table directory from ${posApiBase}/api/v1/hospitality/table-directory ...`);
  const dirRes = await fetch(
    `${posApiBase}/api/v1/hospitality/table-directory?location_id=${restaurantId}`,
    { headers: { Authorization: `Bearer ${hospitalitySecret}` } }
  );

  if (!dirRes.ok) {
    const text = await dirRes.text();
    throw new Error(`Table directory failed (${dirRes.status}): ${text}`);
  }

  type AtlasTable = { table_id: string; number: string; name: string | null; section: string; capacity: number; active: boolean };
  const dir = await dirRes.json() as { tables: AtlasTable[] };
  console.log(`  ${dir.tables.length} tables in directory`);

  // 4. Match by name/number → write atlasTableId
  const ironTables = await prisma.table.findMany({ where: { restaurantId } });
  let matched = 0, skipped = 0;

  for (const at of dir.tables) {
    if (!at.active) continue;
    const label = at.name ?? at.number;
    // Match by table name (Iron Booking stores "T1", "Bar 3", etc.)
    const iron = ironTables.find(t =>
      t.name === label ||
      t.name === at.number ||
      t.name === `T${at.number}` ||
      t.name.replace(/\s+/g, '') === label.replace(/\s+/g, '')
    );

    if (!iron) {
      console.log(`  ⚠ No match for ATLAS table ${at.number} "${label}" (id=${at.table_id})`);
      skipped++;
      continue;
    }

    await prisma.table.update({
      where: { id: iron.id },
      data:  { atlasTableId: at.table_id },
    });
    console.log(`  ✓ ${iron.name} → atlasTableId=${at.table_id}`);
    matched++;
  }

  console.log(`\nDone. ${matched} tables matched, ${skipped} skipped.`);
  console.log('ATLAS POS integration is active. Events will arrive at:');
  console.log(`  ${hospitalityApiBase}/api/v1/events/ingest`);
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
