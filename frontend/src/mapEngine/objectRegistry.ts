import type { FloorObjKind, FloorObjectData, VariantId } from '../types';

// Re-export so mapEngine/index.ts can forward VariantId without change.
export type { VariantId } from '../types';

// ── Canonical type vocabulary ─────────────────────────────────────────────────

export type ObjectCategory =
  | 'FURNITURE'      // seating and tables
  | 'ARCHITECTURE'   // structural / permanent elements
  | 'OPERATIONAL'    // staff-facing function objects
  | 'ATMOSPHERE'     // decorative / ambiance objects
  | 'ZONING';        // boundaries that define spatial meaning

export type SnapCategory =
  | 'WALL'       // snaps to room perimeter / other walls
  | 'FURNITURE'  // snaps to adjacent furniture with collision padding
  | 'ZONE'       // free-placed area overlay; no collision
  | 'FREE';      // no snap constraints

export type RenderMode = 'HTML' | 'SVG';

export type TableFamily =
  | 'BOOTH'
  | 'BAR_SEATING'
  | 'LOUNGE'
  | 'VIP'
  | 'COMMUNAL'
  | 'ROUND_DINING'
  | 'RECT_DINING';

export type MaterialId =
  | 'WALNUT'
  | 'SMOKED_STONE'
  | 'BRASS_EDGE'
  | 'CHARCOAL_GLASS'
  | 'TERRACOTTA'
  | 'UPHOLSTERY'
  | 'TERRACE_STONE'
  | 'DEFAULT';

/**
 * Named attachment faces used by modular furniture to declare which sides
 * can snap or chain to adjacent segments of the same or compatible kind.
 */
export type AttachmentPoint = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM' | 'CENTER';


/**
 * Optional geometry descriptor for objects whose shape goes beyond a plain
 * bounding rectangle. Renderers may use these hints to choose an SVG path
 * strategy; placement/collision logic always uses the bounding box.
 *
 * All fields are optional — omitting this block means 'RECT' / 'DEFAULT'.
 */
export interface GeometryHints {
  /** Primary geometric shape class of this object kind. */
  shape?: 'RECT' | 'ARC' | 'CURVE' | 'U_SHAPE' | 'L_SHAPE' | 'LINEAR';

  /** Suggested arc or corner radius in canvas-px (hint only). */
  radiusHint?: number;

  /** Arc sweep in degrees for ARC/CURVE shapes (hint only). */
  arcDegrees?: number;

  /** Number of equal segments for MODULAR variants (hint only). */
  segmentCount?: number;

  /**
   * Named attachment faces for modular snap logic.
   * e.g. ['LEFT', 'RIGHT'] for a linear booth segment.
   */
  attachmentPoints?: AttachmentPoint[];

  /**
   * Preferred render layer relative to table objects.
   * Defaults to 'DEFAULT' (renderer decides, currently always under tables).
   */
  zLayerHint?: 'UNDER_TABLES' | 'OVER_TABLES' | 'DEFAULT';
}

/** All addressable map object kinds — both floor objects and table families. */
export type MapObjectKind = FloorObjKind | TableFamily;

// ── ObjectDefinition ──────────────────────────────────────────────────────────

export interface ObjectDefinition {
  /** Human-readable display name shown in editor palette and inspector. */
  label: string;

  /** Broad grouping for palette organization. */
  category: ObjectCategory;

  /** One-sentence hint shown to map authors in future editor UIs. */
  editorDescription: string;

  // Dimensions (px in canvas space)
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;

  // Authoring capabilities — governs what the editor allows on this object
  rotatable: boolean;
  resizable: boolean;
  selectable: boolean;
  canRename: boolean;
  canDelete: boolean;

  /** Governs snap-to-grid and proximity-snap behavior in the editor. */
  snapCategory: SnapCategory;

  /** Minimum clear-space radius around this object (collision/overlap detection). */
  collisionPadding: number;

  /** Whether this kind is drawn by ArchLayer (SVG) or as an HTML div. */
  renderMode: RenderMode;

  /** Variant names this kind supports. */
  allowedVariants: VariantId[];

  /** Material presets applicable to this kind. */
  allowedMaterials: MaterialId[];

  /**
   * 0 = background / decoration; higher = more operationally significant.
   * Used for future z-ordering and focus filtering.
   */
  operationalPriority: number;

  /** Short staff-facing description of what this object does operationally. */
  operationalPurpose?: string;

