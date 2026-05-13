import type { FloorObjectData } from '../types';
import {
  getObjectDefinition,
  canRotateObject,
  canResizeObject,
  canDeleteObject,
  canRenameObject,
  supportsModularAttachment,
  getObjectAttachmentPoints,
  getObjectArcDegrees,
  getObjectSegmentCount,
} from '../mapEngine';

const ATTACHMENT_LABEL: Record<string, string> = {
  LEFT: 'Left', RIGHT: 'Right', TOP: 'Top', BOTTOM: 'Bottom', CENTER: 'Center',
};

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
  OPERATIONAL:  'text-amber-400 bg-amber-900/15 border-amber-800/25',
  ATMOSPHERE:   'text-emerald-400 bg-emerald-900/15 border-emerald-800/25',
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
}

export default function ObjectInspector({ obj }: Props) {
  const def      = getObjectDefinition(obj.kind);
  const catStyle = CATEGORY_STYLE[def.category] ?? 'text-iron-muted border-iron-border/40';

  return (
    <div className="px-4 pt-2.5 pb-2 border-b border-iron-border/40 space-y-1.5">

      {/* Row 1 — identity + operational purpose */}
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="text-iron-text text-xs font-semibold shrink-0">{def.label}</span>
        <span className={`text-[9px] px-1.5 py-px rounded border font-semibold tracking-widest uppercase shrink-0 ${catStyle}`}>
          {def.category}
        </span>
        {def.operationalPriority > 0 && (
          <span className="text-[9px] text-iron-muted/40 shrink-0 font-mono">P{def.operationalPriority}</span>
        )}
        {def.operationalPurpose && (
          <span className="text-[9px] text-iron-muted/55 truncate">{def.operationalPurpose}</span>
        )}
      </div>

      {/* Row 2 — guest visibility (only when the object is guest-visible) */}
      {def.guestVisibleHint && (
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-iron-muted/50">Guest visible</span>
          <span className="text-[9px] px-1.5 py-px rounded border border-iron-border/30 text-iron-text/50 font-medium">
            "{def.guestVisibleHint}"
          </span>
        </div>
      )}

      {/* Row 3 — semantic capabilities */}
      <div className="flex items-center gap-3 flex-wrap">
        <CapFlag active label="Movable" />
        <CapFlag active={canResizeObject(obj.kind)} label="Resizable" />
        <CapFlag active={canRotateObject(obj.kind)} label="Rotatable" />
        <CapFlag active={canDeleteObject(obj.kind)} label="Removable" />
        <CapFlag active={canRenameObject(obj.kind)} label="Renameable" />
      </div>

      {/* Modular geometry — only for objects that declare attachment points */}
      {supportsModularAttachment(obj.kind) && (() => {
        const pts    = getObjectAttachmentPoints(obj.kind);
        const arcDeg = getObjectArcDegrees(obj.kind);
        const segs   = getObjectSegmentCount(obj.kind);
        return (
          <div className="pt-1.5 border-t border-iron-border/25 space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-iron-muted/40">
              Modular Geometry
            </p>
            <div className="space-y-0.5">
              <ModRow label="Attachment" value={pts.map(p => ATTACHMENT_LABEL[p] ?? p).join(', ')} />
              {arcDeg !== undefined && <ModRow label="Arc" value={`${arcDeg}°`} />}
              {segs   !== undefined && <ModRow label="Segments" value={String(segs)} />}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
