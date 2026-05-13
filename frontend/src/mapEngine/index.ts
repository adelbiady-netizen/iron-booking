export {
  OBJECT_REGISTRY,
  getObjectDefinition,
  canRotateObject,
  canResizeObject,
  canSelectObject,
  canRenameObject,
  canDeleteObject,
  getDefaultObjectDimensions,
  getObjectCollisionPadding,
  getObjectSnapCategory,
  isSvgRendered,
  getObjectGeometryHints,
  getObjectAllowedVariants,
  getObjectZLayerHint,
  hasCurvedGeometry,
  getObjectAttachmentPoints,
  supportsModularAttachment,
  getObjectArcDegrees,
  getObjectSegmentCount,
  resolveObjectVariant,
} from './objectRegistry';

export type {
  ObjectCategory,
  SnapCategory,
  RenderMode,
  TableFamily,
  MaterialId,
  VariantId,
  AttachmentPoint,
  GeometryHints,
  MapObjectKind,
  ObjectDefinition,
} from './objectRegistry';

export {
  getObjectPlacementFootprint,
  getPlacementPadding,
  clampObjectToCanvasBounds,
  clampObjectSizeToDefinition,
  getSafePlacementForObject,
} from './placement';

export type {
  BoundingBox,
  CanvasSize,
  PlacementFootprint,
} from './placement';
