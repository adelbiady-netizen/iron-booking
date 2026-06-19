import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import type React from 'react';
import type { BackendTableSuggestion, FloorInsight, FloorObjectData, FloorTable, Reservation, TableFirstGuest, WaitlistEntry } from '../types';
import type { PressureInfo } from '../utils/flowControl';
import { logOverride } from '../utils/flowControl';
import TableCard from './TableCard';
import TableTimeline from './TableTimeline';
import { useT } from '../i18n/useT';
import { useLocale } from '../i18n/useLocale';
import { formatSectionName } from '../utils/displayHelpers';
import { minutesUntilEnd, normalizeTime } from '../utils/time';
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

function getObjAppearance(o: FloorObjectData, timeWarmth: number, brightness: number, light: boolean): ObjAppearance {
  // Light theme — soften the architectural partitions (wall/divider/zone) so they
  // read as mid-grey surfaces on the daylight floor instead of heavy black bars.
  // Furniture (bar/entrance/host-stand) keeps its material identity.
  if (light && o.kind !== 'BAR' && o.kind !== 'ENTRANCE' && o.kind !== 'HOST_STAND') {
    if (o.kind === 'ZONE') return {
      bg: 'rgba(0,0,0,0.035)', backgroundImage: undefined,
      border: '1px solid rgba(0,0,0,0.06)', borderRadius: 12, boxShadow: undefined,
      labelColor: 'rgb(var(--iron-text))', labelSize: 10, labelWeight: 400, labelOpacity: 0.45,
      labelLetterSpacing: '0.10em', labelTransform: 'uppercase',
    };
    if (o.kind === 'DIVIDER') {
      const v = inferObjVariant(o);
      const tint = v === 'GLASS' ? '120,150,210' : v === 'GREENERY' ? '90,140,70' : '128,134,128';
      return {
        bg: `rgba(${tint},0.32)`,
        backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(0,0,0,0.05) 100%)',
        border: `1px solid rgba(${tint},0.55)`,
        borderRadius: v === 'GREENERY' ? 4 : v === 'LOW' ? 2 : 3,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 5px rgba(0,0,0,0.12)',
        labelColor: 'rgb(var(--iron-text))', labelSize: 10, labelWeight: 400, labelOpacity: 0.72,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
    }
    // WALL + any unrecognised kind — solid mid-grey partition
    return {
      bg: 'rgba(150,156,150,0.95)',
      backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(0,0,0,0.10) 100%)',
      border: '1.5px solid rgba(116,122,116,0.62)', borderRadius: 3,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 2px 7px rgba(0,0,0,0.14)',
      labelColor: 'rgb(var(--iron-text))', labelSize: 10, labelWeight: 400, labelOpacity: 0.8,
      labelLetterSpacing: undefined, labelTransform: undefined,
    };
  }
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
        border: '1px solid rgba(66,68,80,0.42)',
        borderRadius: 3,
        boxShadow: '0 1px 8px rgba(0,0,0,0.32), inset 1px 0 0 rgba(255,255,255,0.04), inset -1px 0 0 rgba(0,0,0,0.16)',
        labelColor: 'rgb(var(--iron-text))',
        labelSize: 10, labelWeight: 400, labelOpacity: 0.80,
        labelLetterSpacing: undefined, labelTransform: undefined,
      };
    }
    case 'ZONE':
      return {
        bg: `rgba(18,22,16,${(0.28 + (1 - brightness) * 0.10).toFixed(2)})`,
        backgroundImage: 'radial-gradient(ellipse 75% 65% at 50% 42%, rgba(255,240,210,0.030) 0%, rgba(255,220,160,0.012) 58%, transparent 82%)',
        border: '1px solid rgba(44,54,40,0.28)',
        borderRadius: 12,
        boxShadow: 'inset 0 0 14px rgba(0,0,0,0.14)',
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

// 4 statuses only: green=available, blue=reserved, orange=occupied, red=overdue
const STATUS_BG_DARK: Record<string, string> = {
  AVAILABLE:     '#8E9D7F',
  OCCUPIED:      'rgba(253,224,195,0.97)',  // peach/orange — יושב
  RESERVED_SOON: 'rgba(214,232,253,0.97)',  // same blue as RESERVED — glow is the signal
  RESERVED:      'rgba(214,232,253,0.97)',  // light blue — תפוס
  BLOCKED:       'rgba(220,38,38,0.14)',
};
const STATUS_BG_LIGHT: Record<string, string> = {
  AVAILABLE:     '#8E9D7F',
  OCCUPIED:      'rgba(253,224,195,0.97)',
  RESERVED_SOON: 'rgba(214,232,253,0.97)',  // same blue as RESERVED — glow is the signal
  RESERVED:      'rgba(214,232,253,0.97)',
  BLOCKED:       'rgba(254,226,226,0.92)',
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
  // Table pick mode (Tabit-style map selection from drawer)
  pickMode?: boolean;
  pickIds?: string[];
  pickSuggestions?: BackendTableSuggestion[];
  onPickDone?: (ids: string[]) => void;
  onPickCancel?: () => void;
  onPickSelectionChange?: (ids: string[]) => void;
  pickAction?: 'seat' | 'move' | 'change-table' | 'combine' | 'new-reservation' | 'reallocate';
  pickLockIds?: string[];  // tables fixed in selection — cannot be toggled off
  pickInitialSelection?: string[];  // tables pre-selected when pick mode activates
  pickGuestName?: string;
  // Walk-in pick: future-reserved tables are amber/selectable; occupied tables stay hard-blocked.
  pickWalkInMode?: boolean;
  // Planning mode: board time differs from wall-clock (time travel or new-res form).
  // When true, all table visuals are computed from boardMinutes, not liveStatus.
  inPlanningMode?: boolean;
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
  // Spatial breathing — floor recenter when the right drawer closes
  drawerOpen?: boolean;
  // Right-click quick actions
  onContextMenuSeat?: (res: Reservation) => void;
  onContextMenuComplete?: (res: Reservation) => void;
  onContextMenuMove?: (res: Reservation) => void;
  onContextMenuOpenDetails?: (res: Reservation) => void;
  onContextMenuArrive?: (res: Reservation) => void;
  onContextMenuSwap?: (res: Reservation) => void;
  onContextMenuReturnToList?: (res: Reservation) => void;
  onContextMenuAttachTable?: (res: Reservation, tableId: string) => void;
  onContextMenuDetachTable?: (res: Reservation, tableId: string) => void;
  onQuickSeat?: (table: FloorTable, existingRes: Reservation) => void;
  // Currently active reservation in the GuestDrawer — used to show recovery
  // actions ("שבץ מחדש") when the drawer holds a displaced/reorganized reservation.
  activeDrawerRes?: Reservation | null;
  inFlightIds?: ReadonlySet<string>;
  // Table-first seating: right-click an AVAILABLE table to seat a waiting/arrived guest
  eligibleGuests?: TableFirstGuest[];
  onTableFirstSeat?: (table: FloorTable, guest: TableFirstGuest) => void;
  // Walk-in from floor: right-click an available table → open walk-in drawer with table pre-selected
  onWalkInHere?: (tableId: string, combinedIds: string[]) => void;
  // Swap mode — enter by right-clicking a seated table and choosing "Swap table"
  swapMode?: boolean;
  swapSourceId?: string | null;
  onSwapTargetPick?: (res: Reservation) => void;
  onSwapCancel?: () => void;
  onContextMenuCombineRes?: (res: Reservation) => void;
}

const CANVAS_W = 1500;
const CANVAS_H = 800;
// Absolute CSS zoom multipliers applied to the fixed CANVAS_W×CANVAS_H content div.
// Canvas is always rendered at 100% scale. Map zoom redesign is a future dedicated phase.

function tableRadius(shape: string): string {
  if (shape === 'ROUND' || shape === 'OVAL') return '9999px';
  if (shape === 'BOOTH') return '3px 3px 22px 22px';  // tight back rail, deeper seat arc
  return '12px';  // softer premium corners — hospitality furniture, not a UI button
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
  pickMode = false, pickIds = [], pickSuggestions = [], onPickDone, onPickCancel, onPickSelectionChange, pickAction, pickGuestName,
  pickLockIds = [], pickInitialSelection,
  waitlistAssignEntry = null, waitlistAssignTableId = null,
  onWaitlistTablePick, onWaitlistAssignCancel, onWaitlistConfirmSeat,
  reorganizeMode = false, onReorganizeTableClick,
  hoveredResId,
  drawerOpen: _drawerOpen = false,
  onContextMenuSeat,
  onContextMenuComplete,
  onContextMenuMove,
  onContextMenuOpenDetails,
  onContextMenuArrive,
  onContextMenuSwap,
  onContextMenuReturnToList,
  onContextMenuAttachTable,
  onContextMenuDetachTable,
  onQuickSeat,
  activeDrawerRes = null,
  inFlightIds,
  eligibleGuests = [],
  onTableFirstSeat,
  onWalkInHere,
  swapMode = false,
  swapSourceId = null,
  onSwapTargetPick,
  onSwapCancel,
  onContextMenuCombineRes,
  inPlanningMode = false,
}: Props) {
  const T = useT();
  const { locale } = useLocale();
  const { warmth: timeWarmth, brightness } = useAtmosphere();

  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [lockedWarning,    setLockedWarning]    = useState<FloorTable | null>(null);
  const [softHoldWarning,  setSoftHoldWarning]  = useState<{ table: FloorTable; entry: WaitlistEntry } | null>(null);
  const [ctxMenu,          setCtxMenu]          = useState<{ x: number; y: number; table: FloorTable; drawerRes: Reservation | null } | null>(null);
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
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const baseInitRef = useRef(false); // prevents re-calibration after first fit

  // Map-only zoom — scales just the floor canvas (independent of the global UI zoom).
  const MAP_ZOOM_MIN = 0.6, MAP_ZOOM_MAX = 1.4, MAP_ZOOM_STEP = 0.1;
  const [mapZoom, setMapZoom] = useState(1);
  const mapZoomRef = useRef(1);
  mapZoomRef.current = mapZoom;
  const clampZoom = (z: number) => Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, +z.toFixed(3)));
  const zoomMap = (dir: -1 | 0 | 1) =>
    setMapZoom(z => dir === 0 ? 1 : clampZoom(z + dir * MAP_ZOOM_STEP));

  // Spatial calibration — one-shot on first load with positioned tables.
  // Scrolls to center the table cluster. Canvas is always at 100% scale.
  // After init: baseInitRef blocks re-calibration so spatial memory stays stable.
  useLayoutEffect(() => {
    if (baseInitRef.current) return;
    const placed = tables.filter(t => t.posX > 5 && t.posY > 5);
    if (placed.length === 0) return;
    const container = canvasScrollRef.current;
    if (!container || container.clientWidth < 100) return;

    baseInitRef.current = true;

    const minX = Math.min(...placed.map(t => t.posX));
    const maxX = Math.max(...placed.map(t => t.posX + t.width));
    const minY = Math.min(...placed.map(t => t.posY));
    const maxY = Math.max(...placed.map(t => t.posY + t.height));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setTimeout(() => {
      const c = canvasScrollRef.current;
      if (!c) return;
      c.scrollLeft = Math.max(0, cx - c.clientWidth  / 2);
      c.scrollTop  = Math.max(0, cy - c.clientHeight / 2);
    }, 0);
  // tables.length as dep: re-evaluates only when count changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.length]);

  // Container resize — clamps scroll when the viewport expands (e.g. panel collapse)
  // so the host never sees empty space beyond the canvas edge.
  useEffect(() => {
    const container = canvasScrollRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const maxL = Math.max(0, CANVAS_W - container.clientWidth);
      const maxT = Math.max(0, CANVAS_H - container.clientHeight);
      if (container.scrollLeft > maxL) container.scrollLeft = maxL;
      if (container.scrollTop  > maxT) container.scrollTop  = maxT;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Pinch / wheel zoom — scales ONLY the floor map (not the whole app).
  // Attached via a callback ref so the listeners bind every time the canvas
  // mounts (the canvas only renders after table data loads / on view switch).
  // Non-passive listeners so preventDefault stops the browser's own page zoom.
  const detachCanvasZoom = useRef<(() => void) | null>(null);
  const canvasRefCb = useCallback((el: HTMLDivElement | null) => {
    detachCanvasZoom.current?.();
    detachCanvasZoom.current = null;
    canvasScrollRef.current = el;
    if (!el) return;

    const distance = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let startDist = 0, startZoom = 1, pinching = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinching = true;
        startDist = distance(e.touches);
        startZoom = mapZoomRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinching && e.touches.length === 2) {
        e.preventDefault();
        const ratio = distance(e.touches) / (startDist || 1);
        setMapZoom(clampZoom(startZoom * ratio));
      }
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinching = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1; // wheel up → zoom in
      setMapZoom(clampZoom(mapZoomRef.current + dir * MAP_ZOOM_STEP));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    detachCanvasZoom.current = () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Close context menu on Esc or scroll
  useEffect(() => {
    if (!ctxMenu) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCtxMenu(null); }
    function onScroll() { setCtxMenu(null); }
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true); };
  }, [ctxMenu]);

  // Cancel pick mode on Esc
  useEffect(() => {
    if (!pickMode) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onPickCancel?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickMode, onPickCancel]);

  // Cancel swap mode on Esc
  useEffect(() => {
    if (!swapMode) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onSwapCancel?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swapMode, swapSourceId, onSwapCancel]);

  // Force floor view and sync selection when entering pick mode.
  // Move mode starts with empty selection — the host must explicitly choose a new table.
  // Combine mode seeds from pickInitialSelection (existing secondary tables).
  useEffect(() => {
    if (pickMode) {
      setView('floor');
      if (pickInitialSelection && pickInitialSelection.length > 0) {
        setPickSelection(pickInitialSelection);
      } else {
        setPickSelection(pickAction === 'move' ? [] : pickIds);
      }
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
      const cx = (e.clientX - rect.left + container.scrollLeft) ;
      const cy = (e.clientY - rect.top + container.scrollTop) ;
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
        const cx = (e.clientX - rect.left + container.scrollLeft) ;
        const cy = (e.clientY - rect.top + container.scrollTop) ;
        const { cx: sx, cy: sy } = dragStartRef.current;
        const fr = {
          x: Math.min(sx, cx), y: Math.min(sy, cy),
          w: Math.abs(cx - sx), h: Math.abs(cy - sy),
        };
        if (fr.w > 8 && fr.h > 8) {
          const newIds = tables.filter(t => {
            if (!t.isActive) return false;
            if (pickAction === 'move' && pickIds.includes(t.id)) return false;
            const sug = pickSuggestions.find(s => s.tableId === t.id);
            if (sug) {
              const isTableBlocked = sug.reasons.some(r => r.code === 'TABLE_BLOCKED');
              const isOccupiedNow  = sug.reasons.some(r => r.code === 'CONFLICT' && r.occupied);
              if (isTableBlocked || isOccupiedNow) return false;
            }
            return (
              t.posX < fr.x + fr.w && t.posX + t.width  > fr.x &&
              t.posY < fr.y + fr.h && t.posY + t.height > fr.y
            );
          }).map(t => t.id);
          setPickSelection(newIds);
          onPickSelectionChange?.(newIds);
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
    if (!sug) {
      return null;
    }
    // Only genuine conflicts/locks are hard-unavailable; capacity mismatches (TOO_SMALL) are advisory.
    if (sug.reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED')) {
      const isTableBlocked = sug.reasons.some(r => r.code === 'TABLE_BLOCKED');
      const isOccupiedNow  = sug.reasons.some(r => r.code === 'CONFLICT' && r.occupied);
      const result = (!isTableBlocked && !isOccupiedNow) ? 'tight' : 'unavailable';
      // Future-reserved tables are selectable (tight) in all pick modes — backend reorganize modal handles conflicts.
      // Only occupied-now and locked tables stay hard-unavailable.
      return result;
    }
    const result = sug.status === 'blocked' ? 'tight' : sug.status as PickStatus;
    return result;
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
          <span className="text-lg opacity-60 text-status-danger">!</span>
        </div>
        <p className="text-sm text-status-danger">{T.floorBoard.errorTitle}</p>
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
    // Waitlist assignment mode: host manual pick takes priority over system suggestions.
    // Hard-block only physically occupied (OCCUPIED/STALE_OCCUPIED), admin-blocked
    // (BLOCKED), or locked tables. Future-reserved tables (RESERVED/RESERVED_SOON)
    // pass through — the backend returns TABLE_HAS_FUTURE_RESERVATIONS and the
    // reorganize modal handles the decision.
    if (waitlistAssignEntry) {
      const isHardBlocked =
        t.liveStatus === 'OCCUPIED' ||
        t.liveStatus === 'STALE_OCCUPIED' ||
        t.liveStatus === 'BLOCKED' ||
        t.locked;
      if (isHardBlocked) {
        const wid = t.id;
        setWlPickWarn(wid);
        setTimeout(() => setWlPickWarn(w => (w === wid ? null : w)), 2500);
      } else {
        setWlPickWarn(null);
        onWaitlistTablePick?.(t.id);
      }
      return;
    }
    // Swap mode: clicking any table that has an assigned active reservation picks it as the swap target
    if (swapMode) {
      const res = t.currentReservation ?? t.upcomingReservations.find(
        r => !!r.tableId && (r.status === 'SEATED' || r.status === 'PENDING' || r.status === 'CONFIRMED')
      ) ?? null;
      const isSource = res?.id === swapSourceId;
      const eligible = !!res && !isSource && !!res.tableId;
      if (eligible) {
        onSwapTargetPick?.(res!);
      } else if (isSource) {
        onSwapCancel?.();
      }
      return;
    }
    // Pick mode takes priority: a specific in-progress pick overrides reorganize mode.
    if (pickMode) {
      const ps = getPickStatus(t);
      if (ps === 'current') {
        setPickCurrentWarn(true);
        setTimeout(() => setPickCurrentWarn(false), 2500);
        return;
      }
      // change-table (CreateDrawer): auto-confirm on click — no bottom bar needed.
      if (pickAction === 'change-table') {
        setPickSelection([t.id]);
        onPickSelectionChange?.([t.id]);
        onPickDone?.([t.id]);
        return;
      }
      // Lock check: primary table in combine mode cannot be deselected
      if (pickLockIds.includes(t.id)) {
        setPickCurrentWarn(true);
        setTimeout(() => setPickCurrentWarn(false), 2000);
        return;
      }
      // Combine / reallocate: tables occupied by a different reservation are blocked when ADDING.
      // Already-selected tables (pre-existing secondaries) can always be deselected.
      if ((pickAction === 'combine' || pickAction === 'reallocate') && !pickSelection.includes(t.id)) {
        const hasOtherRes = !!(t.currentReservation ?? t.upcomingReservations.find(r => !!r.tableId));
        if (hasOtherRes || t.locked) return;
      }
      // Toggle multi-select for seat and move: first click selects, second deselects.
      // First selected table = tableId (primary), rest = combinedTableIds.
      const newSel = pickSelection.includes(t.id)
        ? pickSelection.filter(id => id !== t.id)
        : [...pickSelection, t.id];
      setPickSelection(newSel);
      onPickSelectionChange?.(newSel);
      return;
    }
    // Reorganize mode: any table click is forwarded to the manager's lift flow
    if (reorganizeMode) {
      onReorganizeTableClick?.(t);
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
    const x = Math.min(e.clientX, window.innerWidth - 168);
    const y = Math.min(e.clientY, window.innerHeight - 190);
    setCtxMenu({ x, y, table: t, drawerRes: activeDrawerRes });
  }

  // ── Turn data ─────────────────────────────────────────────────────────────────
  // Only show turns within the operational horizon — far-future reservations
  // (e.g. 19:30 when board time is 13:00) must not appear in the stack.
  const TURN_HORIZON_MINUTES = 90;
  const nowMinutes = nowTime
    ? (() => { const [h, m] = nowTime.split(':').map(Number); return h * 60 + m; })()
    : null;
  const turnData = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (!r.tableId || !['PENDING', 'CONFIRMED'].includes(r.status)) continue;
    const norm = normalizeTime(r.time);
    if (nowTime && norm < nowTime) continue;
    if (nowMinutes !== null) {
      const [rh, rm] = norm.split(':').map(Number);
      if (rh * 60 + rm - nowMinutes > TURN_HORIZON_MINUTES) continue;
    }
    const arr = turnData.get(r.tableId) ?? [];
    arr.push(r);
    turnData.set(r.tableId, arr);
  }
  for (const arr of turnData.values()) arr.sort((a, b) => a.time.localeCompare(b.time));

  // Daily schedule strip — all PENDING/CONFIRMED reservations for the selected day,
  // no time-horizon cap. Used for the compact pill row under each table on the canvas.
  const allDayTurnData = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (!r.tableId || !['PENDING', 'CONFIRMED'].includes(r.status)) continue;
    // Index under the primary table AND every combined (secondary) table, so a combined
    // booking shows on ALL of its tables — mirrors the backend floor-state indexing.
    // Without this, secondary tables had no boardActiveRes → treated as far-future →
    // the guest label was suppressed and the table looked free (phantom double-booking).
    for (const tid of [r.tableId, ...(r.combinedTableIds ?? [])]) {
      const arr = allDayTurnData.get(tid) ?? [];
      arr.push(r);
      allDayTurnData.set(tid, arr);
    }
  }
  for (const arr of allDayTurnData.values()) arr.sort((a, b) => a.time.localeCompare(b.time));

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
    const mr = t.currentReservation.minutesRemaining;
    return mr > 0 && mr <= 15;
  }).length : 0;

  // Peripheral quieting: when the room is under pressure (waitlist + no room),
  // available tables gently recede so active zones emerge without any explicit signal.
  const underPressure = waitlist.length > 0 && available <= 2;
  const quietIdle = underPressure && !pickMode && !waitlistAssignEntry && !reorganizeMode;

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

      {/* Swap mode banner */}
      {swapMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-violet-900/20 border-b border-violet-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
          <span className="text-violet-300 text-xs font-medium flex-1">{T.floorBoard.swapModeHint}</span>
          <button type="button" onClick={onSwapCancel} className="text-violet-300/70 text-xs hover:text-violet-200 transition-colors shrink-0 touch-manipulation px-1 py-1">
            {T.floorBoard.swapModeCancel}
          </button>
        </div>
      )}

      {/* Pick mode banner */}
      {pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-blue-900/20 border-b border-status-reserved/20">
          <span className="w-1.5 h-1.5 rounded-full bg-status-reserved animate-pulse shrink-0" />
          <span className="text-status-reserved text-xs font-medium">
            {pickAction === 'move' && pickGuestName
              ? T.floorBoard.pickModeMoveHint(pickGuestName)
              : pickAction === 'combine'
              ? T.floorBoard.pickModeCombineHint
              : pickAction === 'reallocate'
              ? T.floorBoard.pickModeReallocateHint
              : pickAction === 'new-reservation'
              ? T.floorBoard.pickModeNewResHint
              : T.floorBoard.pickModeHint}
          </span>
        </div>
      )}

      {/* Reorganize mode banner */}
      {reorganizeMode && !pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-900/20 border-b border-status-warning/20">
          <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse shrink-0" />
          <span className="text-status-warning text-xs font-medium flex-1">
            {T.floorBoard.reorganizeBanner}
          </span>
        </div>
      )}

      {/* Waitlist assignment mode banner */}
      {waitlistAssignEntry && !pickMode && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-indigo-900/20 border-b border-status-info/20">
          <span className="w-1.5 h-1.5 rounded-full bg-status-info animate-pulse shrink-0" />
          <span className="text-status-info text-xs font-medium flex-1">
            {T.waitlistAssign.chooseBanner(waitlistAssignEntry.guestName, waitlistAssignEntry.partySize)}
          </span>
          <button
            onClick={onWaitlistAssignCancel}
            className="text-status-info/60 hover:text-status-info text-xs transition-colors shrink-0"
          >
            {T.waitlistAssign.cancelAssign}
          </button>
        </div>
      )}

      {/* Stats + section legend */}
      <div className="ib-bar flex items-center gap-3 px-5 py-2 bg-iron-elevated shrink-0 flex-wrap" style={{ boxShadow: 'inset 0 -1px 0 rgba(255,215,130,0.15), 0 6px 24px rgba(0,0,0,0.44)' }}>
        {/* Live service cluster */}
        <div className="flex items-center gap-1.5">
          <Stat label={T.floorBoard.statSeated} value={seatedParties} color="text-iron-green-light" live />
          {reservedSoon > 0 && <Stat label={T.floorBoard.statArriving} value={reservedSoon} color="text-status-warning" live />}
          {freeingSoon > 0 && available <= 1 && <Stat label={T.floorBoard.statFreeing} value={freeingSoon} color="text-iron-green-light/50" />}
        </div>

        <div className="w-px h-5 bg-iron-border/35 shrink-0" />

        {/* Capacity cluster */}
        <div className="flex items-center gap-1.5">
          <Stat label={T.floorBoard.statReserved}  value={reserved}  color="text-status-reserved" />
          <Stat label={T.floorBoard.statAvailable} value={available} color="text-iron-muted" />
        </div>

        {positioned && sections.length > 0 && (
          <>
            <div className="w-px h-5 bg-iron-border/35 shrink-0" />
            {sections.map(sec => (
              <button
                key={sec.id}
                className="flex items-center gap-1.5 transition-opacity"
                style={{ opacity: hoveredSectionId !== null && hoveredSectionId !== sec.id ? 0.35 : 1 }}
                onMouseEnter={() => setHoveredSectionId(sec.id)}
                onMouseLeave={() => setHoveredSectionId(null)}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sec.color }} />
                <span className="text-iron-muted/75 text-[11px] font-medium">{formatSectionName(sec.name, locale)}</span>
              </button>
            ))}
          </>
        )}

        {pressureInfo && pressureInfo.level !== 'LOW' && (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${
            pressureInfo.level === 'HIGH'
              ? 'bg-red-900/20 border-status-danger/25 text-status-danger'
              : 'bg-amber-900/20 border-status-warning/25 text-status-warning'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pressureInfo.level === 'HIGH' ? 'bg-status-danger animate-pulse' : 'bg-status-warning'}`} />
            {pressureInfo.level === 'HIGH' ? T.flowControl.pressureHigh : T.flowControl.pressureMed}
            {pressureInfo.label && <span className="opacity-70"> · {pressureInfo.label}</span>}
          </div>
        )}

        <span className="ml-auto text-[11px] text-iron-muted/55 font-medium">{T.floorBoard.tableCount(dedupedTables.length)}</span>

        <div className="flex items-center bg-iron-bg/40 rounded-xl overflow-hidden divide-x divide-iron-border/20 shrink-0">
          {(['floor', 'timeline'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => !pickMode && setView(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v
                  ? 'bg-iron-green/20 text-iron-green-light'
                  : 'text-iron-muted hover:text-iron-text hover:bg-iron-bg/60'
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
          // ── Adaptive Day/Night canvas values ─────────────────────────────
          // Pace: 14s at morning, slows to ~22s at peak dinner (room feels dense and full)
          const ambDuration = (14 + timeWarmth * 4 + (1 - brightness) * 4).toFixed(1);

          return (
        <div className="flex-1 relative overflow-hidden">
        {/* Map-only zoom controls — floating, bottom-right of the floor */}
        {!pickMode && (
          <div
            dir="ltr"
            className="absolute bottom-4 right-4 z-30 flex flex-col items-stretch w-12 rounded-xl overflow-hidden bg-iron-elevated/95 border border-iron-border/60"
            style={{ boxShadow: '0 6px 22px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)' }}
          >
            <button
              onClick={() => zoomMap(1)}
              disabled={mapZoom >= MAP_ZOOM_MAX}
              title="Zoom in"
              className="py-2.5 text-2xl font-semibold text-iron-text/85 hover:text-iron-text hover:bg-iron-bg/70 disabled:opacity-30 disabled:hover:bg-transparent leading-none select-none transition-colors"
            >
              +
            </button>
            <button
              onClick={() => zoomMap(0)}
              title="Reset map zoom"
              className="py-1.5 text-[11px] font-bold tabular-nums text-iron-muted hover:text-iron-text hover:bg-iron-bg/70 border-y border-iron-border/50 select-none transition-colors"
            >
              {Math.round(mapZoom * 100)}%
            </button>
            <button
              onClick={() => zoomMap(-1)}
              disabled={mapZoom <= MAP_ZOOM_MIN}
              title="Zoom out"
              className="py-2.5 text-2xl font-semibold text-iron-text/85 hover:text-iron-text hover:bg-iron-bg/70 disabled:opacity-30 disabled:hover:bg-transparent leading-none select-none transition-colors"
            >
              −
            </button>
          </div>
        )}
        <div ref={canvasRefCb} className="absolute inset-0 overflow-auto" style={{ backgroundColor: 'var(--canvas-bg)', touchAction: 'pan-x pan-y' }}>
          <div
            onMouseDown={pickMode ? handleCanvasMouseDown : undefined}
            style={{
              position: 'relative',
              width: CANVAS_W,
              height: CANVAS_H,
              zoom: mapZoom,
              backgroundColor: 'var(--canvas-bg)',
              // Flat minimal floor — uniform dark surface, no ambient gradients/texture.
              backgroundImage: 'none',
              userSelect: pickMode ? 'none' : undefined,
            }}
          >
            {/* Architectural environment — walls, floor materials, booth backings, VIP enclosures.
                Suppressed for the flat-minimal floor look. */}
            {false && positioned && (
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
                background: 'none',
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
                  border: 'none',
                  background: 'none',
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* Floor objects — SVG-rendered kinds (PLANTER / SERVICE_LANE / LOUNGE_BOUNDARY / VIP_ENCLOSURE)
                are handled inside ArchLayer. Only HTML-renderable kinds appear here. */}
            {floorObjs.filter(o => !SVG_RENDERED_KINDS.has(o.kind)).map(o => {
              const a = getObjAppearance(o, timeWarmth, brightness, document.documentElement.getAttribute('data-theme') === 'light');
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


            {canvasTables.map(t => {
              const insight    = insights.find(i => i.tableId === t.id);
              const ineligibleForAssign = !!waitlistAssignEntry && !pickMode && (t.liveStatus !== 'AVAILABLE' || t.locked);
              const dimmed     = !pickMode && (
                (hoveredSectionId !== null && t.section?.id !== hoveredSectionId) ||
                ineligibleForAssign
              );
              const wMatch     = waitlistMatches[t.id];
              const turns      = allDayTurnData.get(t.id) ?? [];
              const extraTurns = Math.max(0, turns.length - 1);
              const turnTooltip = turns.length > 0
                ? `${t.name} · upcoming:\n${turns.map(r => `${normalizeTime(r.time)}  ${r.guestName}  ·  ${r.partySize}p`).join('\n')}`
                : undefined;
              const ps = pickMode ? getPickStatus(t) : null;
              const isWLCanvasTarget = !!waitlistAssignEntry && !pickMode && waitlistAssignTableId === t.id;
              const _canvasSwapRes = swapMode ? (
                t.currentReservation ?? t.upcomingReservations.find(
                  r => !!r.tableId && (r.status === 'SEATED' || r.status === 'PENDING' || r.status === 'CONFIRMED')
                ) ?? null
              ) : null;
              const isSwapSource = swapMode && _canvasSwapRes?.id === swapSourceId;
              const swapDimmed   = swapMode && !isSwapSource && (
                !_canvasSwapRes ||
                !_canvasSwapRes.tableId ||
                !!_canvasSwapRes.reorganizeAt
              );
              const combineDimmed = pickMode && (pickAction === 'combine' || pickAction === 'reallocate') &&
                !pickLockIds.includes(t.id) &&
                !pickSelection.includes(t.id) &&
                (t.locked || !!(t.currentReservation ?? t.upcomingReservations.find(r => !!r.tableId)));
              return (
                <MapTable
                  key={t.id}
                  table={t}
                  selected={!pickMode && !waitlistAssignEntry && isSelected(t)}
                  combinedSelected={false}
                  dimmed={dimmed || swapDimmed || combineDimmed}
                  bestSuggestion={!pickMode && !isSelected(t) && !!waitlistAssignEntry && t.id === bestSuggestionTableId}
                  waitlistAssignTarget={isWLCanvasTarget}
                  softHold={!pickMode && !!waitlistAssignEntry ? softHoldMap[t.id] : undefined}
                  onClick={() => handleClick(t)}
                  onContextMenu={e => !pickMode && !swapMode && handleContextMenu(e, t)}
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
                  extraTurns={extraTurns}
                  turns={turns}
                  turnTooltip={turnTooltip}
                  pickMode={pickMode}
                  pickSelected={pickMode && pickSelection.includes(t.id)}
                  pickStatus={ps}
                  inNewResPick={false}
                  inPlanningMode={inPlanningMode}
                  swapSource={isSwapSource || (pickMode && pickAction === 'combine' && pickLockIds.includes(t.id))}
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
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-iron-muted/85">
                  {formatSectionName(group.name, locale)}
                </h3>
                <div className="flex-1 h-px bg-iron-border/50" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                {group.tables.map(t => {
                  const insight    = insights.find(i => i.tableId === t.id);
                  const wMatch     = waitlistMatches[t.id];
                  const turns      = allDayTurnData.get(t.id) ?? [];
                  const extraTurns = Math.max(0, turns.length - 1);
                  const turnTooltip = turns.length > 0
                    ? `${t.name} · upcoming:\n${turns.map(r => `${normalizeTime(r.time)}  ${r.guestName}  ·  ${r.partySize}p`).join('\n')}`
                    : undefined;
                  // Planning mode: find the reservation whose window covers the board time.
                  // Applies both when time-travelling via TopBar and during new-res planning.
                  const listBoardMinutes = inPlanningMode && nowTime
                    ? (() => { const [h, m] = nowTime.split(':').map(Number); return h * 60 + m; })()
                    : null;
                  const planningActiveRes = listBoardMinutes !== null
                    ? (turns.find(r => {
                        if (!r.time) return false;
                        const [rh, rm] = r.time.split(':').map(Number);
                        const start = rh * 60 + rm;
                        return listBoardMinutes >= start && listBoardMinutes < start + (r.duration ?? 90);
                      }) ?? null)
                    : null;
                  const isPickSelected = pickMode && pickSelection.includes(t.id);
                  const isWLTarget = !!waitlistAssignEntry && !pickMode && waitlistAssignTableId === t.id;
                  const ineligibleForAssign = !!waitlistAssignEntry && !pickMode && (t.liveStatus !== 'AVAILABLE' || t.locked);
                  const _gridSwapRes = swapMode ? (
                    t.currentReservation ?? t.upcomingReservations.find(
                      r => !!r.tableId && (r.status === 'SEATED' || r.status === 'PENDING' || r.status === 'CONFIRMED')
                    ) ?? null
                  ) : null;
                  const isSwapSrc = swapMode && _gridSwapRes?.id === swapSourceId;
                  const gridSwapDimmed = swapMode && !isSwapSrc && (
                    !_gridSwapRes ||
                    !_gridSwapRes.tableId ||
                    (_gridSwapRes.combinedTableIds ?? []).length > 0 ||
                    !!_gridSwapRes.reorganizeAt
                  );
                  const gridCombineDimmed = pickMode && (pickAction === 'combine' || pickAction === 'reallocate') &&
                    !pickLockIds.includes(t.id) &&
                    !pickSelection.includes(t.id) &&
                    (t.locked || !!(t.currentReservation ?? t.upcomingReservations.find(r => !!r.tableId)));
                  return (
                    <div
                      key={t.id}
                      className={
                        isWLTarget
                          ? 'ring-2 ring-status-info/60 rounded-lg'
                          : wlPickWarn === t.id
                          ? 'ring-2 ring-status-danger/60 rounded-lg'
                          : isSwapSrc || (pickMode && pickAction === 'combine' && pickLockIds.includes(t.id))
                          ? 'ring-2 ring-violet-500/60 rounded-lg'
                          : isPickSelected
                          ? 'ring-2 ring-status-reserved/50 rounded-lg'
                          : ''
                      }
                      style={(ineligibleForAssign || gridSwapDimmed || gridCombineDimmed) ? { opacity: 0.3 } : undefined}
                    >
                      <TableCard
                        table={t}
                        selected={!pickMode && !waitlistAssignEntry && isSelected(t)}
                        isBestSuggestion={!pickMode && !isSelected(t) && !!waitlistAssignEntry && t.id === bestSuggestionTableId}
                        softHold={!pickMode && !!waitlistAssignEntry ? softHoldMap[t.id] : undefined}
                        onClick={() => handleClick(t)}
                        onContextMenu={e => !pickMode && !swapMode && handleContextMenu(e, t)}
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
                        inPlanningMode={inPlanningMode}
                        planningActiveRes={planningActiveRes}
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
      {ctxMenu && !pickMode && !swapMode && (() => {
        const t = ctxMenu.table;
        const currentRes = t.currentReservation;
        const isOccupied = t.liveStatus === 'OCCUPIED' && !!currentRes;
        const seatableRes = t.upcomingReservations.find(r =>
          r.status === 'PENDING' || r.status === 'CONFIRMED'
        ) ?? (
          (currentRes?.status === 'PENDING' || currentRes?.status === 'CONFIRMED') ? currentRes : null
        );

        // True when the GuestDrawer holds a displaced/reorganized reservation
        // that hasn't been re-assigned yet. Switches the primary context action
        // from the normal "הושב" to the recovery "שבץ מחדש".
        const isDisplacedActive = !!(
          activeDrawerRes &&
          !activeDrawerRes.tableId &&
          (activeDrawerRes.reorganizeAt || activeDrawerRes.returnedToListAt) &&
          (activeDrawerRes.status === 'PENDING' || activeDrawerRes.status === 'CONFIRMED')
        );
        const ctxNextRes         = t.upcomingReservations[0];
        const isCtxQuietReserved = t.liveStatus === 'RESERVED' && (ctxNextRes?.minutesUntil ?? 0) >= 300;
        // Swap-eligible reservation: SEATED (currentReservation) or any upcoming
        // PENDING/CONFIRMED reservation that has a table already assigned.
        // RESERVED and RESERVED_SOON tables hold their reservation in upcomingReservations.
        const swapRes = currentRes ?? t.upcomingReservations.find(
          r => !!r.tableId && (r.status === 'PENDING' || r.status === 'CONFIRMED')
        ) ?? null;
        const canSeat       = !!onContextMenuSeat       && !!seatableRes && !t.locked && isToday && !isOccupied && !inFlightIds?.has(seatableRes.id) && !isDisplacedActive && !isCtxQuietReserved;
        const canArrive     = !!onContextMenuArrive      && !!seatableRes && !seatableRes.isArrived && !t.locked && isToday && !isOccupied && !inFlightIds?.has(seatableRes.id);
        const canComplete        = !!onContextMenuComplete       && isOccupied && !t.locked && !inFlightIds?.has(currentRes?.id ?? '');
        const canMove            = !!onContextMenuMove           && isOccupied && !t.locked && isToday && !inFlightIds?.has(currentRes?.id ?? '');
        const canReturnToList    = !!onContextMenuReturnToList   && isOccupied && !t.locked && isToday && !inFlightIds?.has(currentRes?.id ?? '');
        const canSwap       = !!onContextMenuSwap && !!swapRes && !t.locked && isToday
                                && !inFlightIds?.has(swapRes.id)
                                && !swapRes.reorganizeAt;
        const canOpenDetails = !!onContextMenuOpenDetails && (isOccupied || !!seatableRes) && !t.locked;
        const canRecover    = !!onContextMenuSeat && isDisplacedActive && !t.locked && !isOccupied && isToday && !inFlightIds?.has(activeDrawerRes!.id);
        // Show table-first seating on AVAILABLE and RESERVED/RESERVED_SOON tables.
        // OCCUPIED and locked tables are still blocked. Backend handles future-reservation conflicts via reorganize modal.
        const canTableFirstSeat = !!onTableFirstSeat && !isOccupied && !t.locked && isToday && eligibleGuests.length > 0;
        const canWalkInHere = !!onWalkInHere && !isOccupied && !t.locked && isToday;
        // Attach/detach: use the snapshot of activeDrawerRes captured at right-click time
        // (ctxMenu.drawerRes) so prop changes after the click don't affect the menu.
        const attachTarget = ctxMenu.drawerRes?.tableId ? ctxMenu.drawerRes : null;
        const isAlreadyCombined = !!(attachTarget && attachTarget.combinedTableIds?.includes(t.id));
        const isPrimaryTable    = !!(attachTarget && attachTarget.tableId === t.id);
        const canAttach = !!onContextMenuAttachTable && !!attachTarget && !isPrimaryTable && !isAlreadyCombined && !t.locked;
        const canDetach = !!onContextMenuDetachTable && !!attachTarget && isAlreadyCombined && !t.locked;
        const canQuickSeat = !!onQuickSeat && !!seatableRes && !isOccupied && !t.locked && isToday;
        const canCombineRes = !!onContextMenuCombineRes && !!swapRes && !t.locked;
        const hasActions    = canSeat || canRecover || canArrive || canComplete || canMove || canReturnToList || canSwap || canOpenDetails || canTableFirstSeat || canWalkInHere || canAttach || canDetach || canQuickSeat || canCombineRes;

        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
            <div
              className="fixed z-50 bg-iron-elevated border border-iron-border/55 rounded-xl py-0.5 min-w-[10rem] max-w-[13rem]"
              style={{ left: ctxMenu.x, top: ctxMenu.y, boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.32)' }}
            >
              <div className="px-2.5 py-1 border-b border-iron-border/50 mb-0.5">
                <span className="text-iron-muted text-[10px] font-semibold uppercase tracking-wider">{t.name}</span>
              </div>

              {/* Primary operational actions */}
              {canRecover && (
                <button
                  onClick={() => { onContextMenuSeat!({ ...activeDrawerRes!, tableId: t.id }); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-status-warning hover:bg-status-warning/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxReassign}
                </button>
              )}
              {canSeat && (
                <button
                  onClick={() => { onContextMenuSeat!({ ...seatableRes!, tableId: t.id }); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-iron-green-light hover:bg-iron-green/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxSeat}
                </button>
              )}
              {canArrive && (
                <button
                  onClick={() => { onContextMenuArrive!(seatableRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-status-reserved hover:bg-status-reserved/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxMarkArrived}
                </button>
              )}

              {/* Table-first seating — available table, no pre-scheduled guest */}
              {canTableFirstSeat && (
                <>
                  <div className="px-2.5 pt-1.5 pb-0.5 mt-0.5 border-t border-iron-border/40">
                    <span className="text-iron-muted text-[9px] font-semibold uppercase tracking-wider">
                      {T.floorBoard.ctxSeatGuestHere}
                    </span>
                  </div>
                  {eligibleGuests.slice(0, 3).map(guest => {
                    const guestId  = guest.kind === 'reservation' ? guest.data.id : `wl-${guest.data.id}`;
                    const name     = guest.data.guestName;
                    const size     = guest.data.partySize;
                    const busy     = !!(inFlightIds?.has(guest.data.id));
                    const label    = guest.kind === 'waitlist'
                      ? T.floorBoard.ctxGuestWaitlist
                      : guest.data.isArrived
                        ? T.floorBoard.ctxGuestArrived
                        : T.floorBoard.ctxGuestConfirmed;
                    const labelCls = guest.kind === 'waitlist'
                      ? 'text-status-info'
                      : guest.data.isArrived
                        ? 'text-iron-green-light'
                        : 'text-status-reserved';
                    return (
                      <button
                        key={guestId}
                        disabled={!!busy}
                        onClick={() => { onTableFirstSeat!(ctxMenu.table, guest); setCtxMenu(null); }}
                        className="w-full text-left px-2.5 py-1 text-xs hover:bg-iron-bg transition-colors touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span className="text-iron-text font-medium truncate">{name}</span>
                        <span className="text-iron-muted ml-1">· {size}p</span>
                        <span className={`ml-1 text-[9px] font-semibold ${labelCls}`}>{label}</span>
                      </button>
                    );
                  })}
                </>
              )}

              {canWalkInHere && (
                <button
                  onClick={() => { onWalkInHere!(t.id, []); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-status-info hover:bg-status-info/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxWalkInHere}
                </button>
              )}
              {canQuickSeat && (
                <button
                  onClick={() => { onQuickSeat!(t, seatableRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxQuickSeatHere}
                </button>
              )}

              {canComplete && (
                <button
                  onClick={() => { onContextMenuComplete!(currentRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-iron-green-light hover:bg-iron-green/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxComplete}
                </button>
              )}
              {canMove && (
                <button
                  onClick={() => { onContextMenuMove!(currentRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-status-warning hover:bg-status-warning/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxMove}
                </button>
              )}
              {canReturnToList && (
                <button
                  onClick={() => { onContextMenuReturnToList!(currentRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxReturnToList}
                </button>
              )}
              {canSwap && (
                <button
                  onClick={() => { onContextMenuSwap!(swapRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-500/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxSwap}
                </button>
              )}
              {canCombineRes && (
                <button
                  onClick={() => { onContextMenuCombineRes!(swapRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxCombineRes}
                </button>
              )}
              {canOpenDetails && (
                <button
                  onClick={() => { onContextMenuOpenDetails!(isOccupied ? currentRes! : seatableRes!); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-iron-text hover:bg-iron-bg transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxOpenDetails}
                </button>
              )}

              {canAttach && (
                <button
                  onClick={() => { onContextMenuAttachTable!(attachTarget!, t.id); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxAttachTable(attachTarget!.guestName)}
                </button>
              )}
              {canDetach && (
                <button
                  onClick={() => { onContextMenuDetachTable!(attachTarget!, t.id); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors touch-manipulation"
                >
                  {T.floorBoard.ctxDetachTable}
                </button>
              )}

              {/* Divider before lock/unlock */}
              {hasActions && !t.locked && <div className="border-t border-iron-border/40 my-0.5" />}

              {t.locked ? (
                <button
                  onClick={() => { onUnlockTable?.(t.id); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-iron-text hover:bg-iron-bg transition-colors touch-manipulation"
                >
                  {T.floorBoard.unlockTable}
                </button>
              ) : (
                <button
                  onClick={() => { onLockTable?.(t); setCtxMenu(null); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-iron-muted hover:bg-iron-bg hover:text-iron-text transition-colors touch-manipulation"
                >
                  {T.floorBoard.lockTable}
                </button>
              )}
            </div>
          </>
        );
      })()}

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
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/25 text-status-warning hover:bg-status-warning/20 transition-colors"
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

      {/* Pick mode action bar — shown for move, combine, and new-reservation. seat uses GuestDrawer confirmation card; change-table auto-confirms on click. */}
      {pickMode && pickAction !== 'change-table' && pickAction !== 'seat' && (
        <div className="shrink-0 border-t border-status-reserved/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {pickCurrentWarn ? (
              <span className="text-status-warning text-xs font-medium">
                {pickLockIds.length > 0 ? T.floorBoard.pickModeLockWarn : T.floorBoard.pickModeCurrentTableWarn}
              </span>
            ) : pickWarn ? (
              (() => {
                const wt = tables.find(t => t.id === pickWarn);
                const reason = wt ? ` — ${T.tableStatus[wt.liveStatus] ?? ''}` : '';
                return <span className="text-status-danger text-xs font-medium">{T.floorBoard.pickModeUnavailable(wt?.name ?? pickWarn)}{reason}</span>;
              })()
            ) : pickSelection.length === 0 && pickLockIds.length === 0 ? (
              <span className="text-status-reserved text-sm">{T.floorBoard.pickModeHint}</span>
            ) : (
              <span className="text-iron-text text-sm font-semibold truncate">
                {[...pickLockIds, ...pickSelection]
                  .map(id => tables.find(t => t.id === id)?.name ?? id)
                  .join(' + ')}
                <span className="text-iron-muted font-normal text-xs ml-1.5">
                  · {T.floorBoard.pickModeSelected(pickLockIds.length + pickSelection.length)}
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
            disabled={pickAction !== 'combine' && pickSelection.length === 0}
            onClick={() => {
              if (pickAction === 'combine' || pickSelection.length > 0) onPickDone?.(pickSelection);
            }}
            className="bg-blue-600 hover:bg-status-reserved text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {T.floorBoard.pickModeConfirm}
          </button>
        </div>
      )}

      {/* Waitlist assign confirmation bar */}
      {waitlistAssignEntry && !pickMode && (
        <div className="shrink-0 border-t border-status-info/30 bg-iron-card/90 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {wlPickWarn ? (
              // Rejection state: amber warning + current selection shown below so host can't confuse them
              <div className="flex flex-col gap-0.5">
                <span className="text-status-warning text-sm font-semibold">
                  ⚠ {T.waitlistAssign.tableNotAvailable(tables.find(t => t.id === wlPickWarn)?.name ?? wlPickWarn)}
                </span>
                <span className="text-iron-text/70 text-xs">
                  {waitlistAssignTableId
                    ? T.waitlistAssign.currentlySelected(tables.find(t => t.id === waitlistAssignTableId)?.name ?? waitlistAssignTableId)
                    : T.waitlistAssign.chooseBanner(waitlistAssignEntry.guestName, waitlistAssignEntry.partySize)
                  }
                </span>
              </div>
            ) : waitlistAssignTableId ? (
              <span className="text-iron-text text-sm font-semibold truncate">
                {T.waitlistAssign.confirmSeat(
                  waitlistAssignEntry.guestName,
                  tables.find(t => t.id === waitlistAssignTableId)?.name ?? waitlistAssignTableId,
                )}
              </span>
            ) : (
              <span className="text-status-info text-sm">
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
            disabled={!waitlistAssignTableId}
            className="bg-iron-green/80 hover:bg-iron-green text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {T.waitlistAssign.seatNow}
          </button>
        </div>
      )}

    </div>
  );
}

function Stat({ label, value, color, live = false }: { label: string; value: number; color: string; live?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center px-2.5 py-1.5 rounded-xl bg-iron-bg/[0.28] shrink-0${live && value > 0 ? ' animate-ambient-breathe' : ''}`}
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' }}
    >
      <span className={`text-[18px] font-bold tabular-nums leading-none ${color}`}>{value}</span>
      <span className="text-iron-muted/65 text-[9px] uppercase tracking-[0.10em] font-semibold leading-none mt-0.5">{label}</span>
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
    const mr = t.currentReservation.minutesRemaining;
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
// Decorative chair silhouettes for editor/layout mode — not used in operational view.
// Exported so LayoutEditor can import and render it in the canvas overlay.
export function ChairLayer({ tables, floorObjs, dimmedTableIds, pickMode, timeWarmth, isLiveView }: {
  tables: FloorTable[];
  floorObjs: FloorObjectData[];
  dimmedTableIds: Set<string>;
  pickMode: boolean;
  timeWarmth: number;
  isLiveView: boolean;
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
        const tableDisplayStatus = (isLiveView || table.liveStatus !== 'RESERVED_SOON') ? table.liveStatus : 'RESERVED';
        const isActive     = isOccupied || table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON';
        // Per-table tier for RESERVED chairs — mirrors MapTable operational thresholds.
        const chairNextMin    = table.upcomingReservations[0]?.minutesUntil ?? 0;
        const isChairUpcoming = table.liveStatus === 'RESERVED' && chairNextMin >= 60 && chairNextMin < 120;
        const isChairCombined = (table.upcomingReservations[0]?.combinedTableIds?.length ?? 0) > 0;
        const isChairDormant  = table.liveStatus === 'RESERVED' && chairNextMin >= 120 && !isChairCombined;
        // FAR-FUTURE (60+ min): chairs rendered empty — table reads as fully available on the floor.
        const filledCount     = isActive && !isChairDormant && !isChairUpcoming ? displayCount : 0;

        // Chair fill/stroke scale with reservation proximity.
        // UPCOMING (60–120 min): subtle blue — informative but not dominant.
        // ACTIVE (<60 min): full operational emphasis.
        // DORMANT (120+ min): filledCount=0, so these colors are unused.
        const filledFill =
          isOccupied                                  ? 'rgba(22,163,74,0.75)'
          : tableDisplayStatus === 'RESERVED_SOON'  ? 'rgba(217,119,6,0.72)'
          : isChairUpcoming                          ? 'rgba(59,130,246,0.40)'   // UPCOMING: subtle blue
          : 'rgba(37,99,235,0.68)';                                               // ACTIVE: full
        const filledStroke =
          isOccupied                                  ? 'rgba(22,163,74,0.40)'
          : tableDisplayStatus === 'RESERVED_SOON'  ? 'rgba(217,119,6,0.35)'
          : isChairUpcoming                          ? 'rgba(37,99,235,0.20)'   // UPCOMING: subtle
          : 'rgba(37,99,235,0.32)';
        const emptyFill   = `rgba(180,174,168,${(0.55 * quietLevel).toFixed(2)})`;
        const emptyStroke = `rgba(160,155,150,${(0.30 * quietLevel).toFixed(2)})`;

        // Chair anatomy: a narrow backrest strip at the outer edge (away from table) +
        // seat pad body. Backrest is more opaque — it's the solid structural element.
        // Bar-seating and dots use the seat pad only (no backrest differentiation).
        const filledBack = isOccupied
          ? 'rgba(21,128,61,0.85)'
          : tableDisplayStatus === 'RESERVED_SOON'
          ? 'rgba(180,83,9,0.82)'
          : isChairUpcoming ? 'rgba(37,99,235,0.50)'   // UPCOMING: subtle
          : 'rgba(29,78,216,0.78)';
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

function MapTable({ table, selected, combinedSelected, dimmed, bestSuggestion: _bestSuggestion, softHold, onClick, onContextMenu, insight: _insight, onInsightAction: _onInsightAction, waitlistMatch: _waitlistMatch, onWaitlistAction: _onWaitlistAction, nowTime, operationalNow: _operationalNow, extraTurns: _extraTurns = 0, turns = [], turnTooltip, pickMode = false, pickSelected = false, pickStatus = null, swapSource = false, waitlistAssignTarget = false, wlPickWarn = false, quietFade: _quietFade = 0, date, hoveredResId, inNewResPick = false, inPlanningMode = false }: {
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
  swapSource?: boolean;
  waitlistAssignTarget?: boolean;
  wlPickWarn?: boolean;
  quietFade?: number;
  date?: string;
  hoveredResId?: string | null;
  inNewResPick?: boolean;
  inPlanningMode?: boolean;
}) {
  const T = useT();
  const { locale } = useLocale();
  const _isRTL = locale === 'he'; void _isRTL;
  const isDark = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme') !== 'light'
    : true;
  const STATUS_BG = isDark ? STATUS_BG_DARK : STATUS_BG_LIGHT;
  const isToday = date === undefined || date === new Date().toISOString().slice(0, 10);
  // displayStatus = liveStatus anchored to wall-clock time on the backend.
  // No board-time override: RESERVED_SOON fires only when real time is within
  // RESERVED_SOON_MINUTES of the reservation, so suppression is never needed here.
  const displayStatus = table.liveStatus;
  const nextRes = table.upcomingReservations[0] as (typeof table.upcomingReservations[0] & { minutesUntil: number }) | undefined;

  const _sectionColor = table.section?.color ?? '#3f3f46'; void _sectionColor;

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

  // Base (non-pick) colors — minutesRemaining computed first so both isOverdue and isEndingSoon can use it.
  // Use real wall-clock (Date.now()) so urgency reflects genuine operational time, not board navigation.
  const minutesRemaining = (table.liveStatus === 'OCCUPIED' && table.currentReservation)
    ? minutesUntilEnd(table.currentReservation.expectedEndTime, Date.now()) : null;
  const isOverdue = table.liveStatus === 'OCCUPIED' && (
    (table.currentReservation?.isOverdue ?? false) ||
    (minutesRemaining !== null && minutesRemaining < 0)
  );
  const overdueMinutes = isOverdue
    ? Math.max(
        table.currentReservation?.minutesOverdue ?? 0,
        minutesRemaining !== null && minutesRemaining < 0 ? Math.round(-minutesRemaining) : 0
      )
    : 0;
  const _overdueTier: 'mild' | 'warning' | 'critical' | null =
    overdueMinutes >= 45 ? 'critical' : overdueMinutes >= 15 ? 'warning' : overdueMinutes > 0 ? 'mild' : null; void _overdueTier;
  const isStaleOccupied = table.liveStatus === 'STALE_OCCUPIED';
  // endingSoon: last 10 minutes before expected release — calm amber warning, not yet critical
  const isEndingSoon = isToday && !isOverdue && minutesRemaining !== null && minutesRemaining >= 0 && minutesRemaining <= 10;
  // Stable/recession states — reduce visual weight to let urgent tables surface
  const _isLongStable = table.liveStatus === 'OCCUPIED' && !isOverdue && !isEndingSoon && minutesRemaining !== null && minutesRemaining > 45; void _isLongStable;
  const minutesUntilNext   = nextRes?.minutesUntil ?? 0;  // real-time-based from backend
  const isNextResCombined  = (nextRes?.combinedTableIds?.length ?? 0) > 0; void isNextResCombined;
  const isReservedOrSoon = table.liveStatus === 'RESERVED' || table.liveStatus === 'RESERVED_SOON';
  const _isUpcomingReserved = isReservedOrSoon && minutesUntilNext >= 60 && minutesUntilNext < 120; void _isUpcomingReserved;
  const _isDormantReserved  = isReservedOrSoon && minutesUntilNext >= 120; void _isDormantReserved;
  // boardMinutes: board-selected time as minutes-since-midnight
  const boardMinutes: number | null = nowTime
    ? (() => { const [h, m] = nowTime.split(':').map(Number); return h * 60 + m; })()
    : null;
  // boardActiveRes: the turn whose window covers boardTime (start ≤ boardTime < start+duration)
  const boardActiveRes = boardMinutes !== null
    ? turns.find(r => {
        if (!r.time) return false;
        const [rh, rm] = r.time.split(':').map(Number);
        const resStart = rh * 60 + rm;
        return boardMinutes >= resStart && boardMinutes < resStart + (r.duration ?? 90);
      })
    : undefined;
  const isBoardTimeActive = boardActiveRes !== undefined;
  // Suppress RESERVED/RESERVED_SOON styling only when boardTime is outside the STATUS-CAUSING
  // reservation's window. boardActiveRes may be a different combined-booking turn covering
  // boardTime — that must not un-suppress liveStatus styling for a distinct future reservation.
  const nextResStart = nextRes
    ? (() => { const [h, m] = nextRes.time.split(':').map(Number); return h * 60 + m; })()
    : null;
  const isNextResBoardActive = boardMinutes !== null && nextResStart !== null
    && boardMinutes >= nextResStart && boardMinutes < nextResStart + (nextRes?.duration ?? 90);
  const isFarFutureReserved = isReservedOrSoon && !isNextResBoardActive;

  // Seating opportunity — AVAILABLE table with a queued guest waiting to be seated
  const _isOpportunity = table.liveStatus === 'AVAILABLE' && !softHold && !table.locked && (!!_waitlistMatch || _insight?.type === 'SEAT_NOW'); void _isOpportunity;

  let bg = isOverdue || isStaleOccupied
    ? 'rgba(254,202,202,0.97)'   // red/pink — עבר הזמן שלו
    : (STATUS_BG[displayStatus] ?? STATUS_BG['AVAILABLE']);
  // UPCOMING/DORMANT: restore clean neutral surface — same as an empty table.
  // Only the blue border (UPCOMING) or nothing (DORMANT) carries the reservation signal.
  if (isFarFutureReserved && !softHold && !isOverdue && table.liveStatus !== 'RESERVED_SOON' && !pickMode) {
    bg = STATUS_BG['AVAILABLE'];
  }
  // Planning mode: table color must reflect availability at the board time, not wall-clock
  // liveStatus. Applies for both time-travel and new-reservation planning.
  // OCCUPIED/STALE_OCCUPIED: boardActiveRes can never cover a SEATED turn (allDayTurnData
  // excludes SEATED). So we check the SEATED reservation's own scheduled window (time+duration)
  // against boardTime — same logic as boardActiveRes but applied to currentRes directly.
  const isLiveOccupied = table.liveStatus === 'OCCUPIED' || table.liveStatus === 'STALE_OCCUPIED';
  const currentRes = table.currentReservation;
  // Does the seated reservation's scheduled window cover boardTime?
  const liveResCoversBoard: boolean = !!(isLiveOccupied && currentRes?.time && boardMinutes !== null && (() => {
    const [h, m] = currentRes!.time.split(':').map(Number);
    const start = h * 60 + m;
    return boardMinutes >= start && boardMinutes < start + (currentRes!.duration ?? 90);
  })());
  // Table is "still occupied at boardTime" only when its scheduled window actually covers it.
  // If boardTime is outside the window (e.g. 17:00 for a 14:00+90min booking) → show FREE.
  const isStillOccupiedAtBoardTime = isLiveOccupied && (boardMinutes === null || liveResCoversBoard);
  // Badge: when planning mode and table stays occupied at boardTime, show scheduled end time.
  const liveResEndLabel: string | null = (isStillOccupiedAtBoardTime && currentRes?.time && inPlanningMode)
    ? (() => {
        const [h, m] = currentRes!.time.split(':').map(Number);
        const endMin = h * 60 + m + (currentRes!.duration ?? 90);
        return `עד ${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      })()
    : null;
  if ((inNewResPick || (inPlanningMode && !pickMode)) && !boardActiveRes && !isStillOccupiedAtBoardTime) {
    bg = STATUS_BG['AVAILABLE'];
  }
  // Planning mode positive: a scheduled reservation covers boardTime → show as RESERVED (light blue).
  // Applies when the table's live status doesn't already reflect this (e.g. liveStatus=AVAILABLE
  // because the reservation is hours away by wall-clock but active at boardTime).
  if ((inNewResPick || (inPlanningMode && !pickMode)) && boardActiveRes && !isStillOccupiedAtBoardTime) {
    bg = STATUS_BG['RESERVED'];
  }

  // Fixed iron-green border on every table — status is communicated through background
  // color, badge text, and reservation labels, not through border color changes.
  const IRON_BORDER = '#435B2A';
  let borderColor = IRON_BORDER;
  let borderWidth = 1.5;
  // Selection: blue ring for selected/combined-selected, no other status-driven border.
  let boxShadow: string | undefined = selected
    ? '0 0 0 3px rgba(59,130,246,0.55), 0 0 18px rgba(59,130,246,0.12)'
    : combinedSelected
    ? '0 0 0 3px rgba(59,130,246,0.38), 0 0 16px rgba(59,130,246,0.10)'
    : undefined;
  if (selected || combinedSelected) {
    borderColor = '#3b82f6';
    borderWidth = 2;
  }

  let opacity = dimmed ? 0.25 : table.locked ? 0.55 : 1;
  let cursor = 'pointer';

  // BLOCKED: intentional absence — near-ghost, clearly not in service
  if (table.liveStatus === 'BLOCKED' && !selected && !combinedSelected) {
    opacity = Math.min(opacity, 0.60);
    cursor = 'default';
  }

  // Waitlist assign target — indigo background highlight; border stays iron-green
  if (waitlistAssignTarget) {
    bg        = 'rgba(235,232,254,0.96)';
    boxShadow = '0 0 0 3px rgba(99,102,241,0.48), 0 0 36px rgba(99,102,241,0.22)';
    opacity   = 1;
  }

  // Ineligible table flash — background pulse only; no red border
  if (wlPickWarn) {
    opacity = 1;
  }

  // Swap source — violet background marks the reservation being swapped out; border stays
  if (swapSource) {
    boxShadow = '0 0 0 3px rgba(139,92,246,0.38), 0 0 40px rgba(139,92,246,0.20)';
    opacity   = 1;
  }

  // Pick mode — selection communicated through background; border stays iron-green throughout.
  if (pickMode) {
    if (pickStatus === 'current') {
      opacity = 1;
      cursor  = 'default';
    } else if (pickSelected) {
      bg        = 'rgba(59,130,246,0.22)';
      boxShadow = '0 0 0 3px rgba(59,130,246,0.35)';
      opacity   = 1;
    } else {
      opacity = 1;
    }
  }

  // In newResPick mode, only show reservations whose window covers the form's planning time.
  // currentRes is wall-clock operational state and may hold past/stale turns — never fall back
  // to it in planning mode. A null boardActiveRes means the table is free at the planned time.
  // In normal mode, fall through to nextRes so upcoming reservations are always visible.
  const displayRes = (inNewResPick || (inPlanningMode && !pickMode && !isStillOccupiedAtBoardTime))
    ? (boardActiveRes ?? null)
    : (isBoardTimeActive && table.liveStatus !== 'OCCUPIED' ? boardActiveRes ?? currentRes : currentRes) ?? nextRes ?? null;

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



  // Typography hierarchy: when a guest occupies or is reserved, the guest name is primary
  // and the table number becomes a secondary label.
  // Far-future reservations (60+ min) are suppressed — table renders as available.
  // In newResPick mode: show label only when there is a genuine conflict at the form time.
  const hasGuest = (inNewResPick || (inPlanningMode && !pickMode && !isStillOccupiedAtBoardTime))
    ? !!displayRes
    : (isBoardTimeActive || ['OCCUPIED', 'STALE_OCCUPIED', 'RESERVED', 'RESERVED_SOON'].includes(table.liveStatus) || !!pickMode) && !!displayRes && (!isFarFutureReserved || table.liveStatus === 'RESERVED_SOON' || !!pickMode);

  // Daily schedule strip — all of this table's PENDING/CONFIRMED reservations for the
  // selected day, already sorted by time. Suppressed only in pick/warn/dimmed modes.
  // Exclude the reservation already shown as the primary guest label (displayRes) so
  // RESERVED/RESERVED_SOON tables don't render the same guest name twice — once in the
  // card body and again as the first pill in the turn strip.

  const guestName = hasGuest ? (displayRes?.guestName ?? null) : null;
  const partySize = hasGuest && displayRes ? displayRes.partySize : null;
  const resTime   = hasGuest && displayRes ? displayRes.time : null;

  // In newResPick mode with an active conflict: compute when it ends for the "עד HH:MM" badge.
  const boardActiveResEndTime: string | null = (inNewResPick && boardActiveRes && boardActiveRes.time)
    ? (() => {
        const [h, m] = boardActiveRes.time.split(':').map(Number);
        const endMin = h * 60 + m + (boardActiveRes.duration ?? 90);
        return `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      })()
    : null;

  // Future reservation pills — upcoming turns for this table, excluding the active one.
  const turnsToShow = (!wlPickWarn && !dimmed)
    ? turns
        .filter(r => !hasGuest || !displayRes || r.id !== displayRes.id)
        .filter(r => {
          if (inNewResPick || inPlanningMode) {
            // Planning mode: show any turn whose window covers or starts after board time.
            // Turns already shown as displayRes are excluded by the preceding id-filter.
            // If boardMinutes is unknown, show nothing.
            // Note: occupied tables show currentRes as displayRes, not boardActiveRes, so
            // a reservation exactly at boardMinutes must still surface as a pill here.
            if (boardMinutes === null || !r.time) return false;
            const [h, m] = r.time.split(':').map(Number);
            return (h * 60 + m + (r.duration ?? 90)) > boardMinutes;
          }
          // Live mode: show anything that hasn't fully ended yet.
          if (boardMinutes === null || !r.time) return true;
          const [h, m] = r.time.split(':').map(Number);
          return (h * 60 + m + (r.duration ?? 90)) > boardMinutes;
        })
        .slice(0, 4)
    : [];

  return (
  <>
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={turnTooltip}
      className={`active:scale-[0.965] touch-manipulation${pickStatus === 'recommended' ? ' animate-pick-pulse' : ''}`}
      style={{
        position: 'absolute',
        left: table.posX, top: table.posY,
        width: table.width, height: table.height,
        borderRadius: familyRadius,
        border: `${borderWidth}px solid ${borderColor}`,
        backgroundColor: bg,
        boxShadow,
        filter: dimmed ? undefined : 'drop-shadow(0 1px 4px rgba(0,0,0,0.22))',
        opacity,
        padding: '4px 6px',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 1,
        textAlign: 'center',
        cursor,
        transition: `opacity var(--duration-fast) ease-out, border-color var(--duration-service) var(--ease-hospitality), background-color var(--duration-settle) var(--ease-hospitality)`,
      }}
    >
      {/* Table number — secondary label */}
      <span style={{
        fontSize: guestName ? 9 : 16,
        fontWeight: guestName ? 500 : 800,
        color: '#435B2A',
        opacity: guestName ? 0.65 : 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.1,
        letterSpacing: guestName ? '0.05em' : '-0.02em',
      }}>
        {table.name}
      </span>

      {/* Reservation time — most prominent when guest present */}
      {resTime && (
        <span style={{
          fontSize: 16, fontWeight: 900,
          color: '#435B2A',
          lineHeight: 1.1, letterSpacing: '-0.03em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {resTime}
        </span>
      )}

      {/* Guest name */}
      {guestName && (
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: '#435B2A',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          width: '100%', lineHeight: 1.2, letterSpacing: '-0.01em',
        }}>
          {guestName}
        </span>
      )}

      {/* Party size — secondary label */}
      <span style={{
        fontSize: 10, fontWeight: 500,
        color: '#435B2A', opacity: guestName ? 0.6 : 0.8,
        lineHeight: 1.1,
      }}>
        {partySize != null ? `${partySize}p` : `${table.maxCovers}p`}
      </span>

      {/* newResPick: "עד HH:MM" when a conflict is active at the form time */}
      {inNewResPick && boardActiveResEndTime && (
        <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', opacity: 0.88, userSelect: 'none' }}>
          עד {boardActiveResEndTime}
        </span>
      )}

      {/* Time-travel planning mode: show scheduled end time for OCCUPIED tables still within window */}
      {liveResEndLabel && (
        <span style={{ fontSize: 9, fontWeight: 700, color: '#92400e', opacity: 0.90, userSelect: 'none',
          background: 'rgba(146,64,14,0.10)', border: '1px solid rgba(146,64,14,0.25)',
          borderRadius: 3, padding: '1px 4px', lineHeight: 1.2 }}>
          {liveResEndLabel}
        </span>
      )}

      {/* newResPick: availability badge for recommended / possible tables */}
      {inNewResPick && !hasGuest && pickStatus && pickStatus !== 'unavailable' && pickStatus !== 'current' && (
        <span style={{
          fontSize: 8, fontWeight: 700, userSelect: 'none',
          color: pickStatus === 'recommended' ? '#16a34a' : pickStatus === 'possible' ? '#ca8a04' : '#6b7280',
          background: pickStatus === 'recommended' ? 'rgba(22,163,74,0.13)' : pickStatus === 'possible' ? 'rgba(202,138,4,0.13)' : 'rgba(107,114,128,0.10)',
          border: `1px solid ${pickStatus === 'recommended' ? 'rgba(22,163,74,0.32)' : pickStatus === 'possible' ? 'rgba(202,138,4,0.32)' : 'rgba(107,114,128,0.22)'}`,
          borderRadius: 3, padding: '1px 4px',
        }}>
          {pickStatus === 'recommended' ? 'מתאים' : pickStatus === 'possible' ? 'אפשרי' : 'צפוף'}
        </span>
      )}

      {/* Pick mode indicators */}
      {pickMode && pickStatus === 'current' && (
        <span style={{ fontSize: 8, color: '#d97706', fontWeight: 700, background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.30)', borderRadius: 3, padding: '1px 4px', userSelect: 'none' }}>
          {T.floorBoard.pickModeCurrentTable}
        </span>
      )}
      {pickMode && pickSelected && (
        <span style={{ fontSize: 9, color: '#2563eb', fontWeight: 700 }}>✓</span>
      )}

      {/* Lock badge */}
      {table.locked && (
        <span style={{
          position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)',
          fontSize: 8, color: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 3, padding: '1px 4px', userSelect: 'none',
        }}>
          LOCKED
        </span>
      )}
    </button>

    {/* Future reservation pills — anchored below the table card */}
    {turnsToShow.length > 0 && (
      <div style={{
        position: 'absolute',
        left: table.posX,
        top: table.posY + table.height + 4,
        width: Math.max(table.width, 72),
        zIndex: 6,
        pointerEvents: 'none',
        display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 3,
        opacity,
      }}>
        {turnsToShow.map((r, i) => (
          <div key={r.id ?? i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 5px',
            backgroundColor: 'rgba(67,91,42,0.10)',
            borderRadius: 4,
            border: '1px solid rgba(67,91,42,0.28)',
            borderLeft: '2px solid #435B2A',
          }}>
            {inNewResPick ? (
              // Hebrew context format in new-res mode: "הזמנה ב-19:30"
              <span style={{ fontSize: 10, color: '#435B2A', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                הזמנה ב-{normalizeTime(r.time)}
              </span>
            ) : (
              <>
                <span style={{ fontSize: 10, color: '#435B2A', fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {normalizeTime(r.time)}
                </span>
                <span style={{ fontSize: 10, color: '#435B2A', fontWeight: 500, maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
                  {r.guestName}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    )}
  </>
  );
}
