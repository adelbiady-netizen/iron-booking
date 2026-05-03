import { useState, useEffect, useRef } from 'react';
import type { Section, FloorObjectData, FloorObjKind, FloorTable } from '../types';
import { api } from '../api';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName, formatFloorObjLabel } from '../utils/displayHelpers';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ShapeType = 'RECTANGLE' | 'SQUARE' | 'ROUND' | 'OVAL' | 'BOOTH';

interface DraftTable {
  id: string; name: string;
  minCovers: number; maxCovers: number;
  shape: ShapeType;
  sectionId: string | null; section: Section | null;
  isActive: boolean;
  locked: boolean;
  posX: number; posY: number;
  width: number; height: number;
  isNew: boolean; deleted: boolean; dirty: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 1500;
const CANVAS_H = 800;

const SHAPE_DIMS: Record<ShapeType, [number, number]> = {
  RECTANGLE: [120, 72], SQUARE: [80, 80], ROUND: [80, 80], OVAL: [112, 72], BOOTH: [140, 72],
};
const SHAPE_LABELS: Record<ShapeType, string> = {
  RECTANGLE: 'Rectangle', SQUARE: 'Square', ROUND: 'Round', OVAL: 'Oval', BOOTH: 'Booth',
};
// Shape labels are kept in component data (not in T) — they describe geometry, not UI text.
const ALL_SHAPES: ShapeType[] = ['RECTANGLE', 'SQUARE', 'ROUND', 'OVAL', 'BOOTH'];

const SIZE_PRESETS = [
  { label: 'S 2-top',  w: 72,  h: 72,  min: 1, max: 2 },
  { label: 'M 4-top',  w: 100, h: 80,  min: 2, max: 4 },
  { label: 'L 6-top',  w: 132, h: 88,  min: 4, max: 6 },
  { label: 'XL 8-top', w: 160, h: 96,  min: 6, max: 8 },
] as const;

const OBJ_META: Record<FloorObjKind, { label: string; w: number; h: number; color: string }> = {
  WALL:     { label: 'Wall',     w: 200, h: 12,  color: '#71717a' },
  DIVIDER:  { label: 'Divider',  w: 160, h: 8,   color: '#52525b' },
  BAR:      { label: 'Bar',      w: 240, h: 60,  color: '#92400e' },
  ENTRANCE: { label: 'Entrance', w: 80,  h: 40,  color: '#1e40af' },
  ZONE:     { label: 'Zone',     w: 220, h: 160, color: '#374151' },
};

const SNAP_CYCLE: Array<0 | 10 | 20 | 40> = [0, 10, 20, 40];

// Distinct palette — auto-assigned to new sections in order
const SECTION_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#f97316', '#8b5cf6', '#06b6d4',
  '#ef4444', '#84cc16',
];

function nextSectionColor(usedColors: string[]): string {
  const free = SECTION_COLORS.find(c => !usedColors.includes(c));
  return free ?? SECTION_COLORS[usedColors.length % SECTION_COLORS.length];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tableRadius(shape: ShapeType): string {
  if (shape === 'ROUND' || shape === 'OVAL') return '9999px';
  if (shape === 'BOOTH') return '0 0 10px 10px';
  return '8px';
}

let clientSeq = 0;
function newId() { return `__new_${++clientSeq}`; }

// ─── Sub-components ───────────────────────────────────────────────────────────

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 border-b border-iron-border">
      <p className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-2">{title}</p>
      {children}
    </div>
  );
}

