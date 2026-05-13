import type { FloorObjKind } from '../types';
import { OBJECT_REGISTRY, getObjectDefinition } from '../mapEngine';
import type { ObjectCategory } from '../mapEngine';

// Only floor object kinds are addable from the palette.
// Table families are inferred from existing table geometry, not directly created.
const FLOOR_OBJ_KINDS: FloorObjKind[] = [
  'CURVED_BOOTH_SEGMENT',
  'WALL', 'DIVIDER',
  'BAR', 'ENTRANCE', 'HOST_STAND', 'SERVICE_LANE',
  'PLANTER',
  'ZONE', 'LOUNGE_BOUNDARY', 'CURVED_LOUNGE_BOUNDARY', 'VIP_ENCLOSURE',
];

const CATEGORY_ORDER: ObjectCategory[] = [
  'FURNITURE', 'ARCHITECTURE', 'OPERATIONAL', 'ATMOSPHERE', 'ZONING',
];

const CATEGORY_LABEL: Record<ObjectCategory, string> = {
  FURNITURE:    'Furniture',
  ARCHITECTURE: 'Architecture',
  OPERATIONAL:  'Operational',
  ATMOSPHERE:   'Atmosphere',
  ZONING:       'Zoning',
};

interface Props {
  onAdd: (kind: FloorObjKind) => void;
}

export default function ObjectPalette({ onAdd }: Props) {
  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.map(cat => {
        const kinds = FLOOR_OBJ_KINDS.filter(k => OBJECT_REGISTRY[k].category === cat);
        if (kinds.length === 0) return null;
        return (
          <div key={cat}>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-iron-muted/45 mb-1 px-1">
              {CATEGORY_LABEL[cat]}
            </p>
            <div className="space-y-px">
              {kinds.map(kind => {
                const def = getObjectDefinition(kind);
                return (
                  <button
                    key={kind}
                    onClick={() => onAdd(kind)}
                    className="w-full text-left px-2 py-1.5 rounded border border-transparent hover:bg-iron-green/10 hover:border-iron-green/20 transition-colors group"
                  >
                    <span className="text-[11px] font-medium text-iron-text/75 group-hover:text-iron-green-light transition-colors block">
                      + {def.label}
                    </span>
                    {def.operationalPurpose && (
                      <span className="text-[9px] text-iron-muted/45 block mt-px leading-tight truncate">
                        {def.operationalPurpose}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
