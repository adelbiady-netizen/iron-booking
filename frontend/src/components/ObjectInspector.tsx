import type { FloorObjectData, VariantId } from '../types';
import {
  getObjectDefinition,
  getObjectAllowedVariants,
  canRotateObject,
  canResizeObject,
  canDeleteObject,
  canRenameObject,
  supportsModularAttachment,
  getObjectAttachmentPoints,
  getObjectArcDegrees,
  getObjectSegmentCount,
  resolveObjectVariant,
} from '../mapEngine';
import { useLocale } from '../i18n/useLocale';
import { formatFloorObjLabel } from '../utils/displayHelpers';

const ATTACHMENT_LABEL: Record<string, string> = {
  LEFT: 'שמאל', RIGHT: 'ימין', TOP: 'למעלה', BOTTOM: 'למטה', CENTER: 'מרכז',
};

const VARIANT_DISPLAY: Partial<Record<VariantId, string>> = {
  DEFAULT:   'ברירת מחדל',
  CURVED:    'מעוגל',
  ARC_LEFT:  'קשת שמאל',
  ARC_RIGHT: 'קשת ימין',
  U_SHAPE:   'צורת U',
  L_SHAPE:   'צורת L',
  MODULAR:   'מודולרי',
};

const CATEGORY_LABEL_HE: Record<string, string> = {
  FURNITURE:    'ריהוט',
  ARCHITECTURE: 'אדריכלות',
  OPERATIONAL:  'תפעולי',
  ATMOSPHERE:   'אווירה',
  ZONING:       'אזורים',
};

const BOOTH_SELECTABLE_VARIANTS = getObjectAllowedVariants('CURVED_BOOTH_SEGMENT')
  .filter(v => v !== 'DEFAULT' && VARIANT_DISPLAY[v] !== undefined);

const BOOTH_CYCLE: VariantId[] = ['CURVED', 'ARC_LEFT', 'ARC_RIGHT'];

function nextBoothVariant(current: VariantId): VariantId {
  const idx = BOOTH_CYCLE.indexOf(current);
  return BOOTH_CYCLE[idx === -1 ? 0 : (idx + 1) % BOOTH_CYCLE.length];
}

function ModRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-iron-muted/45 w-20 shrink-0">{label}</span>
      <span className="text-[9px] text-iron-text/60 font-medium">{value}</span>
    </div>
  );
}

const CATEGORY_STYLE: Record<string, string> = {
  FURNITURE:    'text-sky-400 bg-sky-900/20 border-sky-800/30',
  ARCHITECTURE: 'text-zinc-400 bg-zinc-800/30 border-zinc-700/30',
  OPERATIONAL:  'text-status-warning bg-amber-900/15 border-amber-800/25',
  ATMOSPHERE:   'text-status-success bg-status-success/15 border-status-success/25',
  ZONING:       'text-violet-400 bg-violet-900/15 border-violet-800/25',
};

function CapFlag({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`text-[9px] tracking-wide ${active ? 'text-iron-green-light' : 'text-iron-muted/35'}`}>
      <span className="mr-0.5 font-mono">{active ? '✓' : '—'}</span>{label}
    </span>
  );
}

interface Props {
  obj: FloorObjectData;
  onPatch?: (patch: Partial<FloorObjectData>) => void;
  chainCount?: number;
}

export default function ObjectInspector({ obj, onPatch, chainCount = 0 }: Props) {
  const { locale } = useLocale();
  const def      = getObjectDefinition(obj.kind);
  const catStyle = CATEGORY_STYLE[def.category] ?? 'text-iron-muted border-iron-border/40';
  const label    = formatFloorObjLabel(def.label, locale);

  return (
    <div className="px-4 pt-2.5 pb-2 border-b border-iron-border/40 space-y-1.5">

      {/* Row 1 — identity */}
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-iron-text text-xs font-semibold shrink-0">{label}</span>
        <span className={`text-[9px] px-1.5 py-px rounded border font-semibold tracking-widest uppercase shrink-0 ${catStyle}`}>
          {CATEGORY_LABEL_HE[def.category] ?? def.category}
        </span>
      </div>

      {/* Row 2 — capabilities */}
      <div className="flex items-center gap-3 flex-wrap">
        <CapFlag active label="ניתן להזזה" />
        <CapFlag active={canResizeObject(obj.kind)} label="שינוי גודל" />
        <CapFlag active={canRotateObject(obj.kind)} label="סיבוב" />
        <CapFlag active={canDeleteObject(obj.kind)} label="הסרה" />
        <CapFlag active={canRenameObject(obj.kind)} label="שינוי שם" />
      </div>

      {/* Variant selector — CURVED_BOOTH_SEGMENT only */}
      {obj.kind === 'CURVED_BOOTH_SEGMENT' && (
        <div className="pt-1.5 border-t border-iron-border/25 space-y-1">
          <span className="text-[9px] text-iron-muted/45">וריאנט</span>
          <div className="flex items-center gap-1">
            {BOOTH_SELECTABLE_VARIANTS.map(v => {
              const isActive = resolveObjectVariant(obj) === v;
              return (
                <button
                  key={v}
                  onClick={() => onPatch?.({ variant: v })}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
                    isActive
                      ? 'border-iron-green text-iron-green-light bg-iron-green/10'
                      : 'border-iron-border/40 text-iron-muted/50 hover:text-iron-text/60 hover:border-iron-border/60'
                  }`}
                >
                  {VARIANT_DISPLAY[v]}
                </button>
              );
            })}
            <button
              onClick={() => onPatch?.({ variant: nextBoothVariant(resolveObjectVariant(obj)) })}
              title="החלף וריאנט"
              className="text-[9px] px-1.5 py-0.5 rounded border border-iron-border/30 text-iron-muted/40 hover:text-iron-green-light hover:border-iron-green/40 transition-colors ml-1 font-mono"
            >
              ↻
            </button>
          </div>
        </div>
      )}

      {/* Chain composition summary */}
      {obj.kind === 'CURVED_BOOTH_SEGMENT' && chainCount > 0 && (
        <div className="pt-1 border-t border-iron-border/20 flex items-center gap-2">
          <span className="text-[9px] text-iron-muted/45">קומפוזיציה</span>
          <span className="text-[9px] text-iron-text/55 font-medium">
            {chainCount} {chainCount === 1 ? 'קטע קרוב' : 'קטעים קרובים'}
          </span>
        </div>
      )}

      {/* Modular geometry */}
      {supportsModularAttachment(obj.kind) && (() => {
        const pts    = getObjectAttachmentPoints(obj.kind);
        const arcDeg = getObjectArcDegrees(obj.kind);
        const segs   = getObjectSegmentCount(obj.kind);
        return (
          <div className="pt-1.5 border-t border-iron-border/25 space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-iron-muted/40">
              גיאומטריה מודולרית
            </p>
            <div className="space-y-0.5">
              <ModRow label="חיבורים" value={pts.map(p => ATTACHMENT_LABEL[p] ?? p).join(', ')} />
              {arcDeg !== undefined && <ModRow label="קשת" value={`${arcDeg}°`} />}
              {segs   !== undefined && <ModRow label="קטעים" value={String(segs)} />}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