  /**
   * If set, this object is visible to guests on public-facing floor views.
   * The string is the label guests see (e.g. "Bar", "Entrance").
   */
  guestVisibleHint?: string;

  /**
   * Optional geometry descriptor for non-rectangular or future curved objects.
   * Omitting this field implies RECT / DEFAULT — no renderer behavior changes.
   */
  geometryHints?: GeometryHints;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const OBJECT_REGISTRY: Record<MapObjectKind, ObjectDefinition> = {

  // ── Floor objects ────────────────────────────────────────────────────────────

  WALL: {
    label: 'Wall',
    category: 'ARCHITECTURE',
    editorDescription: 'Solid structural wall. Blocks sightlines and circulation.',
    defaultWidth: 200, defaultHeight: 12,
    minWidth: 20,  minHeight: 6,
    maxWidth: 800, maxHeight: 60,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'WALL',
    collisionPadding: 0,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['SMOKED_STONE', 'DEFAULT'],
    operationalPriority: 0,
    operationalPurpose: 'Room perimeter boundary',
    geometryHints: { shape: 'LINEAR' },
  },

  DIVIDER: {
    label: 'Divider',
    category: 'ARCHITECTURE',
    editorDescription: 'Partial-height partition. Can be glass, panel, greenery, or a low railing.',
    defaultWidth: 160, defaultHeight: 8,
    minWidth: 20,  minHeight: 4,
    maxWidth: 600, maxHeight: 120,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'WALL',
    collisionPadding: 4,
    renderMode: 'HTML',
    allowedVariants: ['PANEL', 'GLASS', 'LOW', 'GREENERY'],
    allowedMaterials: ['CHARCOAL_GLASS', 'SMOKED_STONE', 'TERRACE_STONE', 'DEFAULT'],
    operationalPriority: 1,
    operationalPurpose: 'Partial-height section separator',
    geometryHints: { shape: 'LINEAR' },
  },

  BAR: {
    label: 'Bar',
    category: 'OPERATIONAL',
    editorDescription: 'Service bar counter. Drives bar-stool chair rendering on adjacent seats.',
    defaultWidth: 240, defaultHeight: 60,
    minWidth: 60,  minHeight: 30,
    maxWidth: 700, maxHeight: 200,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'WALL',
    collisionPadding: 8,
    renderMode: 'HTML',
    allowedVariants: ['STRAIGHT', 'ISLAND', 'COUNTER'],
    allowedMaterials: ['WALNUT', 'SMOKED_STONE', 'BRASS_EDGE', 'DEFAULT'],
    operationalPriority: 4,
    operationalPurpose: 'Service counter — influences adjacent bar seating',
    guestVisibleHint: 'Bar',
  },

  ENTRANCE: {
    label: 'Entrance',
    category: 'OPERATIONAL',
    editorDescription: 'Entry/exit point. Indicates guest arrival flow.',
    defaultWidth: 80, defaultHeight: 40,
    minWidth: 30, minHeight: 20,
    maxWidth: 200, maxHeight: 100,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'WALL',
    collisionPadding: 16,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['DEFAULT'],
    operationalPriority: 5,
    operationalPurpose: 'Guest arrival and departure point',
    guestVisibleHint: 'Entrance',
  },

  ZONE: {
    label: 'Zone',
    category: 'ZONING',
    editorDescription: 'Named area overlay. Adds semantic grouping without blocking circulation.',
    defaultWidth: 220, defaultHeight: 160,
    minWidth: 60,  minHeight: 40,
    maxWidth: 900, maxHeight: 700,
    rotatable: false, resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'ZONE',
    collisionPadding: 0,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['DEFAULT'],
    operationalPriority: 0,
    operationalPurpose: 'Named area for section organization',
    geometryHints: { shape: 'RECT', zLayerHint: 'UNDER_TABLES' },
  },

  PLANTER: {
    label: 'Planter',
    category: 'ATMOSPHERE',
    editorDescription: 'Living greenery element. Variants: pot, trough row, or privacy hedge.',
    defaultWidth: 50, defaultHeight: 50,
    minWidth: 20, minHeight: 20,
    maxWidth: 400, maxHeight: 200,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FREE',
    collisionPadding: 6,
    renderMode: 'SVG',
    allowedVariants: ['POT', 'ROW', 'PRIVACY'],
    allowedMaterials: ['TERRACOTTA', 'DEFAULT'],
    operationalPriority: 0,
    operationalPurpose: 'Decorative greenery element',
  },

  HOST_STAND: {
    label: 'Host Stand',
    category: 'OPERATIONAL',
    editorDescription: 'Front-of-house station where hosts greet and seat guests.',
    defaultWidth: 60, defaultHeight: 50,
    minWidth: 30, minHeight: 30,
    maxWidth: 120, maxHeight: 100,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FREE',
    collisionPadding: 12,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['BRASS_EDGE', 'WALNUT', 'DEFAULT'],
    operationalPriority: 6,
    operationalPurpose: 'Host greeting and seating station',
  },

  SERVICE_LANE: {
    label: 'Service Lane',
    category: 'OPERATIONAL',
    editorDescription: 'Dedicated server corridor — keeps service paths clear of guest zones.',
    defaultWidth: 200, defaultHeight: 30,
    minWidth: 60,  minHeight: 16,
    maxWidth: 800, maxHeight: 80,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'ZONE',
    collisionPadding: 0,
    renderMode: 'SVG',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['DEFAULT'],
    operationalPriority: 3,
    operationalPurpose: 'Staff circulation corridor',
    geometryHints: { shape: 'LINEAR', zLayerHint: 'UNDER_TABLES' },
  },

  LOUNGE_BOUNDARY: {
    label: 'Lounge Boundary',
    category: 'ZONING',
    editorDescription: 'Soft zoning boundary for lounge or cocktail areas.',
    defaultWidth: 240, defaultHeight: 160,
    minWidth: 80,  minHeight: 60,
    maxWidth: 900, maxHeight: 700,
    rotatable: false, resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'ZONE',
    collisionPadding: 0,
    renderMode: 'SVG',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['UPHOLSTERY', 'DEFAULT'],
    operationalPriority: 1,
    operationalPurpose: 'Soft boundary for lounge seating area',
    guestVisibleHint: 'Lounge',
    geometryHints: { shape: 'RECT', zLayerHint: 'UNDER_TABLES' },
  },

  VIP_ENCLOSURE: {
    label: 'VIP Enclosure',
    category: 'ZONING',
    editorDescription: 'Premium enclosed or semi-private area for VIP seating.',
    defaultWidth: 240, defaultHeight: 160,
    minWidth: 80,  minHeight: 60,
    maxWidth: 900, maxHeight: 700,
    rotatable: false, resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'ZONE',
    collisionPadding: 0,
    renderMode: 'SVG',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['BRASS_EDGE', 'WALNUT', 'DEFAULT'],
    operationalPriority: 2,
    operationalPurpose: 'Premium enclosed area for VIP seating',
    guestVisibleHint: 'Private dining',
    geometryHints: { shape: 'RECT', zLayerHint: 'UNDER_TABLES' },
  },

  CURVED_LOUNGE_BOUNDARY: {
    label: 'Curved Lounge',
    category: 'ZONING',
    editorDescription: 'Elliptical soft boundary for organic or curved lounge areas. Renders as a gold-outlined ellipse.',
    defaultWidth: 260, defaultHeight: 180,
    minWidth: 80,  minHeight: 60,
    maxWidth: 900, maxHeight: 700,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'ZONE',
    collisionPadding: 0,
    renderMode: 'SVG',
    allowedVariants: ['DEFAULT', 'CURVED'],
    allowedMaterials: ['UPHOLSTERY', 'DEFAULT'],
    operationalPriority: 1,
    operationalPurpose: 'Organic elliptical boundary for curved lounge areas',
    guestVisibleHint: 'Lounge',
    geometryHints: {
      shape: 'ARC',
      radiusHint: 90,
      arcDegrees: 360,
      zLayerHint: 'UNDER_TABLES',
    },
  },

  CURVED_BOOTH_SEGMENT: {
    label: 'Curved Booth',
    category: 'FURNITURE',
    editorDescription: 'Premium curved booth segment. Decorative plan-view furniture for lounge and dining layouts.',
    defaultWidth: 140, defaultHeight: 72,
    minWidth: 80,  minHeight: 48,
    maxWidth: 360, maxHeight: 120,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 24,
    renderMode: 'SVG',
    allowedVariants: ['DEFAULT', 'CURVED', 'ARC_LEFT', 'ARC_RIGHT'],
    allowedMaterials: ['UPHOLSTERY', 'WALNUT', 'DEFAULT'],
    operationalPriority: 2,
    operationalPurpose: 'Premium curved booth seating for lounge and dining areas',
    guestVisibleHint: 'Booth',
    geometryHints: {
      shape: 'CURVE',
      radiusHint: 60,
      arcDegrees: 120,
      segmentCount: 1,
      attachmentPoints: ['LEFT', 'RIGHT'],
      zLayerHint: 'UNDER_TABLES',
    },
  },

  // ── Table families ───────────────────────────────────────────────────────────

  RECT_DINING: {
    label: 'Dining Table',
    category: 'FURNITURE',
    editorDescription: 'Standard rectangular dining table. The default family for most covers.',
    defaultWidth: 120, defaultHeight: 72,
    minWidth: 60,  minHeight: 50,
    maxWidth: 300, maxHeight: 180,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 32,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['WALNUT', 'SMOKED_STONE', 'DEFAULT'],
    operationalPriority: 3,
    operationalPurpose: 'Standard rectangular dining table',
  },

  ROUND_DINING: {
    label: 'Round Table',
    category: 'FURNITURE',
    editorDescription: 'Circular or oval dining table. Promotes conversation; good for 2–6 covers.',
    defaultWidth: 80, defaultHeight: 80,
    minWidth: 50,  minHeight: 50,
    maxWidth: 200, maxHeight: 200,
    rotatable: false, resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 32,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['WALNUT', 'SMOKED_STONE', 'DEFAULT'],
    operationalPriority: 3,
    operationalPurpose: 'Round or oval dining table',
  },

  BOOTH: {
    label: 'Booth',
    category: 'FURNITURE',
    editorDescription: 'Fixed banquette seating. High privacy; suited to intimate dining.',
    defaultWidth: 140, defaultHeight: 72,
    minWidth: 80,  minHeight: 60,
    maxWidth: 400, maxHeight: 160,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'WALL',
    collisionPadding: 8,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['UPHOLSTERY', 'WALNUT', 'DEFAULT'],
    operationalPriority: 3,
    operationalPurpose: 'Fixed banquette seating',
  },

  BAR_SEATING: {
    label: 'Bar Seat',
    category: 'FURNITURE',
    editorDescription: 'Counter-height bar stool seating. Renders circular stools facing the bar.',
    defaultWidth: 100, defaultHeight: 48,
    minWidth: 40,  minHeight: 32,
    maxWidth: 300, maxHeight: 80,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 12,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['WALNUT', 'DEFAULT'],
    operationalPriority: 3,
    operationalPurpose: 'Counter-height bar stool seating',
  },

  LOUNGE: {
    label: 'Lounge Table',
    category: 'FURNITURE',
    editorDescription: 'Low lounge or cocktail table with soft seating around it.',
    defaultWidth: 80, defaultHeight: 80,
    minWidth: 40,  minHeight: 40,
    maxWidth: 200, maxHeight: 200,
    rotatable: false, resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 36,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['UPHOLSTERY', 'WALNUT', 'DEFAULT'],
    operationalPriority: 2,
    operationalPurpose: 'Low lounge or cocktail table',
  },

  VIP: {
    label: 'VIP Table',
    category: 'FURNITURE',
    editorDescription: 'Premium table inside a VIP enclosure or private room.',
    defaultWidth: 120, defaultHeight: 80,
    minWidth: 60,  minHeight: 50,
    maxWidth: 300, maxHeight: 200,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 40,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['BRASS_EDGE', 'WALNUT', 'DEFAULT'],
    operationalPriority: 4,
    operationalPurpose: 'Premium table in private or VIP area',
  },

  COMMUNAL: {
    label: 'Communal Table',
    category: 'FURNITURE',
    editorDescription: 'Large shared table (8+ covers). Common in breweries, food halls, and events.',
    defaultWidth: 240, defaultHeight: 88,
    minWidth: 120, minHeight: 60,
    maxWidth: 600, maxHeight: 160,
    rotatable: true,  resizable: true,  selectable: true,
    canRename: true,  canDelete: true,
    snapCategory: 'FURNITURE',
    collisionPadding: 32,
    renderMode: 'HTML',
    allowedVariants: ['DEFAULT'],
    allowedMaterials: ['WALNUT', 'SMOKED_STONE', 'DEFAULT'],
    operationalPriority: 3,
    operationalPurpose: 'Large shared communal dining table',
  },
};

// ── Capability helpers ────────────────────────────────────────────────────────

export function getObjectDefinition(kind: MapObjectKind): ObjectDefinition {
  return OBJECT_REGISTRY[kind];
}

export function canRotateObject(kind: MapObjectKind): boolean {
  return OBJECT_REGISTRY[kind].rotatable;
}

export function canResizeObject(kind: MapObjectKind): boolean {
  return OBJECT_REGISTRY[kind].resizable;
}

export function canSelectObject(kind: MapObjectKind): boolean {
  return OBJECT_REGISTRY[kind].selectable;
}

export function canRenameObject(kind: MapObjectKind): boolean {
  return OBJECT_REGISTRY[kind].canRename;
}

export function canDeleteObject(kind: MapObjectKind): boolean {
  return OBJECT_REGISTRY[kind].canDelete;
}

export function getDefaultObjectDimensions(kind: MapObjectKind): { width: number; height: number } {
  const def = OBJECT_REGISTRY[kind];
  return { width: def.defaultWidth, height: def.defaultHeight };
}

export function getObjectCollisionPadding(kind: MapObjectKind): number {
  return OBJECT_REGISTRY[kind].collisionPadding;
}

export function getObjectSnapCategory(kind: MapObjectKind): SnapCategory {
  return OBJECT_REGISTRY[kind].snapCategory;
}

export function isSvgRendered(kind: MapObjectKind): boolean {
  return OBJECT_REGISTRY[kind].renderMode === 'SVG';
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function getObjectGeometryHints(kind: MapObjectKind): GeometryHints | undefined {
  return OBJECT_REGISTRY[kind].geometryHints;
}

export function getObjectAllowedVariants(kind: MapObjectKind): VariantId[] {
  return OBJECT_REGISTRY[kind].allowedVariants;
}

export function getObjectZLayerHint(kind: MapObjectKind): 'UNDER_TABLES' | 'OVER_TABLES' | 'DEFAULT' {
  return OBJECT_REGISTRY[kind].geometryHints?.zLayerHint ?? 'DEFAULT';
}

export function hasCurvedGeometry(kind: MapObjectKind): boolean {
  const shape = OBJECT_REGISTRY[kind].geometryHints?.shape;
  return shape === 'ARC' || shape === 'CURVE' || shape === 'U_SHAPE';
}

// ── Modular furniture helpers ─────────────────────────────────────────────────

export function getObjectAttachmentPoints(kind: MapObjectKind): AttachmentPoint[] {
  return OBJECT_REGISTRY[kind].geometryHints?.attachmentPoints ?? [];
}

export function supportsModularAttachment(kind: MapObjectKind): boolean {
  const pts = OBJECT_REGISTRY[kind].geometryHints?.attachmentPoints;
  return pts !== undefined && pts.length > 0;
}

export function getObjectArcDegrees(kind: MapObjectKind): number | undefined {
  return OBJECT_REGISTRY[kind].geometryHints?.arcDegrees;
}

export function getObjectSegmentCount(kind: MapObjectKind): number | undefined {
  return OBJECT_REGISTRY[kind].geometryHints?.segmentCount;
}

// ── Variant resolver ──────────────────────────────────────────────────────────

/**
 * Single frontend source of truth for resolving a floor object's visual variant.
 *
 * Priority:
 *   1. Explicit persisted variant (obj.variant) — validated against allowedVariants.
 *   2. Kind-specific label-based inference (temporary stopgap for CURVED_BOOTH_SEGMENT).
 *   3. First entry in allowedVariants, or DEFAULT.
 */
export function resolveObjectVariant(obj: FloorObjectData): VariantId {
  const allowed = OBJECT_REGISTRY[obj.kind].allowedVariants;

  // 1. Explicit variant — trust only if the registry permits it for this kind.
  if (obj.variant && allowed.includes(obj.variant)) {
    return obj.variant;
  }

  // 2. Label-based inference — CURVED_BOOTH_SEGMENT only (temporary until variant persists).
  if (obj.kind === 'CURVED_BOOTH_SEGMENT') {
    const lbl = obj.label.toLowerCase();
    if (lbl.includes('left'))  return 'ARC_LEFT';
    if (lbl.includes('right')) return 'ARC_RIGHT';
    return 'CURVED';
  }

  // 3. Safe fallback.
  return allowed[0] ?? 'DEFAULT';
}
