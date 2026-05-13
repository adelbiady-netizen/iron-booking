import { useState, useRef, useEffect } from 'react';
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

interface SectionGroup {
  id: string;
  name: string;
  color: string;
  tables: FloorTable[];
}

// Kinds rendered as SVG elements inside ArchLayer — filtered out of the HTML div block.
const SVG_RENDERED_KINDS = new Set<string>(['PLANTER', 'SERVICE_LANE', 'LOUNGE_BOUNDARY', 'VIP_ENCLOSURE']);

// ── Geometry-based variant inference ─────────────────────────────────────────
// No backend field required. Future schema can replace with explicit `variant`.

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
  if (/\bbar\b|counter|pass/.test(combined)) return 'BAR_SEATING';
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
        backgroundImage: 'linear-gradient(180deg, rgba(80,120,220,0.30) 0%, rgba(40,70,140,0.18) 45%, rgba(0,0,0,0.34) 100%)',
        border: '1.5px solid rgba(28,54,128,0.84)',
        borderRadius: 3,
        boxShadow: '0 2px 20px rgba(28,54,128,0.42), inset 0 -2px 0 rgba(100,140,255,0.18)',
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
  AVAILABLE:     'rgba(38,30,20,0.97)',        // warm dark brown — distinct from floor, not floating
  OCCUPIED:      'rgba(22,163,74,0.28)',        // fill recedes — glow system carries the energy
  RESERVED_SOON: 'rgba(217,119,6,0.32)',         // warming — imminence energy
  RESERVED:      'rgba(37,99,235,0.16)',          // calm, committed
  BLOCKED:       'rgba(82,82,91,0.11)',            // intentionally withdrawn
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

function tableRadius(shape: string): string {
  if (shape === 'ROUND' || shape === 'OVAL') return '9999px';
  if (shape === 'BOOTH') return '4px 4px 18px 18px';  // straight back, intentional seat curve
  return '10px';  // less button-rectangle, more slab weight
}

// Surface gradient per table shape — each material type and status implies a different light response.
// OCCUPIED_WARM: candle warmth across the tablecloth — at 6.5% it reads as inhabited, not tinted.
const OCCUPIED_WARM = 'radial-gradient(ellipse 90% 85% at 50% 50%, rgba(255,200,80,0.065) 0%, transparent 100%)';

