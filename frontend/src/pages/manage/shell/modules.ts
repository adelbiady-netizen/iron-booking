import type { IconProps } from './icons';
import {
  IcoDashboard, IcoOperations, IcoFloor, IcoGuests, IcoMarketing, IcoAnalytics, IcoAdmin,
} from './icons';
import type { ManagementCapability } from '../../../types';

// The permanent Management Workspace navigation (7 items — the locked top level).
// Each module maps to a capability (authoritative gate) and carries its roadmap
// phase so the shell can communicate what's live vs upcoming without placeholders.

export interface ModuleDef {
  key: string;
  label: string;      // Hebrew nav title
  subtitle: string;   // one-line context under the title
  phase: string;      // P0.x roadmap phase it ships in
  capability: ManagementCapability;
  Icon: (p: IconProps) => JSX.Element;
}

export const MODULES: ModuleDef[] = [
  { key: 'dashboard',  label: 'לוח בקרה',   subtitle: 'מבט על השירות עכשיו',      phase: 'P0.3', capability: 'dashboard.view',   Icon: IcoDashboard },
  { key: 'operations', label: 'תפעול',       subtitle: 'הזמנות וזמינות',           phase: 'P0.4', capability: 'operations.manage', Icon: IcoOperations },
  { key: 'floor',      label: 'מפת שולחנות', subtitle: 'מפה, שולחנות ואזורים',     phase: 'P0.5', capability: 'floor.manage',     Icon: IcoFloor },
  { key: 'guests',     label: 'אורחים',      subtitle: 'אורחים ומועדון',           phase: 'P0.6', capability: 'guests.manage',    Icon: IcoGuests },
  { key: 'marketing',  label: 'שיווק',       subtitle: 'עמוד, תפריט ו-QR',         phase: 'P0.7', capability: 'marketing.manage', Icon: IcoMarketing },
  { key: 'analytics',  label: 'אנליטיקה',    subtitle: 'כיסויים ומגמות',           phase: 'P0.8', capability: 'analytics.view',   Icon: IcoAnalytics },
  { key: 'admin',      label: 'ניהול',       subtitle: 'צוות, הרשאות והגדרות',     phase: 'P0.9', capability: 'admin.manage',     Icon: IcoAdmin },
];

export const DEFAULT_MODULE = 'dashboard';

export function findModule(key: string | null | undefined): ModuleDef {
  return MODULES.find(m => m.key === key) ?? MODULES[0];
}
