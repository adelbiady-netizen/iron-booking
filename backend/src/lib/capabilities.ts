/**
 * Management Workspace capability model (Product Architecture v1, Mission P0.1).
 *
 * Capabilities are the authoritative unit of authorization for the Management
 * Workspace. They are RESOLVED PER REQUEST from the caller's role (never baked
 * into the JWT), so grant changes take effect without re-login.
 *
 * P0.1 scope: capabilities are ROLE-DERIVED only. The per-user grant that lets a
 * MANAGER into the workspace lands in Mission P0.9 (Admin › Roles & Access); until
 * then MANAGER/HOST/STAFF have no management access — this is the safe default,
 * since no restaurant role can reach management today anyway.
 */

import type { UserRole } from '@prisma/client';

export type Capability =
  | 'management.access' // may open the Management Workspace at all (the entry gate)
  | 'dashboard.view'
  | 'operations.manage'
  | 'floor.manage'
  | 'guests.manage'
  | 'marketing.manage'
  | 'analytics.view'
  | 'admin.manage'; // Staff + Settings

export const ALL_CAPABILITIES: Capability[] = [
  'management.access',
  'dashboard.view',
  'operations.manage',
  'floor.manage',
  'guests.manage',
  'marketing.manage',
  'analytics.view',
  'admin.manage',
];

// Owner tier = full restaurant management. RESTAURANT_ADMIN/ADMIN fold into OWNER
// for Management Workspace purposes (they already have portal-level access today).
const OWNER_TIER: Capability[] = ALL_CAPABILITIES;

export const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  SUPER_ADMIN:      ALL_CAPABILITIES,
  HQ_ADMIN:         ALL_CAPABILITIES,
  GROUP_MANAGER:    ALL_CAPABILITIES,
  RESTAURANT_ADMIN: OWNER_TIER,
  OWNER:            OWNER_TIER,
  ADMIN:            OWNER_TIER,
  MANAGER:          [], // no management.access until the per-user grant (P0.9)
  HOST:             [],
  SERVER:           [],
};

export type ProductRole = 'IRON_ADMIN' | 'HQ_ADMIN' | 'OWNER' | 'MANAGER' | 'HOST' | 'STAFF';

/** Map the storage role enum onto the product-facing role vocabulary (v1). */
export function toProductRole(role: UserRole): ProductRole {
  switch (role) {
    case 'SUPER_ADMIN':      return 'IRON_ADMIN';
    case 'HQ_ADMIN':
    case 'GROUP_MANAGER':    return 'HQ_ADMIN';
    case 'RESTAURANT_ADMIN':
    case 'OWNER':
    case 'ADMIN':            return 'OWNER';
    case 'MANAGER':          return 'MANAGER';
    case 'HOST':             return 'HOST';
    case 'SERVER':           return 'STAFF';
    default:                 return 'STAFF';
  }
}

export function capabilitiesFor(role: UserRole): Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function hasCapability(role: UserRole, cap: Capability): boolean {
  return capabilitiesFor(role).includes(cap);
}

// ── Per-user grant resolution (Management Center access) ────────────────────────
// Roles that always have Management Center access (HQ tiers + owner tier). MANAGER
// is grant-gated; HOST/SERVER are never allowed, even if a grant flag is set.
const ALWAYS_ACCESS: ReadonlySet<UserRole> = new Set<UserRole>([
  'SUPER_ADMIN', 'HQ_ADMIN', 'GROUP_MANAGER', 'RESTAURANT_ADMIN', 'OWNER', 'ADMIN',
]);

// A granted MANAGER gets the operational modules — never Admin (Staff/Settings).
const GRANTED_MANAGER_CAPS: Capability[] = [
  'management.access', 'dashboard.view', 'operations.manage',
  'floor.manage', 'guests.manage', 'marketing.manage', 'analytics.view',
];

/** Whether this employee may open the Management Center. HOST/SERVER never can. */
export function canAccessManagement(role: UserRole, managementAccess: boolean): boolean {
  if (ALWAYS_ACCESS.has(role)) return true;
  if (role === 'MANAGER') return managementAccess === true;
  return false;
}

/** Capabilities for a specific employee, honoring their per-user grant. */
export function capabilitiesForUser(role: UserRole, managementAccess: boolean): Capability[] {
  if (ALWAYS_ACCESS.has(role)) return ROLE_CAPABILITIES[role];
  if (role === 'MANAGER' && managementAccess) return GRANTED_MANAGER_CAPS;
  return [];
}
