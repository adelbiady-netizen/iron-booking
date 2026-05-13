import type { FloorObjKind } from '../types';
import { getObjectDefinition, getObjectCollisionPadding } from './objectRegistry';

// ── Public types ──────────────────────────────────────────────────────────────

export interface BoundingBox {
  posX: number;
  posY: number;
  width: number;
  height: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface PlacementFootprint {
  width: number;
  height: number;
  padding: number;
}

// ── Internal ──────────────────────────────────────────────────────────────────

type ObjWithKind = BoundingBox & { kind: FloorObjKind };

const GRID_STEP     = 40;
const TABLE_CLEARANCE = 4;

function overlaps(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
  gap: number,
): boolean {
  return !(
    ax + aw + gap <= bx ||
    bx + bw + gap <= ax ||
    ay + ah + gap <= by ||
    by + bh + gap <= ay
  );
}

// ── Exported helpers ──────────────────────────────────────────────────────────

export function getObjectPlacementFootprint(kind: FloorObjKind): PlacementFootprint {
  const def = getObjectDefinition(kind);
  return { width: def.defaultWidth, height: def.defaultHeight, padding: def.collisionPadding };
}

export function getPlacementPadding(kind: FloorObjKind): number {
  return getObjectCollisionPadding(kind);
}

export function clampObjectSizeToDefinition(
  kind: FloorObjKind,
  width: number,
  height: number,
): { width: number; height: number } {
  const def = getObjectDefinition(kind);
  return {
    width:  Math.max(def.minWidth,  Math.min(def.maxWidth,  Math.round(width))),
    height: Math.max(def.minHeight, Math.min(def.maxHeight, Math.round(height))),
  };
}

export function clampObjectToCanvasBounds(box: BoundingBox, canvas: CanvasSize): BoundingBox {
  return {
    ...box,
    posX: Math.max(0, Math.min(box.posX, canvas.width  - box.width)),
    posY: Math.max(0, Math.min(box.posY, canvas.height - box.height)),
  };
}

/**
 * Scans the canvas in row-major GRID_STEP increments to find the first
 * position where the new object does not collide with existing floor objects
 * (excluding area overlays) or tables. Falls back to (40, 40).
 *
 * Area overlay objects (collisionPadding === 0) bypass the scan — they
 * are intentionally designed to sit on top of other elements.
 */
export function getSafePlacementForObject(
  kind: FloorObjKind,
  existingObjs: ObjWithKind[],
  tables: BoundingBox[],
  canvas: CanvasSize,
): { x: number; y: number } {
  const def  = getObjectDefinition(kind);
  const w    = def.defaultWidth;
  const h    = def.defaultHeight;
  const pad  = def.collisionPadding;

  // Area overlays go to default — they have no collision semantics.
  if (pad === 0) return { x: 40, y: 40 };

  // Only solid obstacles participate in collision checks.
  const obstacles = existingObjs.filter(o => getObjectCollisionPadding(o.kind) > 0);

  const maxX = canvas.width  - w - GRID_STEP;
  const maxY = canvas.height - h - GRID_STEP;

  for (let cy = GRID_STEP; cy <= maxY; cy += GRID_STEP) {
    for (let cx = GRID_STEP; cx <= maxX; cx += GRID_STEP) {
      const hitsObj = obstacles.some(o =>
        overlaps(cx, cy, w, h, o.posX, o.posY, o.width, o.height, pad),
      );
      if (hitsObj) continue;

      const hitsTable = tables.some(t =>
        overlaps(cx, cy, w, h, t.posX, t.posY, t.width, t.height, TABLE_CLEARANCE),
      );
      if (hitsTable) continue;

      return { x: cx, y: cy };
    }
  }

  return { x: 40, y: 40 };
}
