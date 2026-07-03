/**
 * Table-map layout as a versioned asset for the ATLAS POS sync contract.
 *
 * - bumpLayoutVersion()  — called after every STRUCTURAL table/zone change;
 *                          increments Restaurant.layoutVersion and queues a
 *                          layout.changed signal to ATLAS.
 * - buildLayoutPayload()  — full layout served by GET /api/v1/pos/layout.
 * - buildVersionPayload() — cheap version served by GET /api/v1/pos/layout/version.
 *
 * ATLAS is the consumer; it maps this payload into its own canonical model.
 */

import { prisma } from '../../lib/prisma';
import { queueLayoutChanged } from './dispatcher';

// Iron Booking has no explicit floor entity; sections are the zones. We expose a
// single synthetic floor so the contract's floors[] is always present.
const DEFAULT_FLOOR_ID = 'default';

export async function bumpLayoutVersion(restaurantId: string): Promise<void> {
  const updated = await prisma.restaurant.update({
    where:  { id: restaurantId },
    data:   { layoutVersion: { increment: 1 }, layoutUpdatedAt: new Date() },
    select: { layoutVersion: true },
  });
  await queueLayoutChanged(restaurantId, updated.layoutVersion);
}

export async function buildVersionPayload(restaurantId: string): Promise<{
  layout_id: string;
  layout_version: number;
  updated_at: string;
}> {
  const r = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { layoutVersion: true, layoutUpdatedAt: true },
  });
  return {
    layout_id:      restaurantId,
    layout_version: r?.layoutVersion ?? 0,
    updated_at:     (r?.layoutUpdatedAt ?? new Date()).toISOString(),
  };
}

export async function buildLayoutPayload(restaurantId: string): Promise<unknown> {
  const [r, sections, tables, combinations] = await Promise.all([
    prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { layoutVersion: true, layoutUpdatedAt: true },
    }),
    prisma.section.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } }),
    prisma.table.findMany({ where: { restaurantId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.tableCombination.findMany({ where: { restaurantId, isActive: true } }),
  ]);

  // Build combines_with adjacency from Iron Booking's pairwise combinations.
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const c of combinations) {
    link(c.tableAId, c.tableBId);
    link(c.tableBId, c.tableAId);
  }

  return {
    layout_id:      restaurantId,
    layout_version: r?.layoutVersion ?? 0,
    updated_at:     (r?.layoutUpdatedAt ?? new Date()).toISOString(),
    floors: [{ id: DEFAULT_FLOOR_ID, name: 'Main', sort_order: 0 }],
    zones: sections.map(s => ({
      id:         s.id,
      floor_id:   DEFAULT_FLOOR_ID,
      name:       s.name,
      color:      s.color,
      sort_order: s.sortOrder,
    })),
    tables: tables.map(t => ({
      external_id:   t.id,
      name:          t.name,
      floor_id:      DEFAULT_FLOOR_ID,
      zone_id:       t.sectionId ?? '',
      capacity:      t.maxCovers,
      min_covers:    t.minCovers,
      max_covers:    t.maxCovers,
      pos_x:         t.posX,
      pos_y:         t.posY,
      width:         t.width,
      height:        t.height,
      shape:         t.shape, // ROUND | SQUARE | RECTANGLE | OVAL | BOOTH
      rotation:      t.rotation,
      combinable:    t.isCombinable,
      combines_with: Array.from(adjacency.get(t.id) ?? []),
    })),
  };
}
