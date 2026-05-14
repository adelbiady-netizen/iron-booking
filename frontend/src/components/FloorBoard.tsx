import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type React from 'react';
import type { BackendTableSuggestion, FloorInsight, FloorObjectData, FloorTable, Reservation, WaitlistEntry } from '../types';
import type { PressureInfo } from '../utils/flowControl';
import { logOverride } from '../utils/flowControl';
import TableCard from './TableCard';
import TableTimeline from './TableTimeline';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName } from '../utils/displayHelpers';
import { minutesUntilEnd } from '../utils/time';
import { useAtmosphere } from '../hooks/useTimeWarmth';
import { OBJECT_REGISTRY, resolveObjectVariant } from '../mapEngine';

interface SectionGroup {
  id: string;
  name: string;
  color: string;
  tables: FloorTable[];
}

// Derived from registry — no manual list to keep in sync.
const SVG_RENDERED_KINDS = new Set<string>(
  (Object.entries(OBJECT_REGISTRY) as [string, { renderMode: string }][])
    .filter(([, def]) => def.renderMode === 'SVG')
    .map(([kind]) => kind)
);

// ── Geometry-based appearance inference ──────────────────────────────────────
// Drives visual style for DIVIDER / BAR / PLANTER from object dimensions.
// CURVED_BOOTH_SEGMENT uses resolveObjectVariant() from mapEngine instead.

function colorIsGreen(color: string | null): boolean {
  if (!color) return false;
  const hex = color.replace('#', '');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return g > r * 1.35 && g > b * 1.20 && g > 55;
}

function inferObjVariant(o: FloorObjectData): string {
  const ratio = o.width / Math.max(o.height, 1);
  const area  = o.width * o.height;
  switch (o.kind) {
    case 'DIVIDER':
      if (colorIsGreen(o.color))              return 'GREENERY';
      if (o.height < 6)                       return 'LOW';       // only sub-6px floor strips
      if (o.height >= 20 && ratio > 4.0)      return 'GLASS';    // tall wide screen (h≥20, ratio>4)
      return 'PANEL';
    case 'PLANTER':
      if (ratio > 2.8)  return 'ROW';
      if (area > 3400)  return 'PRIVACY';
      return 'POT';
    case 'BAR':
      if (ratio > 5.0)  return 'STRAIGHT';
      if (ratio < 1.4)  return 'ISLAND';
      return 'COUNTER';
    default:
      return 'DEFAULT';
  }
}

// ── Material preset library ───────────────────────────────────────────────────
// Reusable premium hospitality material language — inferred from stored `color`
// hex until a future `material` field is added to the schema.
// Each preset is [tintPrefix, accentPrefix, shadowPrefix] — open rgba() strings.

type MaterialId =
  | 'WALNUT' | 'SMOKED_STONE' | 'BRASS_EDGE'
  | 'CHARCOAL_GLASS' | 'TERRACOTTA' | 'UPHOLSTERY'
  | 'TERRACE_STONE' | 'DEFAULT';

const MATERIAL_PRESETS: Record<MaterialId, readonly [string, string, string]> = {
  WALNUT:         ['rgba(210,155,80,',  'rgba(155,105,26,', 'rgba(64,24,4,'   ],
  SMOKED_STONE:   ['rgba(155,148,138,', 'rgba(100,98,92,',  'rgba(0,0,0,'     ],
  BRASS_EDGE:     ['rgba(195,162,88,',  'rgba(165,135,60,', 'rgba(80,55,10,'  ],
  CHARCOAL_GLASS: ['rgba(90,95,110,',   'rgba(60,65,80,',   'rgba(0,0,0,'     ],
  TERRACOTTA:     ['rgba(180,80,40,',   'rgba(140,58,24,',  'rgba(64,20,8,'   ],
  UPHOLSTERY:     ['rgba(80,55,38,',    'rgba(60,42,28,',   'rgba(16,8,4,'    ],
  TERRACE_STONE:  ['rgba(130,128,120,', 'rgba(100,98,90,',  'rgba(0,0,0,'     ],
  DEFAULT:        ['rgba(180,180,180,', 'rgba(120,120,130,','rgba(0,0,0,'     ],
};

function inferMaterial(color: string | null, kind: string): MaterialId {
  if (!color) {
    switch (kind) {
      case 'BAR':        return 'WALNUT';
      case 'HOST_STAND': return 'BRASS_EDGE';
      case 'DIVIDER':    return 'CHARCOAL_GLASS';
      case 'PLANTER':    return 'TERRACOTTA';
      default:           return 'DEFAULT';
    }
  }
  const hex = color.replace('#', '');
  if (hex.length !== 6) return 'DEFAULT';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (g > r * 1.35 && g > b * 1.20)                          return 'TERRACE_STONE';
  if (r > 140 && g < r * 0.72 && b < r * 0.55)               return r > g * 1.8 ? 'TERRACOTTA' : 'WALNUT';
  if (r > 155 && g > 118 && b < 82)                          return 'BRASS_EDGE';
  if (r < 85  && g < 85  && b < 85 && Math.abs(r - b) < 22)  return 'SMOKED_STONE';
  if (b > r * 1.12 && b > g * 1.12 && r < 100)               return 'CHARCOAL_GLASS';
  if (r > 60 && g > 40 && b > 18 && r > g && g > b && r < 140) return 'UPHOLSTERY';
  return 'DEFAULT';
}

// ── Table family inference ────────────────────────────────────────────────────
// Inferred from shape + section/name keywords. Future schema can add explicit field.

type TableFamily = 'BOOTH' | 'BAR_SEATING' | 'LOUNGE' | 'VIP' | 'COMMUNAL' | 'ROUND_DINING' | 'RECT_DINING';

function inferTableFamily(t: FloorTable): TableFamily {
  const combined = (t.name + ' ' + (t.section?.name ?? '')).toLowerCase();
  if (t.shape === 'BOOTH') return 'BOOTH';
  if (/\bbar\b|counter|pass|high.top|hightop/.test(combined)) return 'BAR_SEATING';
  if (/lounge|cocktail|aperitif/.test(combined)) return 'LOUNGE';
  if (/vip|private|salon|presidential/.test(combined)) return 'VIP';
  if (t.maxCovers >= 8 && t.shape !== 'ROUND' && t.shape !== 'OVAL') return 'COMMUNAL';
  if (t.shape === 'ROUND' || t.shape === 'OVAL') return 'ROUND_DINING';
  return 'RECT_DINING';
}

interface ObjAppearance {
  bg: string;
  backgroundImage: string | undefined;
  border: string;
  borderRadius: number;
  boxShadow: string | undefined;
  labelColor: string;
  labelSize: number;
  labelWeight: number;
  labelOpacity: number;
  labelLetterSpacing: string | undefined;
  labelTransform: React.CSSProperties['textTransform'];
}

