import { useMemo } from 'react';
import type { BackendTableSuggestion, FloorObjectData, Table } from '../types';
import SmartTablePicker from './SmartTablePicker';

const PICKER_W = 376;

const OBJ_STYLE: Record<string, { bg: string; border: string; isZone: boolean }> = {
  WALL:     { bg: '#71717abb', border: '#71717a', isZone: false },
  DIVIDER:  { bg: '#52525bbb', border: '#52525b', isZone: false },
  BAR:      { bg: '#92400ebb', border: '#92400e', isZone: false },
  ENTRANCE: { bg: '#1e40afbb', border: '#1e40af', isZone: false },
  ZONE:     { bg: '#37415120', border: '#374151', isZone: true  },
};

function tableShape(shape: string): string {
  if (shape === 'ROUND' || shape === 'OVAL') return '9999px';
  if (shape === 'BOOTH') return '0 0 10px 10px';
  return '8px';
}

interface Props {
  tables: Table[];
  floorObjs: FloorObjectData[];
  suggestions: BackendTableSuggestion[];
  selectedIds: string[];
  onMultiPick: (ids: string[]) => void;
  walkInMode?: boolean;
}

export default function FloorTablePicker({ tables, floorObjs, suggestions, selectedIds, onMultiPick, walkInMode = false }: Props) {
  // Bounding box — must run unconditionally (hooks before any early return)
  const { minX, minY, contentW, contentH, hasLayout } = useMemo(() => {
    const pts = tables.filter(t => t.isActive && (t.posX > 5 || t.posY > 5));
    if (pts.length === 0) {
      return { minX: 0, minY: 0, contentW: 1500, contentH: 800, hasLayout: false };
    }
    const items = [
      ...pts.map(t => ({ x: t.posX, y: t.posY, x2: t.posX + t.width, y2: t.posY + t.height })),
      ...floorObjs.map(o => ({ x: o.posX, y: o.posY, x2: o.posX + o.width, y2: o.posY + o.height })),
    ];
    const pad = 20;
    const minX = Math.max(0, Math.min(...items.map(i => i.x)) - pad);
    const minY = Math.max(0, Math.min(...items.map(i => i.y)) - pad);
    const maxX = Math.max(...items.map(i => i.x2)) + pad;
    const maxY = Math.max(...items.map(i => i.y2)) + pad;
    return { minX, minY, contentW: maxX - minX, contentH: maxY - minY, hasLayout: true };
  }, [tables, floorObjs]);

  const suggMap = useMemo(() => {
    const m = new Map<string, BackendTableSuggestion>();
    for (const s of suggestions) {
      if (s.tableId) m.set(s.tableId, s);
    }
    return m;
  }, [suggestions]);

  if (!hasLayout) {
    return (
      <SmartTablePicker
        tables={tables}
        suggestions={suggestions}
        suggestBusy={false}
        selectedIds={selectedIds}
        onMultiPick={onMultiPick}
        walkInMode={walkInMode}
      />
    );
  }

  const scale   = PICKER_W / contentW;
  const scaledH = Math.ceil(contentH * scale);

  // Counter-scaled font sizes so text stays readable regardless of scale
  const nf = Math.max(9,  Math.round(11 / scale));
  const cf = Math.max(7,  Math.round(9  / scale));

  function getStyle(tableId: string, isSel: boolean) {
    if (isSel) {
      return {
        bg: 'rgba(59,130,246,0.28)', border: '#3b82f6', bw: 2,
        shadow: `0 0 0 ${Math.round(3 / scale)}px rgba(59,130,246,0.25)`,
        disabled: false, nameColor: '#93c5fd',
      };
    }
    const s = suggMap.get(tableId);
    if (!s) {
      return { bg: 'rgb(var(--iron-card))', border: 'rgb(var(--iron-border))', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
    }
    // Only hard-conflict / explicit table-block → disable. Capacity mismatches (TOO_SMALL) are advisory.
    const isTableBlocked = s.reasons.some(r => r.code === 'TABLE_BLOCKED');
    const hardBlocked    = s.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED');
    if (hardBlocked) {
      // Walk-in: time-based CONFLICT is overridable — show amber/tight, keep clickable.
      // TABLE_BLOCKED is always hard regardless of mode.
      if (walkInMode && !isTableBlocked) {
        return { bg: 'rgba(245,158,11,0.15)', border: '#fbbf24', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
      }
      return { bg: 'rgba(82,82,91,0.20)', border: '#52525b', bw: 1.5, shadow: undefined, disabled: true, nameColor: '#71717a' };
    }
    switch (s.status) {
      case 'recommended': return { bg: 'rgba(22,163,74,0.22)',  border: '#4ade80', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
      case 'possible':    return { bg: 'rgba(59,130,246,0.12)', border: '#60a5fa', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
      case 'tight':       return { bg: 'rgba(245,158,11,0.15)', border: '#fbbf24', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
      // 'blocked' at this point means TOO_SMALL only — advisory, not a hard block
      case 'blocked':     return { bg: 'rgba(245,158,11,0.15)', border: '#fbbf24', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
      default:            return { bg: 'rgb(var(--iron-card))', border: 'rgb(var(--iron-border))', bw: 1.5, shadow: undefined, disabled: false, nameColor: 'rgb(var(--iron-text))' };
    }
  }

  function toggle(id: string) {
    onMultiPick(
      selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id],
    );
  }

  const positioned = tables.filter(t => t.isActive && (t.posX > 5 || t.posY > 5));

  return (
    <div
      className="rounded-lg border border-iron-border overflow-hidden"
      style={{ width: PICKER_W, height: scaledH }}
    >
      <div
        style={{
          position: 'relative',
          width: contentW,
          height: contentH,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          backgroundColor: 'var(--canvas-bg)',
          backgroundImage: 'radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        {/* Floor objects — walls, zones, bars, etc. */}
        {floorObjs.map(o => {
          const s = OBJ_STYLE[o.kind] ?? OBJ_STYLE['WALL'];
          return (
            <div
              key={o.id}
              style={{
                position: 'absolute',
                left: o.posX - minX,
                top: o.posY - minY,
                width: o.width,
                height: o.height,
                backgroundColor: s.bg,
                border: `1.5px solid ${s.border}`,
                borderRadius: s.isZone ? 8 : 3,
                pointerEvents: 'none',
              }}
            />
          );
        })}

        {/* Clickable table tiles */}
        {positioned.map(t => {
          const isSel = selectedIds.includes(t.id);
          const st    = getStyle(t.id, isSel);
          return (
            <button
              key={t.id}
              type="button"
              disabled={st.disabled}
              onClick={() => toggle(t.id)}
              style={{
                position: 'absolute',
                left: t.posX - minX,
                top:  t.posY - minY,
                width:  t.width,
                height: t.height,
                borderRadius: tableShape(t.shape),
                backgroundColor: st.bg,
                border: `${st.bw}px solid ${st.border}`,
                boxShadow: st.shadow,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: st.disabled ? 'not-allowed' : 'pointer',
                opacity: st.disabled ? 0.4 : 1,
                gap: 1,
                padding: 2,
              }}
            >
              <span style={{ fontSize: nf, fontWeight: 700, color: st.nameColor, lineHeight: 1.1, overflow: 'hidden', maxWidth: '100%' }}>{t.name}</span>
              <span style={{ fontSize: cf, color: 'rgb(var(--iron-muted))', lineHeight: 1 }}>{t.minCovers}–{t.maxCovers}</span>
              {isSel && (
                <span style={{ fontSize: nf, color: '#93c5fd', fontWeight: 800, lineHeight: 1 }}>✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