function tableGradient(shape: string, status: string, cls: string): string | undefined {
  if (status === 'BLOCKED') return undefined;
  const isRound = shape === 'ROUND' || shape === 'OVAL';
  const isBooth = shape === 'BOOTH';
  const isVip   = cls === 'vip';

  if (isRound) {
    if (status === 'OCCUPIED')
      // VIP: tighter beam, brighter catch — polished stone under a precision spotlight
      return isVip
        ? `radial-gradient(ellipse 60% 56% at 38% 33%, rgba(255,255,255,0.16) 0%, transparent 58%), ${OCCUPIED_WARM}`
        : `radial-gradient(ellipse 64% 60% at 40% 36%, rgba(255,255,255,0.13) 0%, transparent 62%), ${OCCUPIED_WARM}`;
    if (status === 'RESERVED_SOON')
      return 'radial-gradient(ellipse 62% 58% at 40% 36%, rgba(255,255,255,0.060) 0%, transparent 65%), radial-gradient(ellipse 90% 30% at 50% 0%, rgba(251,191,36,0.07) 0%, transparent 80%)';
    if (status === 'RESERVED')
      return 'radial-gradient(ellipse 58% 52% at 40% 36%, rgba(255,255,255,0.038) 0%, transparent 68%), radial-gradient(ellipse 60% 50% at 50% 50%, rgba(37,99,235,0.06) 0%, transparent 100%)';
    // Available — VIP: refined marble grain (cooler, more precise); lounge: warmer softer catch
    return isVip
      ? 'radial-gradient(ellipse 52% 48% at 40% 33%, rgba(238,218,175,0.042) 0%, transparent 66%)'
      : cls === 'lounge'
      ? 'radial-gradient(ellipse 58% 54% at 44% 38%, rgba(255,210,150,0.058) 0%, transparent 72%)'
      : 'radial-gradient(ellipse 55% 50% at 42% 35%, rgba(255,200,130,0.055) 0%, transparent 70%)';
  }

  if (isBooth) {
    if (status === 'OCCUPIED')
      // Booth: bright top catch + banquette shadow depth at the seat back
      return `linear-gradient(180deg, rgba(255,255,255,0.072) 0%, rgba(255,255,255,0.008) 100%), linear-gradient(0deg, rgba(0,0,0,0.18) 0%, transparent 28%), ${OCCUPIED_WARM}`;
    if (status === 'RESERVED_SOON')
      return 'linear-gradient(180deg, rgba(255,255,255,0.038) 0%, transparent 60%), linear-gradient(180deg, rgba(251,191,36,0.055) 0%, transparent 50%)';
    if (status === 'RESERVED')
      return 'linear-gradient(180deg, rgba(255,255,255,0.024) 0%, transparent 60%), linear-gradient(145deg, rgba(37,99,235,0.04) 0%, transparent 70%)';
    // Booth available: banquette warmth + deep shadow at seat back
    return 'linear-gradient(180deg, rgba(255,200,130,0.048) 0%, transparent 50%), linear-gradient(0deg, rgba(0,0,0,0.14) 0%, transparent 24%)';
  }

  // Rectangular / square
  if (status === 'OCCUPIED')
    return isVip
      ? `linear-gradient(148deg, rgba(255,255,255,0.14) 0%, transparent 46%), ${OCCUPIED_WARM}`
      : cls === 'large'
      ? `linear-gradient(148deg, rgba(255,255,255,0.10) 0%, transparent 56%), ${OCCUPIED_WARM}`
      : `linear-gradient(148deg, rgba(255,255,255,0.10) 0%, transparent 50%), ${OCCUPIED_WARM}`;
  if (status === 'RESERVED_SOON')
    return 'linear-gradient(148deg, rgba(255,255,255,0.044) 0%, transparent 54%), linear-gradient(180deg, rgba(251,191,36,0.055) 0%, transparent 52%)';
  if (status === 'RESERVED')
    return 'linear-gradient(148deg, rgba(255,255,255,0.028) 0%, transparent 58%), linear-gradient(135deg, rgba(37,99,235,0.04) 0%, transparent 65%)';
  // Available — VIP: cooler refined grain; chef: industrial cool surface; standard: warm walnut
  return isVip
    ? 'linear-gradient(148deg, rgba(232,212,170,0.036) 0%, transparent 50%)'
    : cls === 'chef'
    ? 'linear-gradient(148deg, rgba(200,215,220,0.034) 0%, transparent 52%)'
    : 'linear-gradient(148deg, rgba(255,200,130,0.050) 0%, transparent 52%)';
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
      const cx = e.clientX - rect.left + container.scrollLeft;
      const cy = e.clientY - rect.top + container.scrollTop;
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
        const cx = e.clientX - rect.left + container.scrollLeft;
        const cy = e.clientY - rect.top + container.scrollTop;
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
  }, [pickMode, tables, pickSuggestions]);

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('button')) return;
    const container = canvasScrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragStartRef.current = {
      cx: e.clientX - rect.left + container.scrollLeft,
      cy: e.clientY - rect.top + container.scrollTop,
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

          // Grid — most visible at morning (architectural), nearly gone at dinner/late-night
          const gridAlpha  = isDark
            ? 0.028 * (1 - gridFade * 0.90)
            : 0.055 * (1 - gridFade * 0.70);
          const gridRgb    = isDark ? '255,195,110' : '0,0,0';
          const gridColor  = `rgba(${gridRgb},${gridAlpha.toFixed(4)})`;

          // Vignette depth — architectural and open at daylight, cinematic at dinner
          const vigBase1   = 0.60 + (1 - brightness) * 0.28;  // 0.60 morning → 0.85 night
          const vigBase2   = 0.32 + (1 - brightness) * 0.24;  // 0.32 morning → 0.56 night
          const vigRadius1 = Math.round(230 + (1 - brightness) * 50 + pressureScore * 18);
          const vigRadius2 = Math.round(110 + (1 - brightness) * 20 + pressureScore * 10);

          // Entrance light — stronger in daylight (cool natural light spills in)
          const entranceAlpha = (0.008 + brightness * 0.014).toFixed(4);

          // Ambient bloom — wider/diffuse at morning, focused/golden at dinner
          const ambW = Math.round(72 + brightness * 14); // 86% morning → 72% dinner
          const ambH = Math.round(58 + brightness * 12); // 70% morning → 58% dinner
          const ambG = Math.round(250 - timeWarmth * 25); // 250 morning → 225 dinner
          const ambB = Math.round(235 - timeWarmth * 65); // 235 morning → 170 dinner
          const ambA = (0.010 + brightness * 0.008 + timeWarmth * 0.006).toFixed(4);
          // Pace: 14s at morning, slows to ~22s at peak dinner (room feels dense and full)
          const ambDuration = (14 + timeWarmth * 4 + (1 - brightness) * 4).toFixed(1);

          return (
        <div ref={canvasScrollRef} className="flex-1 overflow-auto" style={{
          // Day/night-aware vignette: open and architectural at daylight, cinematic at dinner.
          // Pressure still tightens the room — both signals compound naturally.
          boxShadow: [
            `inset 0 0 ${vigRadius1}px rgba(0,0,0,${(vigBase1 + pressureScore * 0.035 + timeWarmth * 0.012).toFixed(3)})`,
            `inset 0 0 ${vigRadius2}px rgba(0,0,0,${(vigBase2 + pressureScore * 0.030 + timeWarmth * 0.008).toFixed(3)})`,
            `inset 0 80px 100px -30px rgba(0,0,0,${(0.28 + (1 - brightness) * 0.22).toFixed(3)})`,
            `inset 0 -30px 80px rgba(0,0,0,${(0.16 + (1 - brightness) * 0.16).toFixed(3)})`,
            `inset 55px 0 80px rgba(0,0,0,${(0.12 + (1 - brightness) * 0.12).toFixed(3)})`,
            `inset -55px 0 80px rgba(0,0,0,${(0.12 + (1 - brightness) * 0.12).toFixed(3)})`,
          ].join(', '),
        }}>
          <div
            onMouseDown={pickMode ? handleCanvasMouseDown : undefined}
            style={{
              position: 'relative',
              width: CANVAS_W,
              height: CANVAS_H,
              backgroundColor: 'var(--canvas-bg)',
              backgroundImage: [
                // Primary chandelier bloom — warm center, premium room scale
                'radial-gradient(ellipse 85% 68% at 50% 38%, var(--canvas-ambient) 0%, transparent 72%)',
                // Secondary sconce — side fixture, offset from center
                'radial-gradient(ellipse 40% 38% at 30% 65%, rgba(255,215,160,0.014) 0%, transparent 100%)',
                // Kitchen/pass warmth — amber from back-right
                'radial-gradient(ellipse 38% 46% at 86% 74%, rgba(255,185,80,0.016) 0%, transparent 100%)',
                // Entrance light — strengthens in daylight: cool natural light spilling in
                `radial-gradient(ellipse 25% 52% at 7% 46%, rgba(180,210,255,${entranceAlpha}) 0%, transparent 100%)`,
                // Wood grain — diagonal plank seams
                'repeating-linear-gradient(15deg, transparent, transparent 28px, rgba(255,195,110,0.009) 28px, rgba(255,195,110,0.009) 30px)',
                // Grid H — suppressed by service phase: visible at morning, gone at dinner
                `linear-gradient(0deg, transparent 27.5px, ${gridColor} 27.5px, ${gridColor} 28px, transparent 28px)`,
                // Grid V
                `linear-gradient(90deg, transparent 27.5px, ${gridColor} 27.5px, ${gridColor} 28px, transparent 28px)`,
                // Service density — pressure + dinner warmth
                `radial-gradient(ellipse 58% 52% at 50% 42%, rgba(255,190,60,${(pressureScore * 0.009 + timeWarmth * 0.006).toFixed(4)}) 0%, transparent 62%)`,
                // Daylight architectural fill — warm skylight from above at morning,
                // fades to nothing at dinner. Makes morning feel open, not dark.
                `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,240,220,${(brightness * 0.022).toFixed(4)}) 0%, transparent 80%)`,
                // Floor-level warmth — warm stone absorbing dinner heat. Rises from below the canvas.
                // Invisible at morning, a faint golden wash at peak dinner service.
                `radial-gradient(ellipse 70% 35% at 50% 104%, rgba(200,158,96,${(timeWarmth * 0.016).toFixed(4)}) 0%, transparent 70%)`,
              ].join(', '),
              backgroundSize: 'auto, auto, auto, auto, 30px 30px, 28px 28px, 28px 28px, auto, auto, auto',
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
                background: `radial-gradient(ellipse ${ambW}% ${ambH}% at 50% 36%, rgba(255,${ambG},${ambB},${ambA}) 0%, transparent 65%)`,
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
                  border: `1px solid ${z.color}22`,
                  background: `radial-gradient(ellipse 80% 75% at 50% 48%, ${z.color}0C 0%, ${z.color}04 60%, transparent 85%)`,
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

            {/* Spatial energy field — occupied spotlight + bar anchor + arrival warmth + overdue tinge */}
            <SpatialEnergyField tables={canvasTables} floorObjs={floorObjs} pressureScore={pressureScore} timeWarmth={timeWarmth} brightness={brightness} />

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
                className="w-full text-left px-3 py-1.5 text-xs text-iron-text hover:bg-iron-bg transition-colors"
              >
                {T.floorBoard.unlockTable}
              </button>
            ) : (
              <button
                onClick={() => { onLockTable?.(ctxMenu.table); setCtxMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-xs text-iron-text hover:bg-iron-bg transition-colors"
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
            className="text-iron-muted text-xs hover:text-iron-text transition-colors shrink-0"
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

  const bars          = floorObjs.filter(o => o.kind === 'BAR');
  const planters      = floorObjs.filter(o => o.kind === 'PLANTER');
  const lanes         = floorObjs.filter(o => o.kind === 'SERVICE_LANE');
  const loungeBounds  = floorObjs.filter(o => o.kind === 'LOUNGE_BOUNDARY');
  const vipEnclosures = floorObjs.filter(o => o.kind === 'VIP_ENCLOSURE');
  const booths        = tables.filter(t => t.shape === 'BOOTH' && t.height >= 38);

  const woodOp1 = (0.022 + timeWarmth * 0.008).toFixed(3);
  const woodOp2 = (0.012 + timeWarmth * 0.004).toFixed(3);
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
      </defs>

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
                fill={`rgba(8,5,2,${(0.052 + timeWarmth * 0.022).toFixed(3)})`}
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
            <ellipse cx={cx} cy={o.posY + ry * 0.80} rx={rx * 0.88} ry={ry * 0.68}
              fill={`rgba(18,48,20,${leafOp.toFixed(2)})`} />
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

function SpatialEnergyField({ tables, floorObjs = [], pressureScore, timeWarmth, brightness }: {
  tables: FloorTable[];
  floorObjs?: FloorObjectData[];
  pressureScore: number;
  timeWarmth: number;
  brightness: number;
}) {
  const occupied  = tables.filter(t => t.liveStatus === 'OCCUPIED' && !(t.currentReservation?.isOverdue));
  const overdue   = tables.filter(t => t.liveStatus === 'OCCUPIED' &&   t.currentReservation?.isOverdue);
  const bars      = floorObjs.filter(o => o.kind === 'BAR');
  const entrances = floorObjs.filter(o => o.kind === 'ENTRANCE');

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

  if (tables.length === 0 && bars.length === 0 && entrances.length === 0) return null;

  // Glow intensities — dual-modulated by operational pressure and dinner service phase.
  // Pressure (occupancy/waitlist) pulls urgency; timeWarmth pulls atmospheric depth.
  // Dinner adds ~14% to occupied glow baseline — the room glows warmer, not brighter.
  const occOuter    = 0.072 + pressureScore * 0.022 + timeWarmth * 0.010; // 0.072 → 0.104 at dinner/pressure peak
  const occInner    = 0.055 + pressureScore * 0.014 + timeWarmth * 0.007; // 0.055 → 0.076
  const ovdStrength = 0.038 + pressureScore * 0.022; // unchanged — overdue is operational, not atmospheric
  const readyGlow   = 0.026 + pressureScore * 0.012;
  const secOpacity  = 0.034 + pressureScore * 0.010;
  const immGlow     = 0.034 + pressureScore * 0.012;
  // Bar glow deepens at dinner — service pass gets busier, radiates more ambient warmth.
  const barOuter    = 0.085 + timeWarmth * 0.030; // 0.085 → 0.115
  const barMid      = 0.022 + timeWarmth * 0.010; // 0.022 → 0.032
  const barRadius   = Math.round(200 + timeWarmth * 40); // 200 → 240
  // Entrance cool zone — stronger during daylight when natural light spills in from outside.
  const entranceAmbient = 0.025 + brightness * 0.018;
  // Zone character — secondary color radius factors per personality
  const zoneCharOp: Record<string, number>  = { vip: 0.038, terrace: 0.022, lounge: 0.032 };
  const zoneCharRf: Record<string, number>  = { vip: 0.68,  terrace: 1.22,  lounge: 0.88  };
  const zoneCharCol: Record<string, string> = { vip: '#94a3b8', terrace: '#bae6fd', lounge: '#d97706' };

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
        {/* Zone character overlays — VIP feels private+cool, terrace feels airy, lounge feels warm */}
        {sectionZones.filter(z => z.personality !== 'main').map(z => (
          <radialGradient key={`sf-zc-${z.id}`} id={`sf-zc-${z.id}`} cx={z.cx} cy={z.cy} r={z.r * (zoneCharRf[z.personality] ?? 1)} gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor={zoneCharCol[z.personality] ?? 'transparent'} stopOpacity={zoneCharOp[z.personality] ?? 0} />
            <stop offset="100%" stopColor={zoneCharCol[z.personality] ?? 'transparent'} stopOpacity={0} />
          </radialGradient>
        ))}
        {/* Entrance arrival fields — cool blue, implying fresh air from outside */}
        {entrances.map(o => {
          const cx = o.posX + o.width / 2, cy = o.posY + o.height / 2;
          return (
            <radialGradient key={`sf-ent-${o.id}`} id={`sf-ent-${o.id}`} cx={cx} cy={cy} r={268} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#bfdbfe" stopOpacity={entranceAmbient} />
              <stop offset="42%"  stopColor="#93c5fd" stopOpacity={entranceAmbient * 0.28} />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity={0} />
            </radialGradient>
          );
        })}
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
        {bars.map(o => {
          const cx = o.posX + o.width / 2; const cy = o.posY + o.height / 2;
          return (
            <radialGradient key={`sf-bar-${o.id}`} id={`sf-bar-${o.id}`} cx={cx} cy={cy} r={barRadius} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#d97706" stopOpacity={barOuter} />
              <stop offset="50%"  stopColor="#d97706" stopOpacity={barMid} />
              <stop offset="100%" stopColor="#d97706" stopOpacity={0} />
            </radialGradient>
          );
        })}
        {/* Bar lamp pool — tight warm-white ellipse directly over the counter: the overhead lamp */}
        {bars.map(o => {
          const cx = o.posX + o.width / 2, cy = o.posY + o.height / 2;
          const lr = Math.max(o.width, o.height) * 0.74;
          const lop = 0.030 + timeWarmth * 0.015;
          return (
            <radialGradient key={`sf-barlamp-${o.id}`} id={`sf-barlamp-${o.id}`} cx={cx} cy={cy} r={lr} gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="#fffbf0" stopOpacity={lop} />
              <stop offset="48%"  stopColor="#fff8e6" stopOpacity={lop * 0.32} />
              <stop offset="100%" stopColor="#fff8e6" stopOpacity={0} />
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
        const op  = t.liveStatus === 'OCCUPIED'      ? 0.052
                  : t.liveStatus === 'RESERVED_SOON' ? 0.034
                  : t.liveStatus === 'RESERVED'       ? 0.028 : 0.018;
        return <ellipse key={`sf-shd-${t.id}`} cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" fillOpacity={op} filter="url(#sf-shadow-blur)" />;
      })}
      {/* Entrance arrival zones — cool ambient field implying outside air */}
      {entrances.map(o => {
        const cx = o.posX + o.width / 2, cy = o.posY + o.height / 2;
        return <circle key={`sf-ent-${o.id}`} cx={cx} cy={cy} r={268} fill={`url(#sf-ent-${o.id})`} />;
      })}
      {sectionZones.map(z => (
        <circle key={`sf-sec-${z.id}`} cx={z.cx} cy={z.cy} r={z.r} fill={`url(#sf-sec-${z.id})`} />
      ))}
      {/* Zone character overlays — rendered above section ambient, below table glows */}
      {sectionZones.filter(z => z.personality !== 'main').map(z => (
        <circle key={`sf-zc-${z.id}`} cx={z.cx} cy={z.cy} r={z.r * (zoneCharRf[z.personality] ?? 1)} fill={`url(#sf-zc-${z.id})`} />
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
      {/* Social density — warm ellipses between nearby occupied table pairs.
          Two active tables in proximity share warmth; the floor between them glows
          with accumulated social energy — conversation, candle scatter, heat. */}
      {occupied.length > 1 && occupied.flatMap((ti, i) =>
        occupied.slice(i + 1).map((tj, j) => {
          const dx = (ti.posX + ti.width / 2) - (tj.posX + tj.width / 2);
          const dy = (ti.posY + ti.height / 2) - (tj.posY + tj.height / 2);
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d <= 0 || d >= 230) return null;
          const mx  = (ti.posX + ti.width / 2 + tj.posX + tj.width / 2) / 2;
          const my  = (ti.posY + ti.height / 2 + tj.posY + tj.height / 2) / 2;
          const op  = ((1 - d / 230) * (occOuter * 0.48 + timeWarmth * 0.010)).toFixed(4);
          return <ellipse key={`sf-sl-${i}-${j}`} cx={mx} cy={my} rx={85} ry={48} fill={`rgba(255,185,60,${op})`} />;
        }).filter(Boolean)
      )}
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
      {bars.map(o => {
        const cx = o.posX + o.width / 2; const cy = o.posY + o.height / 2;
        return <circle key={`sf-bar-${o.id}`} cx={cx} cy={cy} r={barRadius} fill={`url(#sf-bar-${o.id})`} />;
      })}
      {/* Bar lamp pool — warm-white ellipse tightly wrapping the counter surface */}
      {bars.map(o => {
        const cx = o.posX + o.width / 2, cy = o.posY + o.height / 2;
        const lr = Math.max(o.width, o.height) * 0.74;
        return <ellipse key={`sf-barlamp-${o.id}`} cx={cx} cy={cy} rx={lr * 1.28} ry={lr * 0.62} fill={`url(#sf-barlamp-${o.id})`} />;
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
        const cW  = useDots ? 4  : isBarSeating ? 7 : area > 7000 ? 11 : 8;
        const cH  = useDots ? 4  : isBarSeating ? 7 : area > 7000 ?  7 : 5;
        const gap  = isLounge ? 3.5 : 2.5;
        const cRx  = useDots ? cW / 2 : isBarSeating ? cW / 2 : 2.5;

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
          isOccupied                              ? 'rgba(134,239,172,0.38)'
          : table.liveStatus === 'RESERVED_SOON' ? 'rgba(251,191,36,0.38)'
          : 'rgba(96,165,250,0.34)';
        const filledStroke =
          isOccupied                              ? 'rgba(134,239,172,0.22)'
          : table.liveStatus === 'RESERVED_SOON' ? 'rgba(251,191,36,0.22)'
          : 'rgba(96,165,250,0.20)';
        const emptyFill   = `rgba(63,63,70,${(0.50 * quietLevel).toFixed(2)})`;
        const emptyStroke = `rgba(82,82,91,${(0.30 * quietLevel).toFixed(2)})`;

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

          for (let i = 0; i < perTop;   i++) chairs.push(mkChair(table.posX + (table.width  / (perTop   + 1)) * (i + 1), table.posY - gap - cH / 2,                             cW, cH, 0));
          for (let i = 0; i < perBot;   i++) chairs.push(mkChair(table.posX + (table.width  / (perBot   + 1)) * (i + 1), table.posY + table.height + gap + cH / 2,               cW, cH, 0));
          for (let i = 0; i < perLeft;  i++) chairs.push(mkChair(table.posX - gap - cH / 2,                              table.posY + (table.height / (perLeft  + 1)) * (i + 1), cW, cH, 90));
          for (let i = 0; i < perRight; i++) chairs.push(mkChair(table.posX + table.width + gap + cH / 2,                table.posY + (table.height / (perRight + 1)) * (i + 1), cW, cH, 90));
        }

        const tableOpacity = dimmedTableIds.has(table.id) ? 0.10 : pickMode ? 0.22 : 1;

        // Floor warmth pool — occupied tables radiate soft amber warmth on the floor.
        // Scaled by party size and dinner depth: more guests + later hour = warmer pool.
        const warmthOp = isOccupied && !pickMode
          ? (0.018 + (displayCount - 2) * 0.003 + timeWarmth * 0.007).toFixed(3) : null;

        return (
          <g key={`chairs-${table.id}`} opacity={tableOpacity}>
            {warmthOp && (
              <ellipse cx={cx} cy={cy + table.height * 0.10}
                rx={table.width * 0.96} ry={table.height * 0.65}
                fill={`rgba(255,172,50,${warmthOp})`} />
            )}
            {chairs.map((c, idx) => (
              <rect
                key={idx}
                x={c.x - c.w / 2}
                y={c.y - c.h / 2}
                width={c.w}
                height={c.h}
                rx={cRx}
                fill={c.filled ? filledFill : emptyFill}
                stroke={c.filled ? filledStroke : emptyStroke}
                strokeWidth={0.5}
                transform={c.rotDeg !== 0 ? `rotate(${c.rotDeg}, ${c.x}, ${c.y})` : undefined}
              />
            ))}
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
              <circle key={i} cx={s.cx} cy={s.cy} r={sR}
                fill={sFill} stroke={sStroke} strokeWidth={0.5} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Canvas table card ─────────────────────────────────────────────────────────

function MapTable({ table, selected, combinedSelected, dimmed, bestSuggestion, softHold, onClick, onContextMenu, insight, onInsightAction, waitlistMatch, onWaitlistAction, nowTime: _nowTime, operationalNow: _operationalNow, extraTurns = 0, turnTooltip, pickMode = false, pickSelected = false, pickStatus = null, waitlistAssignTarget = false, wlPickWarn = false, quietFade = 0, date, hoveredResId }: {
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
    table.width * table.height > 9000 ? 'large' : 'standard';

  // Base (non-pick) colors
  const isOverdue = table.liveStatus === 'OCCUPIED' && (table.currentReservation?.isOverdue ?? false);
  const minutesRemaining = (table.liveStatus === 'OCCUPIED' && table.currentReservation)
    ? minutesUntilEnd(table.currentReservation.expectedEndTime, Date.now()) : null;
  const isEndingSoon = isToday && minutesRemaining !== null && minutesRemaining > 5 && minutesRemaining <= 20;

  let bg = softHold && table.liveStatus === 'AVAILABLE' ? 'rgba(99,102,241,0.10)'
    : isOverdue ? 'rgba(185,28,28,0.22)'     // deeper red — heavier, not alarming
    : (STATUS_BG[table.liveStatus] ?? STATUS_BG['AVAILABLE']);
  // VIP class: darker, more refined walnut base — deeper material weight at rest
  if (cls === 'vip' && table.liveStatus === 'AVAILABLE' && !softHold && !isOverdue) {
    bg = 'rgba(22,14,6,0.98)';
  }

  let borderColor = selected        ? '#22c55e'
    : combinedSelected ? '#3b82f6'
    : softHold && table.liveStatus === 'AVAILABLE' ? '#6366f1'
    : isOverdue      ? '#ef4444'
    : table.locked   ? '#f59e0b'
    : sectionColor;

  let borderWidth = selected || combinedSelected || (softHold && table.liveStatus === 'AVAILABLE') ? 2 : 1.5;

  let boxShadow: string | undefined = selected
    ? '0 0 0 3px rgba(34,197,94,0.25)'
    : combinedSelected
    ? '0 0 0 3px rgba(59,130,246,0.30)'
    : softHold && table.liveStatus === 'AVAILABLE'
    ? '0 0 0 3px rgba(99,102,241,0.20), 0 0 10px rgba(99,102,241,0.12)'
    : bestSuggestion
    ? '0 0 0 3px rgba(34,197,94,0.18), 0 0 10px rgba(34,197,94,0.12)'
    : isOverdue ? '0 0 0 2px rgba(239,68,68,0.20)'   // subtle weight on overdue
    : table.locked ? '0 0 0 2px rgba(245,158,11,0.15)' : undefined;

  let opacity = dimmed ? 0.25 : table.locked ? 0.55 : 1;
  let cursor = 'pointer';

  // Status-driven border refinements
  if (!selected && !combinedSelected && !(softHold && table.liveStatus === 'AVAILABLE') && !isOverdue && !table.locked) {
    if (table.liveStatus === 'RESERVED_SOON') {
      borderColor = 'rgba(217,119,6,0.72)';           // amber — imminent arrival
    } else if (isEndingSoon) {
      borderColor = 'rgba(251,191,36,0.52)';           // warm readiness — the table is preparing to free
    } else if (table.liveStatus === 'BLOCKED') {
      borderColor = 'rgba(82,82,91,0.40)';
      borderWidth = 1;
    }
  }

  // AVAILABLE: recede — thinner border, section color at low opacity so empty tables don't compete
  if (table.liveStatus === 'AVAILABLE' && !selected && !combinedSelected && !softHold && !table.locked) {
    borderWidth = 1;
    borderColor = sectionColor.startsWith('#') && sectionColor.length === 7
      ? sectionColor + '66'   // 40% opacity
      : sectionColor;
  }

  // BLOCKED: intentional absence — near-ghost, clearly not in service
  if (table.liveStatus === 'BLOCKED' && !selected && !combinedSelected) {
    opacity = Math.min(opacity, 0.60);
  }

  // Peripheral quieting — continuous, pressure-proportional recession of idle tables.
  // At quietFade=0.10 → opacity ≤ 0.87 (barely visible). At 0.40 → ≤ 0.78 (matches prior binary).
  // Active zones emerge without any explicit signal — the room does the talking.
  if (quietFade > 0 && table.liveStatus === 'AVAILABLE' && !softHold && !table.locked && !selected) {
    opacity = Math.min(opacity, 0.90 - quietFade * 0.30);
  }

  // Waitlist assign target — indigo ring (overrides base, applies before pick mode)
  if (waitlistAssignTarget) {
    bg          = 'rgba(99,102,241,0.18)';
    borderColor = '#6366f1';
    borderWidth = 2;
    boxShadow   = '0 0 0 3px rgba(99,102,241,0.35)';
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

  // Material depth — every physical table has edge depth, a top-lit surface, and an AO bottom.
  // Layered inset shadows simulate the thickness of a real table top seen from above.
  // Suppressed during pick/warn states where clarity wins over atmosphere; BLOCKED is flat/withdrawn.
  if (!pickMode && !wlPickWarn && !waitlistAssignTarget && table.liveStatus !== 'BLOCKED') {
    const depthShadow = isOverdue
      ? 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.28)'
      : table.liveStatus === 'OCCUPIED'
      // Occupied — warm stone: bright top surface catch + deep bottom AO + brass left bevel + right depth
      ? 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -2px 5px rgba(0,0,0,0.30), inset 1px 0 0 rgba(255,200,100,0.06), inset -1px 0 0 rgba(0,0,0,0.14)'
      : table.liveStatus === 'RESERVED_SOON'
      // Reserved soon — warm edge catch + bottom shadow + left amber bevel
      ? 'inset 0 1px 0 rgba(255,200,100,0.09), inset 0 -2px 4px rgba(0,0,0,0.25), inset 1px 0 0 rgba(255,200,100,0.04), inset -1px 0 0 rgba(0,0,0,0.10)'
      : table.liveStatus === 'RESERVED'
      // Reserved — cool surface catch + bottom depth + right shadow
      ? 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 3px rgba(0,0,0,0.22), inset -1px 0 0 rgba(0,0,0,0.08)'
      // Available — dark walnut resting: warm grain top edge + bottom AO + left grain bevel + right shadow
      : 'inset 0 1px 0 rgba(255,200,130,0.08), inset 0 -1px 3px rgba(0,0,0,0.24), inset 1px 0 0 rgba(255,200,130,0.04), inset -1px 0 0 rgba(0,0,0,0.10)';

    boxShadow = boxShadow ? `${boxShadow}, ${depthShadow}` : depthShadow;

    // Occupied non-overdue: green rim glow on top — tablecloth catching the overhead light
    if (table.liveStatus === 'OCCUPIED' && !isOverdue) {
      const tableIsRound = table.shape === 'ROUND' || table.shape === 'OVAL';
      const rimGlow = tableIsRound
        ? 'inset 0 1px 0 rgba(134,239,172,0.12), inset 0 -1px 0 rgba(134,239,172,0.05)'
        : 'inset 0 1px 0 rgba(134,239,172,0.09)';
      boxShadow = `${boxShadow}, ${rimGlow}`;
    }
    // Class-specific material refinements — surface catch and structural depth vary by table type
    if (cls === 'vip') {
      // Polished stone surface: brighter top catch than warm walnut
      const vipCatch = 'inset 0 1px 0 rgba(255,228,180,0.16)';
      boxShadow = boxShadow ? `${boxShadow}, ${vipCatch}` : vipCatch;
    }
    if (cls === 'booth') {
      // Banquette back creates deep AO at the seat join — the back wall is always darker
      const boothAO = 'inset 0 -4px 12px rgba(0,0,0,0.34)';
      boxShadow = boxShadow ? `${boxShadow}, ${boothAO}` : boothAO;
    }
  }

  // Typography hierarchy: when a guest occupies or is reserved, the guest name is primary
  // and the table number becomes a secondary label
  const hasGuest = ['OCCUPIED', 'RESERVED', 'RESERVED_SOON'].includes(table.liveStatus) && !!displayRes;

  // Position-seeded animation delay — each table starts mid-cycle at a unique offset.
  // Negative value means the animation has already been running for that duration.
  const _animSeed = table.posX * 0.013 + table.posY * 0.017;

  // Class-modulated drop shadow — VIP tables cast a deeper, premium shadow footprint.
  const tableFilter = dimmed ? undefined
    : table.liveStatus === 'OCCUPIED'
      ? cls === 'vip'
        ? 'drop-shadow(0 8px 28px rgba(0,0,0,0.92)) drop-shadow(0 2px 7px rgba(0,0,0,0.68)) drop-shadow(0 14px 40px rgba(175,135,40,0.22))'
        : cls === 'large'
        ? 'drop-shadow(0 7px 26px rgba(0,0,0,0.88)) drop-shadow(0 2px 6px rgba(0,0,0,0.62)) drop-shadow(0 12px 34px rgba(165,120,30,0.17))'
        : 'drop-shadow(0 6px 22px rgba(0,0,0,0.85)) drop-shadow(0 2px 6px rgba(0,0,0,0.60)) drop-shadow(0 10px 30px rgba(180,130,40,0.14))'
    : table.liveStatus === 'RESERVED_SOON'
      ? 'drop-shadow(0 4px 14px rgba(0,0,0,0.70)) drop-shadow(0 1px 4px rgba(0,0,0,0.48))'
    : table.liveStatus === 'AVAILABLE'
      ? cls === 'vip'
        ? 'drop-shadow(0 4px 16px rgba(0,0,0,0.72)) drop-shadow(0 1px 4px rgba(0,0,0,0.45))'
        : 'drop-shadow(0 2px 10px rgba(0,0,0,0.55)) drop-shadow(0 1px 3px rgba(0,0,0,0.32))'
    : table.liveStatus === 'BLOCKED'
      ? 'drop-shadow(0 1px 5px rgba(0,0,0,0.30))'
    : 'drop-shadow(0 3px 12px rgba(0,0,0,0.62)) drop-shadow(0 1px 4px rgba(0,0,0,0.40))';

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={turnTooltip}
      className="active:scale-[0.965] touch-manipulation"
      style={{
        position: 'absolute',
        left: table.posX, top: table.posY,
        width: table.width, height: table.height,
        borderRadius: tableRadius(table.shape),
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
          fontSize: hasGuest ? 10 : 12,
          fontWeight: 600,
          color: hasGuest ? 'rgb(var(--iron-muted))' : table.liveStatus === 'BLOCKED' ? 'rgb(var(--iron-muted))' : 'rgb(var(--iron-text))',
          opacity: hasGuest ? 0.65 : table.liveStatus === 'BLOCKED' ? 0.85 : 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          letterSpacing: hasGuest ? '0.02em' : undefined,
        }}>
          {table.name}
        </span>
        {!pickMode && insight?.priority === 'HIGH'   && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} />}
        {!pickMode && insight?.priority === 'MEDIUM' && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#f59e0b', flexShrink: 0 }} />}
        {pickMode && pickStatus === 'current' && (
          <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, flexShrink: 0 }}>◉</span>
        )}
        {pickMode && pickSelected && (
          <span style={{ fontSize: 9, color: '#93c5fd', fontWeight: 700, flexShrink: 0 }}>✓</span>
        )}
        {pickMode && !pickSelected && pickStatus === 'recommended' && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0 }} />
        )}
      </div>

      {/* Capacity — wayfinding for empty tables only; noise on active tables */}
      {!hasGuest && (
        <span style={{ fontSize: 9, color: 'rgb(var(--iron-muted))', opacity: 0.65, lineHeight: 1.3, marginTop: 1 }}>
          {table.minCovers}–{table.maxCovers}
        </span>
      )}

      {/* Pick mode: current-table label */}
      {pickMode && pickStatus === 'current' && (
        <div style={{ marginTop: 2, width: '100%' }}>
          <span style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 3, padding: '1px 4px', letterSpacing: '0.04em', userSelect: 'none' }}>
            {T.floorBoard.pickModeCurrentTable}
          </span>
        </div>
      )}

      {/* OCCUPIED */}
      {table.liveStatus === 'OCCUPIED' && currentRes && (() => {
        const mr = minutesUntilEnd(currentRes.expectedEndTime, Date.now());
        const isCombined  = currentRes.combinedTableIds.length > 0;
        const isSecondary = isCombined && currentRes.combinedTableIds.includes(table.id);
        const nameColor = isOverdue ? '#fca5a5' : 'var(--canvas-status-occupied)';
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
              <p style={{ fontSize: 12, color: nameColor, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textShadow: '0 1px 2px rgba(0,0,0,0.60)' }}>
                {currentRes.guestName}
              </p>
              {isCombined && (
                <span style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 3, padding: '0 2px', flexShrink: 0 }}>
                  ⊞
                </span>
              )}
            </div>
            {!isSecondary && (
              <p style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1.3 }}>
                <span style={{ fontSize: 10, color: 'rgb(var(--iron-muted))', opacity: 0.50 }}>
                  {currentRes.partySize}
                </span>
                {isToday && (() => {
                  const endTimeStr = new Date(currentRes.expectedEndTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const timerStr = mr > 20 ? endTimeStr
                    : mr > 5   ? T.floorBoard.mLeft(mr)
                    : mr >= -5 ? T.floorBoard.ending
                    : T.floorBoard.mOver(Math.abs(mr));
                  const timerColor = isOverdue || mr <= 5 ? '#fca5a5'
                    : mr <= 20 ? '#fbbf24'
                    : 'rgb(var(--iron-muted))';
                  const timerWeight = isOverdue || mr <= 5 ? 700 : mr <= 20 ? 600 : 400;
                  const timerOpacity = isOverdue || mr <= 5 ? 1 : mr <= 20 ? 0.95 : 0.75;
                  return (
                    <span style={{ fontSize: 11, color: timerColor, fontWeight: timerWeight, opacity: timerOpacity }}>
                      · {timerStr}
                    </span>
                  );
                })()}
              </p>
            )}
            {/* Turn-pressure hint — who is waiting for this table.
                Overdue: assertive (0.72). Ending within 15 min: anticipatory (0.40).
                Suppressed at mr ≤ 5: the red timer is already at max urgency; two warm
                colors compete rather than add clarity. */}
            {!isSecondary && nextRes && (isOverdue || (isToday && mr > 5 && mr <= 15)) && (
              <p style={{ marginTop: 2, fontSize: 9, color: '#fbbf24', opacity: isOverdue ? 0.72 : 0.40, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', letterSpacing: '0.01em' }}>
                → {nextRes.guestName} · {nextRes.time}
              </p>
            )}
          </div>
        );
      })()}

      {/* RESERVED / RESERVED_SOON */}
      {(table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON') && displayRes && (() => {
        const isCombined  = (displayRes.combinedTableIds?.length ?? 0) > 0;
        const isSecondary = isCombined && displayRes.combinedTableIds?.includes(table.id);
        // RESERVED_SOON: amber (warming, imminent) — RESERVED: blue (calm, committed)
        const guestColor = table.liveStatus === 'RESERVED_SOON'
          ? '#fbbf24'
          : 'var(--canvas-status-reserved)';
        return (
          <div style={{ marginTop: 'auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
              <p style={{ fontSize: 12, color: guestColor, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textShadow: '0 1px 2px rgba(0,0,0,0.60)' }}>
                {displayRes.guestName}
              </p>
              {isCombined && (
                <span style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 3, padding: '0 2px', flexShrink: 0 }}>
                  ⊞
                </span>
              )}
            </div>
            {!isSecondary && nextRes && (
              <p style={{ marginTop: 1, display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1.3 }}>
                <span style={{ fontSize: 10, color: 'rgb(var(--iron-muted))', opacity: 0.60 }}>
                  {nextRes.partySize} · {nextRes.time}
                </span>
                {isToday && table.liveStatus === 'RESERVED_SOON' && nextRes.minutesUntil > 0 && (
                  <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600, opacity: 0.95 }}>
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
        <p style={{ fontSize: 10, color: 'rgb(var(--iron-muted))', opacity: 0.55, marginTop: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', fontStyle: 'italic' }}>
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

      {/* Turn count badge — only for non-AVAILABLE, non-overdue tables.
          On overdue tables the turn-pressure hint already names the next guest; +N is redundant noise. */}
      {!pickMode && extraTurns > 0 && table.liveStatus !== 'AVAILABLE' && !isOverdue && (
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
          backgroundColor: table.section.color, opacity: 0.9,
        }} />
      )}
    </button>
  );
}