function getObjAppearance(o: FloorObjectData, timeWarmth: number, brightness: number): ObjAppearance {
  switch (o.kind) {
    case 'BAR': {
      const variant = inferObjVariant(o);
      if (variant === 'ISLAND') return {
        // Stone/marble island counter — cool mineral surface, premium weight
        bg: 'rgba(30,32,38,0.97)',
        backgroundImage: [
          'linear-gradient(180deg, rgba(200,196,190,0.066) 0%, rgba(160,156,148,0.020) 36%, rgba(0,0,0,0.36) 100%)',
          'linear-gradient(90deg, rgba(255,255,255,0.030) 0%, transparent 24%, rgba(255,255,255,0.016) 54%, transparent 80%, rgba(0,0,0,0.20) 100%)',
          'radial-gradient(ellipse 68% 28% at 50% 0%, rgba(220,216,210,0.040) 0%, transparent 100%)',
        ].join(', '),
        border: '1.5px solid rgba(118,114,106,0.82)',
        borderRadius: 6,
        boxShadow: [
          'inset 0 2px 0 rgba(238,236,232,0.18)',
          'inset 0 -3px 8px rgba(0,0,0,0.60)',
          'inset 0 10px 28px rgba(0,0,0,0.22)',
          '0 8px 44px rgba(0,0,0,0.94)',
          '0 4px 22px rgba(0,0,0,0.48)',
          `0 0 60px rgba(175,170,162,${(0.038 + timeWarmth * 0.018).toFixed(3)})`,
        ].join(', '),
        labelColor: 'rgba(218,214,206,0.88)',
        labelSize: 11, labelWeight: 600, labelOpacity: 1,
        labelLetterSpacing: '0.06em', labelTransform: undefined,
      };
      // STRAIGHT + COUNTER — warm walnut counter with brass rail
      return {
        bg: 'rgba(48,16,4,0.97)',
        backgroundImage: [
          'linear-gradient(180deg, rgba(240,118,44,0.34) 0%, rgba(160,58,14,0.10) 44%, rgba(0,0,0,0.46) 100%)',
          'linear-gradient(90deg, rgba(255,240,200,0.06) 0%, transparent 20%, rgba(255,220,155,0.04) 52%, transparent 78%, rgba(0,0,0,0.30) 100%)',
          'radial-gradient(ellipse 88% 28% at 50% 0%, rgba(255,215,95,0.10) 0%, transparent 100%)',
          // Counter-surface overhead reflection — faint spotlight on the flat working surface
          'radial-gradient(ellipse 56% 10% at 50% 46%, rgba(255,210,108,0.030) 0%, transparent 100%)',
        ].join(', '),
        border: '1.5px solid rgba(155,105,26,0.96)',
        borderRadius: 4,
        boxShadow: [
          'inset 0 2px 0 rgba(255,218,148,0.54)',
          'inset 0 -3px 8px rgba(0,0,0,0.64)',
          'inset 2px 0 0 rgba(255,205,118,0.22)',
          'inset -2px 0 0 rgba(0,0,0,0.40)',
          'inset 0 10px 28px rgba(0,0,0,0.28)',
          '0 8px 44px rgba(0,0,0,0.94)',
          '0 4px 22px rgba(64,24,4,0.72)',
          `0 0 70px rgba(180,105,20,${(0.07 + timeWarmth * 0.04).toFixed(3)})`,
        ].join(', '),
        labelColor: 'rgba(255,220,180,0.90)',
        labelSize: 11, labelWeight: 600, labelOpacity: 1,
        labelLetterSpacing: '0.07em', labelTransform: undefined,
      };
    }
    case 'ENTRANCE':
      return {
        bg: 'rgba(13,20,38,0.72)',
        backgroundImage: [
          'linear-gradient(180deg, rgba(80,120,220,0.30) 0%, rgba(40,70,140,0.18) 45%, rgba(0,0,0,0.34) 100%)',
          // Top surface catch — faint sky-blue strip like natural light bleeding in from outside
          'linear-gradient(180deg, rgba(130,175,255,0.038) 0%, transparent 18%)',
        ].join(', '),
        border: '1.5px solid rgba(28,54,128,0.84)',
        borderRadius: 3,
        boxShadow: '0 2px 20px rgba(28,54,128,0.42), inset 0 -2px 0 rgba(100,140,255,0.18), inset 0 1px 0 rgba(148,182,255,0.13)',
        labelColor: 'rgba(148,174,255,0.88)',
        labelSize: 10, labelWeight: 500, labelOpacity: 0.90,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
    case 'HOST_STAND': {
      // Material is driven by o.color (e.g. walnut stand, brass-edge podium, smoked-stone lectern).
      const mat     = MATERIAL_PRESETS[inferMaterial(o.color, o.kind)];
      const [tint, accent] = mat;
      return {
        bg: 'rgba(8,6,4,0.97)',
        backgroundImage: [
          'linear-gradient(145deg, rgba(255,255,255,0.044) 0%, transparent 42%)',
          `radial-gradient(ellipse 70% 55% at 50% 38%, ${tint}0.044) 0%, transparent 80%)`,
        ].join(', '),
        border: `1.5px solid ${accent}${(0.50 + timeWarmth * 0.18).toFixed(2)})`,
        borderRadius: 6,
        boxShadow: [
          `inset 0 1px 0 ${tint}${(0.24 + timeWarmth * 0.10).toFixed(2)})`,
          // Left-bevel catch — podium side edge catching ambient room light
          `inset 1px 0 0 ${tint}${(0.08 + timeWarmth * 0.04).toFixed(2)})`,
          'inset 0 -2px 6px rgba(0,0,0,0.70)',
          '0 4px 28px rgba(0,0,0,0.80)',
          `0 0 38px ${accent}${(0.05 + timeWarmth * 0.04).toFixed(3)})`,
        ].join(', '),
        labelColor: `${tint}${(0.70 + timeWarmth * 0.18).toFixed(2)})`,
        labelSize: 10, labelWeight: 600, labelOpacity: 1,
        labelLetterSpacing: '0.08em', labelTransform: 'uppercase',
      };
    }
    case 'DIVIDER': {
      const variant = inferObjVariant(o);
      if (variant === 'LOW') return {
        bg: `rgba(48,50,60,${(0.60 + (1 - brightness) * 0.10).toFixed(2)})`,
        backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.034) 0%, rgba(0,0,0,0.14) 100%)',
        border: '1px solid rgba(68,70,84,0.66)',
        borderRadius: 2,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 2px 8px rgba(0,0,0,0.40)',
        labelColor: 'rgb(var(--iron-text))',
        labelSize: 9, labelWeight: 400, labelOpacity: 0.48,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
      if (variant === 'GLASS') return {
        bg: 'rgba(36,44,68,0.34)',
        backgroundImage: [
          'linear-gradient(180deg, rgba(180,200,255,0.056) 0%, rgba(120,150,220,0.014) 100%)',
          'linear-gradient(90deg, rgba(255,255,255,0.024) 0%, transparent 16%, transparent 84%, rgba(255,255,255,0.010) 100%)',
        ].join(', '),
        border: '1px solid rgba(108,140,220,0.32)',
        borderRadius: 2,
        boxShadow: '0 2px 20px rgba(0,0,0,0.40), inset 1px 0 0 rgba(188,212,255,0.10), inset -1px 0 0 rgba(0,0,0,0.18)',
        labelColor: 'rgba(172,196,255,0.70)',
        labelSize: 10, labelWeight: 400, labelOpacity: 0.72,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
      if (variant === 'GREENERY') return {
        bg: 'rgba(12,32,10,0.74)',
        backgroundImage: [
          'linear-gradient(180deg, rgba(34,76,26,0.24) 0%, rgba(12,28,8,0.06) 60%, rgba(0,0,0,0.22) 100%)',
          'radial-gradient(ellipse 52% 36% at 50% 26%, rgba(26,72,20,0.18) 0%, transparent 100%)',
        ].join(', '),
        border: '1px solid rgba(32,68,24,0.66)',
        borderRadius: 4,
        boxShadow: 'inset 0 1px 0 rgba(52,128,36,0.09), 0 3px 12px rgba(0,0,0,0.54)',
        labelColor: 'rgba(92,174,72,0.78)',
        labelSize: 10, labelWeight: 400, labelOpacity: 0.68,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
      // PANEL — solid divider (glass panel or stone partition)
      return {
        bg: 'rgba(46,48,58,0.62)',
        backgroundImage: [
          'linear-gradient(180deg, rgba(255,255,255,0.052) 0%, rgba(255,255,255,0.012) 30%, rgba(0,0,0,0.16) 86%, rgba(0,0,0,0.32) 100%)',
          'linear-gradient(90deg, rgba(255,255,255,0.014) 0%, transparent 30%, transparent 68%, rgba(0,0,0,0.10) 100%)',
        ].join(', '),
        border: '1.5px solid rgba(66,68,80,0.75)',
        borderRadius: 3,
        boxShadow: '0 2px 16px rgba(0,0,0,0.56), inset 1px 0 0 rgba(255,255,255,0.06), inset -1px 0 0 rgba(0,0,0,0.24)',
        labelColor: 'rgb(var(--iron-text))',
        labelSize: 10, labelWeight: 400, labelOpacity: 0.80,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
    }
    case 'ZONE':
      return {
        bg: `rgba(18,22,16,${(0.28 + (1 - brightness) * 0.10).toFixed(2)})`,
        backgroundImage: 'radial-gradient(ellipse 75% 65% at 50% 42%, rgba(255,240,210,0.030) 0%, rgba(255,220,160,0.012) 58%, transparent 82%)',
        border: '1px solid rgba(44,54,40,0.62)',
        borderRadius: 12,
        boxShadow: 'inset 0 0 28px rgba(0,0,0,0.30)',
        labelColor: 'rgb(var(--iron-text))',
        labelSize: 10, labelWeight: 400, labelOpacity: 0.45,
        labelLetterSpacing: '0.10em', labelTransform: 'uppercase',
      };
    default: // WALL + any unrecognised kind
      return {
        bg: `rgba(58,60,68,${(0.66 + (1 - brightness) * 0.10).toFixed(2)})`,
        backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.044) 0%, rgba(255,255,255,0.008) 28%, rgba(0,0,0,0.22) 100%)',
        border: '1.5px solid rgba(78,80,90,0.82)',
        borderRadius: 3,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -2px 0 rgba(0,0,0,0.58), 0 4px 20px rgba(0,0,0,0.70), 0 1px 4px rgba(0,0,0,0.82)',
        labelColor: 'rgb(var(--iron-text))',
        labelSize: 10, labelWeight: 400, labelOpacity: 0.80,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
  }
}

const STATUS_BG: Record<string, string> = {
  AVAILABLE:     'rgba(224,224,222,0.86)',   // muted neutral — recedes behind active states
  OCCUPIED:      'rgba(220,242,224,0.96)',   // soft barely-green — active presence
  RESERVED_SOON: 'rgba(241,235,208,0.96)',   // soft barely-amber — imminent arrival
  RESERVED:      'rgba(213,230,247,0.96)',   // soft barely-blue — committed, calm
  BLOCKED:       'rgba(30,32,36,0.18)',      // near-invisible — withdrawn
};

interface Props {
  tables: FloorTable[];
  floorObjs?: FloorObjectData[];
  selectedId: string | null;
  onSelect: (res: Reservation) => void;
  onAvailableClick?: (table: FloorTable) => void;
  insights?: FloorInsight[];
  onInsightAction?: (tableId: string, reservationId: string) => void;
  loadError?: boolean;
  errorPhase?: 'none' | 'reconnecting' | 'failed';
  onLockTable?: (table: FloorTable) => void;
  onUnlockTable?: (tableId: string) => void;
  waitlist?: WaitlistEntry[];
  waitlistMatches?: Record<string, WaitlistEntry>;
  onWaitlistSuggestion?: (tableId: string, entry: WaitlistEntry) => void;
  bestSuggestionTableId?: string | null;
  softHoldMap?: Record<string, WaitlistEntry>;
  pressureInfo?: PressureInfo;
  nowTime?: string;
  operationalNow?: number;
  reservations?: Reservation[];
  date?: string;
  onGapClick?: (tableId: string, startTime: string, endTime: string) => void;
  onGapWaitlistSeat?: (tableId: string, entry: WaitlistEntry, startTime: string, endTime: string) => void;
  onQuickAction?: (action: 'seat' | 'move' | 'cancel', res: Reservation) => void;
  // Combine-tables mode
  combineMode?: boolean;
  combinedSelection?: string[];
  onCombineToggle?: (tableId: string) => void;
  onCombineCreate?: () => void;
  // Table pick mode (Tabit-style map selection from drawer)
  pickMode?: boolean;
  pickIds?: string[];
  pickSuggestions?: BackendTableSuggestion[];
  onPickDone?: (ids: string[]) => void;
  onPickCancel?: () => void;
  pickAction?: 'seat' | 'move' | 'change-table';
  pickGuestName?: string;
  // Waitlist table assignment mode
  waitlistAssignEntry?: WaitlistEntry | null;
  waitlistAssignTableId?: string | null;
  onWaitlistTablePick?: (tableId: string) => void;
  onWaitlistAssignCancel?: () => void;
  onWaitlistConfirmSeat?: () => void;
  // Management Reorganize Mode
  reorganizeMode?: boolean;
  onReorganizeTableClick?: (table: FloorTable) => void;
  // Queue→floor hover relationship
  hoveredResId?: string | null;
}

const CANVAS_W = 1500;
const CANVAS_H = 800;
const ZOOM_STEPS = [0.90, 1.00, 1.15, 1.30, 1.50] as const;

function tableRadius(shape: string): string {
  if (shape === 'ROUND' || shape === 'OVAL') return '9999px';
  if (shape === 'BOOTH') return '3px 3px 22px 22px';  // tight back rail, deeper seat arc
  return '12px';  // softer premium corners — hospitality furniture, not a UI button
}

// Surface gradient — top highlight for depth. Active states stronger; AVAILABLE lifted slightly.
function tableGradient(_shape: string, status: string, _cls: string): string | undefined {
  if (status === 'BLOCKED') return undefined;
  if (status === 'AVAILABLE') return 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, transparent 55%)';
  return 'linear-gradient(180deg, rgba(255,255,255,0.32) 0%, transparent 52%)';
}

function hasPositions(tables: FloorTable[]): boolean {
  if (tables.length === 0) return false;
  // Canvas mode only activates when at least one table has BOTH axes placed (> 5 px).
  // OR would let a table dragged along a single axis pass, ghosting onto the canvas.
  return tables.some(t => t.posX > 5 && t.posY > 5);
}

type View = 'floor' | 'timeline';

type PickStatus = 'recommended' | 'possible' | 'tight' | 'unavailable' | 'current' | null;

export default function FloorBoard({
  tables, floorObjs = [], selectedId, onSelect, onAvailableClick,
  insights = [], onInsightAction, loadError, errorPhase,
  onLockTable, onUnlockTable,
  waitlist = [], waitlistMatches = {}, onWaitlistSuggestion, bestSuggestionTableId,
  softHoldMap = {}, pressureInfo,
  nowTime, operationalNow,
  reservations = [], date,
  onGapClick, onGapWaitlistSeat, onQuickAction,
  combineMode = false, combinedSelection = [], onCombineToggle, onCombineCreate,
  pickMode = false, pickIds = [], pickSuggestions = [], onPickDone, onPickCancel, pickAction, pickGuestName,
  waitlistAssignEntry = null, waitlistAssignTableId = null,
  onWaitlistTablePick, onWaitlistAssignCancel, onWaitlistConfirmSeat,
  reorganizeMode = false, onReorganizeTableClick,
  hoveredResId,
}: Props) {
  const T = useT();
  const { locale } = useLocale();
  const { warmth: timeWarmth, brightness, gridFade } = useAtmosphere();

  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [lockedWarning,    setLockedWarning]    = useState<FloorTable | null>(null);
  const [softHoldWarning,  setSoftHoldWarning]  = useState<{ table: FloorTable; entry: WaitlistEntry } | null>(null);
  const [ctxMenu,          setCtxMenu]          = useState<{ x: number; y: number; table: FloorTable } | null>(null);
  const [view,             setView]             = useState<View>('floor');

  // Pick mode state
  const [pickSelection,    setPickSelection]    = useState<string[]>([]);
  const [pickWarn,         setPickWarn]         = useState<string | null>(null);
  const [pickCurrentWarn,  setPickCurrentWarn]  = useState(false);
  // Waitlist assign mode — flash ineligible table when host clicks it
  const [wlPickWarn,       setWlPickWarn]       = useState<string | null>(null);
  const dragStartRef   = useRef<{ cx: number; cy: number } | null>(null);
  const isDraggingRef  = useRef(false);
  const [dragRect,      setDragRect]          = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const [zoomIdx, setZoomIdx] = useState(1); // index into ZOOM_STEPS; 1 = 100%
  const floorZoom = ZOOM_STEPS[zoomIdx];
  const floorZoomRef = useRef(floorZoom);
  floorZoomRef.current = floorZoom;
  // Tracks zoom level from the PREVIOUS render so the centering effect can
  // compute the correct scroll delta before the browser paints the new zoom.
  const prevZoomRef = useRef(floorZoom);

  // Zoom centering — runs synchronously after DOM mutation, before paint.
  // Adjusts scrollLeft/Top so the canvas coordinate at the viewport center
  // stays fixed across zoom changes (reversible in/out, no drift).
  useLayoutEffect(() => {
    const container = canvasScrollRef.current;
    if (!container) return;
    const prev = prevZoomRef.current;
    prevZoomRef.current = floorZoom;
    if (prev === floorZoom) return;
    // Canvas coordinate at the center of the current viewport (in prev zoom space)
    const cx = (container.scrollLeft + container.clientWidth  / 2) / prev;
    const cy = (container.scrollTop  + container.clientHeight / 2) / prev;
    // Reposition so the same canvas coordinate stays at center after new zoom
    container.scrollLeft = Math.max(0, cx * floorZoom - container.clientWidth  / 2);
    container.scrollTop  = Math.max(0, cy * floorZoom - container.clientHeight / 2);
  }, [floorZoom]);

  // Container resize — clamps scroll when the viewport expands (e.g. panel collapse)
  // so the host never sees empty space beyond the canvas edge.
  useEffect(() => {
    const container = canvasScrollRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const maxL = Math.max(0, CANVAS_W * floorZoomRef.current - container.clientWidth);
      const maxT = Math.max(0, CANVAS_H * floorZoomRef.current - container.clientHeight);
      if (container.scrollLeft > maxL) container.scrollLeft = maxL;
      if (container.scrollTop  > maxT) container.scrollTop  = maxT;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Force floor view and sync selection when entering pick mode.
  // Move mode starts with empty selection — the host must explicitly choose a new table.
  useEffect(() => {
    if (pickMode) {
      setView('floor');
      setPickSelection(pickAction === 'move' ? [] : pickIds);
      setPickWarn(null);
      setPickCurrentWarn(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode]);

  // Drag-to-select — document-level mouse handlers active only in pick mode
  useEffect(() => {
    if (!pickMode) return;

    function handleMouseMove(e: MouseEvent) {
      if (!dragStartRef.current || !canvasScrollRef.current) return;
      const container = canvasScrollRef.current;
      const rect = container.getBoundingClientRect();
      const cx = (e.clientX - rect.left + container.scrollLeft) / floorZoomRef.current;
      const cy = (e.clientY - rect.top + container.scrollTop) / floorZoomRef.current;
      const { cx: sx, cy: sy } = dragStartRef.current;
      if (Math.abs(cx - sx) > 5 || Math.abs(cy - sy) > 5) {
        isDraggingRef.current = true;
        setDragRect({
          x: Math.min(sx, cx), y: Math.min(sy, cy),
          w: Math.abs(cx - sx), h: Math.abs(cy - sy),
        });
      }
    }

    function handleMouseUp(e: MouseEvent) {
      if (isDraggingRef.current && dragStartRef.current && canvasScrollRef.current) {
        const container = canvasScrollRef.current;
        const rect = container.getBoundingClientRect();
        const cx = (e.clientX - rect.left + container.scrollLeft) / floorZoomRef.current;
        const cy = (e.clientY - rect.top + container.scrollTop) / floorZoomRef.current;
        const { cx: sx, cy: sy } = dragStartRef.current;
        const fr = {
          x: Math.min(sx, cx), y: Math.min(sy, cy),
          w: Math.abs(cx - sx), h: Math.abs(cy - sy),
        };
        if (fr.w > 8 && fr.h > 8) {
          setPickSelection(() => {
            const newIds = tables.filter(t => {
              if (!t.isActive) return false;
              if (pickAction === 'move' && pickIds.includes(t.id)) return false;
              const sug = pickSuggestions.find(s => s.tableId === t.id);
              const unavail = sug
                ? sug.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED')
                : false;
              if (unavail) return false;
              return (
                t.posX < fr.x + fr.w && t.posX + t.width  > fr.x &&
                t.posY < fr.y + fr.h && t.posY + t.height > fr.y
              );
            }).map(t => t.id);
            return newIds;
          });
        }
      }
      dragStartRef.current  = null;
      isDraggingRef.current = false;
      setDragRect(null);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [pickMode, tables, pickSuggestions, floorZoom]);

  // Ctrl+Wheel zoom — must be a non-passive listener to call preventDefault.
  // No deps: re-registers on every render so the listener stays current regardless
  // of whether the canvas is initially visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = canvasScrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomIdx(i => e.deltaY < 0
        ? Math.min(ZOOM_STEPS.length - 1, i + 1)
        : Math.max(0, i - 1)
      );
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('button')) return;
    const container = canvasScrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragStartRef.current = {
      cx: (e.clientX - rect.left + container.scrollLeft) / floorZoom,
      cy: (e.clientY - rect.top + container.scrollTop) / floorZoom,
    };
    isDraggingRef.current = false;
  }

  function getPickStatus(t: FloorTable): PickStatus {
    // In move mode, the guest's current table is shown as 'current' — not a valid target.
    if (pickAction === 'move' && pickIds.includes(t.id)) return 'current';
    const sug = pickSuggestions.find(s => s.tableId === t.id);
    if (!sug) return null;
    // Only genuine conflicts/locks are hard-unavailable; capacity mismatches (TOO_SMALL) are advisory.
    if (sug.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED')) {
      return 'unavailable';
    }
    // TOO_SMALL-only blocked → downgrade to 'tight' (selectable with warning)
    if (sug.status === 'blocked') return 'tight';
    return sug.status as PickStatus;
  }

  if (loadError) {
    if (errorPhase !== 'failed') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-iron-muted">
          <div className="w-5 h-5 border-2 border-iron-muted/40 border-t-iron-muted/80 rounded-full animate-spin mb-1" />
          <p className="text-sm">{T.floorBoard.reconnecting}</p>
          <p className="text-xs opacity-50">{T.floorBoard.reconnectingHint}</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-iron-muted">
        <div className="w-10 h-10 rounded-lg border-2 border-dashed border-red-900/40 flex items-center justify-center mb-1">
          <span className="text-lg opacity-60 text-red-400">!</span>
        </div>
        <p className="text-sm text-red-400">{T.floorBoard.errorTitle}</p>
        <p className="text-xs opacity-60">{T.floorBoard.errorHint}</p>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-iron-muted">
        <div className="w-10 h-10 rounded-lg border-2 border-dashed border-iron-border flex items-center justify-center mb-1">
          <span className="text-lg opacity-40">⊞</span>
        </div>
        <p className="text-sm">{T.floorBoard.emptyTitle}</p>
        <p className="text-xs opacity-50">{T.floorBoard.emptyHint}</p>
      </div>
    );
  }

  // Defensive deduplication: guard against duplicate table IDs from any source.
  // Uses a Map so the last occurrence wins (same behavior as before, deterministic).
  const dedupedTables = (() => {
    const seen = new Map<string, FloorTable>();
    for (const t of tables) seen.set(t.id, t);
    const result = Array.from(seen.values());
    if (result.length < tables.length) {
      const dupeIds = tables.map(t => t.id).filter((id, i, a) => a.indexOf(id) !== i);
      console.warn('[FloorBoard] duplicate table IDs detected — deduped:', dupeIds);
    }
    return result;
  })();

  // Only explicitly-placed tables render on canvas / grid. Seed tables at the
  // default origin (posX ≤ 5 AND posY ≤ 5) are excluded so they cannot ghost.
  const canvasTables = dedupedTables.filter(t => t.posX > 5 && t.posY > 5);
  // Use positioned-only set when any table has been placed; fall back to all
  // tables only when no layout exists yet (brand-new restaurant).
  const visibleTables = canvasTables.length > 0 ? canvasTables : dedupedTables;

  // ── Section floor zones ────────────────────────────────────────────────────
  // Faint colored bounding boxes behind each section — architectural identity.
  // Only rendered when there are ≥2 tables in a section to avoid boxing singletons.
  const PAD = 32;
  const sectionFloorZones = (() => {
    const bySection = new Map<string, { color: string; minX: number; minY: number; maxX: number; maxY: number; count: number }>();
    for (const t of canvasTables) {
      if (!t.section) continue;
      const key = t.section.id;
      const rx = t.posX + t.width;
      const ry = t.posY + t.height;
      if (!bySection.has(key)) {
        bySection.set(key, { color: t.section.color, minX: t.posX, minY: t.posY, maxX: rx, maxY: ry, count: 1 });
      } else {
        const z = bySection.get(key)!;
        z.minX = Math.min(z.minX, t.posX);
        z.minY = Math.min(z.minY, t.posY);
        z.maxX = Math.max(z.maxX, rx);
        z.maxY = Math.max(z.maxY, ry);
        z.count += 1;
      }
    }
    return Array.from(bySection.entries())
      .filter(([, z]) => z.count >= 2)
      .map(([id, z]) => ({ id, color: z.color, minX: z.minX, minY: z.minY, maxX: z.maxX, maxY: z.maxY }));
  })();

  // ── Section groups (grid fallback) ──────────────────────────────────────────
  const sectionMap = new Map<string, SectionGroup>();
  const noSection: FloorTable[] = [];

  for (const t of visibleTables) {
    if (t.section) {
      const key = t.section.id;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, { id: key, name: t.section.name, color: t.section.color, tables: [] });
      }
      sectionMap.get(key)!.tables.push(t);
    } else {
      noSection.push(t);
    }
  }

  const groups: SectionGroup[] = [
    ...Array.from(sectionMap.values()),
    ...(noSection.length > 0
      ? [{ id: '__none__', name: T.floorBoard.sectionOther, color: '#6B7280', tables: noSection }]
      : []),
  ];

  const sections = Array.from(sectionMap.values());

  function isSelected(t: FloorTable): boolean {
    if (!selectedId) return false;
    if (t.currentReservation?.id === selectedId) return true;
    return t.upcomingReservations.some(r => r.id === selectedId);
  }

  function handleClick(t: FloorTable) {
    // Waitlist assignment mode: clicking an available table replaces the current selection
    if (waitlistAssignEntry) {
      if (t.liveStatus === 'AVAILABLE' && !t.locked) {
        onWaitlistTablePick?.(t.id);
      } else {
        // Flash the ineligible table so the host understands why nothing changed
        setWlPickWarn(t.id);
        setTimeout(() => setWlPickWarn(w => (w === t.id ? null : w)), 1200);
      }
      return;
    }
    // Reorganize mode: any table click is forwarded to the manager's lift flow
    if (reorganizeMode) {
      onReorganizeTableClick?.(t);
      return;
    }
    // Pick mode: toggle or warn
    if (pickMode) {
      const ps = getPickStatus(t);
      if (ps === 'current') {
        setPickCurrentWarn(true);
        setTimeout(() => setPickCurrentWarn(false), 2500);
        return;
      }
      if (ps === 'unavailable') {
        setPickWarn(t.id);
        setTimeout(() => setPickWarn(w => (w === t.id ? null : w)), 2500);
        return;
      }
      setPickSelection(prev =>
        prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
      );
      return;
    }
    // Combine mode: toggle available tables
    if (combineMode) {
      if (t.liveStatus === 'AVAILABLE' && !t.locked && !softHoldMap[t.id]) {
        onCombineToggle?.(t.id);
      }
      return;
    }
    const res = (t.currentReservation ?? t.upcomingReservations[0]) as Reservation | undefined;
    if (res) {
      onSelect(res);
    } else if (t.liveStatus === 'AVAILABLE') {
      if (t.locked) { setLockedWarning(t); return; }
      const held = softHoldMap[t.id];
      if (held) { setSoftHoldWarning({ table: t, entry: held }); return; }
      if (onAvailableClick) onAvailableClick(t);
    }
  }

  function handleContextMenu(e: React.MouseEvent, t: FloorTable) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 160);
    const y = Math.min(e.clientY, window.innerHeight - 80);
    setCtxMenu({ x, y, table: t });
  }

  // ── Turn data ─────────────────────────────────────────────────────────────────
  const turnData = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (!r.tableId || !['PENDING', 'CONFIRMED'].includes(r.status)) continue;
    const arr = turnData.get(r.tableId) ?? [];
    arr.push(r);
    turnData.set(r.tableId, arr);
  }
  for (const arr of turnData.values()) arr.sort((a, b) => a.time.localeCompare(b.time));

  // ── Stats (derived from deduplicated set for accurate counters) ──────────────
  // "Seated" counts SEATED RESERVATIONS (parties), not occupied tables.
  // A combined-table booking occupies 2 tables but is 1 party — counting by
  // table would always exceed the ReservationPanel's SEATED filter count.
  const available    = dedupedTables.filter(t => t.liveStatus === 'AVAILABLE').length;
  const seatedParties = (reservations ?? []).filter(r => r.status === 'SEATED').length;
  const reservedSoon = dedupedTables.filter(t => t.liveStatus === 'RESERVED_SOON').length;
  const reserved     = (reservations ?? []).filter(r => r.status === 'CONFIRMED' || r.status === 'PENDING').length;

  // Tables that will free within 15 min — anticipation signal for upcoming capacity.
  // Only meaningful on today's view where timers are live.
  const todayStr   = new Date().toISOString().slice(0, 10);
  const isToday    = !date || date === todayStr;
  const freeingSoon = isToday ? dedupedTables.filter(t => {
    if (t.liveStatus !== 'OCCUPIED' || !t.currentReservation) return false;
    const mr = minutesUntilEnd(t.currentReservation.expectedEndTime, Date.now());
    return mr > 0 && mr <= 15;
  }).length : 0;

  // Peripheral quieting: when the room is under pressure (waitlist + no room),
  // available tables gently recede so active zones emerge without any explicit signal.
  const underPressure = waitlist.length > 0 && available <= 2;
  const quietIdle = underPressure && !pickMode && !waitlistAssignEntry && !combineMode && !reorganizeMode;

  // ── Service pressure score ─────────────────────────────────────────────────
  // Continuous 0.0–1.0 signal from live data. Drives atmosphere only — no alerts.
  // Components: room occupancy (40%), waitlist depth (30%), overdue weight (20%), wave size (10%).
  const _overdueCount  = canvasTables.filter(t => t.currentReservation?.isOverdue).length;
  const _waitingCount  = waitlist.filter(e => e.status === 'WAITING' || e.status === 'NOTIFIED').length;
  const pressureScore  = Math.min(1,
    (canvasTables.filter(t => t.liveStatus === 'OCCUPIED').length / Math.max(canvasTables.length, 1)) * 0.40 +
    Math.min(_waitingCount / 5, 1) * 0.30 +
    Math.min(_overdueCount / 3, 1) * 0.20 +
    Math.min(reservedSoon  / 4, 1) * 0.10
  );
  // quietFade: smooth opacity target for idle AVAILABLE tables — 0 = full, 0.4 = max recession.
  const quietFade = quietIdle ? Math.max(0.10, pressureScore * 0.40) : 0;

  // ── Service energy ──────────────────────────────────────────────────────────
  // Normalized 0–1 live-floor-activity signal. Unlike pressureScore (which weights
  // waitlist depth and wave size), serviceEnergy tracks only what is physically
  // alive on the floor right now: occupied density, overdue tension, arrival wave.
  // Used to micro-modulate ambient warmth — the room feels calmer when empty,
  // slightly richer and more inhabited during active service.
  const _occupiedCount = canvasTables.filter(t => t.liveStatus === 'OCCUPIED').length;
  const serviceEnergy  = Math.min(1,
    (_occupiedCount  / Math.max(canvasTables.length, 1)) * 0.70 +
    Math.min(_overdueCount / 4, 1) * 0.18 +
    Math.min(reservedSoon  / 5, 1) * 0.12
  );

  const positioned = hasPositions(dedupedTables);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Pick mode banner */}
      {pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-blue-900/20 border-b border-blue-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <span className="text-blue-300 text-xs font-medium flex-1">
            {pickAction === 'move' && pickGuestName
              ? T.floorBoard.pickModeMoveHint(pickGuestName)
              : T.floorBoard.pickModeHint}
          </span>
        </div>
      )}

      {/* Reorganize mode banner */}
      {reorganizeMode && !pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-900/20 border-b border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="text-amber-300 text-xs font-medium flex-1">
            {T.floorBoard.reorganizeBanner}
          </span>
        </div>
      )}

      {/* Waitlist assignment mode banner */}
      {waitlistAssignEntry && !pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-indigo-900/20 border-b border-indigo-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
          <span className="text-indigo-300 text-xs font-medium flex-1">
            {T.waitlistAssign.chooseBanner(waitlistAssignEntry.guestName, waitlistAssignEntry.partySize)}
          </span>
          <button
            onClick={onWaitlistAssignCancel}
            className="text-indigo-400/60 hover:text-indigo-300 text-xs transition-colors shrink-0"
          >
            {T.waitlistAssign.cancelAssign}
          </button>
        </div>
      )}

      {/* Stats + section legend */}
      <div className="flex items-center gap-4 px-5 py-3 bg-iron-elevated shrink-0 flex-wrap" style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.04), 0 2px 12px rgba(0,0,0,0.30)' }}>
        {/* Live service state — what's happening right now */}
        <Stat label={T.floorBoard.statSeated}    value={seatedParties} color="text-iron-green-light" />
        {reservedSoon > 0 && <Stat label={T.floorBoard.statArriving} value={reservedSoon} color="text-amber-400" />}
        {/* Freeing soon — only surfaces when capacity is actually tight (≤1 available).
            Color is quiet green, not amber: this is good news, not a warning. */}
        {freeingSoon > 0 && available <= 1 && <Stat label={T.floorBoard.statFreeing} value={freeingSoon} color="text-iron-green-light/50" />}
        {/* Divider: live | upcoming */}
        <div className="w-px h-3 bg-iron-border/50 -mx-1" />
        {/* Upcoming — what's booked and what's open */}
        <Stat label={T.floorBoard.statReserved}  value={reserved}     color="text-blue-400" />
        <Stat label={T.floorBoard.statAvailable} value={available}    color="text-iron-muted" />

        {positioned && sections.length > 0 && (
          <>
            <div className="w-px h-3 bg-iron-border mx-1" />
            {sections.map(sec => (
              <button
                key={sec.id}
                className="flex items-center gap-1.5 transition-opacity"
                style={{ opacity: hoveredSectionId !== null && hoveredSectionId !== sec.id ? 0.4 : 1 }}
                onMouseEnter={() => setHoveredSectionId(sec.id)}
                onMouseLeave={() => setHoveredSectionId(null)}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sec.color }} />
                <span className="text-iron-muted text-[11px]">{formatSectionName(sec.name, locale)}</span>
              </button>
            ))}
          </>
        )}

        {pressureInfo && pressureInfo.level !== 'LOW' && (
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-medium ${
            pressureInfo.level === 'HIGH'
              ? 'bg-red-900/20 border-red-500/25 text-red-400'
              : 'bg-amber-900/20 border-amber-500/25 text-amber-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pressureInfo.level === 'HIGH' ? 'bg-red-500' : 'bg-amber-500'}`} />
            {pressureInfo.level === 'HIGH' ? T.flowControl.pressureHigh : T.flowControl.pressureMed}
            {pressureInfo.label && <span className="opacity-70">· {pressureInfo.label}</span>}
          </div>
        )}

        <span className="ml-auto text-[10px] text-iron-muted">{T.floorBoard.tableCount(dedupedTables.length)}</span>

        <div className="flex items-center gap-px ml-3 rounded border border-iron-border overflow-hidden shrink-0">
          {(['floor', 'timeline'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => !pickMode && setView(v)}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                view === v
                  ? 'bg-iron-green/20 text-iron-green-light'
                  : 'text-iron-muted hover:text-iron-text hover:bg-iron-border/30'
              } ${pickMode ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {v === 'floor' ? T.floorBoard.viewFloor : T.floorBoard.viewTimeline}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline view */}
      {view === 'timeline' && !pickMode && date && (
        <TableTimeline
          tables={tables}
          reservations={reservations}
          date={date}
          operationalNow={operationalNow ?? Date.now()}
          selectedId={selectedId}
          onSelect={onSelect}
          waitlist={waitlist}
          onGapClick={onGapClick}
          onGapWaitlistSeat={onGapWaitlistSeat}
          onQuickAction={onQuickAction}
        />
      )}

      {(view === 'floor' || pickMode) && (positioned ? (
        // ── Visual floor map ──────────────────────────────────────────────────
        (() => {
          // ── Phase 20: Adaptive Day/Night canvas values ───────────────────
          // All signals derived from { timeWarmth, brightness, gridFade } —
          // no theme toggles, no visible modes. The room simply understands service.
          const isDark = typeof document !== 'undefined'
            ? document.documentElement.getAttribute('data-theme') !== 'light'
            : true;

          // Grid — architectural reference lines; warm neutral to avoid blue cast
          const gridAlpha  = isDark
            ? 0.016 * (1 - gridFade * 0.90)
            : 0.050 * (1 - gridFade * 0.70);
          const gridRgb    = isDark ? '200,196,190' : '0,0,0';
          const gridColor  = `rgba(${gridRgb},${gridAlpha.toFixed(4)})`;

          // Ambient bloom — warm candlelight white; no blue channel drift
          const ambW = Math.round(72 + brightness * 14); // 86% morning → 72% dinner
          const ambH = Math.round(58 + brightness * 12); // 70% morning → 58% dinner
          const ambA = (0.004 + brightness * 0.002 + timeWarmth * 0.002).toFixed(4);
          // Pace: 14s at morning, slows to ~22s at peak dinner (room feels dense and full)
          const ambDuration = (14 + timeWarmth * 4 + (1 - brightness) * 4).toFixed(1);

          return (
        <div className="flex-1 relative overflow-hidden">
        <div ref={canvasScrollRef} className="absolute inset-0 overflow-auto">
          <div
            onMouseDown={pickMode ? handleCanvasMouseDown : undefined}
            style={{
              position: 'relative',
              width: CANVAS_W,
              height: CANVAS_H,
              zoom: floorZoom,
              backgroundColor: 'var(--canvas-bg)',
              backgroundImage: [
                // Subtle ambient center bloom — just enough warmth to ground the space
                'radial-gradient(ellipse 80% 65% at 50% 38%, var(--canvas-ambient) 0%, transparent 70%)',
                // Grid H
                `linear-gradient(0deg, transparent 27.5px, ${gridColor} 27.5px, ${gridColor} 28px, transparent 28px)`,
                // Grid V
                `linear-gradient(90deg, transparent 27.5px, ${gridColor} 27.5px, ${gridColor} 28px, transparent 28px)`,
              ].join(', '),
              backgroundSize: 'auto, 28px 28px, 28px 28px',
              userSelect: pickMode ? 'none' : undefined,
            }}
          >
            {/* Architectural environment — walls, floor materials, booth backings, VIP enclosures */}
            {positioned && (
              <ArchLayer
                tables={canvasTables}
                floorObjs={floorObjs}
                timeWarmth={timeWarmth}
                brightness={brightness}
              />
            )}

            {/* Ambient breathing — chandelier bloom.
                Color drifts from neutral warm-white at morning to golden amber at dinner.
                Ellipse widens to diffuse daylight at morning, focuses to candlelight at dinner.
                Pace slows from 14s (morning clarity) to ~22s (dinner density). */}
            <div
              className="animate-ambient-breathe"
              style={{
                position: 'absolute', inset: 0,
                background: `radial-gradient(ellipse ${ambW}% ${ambH}% at 50% 36%, rgba(255,244,230,${ambA}) 0%, transparent 65%)`,
                animationDuration: `${ambDuration}s`,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            {/* Section floor zones — faint tinted bounding boxes for spatial identity */}
            {positioned && sectionFloorZones.map(z => (
              <div
                key={z.id}
                style={{
                  position: 'absolute',
                  left:   z.minX - PAD,
                  top:    z.minY - PAD,
                  width:  z.maxX - z.minX + PAD * 2,
                  height: z.maxY - z.minY + PAD * 2,
                  borderRadius: 24,
                  border: `1px solid ${z.color}0A`,
                  background: `radial-gradient(ellipse 80% 75% at 50% 48%, ${z.color}05 0%, ${z.color}02 60%, transparent 85%)`,
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* Floor objects — SVG-rendered kinds (PLANTER / SERVICE_LANE / LOUNGE_BOUNDARY / VIP_ENCLOSURE)
                are handled inside ArchLayer. Only HTML-renderable kinds appear here. */}
            {floorObjs.filter(o => !SVG_RENDERED_KINDS.has(o.kind)).map(o => {
              const a = getObjAppearance(o, timeWarmth, brightness);
              return (
                <div
                  key={o.id}
                  style={{
                    position: 'absolute',
                    left: o.posX, top: o.posY,
                    width: o.width, height: o.height,
                    backgroundColor:  a.bg,
                    backgroundImage:  a.backgroundImage,
                    border:           a.border,
                    borderRadius:     a.borderRadius,
                    boxShadow:        a.boxShadow,
                    transform:        o.rotation ? `rotate(${o.rotation}deg)` : undefined,
                    transformOrigin:  o.rotation ? 'center center' : undefined,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{
                    fontSize:      a.labelSize,
                    fontWeight:    a.labelWeight,
                    color:         a.labelColor,
                    opacity:       a.labelOpacity,
                    userSelect:    'none',
                    padding:       '0 4px',
                    textAlign:     'center',
                    letterSpacing: a.labelLetterSpacing,
                    textTransform: a.labelTransform,
                  }}>
                    {o.label}
                  </span>
                </div>
              );
            })}

            {/* Spatial energy field — occupied spotlight + bar anchor + arrival warmth + overdue tinge.
                Suppressed during pick/assign modes: those modes trigger rapid re-renders on every
                tap and SEF is the costliest component (N² density, 30+ SVG gradients). */}
            {!pickMode && !waitlistAssignEntry && (
              <SpatialEnergyField tables={canvasTables} pressureScore={pressureScore} timeWarmth={timeWarmth} serviceEnergy={serviceEnergy} />
            )}

            {/* Chair silhouettes — semantic furniture geometry around table perimeters */}
            <ChairLayer
              tables={canvasTables}
              floorObjs={floorObjs}
              dimmedTableIds={new Set<string>(
                canvasTables
                  .filter(t => !pickMode && (
                    (hoveredSectionId !== null && t.section?.id !== hoveredSectionId) ||
                    (!!waitlistAssignEntry && (t.liveStatus !== 'AVAILABLE' || t.locked))
                  ))
                  .map(t => t.id)
              )}
              pickMode={pickMode}
              timeWarmth={timeWarmth}
            />

            {canvasTables.map(t => {
              const insight    = insights.find(i => i.tableId === t.id);
              const ineligibleForAssign = !!waitlistAssignEntry && !pickMode && (t.liveStatus !== 'AVAILABLE' || t.locked);
              const dimmed     = !pickMode && (
                (hoveredSectionId !== null && t.section?.id !== hoveredSectionId) ||
                ineligibleForAssign
              );
              const wMatch     = waitlistMatches[t.id];
              const turns      = turnData.get(t.id) ?? [];
              const extraTurns = Math.max(0, turns.length - 1);
              const turnTooltip = turns.length > 0
                ? `${t.name} · upcoming:\n${turns.map(r => `${r.time}  ${r.guestName}  ·  ${r.partySize}p`).join('\n')}`
                : undefined;
              const ps = pickMode ? getPickStatus(t) : null;
              const isWLCanvasTarget = !!waitlistAssignEntry && !pickMode && waitlistAssignTableId === t.id;
              return (
                <MapTable
                  key={t.id}
                  table={t}
                  selected={!pickMode && !waitlistAssignEntry && isSelected(t)}
                  combinedSelected={!pickMode && combinedSelection.includes(t.id)}
                  dimmed={dimmed}
                  bestSuggestion={!pickMode && !isSelected(t) && !waitlistAssignEntry && t.id === bestSuggestionTableId}
                  waitlistAssignTarget={isWLCanvasTarget}
                  softHold={!pickMode ? softHoldMap[t.id] : undefined}
                  onClick={() => handleClick(t)}
                  onContextMenu={e => !pickMode && handleContextMenu(e, t)}
                  insight={!pickMode ? insight : undefined}
                  onInsightAction={
                    !pickMode && insight?.reservationId
                      ? () => onInsightAction?.(t.id, insight.reservationId!)
                      : undefined
                  }
                  waitlistMatch={!pickMode && !waitlistAssignEntry ? wMatch : undefined}
                  onWaitlistAction={!pickMode && !waitlistAssignEntry && wMatch ? () => onWaitlistSuggestion?.(t.id, wMatch) : undefined}
                  nowTime={nowTime}
                  operationalNow={operationalNow}
                  date={date}
                  extraTurns={pickMode ? 0 : extraTurns}
                  turns={pickMode ? [] : turns}
                  turnTooltip={pickMode ? undefined : turnTooltip}
                  pickMode={pickMode}
                  pickSelected={pickMode && pickSelection.includes(t.id)}
                  pickStatus={ps}
                  wlPickWarn={wlPickWarn === t.id}
                  quietFade={quietFade}
                  hoveredResId={hoveredResId}
                />
              );
            })}

            {/* Drag selection rect */}
            {pickMode && dragRect && (
              <div
                style={{
                  position: 'absolute',
                  left: dragRect.x, top: dragRect.y,
                  width: dragRect.w, height: dragRect.h,
                  border: '1.5px solid rgba(59,130,246,0.7)',
                  backgroundColor: 'rgba(59,130,246,0.07)',
                  pointerEvents: 'none',
                  zIndex: 100,
                }}
              />
            )}
          </div>
        </div>
        {/* Zoom controls — absolute in outer wrapper, never scrolls with canvas */}
        <div className="absolute bottom-3 left-3 z-30 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            title={T.floorBoard.zoomOut}
            className="w-8 h-8 flex items-center justify-center rounded border border-iron-border/40 bg-iron-elevated/90 text-iron-muted hover:text-iron-text hover:border-iron-border/70 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors select-none touch-manipulation"
          >−</button>
          <button
            type="button"
            onClick={() => setZoomIdx(1)}
            title={T.floorBoard.zoomReset}
            className="h-8 px-2.5 flex items-center justify-center rounded border border-iron-border/40 bg-iron-elevated/90 text-iron-muted hover:text-iron-text hover:border-iron-border/70 text-[10px] tabular-nums font-medium transition-colors select-none touch-manipulation"
          >{Math.round(floorZoom * 100)}%</button>
          <button
            type="button"
            onClick={() => setZoomIdx(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOM_STEPS.length - 1}
            title={T.floorBoard.zoomIn}
            className="w-8 h-8 flex items-center justify-center rounded border border-iron-border/40 bg-iron-elevated/90 text-iron-muted hover:text-iron-text hover:border-iron-border/70 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors select-none touch-manipulation"
          >+</button>
        </div>
        </div>
          );
        })()
      ) : (
        // ── Grouped grid (fallback when no positions saved) ────────────────────
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {groups.map(group => (
            <section key={group.id} className="relative">
              {/* Faint section color wash — zone identity at 3% opacity */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0,
                  borderRadius: 10,
                  backgroundColor: group.color,
                  opacity: 0.03,
                  pointerEvents: 'none',
                }}
              />
              <div className="flex items-center gap-3 mb-4">
                <div className="w-px h-4 rounded-full shrink-0" style={{ backgroundColor: group.color, opacity: 0.58 }} />
                <h3 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-iron-muted/48">
                  {formatSectionName(group.name, locale)}
                </h3>
                <div className="flex-1 h-px bg-iron-border/18" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                {group.tables.map(t => {
                  const insight    = insights.find(i => i.tableId === t.id);
                  const wMatch     = waitlistMatches[t.id];
                  const turns      = turnData.get(t.id) ?? [];
                  const extraTurns = Math.max(0, turns.length - 1);
                  const turnTooltip = turns.length > 0
                    ? `${t.name} · upcoming:\n${turns.map(r => `${r.time}  ${r.guestName}  ·  ${r.partySize}p`).join('\n')}`
                    : undefined;
                  const isPickSelected = pickMode && pickSelection.includes(t.id);
                  const isWLTarget = !!waitlistAssignEntry && !pickMode && waitlistAssignTableId === t.id;
                  const ineligibleForAssign = !!waitlistAssignEntry && !pickMode && (t.liveStatus !== 'AVAILABLE' || t.locked);
                  return (
                    <div
                      key={t.id}
                      className={
                        isWLTarget
                          ? 'ring-2 ring-indigo-500/60 rounded-lg'
                          : wlPickWarn === t.id
                          ? 'ring-2 ring-red-500/60 rounded-lg'
                          : isPickSelected || combinedSelection.includes(t.id)
                          ? 'ring-2 ring-blue-500/50 rounded-lg'
                          : ''
                      }
                      style={ineligibleForAssign ? { opacity: 0.3 } : undefined}
                    >
                      <TableCard
                        table={t}
                        selected={!pickMode && !waitlistAssignEntry && isSelected(t)}
                        isBestSuggestion={!pickMode && !isSelected(t) && !waitlistAssignEntry && t.id === bestSuggestionTableId}
                        softHold={!pickMode ? softHoldMap[t.id] : undefined}
                        onClick={() => handleClick(t)}
                        onContextMenu={e => !pickMode && handleContextMenu(e, t)}
                        insight={!pickMode ? insight : undefined}
                        onInsightAction={
                          !pickMode && insight?.reservationId
                            ? () => onInsightAction?.(t.id, insight.reservationId!)
                            : undefined
                        }
                        waitlistMatch={!pickMode && !waitlistAssignEntry ? wMatch : undefined}
                        onWaitlistAction={!pickMode && !waitlistAssignEntry && wMatch ? () => onWaitlistSuggestion?.(t.id, wMatch) : undefined}
                        nowTime={nowTime}
                        operationalNow={operationalNow}
                        date={date}
                        extraTurns={pickMode ? 0 : extraTurns}
                        turnTooltip={pickMode ? undefined : turnTooltip}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ))}

      {/* Right-click context menu */}
      {ctxMenu && !pickMode && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div
            className="fixed z-50 bg-iron-elevated border border-iron-border/55 rounded-xl py-1 min-w-[10rem]"
            style={{ left: ctxMenu.x, top: ctxMenu.y, boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.32)' }}
          >
            <div className="px-3 py-1 border-b border-iron-border/50 mb-1">
              <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-wider">{ctxMenu.table.name}</span>
            </div>
            {ctxMenu.table.locked ? (
              <button
                onClick={() => { onUnlockTable?.(ctxMenu.table.id); setCtxMenu(null); }}
                className="w-full text-left px-3 py-2 text-xs text-iron-text hover:bg-iron-bg transition-colors touch-manipulation"
              >
                {T.floorBoard.unlockTable}
              </button>
            ) : (
              <button
                onClick={() => { onLockTable?.(ctxMenu.table); setCtxMenu(null); }}
                className="w-full text-left px-3 py-2 text-xs text-iron-text hover:bg-iron-bg transition-colors touch-manipulation"
              >
                {T.floorBoard.lockTable}
              </button>
            )}
          </div>
        </>
      )}

      {/* Locked table warning */}
      {lockedWarning && !pickMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-iron-elevated border border-iron-border/50 rounded-xl p-5 w-72 space-y-3" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.40)' }}>
            <div>
              <p className="text-iron-text text-sm font-semibold">{T.floorBoard.lockedTitle(lockedWarning.name)}</p>
              {lockedWarning.lockReason && (
                <p className="text-iron-muted text-xs mt-0.5">{lockedWarning.lockReason}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => { const t = lockedWarning; setLockedWarning(null); onUnlockTable?.(t.id); }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-iron-bg border border-iron-border text-iron-text hover:border-iron-text/40 transition-colors"
              >
                {T.floorBoard.unlockTable}
              </button>
              <button
                onClick={() => { const t = lockedWarning; setLockedWarning(null); onAvailableClick?.(t); }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 transition-colors"
              >
                {T.floorBoard.seatAnyway}
              </button>
              <button
                onClick={() => setLockedWarning(null)}
                className="text-xs text-iron-muted hover:text-iron-text py-1.5 transition-colors"
              >
                {T.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Soft hold warning */}
      {softHoldWarning && !pickMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-iron-elevated border border-iron-border/50 rounded-xl p-5 w-72 space-y-3" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.65), 0 4px 16px rgba(0,0,0,0.40)' }}>
            <div>
              <p className="text-iron-text text-sm font-semibold">
                {T.flowControl.softHoldTitle(softHoldWarning.entry.guestName)}
              </p>
              <p className="text-iron-muted text-xs mt-0.5">
                {T.common.guests(softHoldWarning.entry.partySize)}
                {' · '}
                {T.flowControl.softHoldWaiting(
                  Math.floor(((operationalNow ?? Date.now()) - new Date(softHoldWarning.entry.addedAt).getTime()) / 60_000)
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => {
                  const { table, entry } = softHoldWarning;
                  setSoftHoldWarning(null);
                  onWaitlistSuggestion?.(table.id, entry);
                }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-iron-green/15 border border-iron-green/40 text-iron-green-light hover:bg-iron-green/25 transition-colors font-medium"
              >
                {T.flowControl.softHoldSeat(softHoldWarning.entry.guestName)}
              </button>
              <button
                onClick={() => {
                  const { table, entry } = softHoldWarning;
                  logOverride(table.id, entry);
                  setSoftHoldWarning(null);
                  onAvailableClick?.(table);
                }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-iron-bg border border-iron-border text-iron-muted hover:text-iron-text hover:border-iron-text/30 transition-colors"
              >
                {T.flowControl.softHoldIgnore}
              </button>
              <button
                onClick={() => setSoftHoldWarning(null)}
                className="text-xs text-iron-muted hover:text-iron-text py-1.5 transition-colors"
              >
                {T.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pick mode action bar */}
      {pickMode && (
        <div className="shrink-0 border-t border-blue-500/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {pickCurrentWarn ? (
              <span className="text-amber-400 text-xs font-medium">{T.floorBoard.pickModeCurrentTableWarn}</span>
            ) : pickWarn ? (
              (() => {
                const wt = tables.find(t => t.id === pickWarn);
                const reason = wt ? ` — ${T.tableStatus[wt.liveStatus] ?? ''}` : '';
                return <span className="text-red-400 text-xs font-medium">{T.floorBoard.pickModeUnavailable(wt?.name ?? pickWarn)}{reason}</span>;
              })()
            ) : pickSelection.length === 0 ? (
              <span className="text-blue-400 text-sm">
                {pickAction === 'move' && pickGuestName
                  ? T.floorBoard.pickModeMoveHint(pickGuestName)
                  : T.floorBoard.pickModeHint}
              </span>
            ) : (
              <span className="text-iron-text text-sm font-semibold truncate">
                {pickSelection.map(id => tables.find(t => t.id === id)?.name ?? id).join(' + ')}
                <span className="text-iron-muted font-normal text-xs ml-1.5">
                  · {T.floorBoard.pickModeSelected(pickSelection.length)}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onPickCancel}
            className="text-iron-muted text-xs hover:text-iron-text transition-colors shrink-0 py-2 px-1 touch-manipulation"
          >
            {T.floorBoard.pickModeCancel}
          </button>
          <button
            type="button"
            onClick={() => onPickDone?.(pickSelection)}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            {T.floorBoard.pickModeConfirm}
          </button>
        </div>
      )}

      {/* Waitlist assign confirmation bar */}
      {waitlistAssignEntry && !pickMode && (
        <div className="shrink-0 border-t border-indigo-500/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {waitlistAssignTableId ? (
              <span className="text-iron-text text-sm font-semibold truncate">
                {T.waitlistAssign.confirmSeat(
                  waitlistAssignEntry.guestName,
                  tables.find(t => t.id === waitlistAssignTableId)?.name ?? waitlistAssignTableId,
                )}
              </span>
            ) : (
              <span className="text-indigo-300 text-sm">
                {T.waitlistAssign.chooseBanner(waitlistAssignEntry.guestName, waitlistAssignEntry.partySize)}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onWaitlistAssignCancel}
            className="text-iron-muted text-xs hover:text-iron-text transition-colors shrink-0 border border-iron-border/40 px-3 py-2 rounded-lg hover:border-iron-border"
          >
            {T.waitlistAssign.cancelAssign}
          </button>
          <button
            type="button"
            onClick={onWaitlistConfirmSeat}
            className="bg-iron-green/80 hover:bg-iron-green text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
          >
            {T.waitlistAssign.seatNow}
          </button>
        </div>
      )}

      {/* Combine-tables action bar */}
      {!pickMode && combineMode && (
        <div className="shrink-0 border-t border-blue-500/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          {combinedSelection.length === 0 ? (
            <span className="text-blue-400 text-sm flex-1">{T.floorBoard.combineHint}</span>
          ) : (
            <>
              <span className="text-iron-text text-sm font-semibold flex-1 truncate">
                {combinedSelection
                  .map(id => tables.find(t => t.id === id)?.name ?? id)
                  .join(' + ')}
              </span>
              <button
                type="button"
                onClick={onCombineCreate}
                disabled={combinedSelection.length < 1}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
              >
                {T.floorBoard.combineCreate}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-xl font-bold tabular-nums leading-none ${color}`}>{value}</span>
      <span className="text-iron-muted/55 text-[9px] uppercase tracking-[0.08em] font-medium">{label}</span>
    </div>
  );
}

// ── Architectural environment layer ──────────────────────────────────────────
// Deepest visual layer: room walls, floor material zoning, booth backings,
// VIP enclosures, and bar framing. Goes before all other SVG layers.
function ArchLayer({ tables, floorObjs, timeWarmth, brightness }: {
  tables: FloorTable[];
  floorObjs: FloorObjectData[];
  timeWarmth: number;
  brightness: number;
}) {
  const sectionBoxes = (() => {
    const map = new Map<string, {
      name: string; color: string;
      minX: number; minY: number; maxX: number; maxY: number; count: number;
    }>();
    for (const t of tables) {
      if (!t.section) continue;
      const sid = t.section.id;
      const x2 = t.posX + t.width, y2 = t.posY + t.height;
      if (!map.has(sid)) {
        map.set(sid, { name: t.section.name, color: t.section.color,
          minX: t.posX, minY: t.posY, maxX: x2, maxY: y2, count: 1 });
      } else {
        const z = map.get(sid)!;
        z.minX = Math.min(z.minX, t.posX); z.minY = Math.min(z.minY, t.posY);
        z.maxX = Math.max(z.maxX, x2);     z.maxY = Math.max(z.maxY, y2);
        z.count++;
      }
    }
    const PAD = 26;
    return Array.from(map.entries())
      .filter(([, z]) => z.count >= 2)
      .map(([id, z]) => {
        const n = z.name.toLowerCase();
        const personality =
          /vip|private|salon|exclusive|presidential/.test(n) ? 'vip' as const :
          /terrace|garden|outdoor|patio|rooftop|pergola/.test(n) ? 'terrace' as const :
          /lounge|cocktail|aperitif/.test(n) ? 'lounge' as const :
          /bar|counter|pass/.test(n) ? 'bar' as const : 'main' as const;
        return {
          id, color: z.color, personality,
          x: z.minX - PAD, y: z.minY - PAD,
          w: (z.maxX - z.minX) + PAD * 2,
          h: (z.maxY - z.minY) + PAD * 2,
        };
      });
  })();

  const bars               = floorObjs.filter(o => o.kind === 'BAR');
  const planters           = floorObjs.filter(o => o.kind === 'PLANTER');
  const lanes              = floorObjs.filter(o => o.kind === 'SERVICE_LANE');
  const loungeBounds       = floorObjs.filter(o => o.kind === 'LOUNGE_BOUNDARY');
  const curvedLoungeBounds = floorObjs.filter(o => o.kind === 'CURVED_LOUNGE_BOUNDARY');
  const vipEnclosures      = floorObjs.filter(o => o.kind === 'VIP_ENCLOSURE');
  const curvedBoothSegs    = floorObjs.filter(o => o.kind === 'CURVED_BOOTH_SEGMENT');
  const booths        = tables.filter(t => t.shape === 'BOOTH' && t.height >= 38);

  const woodOp1 = (0.013 + timeWarmth * 0.005).toFixed(3);
  const woodOp2 = (0.007 + timeWarmth * 0.003).toFixed(3);
  const wallT   = (0.70 + (1 - brightness) * 0.18).toFixed(2);
  const wallS   = (0.60 + (1 - brightness) * 0.15).toFixed(2);
  const wallB   = (0.54 + (1 - brightness) * 0.12).toFixed(2);

  if (tables.length === 0) return null;

  return (
    <svg
      width={CANVAS_W} height={CANVAS_H}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    >
      <defs>
        <pattern id="arch-wood" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(14)">
          <line x1="0"  y1="0" x2="0"  y2="28" stroke={`rgba(210,165,90,${woodOp1})`} strokeWidth="1.2" />
          <line x1="9"  y1="0" x2="9"  y2="28" stroke={`rgba(195,148,78,${woodOp2})`} strokeWidth="0.5" />
          <line x1="19" y1="0" x2="19" y2="28" stroke={`rgba(200,152,80,${woodOp2})`} strokeWidth="0.5" />
        </pattern>
        <pattern id="arch-stone" x="0" y="0" width="44" height="44" patternUnits="userSpaceOnUse">
          <line x1="0"  y1="0"  x2="44" y2="0"  stroke="rgba(155,148,138,0.020)" strokeWidth="0.5" />
          <line x1="0"  y1="22" x2="44" y2="22" stroke="rgba(145,138,128,0.012)" strokeWidth="0.5" />
          <line x1="0"  y1="0"  x2="0"  y2="44" stroke="rgba(155,148,138,0.018)" strokeWidth="0.5" />
          <line x1="22" y1="0"  x2="22" y2="44" stroke="rgba(145,138,128,0.010)" strokeWidth="0.5" />
        </pattern>
        <pattern id="arch-intimate" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0"  y1="0" x2="0"  y2="22" stroke="rgba(130,105,75,0.024)" strokeWidth="0.8" />
          <line x1="11" y1="0" x2="11" y2="22" stroke="rgba(110,88,62,0.014)"  strokeWidth="0.5" />
        </pattern>
        <linearGradient id="arch-wall-t" x1="0" y1="0" x2="0" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor={`rgba(6,4,2,${wallT})`} />
          <stop offset="100%" stopColor="rgba(6,4,2,0)" />
        </linearGradient>
        <linearGradient id="arch-wall-b" x1="0" y1={CANVAS_H} x2="0" y2={CANVAS_H - 40} gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor={`rgba(6,4,2,${wallB})`} />
          <stop offset="100%" stopColor="rgba(6,4,2,0)" />
        </linearGradient>
        <linearGradient id="arch-wall-l" x1="0" y1="0" x2="44" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor={`rgba(6,4,2,${wallS})`} />
          <stop offset="100%" stopColor="rgba(6,4,2,0)" />
        </linearGradient>
        <linearGradient id="arch-wall-r" x1={CANVAS_W} y1="0" x2={CANVAS_W - 44} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor={`rgba(6,4,2,${wallS})`} />
          <stop offset="100%" stopColor="rgba(6,4,2,0)" />
        </linearGradient>
        {/* Shared blur for object grounding shadows — same soft-ellipse approach as table floor shadows */}
        <filter id="arch-gnd-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* ── Object grounding shadows ─────────────────────────────────────────
          Blurred ellipses beneath physical floor objects, using the same pattern
          as table floor-plane shadows in SpatialEnergyField. Rendered first
          (bottom of all SVG layers) so objects and tables sit on top.
          Only physical, mass-carrying kinds: BAR, HOST_STAND, PLANTER,
          DIVIDER, ENTRANCE. Zone markers and lane markings are excluded. */}
      {floorObjs.filter(o =>
        o.kind === 'BAR' || o.kind === 'HOST_STAND' ||
        o.kind === 'PLANTER' || o.kind === 'DIVIDER' || o.kind === 'ENTRANCE'
      ).map(o => {
        const cx = o.posX + o.width  / 2;
        const cy = o.posY + o.height * 0.82;
        let rx: number, ry: number, op: number;
        if (o.kind === 'BAR') {
          rx = o.width * 0.72; ry = Math.max(6, o.height * 0.26); op = 0.055;
        } else if (o.kind === 'HOST_STAND') {
          rx = o.width * 0.70; ry = Math.max(5, o.height * 0.28); op = 0.048;
        } else if (o.kind === 'PLANTER') {
          rx = o.width * 0.68; ry = Math.max(5, o.height * 0.26); op = 0.042;
        } else if (o.kind === 'DIVIDER') {
          rx = o.width * 0.80; ry = Math.max(4, o.height * 0.24); op = 0.032;
        } else {
          // ENTRANCE
          rx = o.width * 0.62; ry = Math.max(4, o.height * 0.20); op = 0.022;
        }
        return (
          <ellipse
            key={`arch-gnd-${o.id}`}
            cx={cx} cy={cy} rx={rx} ry={ry}
            fill="#000" fillOpacity={op}
            filter="url(#arch-gnd-blur)"
          />
        );
      })}

      {/* Floor material zones — each section type has a distinct floor material */}
      {sectionBoxes.map(sec => {
        const pat =
          sec.personality === 'terrace' || sec.personality === 'bar' ? 'arch-stone'
          : sec.personality === 'lounge' || sec.personality === 'vip' ? 'arch-intimate'
          : 'arch-wood';
        return (
          <g key={`arch-floor-${sec.id}`}>
            <rect x={sec.x} y={sec.y} width={sec.w} height={sec.h} rx={10} fill={`url(#${pat})`} />
            {(sec.personality === 'lounge' || sec.personality === 'vip') && (
              <rect
                x={sec.x - 10} y={sec.y - 10} width={sec.w + 20} height={sec.h + 20} rx={14}
                fill={`rgba(8,5,2,${(0.036 + timeWarmth * 0.015).toFixed(3)})`}
              />
            )}
          </g>
        );
      })}

      {/* VIP enclosure — gold architectural ring, double-layered */}
      {sectionBoxes.filter(s => s.personality === 'vip').map(sec => (
        <g key={`arch-vip-${sec.id}`}>
          <rect x={sec.x - 6}  y={sec.y - 6}  width={sec.w + 12} height={sec.h + 12} rx={14}
            fill="none"
            stroke={`rgba(195,162,88,${(0.058 + timeWarmth * 0.022).toFixed(3)})`}
            strokeWidth={1.5}
          />
          <rect x={sec.x - 14} y={sec.y - 14} width={sec.w + 28} height={sec.h + 28} rx={18}
            fill="none"
            stroke={`rgba(165,135,70,${(0.025 + timeWarmth * 0.010).toFixed(3)})`}
            strokeWidth={1}
          />
        </g>
      ))}

      {/* Lounge boundary — dashed gold rope enclosure, marks a premium zone perimeter */}
      {loungeBounds.map(o => {
        const cx   = o.posX + o.width  / 2;
        const cy   = o.posY + o.height / 2;
        const fillOp  = (0.032 + timeWarmth * 0.014).toFixed(3);
        const ringOp  = (0.052 + timeWarmth * 0.022).toFixed(3);
        const outerOp = (0.026 + timeWarmth * 0.010).toFixed(3);
        return (
          <g key={`arch-lb-${o.id}`} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined}>
            <rect x={o.posX} y={o.posY} width={o.width} height={o.height} rx={16}
              fill={`rgba(255,240,210,${fillOp})`} />
            <rect x={o.posX + 4} y={o.posY + 4} width={o.width - 8} height={o.height - 8} rx={13}
              fill="none" stroke={`rgba(195,162,88,${ringOp})`} strokeWidth={0.8} strokeDasharray="8 5" />
            <rect x={o.posX - 3} y={o.posY - 3} width={o.width + 6} height={o.height + 6} rx={18}
              fill="none" stroke={`rgba(165,135,70,${outerOp})`} strokeWidth={0.5} />
          </g>
        );
      })}

      {/* Curved lounge boundary — elliptical soft zone, gold dashed perimeter */}
      {curvedLoungeBounds.map(o => {
        const cx      = o.posX + o.width  / 2;
        const cy      = o.posY + o.height / 2;
        const rx      = o.width  / 2;
        const ry      = o.height / 2;
        const fillOp  = (0.030 + timeWarmth * 0.014).toFixed(3);
        const ringOp  = (0.052 + timeWarmth * 0.022).toFixed(3);
        const outerOp = (0.024 + timeWarmth * 0.010).toFixed(3);
        return (
          <g key={`arch-clb-${o.id}`} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined}>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
              fill={`rgba(255,240,210,${fillOp})`} />
            <ellipse cx={cx} cy={cy} rx={Math.max(4, rx - 5)} ry={Math.max(4, ry - 5)}
              fill="none"
              stroke={`rgba(195,162,88,${ringOp})`}
              strokeWidth={0.85}
              strokeDasharray="8 5"
            />
            <ellipse cx={cx} cy={cy} rx={rx + 4} ry={ry + 4}
              fill="none"
              stroke={`rgba(165,135,70,${outerOp})`}
              strokeWidth={0.5}
            />
          </g>
        );
      })}

      {/* VIP enclosure — explicit gold ring placed as a floor object */}
      {vipEnclosures.map(o => {
        const cx       = o.posX + o.width  / 2;
        const cy       = o.posY + o.height / 2;
        const ambOp    = (0.048 + timeWarmth * 0.020).toFixed(3);
        const innerOp  = (0.072 + timeWarmth * 0.028).toFixed(3);
        const outerOp  = (0.030 + timeWarmth * 0.012).toFixed(3);
        return (
          <g key={`arch-vipe-${o.id}`} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined}>
            <rect x={o.posX - 14} y={o.posY - 14} width={o.width + 28} height={o.height + 28} rx={22}
              fill={`rgba(8,5,2,${ambOp})`} />
            <rect x={o.posX - 6} y={o.posY - 6} width={o.width + 12} height={o.height + 12} rx={14}
              fill="none" stroke={`rgba(195,162,88,${innerOp})`} strokeWidth={1.5} />
            <rect x={o.posX - 14} y={o.posY - 14} width={o.width + 28} height={o.height + 28} rx={20}
              fill="none" stroke={`rgba(165,135,70,${outerOp})`} strokeWidth={1} />
          </g>
        );
      })}

      {/* Curved booth segment — plan-view premium upholstered curved bench */}
      {curvedBoothSegs.map(o => {
        const x = o.posX, y = o.posY, w = o.width, h = o.height;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const variant = resolveObjectVariant(o);

        // Geometry: generous back-corner radius; flat front corners for clean edge continuity
        const rxB  = Math.min(w, h) * 0.18;
        const rxF  = Math.min(w, h) * 0.06;
        const fDip = h * 0.055;  // front face bows forward — signals open seating face
        const backH = Math.round(h * 0.36);
        const seatH = h - backH;
        const seamY = y + backH;

        // Variant-aware seam control point: ARC_LEFT/ARC_RIGHT shift the peak laterally
        const sCtrlX = variant === 'ARC_LEFT'  ? cx - w * 0.14
                     : variant === 'ARC_RIGHT' ? cx + w * 0.14
                     : cx;
        const sCtrlY = seamY + h * (variant === 'CURVED' ? 0.078 : 0.062);

        // Front-face arc control: matches seam direction for arc-family variants
        const fCtrlX = variant === 'ARC_LEFT'  ? cx - w * 0.10
                     : variant === 'ARC_RIGHT' ? cx + w * 0.10
                     : cx;

        const tuftCount   = Math.max(2, Math.round(w / 36));
        const tuftSpacing = (w - 24) / (tuftCount + 1);
        // Tufting Y-cascade: creates a flowing row for directional arc variants
        const tuftYStep   = variant === 'ARC_LEFT'  ? -1.2
                          : variant === 'ARC_RIGHT' ?  1.2
                          : 0;

        // Outer silhouette: straight back, rounded back corners,
        // flat front corners, convex forward-bowing open face
        const bodyPath = [
          `M ${x + rxB} ${y}`,
          `L ${x + w - rxB} ${y}`,
          `Q ${x + w} ${y} ${x + w} ${y + rxB}`,
          `L ${x + w} ${y + h - rxF}`,
          `Q ${x + w} ${y + h} ${x + w - rxF} ${y + h}`,
          `Q ${fCtrlX} ${y + h + fDip} ${x + rxF} ${y + h}`,
          `Q ${x} ${y + h} ${x} ${y + h - rxF}`,
          `L ${x} ${y + rxB}`,
          `Q ${x} ${y} ${x + rxB} ${y}`,
          'Z',
        ].join(' ');

        // Back panel: shares top contour, straight cut at seamY
        const backPath = [
          `M ${x + rxB} ${y}`,
          `L ${x + w - rxB} ${y}`,
          `Q ${x + w} ${y} ${x + w} ${y + rxB}`,
          `L ${x + w} ${y + backH}`,
          `L ${x} ${y + backH}`,
          `L ${x} ${y + rxB}`,
          `Q ${x} ${y} ${x + rxB} ${y}`,
          'Z',
        ].join(' ');

        const shadowOp  = (0.18 + timeWarmth * 0.04).toFixed(3);
        const backOp    = (0.85 + timeWarmth * 0.08).toFixed(3);
        const bodyOp    = (0.72 + timeWarmth * 0.10).toFixed(3);
        const cushionOp = (0.52 + timeWarmth * 0.08).toFixed(3);
        const seamOp    = (0.38 + timeWarmth * 0.08).toFixed(3);
        const tuftOp    = (0.28 + timeWarmth * 0.06).toFixed(3);
        const shineOp   = (0.055 + timeWarmth * 0.018).toFixed(3);

        return (
          <g key={`arch-cbs-${o.id}`} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined}>
            {/* Drop shadow */}
            <path d={bodyPath} fill={`rgba(3,2,1,${shadowOp})`} transform="translate(2,2)" />
            {/* Seat surface — full booth body */}
            <path d={bodyPath} fill={`rgba(104,70,40,${bodyOp})`} />
            {/* Cushion band */}
            <rect x={x + 4} y={y + backH} width={w - 8} height={seatH - 4} rx={rxF * 2}
              fill={`rgba(138,96,58,${cushionOp})`} />
            {/* Back panel */}
            <path d={backPath} fill={`rgba(68,44,24,${backOp})`} />
            {/* Variant-aware curved seam */}
            <path
              d={`M ${x + 8} ${seamY} Q ${sCtrlX} ${sCtrlY} ${x + w - 8} ${seamY}`}
              fill="none"
              stroke={`rgba(44,28,14,${seamOp})`}
              strokeWidth={0.85}
            />
            {/* Tufting with directional cascade */}
            {Array.from({ length: tuftCount }, (_, i) => (
              <ellipse key={i}
                cx={x + 12 + tuftSpacing * (i + 1)}
                cy={y + backH + seatH * 0.44 + tuftYStep * (i - (tuftCount - 1) / 2)}
                rx={1.5} ry={1.2}
                fill={`rgba(50,32,16,${tuftOp})`}
              />
            ))}
            {/* Top-edge highlight */}
            <line
              x1={x + rxB} y1={y + 1}
              x2={x + w - rxB} y2={y + 1}
              stroke={`rgba(215,175,128,${shineOp})`}
              strokeWidth={0.6}
            />
          </g>
        );
      })}

      {/* Service lanes — floor-level directional walkways with chevron flow markers */}
      {lanes.map(o => {
        const cx         = o.posX + o.width  / 2;
        const cy         = o.posY + o.height / 2;
        const laneOp     = (0.08 + brightness * 0.04).toFixed(3);
        const chevronOp  = (0.10 + brightness * 0.04).toFixed(3);
        const isVertical = o.height > o.width;
        const span       = isVertical ? o.height : o.width;
        const nChevrons  = Math.max(1, Math.floor(span / 40));
        return (
          <g key={`arch-lane-${o.id}`} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined}>
            <rect x={o.posX} y={o.posY} width={o.width} height={o.height} rx={2}
              fill={`rgba(120,120,140,${laneOp})`}
              stroke={`rgba(140,140,160,${(parseFloat(laneOp) * 0.80).toFixed(3)})`}
              strokeWidth={0.5} strokeDasharray="4 4"
            />
            {Array.from({ length: nChevrons }, (_, i) => {
              const t = nChevrons > 1 ? i / (nChevrons - 1) : 0.5;
              if (isVertical) {
                const y = o.posY + 12 + (o.height - 24) * t;
                return (
                  <path key={i} d={`M ${cx - 6} ${y - 3} L ${cx} ${y + 3} L ${cx + 6} ${y - 3}`}
                    fill="none" stroke={`rgba(160,160,180,${chevronOp})`} strokeWidth={0.8}
                  />
                );
              }
              const x = o.posX + 12 + (o.width - 24) * t;
              return (
                <path key={i} d={`M ${x - 3} ${cy - 6} L ${x + 3} ${cy} L ${x - 3} ${cy + 6}`}
                  fill="none" stroke={`rgba(160,160,180,${chevronOp})`} strokeWidth={0.8}
                />
              );
            })}
          </g>
        );
      })}

      {/* Planters — variant-aware foliage rendering (POT / ROW / PRIVACY) */}
      {planters.map(o => {
        const cx      = o.posX + o.width  / 2;
        const cy      = o.posY + o.height / 2;
        const rx      = o.width  / 2;
        const ry      = o.height / 2;
        const leafOp  = 0.36 + timeWarmth * 0.06;
        const variant = inferObjVariant(o);
        const gXform  = o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined;

        if (variant === 'ROW') {
          // Long planter trough — evenly spaced plant clusters
          const n  = Math.min(8, Math.max(2, Math.floor(o.width / 30)));
          const sp = o.width / (n + 1);
          return (
            <g key={`arch-pltr-${o.id}`} transform={gXform}>
              <rect x={o.posX} y={o.posY + o.height * 0.46} width={o.width} height={o.height * 0.50}
                rx={3} fill="rgba(50,34,20,0.56)" stroke="rgba(70,50,30,0.26)" strokeWidth={0.5} />
              {/* Trough rim highlight — warm amber line where overhead light grazes the container edge */}
              <line
                x1={o.posX + 3}           y1={o.posY + o.height * 0.46}
                x2={o.posX + o.width - 3} y2={o.posY + o.height * 0.46}
                stroke={`rgba(245,198,138,${(leafOp * 0.16).toFixed(3)})`}
                strokeWidth={0.65}
              />
              {Array.from({ length: n }, (_, i) => {
                const px = o.posX + sp * (i + 1);
                const pr = o.height * (0.35 + chairJitter(o.id, i, 0) * 0.12);
                return (
                  <g key={i}>
                    <ellipse cx={px} cy={o.posY + o.height * 0.28} rx={pr} ry={pr * 0.88}
                      fill={`rgba(20,52,18,${(leafOp * (0.88 + chairJitter(o.id, i, 1) * 0.12)).toFixed(2)})`} />
                    <ellipse cx={px - pr * 0.26} cy={o.posY + o.height * 0.18} rx={pr * 0.54} ry={pr * 0.48}
                      fill={`rgba(30,68,24,${(leafOp * 0.62).toFixed(2)})`} />
                  </g>
                );
              })}
            </g>
          );
        }

        if (variant === 'PRIVACY') {
          // Dense privacy planting — hedge / living wall
          return (
            <g key={`arch-pltr-${o.id}`} transform={gXform}>
              <rect x={o.posX} y={o.posY + o.height * 0.70} width={o.width} height={o.height * 0.28}
                rx={2} fill="rgba(26,18,10,0.60)" stroke="rgba(46,32,18,0.22)" strokeWidth={0.5} />
              <ellipse cx={cx}              cy={o.posY + ry * 0.80} rx={rx * 0.96} ry={ry * 0.78}
                fill={`rgba(16,44,14,${leafOp.toFixed(2)})`} />
              <ellipse cx={cx - rx * 0.30} cy={o.posY + ry * 0.62} rx={rx * 0.68} ry={ry * 0.58}
                fill={`rgba(22,58,18,${(leafOp * 0.82).toFixed(2)})`} />
              <ellipse cx={cx + rx * 0.28} cy={o.posY + ry * 0.58} rx={rx * 0.60} ry={ry * 0.52}
                fill={`rgba(18,52,14,${(leafOp * 0.76).toFixed(2)})`} />
              <ellipse cx={cx}              cy={o.posY + ry * 0.42} rx={rx * 0.72} ry={ry * 0.44}
                fill={`rgba(28,68,22,${(leafOp * 0.68).toFixed(2)})`} />
              {/* Foliage light catch — overhead light reflecting off canopy crown */}
              <ellipse cx={cx} cy={o.posY + ry * 0.26} rx={rx * 0.52} ry={ry * 0.13}
                fill={`rgba(58,122,44,${(leafOp * 0.22).toFixed(3)})`} />
              <ellipse cx={cx}              cy={o.posY + ry * 0.96} rx={rx * 0.86} ry={ry * 0.18}
                fill="rgba(0,12,0,0.30)" />
            </g>
          );
        }

        // POT — single container planter
        return (
          <g key={`arch-pltr-${o.id}`} transform={gXform}>
            <rect x={o.posX + 4} y={o.posY + o.height * 0.55} width={o.width - 8} height={o.height * 0.42}
              rx={3} fill="rgba(58,40,28,0.54)" stroke="rgba(78,58,38,0.30)" strokeWidth={0.5} />
            {/* Pot rim highlight — warm terracotta line at container lip */}
            <line
              x1={o.posX + 6}           y1={o.posY + o.height * 0.55}
              x2={o.posX + o.width - 6} y2={o.posY + o.height * 0.55}
              stroke={`rgba(208,162,112,${(leafOp * 0.17).toFixed(3)})`}
              strokeWidth={0.65}
            />
            <ellipse cx={cx} cy={o.posY + ry * 0.80} rx={rx * 0.88} ry={ry * 0.68}
              fill={`rgba(18,48,20,${leafOp.toFixed(2)})`} />
            {/* Foliage light catch — overhead light catch on top-most leaf mass */}
            <ellipse cx={cx} cy={o.posY + ry * 0.58} rx={rx * 0.48} ry={ry * 0.12}
              fill={`rgba(50,112,40,${(leafOp * 0.20).toFixed(3)})`} />
            <ellipse cx={cx - rx * 0.22} cy={o.posY + ry * 0.64} rx={rx * 0.52} ry={ry * 0.44}
              fill={`rgba(28,68,26,${(leafOp * 0.70).toFixed(2)})`} />
            <ellipse cx={cx + rx * 0.14} cy={o.posY + ry * 0.92} rx={rx * 0.60} ry={ry * 0.32}
              fill="rgba(8,22,8,0.28)" />
          </g>
        );
      })}

      {/* Booth backing — banquette structural wall behind each booth */}
      {booths.map(t => (
        <g key={`arch-booth-${t.id}`}>
          <rect
            x={t.posX - 5} y={t.posY - 20}
            width={t.width + 10} height={18}
            rx={3}
            fill={`rgba(16,10,5,${(0.60 + timeWarmth * 0.08).toFixed(2)})`}
            stroke={`rgba(88,60,36,${(0.26 + timeWarmth * 0.07).toFixed(2)})`}
            strokeWidth={1}
          />
          <line
            x1={t.posX - 3} y1={t.posY - 20}
            x2={t.posX + t.width + 3} y2={t.posY - 20}
            stroke={`rgba(255,195,115,${(0.044 + timeWarmth * 0.020).toFixed(3)})`}
            strokeWidth={1}
          />
        </g>
      ))}

      {/* Bar counter ring — brass architectural presence around bar objects */}
      {bars.map(o => {
        const cx = o.posX + o.width  / 2;
        const cy = o.posY + o.height / 2;
        const rx = o.width  / 2 + 28;
        const ry = o.height / 2 + 28;
        return (
          <g key={`arch-bar-${o.id}`}>
            <ellipse cx={cx} cy={cy} rx={rx * 1.55} ry={ry * 1.35} fill="url(#arch-stone)" />
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
              fill="none"
              stroke={`rgba(200,162,78,${(0.042 + timeWarmth * 0.018).toFixed(3)})`}
              strokeWidth={1.5}
            />
            <ellipse cx={cx} cy={cy} rx={rx * 1.28} ry={ry * 1.28}
              fill="none"
              stroke={`rgba(175,140,62,${(0.020 + timeWarmth * 0.010).toFixed(3)})`}
              strokeWidth={0.8}
            />
          </g>
        );
      })}

      {/* Terrace vegetation — abstract planter strip as spatial boundary softener */}
      {sectionBoxes.filter(s => s.personality === 'terrace').map(sec => (
        <g key={`arch-veg-${sec.id}`}>
          <rect x={sec.x + 10} y={sec.y - 9} width={sec.w - 20} height={13} rx={4}
            fill="rgba(20,42,16,0.42)" stroke="rgba(36,60,28,0.20)" strokeWidth={0.5}
          />
          <ellipse cx={sec.x + sec.w / 2} cy={sec.y - 16} rx={sec.w * 0.42} ry={9}
            fill="rgba(18,48,16,0.28)"
          />
        </g>
      ))}

      {/* Perimeter walls — room architectural edges, deepening at night */}
      <rect x={0} y={0} width={CANVAS_W} height={52} fill="url(#arch-wall-t)" />
      <rect x={0} y={CANVAS_H - 40} width={CANVAS_W} height={40} fill="url(#arch-wall-b)" />
      <rect x={0} y={0} width={44} height={CANVAS_H} fill="url(#arch-wall-l)" />
      <rect x={CANVAS_W - 44} y={0} width={44} height={CANVAS_H} fill="url(#arch-wall-r)" />
      {/* Top wall ledge catch — warm overhead light on the back wall surface */}
      <rect x={0} y={50} width={CANVAS_W} height={4}
        fill={`rgba(255,195,110,${(0.032 + timeWarmth * 0.014).toFixed(3)})`}
      />
    </svg>
  );
}

// ── Spatial energy field ──────────────────────────────────────────────────────
// SVG layer: occupied glows, overdue tinge, incoming warmth, bar anchor, section ambients.
// All radials use userSpaceOnUse so coordinates match the canvas pixel grid exactly.

function SpatialEnergyField({ tables, pressureScore, timeWarmth, serviceEnergy }: {
  tables: FloorTable[];
  pressureScore: number;
  timeWarmth: number;
  serviceEnergy: number;
}) {
  const occupied = tables.filter(t => t.liveStatus === 'OCCUPIED' && !(t.currentReservation?.isOverdue));
  const overdue  = tables.filter(t => t.liveStatus === 'OCCUPIED' &&   t.currentReservation?.isOverdue);

  // Arrival wave — split RESERVED_SOON into imminent (≤20 min) vs upcoming.
  // Imminent tables create stronger anticipatory pull; upcoming are calm forward energy.
  const allIncoming = tables.filter(t => t.liveStatus === 'RESERVED_SOON');
  const imminent    = allIncoming.filter(t => {
    const mu = (t.upcomingReservations[0] as { minutesUntil?: number } | undefined)?.minutesUntil;
    return typeof mu === 'number' && mu > 0 && mu <= 20;
  });
  const upcoming    = allIncoming.filter(t => {
    const mu = (t.upcomingReservations[0] as { minutesUntil?: number } | undefined)?.minutesUntil;
    return typeof mu !== 'number' || mu > 20;
  });

  // Turnover readying — occupied tables approaching end of booking.
  // A different color (warm gold) from overdue (red): this is momentum, not alarm.
  const readying = tables.filter(t => {
    if (t.liveStatus !== 'OCCUPIED' || !t.currentReservation || t.currentReservation.isOverdue) return false;
    const mr = minutesUntilEnd(t.currentReservation.expectedEndTime, Date.now());
    return mr > 0 && mr <= 20;
  });

  // Section zone ambients — each section with ≥2 tables emits a faint tinted centroid radial.
  const sectionZones = (() => {
    const map = new Map<string, { color: string; name: string; sumX: number; sumY: number; count: number; minX: number; minY: number; maxX: number; maxY: number }>();
    for (const t of tables) {
      if (!t.section) continue;
      const cx = t.posX + t.width  / 2;
      const cy = t.posY + t.height / 2;
      const key = t.section.id;
      if (!map.has(key)) {
        map.set(key, { color: t.section.color, name: t.section.name, sumX: cx, sumY: cy, count: 1,
          minX: t.posX, minY: t.posY, maxX: t.posX + t.width, maxY: t.posY + t.height });
      } else {
        const z = map.get(key)!;
        z.sumX += cx; z.sumY += cy; z.count++;
        z.minX = Math.min(z.minX, t.posX);
        z.minY = Math.min(z.minY, t.posY);
        z.maxX = Math.max(z.maxX, t.posX + t.width);
        z.maxY = Math.max(z.maxY, t.posY + t.height);
      }
    }
    return Array.from(map.values())
      .filter(z => z.count >= 2)
      .map((z, i) => {
        const n = z.name.toLowerCase();
        const personality =
          /vip|private|salon|exclusive|presidential/.test(n) ? 'vip' as const :
          /terrace|garden|outdoor|patio|rooftop|pergola/.test(n) ? 'terrace' as const :
          /lounge|cocktail|aperitif/.test(n) ? 'lounge' as const : 'main' as const;
        return {
          id: i, color: z.color, personality,
          cx: z.sumX / z.count, cy: z.sumY / z.count,
          r: Math.max(130, Math.max(z.maxX - z.minX, z.maxY - z.minY) * 0.60),
        };
      });
  })();

  if (tables.length === 0) return null;

  const occOuter    = 0.058 + pressureScore * 0.018 + timeWarmth * 0.008;
  const occInner    = 0.042 + pressureScore * 0.012 + timeWarmth * 0.006;
  const ovdStrength = 0.028 + pressureScore * 0.018;
  const readyGlow   = 0.020 + pressureScore * 0.010;
  const secOpacity  = 0.030 + pressureScore * 0.010 + serviceEnergy * 0.005;
  const immGlow     = 0.028 + pressureScore * 0.010;

  return (
    <svg
      width={CANVAS_W} height={CANVAS_H}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 0 }}
    >
      <defs>
        {/* Shared blur filter for floor-plane shadow ellipses */}
        <filter id="sf-shadow-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        {sectionZones.map(z => (
          <radialGradient key={`sf-sec-${z.id}`} id={`sf-sec-${z.id}`} cx={z.cx} cy={z.cy} r={z.r} gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor={z.color} stopOpacity={secOpacity} />
            <stop offset="55%"  stopColor={z.color} stopOpacity={secOpacity * 0.28} />
            <stop offset="100%" stopColor={z.color} stopOpacity={0} />
          </radialGradient>
        ))}
        {occupied.map(t => {
          const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
          const ps = t.currentReservation?.partySize ?? 4;
          const outerR = Math.round(158 + ps * 5); // 2p: 168, 6p: 188, 10p: 208
          return (
            <radialGradient key={`sf-ao-${t.id}`} id={`sf-ao-${t.id}`} cx={cx} cy={cy} r={outerR} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#86efac" stopOpacity={occOuter} />
              <stop offset="100%" stopColor="#86efac" stopOpacity={0} />
            </radialGradient>
          );
        })}
        {occupied.map(t => {
          const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
          const ps = t.currentReservation?.partySize ?? 4;
          const innerR = Math.round(56 + ps * 2); // 2p: 60, 6p: 68, 10p: 76
          return (
            <radialGradient key={`sf-ai-${t.id}`} id={`sf-ai-${t.id}`} cx={cx} cy={cy} r={innerR} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#86efac" stopOpacity={occInner} />
              <stop offset="100%" stopColor="#86efac" stopOpacity={0} />
            </radialGradient>
          );
        })}
        {overdue.map(t => {
          const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
          return (
            <radialGradient key={`sf-t-${t.id}`} id={`sf-t-${t.id}`} cx={cx} cy={cy} r={160} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#ef4444" stopOpacity={ovdStrength} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </radialGradient>
          );
        })}
        {/* Readying — tables ending soon: warm gold, transitional energy, not alarm */}
        {readying.map(t => {
          const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
          return (
            <radialGradient key={`sf-r-${t.id}`} id={`sf-r-${t.id}`} cx={cx} cy={cy} r={100} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#fbbf24" stopOpacity={readyGlow} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
            </radialGradient>
          );
        })}
        {/* Imminent — RESERVED_SOON arriving ≤20 min: stronger pull, warmer color */}
        {imminent.map(t => {
          const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
          return (
            <radialGradient key={`sf-im-${t.id}`} id={`sf-im-${t.id}`} cx={cx} cy={cy} r={150} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#fb923c" stopOpacity={immGlow} />
              <stop offset="60%"  stopColor="#fbbf24" stopOpacity={immGlow * 0.35} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
            </radialGradient>
          );
        })}
        {/* Upcoming — RESERVED_SOON more than 20 min away: calm forward energy */}
        {upcoming.map(t => {
          const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
          return (
            <radialGradient key={`sf-i-${t.id}`} id={`sf-i-${t.id}`} cx={cx} cy={cy} r={110} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#fbbf24" stopOpacity={0.018} />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
            </radialGradient>
          );
        })}
      </defs>
      {/* Floor plane shadows — every table sits on a physical surface. Occupied heaviest. */}
      {tables.map(t => {
        const cx  = t.posX + t.width  / 2;
        const cy  = t.posY + t.height * 0.80;
        const rx  = t.width  * 0.74;
        const ry  = t.height * 0.36;
        const op  = t.liveStatus === 'OCCUPIED'      ? 0.066
                  : t.liveStatus === 'RESERVED_SOON' ? 0.046
                  : t.liveStatus === 'RESERVED'       ? 0.032 : 0.010;
        return <ellipse key={`sf-shd-${t.id}`} cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" fillOpacity={op} filter="url(#sf-shadow-blur)" />;
      })}
      {sectionZones.map(z => (
        <circle key={`sf-sec-${z.id}`} cx={z.cx} cy={z.cy} r={z.r} fill={`url(#sf-sec-${z.id})`} />
      ))}
      {occupied.map(t => {
        const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
        const ps = t.currentReservation?.partySize ?? 4;
        return <circle key={`sf-ao-${t.id}`} cx={cx} cy={cy} r={Math.round(158 + ps * 5)} fill={`url(#sf-ao-${t.id})`} />;
      })}
      {occupied.map(t => {
        const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
        const ps = t.currentReservation?.partySize ?? 4;
        return <circle key={`sf-ai-${t.id}`} cx={cx} cy={cy} r={Math.round(56 + ps * 2)} fill={`url(#sf-ai-${t.id})`} />;
      })}
      {overdue.map(t => {
        const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
        return <circle key={`sf-t-${t.id}`}  cx={cx} cy={cy} r={160} fill={`url(#sf-t-${t.id})`}  />;
      })}
      {readying.map(t => {
        const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
        return <circle key={`sf-r-${t.id}`}  cx={cx} cy={cy} r={100} fill={`url(#sf-r-${t.id})`}  />;
      })}
      {imminent.map(t => {
        const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
        return <circle key={`sf-im-${t.id}`} cx={cx} cy={cy} r={150} fill={`url(#sf-im-${t.id})`} />;
      })}
      {upcoming.map(t => {
        const cx = t.posX + t.width / 2; const cy = t.posY + t.height / 2;
        return <circle key={`sf-i-${t.id}`}  cx={cx} cy={cy} r={110} fill={`url(#sf-i-${t.id})`}  />;
      })}
    </svg>
  );
}

// Deterministic per-chair pseudorandom — stable across renders, seeded by
// table ID + chair index + slot so each chair has a consistent personality.
function chairJitter(tableId: string, idx: number, slot: number): number {
  let h = 5381 + slot * 53 + idx * 29;
  for (let i = 0; i < tableId.length; i++) h = ((h << 5) + h) ^ tableId.charCodeAt(i);
  h ^= h >>> 16; h = ((h * 0x45d9f3b) >>> 0); h ^= h >>> 16;
  return (h & 0xffff) / 65535;
}

// ── Chair layer ───────────────────────────────────────────────────────────────
// Semantic chair silhouettes rendered as SVG around each table perimeter.
// Lives below table buttons in DOM order so chairs peek around table edges
// without interfering with hit targets or the button's overflow:hidden.
// Detail tier (useDots vs full capsule) proxies for zoom via table pixel area.
function ChairLayer({ tables, floorObjs, dimmedTableIds, pickMode, timeWarmth }: {
  tables: FloorTable[];
  floorObjs: FloorObjectData[];
  dimmedTableIds: Set<string>;
  pickMode: boolean;
  timeWarmth: number;
}) {
  // At dinner service, unoccupied chair settings recede — social energy
  // concentrates at active tables, empty settings become part of the shadow.
  const quietLevel = 1 - timeWarmth * 0.22;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      width={CANVAS_W}
      height={CANVAS_H}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
    >
      {tables.map(table => {
        if (table.liveStatus === 'BLOCKED') return null;
        const minDim = Math.min(table.width, table.height);
        if (minDim < 38) return null;

        const area     = table.width * table.height;
        const useDots  = minDim < 52;
        const family   = inferTableFamily(table);
        // Bar-seating tables use circular stools (no chair back); lounge tables
        // get a slightly wider gap for a relaxed feel.
        const isBarSeating = family === 'BAR_SEATING';
        const isLounge     = family === 'LOUNGE';
        const cW  = useDots ? 4  : isBarSeating ? 7 : area > 7000 ? 13 : 11;
        const cH  = useDots ? 4  : isBarSeating ? 7 : area > 7000 ? 10 :  8;
        const gap  = isLounge ? 4.5 : 3.5;
        // Lounge chairs get fully oval rx for a softer, relaxed silhouette.
        const cRx  = useDots ? cW / 2 : isBarSeating ? cW / 2 : isLounge ? cW / 2 : 2.5;

        const isRound    = table.shape === 'ROUND' || table.shape === 'OVAL';
        const isBooth    = table.shape === 'BOOTH';
        const isOccupied = table.liveStatus === 'OCCUPIED';
        const cx = table.posX + table.width  / 2;
        const cy = table.posY + table.height / 2;

        const seatCount =
          isOccupied
            ? (table.currentReservation?.partySize ?? table.minCovers)
          : (table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON')
            ? (table.upcomingReservations[0]?.partySize ?? table.minCovers)
          : table.minCovers;
        const displayCount = Math.max(2, Math.min(seatCount, table.maxCovers, 12));
        const isActive     = isOccupied || table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON';
        const filledCount  = isActive ? displayCount : 0;

        const filledFill =
          isOccupied                              ? 'rgba(22,163,74,0.75)'   // solid green
          : table.liveStatus === 'RESERVED_SOON' ? 'rgba(217,119,6,0.72)'   // solid amber
          : 'rgba(37,99,235,0.68)';                                           // solid blue
        const filledStroke =
          isOccupied                              ? 'rgba(22,163,74,0.40)'
          : table.liveStatus === 'RESERVED_SOON' ? 'rgba(217,119,6,0.35)'
          : 'rgba(37,99,235,0.32)';
        const emptyFill   = `rgba(180,174,168,${(0.55 * quietLevel).toFixed(2)})`;
        const emptyStroke = `rgba(160,155,150,${(0.30 * quietLevel).toFixed(2)})`;

        // Chair anatomy: a narrow backrest strip at the outer edge (away from table) +
        // seat pad body. Backrest is more opaque — it's the solid structural element.
        // Bar-seating and dots use the seat pad only (no backrest differentiation).
        const filledBack = isOccupied
          ? 'rgba(21,128,61,0.85)' : table.liveStatus === 'RESERVED_SOON'
          ? 'rgba(180,83,9,0.82)'  : 'rgba(29,78,216,0.78)';
        const emptyBack  = `rgba(155,149,144,${(0.65 * quietLevel).toFixed(2)})`;
        const backH      = useDots || isBarSeating ? 0 : Math.round(cH * 0.35);
        const seatH      = cH - backH;
        // Seat rx: slightly less rounded than the backrest for a seat-pad feel.
        const seatRx     = useDots ? cW / 2 : isBarSeating ? cW / 2 : isLounge ? cW / 2 : Math.max(1, cRx - 1);

        // Occupied chairs carry lived-in irregularity — diners pull chairs in/out,
        // lean sideways. Reserved chairs are pristine, set by service for arrival.
        const jitterPx  = isOccupied && !useDots ? 1 : 0;

        type Chair = { x: number; y: number; w: number; h: number; rotDeg: number; filled: boolean };
        const chairs: Chair[] = [];
        let seated = 0, ci = 0;
        const mkChair = (x: number, y: number, w: number, h: number, rotDeg: number): Chair => {
          const i = ci++;
          return {
            x:      x + (chairJitter(table.id, i, 0) - 0.5) * jitterPx * 2.8,
            y:      y + (chairJitter(table.id, i, 1) - 0.5) * jitterPx * 2.8,
            w, h,
            rotDeg: rotDeg + (chairJitter(table.id, i, 2) - 0.5) * jitterPx * 7.5,
            filled: seated++ < filledCount,
          };
        };

        if (isRound) {
          const r    = (table.width + table.height) / 4;
          const dist = r + gap + cH / 2;
          for (let i = 0; i < displayCount; i++) {
            const ang = (i / displayCount) * Math.PI * 2 - Math.PI / 2;
            chairs.push(mkChair(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, cW, cH,
              (ang + Math.PI / 2) * 180 / Math.PI));
          }
        } else if (isBooth) {
          const n  = Math.min(displayCount, Math.max(1, Math.floor((table.width - 8) / (cW + 5))));
          const sp = table.width / (n + 1);
          for (let i = 0; i < n; i++) chairs.push(mkChair(table.posX + sp * (i + 1), table.posY - gap - cH / 2, cW, cH, 0));
        } else {
          const maxFitH  = Math.max(1, Math.floor((table.width  - 8) / (cW + 4)));
          const maxFitV  = Math.max(1, Math.floor((table.height - 8) / (cW + 4)));
          const perTop   = Math.min(Math.ceil(displayCount  / 2),  maxFitH);
          const perBot   = Math.min(Math.floor(displayCount / 2),  maxFitH);
          const sideN    = displayCount - perTop - perBot;
          const perLeft  = Math.min(Math.ceil(sideN  / 2),  maxFitV);
          const perRight = Math.min(Math.floor(sideN / 2),  maxFitV);

          // Rotations chosen so local y=-cH/2 always points AWAY from the table —
          // this is where the backrest strip renders, ensuring backrests face outward.
          for (let i = 0; i < perTop;   i++) chairs.push(mkChair(table.posX + (table.width  / (perTop   + 1)) * (i + 1), table.posY - gap - cH / 2,                             cW, cH,   0));
          for (let i = 0; i < perBot;   i++) chairs.push(mkChair(table.posX + (table.width  / (perBot   + 1)) * (i + 1), table.posY + table.height + gap + cH / 2,               cW, cH, 180));
          for (let i = 0; i < perLeft;  i++) chairs.push(mkChair(table.posX - gap - cH / 2,                              table.posY + (table.height / (perLeft  + 1)) * (i + 1), cW, cH, 270));
          for (let i = 0; i < perRight; i++) chairs.push(mkChair(table.posX + table.width + gap + cH / 2,                table.posY + (table.height / (perRight + 1)) * (i + 1), cW, cH,  90));
        }

        const tableOpacity = dimmedTableIds.has(table.id) ? 0.10 : pickMode ? 0.22 : 1;

        return (
          <g key={`chairs-${table.id}`} opacity={tableOpacity}>
            {chairs.map((c, idx) => {
              const bFill = c.filled ? filledBack   : emptyBack;
              const sFill = c.filled ? filledFill   : emptyFill;
              const sStk  = c.filled ? filledStroke : emptyStroke;
              return (
                <g key={idx} transform={`translate(${c.x},${c.y}) rotate(${c.rotDeg})`}>
                  {/* Backrest — outer edge strip, always faces away from the table */}
                  {backH > 0 && (
                    <rect
                      x={-c.w / 2 + 0.5}
                      y={-c.h / 2}
                      width={c.w - 1}
                      height={backH}
                      rx={cRx}
                      fill={bFill}
                    />
                  )}
                  {/* Seat pad — inner portion, faces towards the table */}
                  <rect
                    x={-c.w / 2}
                    y={-c.h / 2 + backH}
                    width={c.w}
                    height={seatH}
                    rx={seatRx}
                    fill={sFill}
                    stroke={sStk}
                    strokeWidth={0.75}
                  />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Bar stools — circular seat silhouettes along the customer-facing edge of BAR objects.
          Wide bar → bottom edge; portrait bar → right edge; island bar → all four edges.
          Hidden in pick mode to reduce visual noise during table selection. */}
      {!pickMode && floorObjs.filter(o => o.kind === 'BAR').map(o => {
        const sR       = 5;
        const sGap     = 4;
        const ratio    = o.width / Math.max(o.height, 1);
        const isIsland = ratio < 1.4 && Math.min(o.width, o.height) > 70;
        const sOpNum   = 0.30 * quietLevel;
        const sFill    = `rgba(88,72,52,${sOpNum.toFixed(2)})`;
        const sStroke  = `rgba(108,88,64,${(sOpNum * 0.68).toFixed(2)})`;
        const stools: { cx: number; cy: number }[] = [];

        if (isIsland) {
          const nW = Math.min(12, Math.max(1, Math.floor((o.width  - 16) / (sR * 2 + sGap))));
          const nH = Math.min(8,  Math.max(1, Math.floor((o.height - 16) / (sR * 2 + sGap))));
          const spW = o.width  / (nW + 1);
          const spH = o.height / (nH + 1);
          for (let i = 0; i < nW; i++) {
            stools.push({ cx: o.posX + spW * (i + 1), cy: o.posY - sGap - sR });
            stools.push({ cx: o.posX + spW * (i + 1), cy: o.posY + o.height + sGap + sR });
          }
          for (let i = 0; i < nH; i++) {
            stools.push({ cx: o.posX - sGap - sR,             cy: o.posY + spH * (i + 1) });
            stools.push({ cx: o.posX + o.width + sGap + sR,   cy: o.posY + spH * (i + 1) });
          }
        } else if (ratio >= 1.4) {
          const n  = Math.min(14, Math.max(1, Math.floor((o.width  - 16) / (sR * 2 + sGap))));
          const sp = o.width / (n + 1);
          for (let i = 0; i < n; i++)
            stools.push({ cx: o.posX + sp * (i + 1), cy: o.posY + o.height + sGap + sR });
        } else {
          const n  = Math.min(10, Math.max(1, Math.floor((o.height - 16) / (sR * 2 + sGap))));
          const sp = o.height / (n + 1);
          for (let i = 0; i < n; i++)
            stools.push({ cx: o.posX + o.width + sGap + sR, cy: o.posY + sp * (i + 1) });
        }

        return (
          <g key={`bar-stools-${o.id}`}>
            {stools.map((s, i) => (
              <g key={i}>
                {/* Seat ring — slightly larger than original for visual presence */}
                <circle cx={s.cx} cy={s.cy} r={sR + 1}
                  fill={sFill} stroke={sStroke} strokeWidth={0.75} />
                {/* Center post — stool pedestal detail */}
                <circle cx={s.cx} cy={s.cy} r={2}
                  fill={sStroke} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Canvas table card ─────────────────────────────────────────────────────────

function MapTable({ table, selected, combinedSelected, dimmed, bestSuggestion, softHold, onClick, onContextMenu, insight, onInsightAction, waitlistMatch, onWaitlistAction, nowTime: _nowTime, operationalNow: _operationalNow, extraTurns = 0, turns = [], turnTooltip, pickMode = false, pickSelected = false, pickStatus = null, waitlistAssignTarget = false, wlPickWarn = false, quietFade = 0, date, hoveredResId }: {
  table: FloorTable;
  selected: boolean;
  combinedSelected: boolean;
  dimmed: boolean;
  bestSuggestion?: boolean;
  softHold?: WaitlistEntry;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  insight?: FloorInsight;
  onInsightAction?: () => void;
  waitlistMatch?: WaitlistEntry;
  onWaitlistAction?: () => void;
  nowTime?: string;
  operationalNow?: number;
  extraTurns?: number;
  turns?: Reservation[];
  turnTooltip?: string;
  pickMode?: boolean;
  pickSelected?: boolean;
  pickStatus?: PickStatus;
  waitlistAssignTarget?: boolean;
  wlPickWarn?: boolean;
  quietFade?: number;
  date?: string;
  hoveredResId?: string | null;
}) {
  const T = useT();
  const isToday = date === undefined || date === new Date().toISOString().slice(0, 10);
  const nextRes = table.upcomingReservations[0] as (typeof table.upcomingReservations[0] & { minutesUntil: number }) | undefined;

  const sectionColor = table.section?.color ?? '#3f3f46';

  // Table class — inferred from name/section keywords, shape, and area.
  // Used purely for material differentiation; never shown as a label or indicator.
  const _clsStr = (table.name + ' ' + (table.section?.name ?? '')).toLowerCase();
  const cls =
    /\bvip\b|presidential|exclusive/.test(_clsStr) ? 'vip' :
    /\bchef\b|kitchen pass/.test(_clsStr) ? 'chef' :
    table.shape === 'BOOTH' ? 'booth' :
    /lounge|cocktail/.test(_clsStr) || (table.shape === 'ROUND' && table.maxCovers <= 2) ? 'lounge' :
    /\bbar\b|counter|pass|high.top|hightop/.test(_clsStr) ? 'bar' :
    table.maxCovers >= 8 && table.shape !== 'ROUND' && table.shape !== 'OVAL' ? 'communal' :
    table.width * table.height > 9000 ? 'large' : 'standard';

  // Family-aware corner radius — each family's physical character expressed through edge geometry.
  const familyRadius = cls === 'lounge' && table.shape !== 'ROUND' && table.shape !== 'OVAL' ? '18px'
    : cls === 'communal' ? '5px'
    : cls === 'bar' ? '5px'
    : tableRadius(table.shape);

  // Base (non-pick) colors
  const isOverdue = table.liveStatus === 'OCCUPIED' && (table.currentReservation?.isOverdue ?? false);
  const minutesRemaining = (table.liveStatus === 'OCCUPIED' && table.currentReservation)
    ? minutesUntilEnd(table.currentReservation.expectedEndTime, Date.now()) : null;
  const isEndingSoon = isToday && minutesRemaining !== null && minutesRemaining > 5 && minutesRemaining <= 20;

  let bg = softHold && table.liveStatus === 'AVAILABLE' ? 'rgba(238,236,253,0.96)'   // soft lavender — held
    : isOverdue ? 'rgba(250,232,232,0.96)'                                            // soft red-tinted — overdue
    : (STATUS_BG[table.liveStatus] ?? STATUS_BG['AVAILABLE']);
  if (cls === 'vip' && table.liveStatus === 'AVAILABLE' && !softHold && !isOverdue) {
    bg = 'rgba(250,249,240,0.96)';     // soft barely-ivory — VIP prestige
  }
  if (cls === 'communal' && table.liveStatus === 'AVAILABLE' && !softHold && !isOverdue) {
    bg = 'rgba(242,246,252,0.96)';     // soft barely-cool — communal social
  }
  if (cls === 'lounge' && table.liveStatus === 'AVAILABLE' && !softHold && !isOverdue) {
    bg = 'rgba(251,248,240,0.96)';     // soft barely-warm-cream — lounge relaxed
  }
  if (cls === 'bar' && table.liveStatus === 'AVAILABLE' && !softHold && !isOverdue) {
    bg = 'rgba(247,247,247,0.96)';     // soft neutral — bar clean
  }

  let borderColor = selected        ? '#22c55e'
    : combinedSelected ? '#3b82f6'
    : softHold && table.liveStatus === 'AVAILABLE' ? '#6366f1'
    : isOverdue      ? '#ef4444'
    : table.locked   ? '#f59e0b'
    : sectionColor;

  let borderWidth = selected || combinedSelected || (softHold && table.liveStatus === 'AVAILABLE') ? 2 : 1.5;

  let boxShadow: string | undefined = selected
    ? '0 0 0 3px rgba(34,197,94,0.48), 0 0 36px rgba(34,197,94,0.22)'
    : combinedSelected
    ? '0 0 0 3px rgba(59,130,246,0.48), 0 0 32px rgba(59,130,246,0.20)'
    : softHold && table.liveStatus === 'AVAILABLE'
    ? '0 0 0 3px rgba(99,102,241,0.34), 0 0 30px rgba(99,102,241,0.18)'
    : bestSuggestion
    ? '0 0 0 2px rgba(34,197,94,0.28), 0 0 30px rgba(34,197,94,0.15)'
    : isOverdue ? '0 0 0 2px rgba(239,68,68,0.38)'   // structural ring — always present regardless of animation
    : table.locked ? '0 0 0 2px rgba(245,158,11,0.18)' : undefined;

  let opacity = dimmed ? 0.25 : table.locked ? 0.55 : 1;
  let cursor = 'pointer';

  // Status-driven border refinements
  if (!selected && !combinedSelected && !(softHold && table.liveStatus === 'AVAILABLE') && !isOverdue && !table.locked) {
    if (table.liveStatus === 'RESERVED_SOON') {
      borderColor = 'rgba(217,119,6,0.82)';           // amber — imminent arrival
    } else if (table.liveStatus === 'RESERVED') {
      borderColor = 'rgba(59,130,246,0.40)';           // cool blue — calm, committed
    } else if (isEndingSoon) {
      borderColor = 'rgba(251,191,36,0.52)';           // warm readiness — the table is preparing to free
    } else if (table.liveStatus === 'BLOCKED') {
      borderColor = 'rgba(82,82,91,0.40)';
      borderWidth = 1;
    }
  }

  // AVAILABLE: recede — thinner border, section color at low opacity so empty tables don't compete.
  // Communal carries slightly more edge weight (structural presence); lounge recedes further (softness).
  if (table.liveStatus === 'AVAILABLE' && !selected && !combinedSelected && !softHold && !table.locked) {
    borderWidth = cls === 'communal' ? 1.5 : cls === 'lounge' ? 1 : 1;
    borderColor = sectionColor.startsWith('#') && sectionColor.length === 7
      ? sectionColor + '44'   // ~27% opacity — empty tables do not compete
      : sectionColor;
  }

  // BLOCKED: intentional absence — near-ghost, clearly not in service
  if (table.liveStatus === 'BLOCKED' && !selected && !combinedSelected) {
    opacity = Math.min(opacity, 0.60);
    cursor = 'default';
  }

  // Peripheral quieting — continuous, pressure-proportional recession of idle tables.
  // At quietFade=0.10 → opacity ≤ 0.87 (barely visible). At 0.40 → ≤ 0.78 (matches prior binary).
  // Active zones emerge without any explicit signal — the room does the talking.
  if (quietFade > 0 && table.liveStatus === 'AVAILABLE' && !softHold && !table.locked && !selected) {
    opacity = Math.min(opacity, 0.88 - quietFade * 0.38);
  }

  // Waitlist assign target — indigo ring (overrides base, applies before pick mode)
  if (waitlistAssignTarget) {
    bg          = 'rgba(235,232,254,0.96)';
    borderColor = '#6366f1';
    borderWidth = 2;
    boxShadow   = '0 0 0 3px rgba(99,102,241,0.48), 0 0 36px rgba(99,102,241,0.22)';
    opacity     = 1;
  }

  // Ineligible table flash — brief red ring when host clicks an unavailable table in assign mode
  if (wlPickWarn) {
    borderColor = '#ef4444';
    borderWidth = 2;
    boxShadow   = '0 0 0 3px rgba(239,68,68,0.35)';
    opacity     = 1;
  }

  // Pick mode — express selection state through border rings only.
  // Live background colors are intentionally preserved.
  if (pickMode) {
    if (pickStatus === 'current') {
      borderColor = '#f59e0b';
      borderWidth = 2.5;
      boxShadow   = '0 0 0 3px rgba(245,158,11,0.30)';
      opacity     = 1;
      cursor      = 'default';
    } else if (pickSelected) {
      bg          = 'rgba(59,130,246,0.22)';
      borderColor = '#3b82f6';
      borderWidth = 2;
      boxShadow   = '0 0 0 3px rgba(59,130,246,0.35)';
      opacity     = 1;
    } else {
      switch (pickStatus) {
        case 'recommended':
          borderColor = '#22c55e';
          borderWidth = 2;
          boxShadow   = '0 0 0 2px rgba(34,197,94,0.25)';
          opacity     = 1;
          break;
        case 'possible':
          borderColor = '#3b82f6';
          borderWidth = 1.5;
          opacity     = 1;
          break;
        case 'tight':
          borderColor = '#d97706';
          borderWidth = 1.5;
          opacity     = 1;
          break;
        case 'unavailable':
          opacity = 0.55;
          cursor  = 'not-allowed';
          break;
        default:
          opacity = 1;
          break;
      }
    }
  }

  const currentRes = table.currentReservation;
  const displayRes = currentRes ?? nextRes ?? null;

  // Queue→floor hover: soft emphasis when mouse is over the matching queue row
  const isQueueHovered = !pickMode && !selected && !combinedSelected && !!hoveredResId && (
    currentRes?.id === hoveredResId ||
    table.upcomingReservations.some(r => r.id === hoveredResId)
  );
  if (isQueueHovered) {
    borderWidth = Math.max(borderWidth, 1.5);
    if (!boxShadow) boxShadow = '0 0 0 3px rgba(255,255,255,0.09)';
    if (dimmed) opacity = Math.max(opacity, 0.55);
  }

  // State halo — soft operational light pool that anchors each table in the dark surface.
  // Wider spread (36-44px) gives clear spatial presence without neon aggression.
  // Suppressed during pick/warn/select modes where border rings carry state signal.
  if (!pickMode && !wlPickWarn && !waitlistAssignTarget && !selected && !combinedSelected && !dimmed && !(softHold && table.liveStatus === 'AVAILABLE')) {
    let halo: string | undefined;
    if (isOverdue) {
      halo = '0 0 0 1px rgba(239,68,68,0.40), 0 0 44px rgba(239,68,68,0.26)';
    } else if (table.liveStatus === 'OCCUPIED') {
      halo = '0 0 0 1px rgba(134,239,172,0.28), 0 0 40px rgba(134,239,172,0.16)';
    } else if (table.liveStatus === 'RESERVED_SOON') {
      halo = '0 0 0 1px rgba(251,191,36,0.35), 0 0 40px rgba(251,191,36,0.20)';
    } else if (table.liveStatus === 'RESERVED') {
      halo = '0 0 0 1px rgba(147,197,253,0.26), 0 0 36px rgba(147,197,253,0.14)';
    } else if (table.liveStatus === 'AVAILABLE') {
      halo = '0 0 16px rgba(255,255,255,0.05)';
    }
    if (halo) boxShadow = boxShadow ? `${boxShadow}, ${halo}` : halo;
  }

  // Plate depth — subtle inset edge highlight. Suppressed during pick/warn states and BLOCKED.
  if (!pickMode && !wlPickWarn && !waitlistAssignTarget && table.liveStatus !== 'BLOCKED') {
    const depthShadow = 'inset 0 1px 0 rgba(255,255,255,0.96), inset 0 -2px 6px rgba(0,0,0,0.12)';
    boxShadow = boxShadow ? `${boxShadow}, ${depthShadow}` : depthShadow;
  }

  // Typography hierarchy: when a guest occupies or is reserved, the guest name is primary
  // and the table number becomes a secondary label
  const hasGuest = ['OCCUPIED', 'RESERVED', 'RESERVED_SOON'].includes(table.liveStatus) && !!displayRes;

  // Multi-turn stack — turns to show below the table boundary.
  // Uses `turns` prop (PENDING+CONFIRMED from full reservations list) — not table.upcomingReservations,
  // which is empty for OCCUPIED and AVAILABLE tables (backend only populates it for RESERVED/SOON).
  // OCCUPIED: all `turns` (current is SEATED and not in the list). RESERVED/SOON: skip index 0
  // (it's the primary turn already shown inside). AVAILABLE: all `turns`. Cap at 4.
  const turnsToShow = (!pickMode && !wlPickWarn && !dimmed)
    ? table.liveStatus === 'OCCUPIED'
      ? turns.slice(0, 4)
      : (table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON')
      ? turns.slice(1, 5)
      : table.liveStatus === 'AVAILABLE'
      ? turns.slice(0, 4)
      : []
    : [];

  // Position-seeded animation delay — each table starts mid-cycle at a unique offset.
  // Negative value means the animation has already been running for that duration.
  const _animSeed = table.posX * 0.013 + table.posY * 0.017;

  // Class-modulated drop shadow — VIP tables cast a deeper, premium shadow footprint.
  // Pick mode: uniform single shadow — border rings carry status signal, no need for multi-layer GPU work.
  const tableFilter = dimmed ? undefined
    : pickMode          ? 'drop-shadow(0 2px 12px rgba(0,0,0,0.55))'
    : table.liveStatus === 'OCCUPIED'
                        ? 'drop-shadow(0 4px 22px rgba(0,0,0,0.72)) drop-shadow(0 1px 6px rgba(0,0,0,0.42))'
    : table.liveStatus === 'RESERVED_SOON'
                        ? 'drop-shadow(0 3px 18px rgba(0,0,0,0.60)) drop-shadow(0 1px 5px rgba(0,0,0,0.30))'
    : table.liveStatus === 'RESERVED'
                        ? 'drop-shadow(0 3px 16px rgba(0,0,0,0.54)) drop-shadow(0 1px 4px rgba(0,0,0,0.26))'
    : table.liveStatus === 'BLOCKED'
                        ? undefined
                        : 'drop-shadow(0 1px 7px rgba(0,0,0,0.28))';

  return (
  <>
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={turnTooltip}
      className="active:scale-[0.965] touch-manipulation"
      style={{
        position: 'absolute',
        left: table.posX, top: table.posY,
        width: table.width, height: table.height,
        borderRadius: familyRadius,
        border: `${borderWidth}px solid ${borderColor}`,
        backgroundColor: bg,
        // Material surface — gradient angle and shape vary by table type so overhead light
        // reads correctly: radial for round, top-down for booths, angled for rectangular.
        // Pick/warn states are neutral (clarity first — no decoration during selection).
        backgroundImage: !pickMode && !wlPickWarn ? tableGradient(table.shape, table.liveStatus, cls) : undefined,
        boxShadow,
        // Physical depth — tables are objects on a floor, they cast shadows.
        // Occupied tables come forward (heavier shadow); available recede (lighter).
        // Drop-shadow is not clipped by overflow:hidden, unlike box-shadow.
        // Shadow hierarchy mirrors operational priority: OCCUPIED comes forward most.
        // Double drop-shadow (wide soft + tight hard) replicates real restaurant
        // spotlight physics — a wide floor shadow beneath + a tight table-edge shadow.
        filter: tableFilter,
        opacity,
        padding: '6px 8px',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        textAlign: 'left',
        cursor,
        transition: `opacity var(--duration-fast) ease-out, transform var(--duration-fast) var(--ease-hospitality), filter var(--duration-settle) var(--ease-hospitality), border-color var(--duration-service) var(--ease-hospitality), box-shadow var(--duration-service) var(--ease-hospitality), background-color var(--duration-settle) var(--ease-hospitality)`,
      }}
    >
      {/* ── Live presence overlays ──────────────────────────────────────────── */}
      {/* Alive — occupied non-overdue tables breathe with a faint green warmth */}
      {!pickMode && !wlPickWarn && !waitlistAssignTarget && table.liveStatus === 'OCCUPIED' && !isOverdue && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          background: 'radial-gradient(ellipse 90% 90% at 35% 35%, rgba(134,239,172,0.14) 0%, transparent 70%)',
          animation: `table-alive 7s ease-in-out infinite`,
          animationDelay: `-${(_animSeed % 6.5).toFixed(2)}s`,
        }} />
      )}
      {/* Centerpiece warmth — static warm center simulating candle or floral catch.
          Not animated; occupies no layout space; barely visible, only felt. */}
      {!pickMode && !wlPickWarn && !waitlistAssignTarget && table.liveStatus === 'OCCUPIED' && !isOverdue && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          background: 'radial-gradient(ellipse 32% 28% at 50% 44%, rgba(255,205,85,0.10) 0%, transparent 100%)',
        }} />
      )}
      {/* Ending — tables about to free pulse with amber from the bottom edge */}
      {!pickMode && isEndingSoon && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 80% at 50% 88%, rgba(251,191,36,0.22) 0%, transparent 70%)',
          animation: `table-ending 6.5s ease-in-out infinite`,
          animationDelay: `-${(_animSeed % 6.5).toFixed(2)}s`,
        }} />
      )}
      {/* Incoming — RESERVED_SOON tables glow from the top edge in anticipation */}
      {!pickMode && !wlPickWarn && !waitlistAssignTarget && table.liveStatus === 'RESERVED_SOON' && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 80% at 50% 12%, rgba(251,191,36,0.16) 0%, transparent 70%)',
          animation: `table-incoming 5s ease-in-out infinite`,
          animationDelay: `-${(_animSeed % 5.0).toFixed(2)}s`,
        }} />
      )}
      {/* Tense — overdue tables pulse with a contained red ring */}
      {!pickMode && !wlPickWarn && !waitlistAssignTarget && isOverdue && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          boxShadow: 'inset 0 0 20px rgba(239,68,68,0.32)',
          animation: `table-tense 5.5s ease-in-out infinite`,
          animationDelay: `-${(_animSeed % 5.5).toFixed(2)}s`,
        }} />
      )}

      {/* Table number — primary when empty, secondary label when a guest is present */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', minWidth: 0 }}>
        <span style={{
          fontSize: hasGuest ? 10 : 15,
          fontWeight: hasGuest ? 600 : 900,
          color: hasGuest ? '#52525b' : table.liveStatus === 'BLOCKED' ? '#a1a1aa' : '#18181b',
          opacity: hasGuest ? 0.62 : table.liveStatus === 'BLOCKED' ? 0.70 : 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          letterSpacing: hasGuest ? '0.04em' : '-0.02em',
        }}>
          {table.name}
        </span>
        {!pickMode && insight?.priority === 'HIGH'   && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} />}
        {!pickMode && insight?.priority === 'MEDIUM' && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#f59e0b', flexShrink: 0 }} />}
        {pickMode && pickStatus === 'current' && (
          <span style={{ fontSize: 9, color: '#d97706', fontWeight: 700, flexShrink: 0 }}>◉</span>
        )}
        {pickMode && pickSelected && (
          <span style={{ fontSize: 9, color: '#2563eb', fontWeight: 700, flexShrink: 0 }}>✓</span>
        )}
        {pickMode && !pickSelected && pickStatus === 'recommended' && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0 }} />
        )}
      </div>

      {/* Capacity — wayfinding for empty tables only; noise on active tables */}
      {!hasGuest && (
        <span style={{ fontSize: 10, color: '#3f3f46', opacity: 0.58, lineHeight: 1.3, marginTop: 1, letterSpacing: '0.02em', fontWeight: 500 }}>
          {table.minCovers}–{table.maxCovers}p
        </span>
      )}

      {/* Pick mode: current-table label */}
      {pickMode && pickStatus === 'current' && (
        <div style={{ marginTop: 2, width: '100%' }}>
          <span style={{ fontSize: 8, color: '#d97706', fontWeight: 700, background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.30)', borderRadius: 3, padding: '1px 4px', letterSpacing: '0.04em', userSelect: 'none' }}>
            {T.floorBoard.pickModeCurrentTable}
          </span>
        </div>
      )}

      {/* OCCUPIED */}
      {table.liveStatus === 'OCCUPIED' && currentRes && (() => {
        const mr = minutesUntilEnd(currentRes.expectedEndTime, Date.now());
        const isCombined  = currentRes.combinedTableIds.length > 0;
        const isSecondary = isCombined && currentRes.combinedTableIds.includes(table.id);
        const nameColor = isOverdue ? '#991b1b' : 'var(--canvas-status-occupied)';
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
              <p style={{ fontSize: 14, color: nameColor, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, letterSpacing: '-0.02em' }}>
                {currentRes.guestName}
              </p>
              {isOverdue && (
                <span style={{ fontSize: 9, color: '#dc2626', fontWeight: 700, background: 'rgba(220,38,38,0.14)', border: '1px solid rgba(220,38,38,0.32)', borderRadius: 4, padding: '1px 4px', flexShrink: 0, letterSpacing: '0.04em' }}>
                  OVR
                </span>
              )}
              {isCombined && !isOverdue && (
                <span style={{ fontSize: 8, color: '#1d4ed8', fontWeight: 700, background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.22)', borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>
                  ⊞
                </span>
              )}
            </div>
            {!isSecondary && (
              <p style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1.3 }}>
                <span style={{ fontSize: 10, color: '#3f3f46', fontWeight: 500, opacity: 0.72 }}>
                  {currentRes.partySize}p
                </span>
                {isToday && (() => {
                  const endTimeStr = new Date(currentRes.expectedEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const timerStr = mr > 20 ? endTimeStr
                    : mr > 5   ? T.floorBoard.mLeft(mr)
                    : mr >= -5 ? T.floorBoard.ending
                    : T.floorBoard.mOver(Math.abs(mr));
                  const timerColor = isOverdue || mr <= 5 ? '#dc2626'
                    : mr <= 20 ? '#b45309'
                    : '#3f3f46';
                  const timerWeight = isOverdue || mr <= 5 ? 800 : mr <= 20 ? 700 : 600;
                  const timerOpacity = isOverdue || mr <= 5 ? 1 : 1;
                  return (
                    <span style={{ fontSize: 11, color: timerColor, fontWeight: timerWeight, opacity: timerOpacity }}>
                      · {timerStr}
                    </span>
                  );
                })()}
              </p>
            )}
          </div>
        );
      })()}

      {/* RESERVED / RESERVED_SOON */}
      {(table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON') && displayRes && (() => {
        const isCombined  = (displayRes.combinedTableIds?.length ?? 0) > 0;
        const isSecondary = isCombined && displayRes.combinedTableIds?.includes(table.id);
        const isSoon = table.liveStatus === 'RESERVED_SOON';
        const guestColor = isSoon ? '#92400e' : 'var(--canvas-status-reserved)';
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
              <p style={{ fontSize: 14, color: guestColor, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, letterSpacing: '-0.02em' }}>
                {displayRes.guestName}
              </p>
              {isSoon && (
                <span style={{ fontSize: 9, color: '#92400e', fontWeight: 700, background: 'rgba(146,64,14,0.12)', border: '1px solid rgba(146,64,14,0.28)', borderRadius: 4, padding: '1px 4px', flexShrink: 0, letterSpacing: '0.04em' }}>
                  ARR
                </span>
              )}
              {isCombined && !isSoon && (
                <span style={{ fontSize: 8, color: '#1d4ed8', fontWeight: 700, background: 'rgba(37,99,235,0.10)', border: '1px solid rgba(37,99,235,0.22)', borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>
                  ⊞
                </span>
              )}
            </div>
            {!isSecondary && nextRes && (
              <p style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1.3 }}>
                <span style={{ fontSize: 10, color: '#3f3f46', fontWeight: 500, opacity: 0.72 }}>
                  {nextRes.partySize}p
                </span>
                <span style={{ fontSize: 11, color: isSoon ? '#92400e' : '#3f3f46', fontWeight: isSoon ? 700 : 600, opacity: 1 }}>
                  · {nextRes.time}
                </span>
                {isToday && isSoon && nextRes.minutesUntil > 0 && (
                  <span style={{ fontSize: 11, color: '#92400e', fontWeight: 800 }}>
                    · {T.floorBoard.inNMin(nextRes.minutesUntil)}
                  </span>
                )}
              </p>
            )}
          </div>
        );
      })()}

      {/* BLOCKED */}
      {table.liveStatus === 'BLOCKED' && (
        <p style={{ fontSize: 10, color: '#a1a1aa', opacity: 0.65, marginTop: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', fontStyle: 'italic' }}>
          {table.blockReason ?? 'blocked'}
        </p>
      )}

      {/* AVAILABLE + soft hold */}
      {!pickMode && table.liveStatus === 'AVAILABLE' && softHold && !insight && (
        <div style={{
          marginTop: 'auto', width: '100%',
          backgroundColor: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)',
          borderRadius: 4, padding: '2px 4px',
        }}>
          <p style={{ fontSize: 9, color: '#a5b4fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⏸ {softHold.guestName} · {softHold.partySize}
          </p>
        </div>
      )}

      {/* AVAILABLE + SEAT_NOW insight */}
      {!pickMode && table.liveStatus === 'AVAILABLE' && insight?.type === 'SEAT_NOW' && insight.reservation && (
        <div
          onClick={(e) => { e.stopPropagation(); onInsightAction?.(); }}
          style={{
            marginTop: 'auto', width: '100%',
            backgroundColor: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 9, color: 'var(--canvas-status-occupied)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {insight.reservation.guestName}
          </p>
        </div>
      )}

      {/* AVAILABLE + waitlist match */}
      {!pickMode && table.liveStatus === 'AVAILABLE' && !insight && waitlistMatch && (
        <div
          onClick={(e) => { e.stopPropagation(); onWaitlistAction?.(); }}
          style={{
            marginTop: 'auto', width: '100%',
            backgroundColor: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 9, color: 'var(--canvas-status-occupied)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {waitlistMatch.guestName} · {waitlistMatch.partySize}
          </p>
        </div>
      )}

      {/* Lock badge */}
      {table.locked && (
        <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <span style={{
            fontSize: 8, color: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 3, padding: '1px 4px', letterSpacing: '0.04em', userSelect: 'none',
          }}>
            LOCKED
          </span>
        </div>
      )}

      {/* Turn count badge — fallback when the turn stack is not rendered (pick mode, dimmed, etc.) */}
      {!pickMode && extraTurns > 0 && turnsToShow.length === 0 && table.liveStatus !== 'AVAILABLE' && !isOverdue && (
        <span style={{
          position: 'absolute', top: 3, right: 3,
          fontSize: 9, fontWeight: 700, color: '#60a5fa',
          backgroundColor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: 3, padding: '1px 4px', userSelect: 'none', lineHeight: 1.4,
        }}>
          +{extraTurns}
        </span>
      )}

      {/* Section color dot — only on available tables; occupied/reserved content speaks for itself */}
      {!pickMode && table.section?.color && !table.locked && table.liveStatus === 'AVAILABLE' && (
        <span style={{
          position: 'absolute', bottom: 4, right: 4,
          width: 5, height: 5, borderRadius: '50%',
          backgroundColor: table.section.color, opacity: 0.52,
        }} />
      )}
    </button>

    {/* Multi-turn stack — operational timeline anchored below table boundary.
        Reservation schedule always visible. Operational truth > geometric purity. */}
    {turnsToShow.length > 0 && (
      <div
        style={{
          position: 'absolute',
          left: table.posX,
          top: table.posY + table.height + 2,
          minWidth: table.width,
          maxWidth: table.width + 52,
          zIndex: 6,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          opacity,
        }}
      >
        {/* Connector — thin vertical line visually anchoring the list to the table edge */}
        <div style={{
          position: 'absolute',
          top: -3,
          left: 10,
          width: 1,
          height: 4,
          background: 'rgba(255,255,255,0.18)',
        }} />
        {turnsToShow.map((r, i) => (
          <div
            key={r.id ?? i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 6px',
              background: 'rgba(20,22,20,0.92)',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: 'inset 2px 0 0 rgba(96,165,250,0.30)',
            }}
          >
            <span style={{ fontSize: 10, color: '#a1a1aa', fontWeight: 700, flexShrink: 0, minWidth: 34, letterSpacing: '0.01em', fontVariantNumeric: 'tabular-nums' }}>
              {r.time}
            </span>
            <span style={{ fontSize: 9, color: '#d4d4d8', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {r.guestName}
            </span>
            <span style={{ fontSize: 9, color: '#9ca3af', flexShrink: 0, fontWeight: 500 }}>
              {r.partySize}p
            </span>
          </div>
        ))}
      </div>
    )}
  </>
  );
}