function AlignBtn({ label, title, enabled, onClick }: { label: string; title: string; enabled: boolean; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={!enabled}
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors font-mono ${
        enabled
          ? 'border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-green-light'
          : 'border-iron-border/30 text-iron-muted/30 cursor-not-allowed'
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'bg-iron-bg border border-iron-border rounded px-2 py-1 text-iron-text text-xs focus:outline-none focus:border-iron-green';

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { onClose: () => void; onSaved: () => void; }

export default function LayoutEditor({ onClose, onSaved }: Props) {
  const T = useT();
  const { locale } = useLocale();
  const OBJ_LABELS: Record<FloorObjKind, string> = {
    WALL:     T.layoutEditor.objWall,
    DIVIDER:  T.layoutEditor.objDivider,
    BAR:      T.layoutEditor.objBar,
    ENTRANCE: T.layoutEditor.objEntrance,
    ZONE:     T.layoutEditor.objZone,
  };
  const [tables,           setTables]           = useState<DraftTable[]>([]);
  const [sections,         setSections]         = useState<Section[]>([]);
  const [floorObjs,        setFloorObjs]        = useState<FloorObjectData[]>([]);
  const [selectedIds,      setSelectedIds]      = useState<Set<string>>(new Set());
  const [selectedObjId,    setSelectedObjId]    = useState<string | null>(null);
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [snapGrid,         setSnapGrid]         = useState<0 | 10 | 20 | 40>(20);
  const [occupiedIds,      setOccupiedIds]      = useState<Set<string>>(new Set());
  const [confirmState,     setConfirmState]     = useState<{
    message: string;
    suggestion?: string;
    onConfirm: (() => void) | null;
    onCancel?: () => void;
  } | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [saving,           setSaving]           = useState(false);
  const [savedOk,          setSavedOk]          = useState(false);
  const [loadErr,          setLoadErr]          = useState<string | null>(null);
  const [saveErr,          setSaveErr]          = useState<string | null>(null);
  const [showAddSec,       setShowAddSec]       = useState(false);
  const [newSecName,       setNewSecName]       = useState('');
  const [secBusy,          setSecBusy]          = useState(false);
  // marquee: canvas-local rect being drawn (null = not dragging)
  const [marquee,          setMarquee]          = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const dragRef = useRef<{
    kind: 'tables';
    startMX: number; startMY: number;
    origins: Record<string, { x: number; y: number }>;
  } | {
    kind: 'obj';
    id: string;
    startMX: number; startMY: number;
    startPX: number; startPY: number;
  } | {
    kind: 'marquee';
    startCX: number; startCY: number;
    additive: boolean;
  } | null>(null);

  // canvas div ref for coordinate conversion (marquee)
  const canvasDivRef = useRef<HTMLDivElement>(null);

  const snapRef       = useRef(snapGrid);
  snapRef.current     = snapGrid;
  const occupiedRef   = useRef(occupiedIds);
  occupiedRef.current = occupiedIds;
  const tablesRef     = useRef(tables);
  tablesRef.current   = tables;

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.tables.list(),
      api.tables.listSections(),
      api.tables.listFloorObjects(),
    ])
      .then(([ts, secs, fobjs]) => {
        setTables(ts.map(t => ({
          id: t.id, name: t.name,
          minCovers: t.minCovers, maxCovers: t.maxCovers,
          shape: (t.shape as ShapeType) || 'RECTANGLE',
          sectionId: t.section?.id ?? null, section: t.section ?? null,
          isActive: t.isActive,
          locked: t.locked ?? false,
          posX: t.posX ?? 0, posY: t.posY ?? 0,
          width: t.width ?? SHAPE_DIMS['RECTANGLE'][0],
          height: t.height ?? SHAPE_DIMS['RECTANGLE'][1],
          isNew: false, deleted: false, dirty: false,
        })));
        setSections(secs);
        setFloorObjs(fobjs);
        setLoading(false);
      })
      .catch(() => { setLoadErr(T.layoutEditor.errorLoad); setLoading(false); });

    // Live occupancy — best-effort, no spinner
    api.tables.floor(todayStr(), nowTime())
      .then((ft: FloorTable[]) =>
        setOccupiedIds(new Set(ft.filter(t => t.liveStatus === 'OCCUPIED').map(t => t.id)))
      )
      .catch(() => {});
  }, []);

  // ── Drag (tables + floor objects) ─────────────────────────────────────────

  useEffect(() => {
    function snapped(v: number): number {
      const g = snapRef.current;
      return g ? Math.round(v / g) * g : Math.round(v);
    }

    function canvasCoords(e: MouseEvent): { cx: number; cy: number } {
      const rect = canvasDivRef.current?.getBoundingClientRect();
      return rect
        ? { cx: e.clientX - rect.left, cy: e.clientY - rect.top }
        : { cx: 0, cy: 0 };
    }

    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'tables') {
        const dx = e.clientX - d.startMX;
        const dy = e.clientY - d.startMY;
        setTables(prev => prev.map(t => {
          const o = d.origins[t.id];
          if (!o) return t;
          const nx = snapped(Math.max(0, Math.min(CANVAS_W - t.width,  o.x + dx)));
          const ny = snapped(Math.max(0, Math.min(CANVAS_H - t.height, o.y + dy)));
          return { ...t, posX: nx, posY: ny, dirty: !t.isNew };
        }));
      } else if (d.kind === 'obj') {
        const nx = snapped(Math.max(0, d.startPX + e.clientX - d.startMX));
        const ny = snapped(Math.max(0, d.startPY + e.clientY - d.startMY));
        setFloorObjs(prev => prev.map(o => o.id === d.id ? { ...o, posX: nx, posY: ny } : o));
      } else if (d.kind === 'marquee') {
        const { cx, cy } = canvasCoords(e);
        const x = Math.min(d.startCX, cx);
        const y = Math.min(d.startCY, cy);
        setMarquee({ x, y, w: Math.abs(cx - d.startCX), h: Math.abs(cy - d.startCY) });
      }
    }

    function onUp(e: MouseEvent) {
      const d = dragRef.current;
      dragRef.current = null;
      setMarquee(null);

      if (d?.kind === 'tables') {
        const movedOccupied = Object.keys(d.origins).filter(id => occupiedRef.current.has(id));
        if (movedOccupied.length > 0) {
          const origins = d.origins;
          setConfirmState({
            message: T.layoutEditor.confirmOccupiedMove,
            suggestion: T.layoutEditor.confirmMoveGuests,
            onConfirm: () => {},
            onCancel: () => setTables(prev => prev.map(t => {
              const o = origins[t.id];
              return o ? { ...t, posX: o.x, posY: o.y } : t;
            })),
          });
        }
      } else if (d?.kind === 'marquee') {
        const { cx, cy } = canvasCoords(e);
        const mx = Math.min(d.startCX, cx);
        const my = Math.min(d.startCY, cy);
        const mw = Math.abs(cx - d.startCX);
        const mh = Math.abs(cy - d.startCY);

        if (mw < 6 && mh < 6) {
          // Treat as a click: clear selection (already cleared on mousedown unless additive)
          return;
        }

        // Intersect all visible tables with the marquee rect
        const hit = new Set<string>();
        for (const t of tablesRef.current) {
          if (t.deleted) continue;
          if (t.posX < mx + mw && t.posX + t.width  > mx &&
              t.posY < my + mh && t.posY + t.height > my) {
            hit.add(t.id);
          }
        }

        setSelectedIds(prev => {
          if (d.additive) {
            const merged = new Set(prev);
            hit.forEach(id => merged.add(id));
            return merged;
          }
          return hit;
        });
        setSelectedObjId(null);
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

      const step = e.shiftKey ? 40 : 10;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selectedIds.size === 0 && !selectedObjId) return;
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;

        if (selectedIds.size > 0) {
          setTables(prev => prev.map(t => {
            if (!selectedIds.has(t.id) || t.deleted || t.locked) return t;
            return {
              ...t,
              posX: Math.max(0, Math.min(CANVAS_W - t.width,  t.posX + dx)),
              posY: Math.max(0, Math.min(CANVAS_H - t.height, t.posY + dy)),
              dirty: !t.isNew,
            };
          }));
        }
        if (selectedObjId) {
          setFloorObjs(prev => prev.map(o =>
            o.id === selectedObjId
              ? { ...o, posX: Math.max(0, o.posX + dx), posY: Math.max(0, o.posY + dy) }
              : o
          ));
        }
        return;
      }

      if (e.key === 'Escape') {
        if (dragRef.current?.kind === 'marquee') {
          dragRef.current = null;
          setMarquee(null);
        }
        setSelectedIds(new Set());
        setSelectedObjId(null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) { e.preventDefault(); removeSelected(); }
        if (selectedObjId)        { e.preventDefault(); removeFloorObj(selectedObjId); }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedObjId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const visible   = tables.filter(t => !t.deleted);
  const selTables = visible.filter(t => selectedIds.has(t.id));
  const singleSel = selTables.length === 1 ? selTables[0] : null;
  const selObj    = floorObjs.find(o => o.id === selectedObjId) ?? null;

  // ── Table mutations ───────────────────────────────────────────────────────

  function addTable() {
    const id = newId();
    const [w, h] = SHAPE_DIMS['RECTANGLE'];
    const idx = visible.length;
    setTables(prev => [...prev, {
      id, name: `T${idx + 1}`,
      minCovers: 2, maxCovers: 4,
      shape: 'RECTANGLE', sectionId: null, section: null, isActive: true, locked: false,
      posX: 40 + (idx % 7) * 168,
      posY: 40 + Math.floor(idx / 7) * 112,
      width: w, height: h,
      isNew: true, deleted: false, dirty: false,
    }]);
    setSelectedIds(new Set([id]));
    setSelectedObjId(null);
  }

  function patchSelected(patch: Partial<DraftTable>) {
    if (!singleSel) return;
    const id = singleSel.id;

    const doApply = () => setTables(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next = { ...t, ...patch, dirty: !t.isNew };
      if (patch.shape && patch.shape !== t.shape) {
        const [w, h] = SHAPE_DIMS[patch.shape];
        next.width = w; next.height = h;
      }
      return next;
    }));

    const needsConfirm = occupiedIds.has(id) && (
      'shape' in patch || 'sectionId' in patch ||
      'width' in patch || 'height' in patch ||
      ('isActive' in patch && patch.isActive === false)
    );

    if (needsConfirm) {
      setConfirmState({ message: T.layoutEditor.confirmOccupiedEdit, suggestion: T.layoutEditor.confirmMoveGuests, onConfirm: doApply });
      return;
    }
    doApply();
  }

  function removeSelected() {
    const blockedTable = selTables.find(t => occupiedIds.has(t.id));
    if (blockedTable) {
      setConfirmState({
        message: T.layoutEditor.confirmOccupiedDelete(blockedTable.name),
        suggestion: T.layoutEditor.confirmMoveGuestsDel,
        onConfirm: null,
      });
      return;
    }
    for (const t of selTables) {
      if (t.isNew) setTables(prev => prev.filter(x => x.id !== t.id));
      else setTables(prev => prev.map(x => x.id === t.id ? { ...x, deleted: true } : x));
    }
    setSelectedIds(new Set());
  }

  function patchMultiSelected(patch: Partial<DraftTable>) {
    setTables(prev => prev.map(t => {
      if (!selectedIds.has(t.id) || t.deleted) return t;
      const next = { ...t, ...patch, dirty: !t.isNew };
      if (patch.shape && patch.shape !== t.shape) {
        const [w, h] = SHAPE_DIMS[patch.shape];
        next.width = w; next.height = h;
      }
      return next;
    }));
  }

  function rotate90() {
    if (singleSel) {
      patchSelected({ width: singleSel.height, height: singleSel.width });
    } else if (selTables.length > 1) {
      setTables(prev => prev.map(t =>
        selectedIds.has(t.id) && !t.deleted
          ? { ...t, width: t.height, height: t.width, dirty: !t.isNew }
          : t
      ));
    }
  }

  // ── Alignment ─────────────────────────────────────────────────────────────

  function align(op: string) {
    if (selTables.length < 2) return;
    const sel = selTables;
    setTables(prev => {
      const patches = new Map<string, Partial<DraftTable>>();
      switch (op) {
        case 'left':   { const v = Math.min(...sel.map(t => t.posX));            sel.forEach(t => patches.set(t.id, { posX: v })); break; }
        case 'right':  { const v = Math.max(...sel.map(t => t.posX + t.width));  sel.forEach(t => patches.set(t.id, { posX: v - t.width })); break; }
        case 'top':    { const v = Math.min(...sel.map(t => t.posY));            sel.forEach(t => patches.set(t.id, { posY: v })); break; }
        case 'bottom': { const v = Math.max(...sel.map(t => t.posY + t.height)); sel.forEach(t => patches.set(t.id, { posY: v - t.height })); break; }
        case 'ch': {
          const cx = (Math.min(...sel.map(t => t.posX)) + Math.max(...sel.map(t => t.posX + t.width))) / 2;
          sel.forEach(t => patches.set(t.id, { posX: Math.round(cx - t.width / 2) }));
          break;
        }
        case 'cv': {
          const cy = (Math.min(...sel.map(t => t.posY)) + Math.max(...sel.map(t => t.posY + t.height))) / 2;
          sel.forEach(t => patches.set(t.id, { posY: Math.round(cy - t.height / 2) }));
          break;
        }
        case 'dh': {
          if (sel.length < 3) break;
          const sorted = [...sel].sort((a, b) => a.posX - b.posX);
          const totalW = sorted.reduce((s, t) => s + t.width, 0);
          const span   = sorted[sorted.length - 1].posX + sorted[sorted.length - 1].width - sorted[0].posX;
          const gap    = (span - totalW) / (sorted.length - 1);
          let x = sorted[0].posX;
          sorted.forEach(t => { patches.set(t.id, { posX: Math.round(x) }); x += t.width + gap; });
          break;
        }
        case 'dv': {
          if (sel.length < 3) break;
          const sorted = [...sel].sort((a, b) => a.posY - b.posY);
          const totalH = sorted.reduce((s, t) => s + t.height, 0);
          const span   = sorted[sorted.length - 1].posY + sorted[sorted.length - 1].height - sorted[0].posY;
          const gap    = (span - totalH) / (sorted.length - 1);
          let y = sorted[0].posY;
          sorted.forEach(t => { patches.set(t.id, { posY: Math.round(y) }); y += t.height + gap; });
          break;
        }
      }
      return prev.map(t => {
        const p = patches.get(t.id);
        return p ? { ...t, ...p, dirty: !t.isNew } : t;
      });
    });
  }

  // ── Floor objects ─────────────────────────────────────────────────────────

  function addFloorObj(kind: FloorObjKind) {
    const meta = OBJ_META[kind];
    const idx  = floorObjs.length;
    const obj: FloorObjectData = {
      id: newId(), kind, label: meta.label,
      posX: 60 + (idx % 6) * 60, posY: 60 + Math.floor(idx / 6) * 80,
      width: meta.w, height: meta.h,
      rotation: 0, color: null,
    };
    setFloorObjs(prev => [...prev, obj]);
    setSelectedObjId(obj.id);
    setSelectedIds(new Set());
  }

  function patchFloorObj(id: string, patch: Partial<FloorObjectData>) {
    setFloorObjs(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  }

  function removeFloorObj(id: string) {
    setFloorObjs(prev => prev.filter(o => o.id !== id));
    setSelectedObjId(null);
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  async function addSection() {
    if (!newSecName.trim()) return;
    setSecBusy(true);
    try {
      const color = nextSectionColor(sections.map(s => s.color));
      const sec = await api.tables.upsertSection({ name: newSecName.trim(), color });
      setSections(prev => prev.some(s => s.id === sec.id)
        ? prev.map(s => s.id === sec.id ? sec : s)
        : [...prev, sec]);
      setNewSecName(''); setShowAddSec(false);
    } catch { setSaveErr(T.layoutEditor.errorSection); }
    finally { setSecBusy(false); }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function save() {
    setSaving(true); setSaveErr(null); setSavedOk(false);
    try {
      for (const t of tables) {
        if (t.isNew && t.deleted) continue;
        if (t.isNew) {
          await api.tables.create({
            name: t.name,
            ...(t.sectionId ? { sectionId: t.sectionId } : {}),
            minCovers: t.minCovers, maxCovers: t.maxCovers,
            shape: t.shape, posX: t.posX, posY: t.posY, width: t.width, height: t.height,
          });
          continue;
        }
        if (t.deleted) {
          try { await api.tables.remove(t.id); }
          catch { await api.tables.update(t.id, { isActive: false }); }
          continue;
        }
        if (t.dirty) {
          await api.tables.update(t.id, {
            name: t.name, sectionId: t.sectionId,
            minCovers: t.minCovers, maxCovers: t.maxCovers,
            shape: t.shape, isActive: t.isActive, locked: t.locked,
            posX: t.posX, posY: t.posY, width: t.width, height: t.height,
          });
        }
      }
      await api.tables.batchSaveFloorObjects(floorObjs);
      setSavedOk(true);
      setTimeout(() => onSaved(), 1200);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : T.layoutEditor.errorSave);
    } finally { setSaving(false); }
  }

  // ── Loading / error gates ─────────────────────────────────────────────────

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-iron-bg flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (loadErr) return (
    <div className="fixed inset-0 z-50 bg-iron-bg flex flex-col items-center justify-center gap-3">
      <p className="text-red-400 text-sm">{loadErr}</p>
      <button onClick={onClose} className="text-iron-muted text-xs hover:text-iron-text">{T.layoutEditor.backGo}</button>
    </div>
  );

  // ── Snap ──────────────────────────────────────────────────────────────────

  const snapIdx   = SNAP_CYCLE.indexOf(snapGrid);
  const snapLabel = snapGrid === 0 ? T.layoutEditor.snapOff : T.layoutEditor.snapN(snapGrid);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-iron-bg flex flex-col select-none">

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="h-12 shrink-0 border-b border-iron-border bg-iron-card flex items-center gap-3 px-4">
        <button onClick={onClose} className="text-iron-muted hover:text-iron-text text-sm transition-colors">
          {T.layoutEditor.backButton}
        </button>
        <div className="w-px h-4 bg-iron-border" />
        <span className="text-iron-text text-sm font-semibold">{T.layoutEditor.title}</span>
        <span className="text-iron-muted text-xs opacity-50 hidden md:inline">
          {T.layoutEditor.hint}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setSnapGrid(SNAP_CYCLE[(snapIdx + 1) % SNAP_CYCLE.length])}
          title={T.layoutEditor.snapTitle}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            snapGrid
              ? 'border-iron-green/40 text-iron-green-light bg-iron-green/10'
              : 'border-iron-border text-iron-muted hover:text-iron-text'
          }`}
        >
          {snapLabel}
        </button>
        {saveErr && <span className="text-red-400 text-xs max-w-48 truncate">{saveErr}</span>}
        <button
          onClick={save} disabled={saving || savedOk}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-all disabled:opacity-90 flex items-center gap-1.5 ${
            savedOk
              ? 'bg-iron-green cursor-default'
              : 'bg-iron-green hover:bg-iron-green-light disabled:opacity-40'
          }`}
        >
          {saving && (
            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
          )}
          {savedOk && <span>✓</span>}
          {saving ? T.layoutEditor.saveBusy : savedOk ? T.layoutEditor.saveSuccess : T.layoutEditor.saveButton}
        </button>
        <button
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
        >
          {T.layoutEditor.cancelButton}
        </button>
      </div>

      {/* ─── Alignment toolbar ──────────────────────────────────────────── */}
      <div className="h-9 shrink-0 border-b border-iron-border bg-iron-card/50 flex items-center gap-1 px-3 overflow-x-auto">
        <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mr-1 shrink-0">{T.layoutEditor.alignLabel}</span>
        <AlignBtn label="⊢L" title="Align left edges"                    enabled={selTables.length >= 2} onClick={() => align('left')}   />
        <AlignBtn label="R⊣" title="Align right edges"                   enabled={selTables.length >= 2} onClick={() => align('right')}  />
        <AlignBtn label="⊤T" title="Align top edges"                     enabled={selTables.length >= 2} onClick={() => align('top')}    />
        <AlignBtn label="B⊥" title="Align bottom edges"                  enabled={selTables.length >= 2} onClick={() => align('bottom')} />
        <AlignBtn label="↔"  title="Center horizontally"                 enabled={selTables.length >= 2} onClick={() => align('ch')}     />
        <AlignBtn label="↕"  title="Center vertically"                   enabled={selTables.length >= 2} onClick={() => align('cv')}     />
        <div className="w-px h-4 bg-iron-border mx-1 shrink-0" />
        <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest mr-1 shrink-0">{T.layoutEditor.distributeLabel}</span>
        <AlignBtn label="⇔H" title="Distribute horizontally (3+ tables)" enabled={selTables.length >= 3} onClick={() => align('dh')} />
        <AlignBtn label="⇕V" title="Distribute vertically (3+ tables)"   enabled={selTables.length >= 3} onClick={() => align('dv')} />
        {selTables.length > 0 && (
          <>
            <div className="w-px h-4 bg-iron-border mx-1.5 shrink-0" />
            <span className="text-iron-muted text-[10px] shrink-0">{T.layoutEditor.selectedCount(selTables.length)}</span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-1 text-[10px] text-iron-muted hover:text-iron-text px-1.5 py-0.5 rounded border border-iron-border transition-colors shrink-0"
            >
              {T.layoutEditor.clearSelection}
            </button>
          </>
        )}
      </div>

      {/* ─── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div className="w-52 shrink-0 border-r border-iron-border bg-iron-card flex flex-col overflow-y-auto">

          {/* Sections */}
          <SideSection title={T.layoutEditor.sectionSections}>
            {sections.length === 0 && !showAddSec && (
              <p className="text-iron-muted text-xs italic mb-1">{T.layoutEditor.noSectionsYet}</p>
            )}
            {sections.map(sec => (
              <div
                key={sec.id}
                className="flex items-center gap-2 py-0.5 px-1 -mx-1 rounded cursor-default transition-colors"
                style={{ backgroundColor: hoveredSectionId === sec.id ? `${sec.color}22` : undefined }}
                onMouseEnter={() => setHoveredSectionId(sec.id)}
                onMouseLeave={() => setHoveredSectionId(null)}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sec.color }} />
                <span className="text-iron-text text-xs truncate">{formatSectionName(sec.name, locale)}</span>
              </div>
            ))}
            {showAddSec ? (
              <div className="mt-2 space-y-1.5">
                <input
                  autoFocus value={newSecName}
                  onChange={e => setNewSecName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  addSection();
                    if (e.key === 'Escape') { setShowAddSec(false); setNewSecName(''); }
                  }}
                  placeholder={T.layoutEditor.sectionPh}
                  className={inputCls + ' w-full'}
                />
                <div className="flex gap-1">
                  <button onClick={addSection} disabled={secBusy || !newSecName.trim()} className="text-[10px] px-2 py-0.5 bg-iron-green text-white rounded disabled:opacity-40">{T.layoutEditor.addSectionBtn}</button>
                  <button onClick={() => { setShowAddSec(false); setNewSecName(''); }} className="text-[10px] px-2 py-0.5 text-iron-muted hover:text-iron-text">{T.layoutEditor.cancelSection}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddSec(true)} className="mt-1.5 text-xs text-iron-muted hover:text-iron-green-light transition-colors">
                {T.layoutEditor.addSection}
              </button>
            )}
          </SideSection>

          {/* Tables */}
          <SideSection title={T.layoutEditor.sectionTables}>
            <button
              onClick={addTable}
              className="w-full text-xs font-medium py-1.5 rounded-lg border border-dashed border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-green-light transition-colors mb-2"
            >
              {T.layoutEditor.addTable}
            </button>
            <div className="space-y-px">
              {visible.map(t => {
                const isSel    = selectedIds.has(t.id);
                const secColor = t.section?.color;
                const isDimmed = hoveredSectionId !== null && t.sectionId !== hoveredSectionId;
                return (
                  <button
                    key={t.id}
                    onClick={e => {
                      if (e.shiftKey) {
                        setSelectedIds(prev => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; });
                      } else {
                        setSelectedIds(new Set([t.id]));
                        setSelectedObjId(null);
                      }
                    }}
                    className={`w-full text-left text-xs px-2 py-1 rounded flex items-center gap-1.5 transition-all ${
                      isSel ? 'bg-iron-green/20 text-iron-green-light' : 'text-iron-muted hover:text-iron-text'
                    } ${!t.isActive ? 'opacity-40' : isDimmed ? 'opacity-25' : ''}`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: secColor ?? '#52525b' }}
                    />
                    <span className="truncate flex-1">{t.name}</span>
                    {t.isNew     && <span className="text-[9px] text-iron-green">{T.layoutEditor.tagNew}</span>}
                    {!t.isActive && <span className="text-[9px] text-iron-muted">{T.layoutEditor.tagOff}</span>}
                  </button>
                );
              })}
            </div>
          </SideSection>

          {/* Floor objects */}
          <SideSection title={T.layoutEditor.sectionFloorObjs}>
            <p className="text-iron-muted text-[10px] mb-2 leading-tight">
              {T.layoutEditor.floorObjsHint}
            </p>
            <div className="grid grid-cols-2 gap-1 mb-2">
              {(Object.keys(OBJ_META) as FloorObjKind[]).map(kind => (
                <button
                  key={kind}
                  onClick={() => addFloorObj(kind)}
                  className="text-[10px] py-1 px-1.5 rounded border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-green-light transition-colors text-left truncate"
                >
                  + {OBJ_LABELS[kind]}
                </button>
              ))}
            </div>
            {floorObjs.length > 0 && (
              <div className="space-y-px">
                {floorObjs.map(o => (
                  <button
                    key={o.id}
                    onClick={() => { setSelectedObjId(o.id === selectedObjId ? null : o.id); setSelectedIds(new Set()); }}
                    className={`w-full text-left text-xs px-2 py-0.5 rounded flex items-center gap-1.5 transition-colors ${
                      o.id === selectedObjId ? 'bg-iron-green/20 text-iron-green-light' : 'text-iron-muted hover:text-iron-text'
                    }`}
                  >
                    <span className="w-2 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: OBJ_META[o.kind].color }} />
                    <span className="truncate">{formatFloorObjLabel(o.label, locale)}</span>
                  </button>
                ))}
              </div>
            )}
          </SideSection>
        </div>

        {/* ── Canvas ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto bg-iron-bg">
          <div
            ref={canvasDivRef}
            className="relative"
            style={{
              width: CANVAS_W, height: CANVAS_H,
              backgroundImage: 'radial-gradient(circle, var(--canvas-dot) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              cursor: marquee ? 'crosshair' : 'default',
            }}
            onMouseDown={e => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const startCX = e.clientX - rect.left;
              const startCY = e.clientY - rect.top;
              if (!e.shiftKey) { setSelectedIds(new Set()); setSelectedObjId(null); }
              dragRef.current = { kind: 'marquee', startCX, startCY, additive: e.shiftKey };
            }}
          >
            {/* Floor objects — rendered beneath tables */}
            {floorObjs.map(o => {
              const meta   = OBJ_META[o.kind];
              const isSel  = o.id === selectedObjId;
              const isZone = o.kind === 'ZONE';
              return (
                <div
                  key={o.id}
                  style={{
                    position: 'absolute', left: o.posX, top: o.posY,
                    width: o.width, height: o.height,
                    backgroundColor: meta.color + (isZone ? '20' : 'bb'),
                    border: `${isSel ? 2 : 1.5}px solid ${meta.color}${isSel ? '' : '88'}`,
                    borderRadius: isZone ? 8 : 3,
                    cursor: 'grab',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isSel ? `0 0 0 2px ${meta.color}55` : undefined,
                  }}
                  onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation();
                    setSelectedObjId(o.id); setSelectedIds(new Set());
                    dragRef.current = { kind: 'obj', id: o.id, startMX: e.clientX, startMY: e.clientY, startPX: o.posX, startPY: o.posY };
                  }}
                >
                  <span style={{ fontSize: 10, color: 'rgb(var(--iron-text))', opacity: 0.85, userSelect: 'none', padding: '0 4px', textAlign: 'center', pointerEvents: 'none' }}>
                    {o.label}
                  </span>
                </div>
              );
            })}

            {/* Tables */}
            {visible.map(t => {
              const isSel       = selectedIds.has(t.id);
              const secColor    = t.section?.color ?? '#3f3f46';
              const isHovered   = hoveredSectionId !== null && t.sectionId === hoveredSectionId;
              const isDimmed    = hoveredSectionId !== null && t.sectionId !== hoveredSectionId;
              const borderColor = isSel ? '#4ade80' : secColor;
              const glowShadow  = isSel
                ? '0 0 0 3px rgba(74,222,128,0.25)'
                : isHovered
                ? `0 0 0 3px ${secColor}55, 0 0 10px ${secColor}33`
                : undefined;

              return (
                <div
                  key={t.id}
                  style={{
                    position: 'absolute',
                    left: t.posX, top: t.posY,
                    width: t.width, height: t.height,
                    borderRadius: tableRadius(t.shape),
                    border: `2px solid ${borderColor}`,
                    backgroundColor: 'rgb(var(--iron-card))',
                    opacity: isDimmed ? 0.25 : (t.isActive ? 1 : 0.5),
                    boxShadow: glowShadow,
                    cursor: 'grab',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                    transition: 'opacity 0.15s, box-shadow 0.15s',
                  }}
                  onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation();
                    if (e.shiftKey) {
                      setSelectedIds(prev => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; });
                      return;
                    }
                    setSelectedObjId(null);
                    const activeIds = selectedIds.has(t.id) ? selectedIds : new Set([t.id]);
                    if (!selectedIds.has(t.id)) setSelectedIds(activeIds);
                    const origins: Record<string, { x: number; y: number }> = {};
                    for (const id of activeIds) {
                      const tbl = tables.find(x => x.id === id);
                      if (tbl) origins[id] = { x: tbl.posX, y: tbl.posY };
                    }
                    dragRef.current = { kind: 'tables', startMX: e.clientX, startMY: e.clientY, origins };
                  }}
                >
                  {t.section && (
                    <span
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: t.section.color }}
                    />
                  )}
                  {t.isNew && <span className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-iron-green" />}
                  {occupiedIds.has(t.id) && (
                    <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-400" title={T.layoutEditor.occupiedTitle} />
                  )}
                  <span className="text-iron-text text-[11px] font-semibold leading-none px-1 truncate max-w-full">{t.name}</span>
                  <span className="text-iron-muted text-[9px] mt-0.5">{t.minCovers}–{t.maxCovers}</span>
                  <span className="text-iron-muted/40 text-[8px]">{t.width}×{t.height}</span>
                </div>
              );
            })}

            {/* Marquee selection rectangle */}
            {marquee && marquee.w > 2 && marquee.h > 2 && (
              <div
                style={{
                  position: 'absolute',
                  left:   marquee.x, top:    marquee.y,
                  width:  marquee.w, height: marquee.h,
                  border: '1.5px dashed rgba(74,222,128,0.55)',
                  backgroundColor: 'rgba(74,222,128,0.06)',
                  borderRadius: 3,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom panel ───────────────────────────────────────────────── */}

      {/* Single table selected */}
      {singleSel && (
        <div className="shrink-0 border-t border-iron-border bg-iron-card">
          <div className="flex items-center gap-4 px-4 pt-3 pb-1.5 flex-wrap">
            <Field label={T.layoutEditor.fieldName}>
              <input value={singleSel.name} onChange={e => patchSelected({ name: e.target.value })} className={inputCls + ' w-24'} />
            </Field>
            <Field label={T.layoutEditor.fieldMinCovers}>
              <input type="number" min={1} max={singleSel.maxCovers} value={singleSel.minCovers}
                onChange={e => patchSelected({ minCovers: Math.max(1, parseInt(e.target.value) || 1) })}
                className={inputCls + ' w-14 text-center'} />
            </Field>
            <Field label={T.layoutEditor.fieldMaxCovers}>
              <input type="number" min={singleSel.minCovers} max={30} value={singleSel.maxCovers}
                onChange={e => patchSelected({ maxCovers: Math.max(singleSel.minCovers, parseInt(e.target.value) || singleSel.minCovers) })}
                className={inputCls + ' w-14 text-center'} />
            </Field>
            <Field label={T.layoutEditor.fieldShape}>
              <select value={singleSel.shape} onChange={e => patchSelected({ shape: e.target.value as ShapeType })} className={inputCls}>
                {ALL_SHAPES.map(s => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label={T.layoutEditor.fieldSection}>
              <select
                value={singleSel.sectionId ?? ''}
                onChange={e => {
                  const id = e.target.value || null;
                  patchSelected({ sectionId: id, section: sections.find(s => s.id === id) ?? null });
                }}
                className={inputCls}
              >
                <option value="">{T.layoutEditor.noSection}</option>
                {sections.map(s => <option key={s.id} value={s.id}>{formatSectionName(s.name, locale)}</option>)}
              </select>
            </Field>
            <Field label={T.layoutEditor.fieldStatus}>
              <button
                onClick={() => patchSelected({ isActive: !singleSel.isActive })}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  singleSel.isActive
                    ? 'bg-iron-green/20 border-iron-green/40 text-iron-green-light'
                    : 'bg-iron-border/20 border-iron-border/30 text-iron-muted'
                }`}
              >
                {singleSel.isActive ? T.layoutEditor.statusActive : T.layoutEditor.statusInactive}
              </button>
            </Field>
            <Field label={T.layoutEditor.fieldLock}>
              <button
                onClick={() => patchSelected({ locked: !singleSel.locked })}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  singleSel.locked
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                    : 'bg-iron-border/20 border-iron-border/30 text-iron-muted hover:border-iron-text/30 hover:text-iron-text'
                }`}
              >
                {singleSel.locked ? T.layoutEditor.lockLocked : T.layoutEditor.lockUnlocked}
              </button>
            </Field>
            <Field label={singleSel.isNew ? T.layoutEditor.removeField : T.layoutEditor.deleteField}>
              <button
                onClick={removeSelected}
                className="text-xs px-2.5 py-1 rounded-md border border-red-900/30 text-red-400 hover:bg-red-900/15 transition-colors"
              >
                {singleSel.isNew ? T.layoutEditor.removeField : T.layoutEditor.deleteField}
              </button>
            </Field>
            <button onClick={() => setSelectedIds(new Set())} className="text-iron-muted hover:text-iron-text text-xl leading-none self-end mb-1 ml-auto">×</button>
          </div>
          <div className="flex items-center gap-3 px-4 pb-2.5 flex-wrap">
            <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest shrink-0">{T.layoutEditor.sizeLabel}</span>
            {SIZE_PRESETS.map(p => {
              const active = singleSel.width === p.w && singleSel.height === p.h;
              return (
                <button
                  key={p.label}
                  onClick={() => patchSelected({ width: p.w, height: p.h, minCovers: p.min, maxCovers: p.max })}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    active
                      ? 'border-iron-green/60 text-iron-green-light bg-iron-green/10'
                      : 'border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-green-light'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            <div className="w-px h-4 bg-iron-border" />
            <span className="text-iron-muted text-[10px]">{T.layoutEditor.customLabel}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => patchSelected({ width: Math.max(40, singleSel.width - 8) })}  className={inputCls + ' px-1.5 py-1 text-iron-muted hover:text-iron-green-light'}>−</button>
              <input
                type="number" min={40} max={400} value={singleSel.width}
                onChange={e => patchSelected({ width: Math.max(40, Math.min(400, parseInt(e.target.value) || singleSel.width)) })}
                className={inputCls + ' w-14 text-center'}
              />
              <button onClick={() => patchSelected({ width: Math.min(400, singleSel.width + 8) })} className={inputCls + ' px-1.5 py-1 text-iron-muted hover:text-iron-green-light'}>+</button>
              <span className="text-iron-muted text-xs mx-0.5">×</span>
              <button onClick={() => patchSelected({ height: Math.max(32, singleSel.height - 8) })}  className={inputCls + ' px-1.5 py-1 text-iron-muted hover:text-iron-green-light'}>−</button>
              <input
                type="number" min={32} max={400} value={singleSel.height}
                onChange={e => patchSelected({ height: Math.max(32, Math.min(400, parseInt(e.target.value) || singleSel.height)) })}
                className={inputCls + ' w-14 text-center'}
              />
              <button onClick={() => patchSelected({ height: Math.min(400, singleSel.height + 8) })} className={inputCls + ' px-1.5 py-1 text-iron-muted hover:text-iron-green-light'}>+</button>
              <span className="text-iron-muted text-[10px]">{T.layoutEditor.pxUnit}</span>
            </div>
            <div className="w-px h-4 bg-iron-border" />
            <button
              onClick={rotate90}
              title={T.layoutEditor.rotateCW}
              className="text-[10px] px-2 py-0.5 rounded border border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-green-light transition-colors"
            >
              ↻ {T.layoutEditor.rotateCW}
            </button>
          </div>
        </div>
      )}

      {/* Multiple tables selected */}
      {selTables.length > 1 && (
        <div className="shrink-0 border-t border-iron-border bg-iron-card flex items-center gap-4 px-4 py-2 flex-wrap">
          <span className="text-iron-text text-sm font-semibold shrink-0">{T.layoutEditor.multiSelected(selTables.length)}</span>
          <div className="w-px h-4 bg-iron-border shrink-0" />
          {/* Batch shape */}
          <Field label={T.layoutEditor.batchShape}>
            <select
              className={inputCls}
              defaultValue=""
              onChange={e => { if (e.target.value) patchMultiSelected({ shape: e.target.value as ShapeType }); e.target.value = ''; }}
            >
              <option value="" disabled>—</option>
              {ALL_SHAPES.map(s => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}
            </select>
          </Field>
          {/* Batch section */}
          <Field label={T.layoutEditor.batchSection}>
            <select
              className={inputCls}
              defaultValue=""
              onChange={e => {
                const id = e.target.value || null;
                patchMultiSelected({ sectionId: id, section: sections.find(s => s.id === id) ?? null });
                e.target.value = '';
              }}
            >
              <option value="" disabled>—</option>
              <option value="">{T.layoutEditor.noSection}</option>
              {sections.map(s => <option key={s.id} value={s.id}>{formatSectionName(s.name, locale)}</option>)}
            </select>
          </Field>
          {/* Batch scale */}
          <Field label={T.layoutEditor.batchSize}>
            <div className="flex gap-1">
              {[{ label: '−8', dw: -8, dh: -8 }, { label: '+8', dw: 8, dh: 8 }].map(({ label, dw, dh }) => (
                <button
                  key={label}
                  onClick={() => setTables(prev => prev.map(t =>
                    selectedIds.has(t.id) && !t.deleted
                      ? { ...t, width: Math.max(40, Math.min(400, t.width + dw)), height: Math.max(32, Math.min(400, t.height + dh)), dirty: !t.isNew }
                      : t
                  ))}
                  className={inputCls + ' px-2 py-1 text-iron-muted hover:text-iron-green-light'}
                >{label}</button>
              ))}
              <button
                onClick={rotate90}
                title={T.layoutEditor.rotateCW}
                className={inputCls + ' px-2 py-1 text-iron-muted hover:text-iron-green-light'}
              >↻</button>
            </div>
          </Field>
          <button
            onClick={removeSelected}
            className="ml-auto text-xs px-2.5 py-1 rounded border border-red-900/30 text-red-400 hover:bg-red-900/15 transition-colors shrink-0"
          >
            {T.layoutEditor.deleteSelected}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-iron-muted hover:text-iron-text text-lg leading-none shrink-0">×</button>
        </div>
      )}

      {/* Occupied-table guard dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div className="bg-iron-card border border-iron-border rounded-xl shadow-2xl p-5 w-80 space-y-3">
            <p className="text-iron-text text-sm font-medium">{confirmState.message}</p>
            {confirmState.suggestion && (
              <p className="text-iron-muted text-xs">
                <span className="text-amber-400">{T.layoutEditor.confirmSuggestion}</span> {confirmState.suggestion}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => { const c = confirmState; setConfirmState(null); c.onCancel?.(); }}
                className="text-xs px-3 py-1.5 rounded-md border border-iron-border text-iron-muted hover:text-iron-text transition-colors"
              >
                {confirmState.onConfirm ? T.common.cancel : T.layoutEditor.confirmOK}
              </button>
              {confirmState.onConfirm && (
                <button
                  onClick={() => { const c = confirmState; setConfirmState(null); c.onConfirm!(); }}
                  className="text-xs px-3 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors"
                >
                  {T.layoutEditor.confirmContinue}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floor object selected */}
      {selObj && selTables.length === 0 && (
        <div className="shrink-0 border-t border-iron-border bg-iron-card h-14 flex items-center gap-4 px-4">
          <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-widest">
            {OBJ_META[selObj.kind].label}
          </span>
          <Field label={T.layoutEditor.fieldLabel}>
            <input value={selObj.label} onChange={e => patchFloorObj(selObj.id, { label: e.target.value })} className={inputCls + ' w-28'} />
          </Field>
          <Field label={T.layoutEditor.fieldW}>
            <input type="number" min={20} max={800} value={selObj.width}
              onChange={e => patchFloorObj(selObj.id, { width: Math.max(20, parseInt(e.target.value) || selObj.width) })}
              className={inputCls + ' w-16 text-center'} />
          </Field>
          <Field label={T.layoutEditor.fieldH}>
            <input type="number" min={8} max={600} value={selObj.height}
              onChange={e => patchFloorObj(selObj.id, { height: Math.max(8, parseInt(e.target.value) || selObj.height) })}
              className={inputCls + ' w-16 text-center'} />
          </Field>
          <button onClick={() => removeFloorObj(selObj.id)} className="ml-auto text-xs px-2.5 py-1 rounded border border-red-900/30 text-red-400 hover:bg-red-900/15 transition-colors">
            {T.layoutEditor.removeObject}
          </button>
          <button onClick={() => setSelectedObjId(null)} className="text-iron-muted hover:text-iron-text text-lg leading-none">×</button>
        </div>
      )}

    </div>
  );
}
